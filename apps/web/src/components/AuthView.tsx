import { useState } from 'react';
import { Cloud, Command, LockKeyhole, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../lib/auth.js';
import { isDesktop, isMobile } from '../lib/platform.js';
import { SegmentedControl } from './ui/SegmentedControl.js';

/** Sign-in / sign-up screen. Also hosts the desktop server-URL prompt. */

const AUTH_MODES = [
  { value: 'login' as const, label: '登录' },
  { value: 'register' as const, label: '注册' },
];

export function AuthView() {
  const { login, register, error, baseUrl, setBaseUrl } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [serverUrl, setServerUrlInput] = useState(baseUrl);
  const [editingServerUrl, setEditingServerUrl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const localShell = isDesktop() || isMobile();
  const needsServerUrl = localShell && !baseUrl;
  const showServerUrlForm = localShell && (!baseUrl || editingServerUrl);

  const openServerSettings = () => {
    setServerUrlInput(baseUrl);
    setLocalError(null);
    setEditingServerUrl(true);
  };

  const closeServerSettings = () => {
    setServerUrlInput(baseUrl);
    setLocalError(null);
    setEditingServerUrl(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      if (showServerUrlForm) {
        const next = serverUrl.trim().replace(/\/+$/, '');
        const changed = next !== baseUrl;
        await setBaseUrl(next);
        setServerUrlInput(next);
        setEditingServerUrl(false);
        if (changed) {
          setMode('login');
          setEmail('');
          setPassword('');
          setDisplayName('');
        }
        return;
      }
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName || undefined);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="auth-card relative z-10 grid w-full max-w-5xl overflow-hidden lg:grid-cols-[1.04fr_0.96fr]">
        <section className="relative hidden flex-col justify-between overflow-hidden border-r border-border-subtle p-12 lg:flex">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-3">
              <span className="brand-mark !h-9 !w-9 !rounded-[11px] !text-sm" aria-hidden>
                M
              </span>
              <div>
                <div className="text-[15px] font-semibold tracking-tight">aiMarkdown</div>
                <div className="mt-0.5 text-[11px] text-muted">自托管的 Markdown 笔记本</div>
              </div>
            </div>

            <div className="mt-16 max-w-md">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/15 bg-accent-soft px-3 py-1 text-[10.5px] font-medium text-accent">
                <Sparkles size={12} />
                安静、快速、属于你
              </div>
              <h1 className="text-[32px] font-semibold leading-[1.22] tracking-[-0.045em] text-foreground">
                把注意力留给
                <br />
                正在写的内容。
              </h1>
              <p className="mt-4 max-w-sm text-[12.5px] leading-6 text-muted">
                本地优先的编辑体验，多设备实时同步，以及随时可召唤的全局速记。
              </p>
            </div>

            <div className="mt-12 space-y-4">
              <div className="auth-feature">
                <span className="auth-feature-icon">
                  <ShieldCheck size={14} />
                </span>
                数据保存在自己的服务器，离线也能继续写
              </div>
              <div className="auth-feature">
                <span className="auth-feature-icon">
                  <Cloud size={14} />
                </span>
                基于 CRDT 的多端实时同步与安全合并
              </div>
              <div className="auth-feature">
                <span className="auth-feature-icon">
                  <Command size={14} />
                </span>
                全局快捷键，不打断当前工作流
              </div>
            </div>
          </div>

          <div className="relative mt-10 flex items-center gap-2 text-[10.5px] text-muted/65">
            <LockKeyhole size={12} />
            账号与笔记始终由你的部署实例管理
          </div>
        </section>

        <section className="flex min-h-[620px] items-center justify-center p-6 sm:p-10">
          <form
            onSubmit={submit}
            className="w-full max-w-sm space-y-5"
            data-testid="auth-view"
          >
            <div className="mb-8 lg:hidden">
              <div className="flex items-center gap-3">
                <span className="brand-mark" aria-hidden>
                  M
                </span>
                <div>
                  <div className="text-sm font-semibold">aiMarkdown</div>
                  <div className="text-[10.5px] text-muted">多端同步的 Markdown 笔记本</div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-[21px] font-semibold tracking-[-0.03em]">
                {showServerUrlForm ? '连接服务器' : mode === 'login' ? '欢迎回来' : '创建你的笔记库'}
              </h2>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted">
                {showServerUrlForm
                  ? '填入部署地址后继续；账号数据只属于这个服务器。'
                  : mode === 'login'
                    ? '登录后继续你的写作与同步。'
                    : '注册一个账号，开始搭建自己的知识库。'}
              </p>
            </div>

            {showServerUrlForm ? (
              <>
                <label className="block space-y-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                    <Server size={12} />
                    服务器地址
                  </span>
                  <input
                    value={serverUrl}
                    onChange={(event) => setServerUrlInput(event.target.value)}
                    placeholder="https://notes.example.com"
                    className="input-base h-10 text-[13px]"
                    data-testid="server-url"
                    required
                  />
                </label>
                <p className="rounded-lg bg-panel px-3 py-2.5 text-[10.5px] leading-5 text-muted">
                  {needsServerUrl
                    ? '填入你自己部署的 aiMarkdown 服务地址，保存后继续登录。'
                    : '更改服务器地址后需要重新登录。'}
                </p>
              </>
            ) : (
              <>
                <SegmentedControl<'login' | 'register'>
                  value={mode}
                  options={AUTH_MODES}
                  onChange={setMode}
                  ariaLabel="登录或注册"
                  testIdPrefix="auth-mode"
                  className="w-full rounded-[10px] [&_.segmented-button]:h-8 [&_.segmented-button]:flex-1"
                />

                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-muted">邮箱</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    className="input-base h-10 text-[13px]"
                    data-testid="email"
                    required
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-muted">密码</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="input-base h-10 text-[13px]"
                    data-testid="password"
                    minLength={mode === 'register' ? 8 : undefined}
                    required
                  />
                </label>

                {mode === 'register' && (
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-muted">昵称（可选）</span>
                    <input
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      className="input-base h-10 text-[13px]"
                      data-testid="display-name"
                    />
                  </label>
                )}
              </>
            )}

            {(localError || (!editingServerUrl && error)) && (
              <div
                className="rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-[11px] leading-5 text-danger"
                data-testid="auth-error"
              >
                {localError ?? error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="button-primary !h-10 w-full !text-[13px]"
              data-testid="auth-submit"
            >
              {busy
                ? '处理中…'
                : showServerUrlForm
                  ? needsServerUrl
                    ? '保存服务器地址'
                    : '保存并返回登录'
                  : mode === 'login'
                    ? '登录'
                    : '创建账号'}
            </button>

            {showServerUrlForm && !needsServerUrl && (
              <button
                type="button"
                onClick={closeServerSettings}
                className="w-full text-center text-[11px] text-muted transition-colors hover:text-accent"
                data-testid="cancel-server-url"
              >
                取消
              </button>
            )}

            {localShell && baseUrl && !showServerUrlForm && (
              <div className="space-y-1.5 border-t border-border-subtle pt-4 text-center">
                <p className="truncate text-[10.5px] text-muted" title={baseUrl}>
                  当前服务器：{baseUrl}
                </p>
                <button
                  type="button"
                  onClick={openServerSettings}
                  className="text-[11px] text-muted transition-colors hover:text-accent"
                  data-testid="edit-server-url"
                >
                  回到服务器地址设置
                </button>
              </div>
            )}
          </form>
        </section>
      </div>
    </div>
  );
}
