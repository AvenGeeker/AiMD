import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Command,
  NotebookPen,
  Palette,
  PenLine,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  DEFAULT_HOTKEY,
  DEFAULT_MAIN_WINDOW_HOTKEY,
  DEFAULT_FAVORITE_HOTKEY,
  EDITOR_MODES,
  STAMP_FORMATS,
  THEMES,
  type SettingsDto,
} from '@aimarkdown/shared';
import {
  formatHotkey,
  getBridge,
  isDesktop,
  platform,
  type HotkeyState,
  type HotkeyStates,
  type HotkeyTarget,
} from '../lib/platform.js';
import { describeError } from '../lib/api.js';
import { AppleNotesSettingsSection } from './AppleNotesSettingsSection.js';
import { AiSettingsSection } from './AiSettingsSection.js';
import { HotkeyRecorder } from './HotkeyRecorder.js';
import { ToggleSwitch } from './ui/ToggleSwitch.js';
import { SegmentedControl } from './ui/SegmentedControl.js';
import type { AppleNotesController } from '../hooks/useAppleNotes.js';

/** Preferences dialog. Values are persisted through the API, which writes the workspace CRDT. */

export interface SettingsDialogProps {
  settings: SettingsDto;
  onSave(patch: Partial<SettingsDto>): Promise<unknown>;
  onClose(): void;
  appleNotes?: AppleNotesController;
  initialTab?: SettingsTab;
}

export type SettingsTab = 'appearance' | 'editor' | 'capture' | 'ai' | 'apple';

const THEME_OPTIONS = THEMES.map((value) => ({
  value,
  label: value === 'light' ? '浅色' : value === 'dark' ? '深色' : '跟随系统',
}));

const EDITOR_MODE_OPTIONS = EDITOR_MODES.map((value) => ({
  value,
  label: value === 'split' ? '分栏' : value === 'edit' ? '编辑' : '预览',
}));

/** Flat index powering the settings search: group id → owning tab + match keywords. */
const SETTINGS_INDEX: Array<{ tab: SettingsTab; groupId: string; title: string; keywords: string }> = [
  { tab: 'appearance', groupId: 'theme', title: '主题', keywords: 'theme light dark 浅色 深色 跟随系统 外观' },
  { tab: 'editor', groupId: 'editor-mode', title: '编辑器视图', keywords: '分栏 编辑 预览 mode split preview' },
  { tab: 'editor', groupId: 'font-size', title: '正文字号', keywords: '字号 字体 font size' },
  { tab: 'capture', groupId: 'stamp', title: '速记时间戳', keywords: '时间戳 格式 stamp format' },
  { tab: 'capture', groupId: 'hotkeys', title: '桌面快捷键', keywords: '快捷键 键盘 hotkey keyboard 速记窗口 主窗口 收藏' },
  { tab: 'capture', groupId: 'window', title: '窗口行为', keywords: '托盘 登录启动 失焦 隐藏 tray login blur' },
  { tab: 'ai', groupId: 'ai', title: 'AI 助手', keywords: 'ai 总结 标签 回填 模型 api key' },
  { tab: 'apple', groupId: 'apple', title: 'macOS 备忘录', keywords: 'apple notes 备忘录 镜像 同步' },
];

export function SettingsDialog({ settings, onSave, onClose, appleNotes, initialTab = 'appearance' }: SettingsDialogProps) {
  const [draft, setDraft] = useState<SettingsDto>(settings);
  const [hotkeyStates, setHotkeyStates] = useState<HotkeyStates | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [search, setSearch] = useState('');
  const [scrollToGroup, setScrollToGroup] = useState<string | null>(null);
  const desktop = isDesktop();

  const searchQuery = search.trim().toLowerCase();
  const searchMatches = searchQuery
    ? SETTINGS_INDEX.filter(
        (item) =>
          item.title.toLowerCase().includes(searchQuery) || item.keywords.toLowerCase().includes(searchQuery),
      )
    : [];

  useEffect(() => {
    if (!scrollToGroup) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`group-${scrollToGroup}`)?.scrollIntoView({ block: 'start' });
      setScrollToGroup(null);
    }, 40);
    return () => window.clearTimeout(timer);
  }, [scrollToGroup, tab]);

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    if (!desktop) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    void (async () => {
      if (bridge.getHotkeyStates) {
        const states = await bridge.getHotkeyStates();
        if (!cancelled) setHotkeyStates(states);
        return;
      }
      const legacy = await bridge.getHotkeyState?.();
      if (!cancelled && legacy) {
        setHotkeyStates({
          capture: legacy,
          main: { accelerator: '', registered: false, error: '当前桌面版本不支持主窗口快捷键' },
          favorite: { accelerator: '', registered: false, error: '当前桌面版本不支持收藏快捷键' },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop, settings.hotkey, settings.mainWindowHotkey, settings.favoriteHotkey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'apple' && !appleNotes?.available) setTab('appearance');
  }, [appleNotes?.available, tab]);

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

  const applyHotkey = async (target: HotkeyTarget, accelerator: string) => {
    const patch =
      target === 'capture'
        ? { hotkey: accelerator }
        : target === 'favorite'
          ? { favoriteHotkey: accelerator }
          : { mainWindowHotkey: accelerator };
    setDraft((prev) => ({ ...prev, ...patch }));
    if (desktop) {
      const result = await getBridge()?.setHotkey(target, accelerator);
      const state: HotkeyState = {
        accelerator,
        registered: Boolean(result?.ok),
        error: result && !result.ok ? (result.error ?? '注册失败') : undefined,
      };
      setHotkeyStates((prev) => ({
        capture: prev?.capture ?? { accelerator: '', registered: false },
        main: prev?.main ?? { accelerator: '', registered: false },
        favorite: prev?.favorite ?? { accelerator: '', registered: false },
        [target]: state,
      }));
    }
    await persist(patch);
  };

  const currentPlatform = platform() === 'darwin' ? 'darwin' : platform() === 'win32' ? 'win32' : 'linux';
  const defaultHotkey = DEFAULT_HOTKEY[currentPlatform];
  const defaultMainHotkey = DEFAULT_MAIN_WINDOW_HOTKEY;
  const defaultFavoriteHotkey = DEFAULT_FAVORITE_HOTKEY;

  const hotkeyWarning = (label: string, state: HotkeyState | undefined) =>
    state && !state.registered ? (
      <div className="flex items-start gap-2 rounded-lg border border-warning/35 bg-warning-soft px-3 py-2 text-[10.5px] leading-5 text-warning">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>
          {label} <code>{formatHotkey(state.accelerator)}</code> 注册失败
          {state.error ? `（${state.error}）` : ''}，可能被其他应用占用，请换一个组合。
        </span>
      </div>
    ) : null;

  const navItems: Array<{ value: SettingsTab; label: string; icon: typeof Palette }> = [
    { value: 'appearance', label: '外观', icon: Palette },
    { value: 'editor', label: '编辑', icon: PenLine },
    { value: 'capture', label: '速记与桌面', icon: Command },
    { value: 'ai', label: 'AI 助手', icon: Sparkles },
    ...(appleNotes?.available
      ? [{ value: 'apple' as const, label: 'macOS 备忘录', icon: NotebookPen }]
      : []),
  ];

  return (
    <div className="dialog-overlay" data-testid="settings-dialog">
      <div className="dialog-panel settings-panel flex flex-col">
        <div className="dialog-header shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-subtle bg-panel text-muted">
              <Settings2 size={16} />
            </span>
            <div>
              <h2 className="text-[13px] font-semibold">设置</h2>
              <p className="mt-0.5 text-[10px] text-muted">所有改动会自动同步到你的账号</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="icon-button" aria-label="关闭">
            <X size={17} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-[200px] shrink-0 border-r border-border-subtle bg-panel/55 p-2.5 md:block" aria-label="设置分类">
            <div className="sidebar-search mb-2 flex items-center gap-2 px-2.5">
              <Search size={13} className="shrink-0 text-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索设置"
                aria-label="搜索设置"
                className="h-7 min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted/65"
                data-testid="settings-search"
              />
            </div>
            {navItems
              .filter((item) => !searchQuery || item.label.toLowerCase().includes(searchQuery))
              .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setTab(item.value)}
                  className={`nav-item mb-0.5 ${tab === item.value ? 'is-active' : ''}`}
                  data-testid={`settings-tab-${item.value}`}
                >
                  <Icon size={15} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-3 py-2 md:hidden">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setTab(item.value)}
                    className={`chip shrink-0 !min-h-8 ${tab === item.value ? 'is-active' : ''}`}
                  >
                    <Icon size={12} />
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">
              <div className="settings-content">
              {searchQuery && (
                <div className="space-y-1.5">
                  <div className="section-label !px-0 pb-1">搜索「{search.trim()}」</div>
                  {searchMatches.length === 0 && (
                    <div className="rounded-lg bg-panel/60 px-3 py-6 text-center text-[11px] text-muted">
                      没有匹配的设置项
                    </div>
                  )}
                  {searchMatches.map((item) => (
                    <button
                      key={`${item.tab}:${item.groupId}`}
                      type="button"
                      className="nav-item"
                      onClick={() => {
                        setTab(item.tab);
                        setScrollToGroup(item.groupId);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-left">{item.title}</span>
                      <span className="shrink-0 text-[10px] text-muted/70">
                        {navItems.find((nav) => nav.value === item.tab)?.label ?? ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!searchQuery && (
                <>
              {error && (
                <div className="mb-4 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-[11px] text-danger">
                  {error}
                </div>
              )}

              {tab === 'appearance' && (
                <div className="space-y-4">
                  <SettingGroup id="theme" title="主题">
                    <SegmentedControl
                      value={draft.theme}
                      options={THEME_OPTIONS}
                      onChange={(value) => void persist({ theme: value })}
                      ariaLabel="主题"
                      testIdPrefix="settings-theme"
                    />
                    <div className="theme-preview mt-4 overflow-hidden rounded-xl border border-border-subtle">
                      <div className="grid h-36 grid-cols-[72px_1fr]">
                        <div className="border-r border-border-subtle bg-surface p-2.5">
                          <div className="h-1.5 w-9 rounded-full bg-muted/30" />
                          <div className="mt-3 h-2 w-12 rounded bg-accent/35" />
                          <div className="mt-1.5 h-1.5 w-10 rounded bg-muted/20" />
                          <div className="mt-1.5 h-1.5 w-12 rounded bg-muted/15" />
                        </div>
                        <div className="bg-background p-4">
                          <div className="h-2 w-24 rounded bg-foreground/60" />
                          <div className="mt-3 h-1.5 w-full rounded bg-muted/18" />
                          <div className="mt-1.5 h-1.5 w-4/5 rounded bg-muted/14" />
                          <div className="mt-4 h-8 w-full rounded-md border border-border-subtle bg-panel" />
                        </div>
                      </div>
                    </div>
                  </SettingGroup>
                </div>
              )}

              {tab === 'editor' && (
                <div className="space-y-4">
                  <SettingGroup id="editor-mode" title="编辑器视图">
                    <SegmentedControl
                      value={draft.editorMode}
                      options={EDITOR_MODE_OPTIONS}
                      onChange={(value) => void persist({ editorMode: value })}
                      ariaLabel="编辑器视图"
                      testIdPrefix="settings-editor-mode"
                    />
                  </SettingGroup>
                  <SettingGroup id="font-size" title="正文字号" description={`当前 ${draft.fontSize}px`}>
                    <div className="flex items-center gap-3">
                      <span className="text-[10.5px] text-muted">小</span>
                      <input
                        type="range"
                        min={10}
                        max={24}
                        value={draft.fontSize}
                        onChange={(event) =>
                          setDraft((prev) => ({ ...prev, fontSize: Number(event.target.value) }))
                        }
                        onMouseUp={() => void persist({ fontSize: draft.fontSize })}
                        onTouchEnd={() => void persist({ fontSize: draft.fontSize })}
                        className="range-input flex-1"
                        style={{ '--range-progress': `${((draft.fontSize - 10) / 14) * 100}%` } as React.CSSProperties}
                        aria-label="正文字号"
                      />
                      <span className="text-[14px] text-muted">大</span>
                    </div>
                  </SettingGroup>
                </div>
              )}

              {tab === 'capture' && (
                <div className="space-y-4">
                  <SettingGroup id="stamp" title="速记时间戳">
                    <select
                      value={draft.stampFormat}
                      onChange={(event) =>
                        void persist({ stampFormat: event.target.value as SettingsDto['stampFormat'] })
                      }
                      className="select-base w-full sm:w-56"
                    >
                      {STAMP_FORMATS.map((value) => (
                        <option key={value} value={value}>
                          {value === 'heading' ? '## 日期 时间' : value === 'bullet' ? '- [时间]' : '不加'}
                        </option>
                      ))}
                    </select>
                  </SettingGroup>

                  <SettingGroup id="hotkeys" title="桌面快捷键" description="点击快捷键框后直接按下组合键；Esc 取消录制。">
                    <div className="space-y-3">
                      <Row label="打开主窗口">
                        <div className="flex items-center gap-2">
                          <HotkeyRecorder
                            value={draft.mainWindowHotkey}
                            onChange={(accelerator) => void applyHotkey('main', accelerator)}
                            testId="hotkey-main-input"
                          />
                          <button
                            type="button"
                            onClick={() => void applyHotkey('main', defaultMainHotkey)}
                            className="button-ghost !min-h-7 px-2 text-[10.5px]"
                          >
                            恢复默认
                          </button>
                        </div>
                      </Row>
                      {hotkeyWarning('主窗口快捷键', hotkeyStates?.main)}

                      <Row label="打开数据窗口">
                        <div className="flex items-center gap-2">
                          <HotkeyRecorder
                            value={draft.hotkey}
                            onChange={(accelerator) => void applyHotkey('capture', accelerator)}
                            testId="hotkey-input"
                          />
                          <button
                            type="button"
                            onClick={() => void applyHotkey('capture', defaultHotkey)}
                            className="button-ghost !min-h-7 px-2 text-[10.5px]"
                          >
                            恢复默认
                          </button>
                        </div>
                      </Row>
                      {hotkeyWarning('数据窗口快捷键', hotkeyStates?.capture)}

                      <Row label="收藏链接">
                        <div className="flex items-center gap-2">
                          <HotkeyRecorder
                            value={draft.favoriteHotkey}
                            onChange={(accelerator) => void applyHotkey('favorite', accelerator)}
                            testId="hotkey-favorite-input"
                          />
                          <button
                            type="button"
                            onClick={() => void applyHotkey('favorite', defaultFavoriteHotkey)}
                            className="button-ghost !min-h-7 px-2 text-[10.5px]"
                          >
                            恢复默认
                          </button>
                        </div>
                      </Row>
                      {hotkeyWarning('收藏与链接快捷键', hotkeyStates?.favorite)}
                    </div>
                    {!desktop && (
                      <p className="mt-3 rounded-lg bg-panel px-3 py-2 text-[10px] leading-5 text-muted">
                        全局快捷键仅在桌面客户端生效；当前预览为 {formatHotkey(draft.mainWindowHotkey)} /{' '}
                        {formatHotkey(draft.hotkey)} / {formatHotkey(draft.favoriteHotkey)}。
                      </p>
                    )}
                    {hotkeyStates?.main.registered &&
                      hotkeyStates.capture.registered &&
                      hotkeyStates.favorite?.registered && (
                        <div className="mt-3 text-[10.5px] text-success">三个快捷键均已生效</div>
                      )}
                  </SettingGroup>

                  <SettingGroup id="window" title="窗口行为">
                    <div className="space-y-3.5">
                      <ToggleSwitch
                        label="失焦时自动隐藏速记窗口"
                        checked={draft.hideOnBlur}
                        disabled={!desktop}
                        onChange={(value) => void persist({ hideOnBlur: value })}
                      />
                      <ToggleSwitch
                        label="关闭窗口后驻留托盘"
                        checked={draft.minimizeToTray}
                        disabled={!desktop}
                        onChange={(value) => void persist({ minimizeToTray: value })}
                      />
                      <ToggleSwitch
                        label="登录时启动"
                        checked={draft.launchAtLogin}
                        disabled={!desktop}
                        onChange={(value) => void persist({ launchAtLogin: value })}
                      />
                    </div>
                  </SettingGroup>
                </div>
              )}

              {tab === 'ai' && (
                <div className="space-y-4">
                  <div className="settings-embedded" id="group-ai">
                    <AiSettingsSection />
                  </div>
                </div>
              )}

              {tab === 'apple' && appleNotes && (
                <div className="space-y-4">
                  <div className="settings-embedded" id="group-apple">
                    <AppleNotesSettingsSection controller={appleNotes} />
                  </div>
                </div>
              )}
                </>
              )}
              </div>
            </div>
          </div>
        </div>

        <div className="dialog-footer shrink-0">
          {saving && (
            <span className="mr-auto flex items-center gap-1.5 text-[10.5px] text-muted">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              正在同步设置…
            </span>
          )}
          <button type="button" onClick={onClose} className="button-secondary">
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingGroup({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id ? `group-${id}` : undefined} className="settings-group rounded-xl border border-border-subtle bg-panel/45 p-3.5">
      <div className="mb-3">
        <h4 className="text-[11.5px] font-semibold">{title}</h4>
        {description && <p className="mt-1 text-[10px] leading-4 text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-muted">{label}</span>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
