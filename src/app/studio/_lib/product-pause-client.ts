'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { productPauseCommandSchema, productPauseReceiptSchema, productPauseScopeSchema, type ProductPauseCommandV1, type ProductPauseReceiptV1 } from '@/lib/adaptive/product-pause/contracts';
import type { ProductPauseControlView } from '@/lib/studio/product-pause-http';
import { tg } from './client';
export type PauseSpace = 'work' | 'personal';
export type PauseNotice = '' | 'unknown' | 'stale' | 'current' | 'pause' | 'resume' | 'unchanged';
export interface PauseState {
  phase: 'initial' | 'loading' | 'ready' | 'pending' | 'unknown' | 'auth';
  status: ProductPauseControlView | null;
  command?: ProductPauseCommandV1;
  notice: PauseNotice;
}
const statusSchema = z.object({ version: z.literal(1), accountId: z.string().min(1), space: z.enum(['work', 'personal']), available: z.boolean(),
  productPaused: z.boolean().nullable(), useEpoch: z.number().int().nonnegative().safe().nullable(), commandSeq: z.number().int().nonnegative().safe().optional(),
  latest: productPauseReceiptSchema.optional(), reason: z.string().optional(), canPause: z.boolean(), canResume: z.boolean(),
  resumeReason: z.enum(['profile_confirmation_required', 'approval_required', 'storage_unavailable']).optional(),
}).strict().superRefine((s, context) => {
  if (!s.available) { if (s.canPause || s.canResume) context.addIssue({ code: 'custom', message: 'Unavailable controls' }); return; }
  if (!productPauseScopeSchema.safeParse({ space: s.space, productPaused: s.productPaused, useEpoch: s.useEpoch, commandSeq: s.commandSeq, ...(s.latest ? { latest: s.latest } : {}) }).success)
    context.addIssue({ code: 'custom', message: 'Invalid current pause state' });
});
export function parsePauseStatus(raw: unknown, space: PauseSpace, accountId?: string): ProductPauseControlView {
  const value = statusSchema.parse(raw);
  if (value.space !== space || accountId !== undefined && value.accountId !== accountId) throw new Error('pause_scope_changed');
  return value;
}
export function newPauseCommand(status: ProductPauseControlView, action: 'pause' | 'resume'): ProductPauseCommandV1 {
  if (!status.available || status.commandSeq === undefined || !(action === 'pause' ? status.canPause : status.canResume)) throw new Error('pause_action_unavailable');
  // 24 random bytes, not UUID punctuation or a client clock. Keep this tuple immutable.
  const eventId = Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');
  return Object.freeze(productPauseCommandSchema.parse({ version: 1, eventId, expectedCommandSeq: status.commandSeq, space: status.space, action }));
}
async function matches(command: ProductPauseCommandV1, accountId: string, receipt?: ProductPauseReceiptV1): Promise<boolean> {
  if (!receipt || receipt.eventId !== command.eventId || receipt.seq !== command.expectedCommandSeq + 1) return false;
  const bytes = new TextEncoder().encode(JSON.stringify(['product-pause-command-v1', accountId, command.space, command.expectedCommandSeq, command.action]));
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  return receipt.fingerprint === fingerprint;
}
class PauseHttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
export const productPauseApi = {
  async read(space: PauseSpace, session: string, signal: AbortSignal, accountId?: string) {
    return parsePauseStatus(await transport(`?space=${space}`, session, signal), space, accountId);
  },
  async command(command: ProductPauseCommandV1, accountId: string, session: string, signal: AbortSignal) {
    const raw = z.object({ status: statusSchema, receipt: productPauseReceiptSchema, replayed: z.boolean() }).strict().parse(await transport('', session, signal, command));
    const status = parsePauseStatus(raw.status, command.space, accountId);
    if (!status.available || status.productPaused !== (command.action === 'pause') || !await matches(command, accountId, raw.receipt) ||
      JSON.stringify(raw.receipt) !== JSON.stringify(status.latest)) throw new Error('pause_receipt_unverified');
    return { ...raw, status };
  },
};
async function transport(query: string, session: string, signal: AbortSignal, command?: ProductPauseCommandV1): Promise<unknown> {
  const response = await fetch(`/api/studio/product-pause${query}`, { method: command ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal,
    headers: { Accept: 'application/json', 'X-Telegram-Init-Data': session, ...(command ? { 'Content-Type': 'application/json' } : {}) }, ...(command ? { body: JSON.stringify(command) } : {}) });
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => null);
    throw new PauseHttpError(response.status, raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string' ? raw.error : 'unavailable');
  }
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new Error('invalid_pause_reply');
  return response.json();
}
interface Store { session: string; space: PauseSpace; state: PauseState; listeners: Set<() => void>; generation: number; controller?: AbortController; original?: { command: ProductPauseCommandV1; accountId: string } }
const stores = new Map<PauseSpace, Store>();
let activeSession: string | undefined;
function storeFor(session: string, space: PauseSpace): Store {
  if (activeSession !== session) { for (const store of stores.values()) { store.generation++; store.controller?.abort(); } stores.clear(); activeSession = session; }
  let store = stores.get(space);
  if (!store) { store = { session, space, state: { phase: 'initial', status: null, notice: '' }, listeners: new Set(), generation: 0 }; stores.set(space, store); }
  return store;
}
function publish(store: Store, next: PauseState) { store.state = next; for (const listener of store.listeners) listener(); }
function stillCurrent(store: Store, generation: number) { return store.generation === generation && activeSession === store.session; }
async function read(store: Store, notice?: PauseNotice) {
  if (store.state.phase === 'pending' || store.state.phase === 'loading') return;
  store.controller?.abort(); const controller = new AbortController(); store.controller = controller;
  const generation = ++store.generation;
  publish(store, { ...store.state, phase: 'loading', notice: notice ?? store.state.notice });
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const status = await productPauseApi.read(store.space, store.session, controller.signal, store.state.status?.accountId);
    if (!stillCurrent(store, generation)) return;
    if (controller.signal.aborted) throw new Error('pause_request_aborted');
    const original = store.original;
    let nextNotice: PauseNotice = notice ?? '';
    if (original && original.accountId === status.accountId) {
      const exact = status.productPaused === (original.command.action === 'pause') && await matches(original.command, status.accountId, status.latest);
      if (!stillCurrent(store, generation)) return;
      if (controller.signal.aborted) throw new Error('pause_request_aborted');
      nextNotice = exact ? status.latest!.result === 'unchanged' ? 'unchanged' : original.command.action : notice === 'stale' ? 'stale' : 'current';
    }
    store.original = undefined;
    publish(store, { phase: 'ready', status, notice: nextNotice });
  } catch (error) {
    if (!stillCurrent(store, generation)) return;
    const auth = error instanceof PauseHttpError && error.status === 401;
    if (auth) store.original = undefined;
    publish(store, { phase: auth ? 'auth' : 'unknown', status: auth ? null : store.state.status, notice: notice ?? store.state.notice });
  } finally { clearTimeout(timeout); }
}
async function command(store: Store, action: 'pause' | 'resume') {
  const before = store.state;
  if (before.phase !== 'ready' || !before.status) return;
  const captured = newPauseCommand(before.status, action);
  const generation = ++store.generation, controller = new AbortController(); store.controller?.abort(); store.controller = controller;
  store.original = { command: captured, accountId: before.status.accountId };
  publish(store, { ...before, phase: 'pending', command: captured, notice: '' });
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await productPauseApi.command(captured, before.status.accountId, store.session, controller.signal);
    if (!stillCurrent(store, generation)) return;
    if (controller.signal.aborted) throw new Error('pause_request_aborted');
    store.original = undefined;
    publish(store, { phase: 'ready', status: result.status, notice: result.receipt.result === 'unchanged' ? 'unchanged' : action });
  } catch (error) {
    if (!stillCurrent(store, generation)) return;
    const auth = error instanceof PauseHttpError && error.status === 401;
    const stale = error instanceof PauseHttpError && error.status === 409 && ['product_pause_stale', 'product_pause_conflict'].includes(error.code);
    publish(store, { phase: auth ? 'auth' : 'unknown', status: auth ? null : before.status, notice: stale ? 'stale' : 'unknown' });
    // Reconcile with GET only. Never retry or rebase the captured command.
    if (!auth) void read(store, stale ? 'stale' : 'unknown');
  } finally { clearTimeout(timeout); }
}
export function useProductPause(space: PauseSpace, sessionKey?: string) {
  const [, accountChanged] = useState(0);
  const store = storeFor(sessionKey ?? tg()?.initData ?? '', space);
  const state = useSyncExternalStore(listener => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; }, () => store.state, () => store.state);
  useEffect(() => {
    void read(store);
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const session = sessionKey ?? tg()?.initData ?? '';
      if (session !== store.session) { accountChanged(value => value + 1); return; }
      void read(store);
    };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [store, sessionKey]);
  const knownPaused = state.status?.productPaused === true;
  const uncertain = ['initial', 'loading', 'unknown', 'auth'].includes(state.phase);
  // Only an explicit legacy-store result preserves controls without pause state.
  // A successful HTTP response can still report unverifiable authority.
  const legacyUnprepared = state.status?.available === false && state.status.reason === 'store_not_prepared' &&
    state.status.productPaused === null && state.status.useEpoch === null;
  const unavailable = state.status?.available !== true && !legacyUnprepared;
  const coveredBlocked = knownPaused || uncertain || unavailable || state.phase === 'pending';
  return { ...state, coveredBlocked, refresh: () => read(store), act: (action: 'pause' | 'resume') => command(store, action) };
}
