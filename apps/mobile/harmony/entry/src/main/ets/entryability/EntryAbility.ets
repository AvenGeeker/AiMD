import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window } from '@kit.ArkUI';

const TAG = 'AiMD';

/** Pull share text/URLs out of the common HarmonyOS sendData want parameters. */
function shareText(want: Want): string {
  const params = want.parameters ?? {};
  const candidates = [
    'ability.params.stream',
    'ohos.extra.param.key.content',
    'text',
    'url',
  ];
  const parts: string[] = [];
  for (const key of candidates) {
    const value = (params as Record<string, Object>)[key] as string | string[] | undefined;
    if (typeof value === 'string') {
      parts.push(value);
    } else if (value !== undefined) {
      for (const item of value as string[]) {
        if (typeof item === 'string') parts.push(item);
      }
    }
  }
  const unique: string[] = [];
  for (const part of parts) {
    if (unique.indexOf(part) < 0) unique.push(part);
  }
  return unique.join('\n');
}

function queueShare(want: Want): void {
  try {
    const text = shareText(want);
    if (!text) return;
    const payload = JSON.stringify({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      source: 'harmony',
      receivedAt: new Date().toISOString(),
      text,
    });
    AppStorage.setOrCreate('aimdSharePayload', payload);
  } catch (err) {
    const e = err as Error;
    hilog.error(0x0000, TAG, 'share parse failed: %{public}s', e.message);
  }
}

/** A form tap routes through EntryAbility so a warm or cold app both reach the same queue. */
function queueOpenFavorite(want: Want): void {
  try {
    const params = (want.parameters ?? {}) as Record<string, Object>;
    if (params['aimdAction'] !== 'open-favorite') return;
    AppStorage.setOrCreate('aimdOpenFavorite', `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  } catch (err) {
    const e = err as Error;
    hilog.error(0x0000, TAG, 'favorite action parse failed: %{public}s', e.message);
  }
}

export default class EntryAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, TAG, 'Ability onCreate %{public}s', JSON.stringify(want));
    queueOpenFavorite(want);
    queueShare(want);
  }

  onNewWant(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(0x0000, TAG, 'Ability onNewWant %{public}s', JSON.stringify(want));
    queueOpenFavorite(want);
    queueShare(want);
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(0x0000, TAG, 'Failed to load content: %{public}s', JSON.stringify(err));
        return;
      }
      hilog.info(0x0000, TAG, 'Content loaded');
    });
  }

  onWindowStageDestroy(): void {
    hilog.info(0x0000, TAG, 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    hilog.info(0x0000, TAG, 'Ability onForeground');
  }

  onBackground(): void {
    hilog.info(0x0000, TAG, 'Ability onBackground');
  }
}
