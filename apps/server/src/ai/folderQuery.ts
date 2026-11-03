import type { Sql } from 'postgres';
import {
  ApiError,
  ERROR_CODES,
  type FolderQueryDto,
  type FolderQueryInput,
  type FolderQueryMode,
  type FolderQueryStatus,
} from '@aimarkdown/shared';
import type { Logger } from '../utils/logger.js';
import { newId } from '../utils/ids.js';
import { toIsoOr } from '../utils/dates.js';
import { parseJsonb } from '../db/json.js';
import type { AiService } from './service.js';
import type { FolderCatalogNote } from './client.js';
import { noteSummariesByIds, readNoteBodies, type NotesDeps } from '../services/notes.js';
import { getSettings, type WorkspaceDeps } from '../services/workspace.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface FolderQueryService {
  start(): Promise<void>;
  stop(): Promise<void>;
  enqueue(ownerId: string, folderId: string, input: FolderQueryInput): Promise<FolderQueryDto>;
  get(ownerId: string, id: string): Promise<FolderQueryDto | null>;
  cancel(ownerId: string, id: string): Promise<FolderQueryDto>;
}

export interface FolderQueryDeps {
  sql: Sql;
  log: Logger;
  notes: NotesDeps;
  workspace: WorkspaceDeps;
  ai: AiService;
}

interface ClaimedQuery {
  id: string;
  ownerId: string;
  folderId: string;
  mode: FolderQueryMode;
  question: string;
  allowWeb: boolean;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function mapStatus(value: unknown): FolderQueryStatus {
  return ['queued', 'running', 'done', 'error', 'cancelled'].includes(String(value))
    ? (String(value) as FolderQueryStatus)
    : 'error';
}

export function createFolderQueryService(deps: FolderQueryDeps): FolderQueryService {
  let started = false;
  let loop: Promise<void> | null = null;
  const aborts = new Map<string, AbortController>();

  async function loadDto(ownerId: string, id: string): Promise<FolderQueryDto | null> {
    const rows = await deps.sql`select * from ai_folder_queries where id = ${id} and owner_id = ${ownerId}`;
    const row = rows[0];
    if (!row) return null;
    const citationIds = parseJsonb<string[]>(row.citations) ?? [];
    const citations = await noteSummariesByIds(deps.notes, ownerId, citationIds);
    return {
      id: String(row.id),
      folderId: String(row.folder_id),
      mode: String(row.mode) as FolderQueryMode,
      status: mapStatus(row.status),
      question: String(row.question),
      answer: String(row.answer ?? ''),
      citations,
      webSources: (parseJsonb<Array<{ title: string; url: string }>>(row.web_sources) ?? [])
        .filter((item) => item && typeof item.url === 'string')
        .slice(0, 12),
      webSearchUsed: row.web_used === true,
      truncated: row.truncated === true,
      error: typeof row.error === 'string' ? row.error : null,
      createdAt: toIsoOr(row.created_at, new Date(0)),
      finishedAt: row.finished_at ? toIsoOr(row.finished_at, new Date(0)) : null,
    };
  }

  async function claim(): Promise<ClaimedQuery | null> {
    return deps.sql.begin(async (tx) => {
      const rows = await tx`
        select id, owner_id, folder_id, mode, question, allow_web, history
        from ai_folder_queries
        where status = 'queued'
        order by created_at asc
        limit 1
        for update skip locked
      `;
      const row = rows[0];
      if (!row) return null;
      await tx`
        update ai_folder_queries set status = 'running', started_at = now(), updated_at = now()
        where id = ${String(row.id)}
      `;
      return {
        id: String(row.id),
        ownerId: String(row.owner_id),
        folderId: String(row.folder_id),
        mode: String(row.mode) as FolderQueryMode,
        question: String(row.question),
        allowWeb: row.allow_web === true,
        history: parseJsonb<Array<{ role: 'user' | 'assistant'; content: string }>>(row.history) ?? [],
      };
    });
  }

  async function run(query: ClaimedQuery): Promise<void> {
    const controller = new AbortController();
    aborts.set(query.id, controller);
    try {
      const settings = await getSettings(deps.workspace, query.ownerId);
      const root = settings.favoritesFolderId;
      if (!root) throw new ApiError(ERROR_CODES.NOT_FOUND, '收藏目录未初始化');
      const rows = await deps.sql`
        with recursive subtree as (
          select id from folders where owner_id = ${query.ownerId} and id = ${query.folderId}
          union
          select f.id from folders f join subtree s on f.parent_id = s.id
          where f.owner_id = ${query.ownerId}
        )
        select n.id, n.title, n.ai_result, n.content_updated_at, n.source_platform, n.source_author,
               coalesce(array_agg(t.name) filter (where t.name is not null), '{}') as tag_ids
        from notes n
        left join note_tags nt on nt.note_id = n.id
        left join tags t on t.id = nt.tag_id and t.owner_id = n.owner_id
        where n.owner_id = ${query.ownerId} and n.deleted_at is null and n.is_archived = false
          and n.folder_id in (select id from subtree)
        group by n.id
        order by n.content_updated_at desc
        limit 1000
      `;
      if (rows.length === 0) {
        await deps.sql`
          update ai_folder_queries set status = 'done', answer = ${'这个文件夹里还没有可供分析的笔记。'},
            citations = '[]'::jsonb, finished_at = now(), updated_at = now()
          where id = ${query.id}
        `;
        return;
      }
      const catalog: FolderCatalogNote[] = rows.map((row) => {
        const ai = parseJsonb<{ summary?: string; keyPoints?: string[] }>(row.ai_result) ?? {};
        const tagIds = Array.isArray(row.tag_ids) ? row.tag_ids.map(String) : [];
        return {
          id: String(row.id),
          title: String(row.title),
          summary: String(ai.summary ?? '').slice(0, 600),
          keyPoints: Array.isArray(ai.keyPoints) ? ai.keyPoints.map(String).slice(0, 6) : [],
          tags: tagIds,
          platform: row.source_platform == null ? null : String(row.source_platform),
          author: row.source_author == null ? null : String(row.source_author),
          updatedAt: toIsoOr(row.content_updated_at, new Date(0)),
        };
      });
      const truncated = rows.length > 300;
      let selected = catalog.slice(0, 12).map((item) => item.id);
      if (catalog.length > 12) {
        const picked: string[] = [];
        for (let index = 0; index < catalog.length; index += 100) {
          const ids = await deps.ai.pickRelevantNotes(
            query.ownerId,
            query.question,
            catalog.slice(index, index + 100),
            controller.signal,
          );
          picked.push(...ids);
        }
        selected = [...new Set(picked)].slice(0, 12);
      }
      const bodies = await readNoteBodies(deps.notes, query.ownerId, selected);
      let total = 0;
      const answerNotes = bodies
        .map((note) => ({ id: note.id, title: note.title, body: note.body }))
        .filter((note) => {
          if (total >= 120_000) return false;
          total += note.body.length;
          return true;
        });
      const output = await deps.ai.answerFolder(
        query.ownerId,
        {
          mode: query.mode,
          question: query.question,
          history: query.history,
          notes: answerNotes,
          allowWebSearch: query.allowWeb,
        },
        controller.signal,
      );
      const cited: string[] = [];
      const refs = answerNotes.map((note, index) => ({ ref: index + 1, id: note.id }));
      for (const item of refs) {
        if (output.text.includes(`[${item.ref}]`)) cited.push(item.id);
      }
      if (cited.length === 0) cited.push(...answerNotes.map((note) => note.id));
      await deps.sql`
        update ai_folder_queries set
          status = 'done',
          answer = ${output.text.slice(0, 200_000)},
          citations = ${JSON.stringify(cited)}::jsonb,
          web_sources = ${JSON.stringify(output.webSources)}::jsonb,
          web_used = ${query.allowWeb},
          truncated = ${truncated || total >= 120_000},
          finished_at = now(),
          updated_at = now()
        where id = ${query.id}
      `;
    } catch (error) {
      if (controller.signal.aborted) {
        await deps.sql`
          update ai_folder_queries set status = 'cancelled', error = ${'用户已取消'},
            finished_at = now(), updated_at = now() where id = ${query.id}
        `;
      } else {
        const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
        deps.log.warn({ err: error, queryId: query.id }, 'folder AI query failed');
        await deps.sql`
          update ai_folder_queries set status = 'error', error = ${message},
            finished_at = now(), updated_at = now() where id = ${query.id}
        `;
      }
    } finally {
      aborts.delete(query.id);
    }
  }

  return {
    async start() {
      if (started) return;
      await deps.sql`update ai_folder_queries set status = 'queued', started_at = null where status = 'running'`;
      started = true;
      loop = (async () => {
        while (started) {
          const query = await claim();
          if (!query) {
            await sleep(1_200);
            continue;
          }
          await run(query);
        }
      })().catch((error) => deps.log.error({ err: error }, 'folder query worker failed'));
    },
    async stop() {
      started = false;
      for (const controller of aborts.values()) controller.abort();
      await loop?.catch(() => undefined);
      loop = null;
    },
    async enqueue(ownerId, folderId, input) {
      const folder = await deps.sql`
        with recursive subtree as (
          select id from folders where owner_id = ${ownerId} and id = ${folderId}
          union
          select f.id from folders f join subtree s on f.parent_id = s.id
          where f.owner_id = ${ownerId}
        )
        select 1 from subtree where id = ${folderId}
      `;
      if (folder.length === 0) throw new ApiError(ERROR_CODES.NOT_FOUND, '目录不存在');
      await deps.sql`delete from ai_folder_queries where finished_at < now() - interval '24 hours'`;
      const id = newId();
      await deps.sql`
        insert into ai_folder_queries (
          id, owner_id, folder_id, mode, status, question, allow_web, history
        ) values (
          ${id}, ${ownerId}, ${folderId}, ${input.mode}, 'queued', ${input.question},
          ${input.allowWebSearch}, ${JSON.stringify(input.history ?? [])}::jsonb
        )
      `;
      const dto = await loadDto(ownerId, id);
      if (!dto) throw new ApiError(ERROR_CODES.INTERNAL, 'AI 查询创建失败');
      return dto;
    },
    async get(ownerId, id) {
      return loadDto(ownerId, id);
    },
    async cancel(ownerId, id) {
      const rows = await deps.sql`select status from ai_folder_queries where id = ${id} and owner_id = ${ownerId}`;
      if (!rows[0]) throw new ApiError(ERROR_CODES.NOT_FOUND, 'AI 查询不存在');
      if (!['queued', 'running'].includes(String(rows[0].status))) {
        return (await loadDto(ownerId, id))!;
      }
      await deps.sql`
        update ai_folder_queries set status = 'cancelled', error = ${'用户已取消'},
          finished_at = now(), updated_at = now() where id = ${id}
      `;
      aborts.get(id)?.abort();
      return (await loadDto(ownerId, id))!;
    },
  };
}
