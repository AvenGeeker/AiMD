import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { ApiError, ERROR_CODES } from '@aimarkdown/shared';

/**
 * Attachment storage.
 *
 * Backed by the local filesystem (a Docker volume in production). Everything goes through this
 * interface so an S3/MinIO adapter can be dropped in later without touching the routes.
 */

export interface StoredAttachment {
  size: number;
}

export interface AttachmentStorage {
  readonly kind: 'local' | 's3';
  init(): Promise<void>;
  save(key: string, data: Uint8Array): Promise<StoredAttachment>;
  read(key: string): Promise<Uint8Array | null>;
  openStream(key: string): Promise<Readable | null>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** Reject anything that could escape the storage root. */
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new ApiError(ERROR_CODES.BAD_REQUEST, '非法的存储键');
  }
}

export function createLocalStorage(rootDir: string): AttachmentStorage {
  const root = resolve(rootDir);

  const full = (key: string): string => {
    assertSafeKey(key);
    const target = resolve(join(root, key));
    // Belt and braces: the resolved path must stay inside the root.
    if (target !== root && !target.startsWith(root + sep)) {
      throw new ApiError(ERROR_CODES.BAD_REQUEST, '非法的存储键');
    }
    return target;
  };

  return {
    kind: 'local',

    async init() {
      await mkdir(root, { recursive: true });
    },

    async save(key, data) {
      const target = full(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      return { size: data.byteLength };
    },

    async read(key) {
      try {
        return await readFile(full(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },

    async openStream(key) {
      const target = full(key);
      try {
        await stat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const { createReadStream } = await import('node:fs');
      return createReadStream(target);
    },

    async remove(key) {
      await rm(full(key), { force: true });
    },

    async exists(key) {
      try {
        await stat(full(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** In-memory storage for tests. */
export function createMemoryStorage(): AttachmentStorage & { dump(): Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    kind: 'local',
    dump: () => files,
    async init() {},
    async save(key, data) {
      assertSafeKey(key);
      files.set(key, data);
      return { size: data.byteLength };
    },
    async read(key) {
      assertSafeKey(key);
      return files.get(key) ?? null;
    },
    async openStream(key) {
      const data = await this.read(key);
      return data ? Readable.from(Buffer.from(data)) : null;
    },
    async remove(key) {
      assertSafeKey(key);
      files.delete(key);
    },
    async exists(key) {
      assertSafeKey(key);
      return files.has(key);
    },
  };
}
