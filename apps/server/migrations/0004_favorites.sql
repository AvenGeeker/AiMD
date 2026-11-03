-- Favourites: provenance + media/classification projections, media worker queue and folder AI queries.
-- The Y.Doc remains authoritative; every notes.* column here is refreshed by mirrorNote().

ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_url             text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_platform        text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_author          text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_cover_id        text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS source_original_title  text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS collected_at           timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS capture_status         text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS media_status           text NOT NULL DEFAULT 'idle';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_category_folder_id  text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_category_name       text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_category_status     text NOT NULL DEFAULT 'idle';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_category_suggestion text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_category_at         timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_category_error      text;

CREATE INDEX IF NOT EXISTS idx_notes_source_platform
  ON notes (owner_id, source_platform) WHERE source_platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_collected
  ON notes (owner_id, collected_at DESC) WHERE collected_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notes_category_status
  ON notes (owner_id, ai_category_status) WHERE ai_category_status <> 'idle';
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_owner_source_url
  ON notes (owner_id, source_url)
  WHERE source_url IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders (owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes (owner_id, folder_id);

ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS vision_model text;
ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS transcription_model text;
ALTER TABLE ai_provider_configs ADD COLUMN IF NOT EXISTS web_search_mode text NOT NULL DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_ai_jobs_one_active_favorite
  ON ai_jobs (note_id) WHERE kind = 'favorite' AND status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS media_jobs (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id     text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'queued',
  image_ids   text[] NOT NULL DEFAULT '{}',
  video_id    text,
  attempts    integer NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_media_jobs_one_active_note
  ON media_jobs (note_id) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_media_jobs_queue
  ON media_jobs (status, created_at);

CREATE TABLE IF NOT EXISTS ai_folder_queries (
  id          text PRIMARY KEY,
  owner_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id   text NOT NULL,
  mode        text NOT NULL,
  status      text NOT NULL DEFAULT 'queued',
  question    text NOT NULL,
  allow_web   boolean NOT NULL DEFAULT false,
  history     jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer      text NOT NULL DEFAULT '',
  citations   jsonb NOT NULL DEFAULT '[]'::jsonb,
  web_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  web_used    boolean NOT NULL DEFAULT false,
  truncated   boolean NOT NULL DEFAULT false,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_folder_queries_owner
  ON ai_folder_queries (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_folder_queries_queue
  ON ai_folder_queries (status, created_at);
