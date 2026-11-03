import { afterEach, describe, expect, it } from 'vitest';
import { apiBase, collabUrl, normalizeServerUrl, serverOrigin } from './config.js';

describe('apiBase', () => {
  it('is relative for same-origin browser use', () => {
    expect(apiBase('')).toBe('/api');
  });

  it('is absolute when the desktop shell supplies a server url', () => {
    expect(apiBase('https://notes.example.com')).toBe('https://notes.example.com/api');
  });

  it('strips a trailing slash so the path never doubles up', () => {
    expect(apiBase('https://notes.example.com/')).toBe('https://notes.example.com/api');
    expect(apiBase('https://notes.example.com///')).toBe('https://notes.example.com/api');
  });
});

describe('collabUrl', () => {
  const originalLocation = globalThis.location;

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  const setLocation = (href: string) => {
    Object.defineProperty(globalThis, 'location', {
      value: new URL(href),
      writable: true,
      configurable: true,
    });
  };

  it('derives ws:// from an http origin', () => {
    setLocation('http://127.0.0.1:5173/');
    expect(collabUrl('')).toBe('ws://127.0.0.1:5173/collab');
  });

  it('derives wss:// from an https origin', () => {
    setLocation('https://notes.example.com/');
    expect(collabUrl('')).toBe('wss://notes.example.com/collab');
  });

  it('builds from an explicit base url and upgrades the scheme', () => {
    expect(collabUrl('https://notes.example.com')).toBe('wss://notes.example.com/collab');
    expect(collabUrl('http://192.168.1.10:3000')).toBe('ws://192.168.1.10:3000/collab');
  });

  it('keeps a non-standard port', () => {
    expect(collabUrl('https://notes.example.com:8443')).toBe('wss://notes.example.com:8443/collab');
  });

  it('strips a trailing slash from the base', () => {
    expect(collabUrl('https://notes.example.com/')).toBe('wss://notes.example.com/collab');
  });
});

describe('injected runtime config', () => {
  afterEach(() => {
    delete window.__AIMARKDOWN_CONFIG__;
    Object.defineProperty(globalThis, 'location', {
      value: new URL('https://notes.example.com/'),
      writable: true,
      configurable: true,
    });
  });

  const setLocation = (href: string) => {
    Object.defineProperty(globalThis, 'location', {
      value: new URL(href),
      writable: true,
      configurable: true,
    });
  };

  it('prefers the server-injected collabUrl over same-origin', () => {
    setLocation('http://127.0.0.1:3100/');
    window.__AIMARKDOWN_CONFIG__ = { collabUrl: 'ws://127.0.0.1:1310' };
    expect(collabUrl('')).toBe('ws://127.0.0.1:1310');
  });

  it('falls back to same-origin when nothing was injected', () => {
    setLocation('https://notes.example.com/');
    expect(collabUrl('')).toBe('wss://notes.example.com/collab');
  });

  it('ignores an empty injected value', () => {
    setLocation('http://127.0.0.1:3100/');
    window.__AIMARKDOWN_CONFIG__ = { collabUrl: '' };
    expect(collabUrl('')).toBe('ws://127.0.0.1:3100/collab');
    window.__AIMARKDOWN_CONFIG__ = { collabUrl: null };
    expect(collabUrl('')).toBe('ws://127.0.0.1:3100/collab');
  });

  it('still lets an explicit base url win (Electron)', () => {
    setLocation('http://127.0.0.1:3100/');
    window.__AIMARKDOWN_CONFIG__ = { collabUrl: 'ws://127.0.0.1:1310' };
    expect(collabUrl('https://remote.example.com')).toBe('wss://remote.example.com/collab');
  });
});

describe('normalizeServerUrl', () => {
  it('keeps a correct https address', () => {
    expect(normalizeServerUrl('https://notes.example.com')).toEqual({
      ok: true,
      url: 'https://notes.example.com',
      guessedScheme: false,
    });
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeServerUrl('  https://notes.example.com///  ')).toEqual({
      ok: true,
      url: 'https://notes.example.com',
      guessedScheme: false,
    });
  });

  it('adds https:// for a public host the user left bare', () => {
    // Without a scheme, `apiBase()` produces a *relative* path and the request never reaches a server.
    expect(normalizeServerUrl('myaimd.top')).toEqual({
      ok: true,
      url: 'https://myaimd.top',
      guessedScheme: true,
    });
  });

  it('adds http:// for loopback and LAN hosts, which are not served over TLS', () => {
    for (const host of ['127.0.0.1:3000', 'localhost:3000', '192.168.1.20:8080', 'nas.local']) {
      expect(normalizeServerUrl(host)).toEqual({
        ok: true,
        url: `http://${host}`,
        guessedScheme: true,
      });
    }
  });

  it('keeps an explicit scheme and a path prefix', () => {
    expect(normalizeServerUrl('http://127.0.0.1:3000')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:3000',
      guessedScheme: false,
    });
    expect(normalizeServerUrl('https://example.com/notes/')).toEqual({
      ok: true,
      url: 'https://example.com/notes',
      guessedScheme: false,
    });
  });

  it('drops a query and fragment that would corrupt the API path', () => {
    expect(normalizeServerUrl('https://notes.example.com/?x=1#/app')).toEqual({
      ok: true,
      url: 'https://notes.example.com',
      guessedScheme: false,
    });
  });

  it('rejects an empty address', () => {
    expect(normalizeServerUrl('   ')).toEqual({ ok: false, message: '请填写服务器地址' });
  });

  it('rejects a non-http scheme', () => {
    const result = normalizeServerUrl('file:///tmp/index.html');
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('https://');
  });

  it('rejects an address with a space', () => {
    const result = normalizeServerUrl('https://notes.example.com /api');
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('空格');
  });

  it('rejects something that is not a URL at all', () => {
    const result = normalizeServerUrl('http://');
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain('格式不正确');
  });
});

describe('serverOrigin', () => {
  it('reduces an address to its origin for error messages', () => {
    expect(serverOrigin('https://notes.example.com/notes')).toBe('https://notes.example.com');
  });

  it('falls back to the raw value when unparseable', () => {
    expect(serverOrigin('not a url')).toBe('not a url');
  });
});
