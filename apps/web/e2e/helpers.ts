import { expect, type Page } from '@playwright/test';

/** Shared E2E helpers. */

let counter = 0;
export function uniqueEmail(prefix = 'e2e'): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/** Register through the UI and land on the workspace. */
export async function registerThroughUi(page: Page, email = uniqueEmail()): Promise<string> {
  await page.goto('/');
  await page.getByTestId('auth-view').waitFor();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('password123');
  // The form defaults to login; switch to the register tab. Targeted by test id because the tab
  // and the submit button can share a visible label.
  await page.getByTestId('auth-mode-register').click();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  return email;
}

export async function loginThroughUi(page: Page, email: string, password = 'password123'): Promise<void> {
  await page.goto('/');
  await page.getByTestId('auth-view').waitFor();
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('auth-mode-login').click();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 20_000 });
}

/**
 * Create a note through the UI and return its id.
 *
 * The id is read from the workspace's `data-active-note-id` attribute rather than inferred from the
 * note list: the inbox note is pinned and always sorts first, and the list may not have finished
 * loading when a test starts, so both "take the first row" and "diff the rows" are unreliable.
 */
export async function createNote(page: Page): Promise<string> {
  const workspace = page.getByTestId('workspace');
  // The inbox is auto-selected shortly after registration. Wait for that initial selection to
  // settle before recording the baseline; otherwise this helper can mistake the inbox selection
  // for the newly created note under load.
  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'the initial note should be selected before creating another one',
    })
    .not.toBe('');
  const previous = (await workspace.getAttribute('data-active-note-id')) ?? '';

  await page.getByTestId('new-note').click();

  await expect
    .poll(async () => (await workspace.getAttribute('data-active-note-id')) ?? '', {
      timeout: 20_000,
      message: 'a new note should become the active one',
    })
    .not.toBe(previous);

  const id = (await workspace.getAttribute('data-active-note-id')) ?? '';
  expect(id).toBeTruthy();
  expect(id).not.toBe(previous);

  await expect(page.locator(`[data-testid="note-item-${id}"]`)).toBeVisible();
  await waitForEditorBound(page, id);
  return id;
}

/**
 * Wait until the mounted CodeMirror instance is bound to `noteId`.
 *
 * The editor view is destroyed and recreated when the selection changes. Until that has happened,
 * `.cm-content` still belongs to the *previous* note, and typing would silently edit the wrong
 * document — which looks exactly like a sync bug.
 */
export async function waitForEditorBound(page: Page, noteId: string): Promise<void> {
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('editor-host')).toHaveAttribute('data-note-id', noteId, {
    timeout: 20_000,
  });
}

/** Type into the CodeMirror editor. CodeMirror needs real key events, not fill(). */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+KeyA');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(text, { delay: 5 });
}

export async function editorText(page: Page): Promise<string> {
  return page.locator('.cm-content').innerText();
}

/** Wait until the collaboration status pill reports a given state. */
export async function expectSyncStatus(page: Page, status: 'connected' | 'disconnected' | 'connecting'): Promise<void> {
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', status);
}

/**
 * Install a fake Electron preload bridge so the web bundle takes its desktop code path.
 *
 * Must be called before `page.goto()`: `addInitScript` only runs on subsequent navigations.
 */
export async function stubDesktopBridge(page: Page, initialServerUrl: string): Promise<void> {
  await page.addInitScript((serverUrl) => {
    const state = { serverUrl, accessToken: null as string | null, refreshToken: null as string | null };
    (window as unknown as { aiMarkdown: unknown }).aiMarkdown = {
      platform: 'darwin',
      appVersion: 'test',
      getServerUrl: async () => state.serverUrl,
      setServerUrl: async (url: string) => {
        state.serverUrl = url;
      },
      getTokens: async () => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      setTokens: async (tokens: { accessToken: string | null; refreshToken: string | null }) => {
        state.accessToken = tokens.accessToken;
        state.refreshToken = tokens.refreshToken;
      },
      setHotkey: async () => ({ ok: true }),
      getHotkeyState: async () => ({ accelerator: 'Alt+Space', registered: true }),
      showMainWindow: async () => {},
      hideQuickCapture: async () => {},
    };
  }, initialServerUrl);
}

/**
 * Answer `GET {origin}/api/health` without touching the network.
 *
 * Saving a server address probes it first, so tests that switch to an example.com host have to
 * stub the probe or the change is (correctly) refused.
 */
export async function stubServerHealth(
  page: Page,
  origin: string,
  response: { status?: number; body?: unknown; contentType?: string } = {},
): Promise<void> {
  const body = response.body ?? {
    status: 'ok',
    version: '0.1.0',
    uptimeSeconds: 1,
    db: 'ok',
    collab: 'ok',
  };
  await page.route(`${origin.replace(/\/+$/, '')}/api/health`, (route) =>
    route.fulfill({
      status: response.status ?? 200,
      contentType: response.contentType ?? 'application/json',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

/* ------------------------------- touch gestures ------------------------------ */

/**
 * Real (trusted) touch input over an element.
 *
 * The mobile list gestures are driven by native `touchstart/move/end` listeners, and Playwright's
 * `touchscreen` API can only tap. Dispatching through CDP produces trusted events with genuine
 * timestamps, which the swipe recogniser needs for its flick-velocity branch. A synthetic
 * `TouchEvent` fallback keeps the helpers usable on browsers without a CDP session.
 */

async function elementCentre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function cdpTouchDrag(
  page: Page,
  from: { x: number; y: number },
  options: { dx: number; dy?: number; steps?: number; durationMs?: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const steps = Math.max(options.steps ?? 12, 2);
  const dy = options.dy ?? 0;
  const perStep = (options.durationMs ?? 320) / steps;
  try {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y, id: 1 }],
    });
    for (let step = 1; step <= steps; step += 1) {
      await page.waitForTimeout(perStep);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: from.x + (options.dx * step) / steps, y: from.y + (dy * step) / steps, id: 1 },
        ],
      });
    }
    await page.waitForTimeout(30);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

async function syntheticTouchDrag(
  page: Page,
  selector: string,
  options: { dx: number; dy?: number; steps?: number; durationMs?: number },
): Promise<void> {
  await page.evaluate(
    async ({ target, dx, dy, steps, durationMs }) => {
      const element = document.querySelector(target);
      if (!element) throw new Error(`missing ${target}`);
      const box = element.getBoundingClientRect();
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      const perStep = (durationMs ?? 320) / steps;
      const touch = (x: number, y: number) =>
        new Touch({ identifier: 1, target: element, clientX: x, clientY: y });
      const fire = (type: string, x: number, y: number) => {
        const list = type === 'touchend' ? [] : [touch(x, y)];
        element.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: list,
            targetTouches: list,
            changedTouches: [touch(x, y)],
          }),
        );
      };
      fire('touchstart', startX, startY);
      for (let step = 1; step <= steps; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, perStep));
        fire('touchmove', startX + (dx * step) / steps, startY + ((dy ?? 0) * step) / steps);
      }
      fire('touchend', startX + dx, startY + (dy ?? 0));
    },
    { target: selector, dx: options.dx, dy: options.dy ?? 0, steps: options.steps ?? 12, durationMs: options.durationMs ?? 320 },
  );
}

/** Drag from the centre of `selector` by `dx`/`dy` CSS pixels. */
export async function touchDrag(
  page: Page,
  selector: string,
  options: { dx: number; dy?: number; steps?: number; durationMs?: number },
): Promise<void> {
  try {
    const from = await elementCentre(page, selector);
    await cdpTouchDrag(page, from, options);
  } catch {
    await syntheticTouchDrag(page, selector, options);
  }
}

/**
 * Reveal a row's swipe actions (slow drag, no flick) or commit the full-swipe delete (fast drag).
 *
 * `dx` past about -260, or a fast drag past -160, commits the delete instead of revealing.
 */
export async function swipeRow(
  page: Page,
  testId: string,
  dx: number,
  options: { durationMs?: number } = {},
): Promise<void> {
  await touchDrag(page, `[data-testid="${testId}"]`, {
    dx,
    durationMs: options.durationMs ?? (dx < -200 ? 120 : 420),
  });
}

/** Press and hold without moving: enters multi-select on the touch surfaces. */
export async function longPress(page: Page, testId: string, ms = 650): Promise<void> {
  const selector = `[data-testid="${testId}"]`;
  const from = await elementCentre(page, selector);
  try {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: from.x, y: from.y, id: 1 }],
      });
      await page.waitForTimeout(ms);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await client.detach();
    }
  } catch {
    await page.evaluate(
      async ({ target, hold }) => {
        const element = document.querySelector(target);
        if (!element) throw new Error(`missing ${target}`);
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const touch = () => [new Touch({ identifier: 1, target: element, clientX: x, clientY: y })];
        element.dispatchEvent(
          new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: touch(), targetTouches: touch(), changedTouches: touch() }),
        );
        await new Promise((resolve) => setTimeout(resolve, hold));
        element.dispatchEvent(
          new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: touch() }),
        );
      },
      { target: selector, hold: ms },
    );
  }
}

/** Read a note straight from the REST API: the editor DOM is virtualised, the server is not. */
export async function fetchNote(
  page: Page,
  id: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await page.request.get(`/api/notes/${id}`);
  if (!response.ok()) return { status: response.status(), body: {} };
  return { status: response.status(), body: (await response.json()) as Record<string, unknown> };
}

/** List note ids from the server for a filter, used to assert what a batch operation did. */
export async function listNoteIds(
  page: Page,
  query: Record<string, string> = {},
): Promise<string[]> {
  const response = await page.request.get('/api/notes', { params: query });
  if (!response.ok()) return [];
  const payload = (await response.json()) as { items: { id: string }[] };
  return payload.items.map((item) => item.id);
}
