import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { archiveDigest, archiveEventSchema, archiveFileSchema, archiveHeadSchema, archiveScopeKey, archiveScopeSchema,
  archiveStateSchema, ArchiveUnavailableError, type ArchiveAuthority, type ArchiveAuthoritySource, type ArchiveEvent,
  type ArchiveHead, type ArchiveOptions, type ArchiveRepository, type ArchiveScope, type ArchiveState,
  type ArchiveTransport, type CaptureReceipt, type CheckpointReceipt } from './contracts';

export const MAX_ARCHIVE_FILE_BYTES = 128 * 1024;
export const MAX_ARCHIVE_PENDING_BYTES = 64 * 1024;
export const MAX_ARCHIVE_STATE_BYTES = 192 * 1024;
export const MAX_ARCHIVE_CHECKPOINTS = 128;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const common = { schemaVersion: z.literal(1), scope: archiveScopeSchema, botId: integer.min(1),
  sequence: integer.min(1), operationId: z.string().min(1).max(200) };
const bundleSchema = z.object({ ...common, kind: z.literal('events'), events: z.array(archiveEventSchema).min(1).max(8) }).strict();
const manifestSchema = z.object({ ...common, kind: z.literal('manifest'), authorityRevision: z.string().min(1).max(200),
  createdAt: integer, bundle: archiveFileSchema, previous: archiveHeadSchema.nullable() }).strict();
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
// Ingress retry time/derived expiry can differ. Duplicate delivery must retain
// the original timestamps/expiry, without extending retention or re-saving it.
const eventFingerprint = (event: ArchiveEvent) => archiveDigest(encode([event.eventId, event.logicalId, event.revision,
  event.occurredAt, event.role, event.text, event.sourceMessageId ?? null]));
export interface ArchiveRecovery { events: ArchiveEvent[]; status: 'recoverable' | 'captured'; pending: number }
export interface ArchiveStatus { pending: number; oldestPendingAt?: number; head?: ArchiveHead; unknownDelivery: boolean; overdue: boolean; capacityReached: boolean }

/** T1 protocol only. The repository is the existing canonical service ledger;
 * Telegram files supply content, never current grants or a deletion barrier. */
export class TelegramMemoryArchive {
  private readonly now: () => number;
  private readonly maxAgeMs: number;
  private readonly maxCheckpoints: number;
  constructor(private readonly repo: ArchiveRepository, private readonly authority: ArchiveAuthoritySource,
    private readonly transport: ArchiveTransport, options: ArchiveOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxAgeMs = options.maxAgeMs ?? 60_000;
    this.maxCheckpoints = options.maxRestoreCheckpoints ?? MAX_ARCHIVE_CHECKPOINTS;
    if (!Number.isSafeInteger(this.maxAgeMs) || this.maxAgeMs < 1 || this.maxAgeMs > 60_000 ||
      !Number.isSafeInteger(this.maxCheckpoints) || this.maxCheckpoints < 1 || this.maxCheckpoints > MAX_ARCHIVE_CHECKPOINTS) throw new ArchiveUnavailableError('capacity');
  }
  private fence(snapshot: ArchiveAuthority): void {
    if (!snapshot.allowed || !Number.isSafeInteger(snapshot.expiresAt) || this.now() >= snapshot.expiresAt || !this.authority.isCurrent(snapshot)) throw new ArchiveUnavailableError('authority');
  }
  private async authorized(scope: ArchiveScope): Promise<ArchiveAuthority> {
    archiveScopeSchema.parse(scope);
    const result = await this.authority.read(scope);
    if (archiveScopeKey(scope) !== archiveScopeKey(result.scope) || !Number.isSafeInteger(result.botId) || result.botId < 1 ||
      !/^telegram-account:[1-9]\d{0,15}$/.test(scope.accountId) || !Number.isSafeInteger(this.chatId(scope))) throw new ArchiveUnavailableError('scope');
    this.fence(result); return result;
  }
  private chatId(scope: ArchiveScope): number { return Number(scope.accountId.slice('telegram-account:'.length)); }
  private state(raw: ArchiveState | null, auth: ArchiveAuthority): ArchiveState {
    const state = raw === null ? { schemaVersion: 1 as const, scope: auth.scope, botId: auth.botId, revision: 0, pending: [], receipts: [] } : archiveStateSchema.parse(raw);
    if (archiveScopeKey(state.scope) !== archiveScopeKey(auth.scope) || state.botId !== auth.botId) throw new ArchiveUnavailableError('scope');
    return state;
  }
  private suppressed(event: ArchiveEvent, auth: ArchiveAuthority): boolean {
    return auth.suppressedEventIds.includes(event.eventId) || auth.suppressedEventIds.includes(event.logicalId) || event.expiresAt <= this.now();
  }
  private async mutate<T>(auth: ArchiveAuthority, apply: (state: ArchiveState) => T): Promise<T> {
    return this.repo.transact(auth.scope, raw => {
      const state = this.state(raw, auth), result = apply(state); state.revision++;
      if (encode(state).byteLength > MAX_ARCHIVE_STATE_BYTES) throw new ArchiveUnavailableError('capacity');
      return { state: archiveStateSchema.parse(state), result };
    }, () => this.fence(auth));
  }
  async capture(scope: ArchiveScope, input: ArchiveEvent): Promise<CaptureReceipt> {
    const event = archiveEventSchema.parse(input), auth = await this.authorized(scope), now = this.now();
    if (event.receivedAt > now || event.expiresAt <= event.receivedAt || this.suppressed(event, auth)) throw new ArchiveUnavailableError('authority');
    return this.mutate(auth, state => {
      const receipt = state.receipts.find(r => r.eventId === event.eventId);
      if (receipt) {
        if (receipt.fingerprint !== eventFingerprint(event)) throw new ArchiveUnavailableError('integrity');
        return { status: 'duplicate', eventId: event.eventId, recoverable: !state.pending.some(e => e.eventId === event.eventId) };
      }
      const latest = state.receipts.filter(r => r.logicalId === event.logicalId).reduce((max, r) => Math.max(max, r.sourceRevision), 0);
      if (event.revision <= latest) throw new ArchiveUnavailableError('integrity');
      if (state.pending.some(e => now - e.receivedAt >= this.maxAgeMs)) throw new ArchiveUnavailableError('outbox_overdue');
      if (state.pending.length >= 16 || state.receipts.length >= 1024 || (state.head?.sequence ?? 0) >= this.maxCheckpoints ||
        encode([...state.pending, event]).byteLength > MAX_ARCHIVE_PENDING_BYTES) throw new ArchiveUnavailableError('capacity');
      state.pending.push(event);
      state.receipts.push({ eventId: event.eventId, logicalId: event.logicalId, sourceRevision: event.revision, fingerprint: eventFingerprint(event) });
      return { status: 'captured', eventId: event.eventId, recoverable: false };
    });
  }
  async status(scope: ArchiveScope): Promise<ArchiveStatus> {
    const auth = await this.authorized(scope), state = this.state(await this.repo.read(scope), auth); this.fence(auth);
    const oldestPendingAt = state.pending.length ? Math.min(...state.pending.map(e => e.receivedAt)) : undefined;
    return { pending: state.pending.length, ...(oldestPendingAt === undefined ? {} : { oldestPendingAt }), ...(state.head ? { head: state.head } : {}),
      unknownDelivery: !!state.operation && ['unknown', 'bundle_sending', 'manifest_sending'].includes(state.operation.stage),
      overdue: oldestPendingAt !== undefined && this.now() - oldestPendingAt >= this.maxAgeMs,
      capacityReached: (state.head?.sequence ?? 0) >= this.maxCheckpoints || state.receipts.length >= 1024 || state.pending.length >= 16 || encode(state).byteLength >= MAX_ARCHIVE_STATE_BYTES - 4096 };
  }
  private async checkedDownload(file: { fileId: string; digest: string }, auth: ArchiveAuthority): Promise<Uint8Array> {
    this.fence(auth);
    const bytes = await this.transport.download(file.fileId, MAX_ARCHIVE_FILE_BYTES);
    this.fence(auth);
    if (bytes.byteLength > MAX_ARCHIVE_FILE_BYTES || archiveDigest(bytes) !== file.digest) throw new ArchiveUnavailableError('integrity');
    return bytes;
  }
  private async upload(auth: ArchiveAuthority, filename: string, bytes: Uint8Array) {
    if (bytes.byteLength > MAX_ARCHIVE_FILE_BYTES) throw new ArchiveUnavailableError('capacity');
    this.fence(auth);
    const receipt = await this.transport.upload(this.chatId(auth.scope), filename, bytes, () => {
      try { this.fence(auth); return true; } catch { return false; }
    });
    this.fence(auth);
    const file = archiveFileSchema.parse({ ...receipt, digest: archiveDigest(bytes) });
    await this.checkedDownload(file, auth); return file;
  }
  async checkpoint(scope: ArchiveScope, options: { force?: boolean } = {}): Promise<CheckpointReceipt> {
    const auth = await this.authorized(scope);
    let state = this.state(await this.repo.read(scope), auth);
    if (state.operation && ['unknown', 'bundle_sending', 'manifest_sending'].includes(state.operation.stage)) return { status: 'unknown' };
    if (!state.pending.length) return { status: 'empty' };
    if (!state.operation && !options.force && state.pending.length < 8 && this.now() - Math.min(...state.pending.map(e => e.receivedAt)) < this.maxAgeMs) return { status: 'pending' };
    if ((state.head?.sequence ?? 0) >= this.maxCheckpoints) throw new ArchiveUnavailableError('capacity');
    if (!state.operation) await this.mutate(auth, current => {
      if (current.operation) return;
      current.pending = current.pending.filter(e => !this.suppressed(e, auth));
      if (!current.pending.length) return;
      current.operation = { id: randomUUID(), sequence: (current.head?.sequence ?? 0) + 1, authorityRevision: auth.revision,
        eventIds: current.pending.slice(0, 8).map(e => e.eventId), stage: 'prepared', createdAt: this.now() };
    });
    state = this.state(await this.repo.read(scope), auth);
    const operation = state.operation;
    if (!operation) return { status: 'empty' };
    if (operation.authorityRevision !== auth.revision) throw new ArchiveUnavailableError('authority');
    const events = operation.eventIds.map(id => state.pending.find(e => e.eventId === id));
    if (events.some(e => !e || this.suppressed(e, auth))) throw new ArchiveUnavailableError('authority');
    let claimedStage: 'bundle_sending' | 'manifest_sending' | undefined;
    try {
      if (operation.stage === 'prepared') {
        await this.mutate(auth, current => {
          if (current.operation?.id !== operation.id || current.operation.stage !== 'prepared') throw new ArchiveUnavailableError('unknown_delivery');
          current.operation.stage = 'bundle_sending';
        });
        claimedStage = 'bundle_sending';
        const bytes = encode({ schemaVersion: 1, kind: 'events', scope, botId: auth.botId, sequence: operation.sequence, operationId: operation.id, events });
        const file = await this.upload(auth, `vox-events-${operation.id}.json`, bytes);
        await this.mutate(auth, current => {
          if (current.operation?.id !== operation.id || current.operation.stage !== 'bundle_sending') throw new ArchiveUnavailableError('integrity');
          current.operation.stage = 'bundle_verified'; current.operation.bundle = file;
        });
        claimedStage = undefined;
      }
      state = this.state(await this.repo.read(scope), auth);
      if (state.operation?.id !== operation.id || state.operation.stage !== 'bundle_verified' || !state.operation.bundle) return { status: 'unknown' };
      const bundle = state.operation.bundle;
      await this.mutate(auth, current => {
        if (current.operation?.id !== operation.id || current.operation.stage !== 'bundle_verified') throw new ArchiveUnavailableError('unknown_delivery');
        current.operation.stage = 'manifest_sending';
      });
      claimedStage = 'manifest_sending';
      const bytes = encode({ schemaVersion: 1, kind: 'manifest', scope, botId: auth.botId, sequence: operation.sequence,
        operationId: operation.id, authorityRevision: auth.revision, createdAt: this.now(), bundle, previous: state.head ?? null });
      const manifest = await this.upload(auth, `vox-manifest-${operation.id}.json`, bytes);
      await this.mutate(auth, current => {
        if (current.operation?.id !== operation.id || current.operation.stage !== 'manifest_sending' ||
          (current.head?.sequence ?? 0) !== operation.sequence - 1) throw new ArchiveUnavailableError('integrity');
        current.head = { ...manifest, sequence: operation.sequence };
        current.pending = current.pending.filter(e => !operation.eventIds.includes(e.eventId)); delete current.operation;
      });
      return { status: 'recoverable', sequence: operation.sequence };
    } catch (error) {
      // Preserve uncertain effects across restart. Never include error bodies or
      // content in the ledger. Canonical revocation may have removed this op.
      await this.repo.transact(scope, raw => {
        const current = this.state(raw, auth);
        if (claimedStage && current.operation?.id === operation.id && current.operation.stage === claimedStage) {
          current.operation.stage = 'unknown'; current.revision++;
        }
        return { state: current, result: undefined };
      }, () => {}).catch(() => undefined);
      throw error instanceof ArchiveUnavailableError ? error : new ArchiveUnavailableError('unknown_delivery');
    }
  }
  /** Explicit owner reconciliation only: possible uploaded orphan copies remain
   * visible in Telegram. Pending source events stay durable; a later explicit
   * checkpoint can create duplicate documents, never duplicate logical events. */
  async abandonUnknown(scope: ArchiveScope): Promise<{ pending: number }> {
    const auth = await this.authorized(scope);
    return this.mutate(auth, state => {
      if (state.operation && !['unknown', 'bundle_sending', 'manifest_sending'].includes(state.operation.stage)) throw new ArchiveUnavailableError('integrity');
      delete state.operation; return { pending: state.pending.length };
    });
  }
  async recover(scope: ArchiveScope): Promise<ArchiveRecovery> {
    const auth = await this.authorized(scope), state = this.state(await this.repo.read(scope), auth);
    const events: ArchiveEvent[] = [], visited = new Set<string>();
    let head = state.head, count = 0;
    while (head) {
      if (++count > this.maxCheckpoints || visited.has(head.digest)) throw new ArchiveUnavailableError('capacity');
      visited.add(head.digest);
      const manifest = manifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.checkedDownload(head, auth))));
      if (archiveScopeKey(manifest.scope) !== archiveScopeKey(scope) || manifest.botId !== auth.botId || manifest.sequence !== head.sequence ||
        (manifest.previous?.sequence ?? 0) !== manifest.sequence - 1) throw new ArchiveUnavailableError('integrity');
      const bundle = bundleSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await this.checkedDownload(manifest.bundle, auth))));
      if (archiveScopeKey(bundle.scope) !== archiveScopeKey(scope) || bundle.botId !== auth.botId || bundle.sequence !== manifest.sequence || bundle.operationId !== manifest.operationId) throw new ArchiveUnavailableError('integrity');
      events.push(...bundle.events); head = manifest.previous ?? undefined;
    }
    events.push(...state.pending);
    const latest = new Map<string, ArchiveEvent>(), ids = new Map<string, string>();
    for (const event of events) {
      const fingerprint = eventFingerprint(event), previousHash = ids.get(event.eventId), previous = latest.get(event.logicalId);
      if ((previousHash && previousHash !== fingerprint) || (previous?.revision === event.revision && previous.eventId !== event.eventId)) throw new ArchiveUnavailableError('integrity');
      ids.set(event.eventId, fingerprint);
      if (!previous || previous.revision < event.revision) latest.set(event.logicalId, event);
    }
    const current = this.state(await this.repo.read(scope), auth);
    if (current.revision !== state.revision) throw new ArchiveUnavailableError('authority');
    this.fence(auth);
    return { events: [...latest.values()].filter(e => !this.suppressed(e, auth)).sort((a, b) => a.occurredAt - b.occurredAt || a.receivedAt - b.receivedAt || a.eventId.localeCompare(b.eventId)),
      status: state.pending.length ? 'captured' : 'recoverable', pending: state.pending.length };
  }
}
