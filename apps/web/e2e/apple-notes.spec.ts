import { expect, test } from '@playwright/test';
import { registerThroughUi } from './helpers.js';

test('macOS Notes button opens settings, previews, and applies', async ({ page, baseURL }) => {
  expect(baseURL).toBeTruthy();
  await page.addInitScript((serverUrl) => {
    let settings = {
      enabled: false,
      schedule: '30m',
      syncOnLaunch: true,
      firstSyncConfirmedAt: null as string | null,
    };
    let status = {
      settings,
      permission: 'granted',
      phase: 'idle',
      running: false,
      progress: null,
      lastSyncAt: null,
      lastResult: null,
      pendingPreview: false,
      conflictCount: 0,
      readOnlyCount: 0,
      error: null,
    };
    const tokens = { accessToken: null as string | null, refreshToken: null as string | null };
    const refresh = () => {
      status = { ...status, settings };
      return status;
    };
    const preview = {
      token: 'preview-1',
      createdAt: new Date().toISOString(),
      counts: { appNotes: 4, appleNotes: 6, appFolders: 1, appleFolders: 2, attachments: 3, readOnly: 1 },
      plan: {
        createAppNotes: 6, createAppleNotes: 4, updateAppNotes: 0, updateAppleNotes: 0,
        trashAppNotes: 0, trashAppleNotes: 0, createAppFolders: 2, createAppleFolders: 1,
        moveAppFolders: 0, moveAppleFolders: 0, deleteAppFolders: 0, deleteAppleFolders: 0,
        uploadAttachments: 3, downloadAttachments: 2, conflicts: 0, readOnly: 1,
        uploadBytes: 100, downloadBytes: 200,
      },
      warnings: ['绘图笔记：附件无法导出'],
      samples: [{ direction: 'apple-to-app', title: '周会纪要' }],
    };
    (window as unknown as { aiMarkdown: unknown }).aiMarkdown = {
      platform: 'darwin',
      appVersion: 'test',
      getServerUrl: async () => serverUrl,
      setServerUrl: async () => {},
      getTokens: async () => tokens,
      setTokens: async (next: { accessToken: string | null; refreshToken: string | null }) => {
        tokens.accessToken = next.accessToken;
        tokens.refreshToken = next.refreshToken;
      },
      refreshSession: async () => null,
      setHotkey: async () => ({ ok: true }),
      getHotkeyState: async () => ({ accelerator: 'Alt+Space', registered: true }),
      showMainWindow: async () => {},
      hideQuickCapture: async () => {},
      appleNotes: {
        getStatus: async () => refresh(),
        setSettings: async (patch: Record<string, unknown>) => {
          settings = { ...settings, ...patch } as typeof settings;
          return refresh();
        },
        probe: async () => refresh(),
        preview: async () => {
          status = { ...status, pendingPreview: true, phase: 'preview' };
          return preview;
        },
        apply: async () => {
          settings = { ...settings, firstSyncConfirmedAt: new Date().toISOString() };
          status = {
            ...status,
            settings,
            pendingPreview: false,
            phase: 'done',
            lastSyncAt: new Date().toISOString(),
            lastResult: {
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              createdAppNotes: 6, createdAppleNotes: 4, updatedAppNotes: 0, updatedAppleNotes: 0,
              trashedAppNotes: 0, trashedAppleNotes: 0, createdFolders: 3, updatedFolders: 0,
              deletedFolders: 0, uploadedAttachments: 3, downloadedAttachments: 2,
              uploadedBytes: 100, downloadedBytes: 200, conflicts: 0, readOnly: 1, errors: [],
            },
          };
          return refresh();
        },
        syncNow: async () => refresh(),
        cancel: async () => true,
        recheckReadOnly: async () => refresh(),
        openPrivacySettings: async () => true,
        onStatus: () => () => {},
        onChanged: () => () => {},
      },
    };
  }, baseURL!);

  await registerThroughUi(page);
  const button = page.getByTestId('apple-notes-sync');
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId('apple-notes-settings')).toBeVisible();

  await page.getByTestId('apple-notes-enabled').check();
  await page.getByTestId('apple-notes-preview').click();
  await expect(page.getByTestId('apple-notes-preview-dialog')).toBeVisible();
  await expect(page.getByText('从备忘录导入笔记')).toBeVisible();
  await page.getByTestId('apple-notes-confirm').check();
  await page.getByTestId('apple-notes-apply').click();
  await expect(page.getByTestId('apple-notes-last-result')).toContainText('新增 app 6');
  await expect(page.getByTestId('apple-notes-preview-dialog')).toHaveCount(0);
});
