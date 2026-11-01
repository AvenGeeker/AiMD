-- AiMD initial schema.
--
-- Authority model: the Y.Doc (note_documents.ydoc) is the single source of truth for note
-- content and metadata, and for the workspace folder tree / tags / settings. Every other
-- column that duplicates CRDT state is a *projection* maintained by the Hocuspocus store
-- hook so that listing, searching and tree rendering never need to materialise a Y.Doc.

-- pg_trgm powers substring search. Postgres' built-in full-text search cannot segment
-- Chinese, and trigram matching handles CJK without a custom dictionary image.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folders (
  id         text PRIMARY KEY,
  owner_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  text REFERENCES folders(id) ON DELETE SET NULL,
  name       text NOT NULL,
  position   text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id                 text PRIMARY KEY,
  owner_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id          text REFERENCES folders(id) ON DELETE SET NULL,
  title              text NOT NULL DEFAULT '无标题',
  body_text          text NOT NULL DEFAULT '',
  is_pinned          boolean NOT NULL DEFAULT false,
  is_archived        boolean NOT NULL DEFAULT false,
  deleted_at         timestamptz,
  position           text NOT NULL,
  word_count         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  content_updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- The CRDT document. One row per note; `ydoc` is the authoritative state.
CREATE TABLE IF NOT EXISTS note_documents (
  note_id    text PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  ydoc       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The per-user CRDT document: folder tree, tag definitions and settings.
CREATE TABLE IF NOT EXISTS workspace_documents (
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ydoc       bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mirror of the workspace doc's `settings` map, so REST and the desktop main process can
-- read preferences without materialising a Y.Doc.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  id       text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     text NOT NULL,
  color    text NOT NULL DEFAULT '#6b7280'
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  text NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     text REFERENCES notes(id) ON DELETE SET NULL,
  filename    text NOT NULL,
  mime        text NOT NULL,
  size        bigint NOT NULL,
  storage_key text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_folders_owner        ON folders (owner_id);
CREATE INDEX IF NOT EXISTS idx_folders_owner_parent ON folders (owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner_folder   ON notes (owner_id, folder_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner_alive    ON notes (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_owner_updated  ON notes (owner_id, content_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_folder_name    ON notes (folder_id, title);
CREATE INDEX IF NOT EXISTS idx_tags_owner           ON tags (owner_id);
CREATE INDEX IF NOT EXISTS idx_note_tags_tag        ON note_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_attachments_owner    ON attachments (owner_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user         ON refresh_tokens (user_id);

-- Trigram index for substring search over title + body (including CJK).
CREATE INDEX IF NOT EXISTS idx_notes_search_trgm
  ON notes USING gin ((title || ' ' || body_text) gin_trgm_ops);
