import { z } from 'zod';
import { mcpCatalogSnapshotSchema } from '../mcp/catalog';
import { idSchema, type ConnectionActor, type ConnectionContext, type ConnectionRecord, type ConnectionGrantRecord, type ConnectionSubscription, type ProviderAccountRecord, type OperationRecord, type SpaceKind } from '../contracts';
import { assertOwner } from '../policy';
import { ConnectionsError } from '../errors';
import type { ConnectionsService } from '../service';
import type { OperationClaim } from '../operations';
import { verifiedEventSchema, registerSubscriptionSchema } from '../events/contracts';
import { ConnectionsWorkflowService } from '../workflows/service';
import type { BrokerJsonClient } from './auth';
const actor = z.object({ accountId: idSchema, botAgentId: idSchema.optional(), botAuthenticationRevision: idSchema.optional() }).strict()
  .refine(value => !!value.botAgentId === !!value.botAuthenticationRevision);
const space = z.enum(['work', 'personal']);
const base = { actor, space };
const lease = { ...base, operationId: idSchema, workerId: idSchema, fence: z.number().int().positive() };
export const brokerControlSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('drainWorkflows'), ...base, maxOccurrences: z.number().int().positive().max(10) }).strict(),
  z.object({ action: z.literal('subscriptionContext'), ...base, connectionId: idSchema, subscriptionId: idSchema }).strict(),
  z.object({ action: z.literal('registerSubscription'), ...base, subscription: registerSubscriptionSchema }).strict(),
  z.object({ action: z.literal('ingestVerifiedEvent'), ...base, event: verifiedEventSchema }).strict(),
  z.object({ action: z.literal('context'), ...base, connectionId: idSchema }).strict(),
  z.object({ action: z.literal('grantContext'), ...base, connectionId: idSchema, grantId: idSchema }).strict(),
  z.object({ action: z.literal('claim'), ...base, operationId: idSchema, workerId: idSchema, leaseMs: z.number().int().positive().max(60_000) }).strict(),
  z.object({ action: z.literal('abandonClaim'), ...lease, safeReason: z.literal('broker_preflight_failed') }).strict(),
  z.object({ action: z.literal('markDispatched'), ...lease }).strict(),
  z.object({ action: z.literal('settle'), ...lease, outcome: z.enum(['committed', 'verified', 'failed', 'outcome_unknown']), providerReceiptRef: idSchema.optional() }).strict(),
  z.object({ action: z.literal('assertDispatchable'), ...base, operationId: idSchema }).strict(),
  z.object({ action: z.literal('assertUsable'), ...base, operationId: idSchema }).strict(),
  z.object({ action: z.literal('completeMcpEnrollment'), ...base, connectionId: idSchema, expectedRevision: z.number().int().positive(),
    catalog: mcpCatalogSnapshotSchema, issuer: z.string().url().max(2000), providerSubject: idSchema, providerTenantId: idSchema,
    providerScopes: z.array(idSchema).max(100), displayLabel: z.string().min(1).max(160), identityEvidence: z.literal('unavailable') }).strict(),
  z.object({ action: z.literal('completeEnrollment'), ...base, connectionId: idSchema, expectedRevision: z.number().int().positive(),
    issuer: z.string().url().max(500), providerSubject: idSchema, providerTenantId: idSchema, providerScopes: z.array(idSchema).max(100), displayLabel: z.string().min(1).max(160) }).strict(),
  z.object({ action: z.literal('registerResult'), ...base, operationId: idSchema, resourceId: idSchema, resourceRevision: idSchema }).strict(),
]);
export type BrokerControlInput = z.infer<typeof brokerControlSchema>;
export interface BrokerSubscriptionAuthority extends BrokerAuthority { subscription: ConnectionSubscription }
export interface BrokerGrantAuthority extends BrokerAuthority { grant: ConnectionGrantRecord }
export interface BrokerAuthority { providerEnabled?: boolean; context: ConnectionContext; connection: ConnectionRecord; providerAccount?: ProviderAccountRecord }
export interface BrokerControlPlane {
  call<T>(input: BrokerControlInput): Promise<T>;
}
export class HttpBrokerControlPlane implements BrokerControlPlane {
  constructor(private readonly client: BrokerJsonClient) {}
  call<T>(input: BrokerControlInput): Promise<T> { return this.client.call<T>('/api/connections/broker', brokerControlSchema.parse(input)); }
}
/** Root's route MUST verify BrokerAuthenticator over original bytes before calling.
 * Browser Telegram credentials never authorize this restricted control surface. */
export async function dispatchBrokerControl(service: ConnectionsService, input: unknown, options: { workflows?: ConnectionsWorkflowService } = {}): Promise<unknown> {
  const parsed = brokerControlSchema.parse(input);
  const { actor: currentActor, space: currentSpace } = parsed;
  switch (parsed.action) {
    case 'drainWorkflows': if (!options.workflows) throw new ConnectionsError(503, 'workflow_dispatch_unavailable'); return options.workflows.drain(currentActor, { space: currentSpace, maxOccurrences: parsed.maxOccurrences });
    case 'registerSubscription': return new ConnectionsWorkflowService(service, { dispatcher: async () => { throw new ConnectionsError(503, 'workflow_dispatch_unavailable'); } }).registerSubscription(currentActor, { space: currentSpace, ...parsed.subscription });
    case 'ingestVerifiedEvent': return new ConnectionsWorkflowService(service, { dispatcher: async () => { throw new ConnectionsError(503, 'workflow_dispatch_unavailable'); } }).acceptVerifiedEvent(currentActor, currentSpace, parsed.event);
    case 'context':
    case 'grantContext':
    case 'subscriptionContext': {
      const context = await service.context(currentActor, currentSpace);
      return service.repository.transaction(context, records => {
        const connection = records.connections.find(c => c.id === parsed.connectionId);
        if (!connection) throw new ConnectionsError(404, 'connection_unavailable');
        assertOwner(context, connection);
        if (parsed.action === 'subscriptionContext') {
          const subscription = records.subscriptions.find(s => s.id === parsed.subscriptionId && s.connectionId === connection.id);
          if (!subscription) throw new ConnectionsError(404, 'subscription_unavailable');
          return { context, connection, subscription } satisfies BrokerSubscriptionAuthority;
        }
        if (parsed.action === 'grantContext') {
          const grant = records.grants.find(g => g.id === parsed.grantId && g.connectionId === connection.id);
          if (!grant) throw new ConnectionsError(404, 'grant_unavailable');
          return { context, connection, grant } satisfies BrokerGrantAuthority;
        }
        return { context, connection, ...(connection.providerAccountId ? { providerAccount: records.providerAccounts.find(a => a.id === connection.providerAccountId) } : {}) } satisfies BrokerAuthority;
      });
    }
    case 'claim': return service.operations.claim(currentActor, parsed);
    case 'abandonClaim': return service.operations.abandonClaim(currentActor, parsed);
    case 'markDispatched': return service.operations.markDispatched(currentActor, parsed);
    case 'settle': return service.operations.settle(currentActor, parsed);
    case 'assertDispatchable': await service.operations.assertDispatchable(currentActor, currentSpace, parsed.operationId); return { allowed: true };
    case 'assertUsable': await service.operations.assertUsable(currentActor, currentSpace, parsed.operationId); return { allowed: true };
    case 'completeMcpEnrollment': await service.completeMcpEnrollment(currentActor, parsed); return { completed: true };
    case 'completeEnrollment': await service.completeEnrollment(currentActor, parsed); return { completed: true };
    case 'registerResult': return service.lineage.registerResult(currentActor, parsed);
  }
}
export const authority = (control: BrokerControlPlane, actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<BrokerAuthority> =>
  control.call({ action: 'context', actor, space, connectionId });
export type { OperationClaim, OperationRecord };
