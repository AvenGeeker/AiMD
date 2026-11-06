/**
 * Non-secret login convenience: remember the address so the next sign-in is one field shorter.
 *
 * Passwords and refresh tokens are deliberately never written here. Browsers have no safe
 * JavaScript-accessible credential store; native shells keep tokens in the Keychain / Keystore.
 */

const KEY = 'aimarkdown.rememberedEmail';

export function readRememberedEmail(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberEmail(email: string): void {
  try {
    const value = email.trim();
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode or storage disabled */
  }
}

export function forgetRememberedEmail(): void {
  rememberEmail('');
}
