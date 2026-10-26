/**
 * Telegram settings links in the Mini App (Settings v2, Part 3). The manager bot's web_app button carries the
 * link as `?settings=`, a `t.me/<manager>?startapp=` link as Telegram's start_param. Both are opaque: the hub
 * (`settings` / `account`) needs nothing more; an agent code (`s_<code>[_<letter>]`) is resolved by the server
 * (GET settings-link) on every open, and anything that does not parse is ignored.
 */

import { parseSettingsLink, type SettingsLink } from '@/lib/studio/settings-commands';
import { canSee, settingById, settingRoute, type SettingRoute, type SettingsCtx } from './registry';

/** The link this page load was opened with, and whether it came from `?settings=` (which the app then strips). */
export function settingsLinkOf(href: string, startParam?: string | null): { raw: string; link: SettingsLink; fromQuery: boolean } | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  const query = url.searchParams.get('settings');
  const raw = query ?? startParam ?? url.searchParams.get('tgWebAppStartParam');
  const link = parseSettingsLink(raw);
  return raw && link ? { raw, link, fromQuery: query !== null } : null;
}

/**
 * The stack an agent link opens: Agents, the agent's settings hub, then the section's own page or route (the same
 * mapping as the hub's rows, registry settingRoute). The section is added only when the viewer can see it on this
 * agent (registry canSee, the same check the hub's rows use); an unknown section, one the viewer cannot see, or no
 * agent to check it against stops at the hub, so Back never shows the hub twice.
 */
export function agentSettingsStack(agentId: string, section?: string, ctx?: SettingsCtx): Array<{ name: 'home' } | SettingRoute> {
  const hub: SettingRoute = { name: 'settings', page: 'agent', params: { agentId } };
  const def = section ? settingById(`agent.${section}`) : undefined;
  const target = def && ctx?.agent?.id === agentId && canSee(def, ctx) ? settingRoute(def, agentId) : null;
  return [{ name: 'home' }, hub, ...(target ? [target] : [])];
}
