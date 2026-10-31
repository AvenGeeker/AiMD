import type { ISql, Sql } from 'postgres';
import {
  ApiError,
  DEFAULT_SETTINGS,
  ERROR_CODES,
  INBOX_NOTE_TITLE,
  firstKey,
  workspaceDocName,
  type SettingsDto,
  type UserDto,
} from '@aimarkdown/shared';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  DEFAULT_TTLS,
  generateRefreshToken,
  hashRefreshToken,
  newId,
  type TokenVerifier,
  type TokenTtls,
} from '../auth/tokens.js';
import { encodeBytea } from '../db/bytea.js';
import { toDateOr } from '../utils/dates.js';
import { createNoteDoc, createWorkspaceDoc, writeSettings } from '../collab/docFactory.js';
import type { Logger } from '../utils/logger.js';
import * as Y from 'yjs';

/** Registration, login, refresh-token rotation and first-run workspace bootstrap. */

export interface UsersDeps {
  sql: Sql;
  verifier: TokenVerifier;
  log: Logger;
  allowRegistration: boolean;
  ttls?: TokenTtls;
}

export interface Session {
  user: UserDto;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserRowLite {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}

export function toUserDto(row: UserRowLite): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface UserRowWithSecret extends UserRowLite {
  passwordHash: string;
}

export async function findUserByEmail(sql: Sql, email: string): Promise<UserRowWithSecret | null> {
  const rows = await sql`
    select id, email, display_name, password_hash, created_at from users where email = lower(${email})
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    createdAt: toDateOr(row.created_at, new Date(0)),
    passwordHash: String(row.password_hash),
  };
}

export async function findUserById(sql: Sql, userId: string): Promise<UserRowLite | null> {
  const rows = await sql`select id, email, display_name, created_at from users where id = ${userId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    createdAt: toDateOr(row.created_at, new Date(0)),
  };
}

export async function registerUser(
  deps: UsersDeps,
  input: { email: string; password: string; displayName?: string },
): Promise<Session> {
  if (!deps.allowRegistration) {
    throw new ApiError(ERROR_CODES.REGISTRATION_DISABLED, '该服务器已关闭注册');
  }
  const email = input.email.trim().toLowerCase();
  const existing = await deps.sql`select id from users where email = ${email}`;
  if (existing.length > 0) throw new ApiError(ERROR_CODES.EMAIL_TAKEN, '该邮箱已被注册');

  const id = newId();
  const passwordHash = await hashPassword(input.password);
  const displayName = (input.displayName ?? email.split('@')[0] ?? '用户').trim().slice(0, 60) || '用户';
  const now = new Date();

  await deps.sql.begin(async (tx) => {
    await tx`
      insert into users (id, email, password_hash, display_name, is_admin, created_at)
      values (${id}, ${email}, ${passwordHash}, ${displayName}, false, ${now})
    `;
    await seedWorkspace(tx, id, now);
  });

  return issueSession(deps, { id, email, displayName, createdAt: now });
}

/**
 * Create the workspace CRDT document, its settings mirror and the quick-capture inbox note.
 *
 * Runs inside the registration transaction so a new user always has somewhere to write a
 * capture, and so the desktop app can read the hotkey/inbox before the first sync completes.
 */
export async function seedWorkspace(
  tx: ISql,
  userId: string,
  now: Date = new Date(),
): Promise<{ inboxNoteId: string }> {
  const inboxNoteId = newId();
  const workspaceDoc = createWorkspaceDoc({ ...DEFAULT_SETTINGS, inboxNoteId });
  const inboxDoc = createNoteDoc({
    meta: {
      title: INBOX_NOTE_TITLE,
      titleManual: true,
      folderId: null,
      pinned: true,
      archived: false,
      deletedAt: null,
      position: firstKey(),
      createdAt: now.toISOString(),
    },
    body: `# ${INBOX_NOTE_TITLE}\n\n全局快捷键唤出速记窗口，内容会自动追加到这里。\n`,
  });
  const bodyText = inboxDoc.getText('body').toString();

  await tx`
    insert into workspace_documents (user_id, ydoc, updated_at)
    values (${userId}, ${encodeBytea(Y.encodeStateAsUpdate(workspaceDoc))}::bytea, ${now})
    on conflict (user_id) do nothing
  `;

  const settings: SettingsDto = { ...DEFAULT_SETTINGS, inboxNoteId };
  await tx`
    insert into user_settings (user_id, settings, updated_at)
    values (${userId}, ${JSON.stringify(settings)}::jsonb, ${now})
    on conflict (user_id) do update set settings = excluded.settings, updated_at = excluded.updated_at
  `;

  await tx`
    insert into notes (
      id, owner_id, folder_id, title, body_text, is_pinned, is_archived,
      position, word_count, created_at, content_updated_at, updated_at
    ) values (
      ${inboxNoteId}, ${userId}, null, ${INBOX_NOTE_TITLE}, ${bodyText}, true, false,
      ${firstKey()}, ${bodyText.length}, ${now}, ${now}, ${now}
    )
  `;
  await tx`
    insert into note_documents (note_id, ydoc, updated_at)
    values (${inboxNoteId}, ${encodeBytea(Y.encodeStateAsUpdate(inboxDoc))}::bytea, ${now})
  `;

  return { inboxNoteId };
}

/** Make sure an existing user has a workspace doc and an inbox (idempotent upgrade path). */
export async function ensureWorkspace(deps: UsersDeps, userId: string): Promise<void> {
  const existing = await deps.sql`select user_id from workspace_documents where user_id = ${userId}`;
  if (existing.length > 0) return;
  await deps.sql.begin((tx) => seedWorkspace(tx, userId));
  deps.log.info({ userId }, 'seeded missing workspace for existing user');
}

export async function loginUser(
  deps: UsersDeps,
  input: { email: string; password: string },
): Promise<Session> {
  const email = input.email.trim().toLowerCase();
  const rows = await deps.sql`
    select id, email, display_name, password_hash, created_at from users where email = ${email}
  `;
  const row = rows[0];

  // Always run a verify, even for an unknown email, so response timing does not reveal which
  // addresses are registered.
  const hash = row ? String(row.password_hash) : '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await verifyPassword(hash, input.password);
  if (!row || !ok) throw new ApiError(ERROR_CODES.INVALID_CREDENTIALS, '邮箱或密码不正确');

  const user: UserRowLite = {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    createdAt: toDateOr(row.created_at, new Date(0)),
  };
  await ensureWorkspace(deps, user.id);
  return issueSession(deps, user);
}

export async function issueSession(deps: UsersDeps, user: UserRowLite, userAgent?: string): Promise<Session> {
  const ttls = deps.ttls ?? DEFAULT_TTLS;
  const accessToken = await deps.verifier.signAccessToken(user.id, user.email, ttls);
  const rawRefresh = generateRefreshToken();

  await deps.sql`
    insert into refresh_tokens (id, user_id, token_hash, expires_at, user_agent, created_at)
    values (
      ${newId()}, ${user.id}, ${hashRefreshToken(rawRefresh)},
      ${new Date(Date.now() + ttls.refreshSeconds * 1000)}, ${userAgent ?? null}, now()
    )
  `;

  return { user: toUserDto(user), accessToken, refreshToken: rawRefresh, expiresIn: ttls.accessSeconds };
}

/**
 * Rotate a refresh token: the presented token is revoked and a new one is issued.
 *
 * Rotation means a stolen refresh token can only be used once — a replay by the attacker or
 * the legitimate user surfaces as an already-reoked token, which is a strong compromise signal.
 */
export async function refreshSession(
  deps: UsersDeps,
  rawToken: string,
  userAgent?: string,
): Promise<Session> {
  if (!rawToken) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '缺少刷新令牌');
  const tokenHash = hashRefreshToken(rawToken);

  const rows = await deps.sql`
    select rt.id, rt.revoked_at, rt.expires_at, u.id as uid, u.email, u.display_name, u.created_at
    from refresh_tokens rt join users u on u.id = rt.user_id
    where rt.token_hash = ${tokenHash}
  `;
  const row = rows[0];
  if (!row) throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '刷新令牌无效');

  if (row.revoked_at) {
    // A revoked token being presented again means it was copied. Revoke the whole family.
    await deps.sql`update refresh_tokens set revoked_at = now() where user_id = ${String(row.uid)} and revoked_at is null`;
    deps.log.warn({ userId: String(row.uid) }, 'refresh token replay detected; revoked all sessions');
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, '刷新令牌已失效');
  }
  if (toDateOr(row.expires_at, new Date(0)).getTime() < Date.now()) {
    throw new ApiError(ERROR_CODES.TOKEN_EXPIRED, '刷新令牌已过期');
  }

  await deps.sql`update refresh_tokens set revoked_at = now() where id = ${String(row.id)}`;

  return issueSession(
    deps,
    {
      id: String(row.uid),
      email: String(row.email),
      displayName: String(row.display_name),
      createdAt: toDateOr(row.created_at, new Date(0)),
    },
    userAgent,
  );
}

export async function revokeRefreshToken(deps: UsersDeps, rawToken: string | null): Promise<void> {
  if (!rawToken) return;
  await deps.sql`
    update refresh_tokens set revoked_at = now()
    where token_hash = ${hashRefreshToken(rawToken)} and revoked_at is null
  `;
}

export async function revokeAllSessions(deps: UsersDeps, userId: string): Promise<void> {
  await deps.sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
}

/** Create the bootstrap admin from deploy-time env vars, if it does not exist yet. */
export async function ensureBootstrapAdmin(
  deps: UsersDeps,
  email: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!email || !password) return false;
  const normalised = email.trim().toLowerCase();
  const existing = await deps.sql`select id from users where email = ${normalised}`;
  if (existing.length > 0) {
    await deps.sql`update users set is_admin = true where email = ${normalised}`;
    return false;
  }
  const id = newId();
  const now = new Date();
  await deps.sql.begin(async (tx) => {
    await tx`
      insert into users (id, email, password_hash, display_name, is_admin, created_at)
      values (${id}, ${normalised}, ${await hashPassword(password)}, ${'管理员'}, true, ${now})
    `;
    await seedWorkspace(tx, id, now);
  });
  deps.log.info({ email: normalised }, 'bootstrap admin created');
  return true;
}

/** Re-exported so callers can patch settings inside the workspace doc without importing Yjs. */
export { writeSettings, workspaceDocName };
