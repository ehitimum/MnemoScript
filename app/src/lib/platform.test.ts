import { describe, it, expect, vi } from 'vitest';
import { stubMatchMedia } from '../test/setup';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';

/** Re-import the module with a given UA / URL so its module-level constants re-evaluate. */
async function loadPlatform(ua: string, search = '') {
  vi.resetModules();
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  window.history.replaceState({}, '', `/${search}`);
  return import('./platform');
}

function media(narrow: boolean, coarse: boolean) {
  stubMatchMedia((q) => (q.includes('max-width') ? narrow : q.includes('coarse') ? coarse : false));
}

describe('platform shell selection', () => {
  it('a wide desktop window gets the desktop shell', async () => {
    media(false, false);
    const m = await loadPlatform(DESKTOP_UA);
    expect(m.computeShell()).toEqual({ isMobileShell: false, isNarrow: false, isTouch: false });
  });

  it('a NARROW desktop window keeps the desktop shell (regression: used to flip to the phone UI)', async () => {
    media(true, false);
    const m = await loadPlatform(DESKTOP_UA);
    const s = m.computeShell();
    expect(s.isMobileShell).toBe(false);
    expect(s.isNarrow).toBe(true);
  });

  it('Android always gets the phone shell, even in wide landscape', async () => {
    media(false, true);
    const m = await loadPlatform(ANDROID_UA);
    expect(m.isMobileOS).toBe(true);
    expect(m.computeShell().isMobileShell).toBe(true);
  });

  it('a narrow touch-first browser gets the phone shell', async () => {
    media(true, true);
    const m = await loadPlatform(DESKTOP_UA);
    expect(m.computeShell().isMobileShell).toBe(true);
  });

  it('?shell=mobile / ?shell=desktop force a shell on the web build', async () => {
    media(false, false);
    expect((await loadPlatform(DESKTOP_UA, '?shell=mobile')).computeShell().isMobileShell).toBe(true);
    media(true, true);
    expect((await loadPlatform(DESKTOP_UA, '?shell=desktop')).computeShell().isMobileShell).toBe(false);
  });

  it('isTauri reflects the presence of the Tauri IPC bridge', async () => {
    media(false, false);
    expect((await loadPlatform(DESKTOP_UA)).isTauri).toBe(false);
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    expect((await loadPlatform(DESKTOP_UA)).isTauri).toBe(true);
  });

  it('a narrow desktop *Tauri* window never becomes the phone shell', async () => {
    media(true, true); // e.g. a touch-screen laptop with a tiny window
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const m = await loadPlatform(DESKTOP_UA);
    expect(m.computeShell().isMobileShell).toBe(false);
  });
});
