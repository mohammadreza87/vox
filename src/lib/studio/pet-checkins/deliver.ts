/**
 * Check-in delivery (design PET_CARE_GAME_DESIGN_2026_10_26 §5.1, §5.4, §5.5): one silent text message from the agent's
 * own bot, a reviewed template only, with three buttons: Open {name} (a web_app button to the pet page with
 * `?ci=<opaque ref>`), Why this?, Stop these. The reminder pattern's final fence (reminder-delivery.ts): the plan is
 * rerun on fresh state and a reservation is written before any side effect; the record is read again just before the
 * send; and a synchronous check runs at the POST itself (the master switch, the Studio's committed state, and any
 * Stop recorded since in this process). One request only: a timeout is recorded as unknown, never retried.
 *
 * The callbacks (`kw:` why, `ks:` stop this type, `ka:` stop all from this agent) answer in the DM's own language:
 * Why edits the message to add the reason line; Stop turns the type off, confirms in place and offers Stop all.
 */

import { createHash } from 'crypto';
import type { InlineKeyboard, TelegramBotClient, TelegramCallbackQuery } from '../../tireh/telegram/client';
import { EN, FA, type CheckinCopyKey } from '../../pet/checkin-copy';
import {
  CHECKIN_LIMITS, CHECKIN_MOMENTS, CHECKIN_PURPOSE, CHECKIN_REF_PARAM, CHECKIN_TYPE_COPY, CHECKIN_TYPE_DEFAULTS, newCheckinAgent, newCheckinRecord,
  type CheckinLang, type CheckinMomentType, type PetCheckinRecord, type PetCheckinSent,
} from '../../pet/checkins';
import { petPageUrl } from '../../pet/links';
import { petFlags } from '../../tireh/pet-flags';
import { canUseAgent } from '../permissions';
import type { Studio } from '../service';
import type { Agent, StudioState } from '../types';
import { newCheckinRef, petCheckinStoreFor } from './store';
import { planCheckin, templateVariants, type CheckinCandidate, type PlanInput } from './planner';

const FSI = '⁨', PDI = '⁩';

/** One catalogue line in a language with its placeholders filled; Persian keeps a Latin name inside Unicode isolates. */
export function checkinLine(key: CheckinCopyKey, lang: CheckinLang, vars: Readonly<Record<string, string>> = {}, variant = 0): string {
  const variants = (lang === 'fa' ? FA[key] : undefined) ?? EN[key];
  const text = variants[Math.min(Math.max(0, variant), variants.length - 1)] ?? variants[0];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? (lang === 'fa' ? `${FSI}${vars[name]}${PDI}` : vars[name]) : whole));
}

/** sha256 of the exact P1 sheet (title, body and the three buttons) a person saw: the consent evidence's copyHash. */
export function p1CopyHash(variant: 'default' | 'forming', lang: CheckinLang, name: string): string {
  const keys: CheckinCopyKey[] = variant === 'forming'
    ? ['perm.P1.forming.title', 'perm.P1.body', 'perm.P1.forming.yes', 'perm.P1.no', 'perm.P1.choose']
    : ['perm.P1.title', 'perm.P1.body', 'perm.P1.yes', 'perm.P1.no', 'perm.P1.choose'];
  return createHash('sha256').update(JSON.stringify([variant, lang, ...keys.map((k) => checkinLine(k, lang, { name }))])).digest('hex');
}

/** `kw:` Why this · `ks:` Stop these · `ka:` Stop all check-ins (from this agent). */
const CALLBACK = /^k([wsa]):([A-Za-z0-9_-]{16,32})$/;
export function parseCheckinCallback(data?: string): { action: 'why' | 'stop' | 'stopAll'; ref: string } | null {
  const m = data && data.length <= 64 ? CALLBACK.exec(data) : null;
  return m ? { action: m[1] === 'w' ? 'why' : m[1] === 's' ? 'stop' : 'stopAll', ref: m[2] } : null;
}

function keyboard(openUrl: string, ref: string, lang: CheckinLang, name: string, why = true): InlineKeyboard {
  return { inline_keyboard: [
    [{ text: checkinLine('ci.btn.open', lang, { name }).slice(0, 64), web_app: { url: openUrl } }],
    [...(why ? [{ text: checkinLine('ci.btn.why', lang), callback_data: `kw:${ref}` }] : []), { text: checkinLine('ci.btn.stop', lang), callback_data: `ks:${ref}` }],
  ] };
}

/** The Open button's URL: the pet page with the opaque reference, or null when the Studio URL cannot host a Mini App. */
export function checkinOpenUrl(webAppUrl: string | undefined, agentId: string, ref: string): string | null {
  const page = petPageUrl(webAppUrl, agentId);
  return page ? `${page}?${CHECKIN_REF_PARAM}=${encodeURIComponent(ref)}` : null;
}

/* ---------- stops seen in this process (the final fence) ---------- */

const g = globalThis as unknown as { __voxPetCheckinStops?: Map<number, number> };
/** A process-wide (not per route bundle) counter per person: a Stop recorded here invalidates any send in flight. */
const stops = () => (g.__voxPetCheckinStops ??= new Map<number, number>());
export const checkinStopEpoch = (userId: number) => stops().get(userId) ?? 0;
export function noteCheckinStop(userId: number): void { stops().set(userId, checkinStopEpoch(userId) + 1); }

/* ---------- recipients ---------- */

/** May this person receive this agent's check-ins? Members who may use the agent only: guests are never asked or sent. */
export function checkinRecipient(state: StudioState, agentId: string, userId: number): Agent | null {
  const agent = state.agents.find((a) => a.id === agentId && a.status === 'active' && !!a.bot);
  const member = state.members.find((m) => m.telegramId === userId && m.role !== 'pending');
  if (!agent || !member || !canUseAgent(member, agent) || (agent.blocked ?? []).includes(userId)) return null;
  return agent;
}

/* ---------- the send ---------- */

export type DeliveryOutcome = 'sent' | 'unknown' | 'failed' | 'cancelled' | 'stale';

export interface DeliveryInput {
  userId: number;
  agentId: string;
  /** rebuilds the planner input on fresh state (care, play, agent) just before the reservation */
  fresh: () => Promise<PlanInput | null>;
  choice: { pick: CheckinCandidate; variant: number; by: 'local' | 'decisions' };
  signal?: AbortSignal;
}

const sameOccurrence = (a: CheckinCandidate, b: CheckinCandidate) => a.moment === b.moment && a.occurrence === b.occurrence;

/**
 * Reserve, recheck, send once, record. `stale`: the fresh plan no longer offers this moment (consent, caps, quiet
 * hours, a Stop, a new day): nothing was sent and nothing counts.
 */
export async function deliverCheckin(studio: Studio, input: DeliveryInput): Promise<DeliveryOutcome> {
  const { userId, agentId } = input;
  if (petFlags().petCheckins !== 'on' || input.signal?.aborted) return 'cancelled';
  const store = await petCheckinStoreFor(studio);
  const plan0 = await input.fresh();
  if (!plan0) return 'stale';
  const stopEpoch = checkinStopEpoch(userId);
  const ref = newCheckinRef();
  // 1. Reserve on the record's current state, with the planner rerun inside the write (freshness and every cap).
  const reserved = await store.update(userId, (current) => {
    if (!current) return { record: null, result: null };
    const plan = planCheckin({ ...plan0, record: current, now: Math.max(plan0.now, current.updatedAt) });
    if (plan.status !== 'send' || !plan.candidates.some((c) => sameOccurrence(c, input.choice.pick))) return { record: null, result: null };
    const at = Math.max(plan0.now, current.updatedAt);
    const variants = templateVariants(input.choice.pick.template, plan.lang).length;
    const row: PetCheckinSent = { ref, agentId, moment: input.choice.pick.moment, occurrence: input.choice.pick.occurrence, day: plan.day, personHash: plan0.personHash,
      at, state: 'reserved', lang: plan.lang, variant: Math.min(input.choice.variant, Math.max(0, variants - 1)), by: input.choice.by };
    return { record: { ...current, updatedAt: at, unopenedStreak: plan.streak, sent: [...current.sent, row].slice(-CHECKIN_LIMITS.sentRows) }, result: { row, sound: current.sound } };
  });
  if (!reserved) return 'stale';
  const { row } = reserved;
  const finish = (state: 'accepted' | 'unknown' | 'failed' | 'cancelled') => store.update(userId, (current) => {
    if (!current) return { record: null, result: undefined };
    const sent = current.sent.map((s) => (s.ref === ref && s.state === 'reserved' ? { ...s, state } : s));
    const counted = state === 'accepted' || state === 'unknown';
    const agents = { ...current.agents };
    if (counted && agents[agentId]) agents[agentId] = { ...agents[agentId], lastSentAt: row.at, week: [...agents[agentId].week.filter((t) => row.at - t < CHECKIN_LIMITS.weekMs), row.at] };
    const season = input.choice.pick.season;
    const seasons = counted && season ? { ...current.seasons, [season.id]: season.year } : current.seasons;
    return { record: { ...current, sent, agents, seasons }, result: undefined };
  }).catch(() => (studio.deps.logger ?? console).warn('[studio] pet_checkin_record_failed'));

  // 2. The recipient and the bot under current state, and the record again (a Stop elsewhere cancels the reservation).
  const state = await studio.deps.store.read();
  const agent = checkinRecipient(state, agentId, userId);
  const token = agent ? studio.botToken(agent) : null;
  const url = agent ? checkinOpenUrl(studio.deps.webAppUrl, agentId, ref) : null;
  const again = await store.get(userId);
  const still = again?.sent.find((s) => s.ref === ref);
  const prefs = again?.agents[agentId];
  if (!agent || !token || !url || still?.state !== 'reserved' || !prefs?.enabled || prefs.consent?.state !== 'granted' || again?.pausedAt !== undefined ||
      !prefs.types[CHECKIN_MOMENTS[row.moment].type] || input.signal?.aborted) { await finish('cancelled'); return 'cancelled'; }
  const text = checkinLine(CHECKIN_MOMENTS[row.moment].template, row.lang, { name: agent.persona.name }, row.variant);
  const bot: TelegramBotClient = studio.deps.botFor(token);
  // 3. Synchronous, at the POST: the switch, committed Studio state when the store offers it, no Stop since step 1.
  const authorizeNow = () => {
    if (petFlags().petCheckins !== 'on' || input.signal?.aborted || checkinStopEpoch(userId) !== stopEpoch) return false;
    const committed = studio.deps.store.readCommittedForEffect?.();
    if (committed) {
      const live = checkinRecipient(committed, agentId, userId);
      if (!live || live.tokenEnc !== agent.tokenEnc) return false;
    }
    return true;
  };
  try {
    await bot.sendMessage(userId, text, { keyboard: keyboard(url, ref, row.lang, agent.persona.name), silent: !reserved.sound, authorizeNow, ...(input.signal ? { signal: input.signal } : {}) });
    await finish('accepted');
    return 'sent';
  } catch (error) {
    // Duck-typed, never instanceof: the bot client may come from another route bundle's copy of the class.
    const e = error as { name?: unknown; method?: unknown; description?: unknown; errorCode?: unknown } | null;
    // The fence refused before any request: nothing was sent and nothing counts.
    if (e?.name === 'ExportAuthorityError') { await finish('cancelled'); return 'cancelled'; }
    // Telegram refused (blocked, never started the bot, too many requests): nothing was delivered, nothing counts.
    const code = typeof e?.errorCode === 'number' ? e.errorCode : undefined;
    if (typeof e?.method === 'string' && typeof e.description === 'string' && (code === undefined || (code >= 400 && code < 500))) { await finish('failed'); return 'failed'; }
    // A timeout or a 5xx may have been accepted: counted as unknown, never retried.
    await finish('unknown');
    return 'unknown';
  }
}

/* ---------- preferences (shared by the route and the callbacks) ---------- */

/**
 * Stop one type, or every check-in from this agent (`type` undefined): immediate, cancels this agent's reserved sends
 * (PRIV-031), and records the stop on the sent row it came from. Returns the updated record (null when none existed).
 */
export async function stopCheckins(studio: Studio, userId: number, agentId: string, type: CheckinMomentType | undefined, at: number,
  via: 'settings' | 'stop_all' = 'settings', fromRef?: string, expectedEpoch?: string): Promise<PetCheckinRecord | null> {
  noteCheckinStop(userId);
  const store = await petCheckinStoreFor(studio);
  const record = await store.update(userId, (current) => {
    if (!current) return { record: null, result: null };
    const prefs = current.agents[agentId] ?? newCheckinAgent();
    const types = type ? { ...prefs.types, [type]: false } : prefs.types;
    const off = !type || !Object.values(types).some(Boolean);
    const consent = off && prefs.consent?.state === 'granted'
      ? { ...prefs.consent, state: 'withdrawn' as const, revision: prefs.consent.revision + 1, withdrawnAt: at, withdrawnVia: via } : prefs.consent;
    const sent = current.sent.map((s) => {
      if (s.agentId !== agentId) return s;
      const cancel = s.state === 'reserved' && (off || CHECKIN_MOMENTS[s.moment].type === type);
      return { ...s, ...(cancel ? { state: 'cancelled' as const } : {}), ...(s.ref === fromRef && s.stoppedAt === undefined ? { stoppedAt: at } : {}) };
    });
    const next: PetCheckinRecord = { ...current, updatedAt: Math.max(current.updatedAt, at), sent,
      agents: { ...current.agents, [agentId]: { ...prefs, types, enabled: prefs.enabled && !off, ...(consent ? { consent } : {}) } } };
    return { record: next, result: next };
  }, expectedEpoch);
  noteCheckinStop(userId);
  return record;
}

/* ---------- callbacks ---------- */

/** The person's language for a callback: the DM's own, else Telegram's. */
const langOf = (row: PetCheckinSent | undefined, code?: string): CheckinLang => row?.lang ?? (/^fa\b/i.test(code ?? '') ? 'fa' : 'en');

/** Why this? / Stop these / Stop all, from the agent's own DM. Never throws (a failed edit is logged, content-free). */
export async function onCheckinCallback(studio: Studio, agent: Agent, query: TelegramCallbackQuery, bot: TelegramBotClient): Promise<void> {
  const parsed = parseCheckinCallback(query.data);
  const log = studio.deps.logger ?? console;
  try {
    if (!parsed || query.message?.chat.type !== 'private' || query.message.chat.id !== query.from.id) { await bot.answerCallbackQuery(query.id); return; }
    const userId = query.from.id;
    const store = await petCheckinStoreFor(studio);
    const record = await store.get(userId);
    const row = record?.sent.find((s) => s.ref === parsed.ref && s.agentId === agent.id);
    if (!record || !row) { await bot.answerCallbackQuery(query.id); return; }
    const lang = langOf(row, query.from.language_code);
    const name = agent.persona.name;
    const type = CHECKIN_MOMENTS[row.moment].type;
    const at = (studio.deps.now?.() ?? new Date()).getTime();
    const message = query.message;
    const url = checkinOpenUrl(studio.deps.webAppUrl, agent.id, row.ref);
    if (parsed.action === 'why') {
      await store.update(userId, (current) => current ? { record: { ...current, sent: current.sent.map((s) => (s.ref === row.ref && s.whyAt === undefined ? { ...s, whyAt: at } : s)) }, result: undefined } : { record: null, result: undefined });
      await bot.answerCallbackQuery(query.id);
      const text = `${checkinLine(CHECKIN_MOMENTS[row.moment].template, lang, { name }, row.variant)}\n\n${checkinLine(CHECKIN_TYPE_COPY[type].why, lang, { name })}`;
      await bot.editMessageText(message.chat.id, message.message_id, text, url ? keyboard(url, row.ref, lang, name, false) : undefined).catch(() => log.warn('[studio] pet_checkin_edit_failed'));
      return;
    }
    if (parsed.action === 'stop') {
      await stopCheckins(studio, userId, agent.id, type, at, 'settings', row.ref);
      await bot.answerCallbackQuery(query.id);
      const text = checkinLine('ci.stopped', lang, { name, category: checkinLine(CHECKIN_TYPE_COPY[type].category, lang, { name }) });
      await bot.editMessageText(message.chat.id, message.message_id, text,
        { inline_keyboard: [[{ text: checkinLine('ci.btn.stopAll', lang), callback_data: `ka:${row.ref}` }]] }).catch(() => log.warn('[studio] pet_checkin_edit_failed'));
      return;
    }
    await stopCheckins(studio, userId, agent.id, undefined, at, 'stop_all', row.ref);
    await bot.answerCallbackQuery(query.id);
    // The confirmation stays; the buttons go (Telegram removes them on an edit without a keyboard).
    const text = checkinLine('ci.stopped', lang, { name, category: checkinLine(CHECKIN_TYPE_COPY[type].category, lang, { name }) });
    await bot.editMessageText(message.chat.id, message.message_id, text).catch(() => log.warn('[studio] pet_checkin_edit_failed'));
  } catch {
    log.warn('[studio] pet_checkin_callback_failed');
    await bot.answerCallbackQuery(query.id).catch(() => undefined);
  }
}

/* ---------- helpers for the route ---------- */

/** The record with this agent's entry created (off, defaults) when missing. */
export function withAgent(record: PetCheckinRecord | null, userId: number, agentId: string, now: number, lang: CheckinLang): PetCheckinRecord {
  const base = record ?? newCheckinRecord(userId, now, lang);
  return base.agents[agentId] ? base : { ...base, agents: { ...base.agents, [agentId]: newCheckinAgent() } };
}

export { CHECKIN_PURPOSE, CHECKIN_TYPE_DEFAULTS };
