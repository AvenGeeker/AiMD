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
