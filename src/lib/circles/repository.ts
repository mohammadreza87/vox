/**
 * Circle ledger storage (GROUP_AGENTS_SPEC §6 Storage, §8.3, §8.4). Each circle is its own document
 * (`circle:v1:<groupId>`) and each person has a small index (`circle-person:v1:<sha256(telegramId)>`),
 * both on AdaptiveStorage: file `<dataDir>/circles/ledger` or Firestore `adaptiveCircles`. Nothing
 * here touches the single Studio state document or the 16-row account ledger.
 * Every write is one storage transaction, validated (zod .strict() plus invariants) and bounded before
 * commit; a callback that changes nothing commits nothing. A corrupt document throws (fail closed).
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { committedLoader, CommittedReadBusy, type AdaptiveStorage } from '../adaptive/persistence/storage';
import {
  CIRCLE_MAX_AGENTS, CIRCLE_MAX_JOINED, CIRCLE_MAX_ROWS, CIRCLE_MAX_WINDOWS, CIRCLE_POLICY_VERSION, GROUP_MEMORY_PURPOSE,
  type CircleDocument, type CirclePersonIndex,
} from './contracts';

export const CIRCLE_COLLECTION = 'adaptiveCircles';
export const MAX_CIRCLE_BYTES = 400_000;
/** Withdrawals, leaves and erasure never fail on the soft cap (PRIV-013/016): they may commit up to this. */
export const MAX_CIRCLE_RELIEF_BYTES = 900_000;
export const circleKey = (groupId: string) => `circle:v1:${groupId}`;
export const circlePersonKey = (telegramId: number) => `circle-person:v1:${createHash('sha256').update(String(telegramId)).digest('hex')}`;

const iso = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)));
const id = z.string().min(1).max(200);
const tg = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const locale = z.enum(['en', 'fa']);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const hash32 = z.string().regex(/^[a-f0-9]{32}$/);
const shown = z.object({ joined: integer, total: integer.nullable(), on: z.boolean(), others: z.literal(true).optional() }).strict();
const state = z.enum(['joined', 'reply_only', 'declined', 'withdrawn', 'left']);

const participantSchema = z.object({
  telegramId: tg, personId: id, key: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/), state,
  consent: z.object({ id, revision: integer.min(1), purpose: z.literal(GROUP_MEMORY_PURPOSE), purposeVersion: z.literal(1), policyVersion: z.literal(CIRCLE_POLICY_VERSION),
    state: z.enum(['granted', 'declined', 'withdrawn', 'expired']), epoch: integer, effectiveAt: iso, expiresAt: iso }).strict(),
  coveredAgentIds: z.array(id).max(CIRCLE_MAX_AGENTS),
  evidence: z.object({ eventId: id, noticeId: id, noticeVersion: id, copyHash: hash, locale, presentedAt: iso, decidedAt: iso,
    surface: z.enum(['group_card', 'dm_card', 'mini_app']), receiptId: id.optional(), affirmative: z.literal(true), adultDeclared: z.boolean() }).strict(),
  history: z.array(z.object({ state: z.union([state, z.literal('included')]), at: iso, eventId: id, agentId: id.optional() }).strict()).max(20),
  windows: z.array(z.object({ joinedAt: iso, leftAt: iso.optional() }).strict()).max(CIRCLE_MAX_WINDOWS),
}).strict();

const cardSchema = z.object({ id, agentId: id, agentIds: z.array(id).min(1).max(CIRCLE_MAX_AGENTS), messageId: integer.optional(), gone: z.literal(true).optional(), noticeVersion: id, copyHash: hash, locale,
  revisionAt: iso, shown: shown.optional(), editedAt: iso.optional() }).strict();

const documentSchema = z.object({
  schemaVersion: z.literal(1), groupId: id, chatId: z.number().int().refine((v) => v !== 0 && Number.isSafeInteger(v)), revision: integer, epoch: integer,
  status: z.enum(['active', 'closed']), openedBy: z.object({ telegramId: tg.optional(), at: iso }).strict(), card: cardSchema.optional(),
  agents: z.array(z.object({ agentId: id, status: z.enum(['active', 'removed']), addedAt: iso,
    card: z.object({ id, messageId: integer.optional(), gone: z.literal(true).optional(), copyHash: hash, locale, revisionAt: iso, shown: shown.optional(), editedAt: iso.optional() }).strict().optional() }).strict()).max(CIRCLE_MAX_AGENTS),
  participants: z.array(participantSchema).max(CIRCLE_MAX_ROWS),
  events: z.array(z.object({ id, fingerprint: hash32, owner: hash32 }).strict()).max(500),
  welcomed: z.array(tg).max(500),
  nudges: z.record(z.string().regex(/^[1-9]\d{0,15}$/), iso),
  readers: z.object({ humans: integer.nullable(), at: iso, present: z.array(tg).max(CIRCLE_MAX_JOINED).optional(), seen: integer.optional() }).strict().optional(),
  celebratedAt: iso.optional(),
}).strict().superRefine((d, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const active = new Set(d.agents.filter((a) => a.status === 'active').map((a) => a.agentId));
  if (new Set(d.agents.map((a) => a.agentId)).size !== d.agents.length) fail('duplicate agent');
  if (new Set(d.participants.map((p) => p.telegramId)).size !== d.participants.length) fail('duplicate participant');
  if (new Set(d.participants.map((p) => p.key)).size !== d.participants.length) fail('duplicate key');
  if (new Set(d.events.map((e) => e.id)).size !== d.events.length) fail('duplicate event');
  if (d.participants.filter((p) => p.state === 'joined').length > CIRCLE_MAX_JOINED) fail('too many joined');
  if (Object.keys(d.nudges).length > 500) fail('too many nudges');
  if (d.card && !d.card.agentIds.includes(d.card.agentId)) fail('card agent');
  for (const p of d.participants) {
    // Consent is granted exactly while joined; coverage only while joined, and only of active agents.
    if ((p.consent.state === 'granted') !== (p.state === 'joined')) fail('consent state');
    if (p.state !== 'joined' && p.coveredAgentIds.length) fail('coverage without join');
    if (p.coveredAgentIds.some((a) => !active.has(a)) || new Set(p.coveredAgentIds).size !== p.coveredAgentIds.length) fail('coverage');
    if (p.personId !== `tg-${p.telegramId}`) fail('person id');
    if (!(Date.parse(p.evidence.presentedAt) < Date.parse(p.evidence.decidedAt))) fail('presented after decided');
    // Evidence is the latest decision's: Join always carries the adult declaration (PRIV-004).
    if (p.state === 'joined' && !p.evidence.adultDeclared) fail('join without adult declaration');
    const open = p.windows.filter((w) => w.leftAt === undefined);
    if (open.length > 1 || (open.length === 1 && p.windows.at(-1)!.leftAt !== undefined) || (open.length === 1) !== (p.state === 'joined')) fail('windows');
    if (p.windows.some((w) => w.leftAt !== undefined && Date.parse(w.leftAt) < Date.parse(w.joinedAt))) fail('window order');
  }
});

const indexSchema = z.object({ v: z.literal(1), groupIds: z.array(id).max(100) }).strict();

/** Thrown inside a storage transaction to abort it with a result and no write. */
const UNCHANGED = Symbol('circles.unchanged');
type Unchanged = { [UNCHANGED]: true; result: unknown };
const unchanged = (result: unknown): Unchanged => ({ [UNCHANGED]: true, result });
const isUnchanged = (value: unknown): value is Unchanged => !!value && typeof value === 'object' && UNCHANGED in value;

export function parseCircle(raw: unknown, groupId: string): CircleDocument {
  const document = documentSchema.parse(raw) as CircleDocument;
  if (document.groupId !== groupId) throw new Error('invalid_circle_document');
  return document;
}

export class CircleRepository {
  constructor(readonly storage: AdaptiveStorage) {}

  /** The committed document, read without a write where the store allows it. */
  async read(groupId: string): Promise<CircleDocument | null> {
    const raw = await this.load(circleKey(groupId));
    return raw === null ? null : parseCircle(raw, groupId);
  }

  /** The committed document, synchronously (the notes send fence); throws where the store has no synchronous read or a writer holds it. */
  readNow(groupId: string): CircleDocument | null {
    const read = this.storage.readCommittedForEffect?.(circleKey(groupId));
    if (!read || read.status !== 'ready') throw new Error('circle_authority_unavailable');
    return read.document === null ? null : parseCircle(read.document, groupId);
  }

  async readIndex(telegramId: number): Promise<CirclePersonIndex> {
    const raw = await this.load(circlePersonKey(telegramId));
    return raw === null ? { v: 1, groupIds: [] } : indexSchema.parse(raw) as CirclePersonIndex;
  }

  /**
   * One circle transaction. `fn` returns the next document (or the same one, unchanged) and a result; it
   * may rerun. `relief`: a withdrawal, leave or erasure, which commits past the soft byte cap.
   */
  transaction<T>(groupId: string, fn: (current: CircleDocument | null) => { document: CircleDocument | null; result: T }, options: { relief?: boolean } = {}): Promise<T> {
    return this.transact(circleKey(groupId), (raw) => {
      const before = raw === null ? null : parseCircle(raw, groupId);
      const { document, result } = fn(before === null ? null : structuredClone(before));
      if (document === null || JSON.stringify(document) === JSON.stringify(before)) throw unchanged(result);
      document.revision = (before?.revision ?? 0) + 1;
      const checked = parseCircle(JSON.parse(JSON.stringify(document)), groupId);
      if (Buffer.byteLength(JSON.stringify(checked)) > (options.relief ? MAX_CIRCLE_RELIEF_BYTES : MAX_CIRCLE_BYTES)) throw new Error('circle_capacity_reached');
      return { document: checked, result };
    });
  }

  /** Superset-safe: adds before the circle commit that needs it; removes only on the person's own erasure. */
  updateIndex(telegramId: number, fn: (groupIds: string[]) => string[]): Promise<string[]> {
    return this.transact(circlePersonKey(telegramId), (raw) => {
      const before = raw === null ? null : indexSchema.parse(raw) as CirclePersonIndex;
      const groupIds = [...new Set(fn([...(before?.groupIds ?? [])]))];
      if (JSON.stringify(groupIds) === JSON.stringify(before?.groupIds ?? [])) throw unchanged(groupIds);
      if (groupIds.length > 100) throw new Error('circle_index_full');
      return { document: { v: 1, groupIds }, result: groupIds };
    });
  }

  private async transact<T>(key: string, mutate: (raw: unknown | null) => { document: unknown; result: T }): Promise<T> {
    try { return await this.storage.transact(key, mutate); }
    catch (error) { if (isUnchanged(error)) return error.result as T; throw error; }
  }

  private async load(key: string): Promise<unknown | null> {
    const load = committedLoader(this.storage);
    if (load) {
      try { return (await load(key)).value; }
      catch (error) { if (!(error instanceof CommittedReadBusy)) throw error; }
    }
    // A store without a read seam (or a writer holding the lock): an aborted transaction reads the committed value.
    return this.transact(key, (raw) => { throw unchanged(raw); });
  }
}
