-- Public note sharing.
--
-- A row means "this note is currently shared"; revoking deletes the row. The random token is
-- the capability URL secret. Sharing is server-side access control metadata, not note content,
-- so it deliberately does not live in the note Y.Doc.

CREATE TABLE IF NOT EXISTS note_shares (
  note_id    text PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  owner_id   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT note_shares_token_shape CHECK (token ~ '^[A-Za-z0-9_-]{32,64}$')
);

CREATE INDEX IF NOT EXISTS idx_note_shares_owner ON note_shares (owner_id);
