import { mobilePlatform } from './platform.js';

/**
 * Touch feedback for the mobile shells.
 *
 * The Capacitor plug-in is imported lazily and only on Android/iOS: the browser bundle, the
 * Electron renderer and the HarmonyOS ArkWeb port (which has no `@capacitor/haptics`) all get a
 * silent no-op, and an import failure can never surface to the user.
 */

type HapticsModule = typeof import('@capacitor/haptics');

let modulePromise: Promise<HapticsModule | null> | null = null;

function loadHaptics(): Promise<HapticsModule | null> {
  const platform = mobilePlatform();
  if (platform !== 'android' && platform !== 'ios') return Promise.resolve(null);
  modulePromise ??= import('@capacitor/haptics').catch(() => null);
  return modulePromise;
}

function fire(run: (module: HapticsModule) => Promise<unknown>): void {
  void loadHaptics()
    .then((mod) => (mod ? run(mod) : undefined))
    .catch(() => undefined);
}

export type HapticImpactStyle = 'light' | 'medium' | 'heavy';

/** Light tick: opening a row's actions, toggling a checkbox, tab switches. */
export function hapticTap(): void {
  fire(async ({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }));
}

/** Medium thud: entering multi-select, a swipe action firing. */
export function hapticSelect(): void {
  fire(async ({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Medium }));
}

export function hapticImpact(style: HapticImpactStyle): void {
  fire(async ({ Haptics, ImpactStyle }) => {
    const resolved =
      style === 'light' ? ImpactStyle.Light : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Heavy;
    return Haptics.impact({ style: resolved });
  });
}

/** Success chirp: a batch operation completed. */
export function hapticSuccess(): void {
  fire(async ({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Success }),
  );
}

/** Warning chirp: a destructive or partially failed operation. */
export function hapticWarn(): void {
  fire(async ({ Haptics, NotificationType }) =>
    Haptics.notification({ type: NotificationType.Warning }),
  );
}
