-- Remember-me sessions and safe refresh-token rotation.
--
-- `remembered` survives rotation so a long-lived device session stays long-lived instead of
-- silently falling back to the normal 30-day window after the first refresh.
-- `revoked_reason` lets /auth/refresh tell a routine rotation replay (a killed process or two
-- tabs refreshing concurrently) apart from an explicit logout or a genuinely stolen token.
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS remembered boolean NOT NULL DEFAULT false;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_reason text;
