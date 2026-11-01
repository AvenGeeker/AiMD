import type { Hocuspocus } from '@hocuspocus/server';
import type { Sql } from 'postgres';
import * as Y from 'yjs';
import {
  AI_AUTO_MIN_CHARS,
  ApiError,
  ERROR_CODES,
  noteDocName,
  type AiConfigDto,
  type AiConfigInput,
  type AiConfigTestInput,
  type AiConfigTestResultDto,
  type AiJobDto,
  type AiOverviewDto,
  type AiTodoEntry,
  type NoteAiState,
} from '@aimarkdown/shared';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../utils/logger.js';
import { newId } from '../utils/ids.js';
import { sha256Hex } from '../utils/hash.js';
import { toIso, toIsoOr } from '../utils/dates.js';
import { decodeBytea, encodeBytea } from '../db/bytea.js';
import { mutateDocument, docFromSnapshot } from '../collab/direct.js';
import { mirrorNote, type NoteStoredEvent } from '../collab/persistence.js';
import { projectNote, type NoteProjection } from '../collab/projection.js';
import {
  readAiState,
  readAiTodos,
  readTagIds,
  writeAiState,
  writeAiTodos,
  setTagIds,
} from '../collab/docFactory.js';
import { upsertTag, type WorkspaceDeps } from '../services/workspace.js';
import { createOpenAiCompatibleClient, type AiClient, type AiProviderConfig } from './client.js';
import { decryptSecret, encryptSecret, maskApiKey } from './crypto.js';
import type { AiAnalysis } from './parse.js';
import { mergeTodoEntries } from './todos.js';
import { normalizeAiTags, tagColorForName } from './tags.js';
import { assertSafeAiBaseUrl } from './url.js';

export interface AiServiceDeps {
  sql: Sql;
  config: ServerConfig;
  log: Logger;
  getHocuspocus(): Hocuspocus | null;
  client?: AiClient;
}

export interface AiService {
  start(): Promise<void>;
  stop(): Promise<void>;
  noteCreated(input: { ownerId: string; noteId: string; body: string }): Promise<void>;
  noteStored(event: NoteStoredEvent): Promise<void>;
  getOverview(ownerId: string): Promise<AiOverviewDto>;
  getJob(ownerId: string, jobId: string): Promise<AiJobDto | null>;
  saveConfig(ownerId: string, input: AiConfigInput): Promise<AiConfigDto>;
  deleteConfig(ownerId: string): Promise<void>;
  testConfig(ownerId: string, input: AiConfigTestInput): Promise<AiConfigTestResultDto>;
  enqueueNote(ownerId: string, noteId: string, options?: { auto?: boolean }): Promise<AiJobDto>;
  startBackfill(ownerId: string): Promise<AiJobDto>;
  cancelJob(ownerId: string, jobId: string): Promise<AiJobDto>;
}

interface StoredConfig extends AiProviderConfig {
  hint: string;
  lastTest: { at: string; ok: boolean; message: string | null } | null;
}

interface ClaimedItem {
  jobId: string;
  ownerId: string;
  kind: 'note' | 'backfill';
  noteId: string;
  mode: 'full' | 'tags_only';
  auto: boolean;
}

interface ItemResult {
  status: 'completed' | 'failed' | 'cancelled' | 'skipped';
  error?: string;
  callCount?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function rowBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function mapJob(row: Record<string, unknown>): AiJobDto {
  return {
    id: String(row.id),
    kind: String(row.kind) as AiJobDto['kind'],
    status: String(row.status) as AiJobDto['status'],
    total: Number(row.total ?? 0),
    completed: Number(row.completed ?? 0),
    succeeded: Number(row.succeeded ?? 0),
    failed: Number(row.failed ?? 0),
    currentNoteId: typeof row.current_note_id === 'string' ? row.current_note_id : null,
    error: typeof row.error === 'string' ? row.error : null,
    createdAt: toIsoOr(row.created_at, new Date(0)),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  };
}

function providerError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof ApiError && error.message.includes('取消');
}

/**
 * Server-owned AI orchestration.
 *
 * The worker is deliberately serial: a personal Token Plan and most small providers are happier
 * with one in-flight request, and serial progress makes the backfill button predictable.
 */
export function createAiService(deps: AiServiceDeps): AiService {
  const { sql, config, log } = deps;
  const client = deps.client ?? createOpenAiCompatibleClient({
    timeoutMs: config.AI_REQUEST_TIMEOUT_MS,
    maxChunkChars: config.AI_MAX_CHUNK_CHARS,
    maxChunks: config.AI_MAX_CHUNKS,
    requestIntervalMs: config.AI_REQUEST_INTERVAL_MS,
  });
  const workspaceDeps: WorkspaceDeps = {
    sql,
    log,
    getHocuspocus: deps.getHocuspocus,
  };

  let started = false;
  let worker: Promise<void> | null = null;
  const aborts = new Map<string, AbortController>();

  function credentialSecret(): string {
    return config.AI_CREDENTIALS_SECRET || config.JWT_SECRET;
  }

  async function readStoredConfig(ownerId: string): Promise<StoredConfig | null> {
    const rows = await sql`
      select user_id, enabled, preset, base_url, model, api_key_enc, api_key_hint,
             last_test_at, last_test_ok, last_test_error
      from ai_provider_configs where user_id = ${ownerId}
    `;
    const row = rows[0];
    if (!row) return null;
    let apiKey: string;
    try {
      apiKey = decryptSecret(String(row.api_key_enc), credentialSecret(), ownerId);
    } catch {
      throw new ApiError(ERROR_CODES.AI_NOT_CONFIGURED, 'AI 密钥无法解密，请重新填写');
    }
    return {
      enabled: rowBool(row.enabled),
      preset: String(row.preset),
      baseUrl: String(row.base_url),
      model: String(row.model),
      apiKey,
      hint: String(row.api_key_hint ?? ''),
      lastTest: row.last_test_at
        ? {
            at: toIsoOr(row.last_test_at, new Date(0)),
            ok: rowBool(row.last_test_ok),
            message: typeof row.last_test_error === 'string' ? row.last_test_error : null,
          }
        : null,
    };
  }

  async function requireConfig(ownerId: string): Promise<StoredConfig> {
    const stored = await readStoredConfig(ownerId);
    if (!stored) throw new ApiError(ERROR_CODES.AI_NOT_CONFIGURED, '请先在设置中配置 AI 服务');
    if (!stored.enabled) throw new ApiError(ERROR_CODES.AI_DISABLED, 'AI 功能已关闭');
    return stored;
  }

  function maskedConfig(stored: StoredConfig | null): AiConfigDto | null {
    if (!stored) return null;
    return {
      enabled: stored.enabled,
      preset: stored.preset as AiConfigDto['preset'],
      baseUrl: stored.baseUrl,
      model: stored.model,
      apiKeyConfigured: stored.apiKey.length > 0,
      apiKeyHint: stored.hint,
      lastTest: stored.lastTest,
    };
  }

  async function countCandidates(ownerId: string) {
    const rows = await sql`
      select
        count(*) filter (
          where not exists (select 1 from note_tags nt where nt.note_id = n.id)
        )::int as untagged,
        count(*) filter (where n.ai_generated_at is null)::int as missing_summary,
        count(*) filter (
          where (not exists (select 1 from note_tags nt where nt.note_id = n.id))
             or n.ai_generated_at is null
        )::int as pending
      from notes n
      where n.owner_id = ${ownerId}
        and n.deleted_at is null
        and btrim(n.body_text) <> ''
    `;
    const row = rows[0] ?? {};
    return {
      untaggedNotes: Number(row.untagged ?? 0),
      missingSummaryNotes: Number(row.missing_summary ?? 0),
      pendingNotes: Number(row.pending ?? 0),
    };
  }

  async function activeJob(ownerId: string): Promise<AiJobDto | null> {
    const rows = await sql`
      select * from ai_jobs
      where owner_id = ${ownerId} and status in ('queued', 'running')
      order by created_at desc limit 1
    `;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  async function getJobRow(ownerId: string, jobId: string): Promise<Record<string, unknown> | null> {
    const rows = await sql`select * from ai_jobs where id = ${jobId} and owner_id = ${ownerId}`;
    return (rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  async function loadStoredDoc(noteId: string): Promise<Y.Doc> {
    const rows = await sql`select ydoc from note_documents where note_id = ${noteId}`;
    const bytes = decodeBytea(rows[0]?.ydoc);
    const doc = new Y.Doc();
    if (bytes && bytes.byteLength > 0) Y.applyUpdate(doc, bytes);
    return doc;
  }

  /**
   * Read the persisted note document snapshot.
   *
   * Opening a direct connection here would itself trigger Hocuspocus' store hook, which would
   * look like a content change and enqueue a duplicate AI job. The store hook has already written
   * the current document before scheduling analysis, so the durable snapshot is the right input.
   */
  async function readLiveDoc(noteId: string): Promise<Y.Doc> {
    return loadStoredDoc(noteId);
  }

  async function applyNoteMutation(
    noteId: string,
    ownerId: string,
    mutate: (doc: Y.Doc) => void,
  ): Promise<NoteProjection> {
    const hocuspocus = deps.getHocuspocus();
    let projected: Y.Doc;
    if (hocuspocus) {
      const { snapshot } = await mutateDocument(hocuspocus, noteDocName(noteId), mutate);
      projected = docFromSnapshot(snapshot);
    } else {
      const doc = await loadStoredDoc(noteId);
      mutate(doc);
      const bytes = Y.encodeStateAsUpdate(doc);
      await sql`
        update note_documents set ydoc = ${encodeBytea(bytes)}::bytea, updated_at = now()
        where note_id = ${noteId}
      `;
      projected = doc;
    }
    let projection!: NoteProjection;
    await sql.begin(async (tx) => {
      projection = await mirrorNote(tx, noteId, ownerId, projected);
    });
    return projection;
  }

  async function markNoteState(
    noteId: string,
    ownerId: string,
    patch: Partial<NoteAiState>,
  ): Promise<void> {
    await applyNoteMutation(noteId, ownerId, (doc) => writeAiState(doc, patch));
  }

  async function ensureTags(ownerId: string, names: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const name of names) {
      const rows = await sql`
        select id, color from tags
        where owner_id = ${ownerId} and lower(name) = lower(${name})
        limit 1
      `;
      if (rows[0]) {
        out.push(String(rows[0].id));
      } else {
        const created = await upsertTag(workspaceDeps, ownerId, {
          name,
          color: tagColorForName(name),
        });
        out.push(created.id);
      }
    }
    return [...new Set(out)];
  }

  async function claimNextItem(): Promise<ClaimedItem | null> {
    return sql.begin(async (tx) => {
      const rows = await tx`
        select j.id as job_id, j.owner_id, j.kind, i.note_id, i.mode, i.auto
        from ai_jobs j
        join ai_job_items i on i.job_id = j.id
        where j.status in ('queued', 'running') and i.status = 'pending'
        order by case when j.kind = 'note' then 0 else 1 end, j.created_at asc, i.created_at asc
        limit 1
        for update of i skip locked
      `;
      const row = rows[0];
      if (!row) return null;
      const jobId = String(row.job_id);
      const noteId = String(row.note_id);
      await tx`
        update ai_jobs set status = 'running', current_note_id = ${noteId},
          started_at = coalesce(started_at, now()), updated_at = now()
        where id = ${jobId}
      `;
      await tx`
        update ai_job_items set status = 'running', started_at = now()
        where job_id = ${jobId} and note_id = ${noteId}
      `;
      return {
        jobId,
        ownerId: String(row.owner_id),
        kind: String(row.kind) as ClaimedItem['kind'],
        noteId,
        mode: String(row.mode) === 'tags_only' ? 'tags_only' : 'full',
        auto: rowBool(row.auto),
      };
    });
  }

  async function completeItem(
    item: ClaimedItem,
    result: ItemResult,
  ): Promise<void> {
    await sql.begin(async (tx) => {
      const jobRows = await tx`select kind, status from ai_jobs where id = ${item.jobId}`;
      const jobStatus = jobRows[0] ? String(jobRows[0].status) : 'running';
      const finalStatus = jobStatus === 'cancelled' ? 'cancelled' : result.status;
      await tx`
        update ai_job_items set
          status = ${finalStatus},
          error = ${result.error ?? null},
          call_count = ${result.callCount ?? 0},
          input_tokens = ${result.inputTokens ?? 0},
          output_tokens = ${result.outputTokens ?? 0},
          finished_at = now()
        where job_id = ${item.jobId} and note_id = ${item.noteId}
      `;
      if (jobStatus === 'cancelled') {
        await tx`update ai_jobs set updated_at = now(), finished_at = now() where id = ${item.jobId}`;
        return;
      }
      await tx`
        update ai_jobs set
          completed = completed + 1,
          succeeded = succeeded + ${finalStatus === 'completed' || finalStatus === 'skipped' ? 1 : 0},
          failed = failed + ${finalStatus === 'failed' ? 1 : 0},
          updated_at = now()
        where id = ${item.jobId}
      `;
      const remaining = await tx`
        select count(*)::int as c from ai_job_items
        where job_id = ${item.jobId} and status in ('pending', 'running')
      `;
      if (Number(remaining[0]?.c ?? 0) === 0) {
        const summary = await tx`
          select kind, failed from ai_jobs where id = ${item.jobId}
        `;
        const failed = Number(summary[0]?.failed ?? 0);
        const kind = String(summary[0]?.kind ?? item.kind);
        const nextStatus = failed > 0
          ? kind === 'backfill' ? 'completed_with_errors' : 'failed'
          : 'completed';
        await tx`
          update ai_jobs set status = ${nextStatus}, current_note_id = null,
            finished_at = now(), updated_at = now()
          where id = ${item.jobId}
        `;
      }
    });
  }

  async function processItem(item: ClaimedItem): Promise<void> {
    const controller = new AbortController();
    aborts.set(item.jobId, controller);
    let result: ItemResult = { status: 'failed', error: 'AI 任务失败' };
    try {
      const provider = await requireConfig(item.ownerId);
      const noteRows = await sql`
        select id from notes
        where id = ${item.noteId} and owner_id = ${item.ownerId} and deleted_at is null
      `;
      if (noteRows.length === 0) {
        result = { status: 'skipped' };
        return;
      }

      const doc = await readLiveDoc(item.noteId);
      const projection = projectNote(doc);
      const body = projection.bodyText;
      if (!body.trim()) {
        result = { status: 'skipped' };
        return;
      }

      const now = new Date().toISOString();
      const existingAi = readAiState(doc);
      await markNoteState(item.noteId, item.ownerId, {
        status: 'running',
        error: null,
        lastAttemptAt: now,
        ...(!existingAi.autoAttemptedAt ? { autoAttemptedAt: now } : {}),
      });

      const existingTags = await sql`
        select name from tags where owner_id = ${item.ownerId} order by name asc
      `;
      const output = await client.analyze({
        config: provider,
        note: {
          title: projection.title,
          body,
          existingTags: existingTags.map((row) => String(row.name)),
        },
        signal: controller.signal,
      });
      const analysis: AiAnalysis = output.analysis;
      const currentDoc = await readLiveDoc(item.noteId);
      if (!currentDoc.getText('body').toString().trim()) {
        result = { status: 'skipped' };
        return;
      }
      const currentTags = readTagIds(currentDoc);
      const aiTagIds = currentTags.length === 0
        ? await ensureTags(item.ownerId, normalizeAiTags(analysis.tags))
        : [];
      const currentTodos = readAiTodos(currentDoc);
      const mergedTodos: AiTodoEntry[] = mergeTodoEntries(currentTodos, analysis.todos, now);
      const sourceHash = sha256Hex(body);

      await applyNoteMutation(item.noteId, item.ownerId, (target) => {
        if (item.mode === 'full') {
          writeAiState(target, {
            status: 'done',
            summary: analysis.summary,
            keyPoints: analysis.keyPoints,
            generatedAt: now,
            sourceHash,
            model: provider.model,
            error: null,
            lastAttemptAt: now,
            ...(!existingAi.autoAttemptedAt ? { autoAttemptedAt: now } : {}),
          });
          writeAiTodos(target, mergedTodos);
        } else {
          writeAiState(target, {
            status: 'done',
            error: null,
            lastAttemptAt: now,
            ...(!existingAi.autoAttemptedAt ? { autoAttemptedAt: now } : {}),
          });
        }
        if (aiTagIds.length > 0 && readTagIds(target).length === 0) {
          setTagIds(target, aiTagIds);
        }
      });

      result = {
        status: 'completed',
        callCount: output.callCount,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
      };
    } catch (error) {
      if (isCancellation(error, controller.signal)) {
        result = { status: 'cancelled' };
      } else {
        const message = providerError(error);
        log.warn({ err: error, noteId: item.noteId }, 'AI note analysis failed');
        try {
          const now = new Date().toISOString();
          await markNoteState(item.noteId, item.ownerId, {
            status: 'error',
            error: message,
            lastAttemptAt: now,
            autoAttemptedAt: now,
          });
        } catch (stateError) {
          log.error({ err: stateError, noteId: item.noteId }, 'failed to persist AI error state');
        }
        result = { status: 'failed', error: message };
      }
    } finally {
      aborts.delete(item.jobId);
      await completeItem(item, result).catch((error) => {
        log.error({ err: error, jobId: item.jobId }, 'failed to finalize AI job item');
      });
    }
  }

  function kick(): void {
    if (!started || worker) return;
    worker = (async () => {
      while (started) {
        const item = await claimNextItem();
        if (!item) break;
        await processItem(item);
      }
    })()
      .catch((error) => log.error({ err: error }, 'AI worker loop failed'))
      .finally(() => {
        worker = null;
      });
  }

  async function enqueueNoteJob(
    ownerId: string,
    noteId: string,
    options: { auto?: boolean; mode?: 'full' | 'tags_only' } = {},
  ): Promise<AiJobDto> {
    await requireConfig(ownerId);
    const noteRows = await sql`
      select id from notes
      where id = ${noteId} and owner_id = ${ownerId} and deleted_at is null
    `;
    if (noteRows.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '笔记不存在');

    const jobId = newId();
    const createdId = await sql.begin(async (tx) => {
      const inserted = await tx`
        insert into ai_jobs (id, owner_id, kind, status, note_id, total)
        values (${jobId}, ${ownerId}, 'note', 'queued', ${noteId}, 1)
        on conflict do nothing
        returning id
      `;
      if (inserted.length === 0) return null;
      await tx`
        insert into ai_job_items (job_id, note_id, status, mode, auto)
        values (${jobId}, ${noteId}, 'pending', ${options.mode ?? 'full'}, ${options.auto === true})
        on conflict do nothing
      `;
      return jobId;
    });
    kick();
    if (createdId) return (await getJob(ownerId, createdId))!;
    const existing = await sql`
      select * from ai_jobs
      where owner_id = ${ownerId} and note_id = ${noteId} and status in ('queued', 'running')
      order by created_at desc limit 1
    `;
    if (existing[0]) return mapJob(existing[0]);
    throw new ApiError(ERROR_CODES.INTERNAL, 'AI 任务创建失败');
  }

  async function getJob(ownerId: string, jobId: string): Promise<AiJobDto | null> {
    const row = await getJobRow(ownerId, jobId);
    return row ? mapJob(row) : null;
  }

  return {
    async start() {
      if (started) return;
      await sql`update ai_job_items set status = 'pending', started_at = null where status = 'running'`;
      await sql`update ai_jobs set status = 'queued', updated_at = now() where status = 'running'`;
      started = true;
      kick();
    },

    async stop() {
      started = false;
      for (const controller of aborts.values()) controller.abort();
      await worker?.catch(() => undefined);
      worker = null;
    },

    async noteCreated(input) {
      if (input.body.trim().length < AI_AUTO_MIN_CHARS) return;
      try {
        await enqueueNoteJob(input.ownerId, input.noteId, { auto: true });
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.code === ERROR_CODES.AI_NOT_CONFIGURED || error.code === ERROR_CODES.AI_DISABLED)
        ) return;
        log.warn({ err: error, noteId: input.noteId }, 'auto AI enqueue failed');
      }
    },

    async noteStored(event) {
      if (event.projection.bodyText.trim().length < AI_AUTO_MIN_CHARS) return;
      if (event.projection.aiGeneratedAt || event.projection.aiAutoAttemptedAt) return;
      if (event.projection.aiStatus !== 'idle') return;
      try {
        await enqueueNoteJob(event.ownerId, event.noteId, { auto: true });
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.code === ERROR_CODES.AI_NOT_CONFIGURED || error.code === ERROR_CODES.AI_DISABLED)
        ) return;
        log.warn({ err: error, noteId: event.noteId }, 'AI store scheduling failed');
      }
    },

    async getOverview(ownerId) {
      const [stored, counts, active, lastRows] = await Promise.all([
        readStoredConfig(ownerId).catch(() => null),
        countCandidates(ownerId),
        activeJob(ownerId),
        sql`
          select * from ai_jobs where owner_id = ${ownerId}
          order by created_at desc limit 1
        `,
      ]);
      return {
        config: maskedConfig(stored),
        counts,
        activeJob: active,
        lastJob: lastRows[0] ? mapJob(lastRows[0]) : null,
      };
    },

    async getJob(ownerId, jobId) {
      return getJob(ownerId, jobId);
    },

    async saveConfig(ownerId, input) {
      await assertSafeAiBaseUrl(input.baseUrl, config.AI_ALLOW_PRIVATE_BASE_URL);
      const existing = await readStoredConfig(ownerId).catch(() => null);
      const apiKey = input.apiKey ?? existing?.apiKey;
      if (!apiKey) throw new ApiError(ERROR_CODES.AI_NOT_CONFIGURED, '请填写 API Key');
      const encrypted = input.apiKey
        ? encryptSecret(input.apiKey, credentialSecret(), ownerId)
        : null;
      const hint = maskApiKey(apiKey);
      if (encrypted) {
        await sql`
          insert into ai_provider_configs (
            user_id, enabled, preset, base_url, model, api_key_enc, api_key_hint, updated_at
          ) values (
            ${ownerId}, ${input.enabled}, ${input.preset}, ${input.baseUrl}, ${input.model},
            ${encrypted}, ${hint}, now()
          )
          on conflict (user_id) do update set
            enabled = excluded.enabled,
            preset = excluded.preset,
            base_url = excluded.base_url,
            model = excluded.model,
            api_key_enc = excluded.api_key_enc,
            api_key_hint = excluded.api_key_hint,
            updated_at = now()
        `;
      } else {
        await sql`
          insert into ai_provider_configs (
            user_id, enabled, preset, base_url, model, api_key_enc, api_key_hint, updated_at
          ) values (
            ${ownerId}, ${input.enabled}, ${input.preset}, ${input.baseUrl}, ${input.model},
            ${encryptSecret(apiKey, credentialSecret(), ownerId)}, ${hint}, now()
          )
          on conflict (user_id) do update set
            enabled = excluded.enabled,
            preset = excluded.preset,
            base_url = excluded.base_url,
            model = excluded.model,
            updated_at = now()
        `;
      }
      const saved = await readStoredConfig(ownerId);
      return maskedConfig(saved)!;
    },

    async deleteConfig(ownerId) {
      await sql`delete from ai_provider_configs where user_id = ${ownerId}`;
    },

    async testConfig(ownerId, input) {
      await assertSafeAiBaseUrl(input.baseUrl, config.AI_ALLOW_PRIVATE_BASE_URL);
      const existing = await readStoredConfig(ownerId).catch(() => null);
      const apiKey = input.apiKey ?? existing?.apiKey;
      if (!apiKey) throw new ApiError(ERROR_CODES.AI_NOT_CONFIGURED, '请填写 API Key');
      const testConfig: AiProviderConfig = {
        enabled: true,
        preset: input.preset,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKey,
      };
      let ok = false;
      let message: string | null = null;
      let latencyMs = 0;
      try {
        const result = await client.test(testConfig);
        ok = true;
        latencyMs = result.latencyMs;
        message = result.message;
      } catch (error) {
        message = providerError(error);
      }
      if (existing) {
        await sql`
          update ai_provider_configs set
            last_test_at = now(),
            last_test_ok = ${ok},
            last_test_error = ${message},
            updated_at = now()
          where user_id = ${ownerId}
        `;
      }
      return { ok, latencyMs, model: input.model, message };
    },

    async enqueueNote(ownerId, noteId, options) {
      return enqueueNoteJob(ownerId, noteId, { ...options, mode: 'full' });
    },

    async startBackfill(ownerId) {
      await requireConfig(ownerId);
      const active = await sql`
        select * from ai_jobs
        where owner_id = ${ownerId} and kind = 'backfill' and status in ('queued', 'running')
        limit 1
      `;
      if (active[0]) {
        throw new ApiError(
          ERROR_CODES.AI_JOB_ALREADY_RUNNING,
          '已有回填任务正在运行',
          { job: mapJob(active[0]) },
        );
      }
      const candidates = await sql`
        select n.id,
               n.ai_generated_at,
               (select count(*)::int from note_tags nt where nt.note_id = n.id) as tag_count
        from notes n
        where n.owner_id = ${ownerId}
          and n.deleted_at is null
          and btrim(n.body_text) <> ''
          and (
            (select count(*)::int from note_tags nt where nt.note_id = n.id) = 0
            or n.ai_generated_at is null
          )
          and not exists (
            select 1 from ai_jobs j
            where j.note_id = n.id and j.status in ('queued', 'running')
          )
        order by n.created_at asc
      `;
      if (candidates.length === 0) {
        throw new ApiError(ERROR_CODES.BAD_REQUEST, '没有需要回填的笔记');
      }
      const jobId = newId();
      await sql.begin(async (tx) => {
        await tx`
          insert into ai_jobs (id, owner_id, kind, status, total)
          values (${jobId}, ${ownerId}, 'backfill', 'queued', ${candidates.length})
        `;
        for (const row of candidates) {
          const mode = row.ai_generated_at == null ? 'full' : 'tags_only';
          await tx`
            insert into ai_job_items (job_id, note_id, status, mode, auto)
            values (${jobId}, ${String(row.id)}, 'pending', ${mode}, false)
            on conflict do nothing
          `;
        }
      });
      kick();
      return (await getJob(ownerId, jobId))!;
    },

    async cancelJob(ownerId, jobId) {
      const row = await getJobRow(ownerId, jobId);
      if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, 'AI 任务不存在');
      const status = String(row.status);
      if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status)) {
        return mapJob(row);
      }
      await sql.begin(async (tx) => {
        await tx`
          update ai_jobs set status = 'cancelled', error = ${'用户已取消'},
            finished_at = now(), updated_at = now()
          where id = ${jobId} and owner_id = ${ownerId}
        `;
        await tx`
          update ai_job_items set status = 'cancelled', finished_at = now()
          where job_id = ${jobId} and status = 'pending'
        `;
      });
      aborts.get(jobId)?.abort();
      return (await getJob(ownerId, jobId))!;
    },
  };
}
