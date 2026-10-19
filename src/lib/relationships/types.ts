/** Relationship data is scoped conversational state, never administrative configuration. */
export type RelationshipMode = 'off' | 'shadow' | 'live';
export type Audience = { kind: 'private'; personId: string } | { kind: 'group'; groupId: string };
export interface RelationshipKey { personaId: string; chatKey: string; audience: Audience }
export interface TurnInput extends RelationshipKey {
  eventId: string; speakerId: string; text: string; source: 'telegram' | 'call'; at?: Date; memoryIds?: string[];
}
export interface Preference { key: string; value: string; sourceId: string; sourceIds?: string[]; updatedAt: string }
export interface Situation { topic: string; summary: string; status: 'open' | 'closed'; sourceIds: string[]; updatedAt: string }
export type IntentionStatus = 'pending' | 'evaluating' | 'sending' | 'sent' | 'closed' | 'cancelled' | 'delivery_unknown';
export interface Intention {
  id: string; key: RelationshipKey; topic: string; purpose: string; sourceIds: string[];
  dueAt: string; expiresAt: string; status: IntentionStatus; revision: number;
  leaseOwner?: string; leaseUntil?: string; attempts: number; messageId?: string; reason?: string;
}
export interface RelationshipState {
  key: RelationshipKey; epoch: number; revision: number; disabled: boolean; pausedUntil?: string;
  timeZone: string; quietHours: { start: number; end: number }; lastInboundAt?: string;
  lastOutreachAt?: string; unansweredCount: number; preferences: Preference[];
  lastTelegramMessageId?: number;
  situations: Situation[]; intentions: Intention[]; eventIds: string[]; forgottenSourceIds: string[];
}
export interface Assessment {
  /** Direct global contact boundary; model output can never resume contact. */
  control?: { action: 'stop' | 'pause'; until?: string };
  preferences?: Array<{ key: string; value: string }>;
  situations?: Array<{ topic: string; summary: string; status: 'open' | 'closed' }>;
  followUp?: { topic: string; purpose: string; dueAt: string; expiresAt?: string };
  /** Only explicit current-user statements may produce these fields. */
  timeZone?: string; quietHours?: { start: number; end: number };
}
export interface Assessor { assess(input: { key: RelationshipKey; text: string; context: string; now: Date }): Promise<Assessment> }
export type DecisionAction = 'send' | 'defer' | 'close' | 'stay_quiet';
export interface DecisionProvider { choose(input: { context: string; phase: 'observe' | 'reconsider'; now: Date }): Promise<DecisionAction> }
export interface RelationshipPolicy {
  minimumDelayMs: number; maximumDelayMs: number; expiryMs: number; cooldownMs: number;
  retryMs: number; leaseMs: number; maxAttempts: number; allowGroupOutreach: boolean;
}
export interface DrainDeps {
  limit?: number;
  /** Whole-drain wall-clock budget, capped at 30 seconds. */
  budgetMs?: number;
  authorize(job: Intention): Promise<boolean>;
  /** Return only current context authorized for exactly this job's audience. */
  loadContext(job: Intention): Promise<string>;
  compose(job: Intention, context: string): Promise<string>;
  /** Implementations should pass the signal through to transport when supported. */
  send(job: Intention, text: string, signal?: AbortSignal): Promise<string | void>;
}
export interface DrainReport { claimed: number; sent: number; deferred: number; closed: number; suppressed: number; failed: number; shadow: number }
