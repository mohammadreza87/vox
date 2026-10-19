import type { ConnectionActor, SpaceKind } from '../contracts';
import type { SetupReceipt, ConnectionExecutionResult } from '../application';
import { AuthenticatedBrokerClient, type BrokerJsonClient } from './auth';
export const BROKER_ROUTES = ['/v1/enrollments', '/v1/enrollments/claim', '/v1/enrollments/cancel', '/v1/execute', '/v1/revoke', '/v1/invalidate'] as const;
export class ConnectionsBrokerClient {
  readonly client: BrokerJsonClient;
  constructor(origin: string, key: Uint8Array, fetcher?: typeof fetch) { this.client = new AuthenticatedBrokerClient(origin, key, BROKER_ROUTES, fetcher); }
  beginSetup(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; expectedRevision: number; providerId: string }): Promise<SetupReceipt> {
    return this.client.call('/v1/enrollments', input);
  }
  claimSetup(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt> { return this.client.call('/v1/enrollments/claim', input); }
  cancelSetup(input: { actor: ConnectionActor; space: SpaceKind; flowId: string }): Promise<SetupReceipt> { return this.client.call('/v1/enrollments/cancel', input); }
  execute(input: { actor: ConnectionActor; space: SpaceKind; operationId: string }): Promise<ConnectionExecutionResult> { return this.client.call('/v1/execute', input); }
  invalidate(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; grantId: string }): Promise<{ futureUseStopped: true; providerEffects: 'unverified' }> { return this.client.call('/v1/invalidate', input); }
  revoke(input: { actor: ConnectionActor; space: SpaceKind; connectionId: string; providerId: string }): Promise<{ futureUseStopped: true; providerRevocation: 'verified' | 'unavailable' }> {
    return this.client.call('/v1/revoke', input);
  }
}
