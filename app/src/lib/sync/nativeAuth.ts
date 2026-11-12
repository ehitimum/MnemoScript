import { invoke } from '@tauri-apps/api/core';

/**
 * Android: ask Google's native authorization API (Google Play services) for a Drive
 * `drive.appdata` access token. Google shows its own account/consent sheet the first time and
 * answers silently afterwards. No password or refresh token ever reaches MnemoScript.
 */
export async function authorizeDrive(): Promise<{ token: string; expiresIn: number }> {
  const result = await invoke<{ accessToken?: string; expiresIn?: number }>('plugin:google-auth|authorize', { interactive: true });
  if (!result?.accessToken) throw new Error('Google did not grant Drive access.');
  return { token: result.accessToken, expiresIn: result.expiresIn ?? 3000 };
}

/** Silent re-authorization when the short-lived token expired (no UI unless consent is needed). */
export async function reauthorizeDriveSilently(): Promise<{ token: string; expiresIn: number } | null> {
  try {
    const result = await invoke<{ accessToken?: string; expiresIn?: number }>('plugin:google-auth|authorize', { interactive: false });
    return result?.accessToken ? { token: result.accessToken, expiresIn: result.expiresIn ?? 3000 } : null;
  } catch {
    return null;
  }
}
