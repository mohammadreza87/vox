import { createHash } from 'node:crypto';
import { z } from 'zod';

const id = z.string().min(1).max(200);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const archiveScopeSchema = z.object({ accountId: id, personId: id, agentId: id,
  space: z.enum(['work', 'personal']), containerId: id }).strict();
export type ArchiveScope = z.infer<typeof archiveScopeSchema>;
export const archiveEventSchema = z.object({ eventId: id, logicalId: id, revision: integer.min(1),
  occurredAt: integer, receivedAt: integer, expiresAt: integer, role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(4096), sourceMessageId: integer.min(1).optional() }).strict();
export type ArchiveEvent = z.infer<typeof archiveEventSchema>;
export const archiveFileSchema = z.object({ fileId: id, digest, messageId: integer.min(1) }).strict();
export type ArchiveFile = z.infer<typeof archiveFileSchema>;
export const archiveHeadSchema = archiveFileSchema.extend({ sequence: integer.min(1) }).strict();
export type ArchiveHead = z.infer<typeof archiveHeadSchema>;
const operationSchema = z.object({ id, sequence: integer.min(1), authorityRevision: id,
  eventIds: z.array(id).min(1).max(8), stage: z.enum(['prepared', 'bundle_sending', 'bundle_verified', 'manifest_sending', 'unknown']),
  bundle: archiveFileSchema.optional(), createdAt: integer }).strict();
/** Persist this extension in the existing canonical account transaction. No
 * Telegram document, pin or restored snapshot may replace this current state. */
export const archiveStateSchema = z.object({ schemaVersion: z.literal(1), scope: archiveScopeSchema,
  botId: integer.min(1), revision: integer, head: archiveHeadSchema.optional(),
  pending: z.array(archiveEventSchema).max(16), operation: operationSchema.optional(),
  receipts: z.array(z.object({ eventId: id, logicalId: id, sourceRevision: integer.min(1), fingerprint: digest }).strict()).max(1024),
}).strict();
export type ArchiveState = z.infer<typeof archiveStateSchema>;
export interface ArchiveAuthority {
  scope: ArchiveScope; revision: string; allowed: boolean; botId: number;
  expiresAt: number; suppressedEventIds: readonly string[];
}
export interface ArchiveAuthoritySource {
  read(scope: ArchiveScope): Promise<ArchiveAuthority>;
  /** A committed canonical-policy fence, not a cached Boolean. Must fail closed
   * on writes in progress, changed grants, identity, tombstones or expiry. */
  isCurrent(authority: ArchiveAuthority): boolean;
}
export interface ArchiveRepository {
  read(scope: ArchiveScope): Promise<ArchiveState | null>;
  /** Mutate synchronously under the existing canonical writer. beforeCommit
   * MUST run immediately before durable publication, without an await after it.
   * Unsupported stores must reject setup rather than provide a weak fence. */
  transact<T>(scope: ArchiveScope, mutate: (state: ArchiveState | null) => { state: ArchiveState; result: T }, beforeCommit: () => void): Promise<T>;
}
export interface ArchiveTransport {
  /** Implementations must not retry an uncertain delivery. The returned file
   * belongs to the current bot, and chatId is always the scope's owner DM. */
  upload(chatId: number, filename: string, bytes: Uint8Array, authorizeNow: () => boolean): Promise<{ fileId: string; messageId: number }>;
  download(fileId: string, maxBytes: number): Promise<Uint8Array>;
}
export interface ArchiveOptions { now?: () => number; maxAgeMs?: number; maxRestoreCheckpoints?: number }
export type CaptureReceipt = { status: 'captured' | 'duplicate'; eventId: string; recoverable: boolean };
export type CheckpointReceipt = { status: 'pending' | 'empty' | 'recoverable' | 'unknown'; sequence?: number };
export class ArchiveUnavailableError extends Error {
  constructor(readonly code: 'authority' | 'scope' | 'capacity' | 'outbox_overdue' | 'integrity' | 'unknown_delivery') {
    super(`Memory archive unavailable: ${code}`); this.name = 'ArchiveUnavailableError';
  }
}
export const archiveDigest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const archiveScopeKey = (scope: ArchiveScope): string => JSON.stringify([
  scope.accountId, scope.personId, scope.agentId, scope.space, scope.containerId,
]);
