/** Application-wide constants shared by server, web and desktop. */

export const APP_NAME = 'aiMarkdown';

/** REST prefix. Everything else on the server is static assets or the health probe. */
export const API_PREFIX = '/api';

/** WebSocket path prefix used by the reverse proxy to route to the Hocuspocus port. */
export const COLLAB_PATH_PREFIX = '/collab';

/** Default ports. The server listens on both inside one Node process. */
export const DEFAULT_REST_PORT = 3000;
export const DEFAULT_COLLAB_PORT = 1234;

/** Title of the auto-created quick-capture target note. */
export const INBOX_NOTE_TITLE = '收集箱';

/** Access token lifetime (seconds) and refresh token lifetime (seconds). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Cookie names used by the browser client. */
export const ACCESS_COOKIE = 'amd_at';
export const REFRESH_COOKIE = 'amd_rt';

/** Maximum attachment size in bytes (100 MiB). */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

/** MIME types the editor renders inline as images. Everything else is inserted as a link. */
export const IMAGE_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif',
] as const;

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes((mime || '').toLowerCase().split(';', 1)[0]!.trim());
}

/** Allowed attachment MIME types for image paste/drop. */
export const ALLOWED_ATTACHMENT_MIME = IMAGE_MIME_TYPES;

/** Minimum length of a search query. `pg_trgm` needs enough characters to be useful. */
export const MIN_SEARCH_QUERY_LENGTH = 2;

/** Default page size / maximum page size for list endpoints. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Current CRDT document schema version, written into every workspace doc. */
export const CRDT_SCHEMA_VERSION = 1;

/** Editor view modes. */
export const EDITOR_MODES = ['split', 'edit', 'preview'] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

/** UI themes. */
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

/** Quick-capture timestamp stamp formats. */
export const STAMP_FORMATS = ['none', 'heading', 'bullet'] as const;
export type StampFormat = (typeof STAMP_FORMATS)[number];

/** Default global quick-capture hotkey per platform (Electron accelerator syntax). */
export const DEFAULT_HOTKEY: Record<'darwin' | 'win32' | 'linux', string> = {
  darwin: 'Alt+Space',
  win32: 'Ctrl+Alt+Space',
  linux: 'Ctrl+Alt+Space',
};

/**
 * Default global shortcut for opening the main window.
 *
 * `CommandOrControl` keeps the synced preference portable between macOS and Windows/Linux.
 */
export const DEFAULT_MAIN_WINDOW_HOTKEY = 'CommandOrControl+Shift+M';

/** List sort orders accepted by `GET /api/notes`. */
export const NOTE_SORTS = ['updated', 'created', 'title', 'position'] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];
