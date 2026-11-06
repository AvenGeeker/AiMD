-- Rotated refresh tokens point at the token that replaced them. If the process was killed after
-- the server rotated but before the client persisted the response, the old token can be used once
-- more while its successor is still unused. Once the successor has itself been rotated, replaying
-- the old token is genuine reuse detection and revokes the family.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_id text;
