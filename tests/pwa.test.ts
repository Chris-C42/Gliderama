import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RegisterOptions = {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (url: string, registration: unknown) => void;
  onRegisterError?: (error: unknown) => void;
};

const registerSW = vi.hoisted(() => vi.fn());
vi.mock('virtual:pwa-register', () => ({ registerSW }));

type PwaModule = typeof import('../src/app/pwa');

/** Fresh copy of the module (it keeps "already started" state), after the globals the test wants are in place. */
async function load(): Promise<PwaModule> {
  vi.resetModules();
  return import('../src/app/pwa');
}

class FakeEventTarget {
  visibilityState = 'visible';
  private readonly listeners = new Map<string, Array<() => void>>();
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

beforeEach(() => {
  registerSW.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------------

describe('isStandalone', () => {
  function env(options: { modes?: string[]; iosStandalone?: boolean; fullscreenElement?: unknown; referrer?: string; throwing?: boolean } = {}) {
    const modes = new Set(options.modes ?? []);
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { standalone: options.iosStandalone });
    vi.stubGlobal('document', { fullscreenElement: options.fullscreenElement ?? null, referrer: options.referrer ?? '' });
    vi.stubGlobal('matchMedia', (query: string) => {
      if (options.throwing) throw new Error('matchMedia is broken');
      return { matches: modes.has(query) };
    });
  }

  it('is false in an ordinary browser tab', async () => {
    env({ modes: ['(display-mode: browser)'] });
    expect((await load()).isStandalone()).toBe(false);
  });

  it('is false without a window', async () => {
    expect((await load()).isStandalone()).toBe(false);
  });

  it.each(['standalone', 'minimal-ui', 'window-controls-overlay'])('is true for display-mode: %s', async (mode) => {
    env({ modes: [`(display-mode: ${mode})`] });
    expect((await load()).isStandalone()).toBe(true);
  });

  it('is true for an installed app that the manifest made fullscreen', async () => {
    env({ modes: ['(display-mode: fullscreen)'] });
    expect((await load()).isStandalone()).toBe(true);
  });

  it('is false when the page itself put a browser tab into fullscreen', async () => {
    env({ modes: ['(display-mode: fullscreen)'], fullscreenElement: {} });
    expect((await load()).isStandalone()).toBe(false);
  });

  it('knows iOS home-screen apps (navigator.standalone)', async () => {
    env({ iosStandalone: true });
    expect((await load()).isStandalone()).toBe(true);
    env({ iosStandalone: false });
    expect((await load()).isStandalone()).toBe(false);
  });

  it('knows Android trusted web activities', async () => {
    env({ referrer: 'android-app://com.example.twa' });
    expect((await load()).isStandalone()).toBe(true);
  });

  it('survives a broken matchMedia', async () => {
    env({ throwing: true });
    expect((await load()).isStandalone()).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('requestFullscreenLandscape', () => {
  function env(options: { ua?: string; platform?: string; touchPoints?: number; fullscreenElement?: unknown; requestFullscreen?: unknown; webkit?: unknown; lock?: unknown; hasOrientation?: boolean; displayModeFullscreen?: boolean } = {}) {
    const root: Record<string, unknown> = {};
    if (options.requestFullscreen !== undefined) root.requestFullscreen = options.requestFullscreen;
    else if (options.webkit === undefined) root.requestFullscreen = vi.fn(async () => {});
    if (options.webkit !== undefined) root.webkitRequestFullscreen = options.webkit;
    const orientation = { lock: options.lock ?? vi.fn(async () => {}), unlock: vi.fn() };
    vi.stubGlobal('document', { documentElement: root, fullscreenElement: options.fullscreenElement ?? null, exitFullscreen: vi.fn(async () => {}) });
    vi.stubGlobal('navigator', { userAgent: options.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile', platform: options.platform ?? 'Linux armv8l', maxTouchPoints: options.touchPoints ?? 5 });
    vi.stubGlobal('screen', options.hasOrientation === false ? {} : { orientation });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: !!options.displayModeFullscreen && query === '(display-mode: fullscreen)' }));
    return { root, orientation, doc: globalThis.document as unknown as { exitFullscreen: ReturnType<typeof vi.fn>; fullscreenElement: unknown } };
  }

  it('enters fullscreen (hiding the browser UI) and locks to landscape', async () => {
    const { root, orientation } = env();
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
    expect(root.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(orientation.lock).toHaveBeenCalledWith('landscape');
  });

  it('fullscreens the element it is given', async () => {
    const { root } = env();
    const target = { requestFullscreen: vi.fn(async () => {}) };
    expect(await (await load()).requestFullscreenLandscape(target as unknown as Element)).toBe(true);
    expect(target.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(root.requestFullscreen).not.toHaveBeenCalled();
  });

  it('does nothing on iPhone and iPad', async () => {
    for (const options of [
      { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      { ua: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' },
      { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', platform: 'MacIntel', touchPoints: 5 }, // iPadOS in desktop mode
    ]) {
      const { root, orientation } = env(options);
      expect(await (await load()).requestFullscreenLandscape()).toBe(false);
      expect(root.requestFullscreen).not.toHaveBeenCalled();
      expect(orientation.lock).not.toHaveBeenCalled();
    }
  });

  it('still works on a real Mac (no touch screen)', async () => {
    const { root } = env({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', touchPoints: 0 });
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
    expect(root.requestFullscreen).toHaveBeenCalled();
  });

  it('swallows a refused fullscreen request but still tries the lock', async () => {
    const { orientation } = env({ requestFullscreen: vi.fn(async () => { throw new TypeError('Permissions check failed'); }) });
    expect(await (await load()).requestFullscreenLandscape()).toBe(false);
    expect(orientation.lock).toHaveBeenCalledWith('landscape');
  });

  it('swallows a refused orientation lock (desktop)', async () => {
    env({ lock: vi.fn(async () => { throw new DOMException('not supported', 'NotSupportedError'); }) });
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
  });

  it('works where screen.orientation does not exist', async () => {
    env({ hasOrientation: false });
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
  });

  it('does not ask again when already fullscreen, but still locks', async () => {
    const { root, orientation } = env({ fullscreenElement: {} });
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
    expect(root.requestFullscreen).not.toHaveBeenCalled();
    expect(orientation.lock).toHaveBeenCalled();
  });

  it('counts an installed fullscreen app as fullscreen', async () => {
    const { root } = env({ displayModeFullscreen: true });
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
    expect(root.requestFullscreen).not.toHaveBeenCalled();
  });

  it('falls back to the webkit-prefixed API', async () => {
    const webkit = vi.fn();
    env({ webkit });
    expect(await (await load()).requestFullscreenLandscape()).toBe(true);
    expect(webkit).toHaveBeenCalled();
  });

  it('is a no-op without a document', async () => {
    expect(await (await load()).requestFullscreenLandscape()).toBe(false);
  });

  it('exitFullscreen releases the lock and leaves fullscreen', async () => {
    const { orientation, doc } = env({ fullscreenElement: {} });
    await (await load()).exitFullscreen();
    expect(orientation.unlock).toHaveBeenCalled();
    expect(doc.exitFullscreen).toHaveBeenCalled();
  });

  it('exitFullscreen does not call exitFullscreen when the page is not fullscreen', async () => {
    const { doc } = env();
    await (await load()).exitFullscreen();
    expect(doc.exitFullscreen).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('service worker registration', () => {
  function env(options: { serviceWorker?: boolean; online?: boolean } = {}) {
    const doc = new FakeEventTarget();
    const reload = vi.fn();
    const nav: Record<string, unknown> = { onLine: options.online ?? true };
    if (options.serviceWorker !== false) nav.serviceWorker = {};
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('document', doc);
    vi.stubGlobal('location', { reload });
    return { doc, reload, nav };
  }
  const registration = () => ({ update: vi.fn(async () => {}) });

  it('registers once and exposes the two flags', async () => {
    env();
    const updateSW = vi.fn(async () => {});
    registerSW.mockReturnValue(updateSW);
    const pwa = await load();
    expect(pwa.updateAvailable.value).toBe(false);
    expect(pwa.offlineReady.value).toBe(false);

    pwa.initPwa();
    pwa.initPwa();
    expect(registerSW).toHaveBeenCalledTimes(1);
    const options = registerSW.mock.calls[0][0] as RegisterOptions;

    options.onOfflineReady?.();
    expect(pwa.offlineReady.value).toBe(true);
    expect(pwa.updateAvailable.value).toBe(false);
    options.onNeedRefresh?.();
    expect(pwa.updateAvailable.value).toBe(true);
  });

  it('applyUpdate asks the worker to take over', async () => {
    env();
    const updateSW = vi.fn(async () => {});
    registerSW.mockReturnValue(updateSW);
    const pwa = await load();
    pwa.initPwa();
    await pwa.applyUpdate();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it('applyUpdate reloads by hand if the worker swap never reloads the page', async () => {
    vi.useFakeTimers();
    const { reload } = env();
    registerSW.mockReturnValue(vi.fn(async () => {}));
    const pwa = await load();
    pwa.initPwa();
    await pwa.applyUpdate();
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('applyUpdate reloads straight away when the update call fails, or when nothing is registered', async () => {
    const { reload } = env();
    registerSW.mockReturnValue(vi.fn(async () => { throw new Error('boom'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pwa = await load();
    pwa.initPwa();
    await pwa.applyUpdate();
    expect(reload).toHaveBeenCalledTimes(1);

    const second = env();
    const fresh = await load(); // initPwa never called
    await fresh.applyUpdate();
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing without service worker support', async () => {
    env({ serviceWorker: false });
    const pwa = await load();
    pwa.initPwa();
    expect(registerSW).not.toHaveBeenCalled();
    expect(pwa.updateAvailable.value).toBe(false);
  });

  it('survives registration throwing, and reports registration errors', async () => {
    env();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerSW.mockImplementation(() => {
      throw new Error('no thanks');
    });
    const pwa = await load();
    expect(() => pwa.initPwa()).not.toThrow();
    expect(warn).toHaveBeenCalled();

    registerSW.mockReset();
    registerSW.mockReturnValue(vi.fn());
    const again = await load();
    again.initPwa();
    (registerSW.mock.calls[0][0] as RegisterOptions).onRegisterError?.(new Error('x'));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('checks for a new version every hour, and when the app comes back to the foreground', async () => {
    vi.useFakeTimers();
    const { doc } = env();
    registerSW.mockReturnValue(vi.fn());
    const pwa = await load();
    pwa.initPwa();
    const reg = registration();
    (registerSW.mock.calls[0][0] as RegisterOptions).onRegisteredSW?.('/sw.js', reg);

    vi.advanceTimersByTime(59 * 60 * 1000);
    expect(reg.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60 * 1000);
    expect(reg.update).toHaveBeenCalledTimes(1);

    doc.fire('visibilitychange'); // visible again right after a check: too soon
    expect(reg.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(11 * 60 * 1000);
    doc.fire('visibilitychange');
    expect(reg.update).toHaveBeenCalledTimes(2);

    doc.visibilityState = 'hidden';
    vi.advanceTimersByTime(30 * 60 * 1000);
    doc.fire('visibilitychange');
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it('skips update checks while offline and shrugs off failed ones', async () => {
    vi.useFakeTimers();
    const { nav } = env({ online: false });
    registerSW.mockReturnValue(vi.fn());
    const pwa = await load();
    pwa.initPwa();
    const reg = { update: vi.fn(async () => { throw new Error('offline'); }) };
    (registerSW.mock.calls[0][0] as RegisterOptions).onRegisteredSW?.('/sw.js', reg);

    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(reg.update).not.toHaveBeenCalled();

    nav.onLine = true;
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(reg.update).toHaveBeenCalledTimes(1); // rejected promise is swallowed
    await Promise.resolve();
  });
});
