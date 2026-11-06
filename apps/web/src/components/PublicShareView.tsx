import { useEffect, useState } from 'react';
import { FileText, Loader2, RefreshCw } from 'lucide-react';
import type { PublicNoteShareDto } from '@aimarkdown/shared';
import { Preview } from './Preview.js';

/** Read-only page rendered before authentication for an unlisted `/s/<token>` link. */

export interface PublicShareViewProps {
  token: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; note: PublicNoteShareDto }
  | { status: 'error'; message: string; missing: boolean };

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function attachmentId(raw: string): string | null {
  try {
    const url = new URL(raw, window.location.origin);
    const match = /\/api\/attachments\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function rewriteShareLinks(host: HTMLElement, token: string): void {
  const prefix = `/api/shares/${encodeURIComponent(token)}/attachments`;
  for (const element of host.querySelectorAll<HTMLElement>('img[src], a[href]')) {
    const attribute = element instanceof HTMLImageElement ? 'src' : 'href';
    const value = element.getAttribute(attribute);
    if (!value) continue;
    const id = attachmentId(value);
    if (id) element.setAttribute(attribute, `${prefix}/${id}`);
  }
  // Wikilinks point at private notes. Render them as informational text rather than navigation.
  for (const link of host.querySelectorAll<HTMLAnchorElement>('a[data-wikilink]')) {
    link.removeAttribute('href');
    link.classList.add('wikilink-missing');
    link.setAttribute('aria-disabled', 'true');
    link.setAttribute('title', '这篇笔记未公开');
  }
}

export function PublicShareView({ token }: PublicShareViewProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reload, setReload] = useState(0);
  const [dark, setDark] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (event: MediaQueryListEvent) => setDark(event.matches);
    setDark(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    // External images in note bodies must not receive the capability token as a Referer.
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.append(robots, referrer);
    return () => {
      robots.remove();
      referrer.remove();
      document.title = 'AiMD';
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ status: 'error', message: '分享链接格式不正确', missing: true });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void (async () => {
      try {
        const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, {
          signal: controller.signal,
          credentials: 'omit',
          headers: { accept: 'application/json' },
        });
        const body = (await response.json().catch(() => null)) as
          | (PublicNoteShareDto & { message?: string })
          | { message?: string }
          | null;
        if (!response.ok) {
          setState({
            status: 'error',
            message:
              response.status === 404
                ? '分享链接不存在或已关闭'
                : (body && 'message' in body && body.message) || '分享内容加载失败',
            missing: response.status === 404,
          });
          return;
        }
        const note = body as PublicNoteShareDto;
        document.title = note.title ? `${note.title} · AiMD` : 'AiMD 分享';
        setState({ status: 'ready', note });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '无法连接服务器',
          missing: false,
        });
      }
    })();
    return () => controller.abort();
  }, [token, reload]);

  return (
    <div className="min-h-screen bg-background text-foreground" data-testid="public-share-page">
      <header className="border-b border-border-subtle bg-panel/55">
        <div className="mx-auto flex h-14 w-full max-w-[920px] items-center justify-between px-5">
          <a href="/" className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <FileText size={15} />
            </span>
            AiMD
          </a>
          <span className="rounded-full border border-border-subtle bg-background/70 px-2.5 py-1 text-[10.5px] text-muted">
            只读分享
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[920px] flex-1 flex-col px-5 pb-16 pt-10 sm:pt-14">
        {state.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center gap-2 py-24 text-sm text-muted" data-testid="public-share-loading">
            <Loader2 size={16} className="animate-spin" /> 正在加载分享内容…
          </div>
        ) : state.status === 'error' ? (
          <div className="mx-auto mt-20 max-w-md text-center" data-testid="public-share-error">
            <span className="empty-state-icon mx-auto">
              <FileText size={20} />
            </span>
            <h1 className="mt-4 text-lg font-semibold">{state.missing ? '分享链接已失效' : '分享内容加载失败'}</h1>
            <p className="mt-2 text-[12px] leading-6 text-muted">{state.message}</p>
            {!state.missing ? (
              <button
                type="button"
                className="button-secondary mx-auto mt-5"
                onClick={() => setReload((value) => value + 1)}
                data-testid="public-share-retry"
              >
                <RefreshCw size={13} /> 重试
              </button>
            ) : (
              <a href="/" className="button-secondary mx-auto mt-5 inline-flex">
                打开 AiMD
              </a>
            )}
          </div>
        ) : (
          <article className="mx-auto w-full">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]" data-testid="public-share-title">
              {state.note.title || '无标题'}
            </h1>
            <p className="mt-3 text-[11.5px] text-muted" data-testid="public-share-updated-at">
              更新于 {formatUpdatedAt(state.note.updatedAt)}
            </p>
            <div className="mt-9">
              <Preview
                source={state.note.body}
                dark={dark}
                debounceMs={0}
                onRendered={(host) => rewriteShareLinks(host, token)}
              />
            </div>
          </article>
        )}
      </main>

      <footer className="border-t border-border-subtle py-5 text-center text-[10.5px] text-muted">
        由 AiMD 提供的只读分享
      </footer>
    </div>
  );
}
