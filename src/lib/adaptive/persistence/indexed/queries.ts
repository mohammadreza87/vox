import { mayUseStoredPersonalization } from '../../product-pause/state';
import { z } from 'zod';
import { types as utilTypes } from 'util';
import { digest, OPTIONAL_PURPOSES, tenantIdFor, spaceIdFor, containerIdFor } from '../repository';
import { resolveVerifiedPerson } from '../../identity';
import { accountKey, lexicalTerms, memoryMetadataSchema, parseControls, validateAccountId, type MemoryMetadata } from './projection';
import { INDEXED_LIMITS, IndexedStorageError, emptyIndexedIo, type AuthorityResult, type BodyResult, type CandidateCursor,
  type CandidateHandle, type CandidateResult, type IndexedAdaptiveQueries, type IndexedControls, type IndexedControlEvaluator, type ControlsResult, type IndexedFailure,
  type IndexedIoCounters, type IndexedScope, type IndexedStoreMetadata, type RuntimeAuthorityReceipt, type ValidationResult } from './contracts';
import type { SqliteAdaptiveStorage } from './sqlite-storage';
const id = z.string().min(1).max(200);
const scopeSchema = z.object({ accountId: id, personId: id, tenantId: id, space: z.enum(['work', 'personal']),
  spaceId: id, containerId: id, agentId: id, purpose: z.enum(['core_text', ...OPTIONAL_PURPOSES]) }).strict();
/** Controls contain only validated JSON trees. Freeze before exposing references
 * to trusted evaluation code, including every nested array, key and enum row. */
function freezeControlTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeControlTree(child);
  }
  return value;
}
interface Catalog { version: number; digest: string }
interface Authority { controls: IndexedControls; catalog: Catalog; deadline: number }
const fail = (reason: IndexedFailure['reason'], io: IndexedIoCounters): IndexedFailure => ({ status: 'unavailable', reason, io });
/** SQL projections provide canonical facts, never current code-owned release
 * policy or Studio identity/agent authority. Callers must check both externally. */
export class IndexedQueryEngine implements IndexedAdaptiveQueries {
  readonly identity: IndexedAdaptiveQueries['identity'];
  constructor(private readonly host: SqliteAdaptiveStorage) { this.identity = host.identity; }
  private scope(scope: IndexedScope): void {
    if (!scopeSchema.safeParse(scope).success || scope.tenantId !== tenantIdFor(scope.accountId) ||
        scope.spaceId !== spaceIdFor(scope.accountId, scope.space) || scope.containerId !== containerIdFor(scope.accountId, scope.space)) throw new IndexedStorageError('invalid_scope');
  }
  private fetchControls(accountId: string, io: IndexedIoCounters): IndexedControls | undefined {
    validateAccountId(accountId);
    const row = this.host.database.prepare('SELECT json,digest FROM controls WHERE account_key=?').get(accountKey(accountId)) as { json: string; digest: string } | undefined;
    if (!row) return;
    this.host.count(io, 'controlRowsRead');
    const c = parseControls(JSON.parse(row.json), accountId);
    if (c.schemaVersion !== this.host.canonicalSchemaVersion) throw new IndexedStorageError('invalid_controls');
    if (digest(c) !== row.digest) throw new IndexedStorageError('invalid_controls');
    return c;
  }
  private controls(scope: IndexedScope, now: number, io: IndexedIoCounters): Authority | IndexedFailure {
    this.scope(scope);
    const c = this.fetchControls(scope.accountId, io); if (!c) return fail('missing', io);
    if (c.updatedAt > now || c.createdAt > now) return fail('clock_regression', io);
    if (scope.personId !== c.personId) throw new IndexedStorageError('invalid_scope');
    const binding = c.binding;
    const confirmed = binding && resolveVerifiedPerson({ authenticatedAccountId: scope.accountId,
      selectedPerson: { personId: scope.personId, bindingId: binding.id, bindingRevision: binding.revision } },
    { schemaVersion: 1, id: c.accountId, revision: 1, createdAt: c.createdAt, updatedAt: c.createdAt,
      ownerPersonId: c.personId, status: 'active' }, binding, now);
    if (!confirmed) return fail(binding && binding.expiresAt <= now ? 'expired' : 'denied', io);
    const deadlines = [binding!.expiresAt];
    if (['optional.personalization', 'optional.auto_memory', 'optional.proactive_suggestions', 'optional.relationship_outreach'].includes(scope.purpose) &&
        !mayUseStoredPersonalization(c, scope.space)) return fail('denied', io);
    if (scope.purpose !== 'core_text') {
      const permission = c.permissions.find(p => p.spaceId === scope.spaceId && p.purpose === scope.purpose)!;
      if (permission.state !== 'granted' || permission.effectiveAt > now || permission.updatedAt > now || permission.expiresAt <= now)
        return fail(permission.expiresAt <= now ? 'expired' : 'denied', io);
      if (!c.agentGrants.some(g => g.space === scope.space && g.agentId === scope.agentId && g.allowed && g.updatedAt <= now)) return fail('denied', io);
      deadlines.push(permission.expiresAt);
    }
    // Future compact-control boundaries fence learning/prediction/relationship
    // guards as well as ordinary memory reads; none authorizes a feature.
    const addDeadline = (time: number | undefined) => { if (time !== undefined && time > now) deadlines.push(time); };
    for (const turn of c.predictionTurns.filter(t => t.space === scope.space && t.agentId === scope.agentId)) {
      addDeadline(turn.expiresAt); addDeadline(turn.receiptExpiresAt); addDeadline(turn.inFlightUntil);
    }
    if (c.preferenceLearning) for (const rows of [c.preferenceLearning.presentations, c.preferenceLearning.intents,
      c.preferenceLearning.candidates, c.preferenceLearning.suppressions]) for (const row of rows)
      if (row.space === scope.space && row.agentId === scope.agentId) addDeadline(row.expiresAt);
    for (const row of c.relationshipBindings) if (row.space === scope.space) addDeadline(row.expiresAt);
    for (const row of c.relationshipSources) if (row.key.scope.space === scope.space && row.key.personaId === scope.agentId) addDeadline(row.expiresAt);
    for (const row of c.relationshipControls) if (row.space === scope.space && row.agentId === scope.agentId) addDeadline(row.pausedUntil);
    const catalog = this.host.database.prepare('SELECT version,digest FROM catalogs WHERE account_key=? AND space=?').get(accountKey(scope.accountId), scope.space) as Catalog | undefined;
    if (!catalog || !Number.isSafeInteger(catalog.version) || catalog.version < 1 || !/^[a-f0-9]{64}$/.test(catalog.digest)) throw new IndexedStorageError('corrupt');
    this.host.count(io, 'controlRowsRead');
    // The indexed minimum includes unselected sources; any expiry invalidates an
    // outstanding receipt without loading metadata/body corpora. Expired rows
    // need no foreground pruning and cannot revive after clock regression.
    const next = this.host.database.prepare("SELECT expires_at FROM memory_meta INDEXED BY memory_expiry WHERE account_key=? AND space=? AND status='active' AND expires_at>? ORDER BY expires_at LIMIT 1").get(accountKey(scope.accountId), scope.space, now) as { expires_at: number } | undefined;
    if (next) { this.host.count(io, 'metadataRowsRead'); deadlines.push(next.expires_at); }
    return { controls: c, catalog, deadline: Math.min(...deadlines) };
  }
  private stamp(meta: IndexedStoreMetadata, scope: IndexedScope, a: Authority) {
    return { version: 1 as const, incarnation: meta.incarnation, generation: meta.generation,
      catalogVersion: a.catalog.version, catalogDigest: a.catalog.digest, scope: structuredClone(scope), deadline: a.deadline };
  }
  private signed<T extends object>(payload: T): T & { seal: string } { return { ...payload, seal: this.host.sign(payload) }; }
  private receipt(receipt: RuntimeAuthorityReceipt, meta: IndexedStoreMetadata, now: number, io: IndexedIoCounters): Authority | IndexedFailure {
    if (!receipt || !this.host.verify(receipt) || receipt.version !== 1 || receipt.incarnation !== meta.incarnation || receipt.generation !== meta.generation ||
        !Number.isSafeInteger(receipt.issuedAt) || receipt.issuedAt > now) return fail('stale_receipt', io);
    if (receipt.deadline <= now) return fail('expired', io);
    const a = this.controls(receipt.scope, now, io);
    if ('status' in a) return a;
    if (receipt.catalogVersion !== a.catalog.version || receipt.catalogDigest !== a.catalog.digest || receipt.deadline > a.deadline) return fail('stale_receipt', io);
    return a;
  }
  private run<T extends { status: string }>(io: IndexedIoCounters, fn: (now: number, meta: IndexedStoreMetadata) => T, deadline: (value: T) => number | undefined, at?: number): T | IndexedFailure {
    try {
      return this.host.readWindow(io, fn, (value, now) => {
        const end = deadline(value);
        if (end !== undefined && end <= now) throw new IndexedStorageError('expired');
        return { deadline: end };
      }, at);
    } catch (error) { return fail(error instanceof IndexedStorageError ? error.reason : 'corrupt', io); }
  }
  readControls(accountId: string, space: 'work' | 'personal', evaluateFresh?: IndexedControlEvaluator): ControlsResult {
    const io = emptyIndexedIo(); let deadline = Number.MAX_SAFE_INTEGER;
    try { return this.host.readWindow<ControlsResult>(io, (now, meta) => {
      if (space !== 'work' && space !== 'personal') return fail('invalid_scope', io);
      const c = this.fetchControls(accountId, io); if (!c) return fail('missing', io);
      if (c.updatedAt > now || c.createdAt > now) return fail('clock_regression', io);
      const catalog = this.host.database.prepare('SELECT version,digest FROM catalogs WHERE account_key=? AND space=?').get(accountKey(accountId), space) as Catalog | undefined;
      this.host.count(io, 'controlRowsRead');
      if (!catalog || !Number.isSafeInteger(catalog.version) || catalog.version < 1 || !/^[a-f0-9]{64}$/.test(catalog.digest)) return fail('corrupt', io);
      // No positive authority is minted. Still detect and durably publish a
      // lifecycle boundary first observed during this control read's COMMIT.
      const times: number[] = [c.binding?.expiresAt ?? 0,
        ...c.permissions.filter(p => p.spaceId === spaceIdFor(accountId, space)).map(p => p.expiresAt),
        ...c.predictionTurns.filter(t => t.space === space).flatMap(t => [t.expiresAt, t.receiptExpiresAt ?? 0, t.inFlightUntil]),
        ...c.relationshipBindings.filter(b => b.space === space).map(b => b.expiresAt),
        ...c.relationshipSources.filter(s => s.key.scope.space === space).map(s => s.expiresAt),
        ...c.relationshipControls.filter(s => s.space === space).map(s => s.pausedUntil ?? 0)];
      if (c.preferenceLearning) for (const rows of [c.preferenceLearning.presentations, c.preferenceLearning.intents,
        c.preferenceLearning.candidates, c.preferenceLearning.suppressions]) for (const row of rows) if (row.space === space) times.push(row.expiresAt);
      const next = this.host.database.prepare("SELECT expires_at FROM memory_meta INDEXED BY memory_expiry WHERE account_key=? AND space=? AND status='active' AND expires_at>? ORDER BY expires_at LIMIT 1").get(accountKey(accountId), space, now) as { expires_at: number } | undefined;
      if (next) { this.host.count(io, 'metadataRowsRead'); times.push(next.expires_at); }
      deadline = Math.min(Number.MAX_SAFE_INTEGER, ...times.filter(t => t > now));
      return { status: 'ready', controls: c, observedAt: now,
        stamp: { incarnation: meta.incarnation, generation: meta.generation, catalogVersion: catalog.version, catalogDigest: catalog.digest }, io };
    }, (value, now) => {
      if (value.status !== 'ready') return;
      freezeControlTree(value.controls); freezeControlTree(value.stamp);
      const rawEvaluation = evaluateFresh?.(value.controls, now, value.stamp);
      if (utilTypes.isPromise(rawEvaluation)) {
        // Observe only genuine native promises (including other realms), using
        // the built-in operation rather than a user-supplied then/catch method.
        void Promise.prototype.then.call(rawEvaluation, undefined, () => undefined);
        throw new IndexedStorageError('invalid_controls');
      }
      if (rawEvaluation && typeof rawEvaluation === 'object' && 'then' in rawEvaluation)
        throw new IndexedStorageError('invalid_controls'); // Never execute a thenable.
      const parsed = z.object({ deadline: z.number().int().nonnegative().safe().optional(), denied: z.boolean().optional(), observedDenial: z.boolean().optional() }).strict().safeParse(rawEvaluation);
      if (evaluateFresh && !parsed.success) throw new IndexedStorageError('invalid_controls');
      const evaluated = parsed.success ? parsed.data : undefined;
      const bound = Math.min(deadline, evaluated?.deadline ?? Number.MAX_SAFE_INTEGER);
      if (!evaluated?.denied && bound <= now) throw new IndexedStorageError('expired');
      value.observedAt = now;
      return { denied: evaluated?.denied, observedDenial: evaluated?.observedDenial, deadline: bound };
    }, undefined, { publishFresh: true });
    } catch (error) { return fail(error instanceof IndexedStorageError ? error.reason : 'corrupt', io); }
  }
  readRuntimeAuthority(scope: IndexedScope, now?: number): AuthorityResult {
    const io = emptyIndexedIo();
    return this.run<AuthorityResult>(io, (at, meta) => {
      const a = this.controls(scope, at, io); if ('status' in a) return a;
      return { status: 'ready', controls: a.controls, canonicalAllowed: true,
        receipt: this.signed({ ...this.stamp(meta, scope, a), issuedAt: at }), io };
    }, value => value.status === 'ready' ? value.receipt.deadline : undefined, now);
  }
  validateRuntimeReceiptNow(receipt: RuntimeAuthorityReceipt): ValidationResult {
    const io = emptyIndexedIo();
    return this.run<ValidationResult>(io, (now, meta) => {
      const a = this.receipt(receipt, meta, now, io); return 'status' in a ? a : { status: 'ready', io };
    }, value => value.status === 'ready' ? receipt.deadline : undefined);
  }
  private metadata(scope: IndexedScope, id: string, io: IndexedIoCounters): MemoryMetadata | undefined {
    const row = this.host.database.prepare('SELECT * FROM memory_meta WHERE account_key=? AND space=? AND id=?').get(accountKey(scope.accountId), scope.space, id) as Record<string, unknown> | undefined;
    if (!row) return;
    this.host.count(io, 'metadataRowsRead');
    const parsed = memoryMetadataSchema.safeParse(JSON.parse(String(row.json)));
    if (!parsed.success) throw new IndexedStorageError('corrupt');
    const m = parsed.data;
    if (m.id !== id || m.space !== scope.space || m.revision !== row.revision || m.epoch !== row.epoch || m.status !== row.status ||
        m.expiresAt !== row.expires_at || m.updatedAt !== row.updated_at || m.bodyBytes !== row.body_bytes || m.bodyDigest !== row.body_digest) throw new IndexedStorageError('corrupt');
    // Cross-check physical edge projection without loading any source body.
    const edges = this.host.database.prepare('SELECT source_id,expected_revision FROM source_edges WHERE account_key=? AND space=? AND derived_id=? ORDER BY source_id').all(accountKey(scope.accountId), scope.space, id) as { source_id: string; expected_revision: number }[];
    const expected = m.sourceRefs.map(r => ({ source_id: r.id, expected_revision: r.revision })).sort((a, b) => a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0);
    if (JSON.stringify(edges) !== JSON.stringify(expected)) throw new IndexedStorageError('corrupt');
    return m;
  }
  private lineage(scope: IndexedScope, id: string, now: number, io: IndexedIoCounters, cache: Map<string, MemoryMetadata | undefined>): { metadata: MemoryMetadata; claim: boolean; sourceIds: string[] } | undefined {
    const get = (id: string) => { if (!cache.has(id)) cache.set(id, this.metadata(scope, id, io)); return cache.get(id); };
    type Proof = { metadata: MemoryMetadata; height: number; claim: boolean; sourceIds: string[] };
    const resolved = new Map<string, Proof | undefined>(), visited = new Set<string>();
    const walk = (id: string, path: Set<string>): Proof | undefined => {
      if (path.has(id)) return;
      if (resolved.has(id)) return resolved.get(id);
      visited.add(id); if (visited.size > INDEXED_LIMITS.memories) return;
      const m = get(id);
      if (!m || m.status !== 'active' || !m.bodyPresent || m.bodyBytes <= 0 || m.expiresAt <= now || m.createdAt > now || m.updatedAt > now) {
        resolved.set(id, undefined); return;
      }
      const next = new Set(path); next.add(id);
      const sourceIds = new Set<string>(); let height = 1, claim = m.origin === 'user_reviewed_claim';
      for (const ref of m.sourceRefs) {
        const parent = walk(ref.id, next);
        if (!parent || parent.metadata.revision !== ref.revision || parent.metadata.expiresAt < m.expiresAt) {
          resolved.set(id, undefined); return;
        }
        height = Math.max(height, parent.height + 1);
        if (height > INDEXED_LIMITS.lineageDepth) { resolved.set(id, undefined); return; }
        claim ||= parent.claim; sourceIds.add(ref.id);
        for (const ancestor of parent.sourceIds) sourceIds.add(ancestor);
      }
      const proof = { metadata: m, height, claim, sourceIds: [...sourceIds] };
      resolved.set(id, proof); return proof;
    };
    return walk(id, new Set());
  }

  queryCandidateIds(scope: IndexedScope, query: string, receipt: RuntimeAuthorityReceipt, cursor?: CandidateCursor): CandidateResult {
    const io = emptyIndexedIo();
    return this.run<CandidateResult>(io, (now, meta) => {
      if (digest(scope) !== digest(receipt?.scope)) return fail('invalid_scope', io);
      // Core authority is useful for compact gates, never a private-memory grant.
      if (scope.purpose !== 'optional.personalization') return fail('denied', io);
      const a = this.receipt(receipt, meta, now, io); if ('status' in a) return a;
      if (typeof query !== 'string') return fail('invalid_scope', io);
      const requested = lexicalTerms(query.slice(0, INDEXED_LIMITS.queryChars)), terms = requested.slice(0, INDEXED_LIMITS.queryTerms);
      const queryDigest = digest(query), offset = cursor?.offset ?? 0;
      if (cursor && (!this.host.verify(cursor) || cursor.version !== 1 || cursor.incarnation !== meta.incarnation || cursor.generation !== meta.generation ||
          cursor.catalogVersion !== receipt.catalogVersion || cursor.catalogDigest !== receipt.catalogDigest || cursor.deadline !== receipt.deadline ||
          digest(cursor.scope) !== digest(scope) || cursor.queryDigest !== queryDigest || !Number.isSafeInteger(offset) || offset < 0 || offset > INDEXED_LIMITS.memories)) return fail('stale_cursor', io);
      const scores = new Map<string, number>(), key = accountKey(scope.accountId);
      if (terms.length) {
        const rows = this.host.database.prepare(`SELECT p.term,p.id,p.revision FROM postings p JOIN memory_meta m ON m.account_key=p.account_key AND m.space=p.space AND m.id=p.id AND m.revision=p.revision WHERE p.account_key=? AND p.space=? AND p.term IN (${terms.map(() => '?').join(',')}) AND m.status='active' AND m.expires_at>? ORDER BY p.term,p.id LIMIT ?`).all(key, scope.space, ...terms, now, INDEXED_LIMITS.memories * INDEXED_LIMITS.queryTerms + 1) as { term: string; id: string; revision: number }[];
        this.host.count(io, 'postingRowsRead', rows.length);
        if (rows.length > INDEXED_LIMITS.memories * INDEXED_LIMITS.queryTerms) return fail('corrupt', io);
        const count = (this.host.database.prepare("SELECT COUNT(*) AS n FROM memory_meta WHERE account_key=? AND space=? AND status='active' AND expires_at>?").get(key, scope.space, now) as { n: number }).n;
        const frequencies = new Map<string, number>(); for (const row of rows) frequencies.set(row.term, (frequencies.get(row.term) ?? 0) + 1);
        for (const row of rows) scores.set(row.id, (scores.get(row.id) ?? 0) + 1 + Math.log(1 + count / (1 + frequencies.get(row.term)!)));
      } else {
        const rows = this.host.database.prepare("SELECT id FROM memory_meta WHERE account_key=? AND space=? AND status='active' AND expires_at>? ORDER BY updated_at DESC,id LIMIT ?").all(key, scope.space, now, INDEXED_LIMITS.memories + 1) as { id: string }[];
        this.host.count(io, 'metadataRowsRead', rows.length);
        if (rows.length > INDEXED_LIMITS.memories) return fail('corrupt', io);
        for (const row of rows) scores.set(row.id, 0);
      }
      const cache = new Map<string, MemoryMetadata | undefined>();
      const rows = [...scores].flatMap(([id, score]) => { const proof = this.lineage(scope, id, now, io, cache); return proof ? [{ proof, score }] : []; })
        .sort((a, b) => b.score - a.score || Number(b.proof.metadata.sourceRefs.length > 0) - Number(a.proof.metadata.sourceRefs.length > 0) ||
          b.proof.metadata.updatedAt - a.proof.metadata.updatedAt || (a.proof.metadata.id < b.proof.metadata.id ? -1 : a.proof.metadata.id > b.proof.metadata.id ? 1 : 0));
      const handles = rows.slice(offset, offset + INDEXED_LIMITS.candidates).map(({ proof }) => {
        const m = proof.metadata;
        return this.signed({ ...this.stamp(meta, scope, a), deadline: receipt.deadline, id: m.id, revision: m.revision,
          epoch: m.epoch, layer: m.sourceRefs.length ? 'summary' as const : 'memory' as const,
          sourceRefs: m.sourceRefs, bodyBytes: m.bodyBytes, bodyDigest: m.bodyDigest, freshness: m.updatedAt, claim: proof.claim });
      });
      const next = offset + handles.length, more = next < rows.length;
      return { status: 'ready', handles, completion: more || requested.length > terms.length || query.length > INDEXED_LIMITS.queryChars ? 'partial' : 'complete',
        ...(more ? { cursor: this.signed({ ...this.stamp(meta, scope, a), deadline: receipt.deadline, queryDigest, offset: next }) } : {}), io };
    }, value => value.status === 'ready' ? receipt.deadline : undefined);
  }
  loadCandidateBodies(receipt: RuntimeAuthorityReceipt, handles: readonly CandidateHandle[]): BodyResult {
    const io = emptyIndexedIo();
    return this.run<BodyResult>(io, (now, meta) => {
      const a = this.receipt(receipt, meta, now, io); if ('status' in a) return a;
      if (receipt.scope.purpose !== 'optional.personalization') return fail('denied', io);
      if (handles.length > INDEXED_LIMITS.candidates || new Set(handles.map(h => h.id)).size !== handles.length) return fail('stale_handle', io);
      const cache = new Map<string, MemoryMetadata | undefined>();
      const proofs: { handle: CandidateHandle; proof: NonNullable<ReturnType<IndexedQueryEngine['lineage']>> }[] = [];
      for (const handle of handles) {
        if (!this.host.verify(handle) || handle.version !== 1 || handle.incarnation !== meta.incarnation || handle.generation !== meta.generation ||
            handle.catalogVersion !== receipt.catalogVersion || handle.catalogDigest !== receipt.catalogDigest || handle.deadline !== receipt.deadline ||
            digest(handle.scope) !== digest(receipt.scope)) return fail('stale_handle', io);
        const proof = this.lineage(receipt.scope, handle.id, now, io, cache), m = proof?.metadata;
        if (!proof || !m || m.revision !== handle.revision || m.epoch !== handle.epoch || m.bodyDigest !== handle.bodyDigest || m.bodyBytes !== handle.bodyBytes ||
            digest(m.sourceRefs) !== digest(handle.sourceRefs) || proof.claim !== handle.claim) return fail('stale_handle', io);
        proofs.push({ handle, proof });
      }
      const bodies: Extract<BodyResult, { status: 'ready' }>['bodies'] = []; let loadedBytes = 0, partial = false;
      for (const { handle, proof } of proofs) {
        if (loadedBytes + handle.bodyBytes > INDEXED_LIMITS.bodyBytes) { partial = true; continue; }
        const row = this.host.database.prepare('SELECT text,digest FROM bodies WHERE account_key=? AND space=? AND id=? AND revision=?').get(accountKey(receipt.scope.accountId), receipt.scope.space, handle.id, handle.revision) as { text: string; digest: string } | undefined;
        if (!row) return fail('corrupt', io);
        const bytes = Buffer.byteLength(row.text); this.host.count(io, 'bodyRowsRead'); this.host.count(io, 'bodyBytesRead', bytes);
        if (bytes !== handle.bodyBytes || digest(row.text) !== handle.bodyDigest || row.digest !== handle.bodyDigest) return fail('corrupt', io);
        loadedBytes += bytes;
        bodies.push({ handle, text: handle.claim ? `User-reviewed claim (not independently verified): ${row.text}` : row.text,
          ...(proof.sourceIds.length ? { sourceIds: proof.sourceIds } : {}) });
      }
      return { status: 'ready', bodies, completion: partial ? 'partial' : 'complete', io };
    }, value => value.status === 'ready' ? receipt.deadline : undefined);
  }
  /** Synthetic diagnostics: exact scoped plans, no query terms or bodies retained. */
  queryPlans(): string[] {
    this.host.assertAvailable();
    return [
      ...this.host.database.prepare('EXPLAIN QUERY PLAN SELECT id FROM postings WHERE account_key=? AND space=? AND term=?').all('', 'work', ''),
      ...this.host.database.prepare('EXPLAIN QUERY PLAN SELECT text FROM bodies WHERE account_key=? AND space=? AND id=? AND revision=?').all('', 'work', '', 1),
      ...this.host.database.prepare("EXPLAIN QUERY PLAN SELECT expires_at FROM memory_meta INDEXED BY memory_expiry WHERE account_key=? AND space=? AND status='active' AND expires_at>? ORDER BY expires_at LIMIT 1").all('', 'work', 0),
    ].map(row => String((row as { detail: string }).detail));
  }
}
