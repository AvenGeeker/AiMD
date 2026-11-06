/**
 * Public share pages live at `/s/<token>` and are rendered by the same SPA bundle.
 *
 * Any `/s` path is treated as a share route even when the token is malformed, so the visitor gets
 * a friendly invalid-link page instead of the sign-in screen.
 */
export function shareTokenFromPath(pathname: string): string | null {
  if (pathname !== '/s' && !pathname.startsWith('/s/')) return null;
  const raw = pathname.slice(2).replace(/^\/+|\/+$/g, '');
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}
