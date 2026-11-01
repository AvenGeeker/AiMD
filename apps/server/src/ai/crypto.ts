import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const AAD_PREFIX = 'aimarkdown-ai-config:';

function deriveKey(secret: string): Buffer {
  const derived = hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('aimarkdown-ai-credentials', 'utf8'),
    Buffer.from('v1', 'utf8'),
    32,
  );
  return Buffer.from(derived);
}

function aad(userId: string): Buffer {
  return Buffer.from(`${AAD_PREFIX}${userId}`, 'utf8');
}

/** Encrypt a provider key with AES-256-GCM. Ciphertext is bound to the owning user id. */
export function encryptSecret(plaintext: string, secret: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  cipher.setAAD(aad(userId));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

/** Decrypt a stored provider key. A different user id or secret fails authentication. */
export function decryptSecret(payload: string, secret: string, userId: string): string {
  const [version, ivText, tagText, dataText] = payload.split('.');
  if (version !== VERSION || !ivText || !tagText || !dataText) {
    throw new Error('AI 密钥格式不正确');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

/** Display only enough of a key to identify it; the middle never reaches the browser. */
export function maskApiKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key.length <= 6) return `${key.slice(0, 1)}…${key.slice(-1)}`;
  return `${key.slice(0, 3)}…${key.slice(-3)}`;
}

/** Stable non-secret fingerprint used only for diagnostics. */
export function secretFingerprint(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 8);
}
