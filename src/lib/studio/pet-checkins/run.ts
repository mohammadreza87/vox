/**
 * One check-in run (design §5, open decision 2): every person with check-ins on, every agent they turned them on for,
 * the planner, the chooser and the delivery fence. Bounded (at most `maxSends` sends and a per-run deadline) and
 * idempotent per person, agent and local day (a reserved or sent row for the day stops a second one, across runs and
 * processes). Production has webhooks and no scheduler, so two entry points call this: the bearer-protected
 * `POST /api/studio/pet/checkins/run` (a Cloud Scheduler job) and the polling maintenance loop under STUDIO_MAINTENANCE=1
 * (bots.ts). With STUDIO_PET_CHECKINS off it returns at once and nothing is ever sent.
 */

import { CHECKIN_LIMITS } from '../../pet/checkins';
import { petFlags } from '../../tireh/pet-flags';
import { stageFor } from '../character';
import { formingDay } from '../permissions';
import { petPlayStoreFor } from '../pet-play-store';
import { petStoreFor } from '../pet-store';
import { petDecisionContext } from '../pet-decisions';
import type { Studio } from '../service';
import { chooseCheckin } from './decide';
import { checkinRecipient, deliverCheckin, type DeliveryOutcome } from './deliver';
import { checkinPersonHash, planCheckin, type PlanInput, type PlanSkip } from './planner';
import { petCheckinStoreFor } from './store';

export const CHECKIN_RUN_DEFAULTS = { maxSends: 25, deadlineMs: 25_000, maxSendsCap: 200, deadlineCapMs: 120_000 } as const;

export interface CheckinRunOptions { maxSends?: number; deadlineMs?: number; signal?: AbortSignal }

export interface CheckinRunReport {
  /** the master switch was off: nothing was read or sent */
  off?: true;
  people: number;
  considered: number;
  sent: number;
  outcomes: Partial<Record<DeliveryOutcome, number>>;
  skipped: Partial<Record<PlanSkip | 'inbox_only' | 'decided_none' | 'not_recipient', number>>;
  /** the run stopped early: the send cap or the deadline */
  stopped?: 'max_sends' | 'deadline' | 'aborted';
  paused: number;
}

const bump = <K extends string>(o: Partial<Record<K, number>>, k: K) => { o[k] = (o[k] ?? 0) + 1; };

/** Runs once. Never throws: a store failure ends the run with what it did so far (logged, content-free). */
export async function runPetCheckins(studio: Studio, options: CheckinRunOptions = {}): Promise<CheckinRunReport> {
  const report: CheckinRunReport = { people: 0, considered: 0, sent: 0, outcomes: {}, skipped: {}, paused: 0 };
  if (petFlags().petCheckins !== 'on') return { ...report, off: true };
  const maxSends = Math.min(Math.max(1, Math.floor(options.maxSends ?? CHECKIN_RUN_DEFAULTS.maxSends)), CHECKIN_RUN_DEFAULTS.maxSendsCap);
  const deadline = Date.now() + Math.min(Math.max(1000, options.deadlineMs ?? CHECKIN_RUN_DEFAULTS.deadlineMs), CHECKIN_RUN_DEFAULTS.deadlineCapMs);
  const log = studio.deps.logger ?? console;
  const clock = () => (studio.deps.now?.() ?? new Date()).getTime();
  try {
    const store = await petCheckinStoreFor(studio);
    const pets = await petStoreFor(studio);
    const plays = await petPlayStoreFor(studio).catch(() => null);
    const ctx = petDecisionContext(studio);
    const people = await store.listEnabled();
    report.people = people.length;
    for (const userId of people) {
      const record = await store.get(userId);
      if (!record) continue;
      const personHash = checkinPersonHash(studio.deps.secret, userId);
      for (const agentId of Object.keys(record.agents).filter((id) => record.agents[id].enabled)) {
        if (options.signal?.aborted) { report.stopped = 'aborted'; return report; }
        if (Date.now() >= deadline) { report.stopped = 'deadline'; return report; }
        if (report.sent >= maxSends) { report.stopped = 'max_sends'; return report; }
        report.considered++;
        const fresh = async (): Promise<PlanInput | null> => {
          const state = await studio.deps.store.read();
          const agent = checkinRecipient(state, agentId, userId);
          const current = await store.get(userId);
          if (!agent || !current) return null;
          const now = clock();
          const day = formingDay(agent, new Date(now));
          return { record: current, agent: { id: agent.id, ...(agent.hiredAt ? { hiredAt: agent.hiredAt } : {}), stage: stageFor(day, agent.status), formingDay: day },
            care: await pets.get(agentId, userId), play: plays ? await plays.get(agentId, userId).catch(() => null) : null, now, personHash };
        };
        const input = await fresh();
        if (!input) { bump(report.skipped, 'not_recipient'); continue; }
        const plan = planCheckin(input);
        if (plan.status === 'inbox_only') { bump(report.skipped, 'inbox_only'); continue; }
        if (plan.status === 'skip') {
          bump(report.skipped, plan.reason);
          // Three unopened in a row (§5.5): pause the whole purpose until a tap; the paused note shows once on the next open.
          if (plan.reason === 'pause_now') {
            await store.update(userId, (current) => current && current.pausedAt === undefined
              ? { record: { ...current, pausedAt: input.now, unopenedStreak: plan.streak, updatedAt: Math.max(current.updatedAt, input.now) }, result: undefined }
              : { record: null, result: undefined });
            report.paused++;
            break;
          }
          continue;
        }
        const tz = input.record.tz!;
        const choice = await chooseCheckin(ctx, input, plan, tz);
        if (!choice.pick) { bump(report.skipped, 'decided_none'); continue; }
        const outcome = await deliverCheckin(studio, { userId, agentId, fresh, choice: { pick: choice.pick, variant: choice.variant, by: choice.by }, ...(options.signal ? { signal: options.signal } : {}) });
        bump(report.outcomes, outcome);
        if (outcome === 'sent') report.sent++;
      }
    }
  } catch {
    log.warn('[studio] pet_checkins_run_failed');
  }
  return report;
}

/** The polling maintenance loop's hook (bots.ts, STUDIO_MAINTENANCE=1): at most every 15 minutes, never overlapping. */
export const CHECKIN_MAINTENANCE_EVERY_MS = 15 * 60_000;

export { CHECKIN_LIMITS };
