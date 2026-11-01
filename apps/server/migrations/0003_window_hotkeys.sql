-- The desktop shell gained a second global shortcut for bringing the main window forward.
-- `hotkey` remains the quick-capture accelerator for backwards compatibility; add the new
-- preference to the JSON projection for existing accounts. Workspace docs are the authority,
-- so `readSettings` also supplies this default when the CRDT map predates the field.
UPDATE user_settings
SET settings = settings || jsonb_build_object(
  'mainWindowHotkey',
  COALESCE(NULLIF(settings->>'mainWindowHotkey', ''), 'CommandOrControl+Shift+M')
)
WHERE NOT (settings ? 'mainWindowHotkey')
   OR settings->>'mainWindowHotkey' = '';
