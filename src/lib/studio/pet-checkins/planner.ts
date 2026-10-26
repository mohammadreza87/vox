/**
 * The check-in planner (design PET_CARE_GAME_DESIGN_2026_10_26 §5.3, §5.5, §8.2): pure and deterministic. Given one
 * person's check-in record, their care and play for one agent, the agent, the clock and the mourning table, it returns
 * at most one moment to send today, with its template and variant, after every hard rule:
 *
 *  consent for this agent and this moment type · the purpose not paused (three unopened pause it) · a selected zone
 *  (unknown → inbox-only, nothing sent) · quiet hours 21:00-08:00 in that zone · one a day and three a rolling week per
 *  agent · two unopened in a row → the next waits seven days · the Vox-wide proactive budget and dedupe, through the
 *  notifications module (evaluateNotification) · one message per festival per person across agents · no seasonal
 *  moment on a mourning day or a day the table cannot vouch for · each occurrence of a moment at most once per agent ·
 *  never a hunger moment (there is none in the catalogue).
 *
 * The choice among eligible moments is the local ranker here (§8.2 fixed priority). Decisions, when routed, only ever
 * chooses among the moments this planner returned (decide.ts), and the delivery fence reruns this planner before the
 * send. Nothing here reads or writes PetCare beyond reading it: decay() returns a copy.
 */

import { createHmac } from 'crypto';
import {
  evaluateNotification, isSelectedTimezone, type DeliveryLedgerEntry, type NotificationPlan, type NotificationPreferences,
} from '../../adaptive/notifications';
import { EN, FA } from '../../pet/checkin-copy';
import {
  CHECKIN_LIMITS, CHECKIN_MOMENTS, CHECKIN_POLICY_VERSION, countsTowardCaps, unopenedStreak,
  type CheckinCopyKey, type CheckinLang, type CheckinMomentId, type CheckinMomentType, type PetCheckinRecord,
} from '../../pet/checkins';
import { decay, mood } from '../../pet/care';
import { MOURNING_TABLE, seasonalQuiet, type MourningTable } from '../../pet/mourning-days';
import { activeSeason, localDay, persianDate, type PetPlay, type SeasonId } from '../../pet/play';
import type { PetCare, Stage } from '../../pet/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What the planner knows about the agent (never its persona text). */
export interface PlannerAgent {
  id: string;
  /** ISO hire time; the forming week counts from here */
  hiredAt?: string;
  stage: Stage;
  /** formingDay() from permissions.ts: 1-7, or null when not forming */
  formingDay: number | null;
}

export interface PlanInput {
  record: PetCheckinRecord;
  agent: PlannerAgent;
  /** this person's care for this agent (null: they never met it, so nothing but a season can be due) */
  care: PetCare | null;
  play: PetPlay | null;
  now: number;
  /** checkinPersonHash(secret, userId) */
  personHash: string;
  mourning?: MourningTable;
  /** other proactive Telegram sends to this person that share the Vox-wide budget (none exist today) */
  otherProactive?: readonly DeliveryLedgerEntry[];
  /** the person's Vox-wide proactive cap (notification default 2 a rolling 24 h) */
  dailyCap?: number;
}

export interface CheckinCandidate {
  moment: CheckinMomentId;
  type: CheckinMomentType;
  template: CheckinCopyKey;
  occurrence: string;
  season?: { id: SeasonId; year: number };
}

export type PlanSkip =
  | 'off' | 'paused' | 'pause_now' | 'quiet_hours' | 'agent_day' | 'agent_week' | 'cooling' | 'budget' | 'duplicate' | 'none_eligible' | 'invalid';

export type CheckinPlan =
  | { status: 'send'; day: string; lang: CheckinLang; candidates: CheckinCandidate[]; pick: CheckinCandidate; variant: number; variants: number; streak: number }
  /** the zone is unknown: the moment waits in the app, nothing goes to Telegram */
  | { status: 'inbox_only'; streak: number }
  | { status: 'skip'; reason: PlanSkip; streak: number };

/** The keyed person hash stored in sent rows and in the notification ledger (never the Telegram id). */
export function checkinPersonHash(secret: string, userId: number): string {
  return createHmac('sha256', secret).update(`pet-checkins:v1:${userId}`).digest('hex').slice(0, 32);
}

const clockFormatters = new Map<string, Intl.DateTimeFormat>();
/** Local wall-clock hour, minute and weekday (0 Sunday) of an instant in a selected zone. */
export function localClock(at: number, tz: string): { hour: number; minute: number; weekday: number } {
  let f = clockFormatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hourCycle: 'h23' }); clockFormatters.set(tz, f); }
  const parts = f.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return { hour: Number(get('hour')) % 24, minute: Number(get('minute')), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
}

/** Every moment eligible now for this agent, in local priority order, before the caps (exported for tests and Decisions). */
export function eligibleMoments(input: PlanInput, tz: string): CheckinCandidate[] {
  const { record, agent, care, play, now } = input;
  const prefs = record.agents[agent.id];
  if (!prefs?.enabled || prefs.consent?.state !== 'granted') return [];
  const clock = localClock(now, tz);
  const minutes = clock.hour * 60 + clock.minute;
  const sentHere = record.sent.filter((s) => s.agentId === agent.id && countsTowardCaps(s));
  const already = (occurrence: string) => sentHere.some((s) => s.occurrence === occurrence);
  const out: CheckinCandidate[] = [];
  const add = (moment: CheckinMomentId, occurrence: string, season?: { id: SeasonId; year: number }) => {
    const m = CHECKIN_MOMENTS[moment];
    if (!prefs.types[m.type] || already(occurrence)) return;
    out.push({ moment, type: m.type, template: m.template, occurrence, ...(season ? { season } : {}) });
  };

  // Growing up: a stage the person has not seen (C1 the first morning, else C2), the formed day (C3), a milestone (C6).
  if (care) {
    if (agent.formingDay !== null && agent.stage > care.lastSeenStage) {
      const firstMorning = localDay(now - DAY, tz) === localDay(care.firstMetAt, tz) && clock.hour >= CHECKIN_LIMITS.quietEnd && clock.hour < 12 &&
        prefs.consent !== undefined && localDay(prefs.consent.evidence.decidedAt, tz) === localDay(care.firstMetAt, tz);
      add(firstMorning ? 'C1' : 'C2', `stage:${agent.stage}`);
    }
    const hired = agent.hiredAt ? Date.parse(agent.hiredAt) : NaN;
    if (Number.isFinite(hired) && agent.formingDay === 7 && Math.floor((now - hired) / DAY) + 1 === 7 && care.lastSeenAt < hired + 6 * DAY) add('C3', 'formed');
    const milestone = Math.floor(care.bond / 25), seen = Math.floor((care.seenBond ?? 0) / 25);
    if (milestone > seen && milestone >= 1 && milestone <= 6) add('C6', `bond:${milestone}`);
  }

  // Seasons: the festival's own window, once per festival per person across agents, never on a mourning day.
  const on = activeSeason(now, tz);
  if (on && record.seasons[on.season] !== on.year && play?.seasons[on.season] !== on.year && !seasonalQuiet(now, tz, input.mourning ?? MOURNING_TABLE)) {
    const p = persianDate(now, tz);
    const season = { id: on.season, year: on.year };
    if (on.season === 'yalda' && p?.month === 9 && p.day === 30 && clock.hour >= 17) add('C7', `yalda:${on.year}`, season);
    if (on.season === 'suri' && clock.weekday === 2 && clock.hour >= 17) add('C8', `suri:${on.year}`, season);
    if (on.season === 'nowruz' && p?.month === 1 && p.day === 1 && clock.hour >= CHECKIN_LIMITS.quietEnd && clock.hour < 13) add('C9', `nowruz:${on.year}`, season);
  }

  // Garden: a bloom the person has not seen since.
  const bloomedAt = play?.garden?.bloomedAt;
  if (bloomedAt !== undefined && play?.garden && (care?.lastSeenAt ?? 0) < bloomedAt) add('C5', `bloom:${play.garden.plantedAt}`);

  // Care nudge: sleepy between 19:00 and 20:30 (energy is the need that wants), opted in. Never hunger.
  if (care) {
    const now_ = decay(care, Math.max(now, care.lastUpdatedAt), tz);
    const m = mood(now_);
    if (!now_.asleep && m.lowest === 'energy' && (m.level === 'wants' || m.level === 'droopy') && minutes >= 19 * 60 && minutes <= 20 * 60 + 30) add('C10', `sleepy:${localDay(now, tz)}`);
  }

  // Hellos: day 3 and day 10 of an absence, then silence.
  if (care) {
    const away = now - care.lastSeenAt;
    const hellos = sentHere.filter((s) => s.moment === 'C4' && s.at > care.lastSeenAt).length;
    const due = CHECKIN_LIMITS.helloDays[hellos];
    if (due !== undefined && away >= due * DAY) add('C4', `away:${localDay(care.lastSeenAt, tz)}:${hellos + 1}`);
  }

  // C11 (a Guess left mid-way) needs a mid-game record the server does not keep: never eligible yet.
  return out.sort((a, b) => CHECKIN_MOMENTS[a.moment].priority - CHECKIN_MOMENTS[b.moment].priority);
}

/** The template's variants in the person's language (Persian falls back to English only for a key with no Persian). */
export const templateVariants = (key: CheckinCopyKey, lang: CheckinLang): readonly string[] => (lang === 'fa' ? FA[key] : undefined) ?? EN[key];

/** A stable variant for this person, agent, day and moment: the local ranker's choice. */
export function localVariant(personHash: string, agentId: string, day: string, moment: CheckinMomentId, count: number): number {
  if (count <= 1) return 0;
  let h = 0x811c9dc5;
  for (const c of `${personHash}:${agentId}:${day}:${moment}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h % count;
}

/** The notification intent this send would be, for the Vox-wide budget, quiet hours and dedupe (notifications module). */
export function notificationCheck(input: PlanInput, tz: string | undefined, day: string): NotificationPlan {
  const { record, agent, now, personHash } = input;
  const prefs = record.agents[agent.id];
  const preferences: NotificationPreferences = {
    personId: personHash, revision: 1, enabled: true, proactiveEnabled: !!prefs?.enabled, reminderEnabled: false, channel: 'telegram',
    ...(tz ? { timezone: tz } : {}), ...(input.dailyCap !== undefined ? { dailyCap: input.dailyCap } : {}),
    quietStartHour: CHECKIN_LIMITS.quietStart, quietEndHour: CHECKIN_LIMITS.quietEnd,
  };
  const ledger: DeliveryLedgerEntry[] = [
    ...record.sent.filter((s) => countsTowardCaps(s) && s.at <= now).map((s): DeliveryLedgerEntry => ({
      personId: personHash, intentId: s.ref, dedupeKey: `${s.agentId}-${s.day}`, category: 'proactive',
      state: s.state === 'reserved' ? 'reserved' : s.state === 'accepted' ? 'delivered' : 'unknown', at: s.at,
    })),
    ...(input.otherProactive ?? []).filter((e) => e.personId === personHash && e.at <= now),
  ];
  const intent = {
    schemaVersion: 1, id: `${agent.id}-${day}`.slice(0, 128), tenantId: 'vox', spaceId: 'pet', containerId: agent.id, recipientPersonId: personHash,
    category: 'proactive', channel: 'telegram', sourceIds: [agent.id], sourceRevision: 1, policyVersion: CHECKIN_POLICY_VERSION,
    createdAt: now, dueAt: now, expiresAt: now + HOUR, dedupeKey: `${agent.id}-${day}`.slice(0, 128),
  };
  return evaluateNotification(intent, preferences, ledger, now, { purpose: prefs?.consent?.state === 'granted', channel: true }, true);
}

/** The plan for one person and one agent now. Deterministic: the same input always gives the same plan. */
export function planCheckin(input: PlanInput): CheckinPlan {
  const { record, agent, now } = input;
  if (!Number.isSafeInteger(now) || now <= 0) return { status: 'skip', reason: 'invalid', streak: 0 };
  const streak = unopenedStreak(record.sent, now, record.resumedAt);
  const prefs = record.agents[agent.id];
  if (!prefs?.enabled || prefs.consent?.state !== 'granted') return { status: 'skip', reason: 'off', streak };
  if (record.pausedAt !== undefined) return { status: 'skip', reason: 'paused', streak };
  if (streak >= CHECKIN_LIMITS.pauseAfter) return { status: 'skip', reason: 'pause_now', streak };
  const tz = isSelectedTimezone(record.tz) ? record.tz : undefined;
  if (!tz) return { status: 'inbox_only', streak };
  const day = localDay(now, tz);
  const counted = record.sent.filter(countsTowardCaps);
  const mine = counted.filter((s) => s.agentId === agent.id);
  if (mine.filter((s) => s.day === day).length >= CHECKIN_LIMITS.perAgentPerDay) return { status: 'skip', reason: 'agent_day', streak };
  if (mine.filter((s) => now - s.at < CHECKIN_LIMITS.weekMs).length >= CHECKIN_LIMITS.perAgentPerWeek) return { status: 'skip', reason: 'agent_week', streak };
  const last = counted.reduce((max, s) => Math.max(max, s.at), 0);
  if (streak >= CHECKIN_LIMITS.coolingAfter && now - last < CHECKIN_LIMITS.coolingMs) return { status: 'skip', reason: 'cooling', streak };
  // The notifications module: Vox-wide budget, quiet hours (21-08) and a same-day dedupe across this agent's sends.
  const policy = notificationCheck(input, tz, day);
  if (policy.status === 'inbox_only') return { status: 'inbox_only', streak };
  if (policy.status === 'suppressed') {
    const reason: PlanSkip = policy.reason === 'quiet_hours' ? 'quiet_hours' : policy.reason === 'budget' ? 'budget' : policy.reason === 'duplicate' ? 'duplicate' : policy.reason === 'disabled' || policy.reason === 'consent' ? 'off' : 'invalid';
    return { status: 'skip', reason, streak };
  }
  const candidates = eligibleMoments(input, tz);
  const pick = candidates[0];
  if (!pick) return { status: 'skip', reason: 'none_eligible', streak };
  const lang = record.lang;
  const variants = templateVariants(pick.template, lang).length;
  return { status: 'send', day, lang, candidates, pick, variant: localVariant(input.personHash, agent.id, day, pick.moment, variants), variants, streak };
}
