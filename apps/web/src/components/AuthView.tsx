import { useState } from 'react';
import { useAuth } from '../lib/auth.js';
import { isDesktop, isMobile } from '../lib/platform.js';

/** Sign-in / sign-up screen. Also hosts the desktop server-URL prompt. */

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
          // A different server has a different account database. Drop credentials and any
          // half-filled sign-up data, then make the user sign in again from scratch.
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
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm"
        data-testid="auth-view"
      >
        <div>
          <h1 className="text-lg font-semibold">aiMarkdown</h1>
          <p className="text-xs text-muted">多端同步的 Markdown 笔记本</p>
        </div>

        {showServerUrlForm ? (
          <>
            <label className="block space-y-1">
              <span className="text-xs text-muted">服务器地址</span>
              <input
                value={serverUrl}
                onChange={(event) => setServerUrlInput(event.target.value)}
                placeholder="https://notes.example.com"
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                data-testid="server-url"
                required
              />
            </label>
            <p className="text-[11px] text-muted">
              {needsServerUrl
                ? '填入你自己部署的 aiMarkdown 服务地址，保存后继续登录。'
                : '更改服务器地址后需要重新登录。'}
            </p>
          </>
        ) : (
          <>
            <div className="flex rounded border border-border p-0.5 text-xs">
              {(['login', 'register'] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  data-testid={`auth-mode-${entry}`}
                  onClick={() => setMode(entry)}
                  className={`flex-1 rounded px-2 py-1 ${
                    mode === entry ? 'bg-accent text-accent-foreground' : 'text-muted hover:bg-hover'
                  }`}
                >
                  {entry === 'login' ? '登录' : '注册'}
                </button>
              ))}
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-muted">邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                data-testid="email"
                required
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-muted">密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                data-testid="password"
                minLength={mode === 'register' ? 8 : undefined}
                required
              />
            </label>

            {mode === 'register' && (
              <label className="block space-y-1">
                <span className="text-xs text-muted">昵称（可选）</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent"
                  data-testid="display-name"
                />
              </label>
            )}
          </>
        )}

        {(localError || (!editingServerUrl && error)) && (
          <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-xs text-danger" data-testid="auth-error">
            {localError ?? error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
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
            className="w-full text-center text-xs text-muted hover:text-accent"
            data-testid="cancel-server-url"
          >
            取消
          </button>
        )}

        {localShell && baseUrl && !showServerUrlForm && (
          <div className="space-y-1 border-t border-border pt-3 text-center">
            <p className="truncate text-[11px] text-muted" title={baseUrl}>
              当前服务器：{baseUrl}
            </p>
            <button
              type="button"
              onClick={openServerSettings}
              className="text-xs text-muted hover:text-accent"
              data-testid="edit-server-url"
            >
              回到服务器地址设置
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
