import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { customAlphabet } from 'nanoid';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS } from '@aimarkdown/shared';

/**
 * Token issuing and verification, shared by the REST API and the Hocuspocus WebSocket.
 *
 * `jose` is used instead of `@fastify/jwt` so the exact same verification code path guards
 * both HTTP requests and collaboration connections — one implementation, one set of tests.
 */

const NANO_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
const generateId = customAlphabet(NANO_ALPHABET, 21);
const generateRefresh = customAlphabet(NANO_ALPHABET, 48);

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  email: string;
  typ: 'access';
}

export interface TokenTtls {
  accessSeconds: number;
  refreshSeconds: number;
}

export const DEFAULT_TTLS: TokenTtls = {
  accessSeconds: ACCESS_TOKEN_TTL_SECONDS,
  refreshSeconds: REFRESH_TOKEN_TTL_SECONDS,
};

export class TokenVerifier {
  private readonly key: Uint8Array;
  private readonly issuer: string;

  constructor(secret: string, issuer = 'aimarkdown') {
    if (typeof secret !== 'string' || secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.key = new TextEncoder().encode(secret);
    this.issuer = issuer;
  }

  /** Sign a short-lived access token for a user. */
  async signAccessToken(userId: string, email: string, ttls: TokenTtls = DEFAULT_TTLS): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ email, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.issuer)
      .setIssuedAt(now)
      .setExpirationTime(now + ttls.accessSeconds)
      .setJti(generateId())
      .sign(this.key);
  }

  /** Verify an access token. Returns the claims, or null when invalid/expired. */
  async verifyAccessToken(token: string | null | undefined): Promise<AccessTokenClaims | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.issuer,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') return null;
      return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
        typ: 'access',
      };
    } catch (error) {
      if (error instanceof joseErrors.JWTExpired) return null;
      return null;
    }
  }

  /** Distinguish "expired" from "garbage" so clients know whether to refresh. */
  async inspectExpired(token: string): Promise<boolean> {
    try {
      await jwtVerify(token, this.key, { issuer: this.issuer, algorithms: ['HS256'] });
      return false;
    } catch (error) {
      return error instanceof joseErrors.JWTExpired;
    }
  }
}

/** Opaque refresh token: the raw value goes to the client, only its hash is stored. */
export function generateRefreshToken(): string {
  return generateRefresh();
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function newId(): string {
  return generateId();
}

/** Constant-length random string used for CSRF-ish state and one-shot codes. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
