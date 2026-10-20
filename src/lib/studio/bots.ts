/**
 * Runs every Telegram bot from one process with long polling:
 *  - @VoxxBot (the manager): /start, opens the Mini App, receives managed_bot
 *    updates when someone confirms a new agent bot
 *  - each active agent's bot: DMs, groups, voice notes (via PersonaGateway)
 *
 * For serverless hosting the same handlers run behind webhooks instead
 * (updates.ts + /api/studio/telegram/[key]).
 *
 * The set of agent bots is refreshed every few seconds, so a newly hired agent
 * comes online without a restart and a fired one goes quiet.
 */

import type { TelegramBotClient, TelegramUpdate } from '../tireh/telegram/client';
import { logTelegramDiagnostic } from '../tireh/telegram/diagnostics';
import type { Studio } from './service';
import { AGENT_UPDATES, handleAgentUpdate, handleManagerUpdate, MANAGER_UPDATES } from './updates';
import { randomUUID } from 'crypto';

const REFRESH_MS = 8000;

interface Loop { stop: () => void; token?: string }

function pollLoop(
  bot: TelegramBotClient,
  allowed: string[],
  handle: (u: TelegramUpdate) => Promise<void>,
  log: Pick<Console, 'info' | 'warn' | 'error'>
): Loop {
  let running = true;
  let offset: number | undefined;
  (async () => {
    await bot.deleteWebhook().catch(() => undefined);
    while (running) {
      try {
        const updates = await bot.getUpdates(offset, 25, allowed);
        for (const update of updates) {
          offset = update.update_id + 1;
          await handle(update).catch(() => logTelegramDiagnostic(log, 'update_failed'));
        }
      } catch {
        if (!running) break;
        logTelegramDiagnostic(log, 'poll_failed');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();
  return { stop: () => { running = false; } };
}

export function startBots(studio: Studio): { stop: () => void } {
  const log = studio.deps.logger ?? console;
  const loops = new Map<string, Loop>();
  let stopped = false;
  let refreshing = false;
  let profilesRefreshing = false;

  const manager = studio.deps.managerBot;
  if (manager) {
    const webAppUrl = studio.deps.webAppUrl;
    if (webAppUrl) manager.setChatMenuButton('Open Studio', webAppUrl).catch(() => logTelegramDiagnostic(log, 'menu_failed'));
    loops.set('manager', pollLoop(manager, MANAGER_UPDATES, (update) => handleManagerUpdate(studio, update), log));
  }

  const refresh = async () => {
    if (stopped || refreshing) return;
    refreshing = true;
    try {
      const state = await studio.deps.store.read();
      const active = state.agents.filter((a) => a.status === 'active' && a.tokenEnc);
      const activeIds = new Set(active.map((a) => a.id));
      for (const [id, loop] of loops) {
        if (id !== 'manager' && !activeIds.has(id)) { loop.stop(); loops.delete(id); logTelegramDiagnostic(log, 'bot_offline'); }
      }
      for (const agent of active) {
        const token = studio.botToken(agent);
        const current = loops.get(agent.id);
        // A refreshed token (repeat managed_bot update) replaces the old poller.
        if (current && current.token === token) continue;
        if (current) { current.stop(); loops.delete(agent.id); }
        if (!token) continue;
        const bot = studio.deps.botFor(token);
        loops.set(agent.id, { ...pollLoop(bot, AGENT_UPDATES, (update) => handleAgentUpdate(studio, agent.id, update, studio.relationshipEndpointId(token)), log), token });
        logTelegramDiagnostic(log, 'bot_online');
      }
      // Repairs legacy photos without delaying new/fired bot polling changes.
      if (!profilesRefreshing) {
        profilesRefreshing = true;
        void studio.reconcileBotProfiles()
          .catch(() => logTelegramDiagnostic(log, 'profile_failed'))
          .finally(() => { profilesRefreshing = false; });
      }
    } catch {
      logTelegramDiagnostic(log, 'refresh_failed');
    } finally {
      refreshing = false;
    }
  };

  void refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  let draining = false;
  const drain = async () => {
    if (stopped || draining || studio.deps.relationships?.mode !== 'live') return;
    draining = true;
    try { await studio.drainRelationships(2); }
    catch { logTelegramDiagnostic(log, 'relationship_failed'); }
    finally { draining = false; }
  };
  void drain(); // Recover durable due work after restart.
  const relationshipTimer = setInterval(drain, 60_000);
  // The dependency exists only under the independent STUDIO_MAINTENANCE=1 flag.
  // Lease/checkpoint lives in storage; this guard only prevents process-local overlap.
  let maintaining = false;
  const maintenanceAbort = new AbortController();
  const maintenanceWorker = `studio-${randomUUID()}`;
  const maintain = async () => {
    if (stopped || maintaining || !studio.deps.maintenance) return;
    maintaining = true;
    try {
      const result = await studio.deps.maintenance.runPage({ workerId: maintenanceWorker, limit: 20, signal: maintenanceAbort.signal });
      if (result.state === 'failed' && !stopped) log.warn({ type: 'adaptive_maintenance', outcome: 'failed', reason: 'sweep_failed' });
    } catch { if (!stopped) log.warn({ type: 'adaptive_maintenance', outcome: 'failed', reason: 'sweep_failed' }); }
    finally { maintaining = false; }
  };
  const maintenanceTimer = studio.deps.maintenance ? setInterval(maintain, 60_000) : undefined;
  void maintain();
  let runningRoutines = false;
  const runRoutines = async () => {
    if (stopped || runningRoutines || !studio.deps.requestedRoutines || !studio.deps.requestedRoutinesEnabled?.()) return;
    runningRoutines = true;
    try { await studio.deps.requestedRoutines.tick(); }
    catch { log.warn({ type: 'requested_routines', outcome: 'failed' }); }
    finally { runningRoutines = false; }
  };
  const routineTimer = studio.deps.requestedRoutines ? setInterval(runRoutines, 60_000) : undefined;
  void runRoutines();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(relationshipTimer);
      if (maintenanceTimer) clearInterval(maintenanceTimer);
      maintenanceAbort.abort();
      if (routineTimer) clearInterval(routineTimer);
      studio.deps.requestedRoutines?.close();
      for (const loop of loops.values()) loop.stop();
      loops.clear();
      return studio.deps.preferenceLearning?.tasks.close();
    },
  };
}
