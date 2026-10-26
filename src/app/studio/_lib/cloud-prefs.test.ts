import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_KEYS, cloudStorage, readCloudPrefs, syncCloudPrefs, writeCloudPref } from './cloud-prefs';

type Values = Record<string, string>;
const win = window as unknown as { Telegram?: unknown };

function install(o: { values?: Values; error?: string; version?: string; throws?: boolean; silent?: boolean; initData?: string; cloud?: boolean } = {}) {
  const setItem = vi.fn((_k: string, _v: string, cb?: (e: string | null, ok: boolean) => void) => { if (o.throws) throw new Error('WebAppMethodUnsupported'); cb?.(null, true); });
  const getItems = vi.fn((_keys: string[], cb: (e: string | null, v: Values) => void) => {
    if (o.throws) throw new Error('WebAppMethodUnsupported');
    if (!o.silent) cb(o.error ?? null, o.values ?? {});
  });
  win.Telegram = { WebApp: {
    initData: o.initData ?? 'signed',
    isVersionAtLeast: (v: string) => Number(o.version ?? '8.0') >= Number(v),
    ...(o.cloud === false ? {} : { CloudStorage: { setItem, getItems, getItem: vi.fn(), removeItem: vi.fn(), removeItems: vi.fn(), getKeys: vi.fn() } }),
  } };
  return { setItem, getItems };
}

beforeEach(() => { delete win.Telegram; });
afterEach(() => { vi.useRealTimers(); delete win.Telegram; });

describe('Telegram CloudStorage prefs', () => {
  it('reads the travelling language and space, with keys CloudStorage accepts', async () => {
    const { getItems } = install({ values: { [CLOUD_KEYS.locale]: 'fa', [CLOUD_KEYS.space]: 'personal' } });
    await expect(readCloudPrefs()).resolves.toEqual({ locale: 'fa', space: 'personal' });
    expect(getItems).toHaveBeenCalledWith(['vx_locale', 'vx_space'], expect.any(Function));
    for (const key of Object.values(CLOUD_KEYS)) expect(key).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it('ignores values it does not know', async () => {
    install({ values: { vx_locale: 'de', vx_space: 'home' } });
    await expect(readCloudPrefs()).resolves.toEqual({});
  });

  it('falls back to nothing outside Telegram, without CloudStorage, before 6.9, on errors, throws and timeouts', async () => {
    await expect(readCloudPrefs()).resolves.toEqual({});
    install({ initData: '' }); expect(cloudStorage()).toBeNull();
    install({ cloud: false }); expect(cloudStorage()).toBeNull();
    install({ version: '6.1' }); expect(cloudStorage()).toBeNull();
    await expect(readCloudPrefs()).resolves.toEqual({});
    install({ error: 'STORAGE_KEY_INVALID' }); await expect(readCloudPrefs()).resolves.toEqual({});
    install({ throws: true }); await expect(readCloudPrefs()).resolves.toEqual({});
    vi.useFakeTimers();
    install({ silent: true });
    const pending = readCloudPrefs(300);
    vi.advanceTimersByTime(300);
    await expect(pending).resolves.toEqual({});
  });

  it('copies this device\'s choice up when the travelling copy has none, and never overwrites one it has', async () => {
    let cloud = install({ values: {} });
    await expect(syncCloudPrefs({ locale: 'fa', space: 'personal' })).resolves.toEqual({});
    expect(cloud.setItem.mock.calls.map((c) => [c[0], c[1]])).toEqual([['vx_locale', 'fa'], ['vx_space', 'personal']]);
    cloud = install({ values: { vx_locale: 'en' } });
    await expect(syncCloudPrefs({ locale: 'fa', space: 'work' })).resolves.toEqual({ locale: 'en' });
    expect(cloud.setItem.mock.calls.map((c) => [c[0], c[1]])).toEqual([['vx_space', 'work']]);
    // No explicit local choice: nothing travels (a Telegram-language default stays per device).
    cloud = install({ values: {} });
    await syncCloudPrefs({});
    expect(cloud.setItem).not.toHaveBeenCalled();
  });

  it('never seeds after a failed or slow read: the cloud may hold a newer choice', async () => {
    let cloud = install({ error: 'STORAGE_KEY_INVALID' });
    await expect(syncCloudPrefs({ locale: 'fa' })).resolves.toEqual({});
    expect(cloud.setItem).not.toHaveBeenCalled();
    cloud = install({ throws: true });
    await expect(syncCloudPrefs({ locale: 'fa' })).resolves.toEqual({});
    vi.useFakeTimers();
    cloud = install({ silent: true });
    const pending = syncCloudPrefs({ locale: 'fa' }, 300);
    vi.advanceTimersByTime(300);
    await expect(pending).resolves.toEqual({});
    expect(cloud.setItem).not.toHaveBeenCalled();
  });

  it('writes one choice and never throws', () => {
    expect(() => writeCloudPref('locale', 'fa')).not.toThrow();
    const { setItem } = install();
    writeCloudPref('space', 'personal');
    expect(setItem).toHaveBeenCalledWith('vx_space', 'personal', expect.any(Function));
    install({ throws: true });
    expect(() => writeCloudPref('locale', 'en')).not.toThrow();
  });
});
