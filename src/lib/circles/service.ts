/**
 * The circle ledger (GROUP_AGENTS_SPEC §9 S2, R2): open, decide, include, withdraw, leave, audience,
 * export and erase, one circle transaction each. Telegram I/O, flags and ordering live in
 * studio/circle-groups.ts; this module only keeps the consent ledger honest:
 *  - a decision is honoured only on the current card, after it was presented, once per event id;
 *  - consent is granted exactly while joined, for 365 days, covering the agents the card names;
 *  - every Join opens a membership window and every leave, withdrawal or expiry closes it. Windows
 *    are append-only: leaving erases nothing (R2 decision 4). Only the person's own erasure removes
 *    their row, windows included;
 *  - the per-person index is written before any commit that adds the person (superset-safe);
 *  - a consent past its 365 days expires lazily inside every transaction that reads joins, its window
 *    closing at expiresAt; a circle that closes (or an agent removal that leaves someone covering
 *    nothing) ends those joins the same way, so a reopened card needs fresh taps;
 *  - tap fingerprints and event owners are keyed with the participant's own random `key`: erasing the
 *    row drops their events and leaves nothing that links back to them.
 */

import { createHmac, randomBytes } from 'crypto';
import {
  CIRCLE_CONSENT_DAYS, CIRCLE_MAX_JOINED, CIRCLE_MAX_ROWS, CIRCLE_MAX_WINDOWS, CIRCLE_POLICY_VERSION, GROUP_MEMORY_PURPOSE,
  type CardShown, type CircleAudience, type CircleDecision, type CircleDocument, type CircleGroupView, type CircleParticipant,
  type CircleParticipationExport, type CircleSurface, type ParticipantState,
} from './contracts';
import { CircleRepository } from './repository';

/** Studio's group id (org-bridge groupId), restated so the ledger loads without the runtime directory. */
export const groupIdOf = (chatId: number) => `chat-${Math.abs(chatId)}`;
const DAY_MS = 86_400_000;
const NUDGE_MS = DAY_MS;
const CELEBRATE_MS = DAY_MS;
/** A failed card post is retried at most once a minute. */
export const CARD_POST_RETRY_MS = 60_000;
const keyed = (key: string, value: unknown) => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex').slice(0, 32);
const ownerOf = (p: CircleParticipant) => keyed(p.key, 'owner');

export type DecideRefusal = 'stale' | 'early' | 'full' | 'limit';
export type DecideOutcome =
  /** unchanged: a repeat Not me / Only reply that changed nothing and committed nothing */
  | { ok: true; participant: CircleParticipant; previous?: ParticipantState; replay: boolean; unchanged?: true; joined: number }
  | { ok: false; reason: DecideRefusal };
export type IncludeOutcome = { ok: true; replay: boolean } | { ok: false; reason: 'stale' | 'early' | 'not_joined' };

/** Joined with a consent still in force at `at`. */
export const activeJoin = (p: CircleParticipant, at: Date) => p.state === 'joined' && p.consent.state === 'granted' && Date.parse(p.consent.expiresAt) > at.getTime();
export const joinedOf = (doc: CircleDocument, at: Date) => doc.participants.filter((p) => activeJoin(p, at));
export const activeAgents = (doc: CircleDocument) => doc.agents.filter((a) => a.status === 'active').map((a) => a.agentId);

function closeWindow(p: CircleParticipant, at: string) {
  const open = p.windows.at(-1);
  if (open && open.leftAt === undefined) open.leftAt = at;
}

function pushHistory(p: CircleParticipant, entry: CircleParticipant['history'][number]) {
  p.history = [...p.history, entry].slice(-20);
}

/** Leaves the circle's notes without erasing anything: consent withdrawn, coverage gone, window closed. */
function stopJoin(doc: CircleDocument, p: CircleParticipant, next: ParticipantState, at: string, eventId: string) {
  const wasJoined = p.state === 'joined';
  if (wasJoined) {
    p.consent = { ...p.consent, state: 'withdrawn', revision: p.consent.revision + 1, epoch: doc.epoch + 1, effectiveAt: at };
    p.coveredAgentIds = [];
    closeWindow(p, at);
    doc.epoch++;
  }
  p.state = next;
  pushHistory(p, { state: next, at, eventId });
  return wasJoined;
}

function recordEvent(doc: CircleDocument, id: string, p: CircleParticipant, print: string) {
  doc.events = [...doc.events, { id, fingerprint: print, owner: ownerOf(p) }].slice(-500);
}

/** Lazy expiry: a join past its 365 days ends at expiresAt (window closed there), consent expired. */
function expire(doc: CircleDocument, at: Date): number {
  let expired = 0;
  for (const p of doc.participants) if (p.state === 'joined' && Date.parse(p.consent.expiresAt) <= at.getTime()) {
    stopJoin(doc, p, 'withdrawn', p.consent.expiresAt, `expired:${Date.parse(p.consent.expiresAt)}`);
    p.consent.state = 'expired';
    expired++;
  }
  return expired;
}

/** Joins nobody can use any more (closed circle, or coverage gone) end without erasing anything. */
function endOrphanJoins(doc: CircleDocument, at: string, eventId: string) {
  for (const p of doc.participants) if (p.state === 'joined' && (doc.status !== 'active' || !p.coveredAgentIds.length)) stopJoin(doc, p, 'withdrawn', at, eventId);
}

export class CircleService {
  constructor(readonly repository: CircleRepository) {}

  get(chatId: number): Promise<CircleDocument | null> { return this.repository.read(groupIdOf(chatId)); }

  /** Creates (or reopens) the circle with its first card. No-op when it is already open. */
  async open(input: { chatId: number; agentId: string; openedBy: number; at: Date; card: { id: string; copyHash: string; locale: 'en' | 'fa'; noticeVersion: string } }): Promise<{ opened: boolean; document: CircleDocument }> {
    const gid = groupIdOf(input.chatId), at = input.at.toISOString();
    return this.repository.transaction<{ opened: boolean; document: CircleDocument }>(gid, (doc) => {
      if (doc?.status === 'active') return { document: doc, result: { opened: false, document: doc } };
      // A closed circle has no joins left (removeAgent ended them); a reopened card needs fresh taps either way.
      if (doc) endOrphanJoins(doc, at, `reopened:${input.at.getTime()}`);
      const next: CircleDocument = doc ?? { schemaVersion: 1, groupId: gid, chatId: input.chatId, revision: 0, epoch: 0, status: 'active',
        openedBy: { telegramId: input.openedBy, at }, agents: [], participants: [], events: [], welcomed: [], nudges: {} };
      next.status = 'active';
      if (doc) { next.openedBy = { telegramId: input.openedBy, at }; next.epoch++; }
      const agent = next.agents.find((a) => a.agentId === input.agentId);
      if (agent) { agent.status = 'active'; delete agent.card; } else next.agents.push({ agentId: input.agentId, status: 'active', addedAt: at });
      next.card = { id: input.card.id, agentId: input.agentId, agentIds: [input.agentId], noticeVersion: input.card.noticeVersion, copyHash: input.card.copyHash, locale: input.card.locale, revisionAt: at };
      return { document: next, result: { opened: true, document: next } };
    });
  }

  /** A later Vox agent in an open circle, with its own include card. False when it is already in, or no circle is open. */
  async addAgent(chatId: number, agentId: string, at: Date, card: { id: string; copyHash: string; locale: 'en' | 'fa' }): Promise<boolean> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      if (!doc || doc.status !== 'active' || doc.agents.some((a) => a.agentId === agentId && a.status === 'active')) return { document: doc, result: false };
      const entry = { agentId, status: 'active' as const, addedAt: at.toISOString(), card: { id: card.id, copyHash: card.copyHash, locale: card.locale, revisionAt: at.toISOString() } };
      doc.agents = [...doc.agents.filter((a) => a.agentId !== agentId), entry];
      return { document: doc, result: true };
    });
  }

  /**
   * The agent left the chat: nobody's coverage names it any more; the circle closes with its last agent.
   * Every join that no longer covers an agent here (all of them, when the circle closes) ends: consent
   * withdrawn, window closed, nothing erased. Rejoining takes a fresh tap on a fresh card.
   */
  async removeAgent(chatId: number, agentId: string, at: Date = new Date()): Promise<void> {
    await this.repository.transaction(groupIdOf(chatId), (doc) => {
      const agent = doc?.agents.find((a) => a.agentId === agentId && a.status === 'active');
      if (!doc || !agent) return { document: doc, result: undefined };
      expire(doc, at);
      agent.status = 'removed';
      for (const p of doc.participants) p.coveredAgentIds = p.coveredAgentIds.filter((a) => a !== agentId);
      if (doc.card) doc.card.agentIds = doc.card.agentIds.filter((a) => a !== agentId);
      if (doc.card && !doc.card.agentIds.length) delete doc.card;
      if (!activeAgents(doc).length) doc.status = 'closed';
      endOrphanJoins(doc, at.toISOString(), `agent-removed:${at.getTime()}`);
      doc.epoch++;
      return { document: doc, result: undefined };
    }, { relief: true });
  }

  /** Where a posted card lives, and what it shows. `agentId` names an include card; none, the circle card. An undefined value clears that field. */
  async markCard(chatId: number, cardId: string, patch: { messageId?: number; shown?: CardShown; editedAt?: string; gone?: true }, agentId?: string): Promise<void> {
    await this.repository.transaction(groupIdOf(chatId), (doc) => {
      const card = !doc ? undefined : agentId ? doc.agents.find((a) => a.agentId === agentId)?.card : doc.card;
      if (!doc || !card || card.id !== cardId) return { document: doc, result: undefined };
      Object.assign(card, patch);
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (card as Record<string, unknown>)[k];
      return { document: doc, result: undefined };
    }, { relief: true });
  }

  /**
   * Claims one card edit, atomically: the counts are computed from the committed document (so a
   * slower, older refresh never overwrites a newer one), and at most one edit per card per `editMs`.
   * 'edit' records what the caller is about to show; 'wait' says when to try again.
   */
  async claimEdit(chatId: number, target: { cardId: string; agentId?: string }, at: Date, editMs: number, force = false):
    Promise<{ kind: 'edit'; shown: CardShown; messageId: number; previous?: CardShown } | { kind: 'wait'; ms: number } | { kind: 'skip' }> {
    type Claim = Awaited<ReturnType<CircleService['claimEdit']>>;
    return this.repository.transaction<Claim>(groupIdOf(chatId), (doc) => {
      const card = !doc ? undefined : target.agentId ? doc.agents.find((a) => a.agentId === target.agentId && a.status === 'active')?.card : doc.card;
      if (!doc || doc.status !== 'active' || !card || card.id !== target.cardId || card.gone || card.messageId === undefined) return { document: doc, result: { kind: 'skip' } };
      const shown = CircleService.cardShown(doc, at, target.agentId);
      if (JSON.stringify(shown) === JSON.stringify(card.shown)) return { document: doc, result: { kind: 'skip' } };
      const wait = card.editedAt ? Date.parse(card.editedAt) + editMs - at.getTime() : 0;
      if (!force && wait > 0) return { document: doc, result: { kind: 'wait', ms: wait } };
      const previous = card.shown;
      card.shown = shown;
      card.editedAt = at.toISOString();
      return { document: doc, result: { kind: 'edit', shown, messageId: card.messageId, ...(previous ? { previous } : {}) } };
    }, { relief: true });
  }

  /** Claims a retry of a card post that never succeeded: at most once per CARD_POST_RETRY_MS (from the card's first presentation). */
  claimPost(chatId: number, target: { cardId: string; agentId?: string }, at: Date): Promise<boolean> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      const card = !doc ? undefined : target.agentId ? doc.agents.find((a) => a.agentId === target.agentId && a.status === 'active')?.card : doc.card;
      if (!doc || doc.status !== 'active' || !card || card.id !== target.cardId || card.gone || card.messageId !== undefined) return { document: doc, result: false };
      if (at.getTime() - Date.parse(card.editedAt ?? card.revisionAt) < CARD_POST_RETRY_MS) return { document: doc, result: false };
      card.editedAt = at.toISOString();
      return { document: doc, result: true };
    }, { relief: true });
  }

  /**
   * One tap on the circle card (or a welcome carrying its buttons), checked again inside the transaction:
   * the card is current and was presented before now, the event is new (a replay returns the first
   * outcome), and Join keeps at most 12 joined humans.
   */
  async decide(chatId: number, input: { telegramId: number; choice: CircleDecision; cardId: string; eventId: string; at: Date; surface: CircleSurface; receiptId?: string }): Promise<DecideOutcome> {
    const at = input.at.toISOString(), print = (p: CircleParticipant) => keyed(p.key, ['decide', input.choice, input.cardId]);
    const joining = input.choice === 'joined';
    return this.repository.transaction(groupIdOf(chatId), (doc): { document: CircleDocument | null; result: DecideOutcome } => {
      const refuse = (reason: DecideRefusal) => ({ document: doc, result: { ok: false as const, reason } });
      // Expiry first, so the cap and "still joined" below count the same joins the schema does.
      if (doc) expire(doc, input.at);
      const seen = doc?.events.find((e) => e.id === input.eventId);
      const current = doc?.participants.find((p) => p.telegramId === input.telegramId);
      if (doc && seen) return current && seen.fingerprint === print(current) ? { document: doc, result: { ok: true, participant: structuredClone(current), replay: true, joined: joinedOf(doc, input.at).length } } : refuse('stale');
      if (!doc || doc.status !== 'active' || !doc.card || doc.card.id !== input.cardId) return refuse('stale');
      if (!(Date.parse(doc.card.revisionAt) < input.at.getTime())) return refuse('early');
      // A repeat Not me / Only reply changes nothing: no commit, no audience change.
      if (!joining && current?.state === input.choice) return { document: doc, result: { ok: true, participant: structuredClone(current), previous: current.state, replay: false, unchanged: true, joined: joinedOf(doc, input.at).length } };
      if (!current && doc.participants.length >= CIRCLE_MAX_ROWS) return refuse('full');
      if (joining && !(current && activeJoin(current, input.at)) && joinedOf(doc, input.at).length >= CIRCLE_MAX_JOINED) return refuse('full');
      if (joining && current && current.state !== 'joined' && current.windows.length >= CIRCLE_MAX_WINDOWS) return refuse('limit');
      const evidence = { eventId: input.eventId, noticeId: `notice:${GROUP_MEMORY_PURPOSE}`, noticeVersion: doc.card.noticeVersion, copyHash: doc.card.copyHash, locale: doc.card.locale,
        presentedAt: doc.card.revisionAt, decidedAt: at, surface: input.surface, ...(input.receiptId ? { receiptId: input.receiptId } : {}), affirmative: true as const, adultDeclared: joining };
      const previous = current?.state;
      const p: CircleParticipant = current ?? { telegramId: input.telegramId, personId: `tg-${input.telegramId}`, key: randomBytes(16).toString('base64url'), state: input.choice,
        consent: { id: `consent:${doc.groupId}:${input.telegramId}`, revision: 1, purpose: GROUP_MEMORY_PURPOSE, purposeVersion: 1, policyVersion: CIRCLE_POLICY_VERSION,
          state: 'declined', epoch: doc.epoch, effectiveAt: at, expiresAt: at }, coveredAgentIds: [], evidence, history: [], windows: [] };
      if (!current) doc.participants.push(p);
      p.evidence = evidence;
      if (joining) {
        // A fresh grant every Join: 365 days from now, covering the agents the card names that are still here.
        const active = new Set(activeAgents(doc));
        const stillJoined = current?.state === 'joined';
        const covered = [...new Set([...(stillJoined ? p.coveredAgentIds : []), ...doc.card.agentIds.filter((a) => active.has(a))])];
        if (!stillJoined) p.windows.push({ joinedAt: at });
        p.consent = { ...p.consent, state: 'granted', revision: p.consent.revision + (current ? 1 : 0), epoch: doc.epoch + 1, effectiveAt: at,
          expiresAt: new Date(input.at.getTime() + CIRCLE_CONSENT_DAYS * DAY_MS).toISOString() };
        p.coveredAgentIds = covered;
        p.state = 'joined';
        pushHistory(p, { state: 'joined', at, eventId: input.eventId });
        doc.epoch++;
      } else {
        stopJoin(doc, p, input.choice, at, input.eventId);
        if (!current) p.consent.state = 'declined';
      }
      recordEvent(doc, input.eventId, p, print(p));
      return { document: doc, result: { ok: true, participant: structuredClone(p), ...(previous ? { previous } : {}), replay: false, joined: joinedOf(doc, input.at).length } };
    }, { relief: !joining });
  }

  /** [Include <agent>] on a later agent's card: only a joined participant extends their coverage. */
  async include(chatId: number, input: { telegramId: number; agentId: string; cardId: string; eventId: string; at: Date }): Promise<IncludeOutcome> {
    const at = input.at.toISOString(), print = (p: CircleParticipant) => keyed(p.key, ['include', input.agentId, input.cardId]);
    return this.repository.transaction(groupIdOf(chatId), (doc): { document: CircleDocument | null; result: IncludeOutcome } => {
      if (doc) expire(doc, input.at);
      const seen = doc?.events.find((e) => e.id === input.eventId), owner = doc?.participants.find((x) => x.telegramId === input.telegramId);
      if (doc && seen) return { document: doc, result: owner && seen.fingerprint === print(owner) ? { ok: true, replay: true } : { ok: false, reason: 'stale' } };
      const agent = doc?.agents.find((a) => a.agentId === input.agentId && a.status === 'active');
      if (!doc || doc.status !== 'active' || !agent?.card || agent.card.id !== input.cardId) return { document: doc, result: { ok: false, reason: 'stale' } };
      if (!(Date.parse(agent.card.revisionAt) < input.at.getTime())) return { document: doc, result: { ok: false, reason: 'early' } };
      const p = doc.participants.find((x) => x.telegramId === input.telegramId);
      if (!p || !activeJoin(p, input.at)) return { document: doc, result: { ok: false, reason: 'not_joined' } };
      if (!p.coveredAgentIds.includes(input.agentId)) { p.coveredAgentIds.push(input.agentId); doc.epoch++; }
      pushHistory(p, { state: 'included', at, eventId: input.eventId, agentId: input.agentId });
      recordEvent(doc, input.eventId, p, print(p));
      return { document: doc, result: { ok: true, replay: false } };
    });
  }

  /**
   * /leave: out of this circle's notes; nothing is erased. Returns whether they had been joined, and
   * `sameEvent` when this very event already withdrew them (another agent in the chat got it first).
   */
  async withdraw(chatId: number, telegramId: number, eventId: string, at: Date): Promise<{ changed: boolean; wasJoined: boolean; sameEvent?: true }> {
    return this.repository.transaction<{ changed: boolean; wasJoined: boolean; sameEvent?: true }>(groupIdOf(chatId), (doc) => {
      if (doc) expire(doc, at);
      const p = doc?.participants.find((x) => x.telegramId === telegramId);
      if (!doc || !p) return { document: doc, result: { changed: false, wasJoined: false } };
      if (p.state === 'withdrawn' || p.state === 'left') return { document: doc, result: { changed: false, wasJoined: false, ...(p.history.some((h) => h.eventId === eventId) ? { sameEvent: true as const } : {}) } };
      const wasJoined = stopJoin(doc, p, 'withdrawn', at.toISOString(), eventId);
      return { document: doc, result: { changed: true, wasJoined } };
    }, { relief: true });
  }

  /** They are no longer in the Telegram chat: state left, open window closed. Returns the ids that had been joined. */
  async onLeft(chatId: number, telegramIds: number[], at: Date, eventId = `left:${at.getTime()}`): Promise<number[]> {
    if (!telegramIds.length) return [];
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      const joined: number[] = [];
      if (!doc) return { document: doc, result: joined };
      expire(doc, at);
      for (const p of doc.participants) if (telegramIds.includes(p.telegramId) && p.state !== 'left') {
        if (stopJoin(doc, p, 'left', at.toISOString(), eventId)) joined.push(p.telegramId);
      }
      if (doc.readers?.present) doc.readers.present = doc.readers.present.filter((id) => !telegramIds.includes(id));
      return { document: doc, result: joined };
    }, { relief: true });
  }

  /** True once per newcomer: the one silent welcome. */
  claimWelcome(chatId: number, telegramId: number): Promise<boolean> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      if (!doc || doc.status !== 'active' || doc.welcomed.includes(telegramId) || doc.participants.some((p) => p.telegramId === telegramId)) return { document: doc, result: false };
      doc.welcomed = [...doc.welcomed, telegramId].slice(-500);
      return { document: doc, result: true };
    });
  }

  /** A welcome that could not be sent: the claim goes, so the next service message (or verify) can try again. */
  async releaseWelcome(chatId: number, telegramIds: number[]): Promise<void> {
    await this.repository.transaction(groupIdOf(chatId), (doc) => {
      if (!doc) return { document: doc, result: undefined };
      doc.welcomed = doc.welcomed.filter((id) => !telegramIds.includes(id));
      return { document: doc, result: undefined };
    }, { relief: true });
  }

  /** True at most once per person per 24 h, and only for someone who never chose in this circle. */
  claimNudge(chatId: number, telegramId: number, at: Date): Promise<boolean> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      const last = doc?.nudges[String(telegramId)];
      const chose = doc?.participants.some((p) => p.telegramId === telegramId && p.state !== 'left');
      if (!doc || doc.status !== 'active' || chose || (last && at.getTime() - Date.parse(last) < NUDGE_MS)) return { document: doc, result: false };
      const kept = Object.entries(doc.nudges).filter(([, when]) => at.getTime() - Date.parse(when) < NUDGE_MS).slice(-499);
      doc.nudges = { ...Object.fromEntries(kept), [String(telegramId)]: at.toISOString() };
      return { document: doc, result: true };
    });
  }

  /** True at most once per 24 h: "Everyone's in". */
  claimCelebration(chatId: number, at: Date): Promise<boolean> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      if (!doc || doc.status !== 'active' || (doc.celebratedAt && at.getTime() - Date.parse(doc.celebratedAt) < CELEBRATE_MS)) return { document: doc, result: false };
      doc.celebratedAt = at.toISOString();
      return { document: doc, result: true };
    });
  }

  /**
   * The last head count less Vox agent bots, the joined participants verified present (unset: the last
   * verified set, less anyone no longer joined) and the humans a full roster verify saw (unset: kept).
   * Written only when something changes; returns the committed document.
   */
  async setReaders(chatId: number, humans: number | null, at: Date, facts: { present?: readonly number[]; seen?: number } = {}): Promise<CircleDocument | null> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => {
      if (!doc) return { document: doc, result: doc };
      const joined = new Set(joinedOf(doc, at).map((p) => p.telegramId));
      const present = [...new Set(facts.present ?? doc.readers?.present ?? [])].filter((id) => joined.has(id)).sort((a, b) => a - b);
      const seen = facts.seen ?? doc.readers?.seen;
      const next = { humans, at: at.toISOString(), present, ...(seen !== undefined ? { seen } : {}) };
      if (doc.readers && JSON.stringify({ ...doc.readers, at: '' }) === JSON.stringify({ ...next, at: '' })) return { document: doc, result: doc };
      doc.readers = next;
      return { document: doc, result: doc };
    }, { relief: true });
  }

  /**
   * Circle-complete (§3, F5): the circle is open, the human readers are known, at most 12, and each is a
   * joined participant: count equality, and every joined person verified present (`present` given, or
   * the set stored at the last verify; none stored is not complete, so a silent swap never counts).
   * coveredBy(agent): complete, and every reader covers that active agent.
   */
  static audience(doc: CircleDocument | null, at: Date, facts: { humans?: number | null; present?: readonly number[]; agentIds?: readonly string[] } = {}): CircleAudience {
    const humans = facts.humans !== undefined ? facts.humans : doc?.readers?.humans ?? null;
    const joined = doc && doc.status === 'active' ? joinedOf(doc, at) : [];
    const present = new Set(facts.present ?? doc?.readers?.present ?? []);
    const complete = !!doc && doc.status === 'active' && humans !== null && humans >= 1 && humans <= CIRCLE_MAX_JOINED && joined.length === humans &&
      joined.every((p) => present.has(p.telegramId) && p.coveredAgentIds.length > 0);
    const agents = doc ? new Set(activeAgents(doc).filter((a) => !facts.agentIds || facts.agentIds.includes(a))) : new Set<string>();
    return {
      complete, joined: joined.length, humans,
      coveredBy: (agentId: string) => complete && agents.has(agentId) && joined.every((p) => p.coveredAgentIds.includes(agentId)),
      revision: doc ? `circle:${doc.groupId}:${doc.revision}:${doc.epoch}` : 'circle:none',
    };
  }

  static view(doc: CircleDocument, at: Date): CircleGroupView {
    const audience = CircleService.audience(doc, at);
    return { joined: audience.joined, total: audience.humans, notes: audience.complete ? 'on' : 'off' };
  }

  /**
   * What a card should show now. The circle card: N joined, M, on = complete, and "Other bots here count
   * as readers" when everyone a full verify saw has joined yet M is higher. An include card (`agentId`):
   * joined who cover it, and on = coveredBy(it).
   */
  static cardShown(doc: CircleDocument, at: Date, agentId?: string): CardShown {
    const a = CircleService.audience(doc, at);
    if (agentId) return { joined: joinedOf(doc, at).filter((p) => p.coveredAgentIds.includes(agentId)).length, total: a.humans, on: a.coveredBy(agentId) };
    const seen = doc.readers?.seen;
    const others = !a.complete && a.humans !== null && seen !== undefined && a.joined >= 1 && a.joined >= seen && a.joined < a.humans;
    return { joined: a.joined, total: a.humans, on: a.complete, ...(others ? { others: true as const } : {}) };
  }

  /** Index first: the person can always be found for export and erasure. */
  async index(telegramId: number, chatId: number): Promise<void> {
    const gid = groupIdOf(chatId);
    await this.repository.updateIndex(telegramId, (ids) => ids.includes(gid) ? ids : [...ids, gid]);
  }

  /** Rights export: only the requester's own rows, confirmed against each circle document. */
  async exportFor(telegramId: number): Promise<CircleParticipationExport[]> {
    const out: CircleParticipationExport[] = [];
    for (const gid of (await this.repository.readIndex(telegramId)).groupIds) {
      const doc = await this.repository.read(gid);
      if (!doc) continue;
      const p = doc.participants.find((x) => x.telegramId === telegramId), welcomed = doc.welcomed.includes(telegramId), nudgedAt = doc.nudges[String(telegramId)];
      if (!p && !welcomed && !nudgedAt) continue;
      out.push({ groupId: doc.groupId, chatId: doc.chatId, ...(p ? { state: p.state, consent: p.consent, coveredAgentIds: p.coveredAgentIds, evidence: p.evidence, history: p.history, windows: p.windows } : {}),
        ...(welcomed ? { welcomed: true as const } : {}), ...(nudgedAt ? { nudgedAt } : {}) } as CircleParticipationExport);
    }
    return out;
  }

  /**
   * Forget me: the person's own row (choices, consent, evidence, windows), welcome and nudge marks go
   * from every circle in their index; nobody else's row changes. Returns the chats where they had been
   * joined (their audience changed) and how many circles held anything of theirs.
   */
  async eraseFor(telegramId: number): Promise<{ erased: number; joinedChats: number[] }> {
    const ids = (await this.repository.readIndex(telegramId)).groupIds, joinedChats: number[] = [];
    let erased = 0;
    for (const gid of ids) {
      const result = await this.repository.transaction(gid, (doc) => {
        if (!doc) return { document: doc, result: { had: false, joined: false, chatId: 0 } };
        const p = doc.participants.find((x) => x.telegramId === telegramId), key = String(telegramId);
        const had = !!p || doc.welcomed.includes(telegramId) || key in doc.nudges || doc.openedBy.telegramId === telegramId;
        if (!had) return { document: doc, result: { had, joined: false, chatId: doc.chatId } };
        doc.participants = doc.participants.filter((x) => x.telegramId !== telegramId);
        // Their tap events go too (owner is keyed with their row's key, which goes with the row).
        if (p) { const owner = ownerOf(p); doc.events = doc.events.filter((e) => e.owner !== owner); }
        doc.welcomed = doc.welcomed.filter((x) => x !== telegramId);
        delete doc.nudges[key];
        if (doc.readers?.present) doc.readers.present = doc.readers.present.filter((x) => x !== telegramId);
        if (doc.openedBy.telegramId === telegramId) doc.openedBy = { at: doc.openedBy.at };
        if (p?.state === 'joined') doc.epoch++;
        return { document: doc, result: { had, joined: p?.state === 'joined', chatId: doc.chatId } };
      }, { relief: true });
      if (result.had) erased++;
      if (result.joined) joinedChats.push(result.chatId);
    }
    if (ids.length) await this.repository.updateIndex(telegramId, () => []);
    return { erased, joinedChats };
  }

  /** Maintenance (every join-reading transaction also does this lazily): a consent past its 365 days is expired, its window closed at expiresAt. */
  async prune(chatId: number, at: Date): Promise<number> {
    return this.repository.transaction(groupIdOf(chatId), (doc) => ({ document: doc, result: doc ? expire(doc, at) : 0 }), { relief: true });
  }
}
