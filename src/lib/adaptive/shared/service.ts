import { randomUUID } from 'crypto';
import { brandError, publicDomainError } from '../../error-contract';
import { z } from 'zod';
import { authorizeAccess } from '../policy';
import type { PolicySnapshot, ResourceDescriptor } from '../types';
import type { AdaptiveSnapshot } from '../persistence/contracts';
import { ADAPTIVE_POLICY_VERSION, accountIdFor } from '../persistence/repository';
import type { AdaptiveService } from '../persistence/service';
import { SharedMemoryRepository, sharedDigest, type SharedContainer, type SharedDocument, type SharedMember, type SharedMemory } from './repository';
import type { SharedAgentInput, SharedContainerView, SharedContext, SharedContextAudience, SharedCreateInput, SharedMemoryInput, SharedMutation, SharedParticipantInput, SharedPreview, SharedPreviewInput, SharedSnapshot, SharedSpace } from './contracts';

export class SharedMemoryError extends Error {
  readonly name = 'SharedMemoryError';
  constructor(readonly status: number, readonly code: string) { super(code); brandError(this, 'SharedMemoryError'); }
  static is(error: unknown): error is SharedMemoryError { return publicDomainError(error, 'SharedMemoryError'); }
}
const fail = (status: number, code: string): never => { throw new SharedMemoryError(status, code); };
const spaceSchema = z.enum(['work', 'personal']);
const idSchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9._:-]+$/);
const tgSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const mutationSchema = z.object({ space: spaceSchema, eventId: idSchema, expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) });
const previewSchema = z.object({ space: spaceSchema, kind: z.enum(['selected', 'group']), recipientTelegramIds: z.array(tgSchema).max(12), groupId: idSchema.optional() }).strict();
const createSchema = mutationSchema.extend({ previewToken: idSchema, agentIds: z.array(idSchema).max(10), text: z.string().trim().min(1).max(2000) }).strict();
const memorySchema = mutationSchema.extend({ text: z.string().trim().min(1).max(2000) }).strict();
const retention = 90 * 86400_000;
const INFINITY = Number.MAX_SAFE_INTEGER;
export interface SharedAuthority {
  /** Current approved Studio membership and agents this account may actually use. */
  member(telegramId: number): Promise<{ active: boolean; agentIds: string[] }>;
  group(groupId: string): Promise<{ memberTelegramIds: number[]; hasGuests: boolean; revision: string } | null>;
  agent(agentId: string): Promise<{ active: boolean }>;
}
interface Verified { telegramId: number; profile: AdaptiveSnapshot; agentIds: string[] }
interface StagedWrite { operationId: string; containerId: string; memoryId: string; revision: number; eventKey: string }
/** Explicit authored sharing only. No extraction, implicit grants, or automatic recipient expansion. */
export class SharedMemoryService {
  constructor(readonly repository: SharedMemoryRepository, readonly adaptive: AdaptiveService,
    readonly authority: SharedAuthority, private readonly now: () => number = Date.now) {}

  private async verified(telegramId: number, space: SharedSpace): Promise<Verified> {
    tgSchema.parse(telegramId); spaceSchema.parse(space);
    const member = await this.authority.member(telegramId);
    if (!member.active) return fail(403, 'recipient_unavailable');
    const profile = await this.adaptive.readAuthority(telegramId, space);
    if (!profile.identity.confirmed || !profile.identity.personId || !profile.identity.bindingId || !profile.identity.bindingRevision) return fail(403, 'profile_confirmation_required');
    if (!profile.explicitMemoryAvailable) return fail(403, 'capability_unavailable');
    if (!Number.isSafeInteger(profile.identity.bindingExpiresAt) || profile.identity.bindingExpiresAt! <= this.now()) return fail(403, 'profile_confirmation_required');
    return { telegramId, profile, agentIds: member.agentIds };
  }
  private identityKey(people: Verified[]): string {
    return sharedDigest(people.map(v => [v.telegramId, v.profile.identity.accountId, v.profile.identity.personId,
      v.profile.identity.bindingId, v.profile.identity.bindingRevision, v.profile.identity.bindingExpiresAt, v.profile.explicitMemoryAvailable, v.profile.explicitMemoryValidUntil, v.profile.purposes.filter(p => p.purpose === 'optional.personalization').map(p => [p.purpose, p.state, p.available, p.revision]), [...v.agentIds].sort()]));
  }
  private async recheck(people: Verified[], space: SharedSpace): Promise<void> {
    const current = await Promise.all(people.map(v => this.verified(v.telegramId, space)));
    if (this.identityKey(current) !== this.identityKey(people)) fail(409, 'authority_changed');
  }
  private bump(d: SharedDocument, c?: SharedContainer) {
    if (d.revision >= INFINITY || (c && c.revision >= INFINITY)) fail(409, 'revision_exhausted');
    d.revision++; if (c) { c.revision++; c.updatedAt = this.now(); }
  }
  private capacity(d: SharedDocument) {
    if (d.containers.length >= 100 || d.events.length >= 1200 || Buffer.byteLength(JSON.stringify(d)) > 450_000) fail(409, 'storage_capacity');
  }
  private event(d: SharedDocument, actor: Verified, eventId: string, fingerprint: string): string | undefined {
    const existing = d.events.find(e => e.id === sharedDigest([actor.profile.identity.personId, eventId]));
    if (!existing) return undefined;
    if (existing.fingerprint !== fingerprint) fail(409, 'event_conflict');
    if (existing.state === 'pending') fail(409, 'operation_pending');
    if (existing.state === 'aborted') fail(409, 'operation_aborted');
    return existing.resultId;
  }
  private record(d: SharedDocument, actor: Verified, eventId: string, fingerprint: string, resultId: string) {
    d.events.push({ id: sharedDigest([actor.profile.identity.personId, eventId]), fingerprint, resultId, revision: d.revision, state: 'committed' });
  }
  private row(d: SharedDocument, id: string, space: SharedSpace): SharedContainer {
    const row = d.containers.find(c => c.id === id && c.space === space && c.status === 'active');
    return row ?? fail(404, 'not_found');
  }
  private actorMember(c: SharedContainer, actor: Verified): SharedMember {
    const member = c.members.find(m => m.personId === actor.profile.identity.personId && m.telegramId === actor.telegramId && m.status === 'active');
    return member ?? fail(403, 'access_denied');
  }
  private async groupCurrent(c: SharedContainer): Promise<boolean> {
    if (c.kind !== 'group') return true;
    if (c.audienceInvalidatedAt !== undefined) return false;
    const group = c.groupId ? await this.authority.group(c.groupId) : null;
    const current = !!group && !group.hasGuests && group.revision === c.groupRevision &&
      sharedDigest([...group.memberTelegramIds].sort((a, b) => a - b)) === sharedDigest(c.members.map(m => m.telegramId).sort((a, b) => a - b));
    if (!current) await this.repository.transaction(d => {
      const row = d.containers.find(row => row.id === c.id && row.space === c.space);
      if (row && row.status === 'active' && row.audienceInvalidatedAt === undefined) {
        row.audienceInvalidatedAt = this.now(); this.bump(d, row);
      }
    });
    return current;
  }
  private async currentDocument(space: SharedSpace, telegramId: number): Promise<SharedDocument> {
    const initial = await this.repository.transaction(d => { this.pruneDocument(d); return d; });
    for (const c of initial.containers) if (c.space === space && c.status === 'active' && c.members.some(m => m.telegramId === telegramId && m.status === 'active')) await this.groupCurrent(c);
    return this.repository.transaction(d => { this.pruneDocument(d); return d; });
  }
  private async groupStamp(containers: SharedContainer[], extraGroupId?: string): Promise<string> {
    const ids = [...new Set([...containers.flatMap(c => c.groupId ? [c.groupId] : []), ...(extraGroupId ? [extraGroupId] : [])])].sort();
    const values = [];
    for (const id of ids) values.push([id, await this.authority.group(id)]);
    return sharedDigest(values);
  }
  private async agentsAvailable(ids: string[], people: Verified[]) {
    if (new Set(ids).size !== ids.length) fail(400, 'invalid_request');
    for (const id of ids) {
      if (!(await this.authority.agent(id)).active || people.some(p => !p.agentIds.includes(id))) fail(403, 'agent_access_denied');
    }
  }
  private allowed(c: SharedContainer, memory: SharedMemory, actor: Verified, audience: Verified[], operation: 'read' | 'contribute' | 'delete' | 'manage', agentId?: string): boolean {
    if (c.status !== 'active' || memory.status !== 'active') return false;
    const now = this.now();
    const tenantId = `shared:${sharedDigest(this.repository.namespace).slice(0, 20)}`, spaceId = `${tenantId}:${c.space}`;
    const scope = { tenantId, spaceId };
    const base = { schemaVersion: 1 as const, revision: c.revision, createdAt: c.createdAt, updatedAt: c.updatedAt };
    const actorId = actor.profile.identity.personId!;
    const resource: ResourceDescriptor = { ...base, ...scope, id: memory.id, revision: memory.revision, containerId: c.id,
      createdAt: memory.createdAt, updatedAt: memory.updatedAt, subjectPersonIds: [memory.authorPersonId], status: memory.status,
      expiresAt: memory.expiresAt, revocationEpoch: c.revision };
    const snapshot: PolicySnapshot = { schemaVersion: 1, policyVersion: ADAPTIVE_POLICY_VERSION,
      account: { ...base, id: actor.profile.identity.accountId, ownerPersonId: actorId, status: 'active' },
      people: c.members.map(m => ({ ...base, id: m.personId, status: m.status === 'active' ? 'active' as const : 'suspended' as const })),
      binding: { schemaVersion: 1, id: actor.profile.identity.bindingId!, revision: actor.profile.identity.bindingRevision!,
        createdAt: actor.profile.identity.bindingCreatedAt!, updatedAt: actor.profile.identity.bindingUpdatedAt!, accountId: actor.profile.identity.accountId,
        personId: actorId, status: 'verified', method: 'account_confirmation', verifiedAt: actor.profile.identity.bindingVerifiedAt!, expiresAt: actor.profile.identity.bindingExpiresAt! },
      space: { ...base, ...scope, id: spaceId, kind: c.space, ownerAccountId: accountIdFor(c.members.find(m => m.personId === c.ownerPersonId)!.telegramId), status: 'active', policyEpoch: 0 },
      container: { ...base, ...scope, id: c.id, audience: c.kind === 'group' ? { kind: 'group', groupId: c.groupId! } : { kind: 'exact_recipients', personIds: c.members.map(m => m.personId) },
        status: c.status, policyEpoch: 0, spacePolicyEpoch: 0, historyPolicy: 'all_authorized_history' }, resource,
      memberships: c.members.map(m => ({ ...base, ...scope, id: `${c.id}:member:${m.personId}`, containerId: c.id, personId: m.personId,
        ...(c.kind === 'group' ? { groupId: c.groupId } : {}), status: m.status, joinedAt: c.createdAt, expiresAt: INFINITY, policyEpoch: 0 })),
      grants: [ ...c.members.map(m => ({ ...base, ...scope, id: `${c.id}:person:${m.personId}`, containerId: c.id,
        principal: { kind: 'person' as const, id: m.personId }, operations: ['read' as const, 'contribute' as const,
          ...(m.personId === c.ownerPersonId ? ['manage' as const, 'delete' as const] : m.personId === memory.authorPersonId ? ['delete' as const] : [])],
        purpose: 'explicit.memory_request' as const, purposeVersion: 1, status: m.status, expiresAt: INFINITY, policyEpoch: 0 })),
        ...c.agents.map(g => ({ ...base, ...scope, id: `${c.id}:agent:${g.agentId}`, revision: g.revision, containerId: c.id,
          principal: { kind: 'agent' as const, id: g.agentId }, operations: ['read' as const], purpose: 'explicit.memory_request' as const,
          purposeVersion: 1, status: g.allowed ? 'active' as const : 'revoked' as const, expiresAt: INFINITY, policyEpoch: 0 })) ], consents: [],
    };
    if (audience.some(a => !memory.recipientPersonIds.includes(a.profile.identity.personId!))) return false;
    return authorizeAccess({ identity: { authenticatedAccountId: actor.profile.identity.accountId, selectedPerson: { personId: actorId,
      bindingId: actor.profile.identity.bindingId!, bindingRevision: actor.profile.identity.bindingRevision! } }, ...scope, containerId: c.id,
      resourceId: memory.id, operation, purpose: 'explicit.memory_request', purposeVersion: 1, consentPolicyVersion: ADAPTIVE_POLICY_VERSION,
      audience: { kind: 'known', personIds: audience.map(a => a.profile.identity.personId!) }, ...(agentId ? { agentId } : {}) }, snapshot, now).allowed;
  }
  private validUntil(people: Verified[]): number {
    return Math.min(...people.flatMap(p => [p.profile.identity.bindingExpiresAt ?? 0, p.profile.explicitMemoryValidUntil ?? 0]));
  }
  private assertFresh(people: Verified[]): void {
    if (this.validUntil(people) <= this.now()) fail(403, 'authority_expired');
  }
  pruneDocument(d: SharedDocument): void {
    for (const c of d.containers) for (const m of c.memories) if (
      (m.status === 'pending' && (!m.publication || m.publication.validUntil <= this.now())) ||
      (m.status === 'active' && m.expiresAt <= this.now())) {
      const wasPending = m.status === 'pending';
      m.status = 'deleted'; delete m.text; m.revision++; m.updatedAt = this.now(); m.tombstoneEventId = `expiry:${m.id}`;
      if (wasPending) {
        const event = d.events.find(e => e.operationId === m.publication?.operationId && e.state === 'pending');
        if (event) event.state = 'aborted';
        if (c.status === 'pending') c.status = 'deleted';
      }
      this.bump(d, c);
    }
  }
  private abortPublication(d: SharedDocument, memory: SharedMemory): void {
    if (memory.status !== 'pending') return;
    const event = d.events.find(e => e.operationId === memory.publication?.operationId && e.state === 'pending');
    if (event) event.state = 'aborted';
  }
  private async abortStaged(write: StagedWrite, reason: string): Promise<void> {
    await this.repository.transaction(d => {
      const c = d.containers.find(c => c.id === write.containerId);
      const m = c?.memories.find(m => m.id === write.memoryId && m.publication?.operationId === write.operationId);
      const event = d.events.find(e => e.id === write.eventKey && e.operationId === write.operationId);
      if (event?.state === 'committed' || !m || m.status !== 'pending' || !c) return;
      m.status = 'deleted'; delete m.text; m.revision++; m.updatedAt = this.now(); m.tombstoneEventId = `aborted:${reason}`;
      if (c.status === 'pending') c.status = 'deleted';
      if (event) event.state = 'aborted';
      this.bump(d, c);
    });
  }
  private async stage<T>(identity: StagedWrite, mutate: (d: SharedDocument) => T): Promise<T> {
    try { return await this.repository.transaction(mutate); }
    catch (error) {
      // Also handles an uncertain adapter response after its staging commit.
      // The operation id prevents cancelling a different in-flight retry.
      await this.abortStaged(identity, 'stage_failed');
      throw error;
    }
  }
  private contentDigest(memory: SharedMemory): string {
    return sharedDigest([memory.text, memory.authorPersonId, memory.createdAt, memory.expiresAt, memory.recipientPersonIds]);
  }
  private audienceKey(c: SharedContainer): string {
    return sharedDigest([c.space, c.kind, c.groupId, c.groupRevision, c.ownerPersonId, c.members, c.agents]);
  }
  private async publishStaged(write: StagedWrite, actor: Verified, people: Verified[], agentIds: string[], source: SharedContainer): Promise<void> {
    // Staged text is invisible even to otherwise-authorized concurrent readers.
    // Any failed authority check erases the staged bytes and leaves an event tombstone.
    try {
      await this.recheck(people, source.space);
      await this.agentsAvailable(agentIds, people);
      if (!(await this.groupCurrent(source))) fail(409, 'audience_changed');
      this.assertFresh(people);
      await this.repository.transaction(d => {
        this.pruneDocument(d);
        this.assertFresh(people); // Real expiry checked inside the actual commit callback.
        const c = d.containers.find(c => c.id === write.containerId && c.space === source.space);
        const m = c?.memories.find(m => m.id === write.memoryId && m.status === 'pending');
        const event = d.events.find(e => e.id === write.eventKey && e.operationId === write.operationId);
        if (!c || !m || !m.publication || !event) return fail(409, 'publication_stale');
        if (c.revision !== write.revision || event.state !== 'pending' ||
            m.publication.operationId !== write.operationId || m.publication.authorityKey !== this.identityKey(people) ||
            m.publication.validUntil <= this.now() || m.publication.intentFingerprint !== event.fingerprint ||
            m.publication.contentDigest !== this.contentDigest(m) || m.publication.audienceKey !== this.audienceKey(c) || c.audienceInvalidatedAt !== undefined) fail(409, 'publication_stale');
        if (!this.allowed({ ...c, status: 'active' }, { ...m, status: 'active' }, actor, people, 'contribute')) fail(403, 'access_denied');
        m.status = 'active'; m.revision++; m.updatedAt = this.now(); m.publication.finalizedAt = this.now();
        if (c.status === 'pending') c.status = 'active';
        event!.state = 'committed'; this.bump(d, c);
      });
    } catch (error) {
      await this.abortStaged(write, error instanceof SharedMemoryError ? error.code : 'authority_unavailable');
      throw error;
    }
  }
  private memory(actor: Verified, c: SharedContainer, text: string, id: string): SharedMemory {
    return { id, revision: 1, text, authorPersonId: actor.profile.identity.personId!, status: 'active', createdAt: this.now(), updatedAt: this.now(), expiresAt: this.now() + retention,
      recipientPersonIds: c.members.filter(m => m.status === 'active').map(m => m.personId) };
  }
  async preview(telegramId: number, raw: SharedPreviewInput): Promise<SharedPreview> {
    const input = previewSchema.parse(raw), actor = await this.verified(telegramId, input.space);
    if (new Set(input.recipientTelegramIds).size !== input.recipientTelegramIds.length) fail(400, 'invalid_request');
    if ((input.kind === 'selected' && input.groupId) || (input.kind === 'group' && !input.groupId)) fail(400, 'invalid_request');
    const group = input.kind === 'group' ? await this.authority.group(input.groupId!) : null;
    if (input.kind === 'group' && (!group || !group.memberTelegramIds.includes(telegramId) || group.hasGuests)) return fail(403, 'audience_changed');
    const requested = input.kind === 'group' && input.recipientTelegramIds.length === 0 ? group!.memberTelegramIds : input.recipientTelegramIds;
    const ids = [...new Set([telegramId, ...requested])].sort((a, b) => a - b);
    if (ids.length < 2 || ids.length > 12) fail(400, 'invalid_request');
    if (input.kind === 'group' && (!group || group.hasGuests || sharedDigest([...group.memberTelegramIds].sort((a, b) => a - b)) !== sharedDigest(ids))) fail(403, 'audience_changed');
    const people = await Promise.all(ids.map(id => id === telegramId ? actor : this.verified(id, input.space)));
    const token = randomUUID(), expiresAt = this.now() + 5 * 60_000;
    const authorityRevision = sharedDigest([this.identityKey(people), group?.revision]);
    await this.repository.transaction(d => {
      this.capacity(d); d.previews = d.previews.filter(p => p.expiresAt > this.now() && !p.consumedBy).slice(-79);
      d.previews.push({ token, ownerPersonId: actor.profile.identity.personId!, space: input.space, kind: input.kind,
        ...(input.groupId ? { groupId: input.groupId, groupRevision: group!.revision } : {}),
        members: people.map(p => ({ telegramId: p.telegramId, personId: p.profile.identity.personId!, bindingRevision: p.profile.identity.bindingRevision!, status: 'active' })), authorityRevision, expiresAt });
      this.bump(d);
    });
    await this.recheck(people, input.space);
    return { previewToken: token, expiresAt, authorityRevision, recipients: people.map(p => ({ telegramId: p.telegramId, personId: p.profile.identity.personId! })) };
  }
  async create(telegramId: number, raw: SharedCreateInput): Promise<SharedSnapshot> {
    const input = createSchema.parse(raw), actor = await this.verified(telegramId, input.space);
    const retryFingerprint = sharedDigest(['create', input]);
    if (await this.repository.transaction(d => this.event(d, actor, input.eventId, retryFingerprint))) return this.list(telegramId, input.space);
    const preview = await this.repository.transaction(d => d.previews.find(p => p.token === input.previewToken && p.ownerPersonId === actor.profile.identity.personId && p.space === input.space));
    if (!preview || preview.expiresAt <= this.now()) return fail(409, 'preview_required');
    const people = await Promise.all(preview.members.map(m => m.telegramId === telegramId ? actor : this.verified(m.telegramId, input.space)));
    await this.agentsAvailable(input.agentIds, people);
    const group = preview.groupId ? await this.authority.group(preview.groupId) : null;
    if (preview.kind === 'group' && (!group || group.hasGuests || group.revision !== preview.groupRevision ||
        sharedDigest([...group.memberTelegramIds].sort((a, b) => a - b)) !== sharedDigest(preview.members.map(m => m.telegramId).sort((a, b) => a - b)))) return fail(409, 'audience_changed');
    if (sharedDigest([this.identityKey(people), group?.revision]) !== preview.authorityRevision) return fail(409, 'preview_stale');
    const fingerprint = sharedDigest(['create', input]), containerId = randomUUID(), memoryId = randomUUID(), operationId = randomUUID();
    const staged = await this.stage({ operationId, containerId, memoryId, revision: 0, eventKey: sharedDigest([actor.profile.identity.personId, input.eventId]) }, d => {
      this.pruneDocument(d);
      if (this.event(d, actor, input.eventId, fingerprint)) return null;
      this.assertFresh(people);
      this.capacity(d); if (input.expectedRevision !== 0) fail(409, 'revision_conflict');
      const receipt = d.previews.find(p => p.token === preview.token);
      if (!receipt || receipt.expiresAt <= this.now() || receipt.consumedBy) fail(409, 'preview_required');
      const c: SharedContainer = { id: containerId, space: input.space, kind: preview.kind,
        ...(preview.groupId ? { groupId: preview.groupId, groupRevision: preview.groupRevision } : {}),
        ownerPersonId: actor.profile.identity.personId!, revision: 1, createdAt: this.now(), updatedAt: this.now(), status: 'pending',
        members: preview.members, agents: input.agentIds.map(agentId => ({ agentId, allowed: true, revision: 1 })), memories: [] };
      const memory = this.memory(actor, c, input.text, memoryId);
      if (!this.allowed({ ...c, status: 'active' }, memory, actor, people, 'contribute')) fail(403, 'access_denied');
      memory.status = 'pending'; memory.publication = { operationId, authorityKey: this.identityKey(people), intentFingerprint: fingerprint, contentDigest: this.contentDigest(memory), audienceKey: this.audienceKey(c),
        stagedAt: this.now(), validUntil: Math.min(this.validUntil(people), receipt!.expiresAt, this.now() + 30_000) };
      c.memories.push(memory); d.containers.push(c); receipt!.consumedBy = c.id; this.bump(d);
      this.record(d, actor, input.eventId, fingerprint, c.id);
      const event = d.events.at(-1)!; event.state = 'pending'; event.operationId = operationId;
      return { write: { operationId, containerId, memoryId, revision: c.revision, eventKey: event.id }, source: c };
    });
    if (staged) await this.publishStaged(staged.write, actor, people, input.agentIds, staged.source);
    return this.list(telegramId, input.space);
  }
  async list(telegramId: number, space: SharedSpace): Promise<SharedSnapshot> {
    return this.listCurrent(telegramId, space);
  }
  /** Trusted export delivery seam. Run the private account check before the
   * final shared identity/group/revision checks, and reject a changed projection.
   * External group revisions do not necessarily mutate this repository. */
  async revalidateExport(telegramId: number, space: SharedSpace, expected: SharedSnapshot,
    checkPrivateAccount: () => Promise<void>): Promise<void> {
    const latest = await this.listCurrent(telegramId, space, checkPrivateAccount);
    if (sharedDigest(latest) !== sharedDigest(expected)) fail(409, 'export_authority_changed');
  }
  private async listCurrent(telegramId: number, space: SharedSpace, beforeDelivery?: () => Promise<void>): Promise<SharedSnapshot> {
    const actor = await this.verified(telegramId, space);
    const state = await this.currentDocument(space, telegramId);
    const groupStamp = await this.groupStamp(state.containers.filter(c => c.space === space && c.members.some(m => m.telegramId === telegramId)));
    const containers: SharedContainerView[] = [];
    for (const c of state.containers) {
      if (c.space !== space || c.status !== 'active' || !c.members.some(m => m.personId === actor.profile.identity.personId && m.telegramId === telegramId && m.status === 'active')) continue;
      const current = await this.groupCurrent(c);
      containers.push({ id: c.id, space, kind: c.kind, ...(c.groupId ? { groupId: c.groupId } : {}), revision: c.revision, ownerPersonId: c.ownerPersonId,
        recipients: c.members.map(m => ({ telegramId: m.telegramId, personId: m.personId, active: m.status === 'active' })), agents: c.agents,
        status: current ? 'active' : 'audience_changed', memories: current ? c.memories.filter(m => this.allowed(c, m, actor, [actor], 'read'))
          .map(m => ({ id: m.id, revision: m.revision, text: m.text!, authorPersonId: m.authorPersonId, createdAt: m.createdAt, expiresAt: m.expiresAt })) : [] });
    }
    await beforeDelivery?.();
    await this.recheck([actor], space);
    if (groupStamp !== await this.groupStamp(state.containers.filter(c => c.space === space && c.members.some(m => m.telegramId === telegramId)))) return fail(409, 'audience_changed');
    const latestRevision = await this.repository.transaction(d => { this.pruneDocument(d); return d.revision; });
    if (latestRevision !== state.revision) return fail(409, 'revision_conflict');
    return { revision: state.revision, space, containers };
  }
  async addMemory(telegramId: number, id: string, raw: SharedMemoryInput): Promise<SharedSnapshot> {
    idSchema.parse(id); const input = memorySchema.parse(raw), actor = await this.verified(telegramId, input.space);
    const initial = await this.repository.transaction(d => this.row(d, id, input.space)); this.actorMember(initial, actor);
    if (!(await this.groupCurrent(initial))) return fail(409, 'audience_changed');
    const people = await Promise.all(initial.members.filter(m => m.status === 'active').map(m => m.telegramId === telegramId ? actor : this.verified(m.telegramId, input.space)));
    const fingerprint = sharedDigest(['add', id, input]), memoryId = randomUUID(), operationId = randomUUID();
    const staged = await this.stage({ operationId, containerId: id, memoryId, revision: 0, eventKey: sharedDigest([actor.profile.identity.personId, input.eventId]) }, d => {
      this.pruneDocument(d); if (this.event(d, actor, input.eventId, fingerprint)) return null;
      this.assertFresh(people);
      this.capacity(d); const c = this.row(d, id, input.space); this.actorMember(c, actor);
      if (c.revision !== input.expectedRevision || c.revision !== initial.revision) fail(409, 'revision_conflict');
      const memory = this.memory(actor, c, input.text, memoryId);
      if (c.memories.length >= 200) fail(409, 'storage_capacity');
      if (!this.allowed(c, memory, actor, people, 'contribute')) fail(403, 'access_denied');
      memory.status = 'pending'; memory.publication = { operationId, authorityKey: this.identityKey(people), intentFingerprint: fingerprint, contentDigest: this.contentDigest(memory), audienceKey: this.audienceKey(c),
        stagedAt: this.now(), validUntil: Math.min(this.validUntil(people), this.now() + 30_000) };
      c.memories.push(memory); this.bump(d, c); this.record(d, actor, input.eventId, fingerprint, memory.id);
      const event = d.events.at(-1)!; event.state = 'pending'; event.operationId = operationId;
      return { operationId, containerId: c.id, memoryId, revision: c.revision, eventKey: event.id };
    });
    if (staged) await this.publishStaged(staged, actor, people, [], initial);
    return this.list(telegramId, input.space);
  }

  async deleteMemory(telegramId: number, id: string, memoryId: string, raw: SharedMutation): Promise<SharedSnapshot> {
    idSchema.parse(id); idSchema.parse(memoryId); const input = mutationSchema.strict().parse(raw), actor = await this.verified(telegramId, input.space);
    const fingerprint = sharedDigest(['delete', id, memoryId, input]);
    await this.repository.transaction(d => {
      if (this.event(d, actor, input.eventId, fingerprint)) return;
      this.assertFresh([actor]);
      const c = this.row(d, id, input.space); this.actorMember(c, actor);
      if (c.revision !== input.expectedRevision) fail(409, 'revision_conflict');
      const m = c.memories.find(m => m.id === memoryId && m.status === 'active');
      if (!m) fail(404, 'not_found');
      if (!this.allowed(c, m!, actor, [actor], 'delete')) fail(403, 'access_denied');
      m!.status = 'deleted'; delete m!.text; m!.revision++; m!.updatedAt = this.now(); m!.tombstoneEventId = input.eventId;
      this.bump(d, c); this.record(d, actor, input.eventId, fingerprint, memoryId);
    });
    return this.list(telegramId, input.space);
  }
  async revokeParticipant(telegramId: number, id: string, recipientId: number, raw: SharedParticipantInput): Promise<SharedSnapshot> {
    idSchema.parse(id); tgSchema.parse(recipientId); const input = mutationSchema.extend({ revoked: z.literal(true) }).strict().parse(raw), actor = await this.verified(telegramId, input.space);
    const fingerprint = sharedDigest(['revoke', id, recipientId, input]);
    await this.repository.transaction(d => {
      if (this.event(d, actor, input.eventId, fingerprint)) return;
      this.assertFresh([actor]);
      const c = this.row(d, id, input.space); this.actorMember(c, actor);
      if (c.revision !== input.expectedRevision) fail(409, 'revision_conflict');
      const target = c.members.find(m => m.telegramId === recipientId && m.status === 'active');
      if (!target || (c.ownerPersonId !== actor.profile.identity.personId && target.personId !== actor.profile.identity.personId)) fail(403, 'access_denied');
      target!.status = 'revoked';
      for (const m of c.memories) if (m.authorPersonId === target!.personId) {
        this.abortPublication(d, m);
        m.status = 'deleted'; delete m.text; m.revision++; m.updatedAt = this.now(); m.tombstoneEventId = input.eventId;
      }
      if (target!.personId === c.ownerPersonId) { c.status = 'deleted'; for (const m of c.memories) { this.abortPublication(d, m); m.status = 'deleted'; delete m.text; m.revision++; m.updatedAt = this.now(); m.tombstoneEventId = input.eventId; } }
      this.bump(d, c); this.record(d, actor, input.eventId, fingerprint, c.id);
    });
    return this.list(telegramId, input.space);
  }
  async setAgentAccess(telegramId: number, id: string, agentId: string, raw: SharedAgentInput): Promise<SharedSnapshot> {
    idSchema.parse(id); idSchema.parse(agentId); const input = mutationSchema.extend({ allowed: z.boolean() }).strict().parse(raw), actor = await this.verified(telegramId, input.space);
    const initial = await this.repository.transaction(d => this.row(d, id, input.space)); this.actorMember(initial, actor);
    if (initial.ownerPersonId !== actor.profile.identity.personId) return fail(403, 'access_denied');
    let grantPeople = [actor];
    if (input.allowed) {
      if (!(await this.groupCurrent(initial))) return fail(409, 'audience_changed');
      grantPeople = await Promise.all(initial.members.filter(m => m.status === 'active').map(m => this.verified(m.telegramId, input.space)));
      await this.agentsAvailable([agentId], grantPeople);
      await this.recheck(grantPeople, input.space);
    }
    const fingerprint = sharedDigest(['agent', id, agentId, input]);
    await this.repository.transaction(d => {
      if (this.event(d, actor, input.eventId, fingerprint)) return;
      this.assertFresh(grantPeople);
      const c = this.row(d, id, input.space); this.actorMember(c, actor);
      if (c.ownerPersonId !== actor.profile.identity.personId) fail(403, 'access_denied');
      if (c.revision !== input.expectedRevision || c.revision !== initial.revision) fail(409, 'revision_conflict');
      const grant = c.agents.find(g => g.agentId === agentId);
      if (grant) { grant.allowed = input.allowed; grant.revision++; }
      else { if (c.agents.length >= 10) fail(409, 'storage_capacity'); c.agents.push({ agentId, allowed: input.allowed, revision: 1 }); }
      this.bump(d, c); this.record(d, actor, input.eventId, fingerprint, c.id);
    });
    return this.list(telegramId, input.space);
  }
  async readContext(telegramId: number, space: SharedSpace, agentId: string, audience: SharedContextAudience): Promise<SharedContext> {
    idSchema.parse(agentId); const actor = await this.verified(telegramId, space);
    const ids = z.array(tgSchema).min(1).max(12).parse(audience.audienceTelegramIds);
    if (new Set(ids).size !== ids.length || !ids.includes(telegramId)) return fail(403, 'audience_denied');
    const people = await Promise.all(ids.map(id => id === telegramId ? actor : this.verified(id, space)));
    if (ids.length > 1) {
      const group = audience.groupId ? await this.authority.group(audience.groupId) : null;
      if (!group || group.hasGuests || sharedDigest([...group.memberTelegramIds].sort((a,b) => a-b)) !== sharedDigest([...ids].sort((a,b) => a-b))) return fail(403, 'audience_denied');
    }
    await this.agentsAvailable([agentId], people);
    // Sharing does not grant any participant's optional personalization consent.
    const personalized = people.every(p => p.profile.purposes.some(choice => choice.purpose === 'optional.personalization' && choice.state === 'granted' && choice.available));
    const state = await this.currentDocument(space, telegramId);
    const relevant = state.containers.filter(c => c.space === space && c.members.some(m => m.telegramId === telegramId));
    const groupStamp = await this.groupStamp(relevant, audience.groupId);
    const agentStamp = await this.authority.agent(agentId);
    const memories: SharedContext['memories'] = [];
    if (personalized) for (const c of state.containers) {
      if (c.space !== space || c.status !== 'active' || !(await this.groupCurrent(c))) continue;
      for (const m of c.memories) if (this.allowed(c, m, actor, people, 'read', agentId)) memories.push({ id: m.id, text: m.text!, containerId: c.id });
    }
    await this.recheck(people, space);
    if (groupStamp !== await this.groupStamp(relevant, audience.groupId) || sharedDigest(agentStamp) !== sharedDigest(await this.authority.agent(agentId))) return fail(409, 'authority_changed');
    const currentRevision = await this.repository.transaction(d => d.revision);
    if (currentRevision !== state.revision) return fail(409, 'revision_conflict');
    return { revision: sharedDigest([state.revision, space, agentId, this.identityKey(people), audience, personalized, groupStamp, agentStamp]), memories };
  }
}
