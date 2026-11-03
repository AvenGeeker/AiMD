import type {
  AttachmentDto,
  CreateNotesBatchDto,
  FolderDto,
  ImportResultDto,
  NoteBodyBatchDto,
  NoteDto,
  NoteListDto,
  NoteSummaryDto,
  TagDto,
  TreeDto,
  UserDto,
} from '@aimarkdown/shared';
import { getState } from '../store.js';
import { refreshDesktopSession } from '../auth.js';

export class DesktopApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DesktopApiError';
    this.status = status;
    this.code = code;
  }
}

function baseUrl(): string {
  return getState().serverUrl.replace(/\/+$/, '');
}

function url(path: string): string {
  const base = baseUrl();
  if (!base) throw new DesktopApiError(0, 'NO_SERVER', '尚未配置服务器地址');
  return `${base}/api${path.startsWith('/') ? path : `/${path}`}`;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const token = getState().accessToken;
    return fetch(url(path), {
      ...init,
      signal: signal ?? AbortSignal.timeout(60_000),
      headers: {
        ...(init.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  };
  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await refreshDesktopSession();
    if (!refreshed) throw new DesktopApiError(401, 'AUTH_REQUIRED', '登录已过期，请在主窗口重新登录');
    response = await doFetch();
  }
  if (!response.ok) {
    const body = (await readJson(response)) as { code?: string; message?: string } | null;
    throw new DesktopApiError(
      response.status,
      body?.code ?? 'HTTP_ERROR',
      body?.message ?? nonJsonHint(response),
    );
  }
  if (response.status === 204) return undefined as T;
  const payload = await readJson(response);
  if (payload === undefined) throw new DesktopApiError(response.status, 'INVALID_SERVER_RESPONSE', nonJsonHint(response));
  return payload as T;
}

/**
 * Parse a JSON body, returning `undefined` when the answer was not JSON at all.
 *
 * The main process talks to whatever address the user configured, and a wrong address answers with
 * an HTML page. Letting `response.json()` throw would put V8's `Unexpected token '<'` into the sync
 * error list, so the failure is reported as a readable Chinese hint instead.
 */
async function readJson(response: Response): Promise<unknown | undefined> {
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function nonJsonHint(response: Response): string {
  return `服务器没有返回 API 数据（HTTP ${response.status}，${response.url}）。请在主窗口确认服务器地址是否填成了 AiMD 的部署地址。`;
}

export async function getMe(signal?: AbortSignal): Promise<UserDto> {
  const payload = await request<{ user: UserDto }>('/me', {}, signal);
  return payload.user;
}

export async function getTree(signal?: AbortSignal): Promise<TreeDto> {
  return request<TreeDto>('/tree', {}, signal);
}

export async function listNotes(
  archived: 'all' | 'only',
  signal?: AbortSignal,
): Promise<NoteListDto> {
  const items: NoteSummaryDto[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10_000; page++) {
    const query = new URLSearchParams({ archived, limit: '200' });
    if (cursor) query.set('cursor', cursor);
    const result = await request<NoteListDto>(`/notes?${query.toString()}`, {}, signal);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return { items, nextCursor: null, total: items.length };
}

export async function readBodies(ids: string[], signal?: AbortSignal): Promise<NoteBodyBatchDto> {
  return request<NoteBodyBatchDto>('/notes/bodies', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  }, signal);
}

export async function createNotesBatch(
  items: Array<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<CreateNotesBatchDto> {
  return request<CreateNotesBatchDto>('/notes/batch-create', {
    method: 'POST',
    body: JSON.stringify({ items }),
  }, signal);
}

export async function createNote(input: Record<string, unknown>, signal?: AbortSignal): Promise<NoteDto> {
  return request<NoteDto>('/notes', { method: 'POST', body: JSON.stringify(input) }, signal);
}

export async function patchNote(
  id: string,
  patch: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<NoteSummaryDto> {
  return request<NoteSummaryDto>(`/notes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }, signal);
}

export async function trashNote(id: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }, signal);
}

export async function restoreNote(id: string, signal?: AbortSignal): Promise<NoteSummaryDto> {
  return request<NoteSummaryDto>(`/notes/${encodeURIComponent(id)}/restore`, { method: 'POST' }, signal);
}

export async function createFolder(
  input: { id?: string; name: string; parentId: string | null },
  signal?: AbortSignal,
): Promise<FolderDto> {
  return request<FolderDto>('/folders', { method: 'POST', body: JSON.stringify(input) }, signal);
}

export async function updateFolder(
  id: string,
  patch: { name?: string; parentId?: string | null },
  signal?: AbortSignal,
): Promise<FolderDto> {
  return request<FolderDto>(`/folders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }, signal);
}

export async function deleteFolder(id: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }, signal);
}

export async function upsertTag(
  input: { name: string; color?: string },
  signal?: AbortSignal,
): Promise<TagDto> {
  return request<TagDto>('/tags', { method: 'POST', body: JSON.stringify(input) }, signal);
}

export async function uploadAttachment(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  noteId: string | null,
  signal?: AbortSignal,
): Promise<AttachmentDto> {
  const form = new FormData();
  const copy = new Uint8Array(bytes);
  form.append('file', new Blob([copy], { type: mime }), filename);
  const query = noteId ? `?noteId=${encodeURIComponent(noteId)}` : '';
  return request<AttachmentDto>(`/attachments${query}`, { method: 'POST', body: form }, signal);
}

export async function downloadAttachment(
  id: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; mime: string | null; filename: string | null }> {
  const doFetch = async (): Promise<Response> => {
    const token = getState().accessToken;
    return fetch(url(`/attachments/${encodeURIComponent(id)}`), {
      signal: signal ?? AbortSignal.timeout(120_000),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  };
  let response = await doFetch();
  if (response.status === 401) {
    const refreshed = await refreshDesktopSession();
    if (!refreshed) throw new DesktopApiError(401, 'AUTH_REQUIRED', '登录已过期，请在主窗口重新登录');
    response = await doFetch();
  }
  if (!response.ok) {
    throw new DesktopApiError(response.status, 'ATTACHMENT', '附件下载失败');
  }
  const disposition = response.headers.get('content-disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mime: response.headers.get('content-type'),
    filename: encoded ? decodeURIComponent(encoded) : null,
  };
}

export async function importMarkdownFiles(
  files: Array<{ path: string; content: string }>,
  signal?: AbortSignal,
): Promise<ImportResultDto> {
  const form = new FormData();
  for (const file of files) {
    form.append('files', new Blob([file.content], { type: 'text/markdown' }), file.path);
  }
  return request<ImportResultDto>('/import', { method: 'POST', body: form }, signal);
}
