import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { ApiError, ERROR_CODES } from '@aimarkdown/shared';

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a = 0, b = 0] = parts;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return (
    value === '::1' ||
    value === '::' ||
    value.startsWith('fc') ||
    value.startsWith('fd') ||
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb') ||
    value.startsWith('::ffff:127.') ||
    value.startsWith('::ffff:10.') ||
    value.startsWith('::ffff:192.168.')
  );
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

/**
 * Reject custom endpoints that would turn the AI proxy into an SSRF primitive.
 *
 * Local models can be enabled explicitly with AI_ALLOW_PRIVATE_BASE_URL=true, which is also what
 * the integration/E2E suites use for their loopback fake providers.
 */
export async function assertSafeAiBaseUrl(raw: string, allowPrivate: boolean): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址格式不正确');
  }
  if (url.username || url.password) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址不能包含用户名或密码');
  }
  const isHttp = url.protocol === 'http:';
  const isHttps = url.protocol === 'https:';
  if (!isHttps && !(allowPrivate && isHttp)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址必须使用 HTTPS');
  }
  if (allowPrivate) return;

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址不能指向本机或内网');
  }
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址不能指向本机或内网');
    }
    return;
  }

  let addresses: Array<{ address: string }> = [];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址无法解析');
  }
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'AI 接口地址不能指向本机或内网');
  }
}
