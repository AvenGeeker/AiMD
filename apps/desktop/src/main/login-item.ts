import { app } from 'electron';

/**
 * Launch-at-login.
 *
 * On macOS this goes through SMAppService and can fail with "Operation not permitted" for an
 * unsigned or development build. That must not be fatal, and it must not be attempted on every
 * boot when the setting is already what the user asked for — hence the read-before-write.
 */

export interface LoginItemResult {
  applied: boolean;
  current: boolean;
  error?: string;
}

export function getLaunchAtLogin(): boolean {
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch {
    return false;
  }
}

export function setLaunchAtLogin(desired: boolean): LoginItemResult {
  const current = getLaunchAtLogin();
  if (current === desired) return { applied: true, current };

  try {
    app.setLoginItemSettings({ openAtLogin: desired });
    const after = getLaunchAtLogin();
    return {
      applied: after === desired,
      current: after,
      ...(after === desired ? {} : { error: '系统拒绝了该更改（未签名构建常见）' }),
    };
  } catch (error) {
    return {
      applied: false,
      current,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
