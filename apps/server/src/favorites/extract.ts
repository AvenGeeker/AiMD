import { Readability } from '@mozilla/readability';
import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { parseHTML } from 'linkedom';
import type { SourcePlatform } from '@aimarkdown/shared';

export interface ExtractedPage {
  platform: SourcePlatform;
  title: string;
  author: string | null;
  body: string;
  coverUrl: string | null;
  imageUrls: string[];
  videoUrl: string | null;
  blocked: boolean;
  blockReason: string | null;
  warnings: string[];
}

type DomDocument = ReturnType<typeof parseHTML>['document'];
type DomElement = DomDocument['body'];

const BLOCK_MARKERS = ['验证码', '登录后查看', '打开app', '打开 App', '安全验证', '环境异常', '滑动验证'];

export function detectPlatform(rawUrl: string): SourcePlatform {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return 'web';
  }
  if (host.includes('xiaohongshu.com') || host.includes('xhslink.com') || host.includes('xhslink.cn')) {
    return 'xiaohongshu';
  }
  if (host.includes('douyin.com') || host.includes('iesdouyin.com')) return 'douyin';
  if (host === 'mp.weixin.qq.com' || host.endsWith('.weixin.qq.com')) return 'wechat';
  return 'web';
}

function absolute(url: string, base: string): string | null {
  try {
    const parsed = new URL(url, base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function textOf(document: DomDocument, selector: string): string | null {
  const element = document.querySelector(selector);
  const text = element?.textContent?.replace(/\s+/g, ' ').trim();
  return text || null;
}

function metaOf(document: DomDocument, names: string[]): string | null {
  for (const name of names) {
    const element = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    const content = element?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return null;
}

function normalizeImages(root: DomElement, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const image of Array.from(root.querySelectorAll('img')) as DomElement[]) {
    const raw = image.getAttribute('data-src') || image.getAttribute('data-original') || image.getAttribute('src');
    const resolved = raw ? absolute(raw, baseUrl) : null;
    if (!resolved) {
      image.remove();
      continue;
    }
    image.setAttribute('src', resolved);
    image.removeAttribute('data-src');
    image.removeAttribute('data-original');
    for (const attribute of Array.from(image.attributes) as Array<{ name: string }>) {
      if (attribute.name.startsWith('on')) image.removeAttribute(attribute.name);
    }
    const width = Number(image.getAttribute('width') ?? 0);
    const height = Number(image.getAttribute('height') ?? 0);
    if ((width > 0 && width <= 2) || (height > 0 && height <= 2)) {
      image.remove();
      continue;
    }
    urls.push(resolved);
  }
  return [...new Set(urls)];
}

function findObjectWithKey(root: unknown, keys: string[], depth = 0): Record<string, unknown> | null {
  if (!root || typeof root !== 'object' || depth > 8) return null;
  const record = root as Record<string, unknown>;
  if (keys.every((key) => key in record)) return record;
  for (const value of Object.values(record)) {
    const found = findObjectWithKey(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

function parseScriptJson(document: DomDocument, needle: string): unknown {
  for (const script of Array.from(document.querySelectorAll('script')) as DomElement[]) {
    const text = script.textContent ?? '';
    if (!text.includes(needle)) continue;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(text.slice(start, end + 1).replace(/\bundefined\b/g, 'null'));
    } catch {
      continue;
    }
  }
  return null;
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function imageListOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const url = pickString(record.urlDefault) ?? pickString(record.url) ?? pickString(record.urlPre);
      if (url) out.push(url);
    }
  }
  return out;
}

function makeMarkdown(html: string, baseUrl: string): { body: string; imageUrls: string[] } {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const root = document.body as DomElement;
  const imageUrls = normalizeImages(root, baseUrl);
  const clean = sanitizeHtml(root.innerHTML, {
    allowedTags: [
      'article', 'section', 'div', 'p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'strong', 'em', 'b', 'i', 'u', 's',
      'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    },
  });
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  turndown.use(gfm);
  return { body: turndown.turndown(clean).trim(), imageUrls };
}

export function extractPage(rawUrl: string, html: string): ExtractedPage {
  const platform = detectPlatform(rawUrl);
  const { document } = parseHTML(html);
  const warnings: string[] = [];
  let title = metaOf(document, ['og:title', 'twitter:title']) ?? textOf(document, 'title') ?? '无标题';
  let author = metaOf(document, ['author', 'og:article:author', 'og:site_name']);
  let coverUrl = metaOf(document, ['og:image', 'twitter:image']);
  let contentHtml: string | null = null;
  let videoUrl: string | null = null;

  if (platform === 'wechat') {
    const content = document.querySelector('#js_content');
    if (content) contentHtml = content.innerHTML;
    title = textOf(document, '#activity-name') ?? title;
    author = textOf(document, '#js_name') ?? author;
    coverUrl = metaOf(document, ['og:image', 'twitter:image']) ?? coverUrl;
  } else if (platform === 'xiaohongshu') {
    const state = parseScriptJson(document, '__INITIAL_STATE__');
    const note = state ? findObjectWithKey(state, ['title', 'desc']) : null;
    if (note) {
      title = pickString(note.title) ?? title;
      author = pickString((note.user as Record<string, unknown> | undefined)?.nickname) ?? author;
      const images = imageListOf(note.imageList);
      const desc = pickString(note.desc) ?? '';
      contentHtml = `${desc ? `<p>${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''}${images
        .map((url) => `<img src="${url}" alt="" />`)
        .join('')}`;
      coverUrl = images[0] ?? coverUrl;
      const video = note.video as Record<string, unknown> | undefined;
      const media = video?.media as Record<string, unknown> | undefined;
      const stream = media?.stream as Record<string, unknown> | undefined;
      const h264 = Array.isArray(stream?.h264) ? (stream.h264[0] as Record<string, unknown>) : null;
      videoUrl = pickString(h264?.masterUrl);
    }
  } else if (platform === 'douyin') {
    const state =
      parseScriptJson(document, '_ROUTER_DATA') ??
      parseScriptJson(document, 'RENDER_DATA') ??
      parseScriptJson(document, '__INITIAL_STATE__');
    const item = state ? findObjectWithKey(state, ['desc', 'video']) : null;
    if (item) {
      title = pickString(item.desc)?.slice(0, 120) ?? title;
      author = pickString((item.author as Record<string, unknown> | undefined)?.nickname) ?? author;
      const video = item.video as Record<string, unknown> | undefined;
      const cover = video?.cover as Record<string, unknown> | undefined;
      const coverList = Array.isArray(cover?.url_list) ? cover.url_list : [];
      coverUrl = pickString(coverList[0]) ?? coverUrl;
      const play = video?.play_addr as Record<string, unknown> | undefined;
      const playList = Array.isArray(play?.url_list) ? play.url_list : [];
      videoUrl = pickString(playList[0]);
      const images = imageListOf(item.images);
      const desc = pickString(item.desc) ?? '';
      if (desc || images.length > 0) {
        contentHtml = `${desc ? `<p>${desc.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''}${images
          .map((url) => `<img src="${url}" alt="" />`)
          .join('')}`;
      }
    }
  }

  if (!contentHtml) {
    try {
      const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 120 }).parse();
      if (article?.content) contentHtml = article.content;
      if (article?.title) title = article.title;
      if (article?.byline) author = article.byline;
    } catch {
      warnings.push('网页结构无法按正文模式解析。');
    }
  }

  const content = contentHtml ? makeMarkdown(contentHtml, rawUrl) : { body: '', imageUrls: [] };
  const flat = content.body.replace(/\s+/g, ' ').trim();
  const blocked =
    flat.length < 60 ||
    BLOCK_MARKERS.some((marker) => flat.toLowerCase().includes(marker.toLowerCase()));
  if (blocked) warnings.push('目标平台可能要求登录或触发了安全验证，可粘贴正文后保存。');

  return {
    platform,
    title: title.trim().slice(0, 200) || '无标题',
    author: author?.trim().slice(0, 120) || null,
    body: content.body,
    coverUrl: coverUrl ? absolute(coverUrl, rawUrl) : null,
    imageUrls: content.imageUrls,
    videoUrl: videoUrl ? absolute(videoUrl, rawUrl) : null,
    blocked,
    blockReason: blocked ? '未能提取到正文，平台可能限制了自动抓取' : null,
    warnings,
  };
}
