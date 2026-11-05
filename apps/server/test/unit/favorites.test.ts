import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { detectPlatform, extractPage } from '../../src/favorites/extract.js';
import { isUnsafeAddress, safeFetch } from '../../src/favorites/safeFetch.js';
import { zhihuAppviewUrl } from '../../src/favorites/zhihu.js';

describe('favourite link extraction', () => {
  it('detects the supported platforms', () => {
    expect(detectPlatform('https://www.xiaohongshu.com/explore/abc')).toBe('xiaohongshu');
    expect(detectPlatform('https://xhslink.cn/o/abc')).toBe('xiaohongshu');
    expect(detectPlatform('https://v.douyin.com/abc')).toBe('douyin');
    expect(detectPlatform('https://mp.weixin.qq.com/s/abc')).toBe('wechat');
    expect(detectPlatform('https://example.com/post')).toBe('web');
  });

  it('extracts a WeChat article body and lazy images', () => {
    const html = `<!doctype html><html><head>
      <meta property="og:title" content="测试文章" />
      <meta property="og:image" content="https://cdn.example.com/cover.jpg" />
    </head><body>
      <h1 id="activity-name">测试文章</h1>
      <span id="js_name">作者甲</span>
      <div id="js_content"><p>这是一段足够长的微信公众号正文内容，用来确认提取器不会把它误判为登录拦截页面。</p>
      <img data-src="https://cdn.example.com/a.jpg" /></div>
    </body></html>`;
    const page = extractPage('https://mp.weixin.qq.com/s/test', html);
    expect(page.platform).toBe('wechat');
    expect(page.title).toBe('测试文章');
    expect(page.author).toBe('作者甲');
    expect(page.body).toContain('微信公众号正文');
    expect(page.imageUrls).toContain('https://cdn.example.com/a.jpg');
    expect(page.blocked).toBe(false);
  });

  it('extracts a Xiaohongshu note from the embedded initial state', () => {
    const html = `<!doctype html><html><head><title>小红书</title></head><body>
      <script>window.__INITIAL_STATE__ = ${JSON.stringify({
        note: {
          noteDetailMap: {
            abc: {
              note: {
                title: 'Obsidian 使用心得',
                desc: '卸载了用了将近七年的 Notion，把全部内容迁移到 Obsidian，发现很多插件都很好用，整理成一篇文章分享给大家。',
                user: { nickname: '测试作者' },
                imageList: [{ urlDefault: 'https://cdn.example.com/note-a.jpg' }],
              },
            },
          },
        },
      })}</script>
    </body></html>`;
    const page = extractPage('https://www.xiaohongshu.com/discovery/item/abc', html);
    expect(page.platform).toBe('xiaohongshu');
    expect(page.title).toBe('Obsidian 使用心得');
    expect(page.author).toBe('测试作者');
    expect(page.body).toContain('迁移到 Obsidian');
    expect(page.imageUrls).toContain('https://cdn.example.com/note-a.jpg');
    expect(page.blocked).toBe(false);
  });

  it('extracts a Zhihu article from the app-view initial state', () => {
    const html = `<!doctype html><html><head><title>知乎 - 知乎</title></head><body>
      <div id="root"><h1>页面里的标题</h1></div>
      <script id="js-initialData" type="text/json">${JSON.stringify({
        initialState: {
          post: {
            '123': {
              title: 'Pi 极简 Agent 全攻略',
              content: '<p>这是一段足够长的知乎正文内容，用来确认提取器会优先读取应用内视图里嵌入的文章 JSON，而不是页面上那些导航和按钮。</p><img src="https://picx.zhimg.com/a.jpg" />',
              author: 'author-token',
              contentNeedTruncated: false,
            },
          },
          user: { 'author-token': { name: '测试答主' } },
        },
      })}</script>
    </body></html>`;
    const page = extractPage('https://www.zhihu.com/appview/p/123', html);
    expect(page.title).toBe('Pi 极简 Agent 全攻略');
    expect(page.author).toBe('测试答主');
    expect(page.body).toContain('应用内视图');
    expect(page.imageUrls).toContain('https://picx.zhimg.com/a.jpg');
    expect(page.coverUrl).toBe('https://picx.zhimg.com/a.jpg');
    expect(page.truncated).toBe(false);
    expect(page.blocked).toBe(false);
  });

  it('flags a truncated Zhihu app-view article', () => {
    const html = `<html><body><script id="js-initialData" type="text/json">${JSON.stringify({
      initialState: {
        post: {
          '123': {
            title: '长文',
            content: '<p>只返回了开头这一段，后面的内容因为知乎的未登录限制被截断了。</p>',
            author: 'author-token',
            contentNeedTruncated: true,
          },
        },
        user: { 'author-token': { name: '作者' } },
      },
    })}</script></body></html>`;
    const page = extractPage('https://www.zhihu.com/appview/p/123', html);
    expect(page.truncated).toBe(true);
    expect(page.warnings.join('')).toContain('部分正文');
  });

  it('rewrites Zhihu article links to the app view', () => {
    expect(zhihuAppviewUrl('https://zhuanlan.zhihu.com/p/2072440015578215998')).toBe(
      'https://www.zhihu.com/appview/p/2072440015578215998',
    );
    expect(zhihuAppviewUrl('https://www.zhihu.com/p/123/')).toBe('https://www.zhihu.com/appview/p/123');
    expect(zhihuAppviewUrl('https://www.zhihu.com/question/23811180')).toBeNull();
    expect(zhihuAppviewUrl('https://example.com/p/123')).toBeNull();
  });

  it('marks a login wall as blocked', () => {
    const page = extractPage('https://www.xiaohongshu.com/explore/abc', '<html><body>请登录后查看</body></html>');
    expect(page.blocked).toBe(true);
    expect(page.blockReason).toContain('限制');
  });
});

describe('safe fetch DNS lookup', () => {
  it('uses a browser-like Accept header for page requests', async () => {
    const server = createServer((request, response) => {
      const accept = String(request.headers.accept ?? '');
      if (request.url === '/login') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><html><body>请登录后查看</body></html>');
        return;
      }
      if (!accept.includes('image/avif') || !accept.includes('image/webp')) {
        response.writeHead(302, { location: '/login' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><html><body>公开笔记正文</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    try {
      const result = await safeFetch(`http://localhost:${address.port}/note`, {
        maxBytes: 1024,
        timeoutMs: 5_000,
        allowPrivate: true,
      });
      expect(result.buffer.toString()).toContain('公开笔记正文');
      expect(result.finalUrl).toBe(`http://localhost:${address.port}/note`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('uses a caller-supplied user agent', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(String(request.headers['user-agent'] ?? ''));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    try {
      const result = await safeFetch(`http://localhost:${address.port}/note`, {
        maxBytes: 1024,
        timeoutMs: 5_000,
        allowPrivate: true,
        userAgent: 'Zhihu/10.62.0 (iPhone; iOS 17.0; Scale/3.00)',
      });
      expect(result.buffer.toString()).toBe('Zhihu/10.62.0 (iPhone; iOS 17.0; Scale/3.00)');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('works when Node asks the lookup callback for all addresses', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><body>ok</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('fixture did not bind');
    try {
      const result = await safeFetch(`http://localhost:${address.port}/`, {
        maxBytes: 1024,
        timeoutMs: 5_000,
        allowPrivate: true,
      });
      expect(result.buffer.toString()).toContain('ok');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

describe('SSRF address guards', () => {
  it('rejects loopback, private and metadata ranges', () => {
    expect(isUnsafeAddress('127.0.0.1')).toBe(true);
    expect(isUnsafeAddress('10.0.0.1')).toBe(true);
    expect(isUnsafeAddress('192.168.1.2')).toBe(true);
    expect(isUnsafeAddress('169.254.169.254')).toBe(true);
    expect(isUnsafeAddress('::1')).toBe(true);
  });

  it('allows ordinary public addresses', () => {
    expect(isUnsafeAddress('203.0.113.10')).toBe(false);
    expect(isUnsafeAddress('2606:4700:4700::1111')).toBe(false);
  });
});
