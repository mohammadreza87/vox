import { parseExplicitControl } from '../relationships';
import { containerIdFor, digest, requireProductPauseCapacity, type AdaptiveDocument } from '../adaptive/persistence/repository';
import { MAX_ADAPTIVE_DOCUMENT_BYTES } from '../adaptive/persistence/storage';
import { requireRightsUseHoldCapacity } from '../adaptive/rights-use-holds/state';
import { resetTelegramArchives, suppressTelegramArchiveSource } from '../adaptive/telegram-archive-state';
import { MAX_ARCHIVE_STATE_BYTES, TelegramMemoryArchive } from '../tireh/memory/telegram-archive/service';
import { TelegramArchiveTransport } from '../tireh/memory/telegram-archive/transport';
import { ArchiveUnavailableError, type ArchiveAuthority, type ArchiveEvent, type ArchiveRepository, type ArchiveScope, type ArchiveTransport } from '../tireh/memory/telegram-archive/contracts';
import type { TelegramMessage } from '../tireh/telegram/client';
import type { Studio } from './service';

export class ArchiveCommandDeliveryError extends Error { constructor() { super('Telegram archive command delivery unavailable'); this.name = 'ArchiveCommandDeliveryError'; } }
export class ArchiveAdmissionRefusedError extends Error { constructor() { super('Telegram archive admission unavailable'); this.name = 'ArchiveAdmissionRefusedError'; } }
export class ArchiveCapturePendingError extends Error { constructor() { super('Telegram archive capture pending'); this.name = 'ArchiveCapturePendingError'; } }
const ownerId = (scope: ArchiveScope): number => {
  const match = /^telegram-account:([1-9]\d{0,15})$/.exec(scope.accountId);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw new ArchiveUnavailableError('scope');
  return Number(match[1]);
};
const entry = (d: AdaptiveDocument, scope: ArchiveScope) => d.telegramArchives?.find(r => r.agentId === scope.agentId && r.space === scope.space);
const recent = (events: ArchiveEvent[], now: number, cutoff: number): ArchiveEvent[] => {
  const latest = new Map<string, ArchiveEvent>();
  for (const event of events) {
    const old = latest.get(event.logicalId);
    if (!old || old.revision < event.revision) latest.set(event.logicalId, event);
  }
  return [...latest.values()].filter(event => event.expiresAt > now && event.occurredAt > cutoff).sort((a, b) => a.receivedAt - b.receivedAt).slice(-32);
};

/** FILE-only production adapter. Archive content and trusted suppression live in
 * the same existing account transaction. Telegram is never read on a reply. */
export class StudioTelegramArchive {
  private draft?: AdaptiveDocument;
  private cursor?: string;
  constructor(readonly studio: Studio, readonly enabled: () => boolean, readonly transportFor?: (agentId: string) => ArchiveTransport) {}
  private get adaptive() { if (!this.studio.deps.adaptive) throw new ArchiveUnavailableError('authority'); return this.studio.deps.adaptive; }
  private now() { return this.adaptive.sampleClock(() => (this.studio.deps.now?.() ?? new Date()).getTime()); }
  async scope(telegramId: number, agentId: string, space: 'work' | 'personal' = 'work'): Promise<ArchiveScope> {
    await this.studio.replyAuthority(agentId, telegramId);
    return this.adaptive.withAccountView(telegramId, d => ({ accountId: d.accountId, personId: d.personId, agentId, space,
      containerId: containerIdFor(d.accountId, space) }));
  }
  private authority(d: AdaptiveDocument, scope: ArchiveScope, now: number, setup = false): ArchiveAuthority & {sourceAuthority: string} {
    if (scope.accountId !== d.accountId || scope.personId !== d.personId || scope.containerId !== containerIdFor(d.accountId, scope.space)) throw new ArchiveUnavailableError('scope');
    const state = this.studio.deps.store.readCommittedForEffect?.();
    const agent = state?.agents.find(a => a.id === scope.agentId);
    const token = agent && this.studio.botToken(agent);
    const botId = agent?.bot?.id;
    if (!token) throw new ArchiveUnavailableError('authority');
    if (typeof botId !== 'number' || !Number.isSafeInteger(botId) || botId < 1) throw new ArchiveUnavailableError('authority');
    const studio = this.studio.replyAuthorityNow(scope.agentId, ownerId(scope));
    const row = entry(d, scope);
    const purposes = ['optional.personalization', 'optional.auto_memory'] as const;
    const allowed = this.enabled() && !!row?.enabled && this.adaptive.isCoreAllowed(d, now) && purposes.every(p => this.adaptive.isPurposeAllowed(d, scope.space, p, now, scope.agentId));
    const expiresAt = Math.min(d.binding?.expiresAt ?? now, this.adaptive.capabilityStatus(d, 'core_text', now).validUntil ?? now,
      ...purposes.map(p => d.permissions.find(r => r.purpose === p && r.spaceId.endsWith(`:${scope.space}`))?.expiresAt ?? now),
      ...purposes.map(p => this.adaptive.capabilityStatus(d, p === 'optional.auto_memory' ? 'auto_memory' : 'personalization', now).validUntil ?? Number.MAX_SAFE_INTEGER));
    const sourceAuthority = digest(['owner-dm-archive-v1', this.adaptive.storeIdentity, scope, studio, botId, digest(token),
      this.adaptive.coreFingerprint(d, now), purposes.map(p => this.adaptive.purposeFingerprint(d, scope.space, p, now, scope.agentId)),
      ]);
    const suppressedEventIds = [...new Set(row?.state?.receipts.filter(r => r.suppressed).map(r => r.logicalId) ?? [])];
    const revisionParts: unknown[] = [sourceAuthority, row?.generation ?? 0, row?.clearedAt ?? 0, row?.enabled ?? false];
    // Preserve legacy in-flight operation fences until a source is suppressed.
    if (suppressedEventIds.length) revisionParts.push(suppressedEventIds);
    const revision = digest(revisionParts);
    return {scope, botId, allowed: allowed && (setup || row?.authorityStamp === sourceAuthority), expiresAt, suppressedEventIds, revision, sourceAuthority};
  }
  private current(authority: ArchiveAuthority): boolean {
    try {
      const d = this.draft ?? (() => {
        const read = this.adaptive.repository.readCommittedForEffect(authority.scope.accountId, () => this.now());
        return read.status === 'ready' ? read.document : null;
      })();
      if (!d) return false;
      const current = this.authority(d, authority.scope, this.now());
      return current.allowed && current.expiresAt > this.now() && current.revision === authority.revision;
    } catch { return false; }
  }
  archive(scope: ArchiveScope): TelegramMemoryArchive {
    const telegramId = ownerId(scope);
    const repository: ArchiveRepository = {
      read: () => this.adaptive.withAccountView(telegramId, d => structuredClone(entry(d, scope)?.state ?? null)),
      transact: (key, mutate, beforeCommit) => {
        let draft: AdaptiveDocument | undefined;
        return this.adaptive.withAccountDocument(telegramId, (d, now) => {
          if (digest(key) !== digest(scope)) throw new ArchiveUnavailableError('scope');
          const row = entry(d, scope); if (!row?.enabled) throw new ArchiveUnavailableError('authority');
          draft = d;
          const result = mutate(structuredClone(row.state ?? null));
          row.state = result.state;
          row.index = recent([...row.index, ...result.state.pending], now, row.clearedAt);
          if (Buffer.byteLength(JSON.stringify(d.telegramArchives)) > 256 * 1024) throw new ArchiveUnavailableError('capacity');
          d.revision++; d.updatedAt = now;
          return result.result;
        }, () => { this.draft = draft; try { beforeCommit(); } finally { this.draft = undefined; } });
      },
    };
    const getBot = () => {
      const state = this.studio.deps.store.readCommittedForEffect!(), agent = state.agents.find(a => a.id === scope.agentId), token = agent && this.studio.botToken(agent);
      if (!token) throw new ArchiveUnavailableError('authority');
      return this.studio.deps.botFor(token);
    };
    const transport = this.transportFor?.(scope.agentId) ?? new TelegramArchiveTransport(getBot(), () => {
      try {
        const read = this.adaptive.repository.readCommittedForEffect(scope.accountId, () => this.now());
        return read.status === 'ready' && !!read.document && this.authority(read.document, scope, this.now()).allowed;
      } catch { return false; }
    });
    return new TelegramMemoryArchive(repository, {
      read: key => this.adaptive.withAccountView(telegramId, (d, now) => this.authority(d, key, now)),
      isCurrent: authority => this.current(authority),
    }, transport, {now: () => this.now(), maxAgeMs: 60_000});
  }
  async command(agentId: string, message: TelegramMessage): Promise<boolean> {
    if (!/^\/archive(?:@\S+)?(?:\s|$)/i.test(message.text ?? '')) return false;
    if (message.chat.type !== 'private' || !message.from || message.from.is_bot || message.chat.id !== message.from.id) return true;
    const scope = await this.scope(message.from.id, agentId), action = (message.text ?? '').trim().split(/\s+/)[1]?.toLowerCase() ?? 'status';
    const send = async (text: string) => {
      await this.studio.replyAuthority(agentId, message.from!.id);
      const state = await this.studio.deps.store.read(), agent = state.agents.find(a => a.id === agentId), token = agent && this.studio.botToken(agent);
      if (token) try { await this.studio.deps.botFor(token).sendMessage(message.chat.id, text); } catch { throw new ArchiveCommandDeliveryError(); }
    };
    if (action === 'clear' || action === 'disable') {
      await this.clear(scope, action === 'disable');
      await send('The complete automatic archive and recent-context index were removed from agent use. External Telegram copies may remain.' + (action === 'disable' ? ' Archive capture is disabled.' : ' New eligible messages can start a new archive.'));
      return true;
    }
    if (action === 'enable') {
      if (!this.enabled()) { await send('Telegram memory archive is unavailable on this server.'); return true; }
      await this.adaptive.withAccountDocument(message.from.id, (d, now) => {
        let row = entry(d, scope);
        if (!row) {
          if ((d.telegramArchives?.length ?? 0) >= 4) throw new ArchiveUnavailableError('capacity');
          row = {agentId, space: scope.space, enabled: false, generation: 0, clearedAt: now, index: []};
          (d.telegramArchives ??= []).push(row);
        }
        if (row.authorityStamp !== this.authority(d, scope, now, true).sourceAuthority) resetTelegramArchives(d, now, scope.space, scope.agentId);
        row.enabled = true;
        const authority = this.authority(d, scope, now, true);
        row.authorityStamp = authority.sourceAuthority;
        if (!authority.allowed) throw new ArchiveUnavailableError('authority');
        d.revision++; d.updatedAt = now;
      });
      await send('Telegram user-message archive enabled for new eligible received text messages in this private chat. Private service state keeps pending text and a bounded recent-context index. The recent-context index holds at most 32 messages; this slice stops at 128 checkpoints or 1,024 events. Verified bundles are sent here after 8 eligible received text messages or about a minute. Use /archive status, /archive clear or /archive disable. External Telegram copies may remain after clearing.');
      return true;
    }
    if (action === 'retry-unknown') {
      if ((message.text ?? '').trim().split(/\s+/)[2] !== 'confirm-duplicate-copies') {
        await send('An earlier upload may already exist in Telegram. To release the unknown operation for retry while preserving pending text, send /archive retry-unknown confirm-duplicate-copies. Retrying can create duplicate external documents.');
        return true;
      }
      await this.archive(scope).abandonUnknown(scope);
    }
    if (action === 'flush') await this.archive(scope).checkpoint(scope, {force: true});
    if (action === 'recover') {
      const before = await this.adaptive.withAccountView(message.from.id, d => digest(entry(d, scope)));
      const recovered = await this.archive(scope).recover(scope);
      await this.adaptive.withAccountDocument(message.from.id, (d, now) => {
        const row = entry(d, scope); if (!row?.enabled || !this.authority(d, scope, now).allowed) throw new ArchiveUnavailableError('authority');
        if (digest(row) !== before) throw new ArchiveUnavailableError('authority');
        row.index = recent(recovered.events, now, row.clearedAt); d.revision++; d.updatedAt = now;
      });
    }
    const row = await this.adaptive.withAccountView(message.from.id, d => entry(d, scope));
    if (!row?.enabled || !this.enabled()) { await send('Telegram memory archive is disabled. /archive enable requires current automatic-memory and personalization permission.'); return true; }
    const allowed = await this.adaptive.withAccountView(message.from.id, (d, now) => this.authority(d, scope, now).allowed);
    if (!allowed) { await send('Archive use is suspended because current identity, permissions or agent access changed. Use /archive clear or /archive disable; /archive enable starts a fresh archive after current permissions are restored.'); return true; }
    const status = await this.archive(scope).status(scope);
    await send(`Archive: ${status.unknownDelivery ? 'delivery unknown; paused, no automatic resend; /archive retry-unknown explains recovery' : status.capacityReached ? 'capacity reached; new durable saves paused' : status.pending ? 'service-durable, archive pending' : status.head ? 'archive verified' : 'waiting for new eligible text'}. Pending: ${status.pending}. Recent-context index: ${row.index.length}/32 messages. Archive horizon: at most 128 checkpoints or 1,024 events; /archive clear starts fresh. Only received user text is archived; assistant replies, audio and files are not included. Coverage excludes rejected messages and provider outages before receipt. Older archive sources require explicit recovery; comprehensive recall is not available in this slice.`);
    return true;
  }
  async invalidateEditedMessage(agentId: string, message: TelegramMessage): Promise<void> {
    if (message.chat.type !== 'private' || !message.from || message.from.is_bot || message.chat.id !== message.from.id) return;
    // An unconfigured/off rollout must not create or rewrite an account merely
    // because Telegram delivered an edit. Existing archive rows still suppress.
    const read = this.adaptive.repository.readCommittedForEffect(`telegram-account:${message.from.id}`, () => this.now());
    if (read.status !== 'ready') throw new ArchiveCapturePendingError();
    const d = read.document;
    if (!d?.telegramArchives?.some(r => r.agentId === agentId && r.space === 'work')) return;
    await this.studio.replyAuthority(agentId, message.from.id);
    await this.adaptive.withAccountDocument(message.from.id, (current, now) => {
      if (current.accountId !== d.accountId || current.personId !== d.personId) throw new ArchiveUnavailableError('scope');
      const row = current.telegramArchives?.find(r => r.agentId === agentId && r.space === 'work');
      if (!row) return;
      if (!suppressTelegramArchiveSource(row, `telegram:${message.message_id}`)) resetTelegramArchives(current, now, 'work', agentId);
      current.revision++; current.updatedAt = now;
      let fits = (!row.state || Buffer.byteLength(JSON.stringify(row.state)) <= MAX_ARCHIVE_STATE_BYTES) &&
        Buffer.byteLength(JSON.stringify(current.telegramArchives)) <= 256 * 1024 && Buffer.byteLength(JSON.stringify(current)) <= MAX_ADAPTIVE_DOCUMENT_BYTES;
      try { requireProductPauseCapacity(current); requireRightsUseHoldCapacity(current); } catch { fits = false; }
      if (!fits) {
        // Legacy/full rows have no reserved marker bytes. Suppression still
        // commits: conservatively clear content behind the existing time fence,
        // retaining uncertain external-effect metadata for owner reconciliation.
        const oldState = row.state;
        resetTelegramArchives(current, now, 'work', agentId);
        if (oldState?.operation) row.state = {schemaVersion: 1, scope: oldState.scope, botId: oldState.botId,
          revision: oldState.revision + 1, pending: [], receipts: [], operation: {...oldState.operation, stage: 'unknown'}};
        if (current.events.length < 1500) {
          const receipt = {eventId: `archive-source-reset:${digest([agentId,row.generation])}`, fingerprint: digest([agentId,row.generation,'capacity']),
            kind: 'archive_source_reset', resultId: 'source_suppression_capacity', revision: current.revision};
          current.events.push(receipt);
          try { requireProductPauseCapacity(current); requireRightsUseHoldCapacity(current); if (Buffer.byteLength(JSON.stringify(current)) > MAX_ADAPTIVE_DOCUMENT_BYTES) current.events.pop(); }
          catch { current.events.pop(); }
        }
      }
    });
  }
  async clear(scope: ArchiveScope, disable = false): Promise<void> {
    await this.adaptive.withAccountDocument(ownerId(scope), (d, now) => {
      if (d.personId !== scope.personId || scope.containerId !== containerIdFor(d.accountId, scope.space)) throw new ArchiveUnavailableError('scope');
      resetTelegramArchives(d, now, scope.space, scope.agentId, disable); d.revision++; d.updatedAt = now;
    });
  }
  async capture(agentId: string, message: TelegramMessage, updateId: number): Promise<void> {
    try {
    if (!this.enabled() || message.chat.type !== 'private' || !message.from || message.from.is_bot || message.chat.id !== message.from.id || !message.text || message.text.startsWith('/')) return;
    if (parseExplicitControl(message.text) || /(?:do not|don't|don’t)\s+(?:remember|save|store)|forget (?:this|that)|off[ -]record|ذخیره نکن|به خاطر نسپار|یادت نماند|فراموش کن/iu.test(message.text)) return;
    const scope = await this.scope(message.from.id, agentId);
    const allowed = await this.adaptive.withAccountView(message.from.id, (d, now) => this.authority(d, scope, now).allowed);
    if (!allowed) return;
    const occurredAt = message.date * 1000;
    const row = await this.adaptive.withAccountView(message.from.id, d => entry(d, scope));
    if (!row || occurredAt <= row.clearedAt) return;
    const now = this.now();
    const logicalId = `telegram:${message.message_id}`;
    const archive = this.archive(scope);
    await archive.capture(scope, {eventId: `update:${updateId}`, logicalId, revision: updateId + 1,
      occurredAt, receivedAt: now, expiresAt: occurredAt + 90 * 86400_000, role: 'user', text: message.text, sourceMessageId: message.message_id});
    // Upload is background work; accepted input is already service-durable.
    void Promise.resolve().then(() => archive.checkpoint(scope)).catch(() => undefined);
    } catch (error) {
      if (error instanceof ArchiveUnavailableError) {
        // A bounded refusal receipt has no source text or derived content. A
        // full account may refuse this receipt too; the user still gets an
        // explicit not-accepted response before polling acknowledges input.
        if (message.from) await this.adaptive.withAccountDocument(message.from.id, (d, now) => {
          const eventId = `archive-refusal:${agentId}:${updateId}`;
          if (d.events.length < 1500 && !d.events.some(e => e.eventId === eventId)) {
            d.revision++; d.updatedAt = now;
            d.events.push({eventId, fingerprint: digest([eventId,error.code]), kind:'archive_admission_refused', resultId:error.code, revision:d.revision});
          }
        }).catch(() => undefined);
        throw new ArchiveAdmissionRefusedError();
      }
      throw new ArchiveCapturePendingError();
    }
  }
  async context(telegramId: number, agentId: string, space: 'work' | 'personal', authorityOnly = false): Promise<{revision: string; text: string[]}> {
    if (!this.enabled()) return {revision: 'disabled', text: []};
    const scope = await this.scope(telegramId, agentId, space);
    return this.adaptive.withAccountView(telegramId, (d, now) => {
      const authority = this.authority(d, scope, now), row = entry(d, scope);
      const index = authority.allowed && row ? recent(row.index, now, row.clearedAt).filter(e => !authority.suppressedEventIds.includes(e.logicalId)) : [];
      return {revision: digest([authority.revision, index.map(e => [e.eventId, e.revision, e.expiresAt])]),
        text: authorityOnly ? [] : index.map(e => `Private conversation source (${new Date(e.occurredAt).toISOString()}, ${e.role}): ${e.text}`)};
    });
  }
  async drain(): Promise<void> {
    if (!this.enabled()) return;
    const storage = this.adaptive.repository.storage;
    if (!storage.listAccounts) return;
    const page = await storage.listAccounts({after: this.cursor, limit: 20}); this.cursor = page.next;
    for (const accountId of page.accountIds) {
      const telegramId = ownerId({accountId} as ArchiveScope);
      const scopes = await this.adaptive.withAccountView(telegramId, d => (d.telegramArchives ?? []).filter(r => r.enabled && r.state?.pending.length).map(r => ({accountId, personId: d.personId, agentId: r.agentId, space: r.space, containerId: containerIdFor(accountId, r.space)})));
      for (const scope of scopes) await this.archive(scope).checkpoint(scope).catch(() => undefined);
    }
  }
}
