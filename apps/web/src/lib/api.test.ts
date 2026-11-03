import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ERROR_CODES } from '@aimarkdown/shared';
import { HttpError, probeServerHealth, probeServerUrl, readJsonResponse, request } from './api.js';

/** The SPA shell any wrong address answers with: status 200, `text/html`, `<!doctype html>`. */
const HTML_PAGE = '<!doctype html><html><head><title>Router</title></head><body>登录</body></html>';

function htmlResponse(status = 200): Response {
  return new Response(HTML_PAGE, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readJsonResponse', () => {
  it('returns the payload of a JSON answer', async () => {
    const payload = await readJsonResponse<{ user: { id: string } }>(
      jsonResponse({ user: { id: 'n1' } }),
      '登录失败',
    );
    expect(payload?.user.id).toBe('n1');
  });

  it('turns an HTML answer into the shared error contract instead of a SyntaxError', async () => {
    // Silence the diagnostic console.warn; the assertion below is about the thrown error.
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const error = await readJsonResponse(htmlResponse(), '登录失败').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(ERROR_CODES.INVALID_SERVER_RESPONSE);
    const message = (error as ApiError).message;
    expect(message).toContain('网页');
    expect(message).toContain('https://notes.example.com');
    // The whole point: V8's parse error must never reach the user.
    expect(message).not.toContain('Unexpected token');
  });

  it('detects HTML even when the content-type lies', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = new Response(HTML_PAGE, { status: 200, headers: { 'content-type': 'text/plain' } });
    await expect(readJsonResponse(response, '登录失败')).rejects.toThrow(/网页/);
  });

  it('keeps the server message for a JSON failure', async () => {
    const error = await readJsonResponse(
      jsonResponse({ code: ERROR_CODES.INVALID_CREDENTIALS, message: '邮箱或密码不正确' }, 401),
      '登录失败',
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(401);
    expect((error as HttpError).message).toBe('邮箱或密码不正确');
  });

  it('explains a non-JSON failure instead of showing an empty statusText', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = await readJsonResponse(htmlResponse(502), '登录失败').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).message).toContain('网页');
  });
});

describe('request', () => {
  it('does not leak a parse error when an endpoint answers with HTML', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse()));
    const error = await request('/notes').catch((caught: unknown) => caught);
    expect((error as ApiError).code).toBe(ERROR_CODES.INVALID_SERVER_RESPONSE);
    expect((error as ApiError).message).not.toContain('Unexpected token');
  });
});

describe('probeServerHealth', () => {
  const HEALTH = { status: 'ok', version: '0.1.0', uptimeSeconds: 3, db: 'ok', collab: 'ok' };

  it('accepts a healthy server', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(HEALTH));
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeServerHealth('https://notes.example.com')).resolves.toMatchObject({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://notes.example.com/api/health',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('accepts a degraded server: it is still AiMD', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ ...HEALTH, status: 'degraded', db: 'error' }, 503));
    await expect(probeServerHealth('https://notes.example.com')).resolves.toMatchObject({
      status: 'degraded',
    });
  });

  it('rejects an address that answers with somebody else’s web page', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', async () => htmlResponse());
    const error = await probeServerHealth('https://router.local').catch((caught: unknown) => caught);
    expect((error as ApiError).message).toContain('网页');
  });

  it('rejects a host without the API', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ code: 'NOT_FOUND', message: '接口不存在' }, 404));
    const error = await probeServerHealth('https://notes.example.com').catch((caught: unknown) => caught);
    expect((error as ApiError).message).toContain('404');
    expect((error as ApiError).message).toContain('https://notes.example.com');
  });

  it('explains an unreachable host', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error = await probeServerHealth('https://down.example.com').catch((caught: unknown) => caught);
    expect((error as ApiError).code).toBe(ERROR_CODES.INVALID_SERVER_RESPONSE);
    expect((error as ApiError).message).toContain('无法连接 https://down.example.com');
  });

  it('explains a timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timed out', 'TimeoutError');
      }),
    );
    const error = await probeServerHealth('https://slow.example.com').catch((caught: unknown) => caught);
    expect((error as ApiError).message).toContain('超时');
  });
});

describe('probeServerUrl', () => {
  const HEALTH = { status: 'ok', version: '0.1.0', uptimeSeconds: 3, db: 'ok', collab: 'ok' };

  it('keeps the address when it answers on the first try', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(HEALTH)));
    await expect(probeServerUrl('https://notes.example.com', false)).resolves.toBe(
      'https://notes.example.com',
    );
  });

  it('does not switch schemes when the user typed one', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(probeServerUrl('https://notes.example.com', false)).rejects.toThrow(/无法连接/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to http for a guessed scheme on a plain-HTTP deployment', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        seen.push(input);
        if (input.startsWith('https://')) throw new TypeError('Failed to fetch');
        return jsonResponse(HEALTH);
      }),
    );
    // The deployment only speaks HTTP (the documented 8080 setup); we guessed https first.
    await expect(probeServerUrl('https://203.0.113.10:8080', true)).resolves.toBe(
      'http://203.0.113.10:8080',
    );
    expect(seen).toEqual([
      'https://203.0.113.10:8080/api/health',
      'http://203.0.113.10:8080/api/health',
    ]);
  });

  it('reports the first attempt when neither scheme answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const error = await probeServerUrl('https://notes.example.com', true).catch(
      (caught: unknown) => caught,
    );
    expect((error as ApiError).message).toContain('https://notes.example.com');
    expect((error as ApiError).message).not.toContain('http://notes.example.com');
  });
});
