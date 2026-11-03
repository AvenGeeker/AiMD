import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { ApiError, ERROR_CODES } from '@aimarkdown/shared';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36 AiMD/0.1';

/**
 * A real Chrome page navigation Accept header. Some sites (notably Xiaohongshu) answer a
 * stripped-down curl-like Accept with a login redirect even though the shared note is public.
 */
export const PAGE_ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,' +
  'image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';

export interface SafeFetchResult {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs: number;
  referer?: string;
  accept?: string;
  allowPrivate?: boolean;
}

function privateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function privateIpv6(address: string): boolean {
  const value = address.toLowerCase();
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) {
    return true;
  }
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? privateIpv4(mapped[1]!) : false;
}

export function isUnsafeAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family === 6) return privateIpv6(address);
  return true;
}

function validateUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(ERROR_CODES.FETCH_UNSAFE_URL, '链接格式不正确');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(ERROR_CODES.FETCH_UNSAFE_URL, '只支持 http/https 链接');
  }
  if (url.username || url.password) {
    throw new ApiError(ERROR_CODES.FETCH_UNSAFE_URL, '链接不能包含用户名或密码');
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (!allowPrivate && port !== '80' && port !== '443') {
    throw new ApiError(ERROR_CODES.FETCH_UNSAFE_URL, '只允许 80/443 端口');
  }
  return url;
}

async function resolveSafe(url: URL, allowPrivate: boolean): Promise<Array<{ address: string; family: number }>> {
  if (!allowPrivate && (url.hostname === 'localhost' || url.hostname.endsWith('.localhost'))) {
    throw new ApiError(ERROR_CODES.FETCH_UNSAFE_URL, '不允许访问本机地址');
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(ERROR_CODES.FETCH_FAILED, '无法解析链接域名');
  }
  if (addresses.length === 0) throw new ApiError(ERROR_CODES.FETCH_FAILED, '链接域名没有可用地址');
  if (!allowPrivate && addresses.some((item) => isUnsafeAddress(item.address))) {
    throw new ApiError(ERROR_CODES.FETCH_UNSAFE_URL, '不允许访问内网、回环或保留地址');
  }
  return addresses;
}

function once(url: URL, addresses: Array<{ address: string; family: number }>, options: SafeFetchOptions): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  buffer: Buffer;
  finalUrl: string;
}> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: options.timeoutMs,
        headers: {
          'user-agent': USER_AGENT,
          accept: options.accept ?? PAGE_ACCEPT,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
          ...(options.referer ? { referer: options.referer } : {}),
        },
        lookup: (_hostname, lookupOptions, callback) => {
          const family = typeof lookupOptions === 'object' ? lookupOptions.family : undefined;
          const candidates = family ? addresses.filter((item) => item.family === family) : addresses;
          if (candidates.length === 0) {
            callback(new Error('no safe address'), '', 0);
            return;
          }
          if (typeof lookupOptions === 'object' && lookupOptions.all === true) {
            callback(
              null,
              candidates.map((item) => ({ address: item.address, family: item.family })) as never,
            );
          } else {
            callback(null, candidates[0]!.address, candidates[0]!.family);
          }
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const headers = response.headers;
        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > options.maxBytes) {
            response.destroy(new ApiError(ERROR_CODES.FETCH_TOO_LARGE, '页面或媒体文件超过大小限制'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ status, headers, buffer: Buffer.concat(chunks), finalUrl: url.toString() });
        });
        response.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new ApiError(ERROR_CODES.FETCH_FAILED, '抓取链接超时')));
    req.on('error', (error) => {
      reject(
        error instanceof ApiError
          ? error
          : new ApiError(ERROR_CODES.FETCH_FAILED, `抓取链接失败：${error.message.slice(0, 160)}`),
      );
    });
    req.end();
  });
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const allowPrivate = options.allowPrivate === true;
  let url = validateUrl(rawUrl, allowPrivate);
  for (let redirect = 0; redirect <= 5; redirect++) {
    const addresses = await resolveSafe(url, allowPrivate);
    const result = await once(url, addresses, options);
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.location;
      const next = Array.isArray(location) ? location[0] : location;
      if (!next) throw new ApiError(ERROR_CODES.FETCH_FAILED, '重定向缺少目标地址');
      url = validateUrl(new URL(next, url).toString(), allowPrivate);
      continue;
    }
    if (result.status >= 400) {
      throw new ApiError(ERROR_CODES.FETCH_FAILED, `目标站点返回 ${result.status}`);
    }
    const contentType = String(result.headers['content-type'] ?? '').toLowerCase();
    return { buffer: result.buffer, contentType, finalUrl: result.finalUrl };
  }
  throw new ApiError(ERROR_CODES.FETCH_FAILED, '重定向次数过多');
}
