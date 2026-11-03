import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Hocuspocus } from '@hocuspocus/server';
import type { Sql } from 'postgres';
import * as Y from 'yjs';
import {
  ApiError,
  ERROR_CODES,
  noteDocName,
  type MediaStatus,
  type NoteMediaState,
} from '@aimarkdown/shared';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../utils/logger.js';
import type { AttachmentStorage } from '../services/storage.js';
import type { AiService } from '../ai/service.js';
import { appendToBody, writeMedia } from '../collab/docFactory.js';
import { docFromSnapshot, mutateDocument } from '../collab/direct.js';
import { mirrorNote } from '../collab/persistence.js';
import { decodeBytea } from '../db/bytea.js';

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface ClaimedMediaJob {
  id: string;
  ownerId: string;
  noteId: string;
  imageIds: string[];
  videoId: string | null;
}

export interface MediaWorker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface MediaWorkerDeps {
  sql: Sql;
  config: ServerConfig;
  log: Logger;
  storage: AttachmentStorage;
  getHocuspocus(): Hocuspocus | null;
  ai: AiService | null;
}

async function loadDoc(sql: Sql, noteId: string): Promise<Y.Doc> {
  const rows = await sql`select ydoc from note_documents where note_id = ${noteId}`;
  const bytes = decodeBytea(rows[0]?.ydoc);
  const doc = new Y.Doc();
  if (bytes && bytes.byteLength > 0) Y.applyUpdate(doc, bytes);
  return doc;
}

async function appendSection(
  deps: MediaWorkerDeps,
  noteId: string,
  ownerId: string,
  section: string,
  media: Partial<NoteMediaState>,
): Promise<void> {
  const hocuspocus = deps.getHocuspocus();
  let projected: Y.Doc;
  if (hocuspocus) {
    const { snapshot } = await mutateDocument(hocuspocus, noteDocName(noteId), (doc) => {
      const body = doc.getText('body').toString();
      const marker = section.split('\n', 1)[0]!;
      if (section && marker && !body.includes(marker)) appendToBody(doc, section);
      writeMedia(doc, media);
    });
    projected = docFromSnapshot(snapshot);
  } else {
    const doc = await loadDoc(deps.sql, noteId);
    const body = doc.getText('body').toString();
    const marker = section.split('\n', 1)[0]!;
    if (section && marker && !body.includes(marker)) appendToBody(doc, section);
    writeMedia(doc, media);
    await deps.sql`
      update note_documents set ydoc = ${Buffer.from(Y.encodeStateAsUpdate(doc))}::bytea, updated_at = now()
      where note_id = ${noteId}
    `;
    projected = doc;
  }
  await deps.sql.begin((tx) => mirrorNote(tx, noteId, ownerId, projected));
}

async function transcribeVideo(
  deps: MediaWorkerDeps,
  job: ClaimedMediaJob,
  attachment: { id: string; filename: string; mime: string; storageKey: string },
): Promise<{ marker: string }> {
  if (!deps.ai) throw new ApiError(ERROR_CODES.AI_NOT_CONFIGURED, 'AI 未配置');
  const dir = await mkdtemp(join(tmpdir(), 'aimd-media-'));
  try {
    const input = join(dir, 'input.bin');
    const data = await deps.storage.read(attachment.storageKey);
    if (!data) throw new Error('媒体附件文件缺失');
    await writeFile(input, data);
    try {
      const probe = await execFileAsync(deps.config.FFPROBE_PATH, [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        input,
      ], { timeout: 20_000 });
      const duration = Number(String(probe.stdout).trim());
      if (Number.isFinite(duration) && duration > deps.config.MEDIA_MAX_DURATION_SECONDS) {
        throw new ApiError(ERROR_CODES.MEDIA_TOO_LONG, '视频时长超过转写上限');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      deps.log.debug({ err: error }, 'ffprobe unavailable; continuing with ffmpeg');
    }
    await execFileAsync(deps.config.FFMPEG_PATH, [
      '-hide_banner', '-loglevel', 'error', '-i', input,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
      '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1',
      join(dir, 'part-%03d.mp3'),
    ], { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    const parts = (await readdir(dir)).filter((name) => name.startsWith('part-') && name.endsWith('.mp3')).sort();
    if (parts.length === 0) throw new Error('未能从视频中提取音频');
    const texts: string[] = [];
    for (const [index, part] of parts.entries()) {
      const audio = await readFile(join(dir, part));
      const text = await deps.ai.transcribeAudio(
        job.ownerId,
        new Uint8Array(audio),
        part,
        'audio/mpeg',
      );
      if (text) texts.push(`#### 片段 ${index + 1}\n${text}`);
    }
    return {
      marker: `<!-- aimd-transcript:${attachment.id} -->\n### 视频转写\n> 自动转写，可能存在误差\n\n${texts.join('\n\n')}`.trim(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function createMediaWorker(deps: MediaWorkerDeps): MediaWorker {
  let started = false;
  let loop: Promise<void> | null = null;
  let active: AbortController | null = null;

  async function claim(): Promise<ClaimedMediaJob | null> {
    return deps.sql.begin(async (tx) => {
      const rows = await tx`
        select id, owner_id, note_id, image_ids, video_id
        from media_jobs
        where status = 'queued'
        order by created_at asc
        limit 1
        for update skip locked
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        update media_jobs set status = 'running', started_at = now(), updated_at = now(), attempts = attempts + 1
        where id = ${String(row.id)}
      `;
      return {
        id: String(row.id),
        ownerId: String(row.owner_id),
        noteId: String(row.note_id),
        imageIds: Array.isArray(row.image_ids) ? row.image_ids.map(String) : [],
        videoId: row.video_id == null ? null : String(row.video_id),
      };
    });
  }

  async function process(job: ClaimedMediaJob): Promise<void> {
    active = new AbortController();
    let unconfigured = false;
    let failures = 0;
    let successes = 0;
    try {
      for (const imageId of job.imageIds) {
        const rows = await deps.sql`
          select id, filename, mime, storage_key from attachments
          where id = ${imageId} and owner_id = ${job.ownerId} and note_id = ${job.noteId}
        `;
        const row = rows[0];
        if (!row) continue;
        const marker = `<!-- aimd-ocr:${imageId} -->`;
        const existing = await deps.sql`select body_text from notes where id = ${job.noteId}`;
        if (String(existing[0]?.body_text ?? '').includes(marker)) {
          successes += 1;
          continue;
        }
        try {
          if (!deps.ai) throw new ApiError(ERROR_CODES.AI_NOT_CONFIGURED, 'AI 未配置');
          const data = await deps.storage.read(String(row.storage_key));
          if (!data) throw new Error('图片附件文件缺失');
          const text = await deps.ai.ocrImage(
            job.ownerId,
            Buffer.from(data).toString('base64'),
            String(row.mime),
            active.signal,
          );
          const section = `${marker}\n### 图片文字\n${
            text.trim() ? text.trim() : '> 未识别到可见文字'
          }`;
          await appendSection(deps, job.noteId, job.ownerId, section, {
            status: 'running',
            error: null,
            updatedAt: new Date().toISOString(),
          });
          successes += 1;
        } catch (error) {
          failures += 1;
          if (error instanceof ApiError && error.code === ERROR_CODES.MEDIA_MODEL_NOT_CONFIGURED) unconfigured = true;
          deps.log.warn({ err: error, noteId: job.noteId, imageId }, 'image OCR failed');
        }
      }

      if (job.videoId) {
        const rows = await deps.sql`
          select id, filename, mime, storage_key from attachments
          where id = ${job.videoId} and owner_id = ${job.ownerId} and note_id = ${job.noteId}
        `;
        const row = rows[0];
        const existing = await deps.sql`select body_text from notes where id = ${job.noteId}`;
        const marker = `<!-- aimd-transcript:${job.videoId} -->`;
        if (row && !String(existing[0]?.body_text ?? '').includes(marker)) {
          try {
            const result = await transcribeVideo(deps, job, {
              id: String(row.id),
              filename: String(row.filename),
              mime: String(row.mime),
              storageKey: String(row.storage_key),
            });
            await appendSection(deps, job.noteId, job.ownerId, result.marker, {
              status: 'running',
              error: null,
              updatedAt: new Date().toISOString(),
            });
            successes += 1;
          } catch (error) {
            failures += 1;
            if (error instanceof ApiError && error.code === ERROR_CODES.MEDIA_MODEL_NOT_CONFIGURED) unconfigured = true;
            deps.log.warn({ err: error, noteId: job.noteId }, 'video transcription failed');
          }
        }
      }

      const status: MediaStatus = unconfigured
        ? 'unconfigured'
        : failures > 0 && successes === 0
          ? 'error'
          : failures > 0
            ? 'partial'
            : 'done';
      await appendSection(deps, job.noteId, job.ownerId, '', {
        status,
        error: unconfigured ? '未配置视觉或语音转写模型' : failures > 0 ? '部分媒体识别失败' : null,
        updatedAt: new Date().toISOString(),
      });
      await deps.sql`
        update media_jobs set status = ${failures > 0 && successes === 0 ? 'failed' : 'completed'},
          error = ${failures > 0 ? '部分媒体识别失败' : null}, finished_at = now(), updated_at = now()
        where id = ${job.id}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
      await appendSection(deps, job.noteId, job.ownerId, '', {
        status: 'error',
        error: message,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
      await deps.sql`
        update media_jobs set status = 'failed', error = ${message}, finished_at = now(), updated_at = now()
        where id = ${job.id}
      `;
      deps.log.warn({ err: error, noteId: job.noteId }, 'media job failed');
    } finally {
      active = null;
      if (deps.ai) {
        await deps.ai.enqueueFavorite(job.ownerId, job.noteId).catch((error) => {
          if (
            error instanceof ApiError &&
            (error.code === ERROR_CODES.AI_NOT_CONFIGURED || error.code === ERROR_CODES.AI_DISABLED)
          ) return;
          deps.log.warn({ err: error, noteId: job.noteId }, 'favorite classify after media failed');
        });
      }
    }
  }

  return {
    async start() {
      if (started) return;
      await deps.sql`update media_jobs set status = 'queued', started_at = null where status = 'running'`;
      started = true;
      loop = (async () => {
        while (started) {
          const job = await claim();
          if (!job) {
            await sleep(1_500);
            continue;
          }
          await process(job);
        }
      })().catch((error) => deps.log.error({ err: error }, 'media worker loop failed'));
    },
    async stop() {
      started = false;
      active?.abort();
      await loop?.catch(() => undefined);
      loop = null;
    },
  };
}
