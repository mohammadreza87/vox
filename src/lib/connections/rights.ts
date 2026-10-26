import { randomUUID } from 'crypto';
import { recordSchemas, type ConnectionActor, type ConnectionRecord, type ConnectionsRecords, type RecordCollection, type SpaceKind } from './contracts';
import { CONNECTION_COLLECTIONS, emptyRecords, type ConnectionsStorage, type RawConnectionsRecords } from './storage';
import { partitionIdFor } from './repository';
import { listProviderDefinitions } from './catalog';
import { ConnectionsError } from './errors';
import type { BrokerAuthority } from './broker/control';

/**
 * Rights coverage for connections (export and erasure), server only. Works on the person's own partitions
 * without an identity confirmation, so a filed request never depends on one. Tokens never pass through
 * here: they live only in the broker vault, and Studio records hold opaque handles at most, which the
 * export leaves out. Every function is best-effort for its caller and never throws.
 */
export interface ConnectionsRightsPort {
  storage: ConnectionsStorage;
  /** Broker erasure revocation (/v1/erase): needs no current identity confirmation, so it works for someone who never returns. */
  erase?: (input: { actor: { accountId: string }; space: SpaceKind; connectionId: string; providerId: string }) => Promise<unknown>;
  /** Fallback for a broker without /v1/erase: the existing /v1/revoke, which needs a current actor. Absent when no broker is configured. */
  revoke?: (input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; providerId: string }) => Promise<unknown>;
  /** A server-minted actor /v1/revoke accepts for this person and connection, or undefined when none is current. */
  actorFor: (accountId: string, connection: ConnectionRecord) => Promise<ConnectionActor | undefined>;
  now?: () => number;
  log?: Pick<Console, 'warn'>;
}

/** Audit marker left on an erased connection until the broker confirms its vault entry is gone. */
export const ERASED_EVENT = 'rights_erased';

export interface ConnectionsExport {
  space: SpaceKind;
  connections: Array<{ id: string; providerId: string; agentId?: string; displayLabel: string; lifecycle: string; health: string; createdAt: number; updatedAt: number; mcp?: { server: string; tools: string[] } }>;
  providerAccounts: Array<{ providerId: string; displayLabel: string; issuer: string; status: string }>;
  grants: Array<{ connectionId: string; agentId: string; toolIds: string[]; resourceIds: string[]; effects: string[]; expiresAt: number; status: string; createdAt: number }>;
  operations: Array<{ id: string; connectionId: string; toolId: string; agentId: string; state: string; effect: string; resourceIds: string[]; createdAt: number; completedAt: number | null; safeReason: string | null }>;
  approvals: Array<{ operationId: string; createdAt: number; consumedAt: number | null }>;
  payloads: Array<{ operationId: string; arguments: Record<string, unknown> }>;
  workflows: Array<{ id: string; name: string; agentId: string; connectionId: string; schedule: unknown; status: string; expiresAt: number; createdAt: number }>;
  occurrences: Array<{ workflowId: string; slotAt: number; state: string }>;
  subscriptions: Array<{ connectionId: string; providerId: string; eventTypes: string[]; status: string }>;
  audits: Array<{ event: string; createdAt: number }>;
}

const warn = (port: ConnectionsRightsPort, code: string) => (port.log ?? console).warn(`[studio] ${code}`);
const providerLabel = (providerId: string) => providerId === 'remote_mcp' ? 'Custom MCP' : listProviderDefinitions().find(p => p.id === providerId)?.label ?? providerId;

/** Valid rows only; a row that no longer parses is left out (export) or dropped (erasure: it is this person's own partition). */
function parse(raw: RawConnectionsRecords): ConnectionsRecords {
  const records = {} as Record<RecordCollection, unknown[]>;
  for (const name of CONNECTION_COLLECTIONS) records[name] = (raw[name] ?? []).flatMap(row => { const parsed = recordSchemas[name].safeParse(row); return parsed.success ? [parsed.data] : []; });
  return records as ConnectionsRecords;
}
const empty = (records: ConnectionsRecords) => CONNECTION_COLLECTIONS.every(name => records[name].length === 0);

async function read(port: ConnectionsRightsPort, partitionId: string): Promise<ConnectionsRecords> {
  // Without a read-only peek, a no-op transaction reads without writing (both backends skip unchanged commits).
  const raw = port.storage.peek ? await port.storage.peek(partitionId)
    : await port.storage.transact(partitionId, current => { const records = parse(current); return { records, result: current }; });
  return parse(raw ?? emptyRecords());
}

/** The person's own connection records for one space, allowlisted field by field. Null when there are none. */
export async function exportConnections(port: ConnectionsRightsPort, accountId: string, space: SpaceKind): Promise<ConnectionsExport | null> {
  const r = await read(port, partitionIdFor(accountId, space));
  const own = <T extends { ownerAccountId: string }>(rows: T[]) => rows.filter(row => row.ownerAccountId === accountId);
  if (empty(r)) return null;
  return {
    space,
    connections: own(r.connections).map(c => ({ id: c.id, providerId: c.providerId, ...(c.schemaVersion === 2 ? { agentId: c.agentId } : {}), displayLabel: c.displayLabel,
      lifecycle: c.lifecycle, health: c.health, createdAt: c.createdAt, updatedAt: c.updatedAt,
      ...(c.schemaVersion === 2 && c.mcp ? { mcp: { server: c.mcp.canonicalResourceUri, tools: (c.mcp.catalog?.tools ?? []).map(t => t.title ?? t.name) } } : {}) })),
    providerAccounts: own(r.providerAccounts).map(a => ({ providerId: a.providerId, displayLabel: a.displayLabel, issuer: a.issuer, status: a.status })),
    grants: own(r.grants).map(g => ({ connectionId: g.connectionId, agentId: g.agentId, toolIds: [...g.toolIds], resourceIds: [...g.resourceIds], effects: [...g.effects], expiresAt: g.expiresAt, status: g.status, createdAt: g.createdAt })),
    operations: own(r.operations).map(o => ({ id: o.id, connectionId: o.connectionId, toolId: o.toolId, agentId: o.agentId, state: o.state, effect: o.effect,
      resourceIds: [...o.resourceIds], createdAt: o.createdAt, completedAt: o.completedAt, safeReason: o.safeReason })),
    approvals: own(r.approvals).map(a => ({ operationId: a.operationId, createdAt: a.createdAt, consumedAt: a.consumedAt })),
    payloads: own(r.payloads).map(p => ({ operationId: p.operationId, arguments: structuredClone(p.arguments) })),
    workflows: own(r.workflows).map(w => ({ id: w.id, name: w.name, agentId: w.agentId, connectionId: w.connectionId, schedule: structuredClone(w.schedule), status: w.status, expiresAt: w.expiresAt, createdAt: w.createdAt })),
    occurrences: own(r.occurrences).map(o => ({ workflowId: o.workflowId, slotAt: o.slotAt, state: o.state })),
    subscriptions: own(r.subscriptions).map(s => ({ connectionId: s.connectionId, providerId: s.providerId, eventTypes: [...s.eventTypes], status: s.status })),
    audits: own(r.audits).map(a => ({ event: a.event, createdAt: a.createdAt })),
  };
}

/** Removes every record that belongs to one connection (after the broker confirmed its vault entry is gone). */
function purge(records: ConnectionsRecords, connectionId: string): void {
  const operationIds = new Set(records.operations.filter(o => o.connectionId === connectionId).map(o => o.id));
  const workflowIds = new Set(records.workflows.filter(w => w.connectionId === connectionId).map(w => w.id));
  const connection = records.connections.find(c => c.id === connectionId);
  records.connections = records.connections.filter(c => c.id !== connectionId);
  if (connection?.providerAccountId && !records.connections.some(c => c.providerAccountId === connection.providerAccountId))
    records.providerAccounts = records.providerAccounts.filter(a => a.id !== connection.providerAccountId);
  const rows = records as unknown as Record<RecordCollection, Array<{ connectionId?: string | null; operationId?: string | null }>>;
  for (const name of ['grants', 'sources', 'tombstones', 'subscriptions', 'eventInbox', 'workflows', 'outbox', 'operations'] as const)
    rows[name] = rows[name].filter(row => row.connectionId !== connectionId);
  for (const name of ['approvals', 'payloads', 'attempts'] as const) rows[name] = rows[name].filter(row => !operationIds.has(row.operationId ?? ''));
  records.occurrences = records.occurrences.filter(o => !workflowIds.has(o.workflowId));
  records.audits = records.audits.filter(a => a.subjectId !== connectionId && (a.operationId === null || !operationIds.has(a.operationId)));
}

const confirmed = (result: unknown) => !!result && typeof result === 'object' && (result as { futureUseStopped?: unknown }).futureUseStopped === true;
/** One vault revocation: /v1/erase first (no identity needed), else /v1/revoke with a current actor. */
async function revokeOne(port: ConnectionsRightsPort, accountId: string, space: SpaceKind, connection: ConnectionRecord): Promise<boolean> {
  const input = { space, connectionId: connection.id, providerId: connection.providerId };
  if (port.erase) { try { if (confirmed(await port.erase({ ...input, actor: { accountId } }))) return true; } catch { /* an older broker: fall back */ } }
  const actor = port.revoke ? await port.actorFor(accountId, connection) : undefined;
  return !!(port.revoke && actor && confirmed(await port.revoke({ ...input, actor })));
}

/** Broker revocation for each erased connection, then its records go. A failure leaves it revoked and marked for a retry. */
async function revokeErased(port: ConnectionsRightsPort, accountId: string, space: SpaceKind, connections: ConnectionRecord[]): Promise<{ purged: number; pending: number }> {
  let pending = 0, purged = 0;
  const partitionId = partitionIdFor(accountId, space);
  for (const connection of connections) {
    try {
      if (!await revokeOne(port, accountId, space, connection)) throw new Error('revocation_unconfirmed');
      await port.storage.transact(partitionId, raw => { const records = parse(raw); purge(records, connection.id); return { records, result: undefined }; });
      purged++;
    } catch { pending++; warn(port, 'connections_revoke_pending'); }
  }
  return { purged, pending };
}

/**
 * The broker's 'erasedContext' (rights erasure only): the authority for a connection of this account that an erasure
 * revoked and marked, with the owner taken from the record itself, so no identity confirmation is needed. Anything
 * else (a bot actor, a live or unmarked connection) is unavailable, so this can only stop use and drop secrets.
 */
export async function erasedAuthority(port: Pick<ConnectionsRightsPort, 'storage'>, actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<BrokerAuthority> {
  if (actor.botAgentId || actor.botAuthenticationRevision) throw new ConnectionsError(404, 'connection_unavailable');
  const records = await read(port as ConnectionsRightsPort, partitionIdFor(actor.accountId, space));
  const connection = records.connections.find(c => c.id === connectionId && c.ownerAccountId === actor.accountId && c.scope.spaceKind === space);
  if (!connection || !['revoked', 'deleted'].includes(connection.lifecycle) || !records.audits.some(a => a.event === ERASED_EVENT && a.subjectId === connection.id))
    throw new ConnectionsError(404, 'connection_unavailable');
  return { context: { accountId: actor.accountId, personId: connection.ownerPersonId, bindingId: `erased:${connection.id}`, bindingRevision: 1, bindingExpiresAt: 0,
    scope: structuredClone(connection.scope), currentAgentIds: [] }, connection };
}

/** Retry pacing per storage and partition in this process: a quiet partition is not re-read on every Connections load. */
const pacing = new WeakMap<ConnectionsStorage, Map<string, number>>();
const nextRetryAt = (storage: ConnectionsStorage) => { let map = pacing.get(storage); if (!map) pacing.set(storage, map = new Map()); return map; };
const QUIET_MS = 30 * 60_000, FAILED_MS = 5 * 60_000;

/**
 * Erasure: every connection of this person in these spaces stops at once (records revoked, so the broker
 * refuses any further use), then the broker is asked to drop each vault entry and the records go. Returns how
 * many connections were erased and how many still wait for the broker. Never throws.
 */
export async function eraseConnections(port: ConnectionsRightsPort, accountId: string, spaces: readonly SpaceKind[]): Promise<{ erased: number; pending: number }> {
  let erased = 0, pending = 0;
  for (const space of spaces) {
    try {
      const partitionId = partitionIdFor(accountId, space);
      if (empty(await read(port, partitionId))) continue;
      const now = port.now?.() ?? Date.now();
      const marked = await port.storage.transact(partitionId, raw => {
        const records = parse(raw);
        const base = (c: ConnectionRecord) => ({ schemaVersion: 1 as const, id: randomUUID(), partitionId, revision: 1, createdAt: now, updatedAt: now,
          retentionUntil: Number.MAX_SAFE_INTEGER, ownerAccountId: c.ownerAccountId, ownerPersonId: c.ownerPersonId, scope: structuredClone(c.scope) });
        for (const c of records.connections) {
          if (c.lifecycle !== 'revoked' && c.lifecycle !== 'deleted') { c.lifecycle = 'revoked'; c.revocationEpoch++; }
          c.displayLabel = providerLabel(c.providerId);
          if (c.schemaVersion === 2 && c.mcp) c.mcp = { canonicalResourceUri: c.mcp.canonicalResourceUri, catalog: null };
          c.revision++; c.updatedAt = now;
        }
        // The provider identity is not needed to revoke (the broker binds by connection and person), so it goes now.
        for (const a of records.providerAccounts) { a.status = 'revoked'; a.displayLabel = providerLabel(a.providerId); a.providerSubject = 'erased'; a.providerTenantId = 'erased'; a.revision++; a.updatedAt = now; }
        for (const g of records.grants) if (g.status === 'active') { g.status = 'revoked'; g.revocationEpoch++; g.revision++; g.updatedAt = now; }
        for (const o of records.operations) {
          if (['needs_approval', 'authorized', 'queued'].includes(o.state)) { o.state = 'cancelled'; o.safeReason = 'erased'; o.completedAt = now; }
          else if (o.state === 'sending') { o.state = 'outcome_unknown'; o.safeReason = 'erased_after_dispatch'; }
          else continue;
          o.cancellationRequestedAt = now; o.fence++; o.leaseOwner = null; o.leaseUntil = null; o.revision++; o.updatedAt = now;
        }
        for (const w of records.workflows) if (w.status !== 'expired') { w.status = 'expired'; w.revision++; w.updatedAt = now; }
        for (const s of records.subscriptions) if (s.status !== 'revoked') { s.status = 'revoked'; s.revision++; s.updatedAt = now; }
        records.payloads = []; records.sources = []; records.approvals = []; records.eventInbox = []; records.occurrences = []; records.outbox = []; records.attempts = [];
        records.audits = records.connections.map(c => ({ ...base(c), event: ERASED_EVENT, subjectId: c.id, operationId: null }));
        records.tombstones = records.connections.map(c => ({ ...base(c), connectionId: c.id, sourceId: null, revocationEpoch: c.revocationEpoch,
          reason: 'disconnect' as const, providerRevocation: 'pending' as const, purge: 'pending' as const }));
        return { records, result: structuredClone(records.connections) };
      });
      erased += marked.length;
      nextRetryAt(port.storage).delete(partitionId);
      pending += (await revokeErased(port, accountId, space, marked)).pending;
    } catch { warn(port, 'connections_erasure_failed'); }
  }
  return { erased, pending };
}

/**
 * Retries vault revocation for connections an erasure left pending (a broker outage); returns how many finished.
 * Paced per partition: at most every 30 minutes when nothing waits, every 5 when a retry failed; `force` skips the pacing.
 * Never throws.
 */
export async function retryErasedRevocations(port: ConnectionsRightsPort, accountId: string, space: SpaceKind, o: { force?: boolean } = {}): Promise<number> {
  const partitionId = partitionIdFor(accountId, space), now = port.now?.() ?? Date.now(), paced = nextRetryAt(port.storage);
  if (!o.force && (paced.get(partitionId) ?? 0) > now) return 0;
  try {
    const records = await read(port, partitionId);
    const marked = new Set(records.audits.filter(a => a.event === ERASED_EVENT).map(a => a.subjectId));
    const waiting = records.connections.filter(c => marked.has(c.id) && (c.lifecycle === 'revoked' || c.lifecycle === 'deleted'));
    const result = waiting.length ? await revokeErased(port, accountId, space, waiting) : { purged: 0, pending: 0 };
    if (paced.size > 5000) paced.clear();
    paced.set(partitionId, now + (result.pending ? FAILED_MS : QUIET_MS));
    return result.purged;
  } catch { warn(port, 'connections_revoke_pending'); paced.set(partitionId, now + FAILED_MS); return 0; }
}
