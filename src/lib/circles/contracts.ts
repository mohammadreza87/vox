/**
 * Circles ledger shapes (GROUP_AGENTS_SPEC §8.3/§8.4 as amended by R2), browser-safe: no Node imports.
 * One circle document per Telegram group: who joined, what they were shown, which agents each covers,
 * and an append-only list of membership windows per person (R2 decision 4: leaving or withdrawing
 * erases nothing, it closes the open window; later slices use the windows to route group notes).
 * S2 holds no notes. Counts leave this ledger; names never do.
 */

export type ParticipantState = 'joined' | 'reply_only' | 'declined' | 'withdrawn' | 'left';
export type CircleConsentState = 'granted' | 'declined' | 'withdrawn' | 'expired';
export type CircleSurface = 'group_card' | 'dm_card' | 'mini_app';
export type CircleDecision = 'joined' | 'reply_only' | 'declined';

export const GROUP_MEMORY_PURPOSE = 'optional.group_memory' as const;
export const CIRCLE_POLICY_VERSION = 'circle-v1' as const;
/** Consent lasts 365 days (§5.5); notes (S3) keep their own 365-day retention per copy (R2). */
export const CIRCLE_CONSENT_DAYS = 365;
/** Joined humans per circle (R2 decision 1). */
export const CIRCLE_MAX_JOINED = 12;
export const CIRCLE_MAX_ROWS = 50;
export const CIRCLE_MAX_AGENTS = 10;
/** Membership windows per person per circle: append-only, so a Join past this is refused (the document stays under its byte cap). */
export const CIRCLE_MAX_WINDOWS = 24;

/** One stretch of membership: opened by Join, closed by any leave, withdrawal or expiry. Never removed but by the person's own erasure. */
export interface MembershipWindow { joinedAt: string; leftAt?: string }

export interface CircleEvidence {
  /** callback_query.id or a server id */
  eventId: string;
  noticeId: string;
  noticeVersion: string;
  /** sha256 of the exact notice text plus button labels (notice.ts copyHash) */
  copyHash: string;
  locale: 'en' | 'fa';
  /** Always earlier than decidedAt */
  presentedAt: string;
  decidedAt: string;
  surface: CircleSurface;
  receiptId?: string;
  affirmative: true;
  /** True only for Join (PRIV-004) */
  adultDeclared: boolean;
}

export interface CircleConsent {
  id: string;
  revision: number;
  purpose: typeof GROUP_MEMORY_PURPOSE;
  purposeVersion: 1;
  policyVersion: typeof CIRCLE_POLICY_VERSION;
  /** granted exactly while the participant is joined */
  state: CircleConsentState;
  epoch: number;
  effectiveAt: string;
  expiresAt: string;
}

export interface CircleParticipant {
  telegramId: number;
  personId: string;
  /** Random per-row secret: tap fingerprints and event owner tags are keyed with it, so erasing the row unlinks them. */
  key: string;
  state: ParticipantState;
  consent: CircleConsent;
  /** The agents this person said yes to in this circle; empty unless joined. */
  coveredAgentIds: string[];
  evidence: CircleEvidence;
  /** Most recent 20 transitions */
  history: Array<{ state: ParticipantState | 'included'; at: string; eventId: string; agentId?: string }>;
  /** Append-only (R2 decision 4); at most one open window, the last one, exactly while joined. */
  windows: MembershipWindow[];
}

/** What a posted card shows now, so a refresh edits only on change. */
export interface CardShown { joined: number; total: number | null; on: boolean; /** "Other bots here count as readers." */ others?: true }

export interface CircleCard {
  /** Short opaque id in every button's callback data; a tap on any other id is a stale card. */
  id: string;
  agentId: string;
  /** The agents the card names: what one Join covers. */
  agentIds: string[];
  /** Unset until a post succeeded; a failed post is retried (claimPost). */
  messageId?: number;
  /** Deleted in the chat (an edit found no message): never edited or posted again. */
  gone?: true;
  noticeVersion: string;
  copyHash: string;
  locale: 'en' | 'fa';
  /** When the notice was first presented: every decision on it is later. */
  revisionAt: string;
  shown?: CardShown;
  /** Last edit, or last post attempt while messageId is unset */
  editedAt?: string;
}

export interface CircleAgent {
  agentId: string;
  status: 'active' | 'removed';
  addedAt: string;
  /** A later agent's own include card */
  card?: { id: string; messageId?: number; gone?: true; copyHash: string; locale: 'en' | 'fa'; revisionAt: string; shown?: CardShown; editedAt?: string };
}

export interface CircleDocument {
  schemaVersion: 1;
  groupId: string;
  chatId: number;
  revision: number;
  /** Bumps on every change of who is joined or what they cover. */
  epoch: number;
  status: 'active' | 'closed';
  /** The host who opened it; their id goes with their own erasure. */
  openedBy: { telegramId?: number; at: string };
  card?: CircleCard;
  agents: CircleAgent[];
  participants: CircleParticipant[];
  /** Idempotency of taps (callback_query.id), most recent 500. Content-free: fingerprint and owner are keyed with the participant's `key`. */
  events: Array<{ id: string; fingerprint: string; owner: string }>;
  /** Content-free: who got the one silent newcomer welcome */
  welcomed: number[];
  /** Content-free: Telegram id → last join nudge (once per 24 h) */
  nudges: Record<string, string>;
  /**
   * Last head count less Vox agent bots (null = unknown: safe mode); `present`: joined participants who
   * passed getChatMember at the last verify (complete needs every joined one there); `seen`: humans
   * verified present at the last full roster verify (for "Other bots here count as readers").
   */
  readers?: { humans: number | null; at: string; present?: number[]; seen?: number };
  /** Last "Everyone's in" (once per 24 h) */
  celebratedAt?: string;
}

/** Per-person index (§8.4): written before any circle commit that adds them, so it may hold extra ids. */
export interface CirclePersonIndex { v: 1; groupIds: string[] }

/** For later slices: is this group turn circle-complete, and for which agents. */
export interface CircleAudience {
  complete: boolean;
  /** Joined participants with an unexpired consent */
  joined: number;
  /** Readers less Vox agent bots; null = unknown */
  humans: number | null;
  coveredBy(agentId: string): boolean;
  revision: string;
}

/** listGroups: counts only, never names. */
export interface CircleGroupView { joined: number; total: number | null; notes: 'on' | 'off' }

/** A person's own participation, for export (rights-http, pet export). */
export interface CircleParticipationExport {
  groupId: string;
  chatId: number;
  state: ParticipantState;
  consent: CircleConsent;
  coveredAgentIds: string[];
  evidence: CircleEvidence;
  history: CircleParticipant['history'];
  windows: MembershipWindow[];
  welcomed?: true;
  nudgedAt?: string;
}

/* ---------- S3 personal notes (R2 decision 2) ---------- */

/** A note's text, at most this many characters. */
export const NOTE_MAX_CHARS = 2000;
/** Active copies one person may hold. */
export const NOTES_MAX_ACTIVE = 500;
/** Each copy is kept 365 days (R2), erasable any time. */
export const NOTE_DAYS = 365;
/** A save proposal lives 10 minutes. */
export const NOTE_PROPOSAL_MS = 10 * 60_000;

export type NoteOrigin = 'dm' | 'group';

/**
 * One person's copy of a note. A DM save is one copy; a group save writes one copy per recipient, all
 * sharing one noteId. agentIds: the agents that may use it (a DM save: its agent; a group copy: the
 * circle agents the recipient covered at save time). A deleted copy is a tombstone: no text.
 */
export interface NoteCopy {
  /** `<owner base36>-<random>`: an [Erase] button names its owner and is refused for anyone else. */
  copyId: string;
  noteId: string;
  text?: string;
  origin: NoteOrigin;
  savedByAgentId: string;
  agentIds: string[];
  /** Group origin only */
  fromGroupId?: string;
  groupTitle?: string;
  authorTelegramId: number;
  savedAt: string;
  expiresAt: string;
  status: 'active' | 'deleted';
  deletedAt?: string;
}

/** "Save this?" before the asker's one-tap confirm; its id (`<owner base36>-<random>`) is the cs:/cn: callback id. */
export interface NoteProposal {
  id: string;
  /** Minted with the proposal, so every copy of a retried save shares it. */
  noteId: string;
  agentId: string;
  origin: NoteOrigin;
  /** Where the confirm must be tapped: the DM or the group. */
  chatId: number;
  groupTitle?: string;
  text: string;
  locale: 'en' | 'fa';
  createdAt: string;
  expiresAt: string;
  /** A group save in flight: the one tap that claimed it (a double tap neither writes nor posts twice). */
  claimedAt?: string;
}

/** One person's notes (`circle-notes:v1:<sha256(telegramId)>`): their copies, open proposals and save events. */
export interface PersonNotes {
  v: 1;
  copies: NoteCopy[];
  proposals: NoteProposal[];
  /** Idempotency: a save event (the proposal id) once committed, and the copy it made. */
  events: Array<{ id: string; copyId: string }>;
  /** When this person last used forget me: a save that began before it is refused (it would outlive the erasure). Kept a day. */
  forgottenAt?: string;
}

/** Export: the requester's own active copies; anyone else is "another member". */
export interface NoteExport {
  copyId: string;
  noteId: string;
  text: string;
  origin: NoteOrigin;
  agentIds: string[];
  fromGroupId?: string;
  groupTitle?: string;
  author: 'you' | 'another member';
  savedAt: string;
  expiresAt: string;
}
