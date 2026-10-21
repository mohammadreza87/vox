import { createHash } from 'crypto';
import { recordSchemas, type ConnectionsRecords, type ConnectionContext, type RecordCollection } from './contracts';
import { CONNECTION_COLLECTIONS, type ConnectionsStorage } from './storage';
import { deny } from './errors';

export const partitionIdFor = (accountId: string, space: 'work' | 'personal'): string =>
  createHash('sha256').update(JSON.stringify([accountId, space])).digest('hex');
/** Deterministic key order, stable for objects; arrays preserve exact semantic order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return deny('invalid_canonical_input', 400);
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export class ConnectionsRepository {
  constructor(readonly storage: ConnectionsStorage, private readonly assertCurrent?: (context: ConnectionContext) => void) {}
  async transaction<T>(context: ConnectionContext, mutate: (records: ConnectionsRecords) => T): Promise<T> {
    const partitionId = partitionIdFor(context.accountId, context.scope.spaceKind);
    this.assertCurrent?.(context);
    const result = await this.storage.transact(partitionId, current => {
      this.assertCurrent?.(context);
      const records = {} as ConnectionsRecords;
      for (const name of CONNECTION_COLLECTIONS) {
        const rows = current[name].map(row => recordSchemas[name].parse(row));
        if (new Set(rows.map(row => row.id)).size !== rows.length || rows.length > 2000) deny('corrupt_records', 500);
        for (const row of rows) {
          if (row.partitionId !== partitionId || row.ownerAccountId !== context.accountId || row.ownerPersonId !== context.personId ||
              row.scope.tenantId !== context.scope.tenantId || row.scope.spaceId !== context.scope.spaceId ||
              row.scope.containerId !== context.scope.containerId || row.scope.spaceKind !== context.scope.spaceKind) deny('corrupt_partition', 500);
        }
        // Collection-specific parser preserves the exact mapped collection type.
        (records as Record<RecordCollection, unknown[]>)[name] = rows;
      }
      if (new Set(records.operations.map(o => o.idempotencyKey)).size !== records.operations.length ||
          new Set(records.operations.map(o => o.requestId)).size !== records.operations.length ||
          new Set(records.grants.filter(g => g.status === 'active').map(g => `${g.connectionId}:${g.agentId}`)).size !== records.grants.filter(g => g.status === 'active').length)
        deny('corrupt_unique_index', 500);
      const result = mutate(records);
      for (const name of CONNECTION_COLLECTIONS) for (const row of records[name]) {
        recordSchemas[name].parse(row);
        if (row.partitionId !== partitionId || row.ownerAccountId !== context.accountId || row.ownerPersonId !== context.personId ||
            row.scope.tenantId !== context.scope.tenantId || row.scope.spaceId !== context.scope.spaceId || row.scope.containerId !== context.scope.containerId || row.scope.spaceKind !== context.scope.spaceKind) deny('corrupt_partition', 500);
      }
      this.assertCurrent?.(context);
      return { records, result };
    });
    this.assertCurrent?.(context);
    return result;
  }
}
