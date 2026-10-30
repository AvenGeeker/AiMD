import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing.
 *
 * Uses `@node-rs/argon2` rather than the `argon2` package: it ships prebuilt NAPI binaries
 * for linux-x64-musl, linux-arm64-musl, darwin and win32, so the Alpine production image
 * never needs a compiler toolchain (which the `argon2` package does).
 *
 * Parameters follow the OWASP argon2id recommendation for an interactive login service.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Hash a password, returning a self-describing PHC string (e.g. `$argon2id$v=19$m=...`). */
export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, { ...ARGON2_OPTIONS });
}

/**
 * Verify a password against a PHC hash.
 *
 * Never throws for a wrong password — returns false. A malformed hash also returns false so
 * a corrupted row can never become an authentication bypass.
 */
export async function verifyPassword(hashString: string, plain: string): Promise<boolean> {
  if (!hashString || !plain) return false;
  try {
    return await verify(hashString, plain);
  } catch {
    return false;
  }
}

/** True when the stored hash uses argon2id (guards the hashing-parameters test). */
export function isArgon2id(hashString: string): boolean {
  return hashString.startsWith('$argon2id$');
}
