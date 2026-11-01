import { powerMonitor } from 'electron';
import { getState } from '../store.js';
import type { AppleNotesSyncEngine } from './sync.js';

const INTERVAL_MS: Record<string, number | null> = {
  off: null,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  daily: 24 * 60 * 60_000,
};

let timer: NodeJS.Timeout | null = null;
let engine: AppleNotesSyncEngine | null = null;
let started = false;

function arm(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!engine) return;
  const state = getState();
  if (!state.appleNotesEnabled || !state.appleNotesFirstSyncConfirmedAt) return;
  const delay = INTERVAL_MS[state.appleNotesSchedule];
  if (!delay) return;
  timer = setTimeout(() => {
    timer = null;
    void engine?.syncNow({ scheduled: true }).finally(() => arm());
  }, delay);
}

export function startAppleNotesScheduler(syncEngine: AppleNotesSyncEngine): void {
  engine = syncEngine;
  if (started) {
    arm();
    return;
  }
  started = true;
  powerMonitor.on('resume', () => {
    const state = getState();
    if (state.appleNotesEnabled && state.appleNotesFirstSyncConfirmedAt) {
      void engine?.syncNow({ scheduled: true });
    }
  });
  const state = getState();
  if (state.appleNotesEnabled && state.appleNotesFirstSyncConfirmedAt && state.appleNotesSyncOnLaunch) {
    setTimeout(() => void engine?.syncNow({ scheduled: true }), 30_000);
  }
  arm();
}

export function reconfigureAppleNotesScheduler(): void {
  arm();
}

export function stopAppleNotesScheduler(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  started = false;
  engine = null;
}
