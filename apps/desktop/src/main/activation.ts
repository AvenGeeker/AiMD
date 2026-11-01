import { app } from 'electron';

/**
 * Keep the desktop shell as a regular macOS app.
 *
 * The system menu bar belongs to the foreground app, and only regular apps may own it. If the
 * process is started as an accessory/`UIElement` app (for example from a background launcher or
 * after a hide-to-tray cycle went wrong), the previous app's menu bar stays visible and none of
 * our application-menu items can be reached. Applying this before showing a window also makes the
 * fix effective for an already-running process when the user reopens the main window.
 */
export function ensureRegularActivation(): void {
  if (process.platform !== 'darwin') return;
  app.setActivationPolicy('regular');
  void app.dock?.show();
}
