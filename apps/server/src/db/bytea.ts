/**
 * bytea helpers.
 *
 * Drizzle has no bytea column type, and the CRDT document is exactly that, so these
 * functions own the encoding/decoding explicitly. Hex encoding is used rather than relying
 * on driver-specific Buffer handling, which keeps the wire format obvious and portable.
 */

/** Encode bytes into the `\\x<hex>` literal form Postgres accepts for bytea. */
export function encodeBytea(bytes: Uint8Array | Buffer): string {
  return `\\x${Buffer.from(bytes as Uint8Array).toString('hex')}`;
}

/**
 * Decode a bytea column value.
 *
 * postgres.js normally returns a `Buffer`, but depending on the query path it can hand back
 * the raw hex/escape text, so both are accepted.
 */
export function decodeBytea(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') {
    if (value.startsWith('\\x')) return new Uint8Array(Buffer.from(value.slice(2), 'hex'));
    // PG "escape" format is not produced by our writes; fall back to latin1 bytes.
    return new Uint8Array(Buffer.from(value, 'latin1'));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}
