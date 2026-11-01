-- AI summaries, automatic tags and persisted background jobs.
--
-- Provider keys live only in ai_provider_configs (AES-GCM ciphertext). Note content and AI
-- results still follow the project-wide authority model: the Y.Doc is the source of truth and
-- the notes.ai_* columns are projections refreshed by the Hocuspocus store hook.

ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_status       text NOT NULL DEFAULT 'idle';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_result       jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_generated_at timestamptz;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_source_hash  text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ai_error        text;

CREATE TABLE IF NOT EXISTS ai_provider_configs (
  user_id        text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  preset         text NOT NULL DEFAULT 'alibaba_token_plan',
  base_url       text NOT NULL,
  model          text NOT NULL,
  api_key_enc    text NOT NULL,
  api_key_hint   text NOT NULL DEFAULT '',
  last_test_at   timestamptz,
  last_test_ok   boolean,
  last_test_error text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id            text PRIMARY KEY,
  owner_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  status        text NOT NULL,
  note_id       text REFERENCES notes(id) ON DELETE CASCADE,
  current_note_id text,
  total         integer NOT NULL DEFAULT 0,
  completed     integer NOT NULL DEFAULT 0,
  succeeded     integer NOT NULL DEFAULT 0,
  failed        integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_job_items (
  job_id        text NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  note_id       text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending',
  mode          text NOT NULL DEFAULT 'full',
  auto          boolean NOT NULL DEFAULT false,
  error         text,
  call_count    integer NOT NULL DEFAULT 0,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  PRIMARY KEY (job_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_notes_ai_pending
  ON notes (owner_id) WHERE deleted_at IS NULL AND ai_generated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_jobs_owner_status
  ON ai_jobs (owner_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_one_active_backfill
  ON ai_jobs (owner_id) WHERE kind = 'backfill' AND status IN ('queued', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_jobs_one_active_note
  ON ai_jobs (note_id) WHERE kind = 'note' AND status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_ai_job_items_pending
  ON ai_job_items (job_id, status, created_at);
