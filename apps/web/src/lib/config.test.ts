import { afterEach, describe, expect, it } from 'vitest';
import { apiBase, collabUrl } from './config.js';

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
