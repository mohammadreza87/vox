/**
 * The pet route's check-in parts (design §5.2, §6.2 P1): GET/POST `/api/studio/pet/:agentId/checkins`, which the page's
 * P1 sheet, "Choose moments", the paused note and Settings call; and the bookkeeping a pet open does (the `?ci=` replay,
 * the opened mark for the pause rules and reward signals, the zone the planner reads, the paused note once).
 * pet-http.ts authenticates (members only, the strict 1 h initData window, the Studio origin) before calling here.
 */

import { z } from 'zod';
import {
  CHECKIN_LIMITS, CHECKIN_MOMENTS, CHECKIN_MOMENT_TYPES, CHECKIN_POLICY_VERSION, CHECKIN_PURPOSE, CHECKIN_REF, CHECKIN_TYPE_DEFAULTS, countsTowardCaps,
  type CheckinConsent, type CheckinLang, type CheckinMomentType, type CheckinTypes, type PetCheckinRecord, type PetCheckinReplay, type PetCheckinsRequest, type PetCheckinsView,
} from '../../pet/checkins';
import { isSelectedTimezone } from '../../adaptive/notifications';
import { petFlags } from '../../tireh/pet-flags';
import type { Studio } from '../service';
import { noteCheckinStop, p1CopyHash, stopCheckins, withAgent } from './deliver';
import { petCheckinStoreFor } from './store';

const momentType = z.enum(CHECKIN_MOMENT_TYPES as unknown as [CheckinMomentType, ...CheckinMomentType[]]);
const typesPatch = z.object(Object.fromEntries(CHECKIN_MOMENT_TYPES.map((t) => [t, z.boolean().optional()])) as Record<CheckinMomentType, z.ZodOptional<z.ZodBoolean>>).strict();
const consentInput = z.object({
  variant: z.enum(['default', 'forming']), lang: z.enum(['en', 'fa']), eventId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  presentedAt: z.number().int().positive().safe(),
}).strict();
export const checkinsRequestSchema: z.ZodType<PetCheckinsRequest> = z.union([
  z.object({ enabled: z.literal(true), types: typesPatch.optional(), sound: z.boolean().optional(), consent: consentInput.optional() }).strict(),
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ op: z.literal('stop'), type: momentType.optional() }).strict(),
  z.object({ op: z.literal('resume') }).strict(),
  z.object({ op: z.literal('keepPaused') }).strict(),
]) as z.ZodType<PetCheckinsRequest>;
export const MAX_CHECKINS_BYTES = 1024;

export class CheckinsRequestError extends Error {
  constructor(readonly status: number, readonly code: 'consent_required' | 'checkins_off' | 'consent_invalid') { super(code); this.name = 'CheckinsRequestError'; }
}

/** The view of one person's record for one agent. `now` decides the rolling week. */
export function checkinsView(record: PetCheckinRecord | null, agentId: string, now: number, pausedNote = false): PetCheckinsView {
  const prefs = record?.agents[agentId];
  const week = record ? record.sent.filter((s) => s.agentId === agentId && countsTowardCaps(s) && now - s.at < CHECKIN_LIMITS.weekMs).length : 0;
  return {
    enabled: !!prefs?.enabled && prefs.consent?.state === 'granted',
    types: { ...(prefs?.types ?? CHECKIN_TYPE_DEFAULTS) },
    sound: !!record?.sound,
    ...(record?.pausedAt !== undefined ? { pausedAt: record.pausedAt } : {}),
    ...(pausedNote ? { pausedNote: true as const } : {}),
    ...(!isSelectedTimezone(record?.tz) ? { inboxOnly: true as const } : {}),
    sentThisWeek: week,
    ...(prefs?.lastSentAt !== undefined ? { lastSentAt: prefs.lastSentAt } : {}),
    live: petFlags().petCheckins === 'on',
  };
}

/** `fa` when the initData user's Telegram language starts with fa (as Circles does), else `en`. */
export function initDataLang(initData: string): CheckinLang {
  try {
    const user: unknown = JSON.parse(new URLSearchParams(initData).get('user') ?? '{}');
    const code = user && typeof user === 'object' && 'language_code' in user ? (user as { language_code?: unknown }).language_code : undefined;
    return typeof code === 'string' && /^fa\b/i.test(code) ? 'fa' : 'en';
  } catch { return 'en'; }
}

const validZone = (tz: string | undefined) => (tz && tz.length <= 64 && isSelectedTimezone(tz) ? tz : undefined);

export interface CheckinsCall {
  userId: number;
  agentId: string;
  agentName: string;
  now: number;
  /** the page's x-pet-tz (the planner's zone once valid) */
  tz?: string;
  lang: CheckinLang;
  expectedEpoch?: string;
}

/** GET …/checkins: the view; the paused note is offered (and marked shown) once per pause. */
export async function readCheckins(studio: Studio, call: CheckinsCall): Promise<PetCheckinsView> {
  const store = await petCheckinStoreFor(studio);
  const current = await store.get(call.userId);
  if (current?.pausedAt !== undefined && current.pausedNoteAt === undefined) {
    const shown = await store.update(call.userId, (r) => r && r.pausedAt !== undefined && r.pausedNoteAt === undefined
      ? { record: { ...r, pausedNoteAt: call.now }, result: r } : { record: null, result: null }, call.expectedEpoch);
    if (shown) return checkinsView({ ...shown, pausedNoteAt: call.now }, call.agentId, call.now, true);
  }
  return checkinsView(current, call.agentId, call.now);
}

/** POST …/checkins: one validated change (see PetCheckinsRequest). */
export async function writeCheckins(studio: Studio, call: CheckinsCall, input: PetCheckinsRequest): Promise<PetCheckinsView> {
  const store = await petCheckinStoreFor(studio);
  const { userId, agentId, now } = call;
  if ('op' in input && input.op === 'stop') {
    const record = await stopCheckins(studio, userId, agentId, input.type, now, input.type ? 'settings' : 'stop_all', undefined, call.expectedEpoch);
    return checkinsView(record, agentId, now);
  }
  if ('enabled' in input && !input.enabled) {
    const record = await stopCheckins(studio, userId, agentId, undefined, now, 'settings', undefined, call.expectedEpoch);
    return checkinsView(record, agentId, now);
  }
  const zone = validZone(call.tz);
  const record = await store.update(userId, (current) => {
    const base = withAgent(current, userId, agentId, now, call.lang);
    const prefs = base.agents[agentId];
    let next: PetCheckinRecord = { ...base, updatedAt: Math.max(base.updatedAt, now), ...(zone ? { tz: zone } : {}) };
    if ('op' in input) {
      // resume: the paused note's "Yes, send them" (never resumed without this tap); keepPaused: "Keep paused".
      if (input.op === 'resume') {
        const { pausedAt: _p, pausedNoteAt: _n, ...rest } = next;
        void _p; void _n;
        // The streak restarts from this tap; the rows that paused it stay as they were (unopened), for the labels.
        next = { ...rest, unopenedStreak: 0, resumedAt: now };
      } else if (next.pausedAt !== undefined) next = { ...next, pausedNoteAt: next.pausedNoteAt ?? now };
      return { record: next, result: next };
    }
    // enabled: true
    const wasOn = prefs.enabled && prefs.consent?.state === 'granted';
    let consent: CheckinConsent | undefined = prefs.consent;
    if (!wasOn) {
      if (!input.consent) throw new CheckinsRequestError(400, 'consent_required');
      const c = input.consent;
      if (c.presentedAt >= now || now - c.presentedAt > 24 * 3_600_000) throw new CheckinsRequestError(400, 'consent_invalid');
      consent = {
        purpose: CHECKIN_PURPOSE, state: 'granted', revision: (prefs.consent?.revision ?? 0) + 1, effectiveAt: now,
        evidence: { eventId: c.eventId, noticeId: c.variant === 'forming' ? 'perm.P1.forming' : 'perm.P1', noticeVersion: CHECKIN_POLICY_VERSION,
          copyHash: p1CopyHash(c.variant, c.lang, call.agentName), locale: c.lang, presentedAt: c.presentedAt, decidedAt: now, surface: 'mini_app', affirmative: true },
      };
      next = { ...next, lang: c.lang };
    }
    const types: CheckinTypes = { ...(wasOn ? prefs.types : CHECKIN_TYPE_DEFAULTS), ...stripUndefined(input.types ?? {}) };
    if (!Object.values(types).some(Boolean)) {
      // Every type off is check-ins off: nothing is granted that could never be used.
      if (!wasOn) throw new CheckinsRequestError(400, 'consent_invalid');
    }
    const enabled = Object.values(types).some(Boolean);
    const withdrawn = !enabled && consent?.state === 'granted'
      ? { ...consent, state: 'withdrawn' as const, revision: consent.revision + 1, withdrawnAt: now, withdrawnVia: 'settings' as const } : consent;
    next = {
      ...next, ...(input.sound !== undefined ? { sound: input.sound } : {}),
      agents: { ...next.agents, [agentId]: { ...prefs, enabled, types, ...(withdrawn ? { consent: withdrawn } : {}) } },
      // A type turned off cancels its reserved sends (PRIV-031).
      sent: next.sent.map((s) => (s.agentId === agentId && s.state === 'reserved' && !types[CHECKIN_MOMENTS[s.moment].type] ? { ...s, state: 'cancelled' as const } : s)),
    };
    return { record: next, result: next };
  }, call.expectedEpoch);
  if ('enabled' in input) noteCheckinStop(userId);
  return checkinsView(record, agentId, now);
}

const stripUndefined = (o: Partial<CheckinTypes>): Partial<CheckinTypes> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'boolean')) as Partial<CheckinTypes>;

export interface CheckinOpen { replay?: PetCheckinReplay; checkins?: PetCheckinsView }

/**
 * A pet open (GET view): with `?ci=<ref>` from this person's own check-in for this agent, the moment to replay (within
 * a week of the send) and its row marked opened (`ref`); otherwise this agent's latest send inside 48 h is marked opened
 * (`app`). The zone is kept for the planner and the paused note is offered once. At most one write; never throws past
 * the epoch fence (a broken store gives an empty result).
 */
export async function recordCheckinOpen(studio: Studio, call: CheckinsCall & { ref?: string | null }): Promise<CheckinOpen> {
  const store = await petCheckinStoreFor(studio);
  const { userId, agentId, now } = call;
  const ref = call.ref && CHECKIN_REF.test(call.ref) ? call.ref : undefined;
  const zone = validZone(call.tz);
  const outcome = await store.update(userId, (current) => {
    if (!current) return { record: null, result: { record: null as PetCheckinRecord | null, replay: undefined as PetCheckinReplay | undefined, note: false } };
    let changed = false;
    let replay: PetCheckinReplay | undefined;
    const byRef = ref ? current.sent.find((s) => s.ref === ref && s.agentId === agentId && countsTowardCaps(s)) : undefined;
    if (byRef && now - byRef.at <= CHECKIN_LIMITS.replayMs) replay = { ref: byRef.ref, momentId: byRef.moment, type: CHECKIN_MOMENTS[byRef.moment].type };
    const latest = [...current.sent].filter((s) => s.agentId === agentId && countsTowardCaps(s) && s.openedAt === undefined && s.at <= now && now - s.at <= CHECKIN_LIMITS.openWindowMs)
      .sort((a, b) => b.at - a.at)[0];
    const target = byRef && byRef.openedAt === undefined ? byRef : !byRef ? latest : undefined;
    let sent = current.sent;
    if (target) {
      sent = sent.map((s) => (s.ref === target.ref ? { ...s, openedAt: now, openedVia: target === byRef ? 'ref' as const : 'app' as const } : s));
      changed = true;
    }
    const note = current.pausedAt !== undefined && current.pausedNoteAt === undefined;
    const tzChanged = !!zone && current.tz !== zone;
    if (!changed && !note && !tzChanged) return { record: null, result: { record: current, replay, note: false } };
    const next: PetCheckinRecord = { ...current, sent, ...(tzChanged ? { tz: zone } : {}), ...(note ? { pausedNoteAt: now } : {}),
      unopenedStreak: target ? 0 : current.unopenedStreak };
    return { record: next, result: { record: next, replay, note } };
  }, call.expectedEpoch);
  return { ...(outcome.replay ? { replay: outcome.replay } : {}), ...(outcome.record ? { checkins: checkinsView(outcome.record, agentId, now, outcome.note) } : {}) };
}
