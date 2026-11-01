import { createHash } from 'node:crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function noteStateHash(title: string, folderId: string | null, body: string): string {
  return sha256Hex(JSON.stringify([title, folderId, body]));
}

export function appleStateHash(
  title: string,
  folderKey: string,
  body: string,
  attachmentHashes: string[],
): string {
  return sha256Hex(JSON.stringify([title, folderKey, body, attachmentHashes]));
}
