import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { DEFAULT_HOTKEY, EDITOR_MODES, STAMP_FORMATS, THEMES, type SettingsDto } from '@aimarkdown/shared';
import { formatHotkey, getBridge, isDesktop, platform } from '../lib/platform.js';
import { describeError } from '../lib/api.js';
import { AppleNotesSettingsSection } from './AppleNotesSettingsSection.js';
import type { AppleNotesController } from '../hooks/useAppleNotes.js';

/** Preferences dialog. Values are persisted through the API, which writes the workspace CRDT. */

export interface SettingsDialogProps {
  settings: SettingsDto;
  onSave(patch: Partial<SettingsDto>): Promise<unknown>;
  onClose(): void;
  appleNotes?: AppleNotesController;
}

export function SettingsDialog({ settings, onSave, onClose, appleNotes }: SettingsDialogProps) {
  const [draft, setDraft] = useState<SettingsDto>(settings);
  const [hotkeyState, setHotkeyState] = useState<{ accelerator: string; registered: boolean; error?: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desktop = isDesktop();

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void getBridge()
      ?.getHotkeyState()
      .then((state) => {
        if (!cancelled) setHotkeyState(state);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, settings.hotkey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const persist = async (patch: Partial<SettingsDto>) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(patch);
      setDraft((prev) => ({ ...prev, ...patch }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };

  const applyHotkey = async (accelerator: string) => {
    setDraft((prev) => ({ ...prev, hotkey: accelerator }));
    if (desktop) {
      const result = await getBridge()?.setHotkey(accelerator);
      setHotkeyState({
        accelerator,
        registered: Boolean(result?.ok),
        error: result && !result.ok ? (result.error ?? '注册失败') : undefined,
      });
    }
    await persist({ hotkey: accelerator });
  };

  const defaultHotkey = DEFAULT_HOTKEY[platform() === 'darwin' ? 'darwin' : platform() === 'win32' ? 'win32' : 'linux'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="settings-dialog">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">设置</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-hover" aria-label="关闭">
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-auto px-4 py-4 text-sm">
          {error && (
            <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger">{error}</div>
          )}

          <Row label="编辑器视图">
            <div className="flex gap-1">
              {EDITOR_MODES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void persist({ editorMode: value })}
                  className={`rounded border px-2 py-1 text-xs ${
                    draft.editorMode === value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-muted hover:bg-hover'
                  }`}
                >
                  {value === 'split' ? '分栏' : value === 'edit' ? '编辑' : '预览'}
                </button>
              ))}
            </div>
          </Row>

          <Row label="主题">
            <div className="flex gap-1">
              {THEMES.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => void persist({ theme: value })}
                  className={`rounded border px-2 py-1 text-xs ${
                    draft.theme === value
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border text-muted hover:bg-hover'
                  }`}
                >
                  {value === 'light' ? '浅色' : value === 'dark' ? '深色' : '跟随系统'}
                </button>
              ))}
            </div>
          </Row>

          <Row label={`字号 ${draft.fontSize}px`}>
            <input
              type="range"
              min={10}
              max={24}
              value={draft.fontSize}
              onChange={(event) => setDraft((prev) => ({ ...prev, fontSize: Number(event.target.value) }))}
              onMouseUp={() => void persist({ fontSize: draft.fontSize })}
              onTouchEnd={() => void persist({ fontSize: draft.fontSize })}
              className="w-40"
            />
          </Row>

          <Row label="速记时间戳">
            <select
              value={draft.stampFormat}
              onChange={(event) => void persist({ stampFormat: event.target.value as SettingsDto['stampFormat'] })}
              className="rounded border border-border bg-background px-2 py-1 text-xs"
            >
              {STAMP_FORMATS.map((value) => (
                <option key={value} value={value}>
                  {value === 'heading' ? '## 日期 时间' : value === 'bullet' ? '- [时间]' : '不加'}
                </option>
              ))}
            </select>
          </Row>

          <div className="border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium text-muted">桌面端</div>

            <Row label="全局快捷键">
              <div className="flex items-center gap-2">
                <input
                  value={draft.hotkey}
                  onChange={(event) => setDraft((prev) => ({ ...prev, hotkey: event.target.value }))}
                  onBlur={() => void applyHotkey(draft.hotkey)}
                  className="w-40 rounded border border-border bg-background px-2 py-1 text-xs"
                  data-testid="hotkey-input"
                />
                <button
                  type="button"
                  onClick={() => void applyHotkey(defaultHotkey)}
                  className="rounded border border-border px-2 py-1 text-xs text-muted hover:bg-hover"
                >
                  恢复默认
                </button>
              </div>
            </Row>

            {hotkeyState && !hotkeyState.registered && (
              <div className="ml-2 flex items-start gap-1.5 rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  快捷键 <code>{formatHotkey(hotkeyState.accelerator)}</code> 注册失败
                  {hotkeyState.error ? `（${hotkeyState.error}）` : ''}
                  ，可能被其他应用占用，请换一个组合。
                </span>
              </div>
            )}
            {hotkeyState?.registered && (
              <div className="ml-2 text-[11px] text-success">
                已注册 {formatHotkey(hotkeyState.accelerator)}
              </div>
            )}
            {!desktop && (
              <div className="ml-2 text-[11px] text-muted">
                全局快捷键仅在桌面客户端生效；当前预览效果 {formatHotkey(draft.hotkey)}。
              </div>
            )}

            <Toggle
              label="失焦时自动隐藏速记窗口"
              checked={draft.hideOnBlur}
              disabled={!desktop}
              onChange={(value) => void persist({ hideOnBlur: value })}
            />
            <Toggle
              label="关闭窗口后驻留托盘"
              checked={draft.minimizeToTray}
              disabled={!desktop}
              onChange={(value) => void persist({ minimizeToTray: value })}
            />
            <Toggle
              label="登录时启动"
              checked={draft.launchAtLogin}
              disabled={!desktop}
              onChange={(value) => void persist({ launchAtLogin: value })}
            />
          </div>

          {appleNotes && <AppleNotesSettingsSection controller={appleNotes} />}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          {saving && <span className="text-xs text-muted">保存中…</span>}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-hover"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-muted">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <label className={`mt-2 flex items-center justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-xs">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
    </label>
  );
}
