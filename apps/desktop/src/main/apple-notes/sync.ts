import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  type AppleNotesChangedEvent,
  type AppleNotesCounts,
  type AppleNotesError,
  type AppleNotesPermission,
  type AppleNotesPhase,
  type AppleNotesPlanCounts,
  type AppleNotesPreview,
  type AppleNotesPreviewSample,
  type AppleNotesProgress,
  type AppleNotesSyncResult as AppleNotesResult,
  type AppleNotesSettings,
  type AppleNotesStatus,
  type AppleNotesSyncOptions,
  type FolderDto,
  type NoteBodyDto,
  type NoteSummaryDto,
  type TreeDto,
} from '@aimarkdown/shared';
import { getState, saveState } from '../store.js';
import * as api from './api.js';
import {
  applyAppleOps,
  listAppleTree,
  probeAppleNotes,
  readAppleFolderBodies,
  readAppleNotes,
  type AppleApplyOp,
  type AppleApplyOutcome,
  type AppleNoteMeta,
  type AppleTree,
} from './jxa.js';
import {
  appAttachmentIds,
  canonicalMarkdown,
  hasLossyMarkdown,
  htmlToMarkdown,
  inlineImageDataUris,
  markdownToHtml,
  splitAppleTitle,
  type HtmlAttachmentTarget,
} from './convert.js';
import { appleStateHash, noteStateHash, sha256Hex } from './hash.js';
import {
  emptyState,
  loadSyncState,
  saveSyncState,
  type AppleNotesState,
  type NoteLink,
  type SyncNamespace,
} from './state.js';

const SPECIAL_ROOT_FOLDER = 'AiMD 根笔记 (App)';
const MANAGED_TRASH_FOLDER = 'AiMD 回收站 (App)';
// Folders created before the rename stay usable: the stored ids take priority, and these names
// are the fallback when the local mapping has been lost.
const LEGACY_SPECIAL_ROOT_FOLDERS = ['aiMarkdown 根笔记 (App)'];
const LEGACY_MANAGED_TRASH_FOLDERS = ['aiMarkdown 回收站 (App)'];
const CONFLICT_TAG = 'Apple 同步冲突';
const READ_ONLY_TAG = 'Apple 同步只读';
const CONFLICT_COLOR = '#dc2626';
const READ_ONLY_COLOR = '#d97706';
const TWO_SECONDS = 2_000;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']);

function isImageMime(mime: string): boolean {
  return IMAGE_MIMES.has((mime || '').toLowerCase().split(';', 1)[0]!.trim());
}

interface AppNoteSnapshot {
  summary: NoteSummaryDto;
  body: string;
  stateHash: string;
  bodyLoaded: boolean;
}

interface PendingAttachment {
  source: string | null;
  placeholder: string;
  filename: string;
  mime: string;
  sha256: string;
  image: boolean;
  bytes?: Uint8Array;
  path?: string;
}

interface AppleNoteSnapshot {
  meta: AppleNoteMeta;
  title: string;
  body: string;
  folderKey: string;
  stateHash: string;
  attachmentHashes: string[];
  pending: PendingAttachment[];
  readOnlyReason: string | null;
  loaded: boolean;
}

type NoteAction =
  | { kind: 'createApple'; app: AppNoteSnapshot }
  | { kind: 'createApp'; apple: AppleNoteSnapshot }
  | { kind: 'pushApp'; app: AppNoteSnapshot; apple: AppleNoteSnapshot }
  | { kind: 'pullApple'; app: AppNoteSnapshot; apple: AppleNoteSnapshot }
  | { kind: 'conflict'; app: AppNoteSnapshot; apple: AppleNoteSnapshot }
  | { kind: 'trashApp'; appId: string; appleId: string }
  | { kind: 'trashApple'; appId: string; appleId: string }
  | { kind: 'restoreApp'; appId: string; apple: AppleNoteSnapshot }
  | { kind: 'link'; app: AppNoteSnapshot; apple: AppleNoteSnapshot };

interface FolderPlanCounts {
  createAppFolders: number;
  createAppleFolders: number;
  moveAppFolders: number;
  moveAppleFolders: number;
  deleteAppFolders: number;
  deleteAppleFolders: number;
}

export interface SyncCallbacks {
  onStatus(status: AppleNotesStatus): void;
  onChanged(reason: AppleNotesChangedEvent['reason']): void;
  onNotify?(title: string, body: string): void;
}

function settingsFromStore(): AppleNotesSettings {
  const state = getState();
  return {
    enabled: state.appleNotesEnabled,
    schedule: state.appleNotesSchedule,
    syncOnLaunch: state.appleNotesSyncOnLaunch,
    firstSyncConfirmedAt: state.appleNotesFirstSyncConfirmedAt,
  };
}

function settingsToStore(settings: Partial<AppleNotesSettings>): AppleNotesSettings {
  const patch: Record<string, unknown> = {};
  if (typeof settings.enabled === 'boolean') patch.appleNotesEnabled = settings.enabled;
  if (settings.schedule) patch.appleNotesSchedule = settings.schedule;
  if (typeof settings.syncOnLaunch === 'boolean') patch.appleNotesSyncOnLaunch = settings.syncOnLaunch;
  if (settings.firstSyncConfirmedAt !== undefined) patch.appleNotesFirstSyncConfirmedAt = settings.firstSyncConfirmedAt;
  saveState(patch);
  return settingsFromStore();
}

function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeForMatch(body: string): string {
  return canonicalMarkdown(body)
    .replace(/\/api\/attachments\/[A-Za-z0-9_-]+/g, '__attachment__')
    .replace(/__AIMD_ATT_[a-f0-9]+__/g, '__attachment__')
    .replace(/__attachment__/g, '__attachment__');
}

function matchKey(title: string, body: string): string {
  return `${normalizeTitle(title)}\u0000${normalizeForMatch(body)}`;
}

function isSystemFolder(name: string): boolean {
  return /recently deleted|最近删除|trash|垃圾箱|回收站/i.test(name);
}

function extFromName(name: string): string {
  const ext = extname(name).replace(/^\./, '').toLowerCase();
  return ext || 'bin';
}

function mimeFromName(name: string): string {
  const ext = extFromName(name);
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic',
    pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown',
  };
  return map[ext] ?? 'application/octet-stream';
}

function dataUriMime(uri: string): string {
  return /^data:([^;,]+)/i.exec(uri)?.[1]?.toLowerCase() ?? 'application/octet-stream';
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function dataUriToBytes(uri: string): Uint8Array | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(uri);
  if (!match) return null;
  return match[2] ? decodeBase64(match[3] ?? '') : new Uint8Array(Buffer.from(decodeURIComponent(match[3] ?? ''), 'utf8'));
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function bytesToDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime || 'application/octet-stream'};base64,${bytesToBase64(bytes)}`;
}

function safeFilename(name: string, fallback: string): string {
  return (name || fallback).replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 120);
}

function appleMetaHash(meta: AppleNoteMeta): string {
  return sha256Hex(JSON.stringify([
    meta.modifiedAt,
    meta.attachments.map((att) => [att.id, att.name, att.modifiedAt]).sort(),
  ]));
}

function folderDepth(folder: FolderDto, byId: Map<string, FolderDto>): number {
  let depth = 0;
  let current = folder;
  const seen = new Set<string>();
  while (current.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
    depth++;
  }
  return depth;
}

export class AppleNotesSyncEngine {
  private callbacks: SyncCallbacks;
  private permission: AppleNotesPermission = 'unknown';
  private phase: AppleNotesPhase = 'idle';
  private running = false;
  private controller: AbortController | null = null;
  private progress: AppleNotesProgress | null = null;
  private lastResult: AppleNotesResult | null = getState().appleNotesLastResult;
  private lastError: AppleNotesError | null = null;
  private pendingPreview: AppleNotesPreview | null = null;
  private pendingPreviewDeep = false;
  private forceDeletionLimit: number | null = null;
  private conflictTagId: string | null = null;
  private readOnlyTagId: string | null = null;
  private conflictCount = 0;
  private readOnlyCount = 0;

  constructor(callbacks: SyncCallbacks) {
    this.callbacks = callbacks;
  }

  getStatus(): AppleNotesStatus {
    const state = getState();
    return {
      settings: settingsFromStore(),
      permission: this.permission,
      phase: this.phase,
      running: this.running,
      progress: this.progress,
      lastSyncAt: state.appleNotesLastSyncAt,
      lastResult: this.lastResult,
      pendingPreview: this.pendingPreview !== null,
      conflictCount: this.conflictCount,
      readOnlyCount: this.readOnlyCount,
      error: this.lastError,
    };
  }

  setSettings(patch: Partial<AppleNotesSettings>): AppleNotesStatus {
    settingsToStore(patch);
    if (patch.enabled === false) {
      this.cancel();
      this.pendingPreview = null;
      this.pendingPreviewDeep = false;
      this.phase = 'disabled';
    } else if (this.phase === 'disabled') {
      this.phase = 'idle';
    }
    this.emit();
    return this.getStatus();
  }

  async probe(): Promise<AppleNotesStatus> {
    try {
      await probeAppleNotes({ signal: this.controller?.signal });
      this.permission = 'granted';
    } catch (error) {
      this.permission = error instanceof Error && /权限|authorized|-1743/i.test(error.message)
        ? 'denied'
        : 'unavailable';
    }
    this.emit();
    return this.getStatus();
  }

  async preview(deep = false): Promise<AppleNotesPreview> {
    if (this.running) throw new Error('同步正在进行中');
    this.running = true;
    this.controller = new AbortController();
    this.phase = 'scanning';
    this.lastError = null;
    this.emit();
    try {
      const outcome = await this.collect(deep, true);
      const preview: AppleNotesPreview = {
        token: randomUUID(),
        createdAt: new Date().toISOString(),
        counts: outcome.counts,
        plan: outcome.plan,
        warnings: outcome.warnings,
        samples: outcome.samples.slice(0, 30),
      };
      this.pendingPreview = preview;
      this.pendingPreviewDeep = deep;
      this.phase = 'preview';
      this.conflictCount = outcome.plan.conflicts;
      this.readOnlyCount = outcome.plan.readOnly;
      this.emit();
      return preview;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.running = false;
      this.progress = null;
      this.controller = null;
      this.callbacks.onChanged('settings');
      this.emit();
    }
  }

  async applyPreview(token: string): Promise<AppleNotesStatus> {
    if (!this.pendingPreview || this.pendingPreview.token !== token) {
      throw new Error('预览已过期，请重新扫描');
    }
    if (Date.now() - Date.parse(this.pendingPreview.createdAt) > 10 * 60_000) {
      this.pendingPreview = null;
      throw new Error('预览已超过 10 分钟，请重新扫描');
    }
    const deep = this.pendingPreviewDeep;
    const previewLimit = this.pendingPreview.plan.trashAppNotes + this.pendingPreview.plan.trashAppleNotes +
      this.pendingPreview.plan.deleteAppFolders + this.pendingPreview.plan.deleteAppleFolders + 5;
    this.pendingPreview = null;
    this.pendingPreviewDeep = false;
    this.forceDeletionLimit = previewLimit;
    if (!getState().appleNotesFirstSyncConfirmedAt) {
      settingsToStore({ firstSyncConfirmedAt: new Date().toISOString() });
    }
    await this.syncNow({ force: true, deep });
    return this.getStatus();
  }

  async syncNow(options: AppleNotesSyncOptions = {}): Promise<AppleNotesStatus> {
    if (this.running) return this.getStatus();
    const settings = settingsFromStore();
    if (!settings.enabled) {
      this.phase = 'needs-attention';
      this.lastError = { code: 'DISABLED', message: '请先在设置中启用 macOS 备忘录同步' };
      this.emit();
      return this.getStatus();
    }
    if (!settings.firstSyncConfirmedAt) {
      await this.preview(options.deep ?? false);
      return this.getStatus();
    }

    this.running = true;
    this.controller = new AbortController();
    this.phase = 'probing';
    this.lastError = null;
    this.emit();
    const startedAt = new Date();
    const result: AppleNotesResult = {
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      createdAppNotes: 0,
      createdAppleNotes: 0,
      updatedAppNotes: 0,
      updatedAppleNotes: 0,
      trashedAppNotes: 0,
      trashedAppleNotes: 0,
      createdFolders: 0,
      updatedFolders: 0,
      deletedFolders: 0,
      uploadedAttachments: 0,
      downloadedAttachments: 0,
      uploadedBytes: 0,
      downloadedBytes: 0,
      conflicts: 0,
      readOnly: 0,
      errors: [],
    };

    try {
      const probe = await probeAppleNotes({ signal: this.controller.signal });
      this.permission = 'granted';
      const me = await api.getMe(this.controller.signal);
      const namespace: SyncNamespace = {
        serverUrl: getState().serverUrl.replace(/\/+$/, ''),
        userId: me.id,
        appleAccountId: probe.accountId,
      };
      const loadedState = loadSyncState(namespace);
      if (!loadedState && !options.force) {
        throw new SafetyAbort('scan-incomplete', '本地同步映射缺失或已损坏，请先在设置中预览并确认');
      }
      let state = loadedState ?? emptyState(namespace);
      const outcome = await this.collect(options.deep ?? false, false, state, namespace);
      state = outcome.state;
      result.conflicts = outcome.plan.conflicts;
      result.readOnly = outcome.plan.readOnly;

      const deletions = outcome.plan.trashAppNotes + outcome.plan.trashAppleNotes +
        outcome.plan.deleteAppFolders + outcome.plan.deleteAppleFolders;
      const threshold = Math.max(20, Math.round(Object.keys(state.notes).length * 0.1));
      if (!outcome.completeScan) {
        throw new SafetyAbort('scan-incomplete', '备忘录扫描不完整，已停止删除以防止数据丢失');
      }
      if (outcome.counts.appleNotes === 0 && Object.keys(state.notes).length > 0) {
        throw new SafetyAbort('mass-deletion', '备忘录返回 0 条但本地存在映射，已停止同步');
      }
      if (deletions > threshold) {
        if (!options.force) {
          throw new SafetyAbort('mass-deletion', `本次计划删除 ${deletions} 项，超过安全阈值，请先在设置中预览确认`);
        }
        if (this.forceDeletionLimit !== null && deletions > this.forceDeletionLimit) {
          throw new SafetyAbort('mass-deletion', `本次实际删除 ${deletions} 项，超过预览确认的 ${this.forceDeletionLimit} 项，请重新预览`);
        }
      }

      this.phase = 'applying';
      this.emit();
      const applied = await this.applyOutcome(outcome, state, namespace, result);
      state = applied.state;
      result.finishedAt = new Date().toISOString();
      result.trashedAppNotes = applied.trashedAppNotes;
      result.trashedAppleNotes = applied.trashedAppleNotes;
      result.createdFolders = applied.createdFolders;
      result.updatedFolders = applied.updatedFolders;
      result.deletedFolders = applied.deletedFolders;
      result.uploadedAttachments = applied.uploadedAttachments;
      result.downloadedAttachments = applied.downloadedAttachments;
      result.uploadedBytes = applied.uploadedBytes;
      result.downloadedBytes = applied.downloadedBytes;
      result.errors = applied.errors;

      saveSyncState(state);
      this.lastResult = result;
      this.conflictCount = result.conflicts;
      this.readOnlyCount = result.readOnly;
      this.phase = 'done';
      saveState({
        appleNotesLastSyncAt: result.finishedAt,
        appleNotesLastResult: result,
      });
      this.emit();
      this.callbacks.onChanged('applied');
      if (result.conflicts > 0 || result.readOnly > 0 || result.errors.length > 0) {
        this.callbacks.onNotify?.(
          'AiMD 备忘录同步',
          `完成：冲突 ${result.conflicts}，只读 ${result.readOnly}，错误 ${result.errors.length}`,
        );
      }
    } catch (error) {
      if (error instanceof SafetyAbort) {
        result.aborted = error.kind;
        result.finishedAt = new Date().toISOString();
        this.lastResult = result;
        this.phase = 'needs-attention';
        this.lastError = { code: error.kind.toUpperCase(), message: error.message };
        saveState({ appleNotesLastResult: result });
        this.callbacks.onNotify?.('AiMD 备忘录同步已暂停', error.message);
      } else {
        this.fail(error);
      }
    } finally {
      this.running = false;
      this.progress = null;
      this.controller = null;
      this.forceDeletionLimit = null;
      this.emit();
    }
    return this.getStatus();
  }

  cancel(): void {
    this.controller?.abort();
  }

  private fail(error: unknown): void {
    if (error instanceof Error && (error.name === 'AbortError' || /aborted|abort/i.test(error.message))) {
      this.phase = 'idle';
      this.lastError = null;
      this.emit();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.phase = 'error';
    this.lastError = { code: 'SYNC_FAILED', message };
    if (/权限|authorized|-1743/i.test(message)) {
      this.permission = 'denied';
      this.lastError = { code: 'PERMISSION_DENIED', message: '未获得控制 macOS 备忘录的权限，请在系统设置中授权' };
    } else if (/登录已过期|AUTH_REQUIRED/i.test(message)) {
      this.lastError = { code: 'AUTH_REQUIRED', message: '登录已过期，请在主窗口重新登录' };
    }
    this.callbacks.onNotify?.('AiMD 备忘录同步失败', this.lastError.message);
    this.emit();
  }

  private emit(): void {
    this.callbacks.onStatus(this.getStatus());
  }

  private step(label: string, current: number, total: number): void {
    this.progress = { phase: this.phase, current, total, label };
    this.emit();
  }

  private async ensureTags(signal?: AbortSignal): Promise<void> {
    const conflict = await api.upsertTag({ name: CONFLICT_TAG, color: CONFLICT_COLOR }, signal);
    const readOnly = await api.upsertTag({ name: READ_ONLY_TAG, color: READ_ONLY_COLOR }, signal);
    this.conflictTagId = conflict.id;
    this.readOnlyTagId = readOnly.id;
  }

  private async collect(
    deep: boolean,
    dryRun: boolean,
    existingState?: AppleNotesState,
    namespace?: SyncNamespace,
  ): Promise<{
    state: AppleNotesState;
    counts: AppleNotesCounts;
    plan: AppleNotesPlanCounts;
    warnings: string[];
    samples: AppleNotesPreviewSample[];
    completeScan: boolean;
    actions: NoteAction[];
    folderCounts: FolderPlanCounts;
  }> {
    const signal = this.controller?.signal;
    const probe = await probeAppleNotes({ signal });
    this.permission = 'granted';
    const me = await api.getMe(signal);
    const ns = namespace ?? {
      serverUrl: getState().serverUrl.replace(/\/+$/, ''),
      userId: me.id,
      appleAccountId: probe.accountId,
    };
    const state = existingState ?? loadSyncState(ns) ?? emptyState(ns);
    this.step('正在准备同步标签', 0, 1);
    await this.ensureTags(signal);
    this.step('正在读取 AiMD 目录和笔记', 1, 4);
    const appTree = await api.getTree(signal);
    const appNotes = await this.scanAppNotes(appTree, state, deep, signal);
    const appTrash = await api.listNotes('only', signal);
    this.step('正在读取 macOS 备忘录', 2, 4);
    const appleTree = await listAppleTree(false, { signal });
    const special = this.findSpecialFolder(appleTree, state);
    if (special) state.rootAppleFolderId = special.id;
    const folderCounts = dryRun ? this.planFolders(appTree, appleTree, state) : await this.syncFolders(appTree, appleTree, state, signal);
    if (!dryRun) {
      // Re-read both trees after folder creation/moves so note targets are stable.
      const refreshedApp = await api.getTree(signal);
      const refreshedApple = await listAppleTree(false, { signal });
      // Keep the in-memory state: syncFolders has just added the new folder ids.
      const specialAfter = this.findSpecialFolder(refreshedApple, state);
      if (specialAfter) state.rootAppleFolderId = specialAfter.id;
      // Folder ids are durable integration state: persist them before note work can abort.
      saveSyncState(state);
      this.step('正在读取变更笔记', 3, 4);
      const refreshedAppNotes = await this.scanAppNotes(refreshedApp, state, deep, signal);
      const appleSnapshots = await this.scanAppleNotes(refreshedApple, state, deep, signal);
      const actionOutcome = this.planNotes(refreshedApp, refreshedApple, refreshedAppNotes, appTrash.items, appleSnapshots, state);
      return this.finishCollect(state, refreshedApp, refreshedApple, refreshedAppNotes, appleSnapshots, actionOutcome, folderCounts, dryRun);
    }
    this.step('正在读取变更笔记', 3, 4);
    const appleSnapshots = await this.scanAppleNotes(appleTree, state, deep, signal);
    const actionOutcome = this.planNotes(appTree, appleTree, appNotes, appTrash.items, appleSnapshots, state);
    return this.finishCollect(state, appTree, appleTree, appNotes, appleSnapshots, actionOutcome, folderCounts, dryRun);
  }

  private finishCollect(
    state: AppleNotesState,
    appTree: TreeDto,
    appleTree: AppleTree,
    appNotes: Map<string, AppNoteSnapshot>,
    appleNotes: Map<string, AppleNoteSnapshot>,
    actionOutcome: { actions: NoteAction[]; warnings: string[]; samples: AppleNotesPreviewSample[]; completeScan: boolean },
    folderCounts: FolderPlanCounts,
    dryRun: boolean,
  ): {
    state: AppleNotesState;
    counts: AppleNotesCounts;
    plan: AppleNotesPlanCounts;
    warnings: string[];
    samples: AppleNotesPreviewSample[];
    completeScan: boolean;
    actions: NoteAction[];
    folderCounts: FolderPlanCounts;
  } {
    const actions = actionOutcome.actions;
    const counts: AppleNotesCounts = {
      appNotes: appNotes.size,
      appleNotes: appleNotes.size,
      appFolders: appTree.folders.length,
      appleFolders: appleTree.folders.length,
      attachments: [...appleNotes.values()].reduce((sum, note) => sum + note.pending.length, 0),
      readOnly: actions.filter((action) => action.kind === 'link' && action.apple.readOnlyReason).length,
    };
    const plan: AppleNotesPlanCounts = {
      createAppNotes: actions.filter((action) => action.kind === 'createApp').length,
      createAppleNotes: actions.filter((action) => action.kind === 'createApple').length,
      updateAppNotes: actions.filter((action) => action.kind === 'pullApple').length,
      updateAppleNotes: actions.filter((action) => action.kind === 'pushApp').length,
      trashAppNotes: actions.filter((action) => action.kind === 'trashApp').length,
      trashAppleNotes: actions.filter((action) => action.kind === 'trashApple').length,
      createAppFolders: folderCounts.createAppFolders,
      createAppleFolders: folderCounts.createAppleFolders,
      moveAppFolders: folderCounts.moveAppFolders,
      moveAppleFolders: folderCounts.moveAppleFolders,
      deleteAppFolders: folderCounts.deleteAppFolders,
      deleteAppleFolders: folderCounts.deleteAppleFolders,
      uploadAttachments: [...appleNotes.values()].reduce((sum, note) => sum + note.pending.length, 0),
      downloadAttachments: 0,
      conflicts: actions.filter((action) => action.kind === 'conflict').length,
      readOnly: actions.filter((action) => action.kind === 'link' && action.apple.readOnlyReason).length,
      uploadBytes: [...appleNotes.values()].reduce(
        (sum, note) => sum + note.pending.reduce((bytes, attachment) => bytes + (attachment.bytes?.byteLength ?? 0), 0),
        0,
      ),
      downloadBytes: 0,
    };
    if (dryRun) this.readOnlyCount = plan.readOnly;
    return {
      state,
      counts,
      plan,
      warnings: actionOutcome.warnings,
      samples: actionOutcome.samples,
      completeScan: actionOutcome.completeScan,
      actions,
      folderCounts,
    };
  }

  private findSpecialFolder(tree: AppleTree, state?: AppleNotesState): { id: string; name: string } | null {
    if (state?.rootAppleFolderId) {
      const byId = tree.folders.find((folder) => folder.id === state.rootAppleFolderId && !folder.shared);
      if (byId) return byId;
    }
    return tree.folders.find(
      (folder) =>
        !folder.parentId &&
        !folder.shared &&
        [SPECIAL_ROOT_FOLDER, ...LEGACY_SPECIAL_ROOT_FOLDERS].includes(folder.name),
    ) ?? null;
  }

  private async scanAppNotes(
    tree: TreeDto,
    state: AppleNotesState,
    deep: boolean,
    signal?: AbortSignal,
  ): Promise<Map<string, AppNoteSnapshot>> {
    const linkByApp = new Map(Object.values(state.notes).map((link) => [link.appId, link]));
    const list = await api.listNotes('all', signal);
    const needBodies: NoteSummaryDto[] = [];
    for (const summary of list.items) {
      const link = linkByApp.get(summary.id);
      if (deep || !link || link.lastAppUpdatedAt !== summary.updatedAt || !link.lastAppHash) {
        needBodies.push(summary);
      }
    }
    const bodies = new Map<string, NoteBodyDto>();
    for (let i = 0; i < needBodies.length; i += 50) {
      this.step('正在读取 AiMD 笔记正文', i, needBodies.length);
      const batch = needBodies.slice(i, i + 50);
      try {
        const result = await api.readBodies(batch.map((note) => note.id), signal);
        for (const item of result.items) bodies.set(item.id, item);
      } catch (error) {
        if (!(error instanceof api.DesktopApiError) || error.status !== 413) throw error;
        // A batch with a few very large notes exceeded the response cap. Read those individually.
        for (const note of batch) {
          const result = await api.readBodies([note.id], signal);
          for (const item of result.items) bodies.set(item.id, item);
        }
      }
    }
    const out = new Map<string, AppNoteSnapshot>();
    for (const summary of list.items) {
      const link = linkByApp.get(summary.id);
      const body = bodies.get(summary.id);
      const stateHash = body?.stateHash ?? link?.lastAppHash ?? '';
      out.set(summary.id, {
        summary: body ?? summary,
        body: body?.body ?? '',
        stateHash,
        bodyLoaded: Boolean(body),
      });
    }
    return out;
  }

  private async scanAppleNotes(
    tree: AppleTree,
    state: AppleNotesState,
    deep: boolean,
    signal?: AbortSignal,
  ): Promise<Map<string, AppleNoteSnapshot>> {
    const linkByApple = new Map(Object.values(state.notes).map((link) => [link.appleId, link]));
    const systemFolders = new Set(tree.folders.filter((folder) => isSystemFolder(folder.name)).map((folder) => folder.id));
    if (state.managedTrashFolderId) systemFolders.add(state.managedTrashFolderId);
    const sharedFolders = new Set(tree.folders.filter((folder) => folder.shared).map((folder) => folder.id));
    // Recently Deleted (and its descendants) must never look like live notes.
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of tree.folders) {
        if (folder.parentId && systemFolders.has(folder.parentId) && !systemFolders.has(folder.id)) {
          systemFolders.add(folder.id);
          changed = true;
        }
        if (folder.parentId && sharedFolders.has(folder.parentId) && !sharedFolders.has(folder.id)) {
          sharedFolders.add(folder.id);
          changed = true;
        }
      }
    }
    const needBodies: AppleNoteMeta[] = [];
    for (const meta of tree.notes) {
      if (meta.folderId && systemFolders.has(meta.folderId)) continue;
      const link = linkByApple.get(meta.id);
      const metaHash = appleMetaHash(meta);
      if (deep || !link || link.lastAppleModifiedAt !== meta.modifiedAt ||
          (link.lastAppleMetaHash && link.lastAppleMetaHash !== metaHash) || !link.lastAppleHash) {
        needBodies.push(meta);
      }
    }
    const read = new Map<string, AppleNoteMeta>();
    // Bulk body reads are dramatically cheaper than one Apple Event per note: one call per
    // folder reads every body in that folder. Attachments are fetched separately only for notes
    // whose HTML actually references a non-data attachment.
    const folderIds = [...new Set(needBodies.map((note) => note.folderId).filter(Boolean) as string[])];
    for (let i = 0; i < folderIds.length; i += 6) {
      this.step('正在读取备忘录正文', i, folderIds.length);
      const result = await readAppleFolderBodies(folderIds.slice(i, i + 6), { signal });
      for (const note of result.notes) {
        if (!note.error) read.set(note.id, note);
      }
    }
    const fallbackIds = needBodies.filter((note) => !read.has(note.id)).map((note) => note.id);
    for (let i = 0; i < fallbackIds.length; i += 20) {
      const result = await readAppleNotes(fallbackIds.slice(i, i + 20), { signal });
      for (const note of result.notes) {
        if (!note.error) read.set(note.id, note);
      }
    }
    const attachmentIds = needBodies
      .filter((meta) => {
        const body = read.get(meta.id)?.body ?? '';
        return /file:\/\/|<object|<embed|cid:/i.test(body);
      })
      .map((meta) => meta.id);
    for (let i = 0; i < attachmentIds.length; i += 10) {
      this.step('正在读取备忘录附件', i, attachmentIds.length);
      const result = await readAppleNotes(attachmentIds.slice(i, i + 10), { signal });
      for (const detail of result.notes) {
        const existing = read.get(detail.id);
        if (existing) {
          existing.attachments = detail.attachments;
          if (detail.body) existing.body = detail.body;
          if (detail.bodyError) existing.bodyError = detail.bodyError;
        } else if (!detail.error) {
          read.set(detail.id, detail);
        }
      }
    }
    const out = new Map<string, AppleNoteSnapshot>();
    for (const meta of tree.notes) {
      if (meta.folderId && systemFolders.has(meta.folderId)) continue;
      const link = linkByApple.get(meta.id);
      const loadedMeta = read.get(meta.id);
      if (loadedMeta) {
        try {
          const snapshot = await this.snapshotAppleNote(loadedMeta, state, signal);
          if (meta.folderId && sharedFolders.has(meta.folderId)) snapshot.readOnlyReason = snapshot.readOnlyReason ?? '共享目录';
          out.set(meta.id, snapshot);
        } catch (error) {
          out.set(meta.id, {
            meta,
            title: meta.name || '无标题',
            body: '',
            folderKey: this.appleFolderKey(meta.folderId, state),
            stateHash: '',
            attachmentHashes: [],
            pending: [],
            readOnlyReason: `格式转换失败：${error instanceof Error ? error.message : String(error)}`,
            loaded: false,
          });
        }
      } else {
        out.set(meta.id, {
          meta,
          title: meta.name,
          body: '',
          folderKey: this.appleFolderKey(meta.folderId, state),
          stateHash: link?.lastAppleHash ?? '',
          attachmentHashes: [],
          pending: [],
          readOnlyReason: meta.passwordProtected
            ? '加密备忘录'
            : meta.shared || (meta.folderId && sharedFolders.has(meta.folderId))
              ? '共享备忘录/目录'
              : link?.readOnlyReason ?? null,
          loaded: false,
        });
      }
    }
    return out;
  }

  private appleFolderKey(folderId: string | null, state: AppleNotesState): string {
    if (!folderId || folderId === state.rootAppleFolderId) return 'root';
    return state.folders[folderId]?.appId ?? `apple:${folderId}`;
  }

  private async snapshotAppleNote(
    meta: AppleNoteMeta,
    state: AppleNotesState,
    _signal?: AbortSignal,
  ): Promise<AppleNoteSnapshot> {
    if (meta.error) {
      return {
        meta, title: meta.name || '无标题', body: '', folderKey: this.appleFolderKey(meta.folderId, state),
        stateHash: '', attachmentHashes: [], pending: [], readOnlyReason: meta.error, loaded: false,
      };
    }
    let readOnlyReason: string | null = null;
    if (meta.passwordProtected) readOnlyReason = '加密备忘录';
    if (meta.shared) readOnlyReason = '共享备忘录';
    if (meta.bodyError) readOnlyReason = `正文读取失败：${meta.bodyError}`;

    const pending: PendingAttachment[] = [];
    const targets: HtmlAttachmentTarget[] = [];
    const attachmentHashes: string[] = [];
    const usedHashes = new Set<string>();
    const addPending = (attachment: PendingAttachment) => {
      if (!usedHashes.has(attachment.sha256)) {
        usedHashes.add(attachment.sha256);
        attachmentHashes.push(attachment.sha256);
        pending.push(attachment);
      }
    };

    const html = meta.body ?? '';
    const dataUris = new Set<string>();
    const dataRe = /data:([^;"']+)?(;base64)?,[^"'\s>]+/gi;
    let dataMatch: RegExpExecArray | null;
    while ((dataMatch = dataRe.exec(html)) !== null) dataUris.add(dataMatch[0]);
    for (const uri of dataUris) {
      const bytes = dataUriToBytes(uri);
      if (!bytes) continue;
      const sha = sha256Hex(Buffer.from(bytes).toString('base64'));
      const mime = dataUriMime(uri);
      const placeholder = `__AIMD_ATT_${sha}__`;
      const filename = safeFilename(`image-${sha.slice(0, 12)}.${mime.split('/')[1] ?? 'bin'}`, 'image');
      addPending({ source: uri, placeholder, filename, mime, sha256: sha, image: isImageMime(mime), bytes });
      targets.push({ source: uri, replacement: placeholder, image: isImageMime(mime) });
    }

    for (const attachment of meta.attachments) {
      if (!attachment.path) {
        readOnlyReason = readOnlyReason ?? `附件无法导出：${attachment.name}`;
        continue;
      }
      try {
        const bytes = attachment.base64
          ? decodeBase64(attachment.base64)
          : new Uint8Array(await readFile(attachment.path));
        const sha = sha256Hex(Buffer.from(bytes).toString('base64'));
        const mime = mimeFromName(attachment.name);
        const placeholder = `__AIMD_ATT_${sha}__`;
        const filename = safeFilename(attachment.name, `attachment-${sha.slice(0, 12)}.${extFromName(attachment.name)}`);
        addPending({
          source: attachment.contentIdentifier ?? attachment.url ?? attachment.path,
          placeholder, filename, mime, sha256: sha, image: isImageMime(mime), bytes,
        });
        const sources = [
          attachment.contentIdentifier,
          attachment.url,
          attachment.path,
          attachment.contentIdentifier ? `cid:${attachment.contentIdentifier}` : null,
          attachment.path ? `file://${attachment.path}` : null,
        ];
        for (const source of sources) {
          if (source) targets.push({ source, replacement: placeholder, image: isImageMime(mime) });
        }
      } catch (error) {
        readOnlyReason = readOnlyReason ?? `附件读取失败：${attachment.name}（${error instanceof Error ? error.message : String(error)}）`;
      }
    }

    let processedHtml = html;
    for (const target of targets) {
      if (target.source) processedHtml = processedHtml.split(target.source).join(target.replacement);
    }
    let markdown = htmlToMarkdown(processedHtml, targets);
    const referenced = new Set(targets.map((target) => target.replacement));
    for (const attachment of pending) {
      if (!referenced.has(attachment.placeholder) || !markdown.includes(attachment.placeholder)) {
        markdown = canonicalMarkdown(`${markdown}\n\n${attachment.image ? '!' : ''}[${attachment.filename}](${attachment.placeholder})`);
      }
    }
    const split = splitAppleTitle(meta.name, markdown);
    const stateHash = appleStateHash(split.title, this.appleFolderKey(meta.folderId, state), split.body, attachmentHashes.sort());
    return {
      meta,
      title: split.title,
      body: split.body,
      folderKey: this.appleFolderKey(meta.folderId, state),
      stateHash,
      attachmentHashes,
      pending,
      readOnlyReason,
      loaded: true,
    };
  }

  private planFolders(appTree: TreeDto, appleTree: AppleTree, state: AppleNotesState): FolderPlanCounts {
    const counts: FolderPlanCounts = {
      createAppFolders: 0, createAppleFolders: 0, moveAppFolders: 0, moveAppleFolders: 0,
      deleteAppFolders: 0, deleteAppleFolders: 0,
    };
    const special = this.findSpecialFolder(appleTree, state);
    if (!special) counts.createAppleFolders++;
    const linkedApple = new Set(Object.keys(state.folders));
    const linkedApp = new Set(Object.values(state.folders).map((link) => link.appId));
    for (const app of appTree.folders) {
      if (!linkedApp.has(app.id)) {
        const match = appleTree.folders.find((folder) => !linkedApple.has(folder.id) && !folder.shared &&
          !isSystemFolder(folder.name) && folder.id !== special?.id && folder.id !== state.managedTrashFolderId &&
          folder.name === app.name);
        if (match) linkedApple.add(match.id);
        else counts.createAppleFolders++;
      }
    }
    for (const apple of appleTree.folders) {
      if (apple.shared || isSystemFolder(apple.name) || apple.id === special?.id || apple.id === state.managedTrashFolderId) continue;
      if (!linkedApple.has(apple.id)) {
        const match = appTree.folders.find((folder) => !linkedApp.has(folder.id) && folder.name === apple.name);
        if (match) linkedApp.add(match.id);
        else counts.createAppFolders++;
      }
    }
    for (const link of Object.values(state.folders)) {
      if (!appTree.folders.some((folder) => folder.id === link.appId)) counts.deleteAppFolders++;
      if (!appleTree.folders.some((folder) => folder.id === link.appleId)) counts.deleteAppleFolders++;
    }
    return counts;
  }

  private async syncFolders(
    appTree: TreeDto,
    appleTree: AppleTree,
    state: AppleNotesState,
    signal?: AbortSignal,
  ): Promise<FolderPlanCounts> {
    // Folder writes are executed synchronously through JXA/API below. This function is kept
    // separate from note planning so note targets always resolve to a real folder id.
    const counts: FolderPlanCounts = {
      createAppFolders: 0, createAppleFolders: 0, moveAppFolders: 0, moveAppleFolders: 0,
      deleteAppFolders: 0, deleteAppleFolders: 0,
    };
    const special = this.findSpecialFolder(appleTree, state);
    if (!special) {
      const outcome = await this.applyAppleSyncAsync([{ key: 'special-root', type: 'createFolder', name: SPECIAL_ROOT_FOLDER, parentId: null }], signal);
      const result = outcome.outcomes[0];
      if (result?.ok && result.id) {
        appleTree.folders.push({ id: result.id, name: SPECIAL_ROOT_FOLDER, parentId: null, shared: false });
        state.rootAppleFolderId = result.id;
        counts.createAppleFolders++;
      }
    } else {
      state.rootAppleFolderId = special.id;
    }
    // A missing Apple folder means the folder was deleted in Notes. Deleting the app folder
    // through the REST API promotes its notes/children to the parent (the agreed safe policy),
    // and the following note pass recreates the surviving notes in the parent Apple folder.
    for (const [appleId, link] of Object.entries(state.folders)) {
      if (appleTree.folders.some((folder) => folder.id === appleId)) continue;
      try {
        await api.deleteFolder(link.appId, signal);
        delete state.folders[appleId];
        appTree.folders = appTree.folders.filter((folder) => folder.id !== link.appId);
        counts.deleteAppFolders++;
      } catch {
        // The app folder may already be gone; the link is still removed below on a later scan.
      }
    }
    if (counts.deleteAppFolders > 0) {
      const refreshed = await api.getTree(signal);
      appTree.folders.splice(0, appTree.folders.length, ...refreshed.folders);
    }

    // Create/link folders top-down. A full tree reconciliation is intentionally conservative:
    // missing folders are promoted/deleted in cleanup after note sync, never by a blind delete.
    const appById = new Map(appTree.folders.map((folder) => [folder.id, folder]));
    const sortedApp = [...appTree.folders].sort((a, b) => folderDepth(a, appById) - folderDepth(b, appById));
    for (const app of sortedApp) {
      const existing = Object.values(state.folders).find((link) => link.appId === app.id);
      if (existing && appleTree.folders.some((folder) => folder.id === existing.appleId)) continue;
      const parentAppleId = this.appleFolderIdForAppParent(app.parentId ?? null, state);
      const match = appleTree.folders.find((folder) => folder.id !== state.rootAppleFolderId && folder.id !== state.managedTrashFolderId && !folder.shared && !isSystemFolder(folder.name) &&
        folder.name === app.name && (folder.parentId ?? null) === parentAppleId &&
        !Object.keys(state.folders).includes(folder.id));
      if (match) {
        state.folders[match.id] = {
          appleId: match.id, appId: app.id,
          lastAppleName: match.name, lastAppleParentId: match.parentId,
          lastAppName: app.name, lastAppParentId: app.parentId,
        };
        continue;
      }
      const outcome = await this.applyAppleSyncAsync([{
        key: `create-apple-folder-${app.id}`,
        type: 'createFolder',
        name: app.name,
        parentId: parentAppleId,
      }], signal);
      const created = outcome.outcomes[0];
      if (created?.ok && created.id) {
        appleTree.folders.push({ id: created.id, name: app.name, parentId: parentAppleId, shared: false });
        state.folders[created.id] = {
          appleId: created.id, appId: app.id,
          lastAppleName: app.name, lastAppleParentId: parentAppleId,
          lastAppName: app.name, lastAppParentId: app.parentId,
        };
        counts.createAppleFolders++;
      }
    }
    // Rename/move existing mapped folders. Baseline comparison avoids a restart churn loop;
    // when both sides changed, the app wins (folders have no Apple modification timestamp).
    for (const [appleId, link] of Object.entries(state.folders)) {
      const appFolder = appTree.folders.find((folder) => folder.id === link.appId);
      const appleFolder = appleTree.folders.find((folder) => folder.id === appleId);
      if (!appFolder || !appleFolder) continue;
      const appChanged = appFolder.name !== link.lastAppName || (appFolder.parentId ?? null) !== link.lastAppParentId;
      const appleChanged = appleFolder.name !== link.lastAppleName || (appleFolder.parentId ?? null) !== link.lastAppleParentId;
      if (!appChanged && !appleChanged) continue;
      const desiredName = appChanged ? appFolder.name : appleFolder.name;
      const desiredAppParent = appChanged ? appFolder.parentId : this.appFolderIdForAppleParent(appleFolder.parentId, state);
      const desiredAppleParent = appChanged ? this.appleFolderIdForAppParent(appFolder.parentId, state) : appleFolder.parentId;
      if (appleChanged && !appChanged) {
        try {
          const updated = await api.updateFolder(appFolder.id, {
            name: desiredName.slice(0, 120),
            parentId: desiredAppParent,
          }, signal);
          link.lastAppName = updated.name;
          link.lastAppParentId = updated.parentId;
          link.lastAppleName = appleFolder.name;
          link.lastAppleParentId = appleFolder.parentId;
          counts.moveAppFolders++;
        } catch {
          /* reported by the caller as a warning through note errors */
        }
      } else {
        const outcome = await this.applyAppleSyncAsync([{
          key: `update-folder-${appleId}`,
          type: 'updateFolder',
          id: appleId,
          name: desiredName,
          parentId: desiredAppleParent,
        }], signal);
        if (outcome.outcomes[0]?.ok) {
          link.lastAppleName = desiredName;
          link.lastAppleParentId = desiredAppleParent;
          link.lastAppName = appFolder.name;
          link.lastAppParentId = appFolder.parentId;
          counts.moveAppleFolders++;
        }
      }
    }

    // Create app folders for Apple folders that have no app counterpart.
    for (const apple of appleTree.folders) {
      if (apple.shared || isSystemFolder(apple.name) || apple.id === state.rootAppleFolderId || apple.id === state.managedTrashFolderId) continue;
      if (state.folders[apple.id]) continue;
      const parentAppId = this.appFolderIdForAppleParent(apple.parentId, state);
      const match = appTree.folders.find((folder) => folder.name === apple.name &&
        (folder.parentId ?? null) === parentAppId &&
        !Object.values(state.folders).some((link) => link.appId === folder.id));
      if (match) {
        state.folders[apple.id] = {
          appleId: apple.id, appId: match.id,
          lastAppleName: apple.name, lastAppleParentId: apple.parentId,
          lastAppName: match.name, lastAppParentId: match.parentId,
        };
        continue;
      }
      const created = await this.createAppFolderAsync({ name: apple.name.slice(0, 120), parentId: parentAppId }, signal);
      if (created) {
        appTree.folders.push(created);
        state.folders[apple.id] = {
          appleId: apple.id, appId: created.id,
          lastAppleName: apple.name, lastAppleParentId: apple.parentId,
          lastAppName: created.name, lastAppParentId: created.parentId,
        };
        counts.createAppFolders++;
      }
    }
    return counts;
  }

  private appleFolderIdForAppParent(appParentId: string | null, state: AppleNotesState): string | null {
    // App root-level folders live at the Apple account root. The special root folder is only
    // for app root-level *notes*; mixing the two would nest every top-level folder one level deep.
    if (!appParentId) return null;
    return Object.values(state.folders).find((link) => link.appId === appParentId)?.appleId ?? null;
  }

  private appFolderIdForAppleParent(appleParentId: string | null, state: AppleNotesState): string | null {
    if (!appleParentId || appleParentId === state.rootAppleFolderId) return null;
    return state.folders[appleParentId]?.appId ?? null;
  }

  private async applyAppleSyncAsync(ops: AppleApplyOp[], signal?: AbortSignal): Promise<{ outcomes: AppleApplyOutcome[] }> {
    return applyAppleOps(ops, { signal });
  }

  private async createAppFolderAsync(
    input: { id?: string; name: string; parentId: string | null },
    signal?: AbortSignal,
  ): Promise<FolderDto | null> {
    return api.createFolder(input, signal);
  }

  private planNotes(
    appTree: TreeDto,
    appleTree: AppleTree,
    appNotes: Map<string, AppNoteSnapshot>,
    appTrashList: NoteSummaryDto[],
    appleNotes: Map<string, AppleNoteSnapshot>,
    state: AppleNotesState,
  ): { actions: NoteAction[]; warnings: string[]; samples: AppleNotesPreviewSample[]; completeScan: boolean } {
    const actions: NoteAction[] = [];
    const warnings: string[] = [];
    const samples: AppleNotesPreviewSample[] = [];
    const linkByApp = new Map(Object.values(state.notes).map((link) => [link.appId, link]));
    const usedApple = new Set<string>();
    const usedApp = new Set<string>();
    const trashIds = new Set(appTrashList.map((note) => note.id));
    let completeScan = true;
    for (const note of appleNotes.values()) {
      if (note.meta.bodyError || note.meta.error) completeScan = false;
    }

    for (const app of appNotes.values()) {
      const link = linkByApp.get(app.summary.id);
      if (app.summary.tagIds.includes(this.conflictTagId ?? '')) {
        usedApp.add(app.summary.id);
        if (link) usedApple.add(link.appleId);
        continue;
      }
      usedApp.add(app.summary.id);
      const apple = link ? appleNotes.get(link.appleId) : undefined;
      if (link && apple) {
        usedApple.add(apple.meta.id);
        usedApp.add(app.summary.id);
        if (apple.readOnlyReason) {
          actions.push({ kind: 'link', app, apple });
          continue;
        }
        const appChanged = app.stateHash !== link.lastAppHash;
        const appleChanged = apple.stateHash !== link.lastAppleHash;
        if (appChanged && appleChanged) {
          actions.push({ kind: 'conflict', app, apple });
        } else if (appChanged) {
          actions.push({ kind: 'pushApp', app, apple });
        } else if (appleChanged) {
          actions.push({ kind: 'pullApple', app, apple });
        } else {
          actions.push({ kind: 'link', app, apple });
        }
        continue;
      }
      if (link && !apple) {
        const oldAppleFolderExists = link.appleFolderId
          ? appleTree.folders.some((folder) => folder.id === link.appleFolderId)
          : true;
        if (link.tombstone || !oldAppleFolderExists) {
          actions.push({ kind: 'createApple', app });
        } else {
          actions.push({ kind: 'trashApp', appId: app.summary.id, appleId: link.appleId });
        }
        continue;
      }
      // No mapping: try a unique content match in the same folder before creating a duplicate.
      const key = matchKey(app.summary.title, app.body);
      const candidates = [...appleNotes.values()].filter((note) =>
        !usedApple.has(note.meta.id) && !note.readOnlyReason &&
        note.folderKey === (app.summary.folderId ?? 'root') && matchKey(note.title, note.body) === key,
      );
      if (candidates.length === 1 && candidates[0]) {
        const matched = candidates[0];
        usedApple.add(matched.meta.id);
        usedApp.add(app.summary.id);
        actions.push({ kind: 'link', app, apple: matched });
        continue;
      }
      actions.push({ kind: 'createApple', app });
    }

    for (const apple of appleNotes.values()) {
      if (usedApple.has(apple.meta.id)) continue;
      if (apple.readOnlyReason) {
        usedApple.add(apple.meta.id);
        actions.push({ kind: 'link', app: { summary: { id: '', title: apple.title, folderId: null, tagIds: [], excerpt: '', pinned: false, archived: false, position: '', wordCount: 0, createdAt: '', contentUpdatedAt: '', updatedAt: '' }, body: apple.body, stateHash: '', bodyLoaded: false }, apple });
        continue;
      }
      usedApple.add(apple.meta.id);
      const key = matchKey(apple.title, apple.body);
      const candidates = [...appNotes.values()].filter((app) =>
        !usedApp.has(app.summary.id) && app.summary.folderId === (apple.folderKey === 'root' ? null : apple.folderKey) &&
        matchKey(app.summary.title, app.body) === key,
      );
      if (candidates.length === 1 && candidates[0]) {
        const matched = candidates[0];
        usedApp.add(matched.summary.id);
        actions.push({ kind: 'link', app: matched, apple });
      } else {
        actions.push({ kind: 'createApp', apple });
      }
    }

    for (const appId of trashIds) {
      const link = linkByApp.get(appId);
      if (!link) continue;
      const apple = appleNotes.get(link.appleId);
      if (apple && link.tombstone === 'app-deleted') actions.push({ kind: 'restoreApp', appId, apple });
      else if (apple) actions.push({ kind: 'trashApple', appId, appleId: link.appleId });
      else link.tombstone = 'app-deleted';
    }
    for (const link of Object.values(state.notes)) {
      if (appNotes.has(link.appId) || trashIds.has(link.appId)) continue;
      if (appleNotes.has(link.appleId)) actions.push({ kind: 'trashApple', appId: link.appId, appleId: link.appleId });
      else link.tombstone = 'app-deleted';
    }

    for (const action of actions) {
      if (action.kind === 'conflict') {
        samples.push({ direction: 'conflict', title: action.app.summary.title });
      } else if (action.kind === 'createApp') {
        samples.push({ direction: 'apple-to-app', title: action.apple.title, reason: action.apple.readOnlyReason ?? undefined });
      } else if (action.kind === 'createApple' || action.kind === 'pushApp') {
        samples.push({ direction: 'app-to-apple', title: action.app.summary.title });
      } else if (action.kind === 'link' && action.apple.readOnlyReason) {
        samples.push({ direction: 'read-only', title: action.apple.title, reason: action.apple.readOnlyReason });
        warnings.push(`${action.apple.title}：${action.apple.readOnlyReason}`);
      }
    }
    return { actions, warnings, samples, completeScan };
  }

  private async applyPullApple(
    app: AppNoteSnapshot,
    apple: AppleNoteSnapshot,
    state: AppleNotesState,
    signal?: AbortSignal,
    alreadyCopied = false,
  ): Promise<{ uploadedCount: number; uploadedBytes: number }> {
    if (!app.bodyLoaded) await this.ensureAppBody(app, signal);
    if (!alreadyCopied && hasLossyMarkdown(app.body)) {
      await this.createConflictCopy(
        state,
        `${app.summary.title}（App 格式版本）`,
        app.body,
        app.summary.folderId,
        signal,
      );
    }
    const pulled = await this.prepareAppleForApp(apple, signal);
    const updated = await api.patchNote(app.summary.id, {
      title: pulled.title,
      body: pulled.body,
      folderId: pulled.folderId,
      expectedStateHash: app.stateHash,
    }, signal);
    const link = this.linkFor(state, app.summary.id, apple.meta.id);
    link.appleFolderId = apple.meta.folderId;
    link.lastAppHash = noteStateHash(pulled.title, pulled.folderId, pulled.body);
    link.lastAppUpdatedAt = updated.updatedAt;
    link.lastAppleHash = apple.stateHash;
    link.lastAppleModifiedAt = apple.meta.modifiedAt;
    link.lastAppleMetaHash = appleMetaHash(apple.meta);
    link.tombstone = null;
    return { uploadedCount: pulled.uploadedCount, uploadedBytes: pulled.uploadedBytes };
  }

  /**
   * Apple Notes scripting `delete` semantics have varied across macOS releases. A managed trash
   * folder is unambiguously recoverable and is excluded from the mirror, so deletion never risks
   * permanently losing a note when the user's intent was "move to trash".
   */
  private async ensureManagedTrashFolder(state: AppleNotesState, signal?: AbortSignal): Promise<string | null> {
    if (state.managedTrashFolderId) return state.managedTrashFolderId;
    const tree = await listAppleTree(false, { signal });
    const existing = tree.folders.find(
      (folder) =>
        !folder.parentId &&
        !folder.shared &&
        [MANAGED_TRASH_FOLDER, ...LEGACY_MANAGED_TRASH_FOLDERS].includes(folder.name),
    );
    if (existing) {
      state.managedTrashFolderId = existing.id;
      return existing.id;
    }
    const created = await this.applyAppleSyncAsync([{
      key: 'managed-trash',
      type: 'createFolder',
      name: MANAGED_TRASH_FOLDER,
      parentId: null,
    }], signal);
    if (created.outcomes[0]?.ok && created.outcomes[0].id) {
      state.managedTrashFolderId = created.outcomes[0].id;
      return created.outcomes[0].id;
    }
    return null;
  }

  private async applyOutcome(
    outcome: Awaited<ReturnType<AppleNotesSyncEngine['collect']>>,
    state: AppleNotesState,
    namespace: SyncNamespace,
    result: AppleNotesResult,
  ): Promise<{
    state: AppleNotesState;
    trashedAppNotes: number;
    trashedAppleNotes: number;
    createdFolders: number;
    updatedFolders: number;
    deletedFolders: number;
    uploadedAttachments: number;
    downloadedAttachments: number;
    uploadedBytes: number;
    downloadedBytes: number;
    errors: AppleNotesError[];
  }> {
    const signal = this.controller?.signal;
    let trashedAppNotes = 0;
    let trashedAppleNotes = 0;
    const createdFolders = outcome.folderCounts.createAppFolders + outcome.folderCounts.createAppleFolders;
    const updatedFolders = outcome.folderCounts.moveAppFolders + outcome.folderCounts.moveAppleFolders;
    let deletedFolders = outcome.folderCounts.deleteAppFolders + outcome.folderCounts.deleteAppleFolders;
    let uploadedAttachments = 0;
    let downloadedAttachments = 0;
    let uploadedBytes = 0;
    let downloadedBytes = 0;
    const errors: AppleNotesError[] = [];

    const appStateById = new Map<string, AppNoteSnapshot>();
    const appleStateById = new Map<string, AppleNoteSnapshot>();
    for (const action of outcome.actions) {
      if ('app' in action && action.app.summary.id) appStateById.set(action.app.summary.id, action.app);
      if ('apple' in action) appleStateById.set(action.apple.meta.id, action.apple);
    }

    const createApps = outcome.actions.filter((action): action is Extract<NoteAction, { kind: 'createApp' }> => action.kind === 'createApp');
    for (let i = 0; i < createApps.length; i += 10) {
      const batch = createApps.slice(i, i + 10);
      const items: Array<Record<string, unknown>> = [];
      const prepared: Array<{ action: Extract<NoteAction, { kind: 'createApp' }>; body: string; title: string }> = [];
      for (const action of batch) {
        try {
          const pulled = await this.prepareAppleForApp(action.apple, signal);
          uploadedAttachments += pulled.uploadedCount;
          uploadedBytes += pulled.uploadedBytes;
          const folderId = action.apple.folderKey === 'root' || action.apple.folderKey.startsWith('apple:')
            ? null
            : action.apple.folderKey;
          items.push({
            id: randomUUID(),
            title: pulled.title,
            body: pulled.body,
            folderId,
            createdAt: action.apple.meta.createdAt ?? undefined,
          });
          prepared.push({ action, body: pulled.body, title: pulled.title });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ code: 'PULL_ATTACHMENT', message: `${action.apple.title}：${message}` });
          this.markReadOnly(state, action.apple, message);
        }
      }
      if (items.length === 0) continue;
      try {
        const created = await api.createNotesBatch(items, signal);
        for (const item of created.items) {
          const entry = prepared[item.index];
          if (!entry) continue;
          if (!item.ok || !item.note) {
            errors.push({ code: 'CREATE_NOTE', message: item.error?.message ?? '创建笔记失败' });
            continue;
          }
          this.linkCreatedApp(state, entry.action.apple, item.note.id, entry.title, entry.body, item.note.folderId);
          result.createdAppNotes++;
        }
      } catch (error) {
        errors.push({ code: 'CREATE_NOTE', message: error instanceof Error ? error.message : String(error) });
      }
      saveSyncState(state);
    }

    const appleOps: AppleApplyOp[] = [];
    const appleOpMeta = new Map<string, { action: NoteAction; app: AppNoteSnapshot; apple?: AppleNoteSnapshot }>();
    for (const action of outcome.actions) {
      if (action.kind === 'createApple' || action.kind === 'pushApp' || action.kind === 'conflict') {
        let app: AppNoteSnapshot | undefined;
        let apple: AppleNoteSnapshot | undefined;
        if (action.kind === 'createApple') app = action.app;
        else if (action.kind === 'pushApp') { app = action.app; apple = action.apple; }
        else {
          const winner = this.conflictWinner(action.app, action.apple);
          app = winner === 'app' ? action.app : undefined;
          apple = winner === 'apple' ? action.apple : action.apple;
          if (winner === 'apple') {
            // Apple wins: create a conflict copy of the app version, then pull Apple.
            if (!action.app.bodyLoaded) await this.ensureAppBody(action.app, signal);
            await this.createConflictCopy(state, action.app.summary.title, action.app.body, action.app.summary.folderId, signal);
            try {
              const pulled = await this.applyPullApple(action.app, action.apple, state, signal, true);
              uploadedAttachments += pulled.uploadedCount;
              uploadedBytes += pulled.uploadedBytes;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              errors.push({ code: 'PULL_NOTE', message: `${action.apple.title}：${message}` });
              this.markReadOnly(state, action.apple, message);
            }
            continue;
          }
          // App wins: preserve the Apple version, then push the app version.
          try {
            const copy = await this.prepareAppleForApp(action.apple, signal);
            uploadedAttachments += copy.uploadedCount;
            uploadedBytes += copy.uploadedBytes;
            await this.createConflictCopy(state, `${action.apple.title}（Apple 版本）`, copy.body, action.app.summary.folderId, signal);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ code: 'CONFLICT_COPY', message });
            this.markReadOnly(state, action.apple, message);
            continue;
          }
          (action as { kind: NoteAction['kind'] }).kind = 'pushApp';
          app = action.app;
          apple = action.apple;
        }
        if (!app) continue;
        try {
          if (!app.bodyLoaded) await this.ensureAppBody(app, signal);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ code: 'READ_APP_NOTE', message: `${app.summary.title}：${message}` });
          this.markAppReadOnly(state, app, message);
          continue;
        }
        let prepared: Awaited<ReturnType<AppleNotesSyncEngine['prepareAppForApple']>>;
        try {
          prepared = await this.prepareAppForApple(app, signal);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ code: 'PUSH_ATTACHMENT', message: `${app.summary.title}：${message}` });
          this.markAppReadOnly(state, app, message);
          continue;
        }
        downloadedAttachments += prepared.attachmentCount;
        downloadedBytes += prepared.attachmentBytes;
        const folderId = this.appleFolderIdForAppFolder(app.summary.folderId, state);
        if (!folderId && !state.rootAppleFolderId) {
          errors.push({ code: 'NO_FOLDER', message: `${app.summary.title}：找不到目标备忘录目录` });
          continue;
        }
        const key = app.summary.id;
        appleOpMeta.set(key, { action, app, apple });
        if (action.kind === 'createApple') {
          appleOps.push({
            key, type: 'createNote', folderId: folderId ?? state.rootAppleFolderId,
            title: app.summary.title, html: prepared.html, attachments: prepared.attachments,
          });
        } else {
          appleOps.push({
            key, type: 'updateNote', id: apple?.meta.id, folderId: folderId ?? state.rootAppleFolderId,
            title: app.summary.title, html: prepared.html, attachments: prepared.attachments,
          });
        }
      } else if (action.kind === 'pullApple') {
        try {
          const pulled = await this.applyPullApple(action.app, action.apple, state, signal);
          result.updatedAppNotes++;
          uploadedAttachments += pulled.uploadedCount;
          uploadedBytes += pulled.uploadedBytes;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({ code: 'PULL_NOTE', message: `${action.apple.title}：${message}` });
          this.markReadOnly(state, action.apple, message);
        }
      } else if (action.kind === 'trashApp') {
        try {
          await api.trashNote(action.appId, signal);
          trashedAppNotes++;
          const link = state.notes[action.appleId];
          if (link) link.tombstone = 'apple-deleted';
        } catch (error) {
          errors.push({ code: 'TRASH_APP', message: error instanceof Error ? error.message : String(error) });
        }
      } else if (action.kind === 'trashApple') {
        try {
          const trashFolderId = await this.ensureManagedTrashFolder(state, signal);
          if (!trashFolderId) throw new Error('无法创建备忘录回收站目录');
          const moved = await this.applyAppleSyncAsync([{
            key: action.appleId,
            type: 'moveNote',
            id: action.appleId,
            folderId: trashFolderId,
          }], signal);
          if (!moved.outcomes[0]?.ok) {
            throw new Error(moved.outcomes[0]?.error ?? '移动到备忘录回收站失败');
          }
          trashedAppleNotes++;
          const link = state.notes[action.appleId];
          if (link) link.tombstone = 'app-deleted';
        } catch (error) {
          state.managedTrashFolderId = null;
          errors.push({ code: 'TRASH_APPLE', message: error instanceof Error ? error.message : String(error) });
        }
      } else if (action.kind === 'restoreApp') {
        try {
          const restored = await api.restoreNote(action.appId, signal);
          const link = state.notes[action.apple.meta.id];
          if (link) {
            link.tombstone = null;
            link.lastAppUpdatedAt = restored.updatedAt;
          }
        } catch (error) {
          errors.push({ code: 'RESTORE_APP', message: error instanceof Error ? error.message : String(error) });
        }
      } else if (action.kind === 'link') {
        if (action.apple.readOnlyReason) {
          this.markReadOnly(state, action.apple, action.apple.readOnlyReason);
          if (action.app.summary.id) await this.tagAppReadOnly(state, action.app, signal);
          continue;
        }
        const link = this.linkFor(state, action.app.summary.id, action.apple.meta.id);
        link.appleFolderId = action.apple.meta.folderId;
        link.lastAppleHash = action.apple.stateHash;
        link.lastAppHash = action.app.stateHash;
        link.lastAppleModifiedAt = action.apple.meta.modifiedAt;
        link.lastAppleMetaHash = appleMetaHash(action.apple.meta);
        link.lastAppUpdatedAt = action.app.summary.updatedAt;
        link.tombstone = null;
        link.readOnlyReason = null;
        delete state.readOnly[action.apple.meta.id];
        delete state.readOnly[action.app.summary.id];
      }
    }

    // Execute Apple-side create/update/push in bounded batches.
    for (let i = 0; i < appleOps.length; i += 5) {
      const batch = appleOps.slice(i, i + 5);
      try {
        const applied = await this.applyAppleSyncAsync(batch, signal);
        for (const outcomeItem of applied.outcomes) {
          const meta = appleOpMeta.get(outcomeItem.key);
          if (!meta) continue;
          if (!outcomeItem.ok || !outcomeItem.id) {
            errors.push({ code: 'APPLE_WRITE', message: outcomeItem.error ?? '备忘录写入失败' });
            continue;
          }
          const app = meta.app;
          const attachmentErrors = (outcomeItem.attachmentIds ?? [])
            .filter((value): value is { error: string } => typeof value === 'object' && value !== null && 'error' in value);
          if (attachmentErrors.length > 0) {
            const message = `附件写入失败：${attachmentErrors.map((value) => value.error).join('；')}`;
            errors.push({ code: 'APPLE_ATTACHMENT', message: `${app.summary.title}：${message}` });
            this.markAppReadOnly(state, app, message);
          }
          for (const [appleId, candidate] of Object.entries(state.notes)) {
            if (candidate.appId === app.summary.id) delete state.notes[appleId];
          }
          const link = this.linkFor(state, app.summary.id, outcomeItem.id);
          link.lastAppHash = app.stateHash;
          link.lastAppUpdatedAt = app.summary.updatedAt;
          link.appleFolderId = this.appleFolderIdForAppFolder(app.summary.folderId, state);
          link.lastAppleHash = app.stateHash;
          link.lastAppleModifiedAt = new Date().toISOString();
          link.lastAppleMetaHash = null;
          link.tombstone = null;
          link.readOnlyReason = null;
          delete state.readOnly[app.summary.id];
          delete state.readOnly[outcomeItem.id];
          if (meta.action.kind === 'createApple') result.createdAppleNotes++;
          else result.updatedAppleNotes++;
        }
      } catch (error) {
        errors.push({ code: 'APPLE_WRITE', message: error instanceof Error ? error.message : String(error) });
      }
      saveSyncState(state);
    }

    // Refresh Apple hashes/ids after writes. A created note's Apple body is normalised by Notes,
    // so using the app hash as the Apple baseline would create a false change on the next run.
    const affectedAppleIds = [...appleOpMeta.values()].map((entry) => state.notes[entry.app.summary.id]?.appleId).filter(Boolean) as string[];
    if (affectedAppleIds.length > 0) {
      try {
        const refreshed = await readAppleNotes(affectedAppleIds, { signal });
        for (const meta of refreshed.notes) {
          const link = Object.values(state.notes).find((candidate) => candidate.appleId === meta.id);
          if (!link) continue;
          const snapshot = await this.snapshotAppleNote(meta, state, signal);
          link.lastAppleHash = snapshot.stateHash;
          link.lastAppleModifiedAt = meta.modifiedAt;
          link.lastAppleMetaHash = appleMetaHash(meta);
        }
      } catch (error) {
        errors.push({ code: 'APPLE_RECONCILE', message: error instanceof Error ? error.message : String(error) });
      }
    }

    // Cleanup folders that no longer exist on one side. Only delete an Apple folder when it is
    // empty, so a partial scan can never cascade into note loss.
    try {
      const [latestApple, latestApp] = await Promise.all([
        listAppleTree(false, { signal }),
        api.getTree(signal),
      ]);
      for (const [appleId, link] of Object.entries(state.folders)) {
        const appleExists = latestApple.folders.some((folder) => folder.id === appleId);
        const appExists = latestApp.folders.some((folder) => folder.id === link.appId);
        if (!appleExists) {
          try { await api.deleteFolder(link.appId, signal); } catch { /* already gone */ }
          delete state.folders[appleId];
          deletedFolders++;
        } else if (!appExists) {
          const hasNotes = latestApple.notes.some((note) => note.folderId === appleId);
          const hasChildren = latestApple.folders.some((folder) => folder.parentId === appleId);
          if (!hasNotes && !hasChildren) {
            await this.applyAppleSyncAsync([{ key: appleId, type: 'deleteFolder', id: appleId }], signal);
            delete state.folders[appleId];
            deletedFolders++;
          } else {
            errors.push({ code: 'FOLDER_NOT_EMPTY', message: `备忘录目录仍有内容，未自动删除：${link.lastAppleName}` });
          }
        }
      }
    } catch (error) {
      errors.push({ code: 'FOLDER_CLEANUP', message: error instanceof Error ? error.message : String(error) });
    }

    saveSyncState({ ...state, namespace });
    return {
      state,
      trashedAppNotes,
      trashedAppleNotes,
      createdFolders,
      updatedFolders,
      deletedFolders,
      uploadedAttachments,
      downloadedAttachments,
      uploadedBytes,
      downloadedBytes,
      errors,
    };
  }

  private conflictWinner(app: AppNoteSnapshot, apple: AppleNoteSnapshot): 'app' | 'apple' {
    const appTime = Date.parse(app.summary.updatedAt);
    const appleTime = Date.parse(apple.meta.modifiedAt ?? '');
    if (!Number.isFinite(appTime)) return 'app';
    if (!Number.isFinite(appleTime)) return 'app';
    return appTime + TWO_SECONDS >= appleTime ? 'app' : 'apple';
  }

  private appleFolderIdForAppFolder(folderId: string | null, state: AppleNotesState): string | null {
    if (!folderId) return state.rootAppleFolderId;
    return Object.values(state.folders).find((link) => link.appId === folderId)?.appleId ?? state.rootAppleFolderId;
  }

  private linkFor(state: AppleNotesState, appId: string, appleId: string): NoteLink {
    const existing = state.notes[appleId];
    if (existing) return existing;
    const link: NoteLink = {
      appleId, appId,
      appleFolderId: null,
      lastAppleHash: '',
      lastAppHash: '',
      lastAppleModifiedAt: null,
      lastAppleMetaHash: null,
      lastAppUpdatedAt: '',
      tombstone: null,
      readOnlyReason: null,
    };
    state.notes[appleId] = link;
    return link;
  }

  private linkCreatedApp(
    state: AppleNotesState,
    apple: AppleNoteSnapshot,
    appId: string,
    title: string,
    body: string,
    folderId: string | null,
  ): void {
    for (const [appleId, candidate] of Object.entries(state.notes)) {
      if (candidate.appId === appId) delete state.notes[appleId];
    }
    const link = this.linkFor(state, appId, apple.meta.id);
    link.appleFolderId = apple.meta.folderId;
    link.lastAppleHash = apple.stateHash;
    link.lastAppHash = noteStateHash(title, folderId, body);
    link.lastAppleModifiedAt = apple.meta.modifiedAt;
    link.lastAppleMetaHash = appleMetaHash(apple.meta);
    link.lastAppUpdatedAt = new Date().toISOString();
    link.tombstone = null;
    link.readOnlyReason = null;
    delete state.readOnly[appId];
    delete state.readOnly[apple.meta.id];
  }

  private async ensureAppBody(app: AppNoteSnapshot, signal?: AbortSignal): Promise<void> {
    if (app.bodyLoaded) return;
    const payload = await api.readBodies([app.summary.id], signal);
    const body = payload.items[0];
    if (!body) throw new Error('无法读取笔记正文');
    app.body = body.body;
    app.stateHash = body.stateHash;
    app.summary = body;
    app.bodyLoaded = true;
  }

  private async prepareAppleForApp(
    apple: AppleNoteSnapshot,
    signal?: AbortSignal,
  ): Promise<{ title: string; body: string; folderId: string | null; uploadedCount: number; uploadedBytes: number }> {
    if (apple.readOnlyReason) throw new Error(apple.readOnlyReason);
    let body = apple.body;
    let uploadedCount = 0;
    let uploadedBytes = 0;
    for (const attachment of apple.pending) {
      let url = this.attachmentCacheUrl(apple, attachment);
      if (!url) {
        const bytes = attachment.bytes ?? (attachment.path ? new Uint8Array(await readFile(attachment.path)) : null);
        if (!bytes) throw new Error(`附件不可用：${attachment.filename}`);
        const uploaded = await api.uploadAttachment(bytes, attachment.filename, attachment.mime, null, signal);
        url = uploaded.url;
        uploadedCount++;
        uploadedBytes += bytes.byteLength;
      }
      body = body.split(attachment.placeholder).join(url);
    }
    if (body.length > 2_000_000) throw new Error('正文超过 AiMD 2MB 限制');
    return {
      title: apple.title,
      body,
      folderId: apple.folderKey === 'root' ? null : apple.folderKey,
      uploadedCount,
      uploadedBytes,
    };
  }

  private attachmentCacheUrl(_apple: AppleNoteSnapshot, _attachment: PendingAttachment): string | null {
    return null;
  }

  private async prepareAppForApple(
    app: AppNoteSnapshot,
    signal?: AbortSignal,
  ): Promise<{
    html: string;
    attachments: Array<{ filename: string; base64: string }>;
    attachmentCount: number;
    attachmentBytes: number;
  }> {
    const ids = appAttachmentIds(app.body);
    const dataUris = new Map<string, string>();
    const attachments: Array<{ filename: string; base64: string }> = [];
    let attachmentCount = 0;
    let attachmentBytes = 0;
    for (const id of ids) {
      const downloaded = await api.downloadAttachment(id, signal);
      attachmentCount++;
      attachmentBytes += downloaded.bytes.byteLength;
      const mime = downloaded.mime?.split(';', 1)[0]?.trim() || 'application/octet-stream';
      const filename = safeFilename(downloaded.filename ?? `attachment-${id}.${mime.split('/')[1] ?? 'bin'}`, 'attachment');
      if (isImageMime(mime)) {
        dataUris.set(id, bytesToDataUri(downloaded.bytes, mime));
      } else {
        attachments.push({ filename, base64: bytesToBase64(downloaded.bytes) });
      }
    }
    let html = markdownToHtml(app.body);
    html = inlineImageDataUris(html, dataUris);
    html = html.replace(/<a\b[^>]*href=["'][^"']*\/api\/attachments\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi, '$1');
    return { html, attachments, attachmentCount, attachmentBytes };
  }

  private async createConflictCopy(
    state: AppleNotesState,
    title: string,
    body: string,
    folderId: string | null,
    signal?: AbortSignal,
  ): Promise<void> {
    const stamp = new Date().toLocaleString('zh-CN', { hour12: false });
    const created = await api.createNote({
      title: `${title}（冲突 ${stamp}）`.slice(0, 200),
      body,
      folderId,
      tagIds: this.conflictTagId ? [this.conflictTagId] : [],
    }, signal);
    void created;
    void state;
  }

  private markAppReadOnly(state: AppleNotesState, app: AppNoteSnapshot, reason: string): void {
    const link = Object.values(state.notes).find((candidate) => candidate.appId === app.summary.id);
    if (link) link.readOnlyReason = reason;
    state.readOnly[app.summary.id] = {
      reason,
      appleId: link?.appleId ?? '',
      appId: app.summary.id,
      since: new Date().toISOString(),
    };
    void this.tagAppReadOnly(state, app);
  }

  private markReadOnly(state: AppleNotesState, apple: AppleNoteSnapshot, reason: string): void {
    state.readOnly[apple.meta.id] = {
      reason,
      appleId: apple.meta.id,
      appId: Object.values(state.notes).find((link) => link.appleId === apple.meta.id)?.appId ?? '',
      since: new Date().toISOString(),
    };
    const link = Object.values(state.notes).find((candidate) => candidate.appleId === apple.meta.id);
    if (link) link.readOnlyReason = reason;
  }

  private async tagAppReadOnly(state: AppleNotesState, app: AppNoteSnapshot, signal?: AbortSignal): Promise<void> {
    if (!this.readOnlyTagId || !app.summary.id) return;
    const link = Object.values(state.notes).find((candidate) => candidate.appId === app.summary.id);
    const tags = [...new Set([...app.summary.tagIds, this.readOnlyTagId])];
    try {
      await api.patchNote(app.summary.id, { tagIds: tags }, signal);
    } catch {
      /* visibility tag is best-effort; the local readOnly record still blocks writes */
    }
    if (link) link.readOnlyReason = state.readOnly[app.summary.id]?.reason ?? link.readOnlyReason;
  }
}

class SafetyAbort extends Error {
  readonly kind: 'mass-deletion' | 'scan-incomplete';
  constructor(kind: 'mass-deletion' | 'scan-incomplete', message: string) {
    super(message);
    this.name = 'SafetyAbort';
    this.kind = kind;
  }
}
