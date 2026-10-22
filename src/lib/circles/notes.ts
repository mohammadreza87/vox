/**
 * Personal notes (GROUP_AGENTS_SPEC R2 decision 2, §9 S3): one document per Telegram person
 * (`circle-notes:v1:<sha256(telegramId)>`) on AdaptiveStorage: file `<dataDir>/circles/notes` or
 * Firestore `adaptiveCircleNotes`. Never the Studio state document, the circle ledger or the 16-row
 * account ledger. A DM save writes one copy here; a group save writes one copy into each recipient's
 * own document, all sharing a noteId. Erasing deletes only the eraser's copy (tombstone, no text);
 * forget me empties the whole document. Leaving or withdrawing a circle touches nothing here.
 * Every write is one storage transaction, validated (zod .strict() plus invariants) and bounded before
 * commit; expired copies become tombstones and expired proposals go, lazily, inside each transaction.
 */

import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { committedLoader, CommittedReadBusy, type AdaptiveStorage } from '../adaptive/persistence/storage';
import { receiptIdFor, receiptOwner } from './codec';
import {
  NOTE_DAYS, NOTE_MAX_CHARS, NOTE_PROPOSAL_MS, NOTES_MAX_ACTIVE,
  type NoteCopy, type NoteExport, type NoteOrigin, type NoteProposal, type PersonNotes,
} from './contracts';

export const NOTES_COLLECTION = 'adaptiveCircleNotes';
/** Under AdaptiveStorage's 700 KB document cap: a save past it is refused like a full notebook. */
export const MAX_NOTES_BYTES = 640_000;
/** Tombstones, open proposals and save events kept per person (oldest go first). */
const MAX_TOMBSTONES = 500, MAX_PROPOSALS = 20, MAX_EVENTS = 500;
const DAY_MS = 86_400_000;
/** A group save's claim on its proposal; past this a crashed save no longer holds it. */
export const NOTE_CLAIM_MS = 2 * 60_000;
export const notesKey = (telegramId: number) => `circle-notes:v1:${createHash('sha256').update(String(telegramId)).digest('hex')}`;

const iso = z.string().max(40).refine((v) => Number.isFinite(Date.parse(v)));
const id = z.string().min(1).max(200);
const owned = z.string().regex(/^[0-9a-z]{1,11}-[A-Za-z0-9_-]{12}$/);
const tg = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const origin = z.enum(['dm', 'group']);
const title = z.string().min(1).max(256);
const copySchema = z.object({
  copyId: owned, noteId: id, text: z.string().min(1).max(NOTE_MAX_CHARS).optional(), origin, savedByAgentId: id, agentIds: z.array(id).min(1).max(10),
  fromGroupId: id.optional(), groupTitle: title.optional(), authorTelegramId: tg, savedAt: iso, expiresAt: iso, status: z.enum(['active', 'deleted']), deletedAt: iso.optional(),
}).strict();
const proposalSchema = z.object({
  id: owned, noteId: id, agentId: id, origin, chatId: z.number().int().refine((v) => v !== 0 && Number.isSafeInteger(v)), groupTitle: title.optional(),
  text: z.string().min(1).max(NOTE_MAX_CHARS), locale: z.enum(['en', 'fa']), createdAt: iso, expiresAt: iso, claimedAt: iso.optional(),
}).strict();
const documentSchema = z.object({
  v: z.literal(1), copies: z.array(copySchema).max(NOTES_MAX_ACTIVE + MAX_TOMBSTONES), proposals: z.array(proposalSchema).max(MAX_PROPOSALS),
  events: z.array(z.object({ id: owned, copyId: owned }).strict()).max(MAX_EVENTS), forgottenAt: iso.optional(),
}).strict().superRefine((d, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(d.copies.map((c) => c.copyId)).size !== d.copies.length) fail('duplicate copy');
  if (new Set(d.copies.filter((c) => c.status === 'active').map((c) => c.noteId)).size !== d.copies.filter((c) => c.status === 'active').length) fail('duplicate note');
  if (d.copies.filter((c) => c.status === 'active').length > NOTES_MAX_ACTIVE) fail('too many notes');
  if (new Set(d.proposals.map((p) => p.id)).size !== d.proposals.length) fail('duplicate proposal');
  for (const c of d.copies) {
    // A tombstone carries no text; an active copy always does.
    if ((c.status === 'active') !== (c.text !== undefined) || (c.status === 'deleted') !== (c.deletedAt !== undefined)) fail('tombstone');
    if ((c.origin === 'group') !== (c.fromGroupId !== undefined && c.groupTitle !== undefined)) fail('origin');
    if (!c.agentIds.includes(c.savedByAgentId) || new Set(c.agentIds).size !== c.agentIds.length) fail('agents');
  }
  for (const p of d.proposals) if ((p.origin === 'group') !== (p.groupTitle !== undefined)) fail('proposal origin');
});

/** Every copy, proposal and event belongs to this person (their id is the owner part of each). */
export function parseNotes(raw: unknown, telegramId: number): PersonNotes {
  const doc = documentSchema.parse(raw) as PersonNotes;
  const mine = (value: string) => receiptOwner(value) === telegramId;
  // A group copy's event is the asker's proposal id; the copy it made is always this person's.
  if (!doc.copies.every((c) => mine(c.copyId)) || !doc.proposals.every((p) => mine(p.id)) || !doc.events.every((e) => mine(e.copyId))) throw new Error('invalid_notes_document');
  return doc;
}

const empty = (): PersonNotes => ({ v: 1, copies: [], proposals: [], events: [] });
const UNCHANGED = Symbol('notes.unchanged');
type Unchanged = { [UNCHANGED]: true; result: unknown };
const isUnchanged = (value: unknown): value is Unchanged => !!value && typeof value === 'object' && UNCHANGED in value;

/** An active, unexpired copy this agent may use (the person's own consent is the caller's check). */
export const usableCopy = (c: NoteCopy, agentId: string, at: Date) => c.status === 'active' && Date.parse(c.expiresAt) > at.getTime() && c.agentIds.includes(agentId);
/** A person's copies an agent may use, oldest first. */
export const usableCopies = (doc: PersonNotes | null, agentId: string, at: Date) => (doc?.copies ?? []).filter((c) => usableCopy(c, agentId, at));

export class NotesRepository {
  constructor(readonly storage: AdaptiveStorage) {}

  async read(telegramId: number): Promise<PersonNotes | null> {
    const key = notesKey(telegramId), load = committedLoader(this.storage);
    if (load) {
      try { const raw = (await load(key)).value; return raw === null ? null : parseNotes(raw, telegramId); }
      catch (error) { if (!(error instanceof CommittedReadBusy)) throw error; }
    }
    // A store without a read seam (or a writer holding the lock): an aborted transaction reads the committed value.
    return this.transaction(telegramId, (doc) => ({ document: doc, result: doc }));
  }

  /** The committed document, synchronously (the send fence); throws where the store has no synchronous read or a writer holds it. */
  readNow(telegramId: number): PersonNotes | null {
    const read = this.storage.readCommittedForEffect?.(notesKey(telegramId));
    if (!read || read.status !== 'ready') throw new Error('notes_authority_unavailable');
    return read.document === null ? null : parseNotes(read.document, telegramId);
  }

  /** One transaction; `fn` may rerun. Returning the same document (or null) commits nothing. */
  async transaction<T>(telegramId: number, fn: (current: PersonNotes | null) => { document: PersonNotes | null; result: T }): Promise<T> {
    try {
      return await this.storage.transact(notesKey(telegramId), (raw) => {
        const before = raw === null ? null : parseNotes(raw, telegramId);
        const { document, result } = fn(before === null ? null : structuredClone(before));
        if (document === null || JSON.stringify(document) === JSON.stringify(before)) throw { [UNCHANGED]: true, result } satisfies Unchanged;
        const checked = parseNotes(JSON.parse(JSON.stringify(document)), telegramId), bytes = Buffer.byteLength(JSON.stringify(checked));
        // Only growth is refused: a write that shrinks the document (dismiss, consume, erase) always commits.
        if (bytes > MAX_NOTES_BYTES && bytes > (before === null ? 0 : Buffer.byteLength(JSON.stringify(before)))) throw new Error('notes_capacity_reached');
        return { document: checked, result };
      });
    } catch (error) { if (isUnchanged(error)) return error.result as T; throw error; }
  }
}

/** Expired copies become tombstones; tombstones, proposals and events stay bounded. */
function prune(doc: PersonNotes, at: Date): PersonNotes {
  for (const c of doc.copies) if (c.status === 'active' && Date.parse(c.expiresAt) <= at.getTime()) { delete c.text; c.status = 'deleted'; c.deletedAt = c.expiresAt; }
  const tombstones = doc.copies.filter((c) => c.status === 'deleted');
  if (tombstones.length > MAX_TOMBSTONES) {
    const drop = new Set(tombstones.slice(0, tombstones.length - MAX_TOMBSTONES).map((c) => c.copyId));
    doc.copies = doc.copies.filter((c) => !drop.has(c.copyId));
  }
  doc.proposals = doc.proposals.filter((p) => Date.parse(p.expiresAt) > at.getTime());
  doc.events = doc.events.slice(-MAX_EVENTS);
  if (doc.forgottenAt && Date.parse(doc.forgottenAt) + DAY_MS <= at.getTime()) delete doc.forgottenAt;
  return doc;
}

export type SaveInput = {
  /** The proposal id: a replay of the same save commits nothing more. */
  eventId: string; noteId: string; text: string; origin: NoteOrigin; savedByAgentId: string; agentIds: string[];
  fromGroupId?: string; groupTitle?: string; authorTelegramId: number; at: Date;
  /** The asker's own proposal, consumed in the same commit (a DM save). */
  consume?: true;
};
export type SaveOutcome = { ok: true; copyId: string; replay: boolean } | { ok: false; reason: 'full' | 'forgotten' };
export type ProposalState = { kind: 'open'; proposal: NoteProposal } | { kind: 'saved' } | { kind: 'expired' };
export type ProposalClaim = { kind: 'won'; proposal: NoteProposal } | { kind: 'busy' } | { kind: 'saved' } | { kind: 'expired' };
/** A group save holds this proposal now. */
export const claimed = (p: NoteProposal, at: Date) => p.claimedAt !== undefined && Date.parse(p.claimedAt) + NOTE_CLAIM_MS > at.getTime();

/** The notes ledger: propose, save, erase, export and forget, one transaction each. */
export class CircleNotes {
  constructor(readonly repository: NotesRepository) {}

  read(telegramId: number): Promise<PersonNotes | null> { return this.repository.read(telegramId); }
  readNow(telegramId: number): PersonNotes | null { return this.repository.readNow(telegramId); }

  /** Records a proposal before it is shown; its buttons name it. */
  propose(owner: number, input: Pick<NoteProposal, 'agentId' | 'origin' | 'chatId' | 'groupTitle' | 'text' | 'locale'>, at: Date): Promise<NoteProposal> {
    if (!input.text || input.text.length > NOTE_MAX_CHARS) throw new Error('invalid_note_text');
    return this.repository.transaction(owner, (current) => {
      const doc = prune(current ?? empty(), at);
      const { groupTitle, ...rest } = input;
      const proposal: NoteProposal = { id: receiptIdFor(owner), noteId: randomBytes(12).toString('base64url'), ...rest,
        ...(groupTitle === undefined ? {} : { groupTitle: groupTitle.slice(0, 256) }), createdAt: at.toISOString(), expiresAt: new Date(at.getTime() + NOTE_PROPOSAL_MS).toISOString() };
      doc.proposals = [...doc.proposals, proposal].slice(-MAX_PROPOSALS);
      return { document: doc, result: proposal };
    });
  }

  /** An open proposal; 'saved' once its save committed (a replayed tap), else 'expired'. Read only. */
  async proposal(owner: number, proposalId: string, at: Date): Promise<ProposalState> {
    const doc = await this.repository.read(owner);
    const open = doc?.proposals.find((p) => p.id === proposalId && Date.parse(p.expiresAt) > at.getTime());
    if (open) return { kind: 'open', proposal: open };
    return doc?.events.some((e) => e.id === proposalId) ? { kind: 'saved' } : { kind: 'expired' };
  }

  /** No: the proposal goes; true when it was open. */
  dismiss(owner: number, proposalId: string, at: Date): Promise<boolean> {
    return this.repository.transaction(owner, (current) => {
      if (!current) return { document: null, result: false };
      const had = current.proposals.some((p) => p.id === proposalId && Date.parse(p.expiresAt) > at.getTime());
      current.proposals = current.proposals.filter((p) => p.id !== proposalId);
      return { document: prune(current, at), result: had };
    });
  }

  /**
   * One tap wins a group save: the claim commits before any copy is written, so a concurrent tap (a double
   * tap is two updates) reads 'busy' and neither writes nor posts. A claim older than NOTE_CLAIM_MS is free again.
   */
  claim(owner: number, proposalId: string, at: Date): Promise<ProposalClaim> {
    return this.repository.transaction<ProposalClaim>(owner, (current) => {
      const open = current?.proposals.find((p) => p.id === proposalId && Date.parse(p.expiresAt) > at.getTime());
      if (!current || !open) return { document: null, result: current?.events.some((e) => e.id === proposalId) ? { kind: 'saved' } : { kind: 'expired' } };
      if (claimed(open, at)) return { document: null, result: { kind: 'busy' } };
      open.claimedAt = at.toISOString();
      return { document: current, result: { kind: 'won', proposal: structuredClone(open) } };
    });
  }

  /** A save that did not happen gives its claim back: the asker may tap again. */
  release(owner: number, proposalId: string): Promise<void> {
    return this.repository.transaction(owner, (current) => {
      const open = current?.proposals.find((p) => p.id === proposalId);
      if (!current || !open?.claimedAt) return { document: null, result: undefined };
      delete open.claimedAt;
      return { document: current, result: undefined };
    });
  }

  /** The asker's proposal is done (a group save, after every copy committed); records the event so a replay reads 'saved'. */
  consume(owner: number, proposalId: string, copyId: string, at: Date): Promise<void> {
    return this.repository.transaction(owner, (current) => {
      const doc = prune(current ?? empty(), at);
      doc.proposals = doc.proposals.filter((p) => p.id !== proposalId);
      if (!doc.events.some((e) => e.id === proposalId)) doc.events = [...doc.events, { id: proposalId, copyId }].slice(-MAX_EVENTS);
      return { document: doc, result: undefined };
    });
  }

  /**
   * One copy into `owner`'s notes, idempotently: an event already committed (or an active copy of the
   * same note) returns that copy. At most NOTES_MAX_ACTIVE active copies, and the document byte cap.
   */
  async save(owner: number, input: SaveInput): Promise<SaveOutcome> {
    if (!input.text || input.text.length > NOTE_MAX_CHARS) throw new Error('invalid_note_text');
    try {
      return await this.repository.transaction<SaveOutcome>(owner, (current) => {
        const doc = prune(current ?? empty(), input.at);
        const keep = current === null ? null : doc;
        // Forget me landed after this save began: its copy would outlive the erasure.
        if (doc.forgottenAt && Date.parse(doc.forgottenAt) >= input.at.getTime()) return { document: keep, result: { ok: false, reason: 'forgotten' } };
        // A replay: the save already committed (a copy erased since stays erased), or this note is already here.
        const prior = doc.events.find((e) => e.id === input.eventId)?.copyId ?? doc.copies.find((c) => c.status === 'active' && c.noteId === input.noteId)?.copyId;
        if (prior) return { document: keep, result: { ok: true, copyId: prior, replay: true } };
        if (doc.copies.filter((c) => c.status === 'active').length >= NOTES_MAX_ACTIVE) return { document: keep, result: { ok: false, reason: 'full' } };
        const at = input.at.toISOString();
        const copy: NoteCopy = { copyId: receiptIdFor(owner), noteId: input.noteId, text: input.text, origin: input.origin, savedByAgentId: input.savedByAgentId,
          agentIds: [...new Set(input.agentIds)], ...(input.origin === 'group' ? { fromGroupId: input.fromGroupId, groupTitle: input.groupTitle?.slice(0, 256) } : {}),
          authorTelegramId: input.authorTelegramId, savedAt: at, expiresAt: new Date(input.at.getTime() + NOTE_DAYS * DAY_MS).toISOString(), status: 'active' };
        doc.copies.push(copy);
        doc.events = [...doc.events, { id: input.eventId, copyId: copy.copyId }].slice(-MAX_EVENTS);
        if (input.consume) doc.proposals = doc.proposals.filter((p) => p.id !== input.eventId);
        return { document: doc, result: { ok: true, copyId: copy.copyId, replay: false } };
      });
    } catch (error) {
      if ((error as Error).message === 'notes_capacity_reached') return { ok: false, reason: 'full' };
      throw error;
    }
  }

  /** Undoes a group save that could not reach everyone: this person's copy of the note and its event go entirely. */
  async remove(owner: number, noteId: string, eventId: string): Promise<void> {
    await this.repository.transaction(owner, (current) => {
      if (!current) return { document: null, result: undefined };
      const gone = new Set(current.copies.filter((c) => c.noteId === noteId).map((c) => c.copyId));
      current.copies = current.copies.filter((c) => !gone.has(c.copyId));
      current.events = current.events.filter((e) => e.id !== eventId && !gone.has(e.copyId));
      return { document: current, result: undefined };
    });
  }

  /** Erases the owner's own copy (a tombstone: text gone, ids kept). Returns the copy as it was, or null. */
  erase(owner: number, copyId: string, at: Date): Promise<NoteCopy | null> {
    return this.repository.transaction(owner, (current) => {
      const copy = current?.copies.find((c) => c.copyId === copyId && c.status === 'active');
      if (!current || !copy) return { document: null, result: null };
      const before = structuredClone(copy);
      delete copy.text; copy.status = 'deleted'; copy.deletedAt = at.toISOString();
      return { document: prune(current, at), result: before };
    });
  }

  /** Erases several of the owner's own copies in one commit; returns how many were active. */
  eraseMany(owner: number, copyIds: readonly string[], at: Date): Promise<number> {
    const ids = new Set(copyIds);
    return this.repository.transaction(owner, (current) => {
      const hit = current?.copies.filter((c) => ids.has(c.copyId) && c.status === 'active') ?? [];
      if (!current || !hit.length) return { document: null, result: 0 };
      for (const c of hit) { delete c.text; c.status = 'deleted'; c.deletedAt = at.toISOString(); }
      return { document: prune(current, at), result: hit.length };
    });
  }

  /**
   * Forget me: every copy, proposal and event of this person; nobody else's document changes. Returns how
   * many copies went. `mark` (Circles on: a group save may be in flight) also records forgottenAt, so a save
   * that began before this erasure and commits after it is refused instead of leaving a fresh copy behind.
   */
  async eraseAll(owner: number, mark?: Date): Promise<number> {
    if (!mark) {
      const doc = await this.repository.read(owner);
      if (!doc || (!doc.copies.length && !doc.proposals.length && !doc.events.length)) return 0;
    }
    return this.repository.transaction(owner, (current) => ({ document: { ...empty(), ...(mark ? { forgottenAt: mark.toISOString() } : {}) }, result: current?.copies.length ?? 0 }));
  }

  /** Export: the requester's own active copies; another author is "another member". */
  async exportFor(owner: number, at: Date): Promise<NoteExport[]> {
    const doc = await this.repository.read(owner);
    return (doc?.copies ?? []).filter((c) => c.status === 'active' && Date.parse(c.expiresAt) > at.getTime()).map((c) => ({
      copyId: c.copyId, noteId: c.noteId, text: c.text!, origin: c.origin, agentIds: [...c.agentIds],
      ...(c.origin === 'group' ? { fromGroupId: c.fromGroupId, groupTitle: c.groupTitle } : {}),
      author: c.authorTelegramId === owner ? 'you' as const : 'another member' as const, savedAt: c.savedAt, expiresAt: c.expiresAt,
    }));
  }
}
