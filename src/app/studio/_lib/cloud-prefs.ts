/**
 * UI preferences in Telegram CloudStorage (Settings v2): the language and the Work / Personal space follow
 * the person to every device where they open the manager bot's Mini App. localStorage stays the synchronous
 * cache the first render reads; CloudStorage is the copy that travels. Nothing the server enforces lives
 * here: these are display choices only.
 *
 * CloudStorage needs Bot API 6.9+ inside a real Mini App. Web previews and old clients have no CloudStorage
 * (or throw on use), so every call is feature-detected and nothing here ever throws or rejects.
 */

import type { TelegramCloudStorage } from '@/lib/platform/types';
import { LOCALES, type Locale } from './i18n';

export type Space = 'work' | 'personal';
export interface CloudPrefs { locale?: Locale; space?: Space }

/** CloudStorage keys allow only A-Z a-z 0-9 _ -, so `vx:locale` and `vx:space` travel as these. */
export const CLOUD_KEYS = { locale: 'vx_locale', space: 'vx_space' } as const;
const SPACES: readonly Space[] = ['work', 'personal'];
/** The first render waits at most this long for the travelling copy (the splash is still up). */
export const CLOUD_READ_MS = 600;

interface CloudHost { initData?: string; isVersionAtLeast?(version: string): boolean; CloudStorage?: TelegramCloudStorage }

/** The Mini App's CloudStorage, or null outside Telegram, on clients older than 6.9, or when it is missing. */
export function cloudStorage(): TelegramCloudStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const app = (window as unknown as { Telegram?: { WebApp?: CloudHost } }).Telegram?.WebApp;
    // telegram-web-app.js defines WebApp in any browser; only a real Mini App has initData.
    if (!app?.initData || !app.CloudStorage) return null;
    if (typeof app.isVersionAtLeast === 'function' && !app.isVersionAtLeast('6.9')) return null;
    return app.CloudStorage;
  } catch { return null; }
}

function parse(values: Record<string, string> | null | undefined): CloudPrefs {
  const out: CloudPrefs = {};
  const locale = values?.[CLOUD_KEYS.locale], space = values?.[CLOUD_KEYS.space];
  if ((LOCALES as readonly unknown[]).includes(locale)) out.locale = locale as Locale;
  if ((SPACES as readonly unknown[]).includes(space)) out.space = space as Space;
  return out;
}

/** The travelling copy, or null when it couldn't be read (unavailable, slow or failing). Never rejects. */
function readKnown(timeoutMs: number): Promise<CloudPrefs | null> {
  const store = cloudStorage();
  if (!store) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (prefs: CloudPrefs | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(prefs); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      store.getItems([CLOUD_KEYS.locale, CLOUD_KEYS.space], (error, values) => finish(error ? null : parse(values)));
    } catch { finish(null); }
  });
}

/** The travelling copy; {} when unavailable, slow, failing or unset. Never rejects. */
export async function readCloudPrefs(timeoutMs = CLOUD_READ_MS): Promise<CloudPrefs> {
  return (await readKnown(timeoutMs)) ?? {};
}

/**
 * Reads the travelling copy and, when the read worked but a key is missing there, copies this device's
 * explicit choice up (a person who chose before Settings v2 keeps that choice on their other devices).
 * Nothing is written when the read failed or timed out: the cloud may hold a newer choice. Never rejects.
 */
export async function syncCloudPrefs(local: CloudPrefs, timeoutMs = CLOUD_READ_MS): Promise<CloudPrefs> {
  const cloud = await readKnown(timeoutMs);
  if (!cloud) return {};
  if (!cloud.locale && local.locale) writeCloudPref('locale', local.locale);
  if (!cloud.space && local.space) writeCloudPref('space', local.space);
  return cloud;
}

/** Saves one choice to the travelling copy, fire and forget. Never throws. */
export function writeCloudPref<K extends keyof CloudPrefs>(key: K, value: NonNullable<CloudPrefs[K]>): void {
  const store = cloudStorage();
  if (!store) return;
  try { store.setItem(CLOUD_KEYS[key], value, () => undefined); } catch { /* unsupported client: the local cache still holds it */ }
}
