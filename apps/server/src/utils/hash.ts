import { createHash } from 'node:crypto';

/** Lower-case SHA-256 hex used by the desktop sync optimistic-concurrency guard. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** The single definition of an app note's mirrored-state hash. */
export function noteStateHash(title: string, folderId: string | null, body: string): string {
  return sha256Hex(JSON.stringify([title, folderId, body]));
}
