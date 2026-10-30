import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type {
  FolderDto,
  ImportResultDto,
  NoteDto,
  NoteListDto,
  NoteSort,
  NoteSummaryDto,
  SettingsDto,
  TagDto,
  TreeDto,
} from '@aimarkdown/shared';
import { request, requestBlob } from './api.js';

/** Server-state access. The note *body* is not here — it lives in the CRDT document. */

export interface NoteFilter {
  folderId?: string | null;
  rootOnly?: boolean;
  tagIds?: string[];
  q?: string;
  archived?: 'true' | 'false' | 'only';
  sort?: NoteSort;
  limit?: number;
  cursor?: string | null;
}

export const keys = {
  notes: (filter: NoteFilter) => ['notes', filter] as const,
  note: (id: string) => ['note', id] as const,
  tree: () => ['tree'] as const,
  settings: () => ['settings'] as const,
};

function toQuery(filter: NoteFilter): Record<string, string | number | boolean | undefined> {
  return {
    folderId: filter.folderId === undefined ? undefined : (filter.folderId ?? ''),
    rootOnly: filter.rootOnly ? 'true' : undefined,
    tagIds: filter.tagIds && filter.tagIds.length > 0 ? filter.tagIds.join(',') : undefined,
    q: filter.q || undefined,
    archived: filter.archived ?? 'false',
    sort: filter.sort ?? 'updated',
    limit: filter.limit ?? 50,
    cursor: filter.cursor ?? undefined,
  };
}

export function useNotes(filter: NoteFilter, enabled = true) {
  return useQuery({
    queryKey: keys.notes(filter),
    queryFn: () => request<NoteListDto>('/notes', { query: toQuery(filter) }),
    enabled,
    staleTime: 5_000,
  });
}

export function useNote(id: string | null) {
  return useQuery({
    queryKey: keys.note(id ?? 'none'),
    queryFn: () => request<NoteDto>(`/notes/${id}`),
    enabled: Boolean(id),
    staleTime: 5_000,
  });
}

export function useTree() {
  return useQuery({
    queryKey: keys.tree(),
    queryFn: () => request<TreeDto>('/tree'),
    staleTime: 10_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: keys.settings(),
    queryFn: () => request<SettingsDto>('/settings'),
    staleTime: 30_000,
  });
}

/** Invalidate everything that depends on note/folder/tag structure. */
export function invalidateStructure(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: ['notes'] });
  void client.invalidateQueries({ queryKey: ['tree'] });
}

export function useCreateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; folderId?: string | null; tagIds?: string[]; body?: string }) =>
      request<NoteDto>('/notes', { method: 'POST', body: input }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useUpdateNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: { folderId?: string | null; pinned?: boolean; archived?: boolean; before?: string | null; after?: string | null };
    }) => request<NoteSummaryDto>(`/notes/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useDeleteNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permanent = false }: { id: string; permanent?: boolean }) =>
      request<{ ok: boolean }>(`/notes/${id}${permanent ? '?permanent=1' : ''}`, { method: 'DELETE' }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useRestoreNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<NoteSummaryDto>(`/notes/${id}/restore`, { method: 'POST' }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useCreateFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) =>
      request<FolderDto>('/folders', { method: 'POST', body: input }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useUpdateFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; parentId?: string | null } }) =>
      request<FolderDto>(`/folders/${id}`, { method: 'PATCH', body: patch }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useDeleteFolder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ ok: boolean }>(`/folders/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useUpsertTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; name: string; color?: string }) =>
      request<TagDto>('/tags', { method: 'POST', body: input }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useDeleteTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<{ ok: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateStructure(client),
  });
}

export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsDto>) => request<SettingsDto>('/settings', { method: 'PATCH', body: patch }),
    onSuccess: (settings) => {
      client.setQueryData(keys.settings(), settings);
    },
  });
}

/** Quick capture from the web client (the desktop shell captures straight into the CRDT). */
export function useQuickCapture() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, text }: { noteId: string; text: string }) =>
      request<{ ok: boolean }>(`/notes/${noteId}/capture`, { method: 'POST', body: { text } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}

export async function downloadVault(): Promise<void> {
  const blob = await requestBlob('/export/vault');
  triggerDownload(blob, `aimarkdown-${new Date().toISOString().slice(0, 10)}.zip`);
}

export async function downloadNote(id: string, title: string): Promise<void> {
  const blob = await requestBlob(`/notes/${id}/export`);
  triggerDownload(blob, `${title || 'note'}.md`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importFiles(files: File[]): Promise<ImportResultDto> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return request<ImportResultDto>('/import', { method: 'POST', body: form });
}

export interface UploadResult {
  id: string;
  url: string;
  filename: string;
}

export async function uploadAttachment(file: File, noteId?: string): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  return request<UploadResult>(`/attachments${noteId ? `?noteId=${encodeURIComponent(noteId)}` : ''}`, {
    method: 'POST',
    body: form,
  });
}
