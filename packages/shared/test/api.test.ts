import { describe, expect, it } from 'vitest';
import {
  ApiError,
  ERROR_CODES,
  ERROR_STATUS,
  toApiErrorBody,
} from '../src/errors.js';
import {
  createFolderInput,
  createNoteInput,
  listNotesQuery,
  loginInput,
  registerInput,
  settingsPatchInput,
  upsertTagInput,
} from '../src/api.js';

describe('error contract', () => {
  it('maps every code to a status', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_STATUS[code], `${code} must have a status`).toBeTypeOf('number');
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('exposes status and a serialisable body', () => {
    const error = new ApiError(ERROR_CODES.NOT_FOUND, '没找到', { id: 'x' });
    expect(error.status).toBe(404);
    expect(error.toJSON()).toEqual({ code: 'NOT_FOUND', message: '没找到', details: { id: 'x' } });
    expect(error).toBeInstanceOf(Error);
  });

  it('converts unknown throwables into an INTERNAL body', () => {
    expect(toApiErrorBody(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
    expect(toApiErrorBody('plain string')).toEqual({ code: 'INTERNAL', message: '未知错误' });
    expect(toApiErrorBody(null)).toEqual({ code: 'INTERNAL', message: '未知错误' });
    expect(toApiErrorBody(undefined, 'fallback')).toEqual({ code: 'INTERNAL', message: 'fallback' });
  });

  it('passes through an ApiError-shaped object', () => {
    expect(toApiErrorBody({ code: 'CONFLICT', message: 'dup' })).toEqual({
      code: 'CONFLICT',
      message: 'dup',
      details: undefined,
    });
  });

  it('uses the right status for auth-related codes', () => {
    expect(new ApiError(ERROR_CODES.UNAUTHENTICATED, 'x').status).toBe(401);
    expect(new ApiError(ERROR_CODES.TOKEN_EXPIRED, 'x').status).toBe(401);
    expect(new ApiError(ERROR_CODES.FORBIDDEN, 'x').status).toBe(403);
    expect(new ApiError(ERROR_CODES.RATE_LIMITED, 'x').status).toBe(429);
    expect(new ApiError(ERROR_CODES.CYCLIC_FOLDER, 'x').status).toBe(409);
    expect(new ApiError(ERROR_CODES.SEARCH_QUERY_TOO_SHORT, 'x').status).toBe(422);
  });
});

describe('auth validation', () => {
  it('accepts a valid registration and lowercases the email', () => {
    const result = registerInput.safeParse({ email: 'Foo@Example.COM', password: 'longenough' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('foo@example.com');
  });

  it('rejects a short password', () => {
    expect(registerInput.safeParse({ email: 'a@b.co', password: '1234567' }).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(registerInput.safeParse({ email: 'not-an-email', password: 'longenough' }).success).toBe(false);
  });

  it('trims and bounds the display name', () => {
    const ok = registerInput.safeParse({ email: 'a@b.co', password: 'longenough', displayName: '  Ada  ' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.displayName).toBe('Ada');
    expect(registerInput.safeParse({ email: 'a@b.co', password: 'longenough', displayName: 'x'.repeat(61) }).success).toBe(false);
  });

  it('requires a non-empty password on login but does not re-check length', () => {
    expect(loginInput.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginInput.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('note and folder validation', () => {
  it('rejects ids that are not nanoid-shaped', () => {
    expect(createNoteInput.safeParse({ folderId: '../escape' }).success).toBe(false);
    expect(createFolderInput.safeParse({ name: 'ok', parentId: 'a b' }).success).toBe(false);
  });

  it('accepts null folderId meaning root level', () => {
    const result = createNoteInput.safeParse({ folderId: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.folderId).toBeNull();
  });

  it('requires a non-empty folder name', () => {
    expect(createFolderInput.safeParse({ name: '   ' }).success).toBe(false);
    expect(createFolderInput.safeParse({ name: 'Inbox' }).success).toBe(true);
  });

  it('caps tag colours to #RRGGBB', () => {
    expect(upsertTagInput.safeParse({ name: 'x', color: '#ff00aa' }).success).toBe(true);
    expect(upsertTagInput.safeParse({ name: 'x', color: 'red' }).success).toBe(false);
    expect(upsertTagInput.safeParse({ name: 'x', color: '#fff' }).success).toBe(false);
  });

  it('bounds note body size', () => {
    expect(createNoteInput.safeParse({ body: 'x'.repeat(2_000_001) }).success).toBe(false);
  });
});

describe('list query parsing', () => {
  it('applies defaults', () => {
    const result = listNotesQuery.parse({});
    expect(result.sort).toBe('updated');
    expect(result.limit).toBe(50);
    expect(result.archived).toBe('false');
  });

  it('coerces a string limit', () => {
    expect(listNotesQuery.parse({ limit: '25' }).limit).toBe(25);
  });

  it('rejects an oversized page', () => {
    expect(listNotesQuery.safeParse({ limit: 5000 }).success).toBe(false);
  });

  it('rejects an unknown sort', () => {
    expect(listNotesQuery.safeParse({ sort: 'random' }).success).toBe(false);
  });

  it('parses comma separated tag filters', () => {
    const result = listNotesQuery.parse({ tagIds: 'a1,b2' });
    expect(result.tagIds).toBe('a1,b2');
  });

  it('bounds the search query length', () => {
    expect(listNotesQuery.safeParse({ q: 'x'.repeat(201) }).success).toBe(false);
  });

  it('trims the search query', () => {
    expect(listNotesQuery.parse({ q: '  hi  ' }).q).toBe('hi');
  });
});

describe('settings patch', () => {
  it('allows a partial update', () => {
    const result = settingsPatchInput.parse({ theme: 'dark' });
    expect(result).toEqual({ theme: 'dark' });
  });

  it('rejects an unknown theme', () => {
    expect(settingsPatchInput.safeParse({ theme: 'neon' }).success).toBe(false);
  });

  it('bounds the font size', () => {
    expect(settingsPatchInput.safeParse({ fontSize: 9 }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ fontSize: 25 }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ fontSize: 16 }).success).toBe(true);
  });

  it('rejects an unknown editor mode', () => {
    expect(settingsPatchInput.safeParse({ editorMode: 'zen' }).success).toBe(false);
    expect(settingsPatchInput.safeParse({ editorMode: 'preview' }).success).toBe(true);
    expect(settingsPatchInput.safeParse({ mainWindowHotkey: 'CommandOrControl+Shift+M' }).success).toBe(
      true,
    );
    expect(settingsPatchInput.safeParse({ mainWindowHotkey: '' }).success).toBe(false);
  });
});
