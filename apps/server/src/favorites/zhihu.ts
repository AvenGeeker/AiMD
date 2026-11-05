/**
 * Zhihu helpers.
 *
 * Zhihu answers a normal article URL with an anti-bot challenge for server-side clients. The
 * in-app view (`/appview/p/{id}`) is server-rendered for the native app user agent and does not
 * require a browser session, so article captures use it as the fetch target while keeping the
 * original URL as the note's source.
 */

const ZHIHU_HOSTS = new Set(['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com']);

export const ZHIHU_APP_USER_AGENT = 'Zhihu/10.62.0 (iPhone; iOS 17.0; Scale/3.00)';

/** Rewrite a Zhihu article link to the server-rendered app view, or return null. */
export function zhihuAppviewUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!ZHIHU_HOSTS.has(url.hostname.toLowerCase())) return null;
  const match = /^\/p\/(\d+)\/?$/.exec(url.pathname);
  if (!match) return null;
  return `https://www.zhihu.com/appview/p/${match[1]}`;
}

export function isZhihuUrl(rawUrl: string): boolean {
  try {
    return ZHIHU_HOSTS.has(new URL(rawUrl).hostname.toLowerCase());
  } catch {
    return false;
  }
}
