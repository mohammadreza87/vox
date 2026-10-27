/** ER1 control formats and original-work capabilities. No account creation on import. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';
import { z } from 'zod';
import { decodeDeliveryState, encodeDeliveryState, type DeliveryState } from '../tireh/delivery/assistant-text-protocol';

const integer = z.number().int().nonnegative().safe().refine(value => !Object.is(value, -0));
const positive = integer.refine(value => value > 0);
const hex = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const fields = { version: z.literal(1), incarnation: hex, revision: positive };
export const memoryLifecycleSchema = z.discriminatedUnion('mode', [
  z.object({ ...fields, mode: z.literal('legacy-current') }).strict(),
  z.object({ ...fields, mode: z.literal('fresh-confirmed'), confirmedAt: integer, sourceCutoffMs: integer }).strict(),
]);
export type MemoryLifecycle = z.infer<typeof memoryLifecycleSchema>;
export function assertMemoryAccountId(accountId: string): void {
  if (!/^telegram-account:[1-9]\d{0,15}(?![\s\S])/.test(accountId) || !Number.isSafeInteger(Number(accountId.slice(17)))) throw new Error('Invalid memory account');
}
export function memoryAccountSynchronous<T, A extends unknown[]>(callback: (...args: A) => T, ...args: A): T {
  if (types.isAsyncFunction(callback)) throw new Error('Synchronous memory account authority required');
  const result = callback(...args);
  if (result && (typeof result === 'object' || typeof result === 'function') && 'then' in result) throw new Error('Synchronous memory account authority required');
  return result;
}
export const MEMORY_ACCOUNT_MARKER = 'memory-account-lifecycle-v1.json';
export const MEMORY_ACCOUNT_MARKER_BYTES = '{"version":1,"kind":"memory-account-lifecycle"}\n';
export const MEMORY_ACCOUNT_TIME = 'memory-account-time-v1.json';
export const memoryAccountTimeSchema = z.object({ version: z.literal(1), highWaterMs: integer }).strict();
export function memoryAccountCutoff(acceptedAt: number): number {
  integer.parse(acceptedAt);
  const cutoff = Math.ceil((acceptedAt + 2_000 + 1_000) / 1_000) * 1_000;
  return integer.parse(cutoff);
}
export function parseMemoryLifecycle(value: unknown, now: number): MemoryLifecycle {
  integer.parse(now);
  const lifecycle = memoryLifecycleSchema.parse(value);
  if (lifecycle.mode === 'fresh-confirmed' && (lifecycle.confirmedAt > now || lifecycle.sourceCutoffMs !== memoryAccountCutoff(lifecycle.confirmedAt))) throw new Error('Invalid memory lifecycle time');
  return lifecycle;
}
const outcome = z.unknown().transform((value, ctx): DeliveryState => {
  try { const bytes = encodeDeliveryState(value as DeliveryState); if (bytes.byteLength > 4096) throw new Error(); return decodeDeliveryState(bytes); }
  catch { ctx.addIssue({ code: 'custom', message: 'Invalid closed delivery state' }); return z.NEVER; }
});
const erasingSchema = z.object({ version: z.literal(1), kind: z.literal('memory-account-erasing'),
  accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}(?![\s\S])/), incarnation: hex, revision: positive,
  operationId: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/),
  scopeManifestDigest: hex, closedAt: integer, sourceCutoffMs: integer, attemptCount: integer.refine(n => n <= 3),
  lastAttemptAt: integer, attemptDeadline: integer, nextAttemptAt: integer.nullable(), metadataRetainUntil: integer,
  dispatchedOutcomes: z.array(z.object({ state: outcome, retainUntil: integer }).strict()).max(32),
}).strict();
export type MemoryAccountErasing = z.infer<typeof erasingSchema>;
export function isMemoryAccountErasing(value: unknown): boolean {
  return !!value && typeof value === 'object' && 'kind' in value && value.kind === 'memory-account-erasing';
}
export function parseMemoryAccountErasing(value: unknown, accountId: string, now: number): MemoryAccountErasing {
  integer.parse(now);
  const closed = erasingSchema.parse(value);
  assertMemoryAccountId(accountId);
  if (closed.accountId !== accountId || !Number.isSafeInteger(Number(accountId.slice(17))) || closed.closedAt > now ||
      closed.sourceCutoffMs < memoryAccountCutoff(closed.closedAt) || closed.metadataRetainUntil !== closed.closedAt + 86_400_000 ||
      !Number.isSafeInteger(closed.metadataRetainUntil) || closed.lastAttemptAt > now ||
      closed.attemptDeadline > closed.metadataRetainUntil || closed.nextAttemptAt !== null && closed.nextAttemptAt > closed.metadataRetainUntil ||
      closed.attemptCount === 3 && closed.nextAttemptAt !== null || Buffer.byteLength(JSON.stringify(closed)) > 163_840) throw new Error('Invalid closed memory account');
  const keys = new Set<string>();
  for (const row of closed.dispatchedOutcomes) {
    if (!['sent', 'unknown'].includes(row.state.phase) || row.state.contentEligible || row.state.scope.accountId !== accountId || row.state.createdAt > closed.closedAt || row.retainUntil > row.state.expiresAt || row.retainUntil > closed.metadataRetainUntil || keys.has(row.state.effectKey)) throw new Error('Invalid closed memory outcome');
    keys.add(row.state.effectKey);
  }
  return closed;
}
export type MemoryAccountExpected = { kind: 'missing' } | { kind: 'legacy'; documentDigest: string } | { kind: 'current'; incarnation: string; revision: number; documentDigest: string };
export type MemoryAccountStatus = { state: 'unmarked' | 'missing'; expected: { kind: 'missing' } } |
  { state: 'legacy-current' | 'active'; expected: MemoryAccountExpected; lifecycle?: MemoryLifecycle } |
  { state: 'erasing'; expected: MemoryAccountExpected; closed: MemoryAccountErasing };

declare const workBrand: unique symbol;
export interface MemoryAccountWork { readonly [workBrand]: true }
export interface MemoryAccountWorkDetails { readonly directory: string; readonly accountId: string; readonly incarnation: string; readonly sourceDateSeconds?: number; readonly clock: () => number }
interface Registry { work: WeakMap<MemoryAccountWork, Readonly<MemoryAccountWorkDetails>>; context: AsyncLocalStorage<MemoryAccountWork> }
const slot = Symbol.for('vox.memory-account-work.v1');
function registry(): Registry {
  const global = globalThis as typeof globalThis & { [slot]?: Registry };
  return global[slot] ??= { work: new WeakMap(), context: new AsyncLocalStorage() };
}
/** Internal server capability constructor. Only the repository captures actual committed state. */
export function registerMemoryAccountWork(details: MemoryAccountWorkDetails): MemoryAccountWork {
  const token = Object.freeze({}) as MemoryAccountWork;
  registry().work.set(token, Object.freeze({ ...details }));
  return token;
}
export function memoryAccountWorkDetails(work: MemoryAccountWork): Readonly<MemoryAccountWorkDetails> {
  const details = registry().work.get(work);
  if (!details) throw new Error('Original memory account work required');
  return details;
}
export function currentMemoryAccountWork(): MemoryAccountWork | undefined { return registry().context.getStore(); }
export function runWithMemoryAccountWork<T>(work: MemoryAccountWork, fn: () => T): T {
  memoryAccountWorkDetails(work);
  return registry().context.run(work, fn);
}
export function assertMemoryAccountSource(lifecycle: MemoryLifecycle, dateSeconds: number | undefined, now: number): void {
  integer.parse(now);
  if (dateSeconds === undefined) return;
  positive.parse(dateSeconds);
  const originalMs = dateSeconds * 1000;
  if (!Number.isSafeInteger(originalMs) || originalMs > now + 2000 || lifecycle.mode === 'fresh-confirmed' && originalMs <= lifecycle.sourceCutoffMs) throw new Error('Memory account source refused');
}
