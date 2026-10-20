import { rightsUseStamp } from '../rights-use-holds/state';
import type { AdaptiveAuthorityDocument } from '../persistence/repository';
import { randomUUID } from 'crypto';
import { ADAPTIVE_POLICY_VERSION, digest, spaceIdFor, type AdaptiveDocument, type SpaceKind } from '../persistence/repository';
import { AdaptiveError, type AdaptiveService } from '../persistence/service';
import { clientObservationInputSchema, serverObservationInputSchema, OBSERVER_LEASE_MS, OBSERVER_MAX_ATTEMPTS,
  correctionObservationInputSchema, type CorrectionObservationInput, OBSERVER_MAX_EVENTS, OBSERVER_RETENTION_MS, OBSERVER_VERSION, type ClientObservationInput,
  type ObserverEvent, type ObserverSnapshot, type ServerObservationInput } from './contracts';
import { observerPolicyReceipt, projectObserverEvents, sweepObserverDocument, type ObserverAllowed } from './helpers';
export { observerPolicyReceipt, projectObserverEvents, sweepObserverDocument } from './helpers';

const PURPOSE = 'optional.product_analytics' as const;
export interface ObserverServiceOptions {
  /** Test/fault injection or bounded local consumer seam. Receives content-free data
   * only; it grants no provider, message, code or private-memory capability. */
  beforeConsume?: (event: Readonly<ObserverEvent>) => Promise<void>;
}
export class AdaptiveObserverService {
  constructor(readonly adaptive: AdaptiveService, private readonly options: ObserverServiceOptions = {}) {}
  private space(space: SpaceKind): void { if (space !== 'work' && space !== 'personal') throw new AdaptiveError(400, 'invalid_space'); }
  private allowed: ObserverAllowed = (d, space, agentId, now) => this.adaptive.isPurposeAllowed(d, space, PURPOSE, now, agentId);
  private clean(d: AdaptiveDocument, now: number): void { if (sweepObserverDocument(d, now, (doc,space,agentId,time)=>this.adaptive.isPurposeRetentionAllowed(doc,space,PURPOSE,time,agentId), this.adaptive.storeIdentity)) this.bump(d, now); }
  private bump(d: AdaptiveDocument, now: number): void { d.revision++; d.updatedAt = now; }
  private useReceipt(d:AdaptiveAuthorityDocument,space:SpaceKind,agentId?:string,identity=this.adaptive.storeIdentity):string {
    const retention=observerPolicyReceipt(d,space,agentId,identity);
    return d.schemaVersion===3?digest([retention,rightsUseStamp(d,space,PURPOSE)]):retention;
  }
  private eventCurrent(d:AdaptiveDocument,e:ObserverEvent,now:number):boolean {
    return this.allowed(d,e.space,e.agentId,now) && (d.schemaVersion!==3 || e.rightsUseStamp===rightsUseStamp(d,e.space,PURPOSE) && e.retentionStoreIdentity===this.adaptive.storeIdentity);
  }
  authorize(telegramId: number, space: SpaceKind, agentId: string): Promise<string | null> {
    this.space(space);
    if (this.adaptive.repository.storage.indexed) return this.adaptive.withRuntimeControls(telegramId, space, (d, now, storeIdentity) => {
      const allowed = this.allowed(d, space, agentId, now);
      const capability = this.adaptive.capabilityStatus(d, 'product_analytics', now);
      const permission = d.permissions.find(p => p.id === `permission:${space}:${PURPOSE}`)!;
      return { value: allowed ? this.useReceipt(d, space, agentId, storeIdentity) : null, denied: !allowed,
        ...(allowed ? { deadline: Math.min(d.binding!.expiresAt, permission.expiresAt, capability.validUntil ?? now) } : {}) };
    });
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now); return this.allowed(d, space, agentId, now) ? this.useReceipt(d, space, agentId) : null;
    });
  }
  authorizeCorrection(telegramId: number, space: SpaceKind): Promise<string | null> {
    this.space(space);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      return this.allowed(d, space, undefined, now) ? this.useReceipt(d, space) : null;
    });
  }
  recordCorrection(telegramId: number, value: CorrectionObservationInput): Promise<{ recorded: boolean; duplicate: boolean }> {
    const input = correctionObservationInputSchema.parse(value);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      if (!this.allowed(d, input.space, undefined, now) || input.policyReceipt !== this.useReceipt(d,input.space)) return { recorded: false, duplicate: false };
      const command = d.events.find(e => e.eventId === input.eventId);
      const accepted = command?.kind === 'memory_corrected' && d.memories.some(m => m.id === command.resultId && m.space === input.space);
      // Client saved is accepted only with the existing canonical command receipt.
      // An absent receipt remains unavailable, never proof that a save failed.
      if (input.outcome === 'correction_client_saved' && !accepted || command && !accepted) return { recorded: false, duplicate: false };
      const id = digest(['correction-observation-v1', d.accountId, input.space, input.eventId]), fingerprint = digest(input);
      const prior = d.observer.corrections?.find(e => e.id === id);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new AdaptiveError(409, 'observer_event_conflict');
        return { recorded: false, duplicate: true };
      }
      if (d.observer.events.length + (d.observer.corrections?.length ?? 0) >= OBSERVER_MAX_EVENTS || Buffer.byteLength(JSON.stringify(d)) > 500_000) throw new AdaptiveError(409, 'observer_capacity');
      (d.observer.corrections ??= []).push({ version: 1, id, fingerprint, space: input.space, policyReceipt: observerPolicyReceipt(d,input.space,undefined,this.adaptive.storeIdentity), ...(d.schemaVersion===3?{retentionStoreIdentity:this.adaptive.storeIdentity}:{}),
        trust: 'client_unverified', outcome: input.outcome, mutationEvidence: accepted ? 'accepted_command_receipt' : 'unavailable', occurredAt: now, expiresAt: now + OBSERVER_RETENTION_MS });
      this.clean(d, now); this.bump(d, now); return { recorded: true, duplicate: false };
    });
  }
  recordServer(telegramId: number, value: ServerObservationInput): Promise<{ recorded: boolean; duplicate: boolean; eventId?: string }> {
    const input = serverObservationInputSchema.parse(value);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      if (input.origin !== 'human' || !this.allowed(d, input.space, input.agentId, now) || input.policyReceipt !== this.useReceipt(d,input.space,input.agentId)) return { recorded: false, duplicate: false };
      return this.append(d, now, input, 'server', input.channel, observerPolicyReceipt(d,input.space,input.agentId,this.adaptive.storeIdentity));
    });
  }
  recordClient(telegramId: number, value: ClientObservationInput): Promise<{ recorded: boolean; duplicate: boolean; eventId?: string }> {
    const input = clientObservationInputSchema.parse(value);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      if (!this.allowed(d, input.space, input.agentId, now)) return { recorded: false, duplicate: false };
      const turnKey = digest([input.space, input.agentId, input.turnId]);
      const server = d.observer.events.find(e => this.eventCurrent(d,e,now) && e.trust === 'server' && e.turnKey === turnKey && e.operation !== 'prediction' && e.outcome === 'responded' && (input.outcome.startsWith('task_') || input.outcome === 'text_rendered' && e.channel === 'text' || input.outcome !== 'text_rendered' && e.channel === 'voice'));
      if (!server) return { recorded: false, duplicate: false };
      return this.append(d, now, input, 'client_unverified', server.channel, server.policyReceipt);
    });
  }
  private append(d: AdaptiveDocument, now: number, input: ReturnType<typeof serverObservationInputSchema.parse> | ReturnType<typeof clientObservationInputSchema.parse>, trust: ObserverEvent['trust'], channel: ObserverEvent['channel'], policyReceipt: string) {
    const id = digest([d.accountId, input.space, input.agentId, trust, input.eventId]);
    const fingerprint = digest(input);
    const prior = d.observer.events.find(e => e.id === id);
    if (prior) {
      if (prior.turnKey !== digest([input.space, input.agentId, input.turnId]) || prior.channel !== channel) throw new AdaptiveError(409, 'observer_event_conflict');
      if (prior.revision > input.revision) return { recorded: false, duplicate: true, eventId: id };
      if (prior.revision === input.revision) {
        if (prior.fingerprint !== fingerprint) throw new AdaptiveError(409, 'observer_event_conflict');
        return { recorded: false, duplicate: true, eventId: id };
      }
    }
    if ((!prior && d.observer.events.length + (d.observer.corrections?.length ?? 0) >= OBSERVER_MAX_EVENTS) || Buffer.byteLength(JSON.stringify(d)) > 500_000) throw new AdaptiveError(409, 'observer_capacity');
    const permission = d.permissions.find(p => p.id === `permission:${input.space}:${PURPOSE}`)!;
    const grant = d.agentGrants.find(g => g.space === input.space && g.agentId === input.agentId)!;
    const event: ObserverEvent = { origin: 'human', purpose: PURPOSE, policyVersion: ADAPTIVE_POLICY_VERSION,
      consentEpoch: permission.epoch, permissionRevision: permission.revision, grantRevision: grant.revision, bindingRevision: d.binding!.revision, schemaVersion: 1, version: OBSERVER_VERSION, id, fingerprint, revision: input.revision,
      turnKey: digest([input.space, input.agentId, input.turnId]), accountId: d.accountId, personId: d.personId,
      ...(d.schemaVersion===3?{rightsUseStamp:rightsUseStamp(d,input.space,PURPOSE),retentionStoreIdentity:this.adaptive.storeIdentity}:{}), space: input.space, spaceId: spaceIdFor(d.accountId, input.space), agentId: input.agentId, policyReceipt, trust, channel,
      outcome: input.outcome, ...(input.outcome === 'text_rendered' ? { clientExperienceVersion: 1 as const } : {}), ...('operation' in input && input.operation ? { operation: input.operation } : {}), ...('telemetry' in input && input.telemetry ? { telemetry: input.telemetry } : {}), ...('durationMs' in input && input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      occurredAt: prior?.occurredAt ?? now, receivedAt: now, expiresAt: prior?.expiresAt ?? now + OBSERVER_RETENTION_MS,
      state: 'pending', attempts: 0, nextAttemptAt: now };
    if (prior) d.observer.events[d.observer.events.indexOf(prior)] = event; else d.observer.events.push(event);
    this.clean(d, now); this.bump(d, now); return { recorded: true, duplicate: false, eventId: id };
  }
  /** Claim and commit are separate durable transactions. No result commits after
   * expiry, revocation, replacement, or lease loss. Retries retain no exception text. */
  async process(telegramId: number, options: { limit?: number; allowedAgentIds?: readonly string[] } = {}): Promise<{ processed: number; failed: number }> {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new AdaptiveError(400, 'invalid_observer_limit');
    const claimed = await this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      const events = d.observer.events.filter(e => this.eventCurrent(d,e,now) && e.state === 'pending' && e.nextAttemptAt <= now && (!options.allowedAgentIds || options.allowedAgentIds.includes(e.agentId))).sort((a, b) => a.receivedAt - b.receivedAt || a.id.localeCompare(b.id)).slice(0, limit);
      for (const e of events) { e.state = 'leased'; e.attempts++; e.leaseId = randomUUID(); e.leaseUntil = now + OBSERVER_LEASE_MS; }
      if (events.length) this.bump(d, now);
      return structuredClone(events);
    });
    let processed = 0, failed = 0;
    for (const event of claimed) {
      // Earlier callbacks may have awaited a withdrawal, replacement or lease
      // recovery. Do not dispatch the next copied payload on its old authority.
      const currentLease = await this.adaptive.withAccountDocument(telegramId, (d, now) => {
        this.clean(d, now);
        return d.observer.events.some(e => this.eventCurrent(d,e,now) && e.id === event.id && e.fingerprint === event.fingerprint &&
          e.state === 'leased' && e.leaseId === event.leaseId && e.leaseUntil! > now);
      });
      if (!currentLease) continue;
      let ok = true;
      try { await this.options.beforeConsume?.(Object.freeze(structuredClone(event))); } catch { ok = false; }
      const result = await this.adaptive.withAccountDocument(telegramId, (d, now) => {
        this.clean(d, now);
        const current = d.observer.events.find(e => this.eventCurrent(d,e,now) && e.id === event.id && e.fingerprint === event.fingerprint && e.state === 'leased' && e.leaseId === event.leaseId && e.leaseUntil! > now);
        if (!current) return 'stale';
        delete current.leaseId; delete current.leaseUntil;
        if (ok) { current.state = 'processed'; current.processedAt = now; delete current.failureCode; }
        else { current.state = current.attempts >= OBSERVER_MAX_ATTEMPTS ? 'failed' : 'pending'; current.failureCode = current.state === 'failed' ? 'retry_exhausted' : 'consumer_failed'; current.nextAttemptAt = now + 1000 * 2 ** (current.attempts - 1); }
        this.clean(d, now); this.bump(d, now); return ok ? 'processed' : 'failed';
      });
      if (result === 'processed') processed++; else if (result === 'failed') failed++;
    }
    return { processed, failed };
  }
  /** Explicit repair only after bounded exhaustion; no new IDs or permission bypass. */
  retryFailed(telegramId: number, space: SpaceKind): Promise<{ retried: number }> {
    this.space(space);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      const events = d.observer.events.filter(e => this.eventCurrent(d,e,now) && e.space === space && e.state === 'failed');
      for (const e of events) { e.state = 'pending'; e.attempts = 0; e.nextAttemptAt = now; delete e.failureCode; }
      if (events.length) this.bump(d, now); return { retried: events.length };
    });
  }
  snapshot(telegramId: number, space: SpaceKind, options: { allowedAgentIds?: readonly string[] } = {}): Promise<ObserverSnapshot> {
    this.space(space);
    return this.adaptive.withAccountDocument(telegramId, (d, now) => {
      this.clean(d, now);
      const available = this.adaptive.isPurposeAllowed(d, space, PURPOSE, now);
      const events = available ? d.observer.events.filter(e => e.space === space && (!options.allowedAgentIds || options.allowedAgentIds.includes(e.agentId))) : [];
      const projection = projectObserverEvents(events, space, available ? d.observer.corrections?.filter(e => e.space === space) : []);
      const pending = events.filter(e => e.state === 'pending'), leased = events.filter(e => e.state === 'leased');
      const failed = events.filter(e => e.state === 'failed').length;
      const times = events.filter(e => e.processedAt !== undefined).map(e => e.processedAt!);
      return { schemaVersion: 1, version: OBSERVER_VERSION, space, available, projection, findings: projection.findings,
        queue: { pending: pending.length, leased: leased.length, failed,
          oldestPendingAgeMs: pending.length + leased.length ? now - Math.min(...[...pending, ...leased].map(e => e.receivedAt)) : null,
          lastProcessedAt: times.length ? Math.max(...times) : null },
        completeness: { complete: false, acceptedEvents: events.length, processedEvents: projection.sourceEvents,
          pendingEvents: pending.length + leased.length, failedEvents: failed, samplingRate: 1, retentionMs: OBSERVER_RETENTION_MS,
          clientCorrectionReports: available ? d.observer.corrections?.filter(e => e.space === space).length ?? 0 : 0, coverage: 'instrumented_response_and_client_playback_only', clientExperienceCoverage: 'committed_text_and_explicit_correction_reports', telemetryCoverage: 'supported_server_stages_and_reported_usage', playbackEvidence: 'client_unverified',
          verifiedTaskSuccess: null, providerUsage: null, language: null, release: null } };
    });
  }
}
