/**
 * Shared renderer ↔ Electron main contract for the macOS Notes integration.
 *
 * These are type-only declarations: the desktop shell validates the few mutable IPC inputs
 * defensively at the boundary, while the web bundle uses the same shapes for its UI.
 */

export const APPLE_NOTES_SCHEDULES = ['off', '15m', '30m', '1h', '6h', 'daily'] as const;
export type AppleNotesSchedule = (typeof APPLE_NOTES_SCHEDULES)[number];

export interface AppleNotesSettings {
  enabled: boolean;
  schedule: AppleNotesSchedule;
  syncOnLaunch: boolean;
  firstSyncConfirmedAt: string | null;
}

export type AppleNotesPermission = 'unknown' | 'granted' | 'denied' | 'unavailable';

export type AppleNotesPhase =
  | 'disabled'
  | 'idle'
  | 'probing'
  | 'scanning'
  | 'planning'
  | 'preview'
  | 'applying'
  | 'done'
  | 'error'
  | 'needs-attention';

export interface AppleNotesProgress {
  phase: string;
  current: number;
  total: number;
  label: string;
}

export interface AppleNotesCounts {
  appNotes: number;
  appleNotes: number;
  appFolders: number;
  appleFolders: number;
  attachments: number;
  readOnly: number;
}

export interface AppleNotesPlanCounts {
  createAppNotes: number;
  createAppleNotes: number;
  updateAppNotes: number;
  updateAppleNotes: number;
  trashAppNotes: number;
  trashAppleNotes: number;
  createAppFolders: number;
  createAppleFolders: number;
  moveAppFolders: number;
  moveAppleFolders: number;
  deleteAppFolders: number;
  deleteAppleFolders: number;
  uploadAttachments: number;
  downloadAttachments: number;
  conflicts: number;
  readOnly: number;
  uploadBytes: number;
  downloadBytes: number;
}

export interface AppleNotesPreviewSample {
  direction: 'apple-to-app' | 'app-to-apple' | 'conflict' | 'read-only';
  title: string;
  reason?: string;
}

export interface AppleNotesPreview {
  token: string;
  createdAt: string;
  counts: AppleNotesCounts;
  plan: AppleNotesPlanCounts;
  warnings: string[];
  samples: AppleNotesPreviewSample[];
}

export interface AppleNotesError {
  code: string;
  message: string;
}

export interface AppleNotesSyncResult {
  startedAt: string;
  finishedAt: string;
  createdAppNotes: number;
  createdAppleNotes: number;
  updatedAppNotes: number;
  updatedAppleNotes: number;
  trashedAppNotes: number;
  trashedAppleNotes: number;
  createdFolders: number;
  updatedFolders: number;
  deletedFolders: number;
  uploadedAttachments: number;
  downloadedAttachments: number;
  uploadedBytes: number;
  downloadedBytes: number;
  conflicts: number;
  readOnly: number;
  errors: AppleNotesError[];
  aborted?: 'permission' | 'auth' | 'canceled' | 'mass-deletion' | 'scan-incomplete' | 'mapping' | 'server' | 'notes';
}

export interface AppleNotesStatus {
  settings: AppleNotesSettings;
  permission: AppleNotesPermission;
  phase: AppleNotesPhase;
  running: boolean;
  progress: AppleNotesProgress | null;
  lastSyncAt: string | null;
  lastResult: AppleNotesSyncResult | null;
  pendingPreview: boolean;
  conflictCount: number;
  readOnlyCount: number;
  error: AppleNotesError | null;
}

export interface AppleNotesSyncOptions {
  /** Re-read every body/attachment instead of relying on metadata. */
  deep?: boolean;
  /** Scheduled runs apply routine changes without a preview. */
  scheduled?: boolean;
  /** Set only after the user confirmed a preview that exceeds the mass-deletion guard. */
  force?: boolean;
}

export interface AppleNotesChangedEvent {
  reason: 'applied' | 'settings' | 'read-only';
  at: string;
}
