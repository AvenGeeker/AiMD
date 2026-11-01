import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AppleNotesPreview,
  AppleNotesSettings,
  AppleNotesStatus,
} from '@aimarkdown/shared';
import { getBridge, isDesktop, platform } from '../lib/platform.js';
import { invalidateStructure } from '../lib/queries.js';

export function useAppleNotes() {
  const queryClient = useQueryClient();
  const bridge = getBridge();
  const available = isDesktop() && platform() === 'darwin' && Boolean(bridge?.appleNotes);
  const [status, setStatus] = useState<AppleNotesStatus | null>(null);
  const [preview, setPreview] = useState<AppleNotesPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!available || !bridge?.appleNotes) return;
    let cancelled = false;
    void bridge.appleNotes.getStatus().then((next) => {
      if (!cancelled) setStatus(next);
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
    });
    const offStatus = bridge.appleNotes.onStatus((next) => setStatus(next));
    const offChanged = bridge.appleNotes.onChanged(() => {
      invalidateStructure(queryClient);
      void queryClient.invalidateQueries({ queryKey: ['note'] });
    });
    return () => {
      cancelled = true;
      offStatus();
      offChanged();
    };
  }, [available, bridge, queryClient]);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const requestPermission = useCallback(
    () =>
      run(async () => {
        const next = await bridge?.appleNotes?.probe();
        if (next) setStatus(next);
        return next;
      }),
    [bridge, run],
  );

  const setSettings = useCallback(
    (patch: Partial<AppleNotesSettings>) =>
      run(async () => {
        const next = await bridge?.appleNotes?.setSettings(patch);
        if (next) setStatus(next);
        return next;
      }),
    [bridge, run],
  );

  const scan = useCallback(
    (deep = false) =>
      run(async () => {
        const next = await bridge?.appleNotes?.preview(deep);
        if (next) {
          setPreview(next);
          const current = await bridge?.appleNotes?.getStatus();
          if (current) setStatus(current);
        }
        return next;
      }),
    [bridge, run],
  );

  const apply = useCallback(
    (token: string) =>
      run(async () => {
        const next = await bridge?.appleNotes?.apply(token);
        if (next) setStatus(next);
        setPreview(null);
        invalidateStructure(queryClient);
        return next;
      }),
    [bridge, queryClient, run],
  );

  const syncNow = useCallback(
    () =>
      run(async () => {
        const next = await bridge?.appleNotes?.syncNow();
        if (next) setStatus(next);
        if (next?.pendingPreview) {
          const p = await bridge?.appleNotes?.preview(false);
          if (p) setPreview(p);
        }
        invalidateStructure(queryClient);
        return next;
      }),
    [bridge, queryClient, run],
  );

  const cancel = useCallback(() => {
    void bridge?.appleNotes?.cancel();
  }, [bridge]);

  const openPrivacySettings = useCallback(() => {
    void bridge?.appleNotes?.openPrivacySettings();
  }, [bridge]);

  const recheckReadOnly = useCallback(
    () =>
      run(async () => {
        const next = await bridge?.appleNotes?.recheckReadOnly();
        if (next) setStatus(next);
        return next;
      }),
    [bridge, run],
  );

  return useMemo(
    () => ({
      available,
      status,
      preview,
      busy,
      error,
      clearPreview: () => setPreview(null),
      setSettings,
      requestPermission,
      scan,
      apply,
      syncNow,
      cancel,
      openPrivacySettings,
      recheckReadOnly,
    }),
    [available, status, preview, busy, error, setSettings, requestPermission, scan, apply, syncNow, cancel, openPrivacySettings, recheckReadOnly],
  );
}

export type AppleNotesController = ReturnType<typeof useAppleNotes>;
