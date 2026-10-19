import type { ConnectionsService } from './service';
import type { ConnectionActor, ConnectionsSnapshot, Effect, OperationReceipt, SpaceKind } from './contracts';
import type { ConnectionTaskResult } from './task-runtime';
import type { ConnectionsWorkflowService } from './workflows/service';
import type { WorkflowChoice } from './workflows/recipes';

/** Safe presentation contract. Provider endpoints, credentials and account subjects
 * stay behind the broker; a declared service is not evidence of account access. */
export interface ConnectionProviderView {
  id: string; name: string; description: string; setup: 'oauth' | 'operator';
  availability: 'ready' | 'setup_required' | 'unavailable'; reason: string;
  tools: Array<{ id: string; name: string; effect: Effect }>;
}
export interface ConnectionResourceView { id: string; label: string; toolIds: string[]; destinationIds: string[] }
export interface ConnectionsDashboard extends ConnectionsSnapshot {
  providers: ConnectionProviderView[];
  agents: Array<{ id: string; name: string }>;
  enabled: boolean;
  maxGrantExpiryAt: number;
  canRunTasks?: boolean;
  modelProcessor?: { provider: string; model: string };
  skills?: Array<{ id: string; version: 1; title: string; providerIds: readonly string[] }>;
}
export interface SetupReceipt { flowId: string; status: 'pending' | 'connected' | 'cancelled' | 'expired' | 'failed';
  authorizationUrl?: string; expiresAt: number; reason?: string }
export interface ConnectionExecutionResult { receipt: OperationReceipt; output?: unknown; sourceIds?: string[] }
export interface ConnectionsApplication {
  service: ConnectionsService;
  workflows?: ConnectionsWorkflowService;
  workflowChoices?(actor: ConnectionActor, space: SpaceKind): Promise<WorkflowChoice[]>;
  assertWorkflowMutationAllowed?(): Promise<void>;
  dashboard(actor: ConnectionActor, space: SpaceKind): Promise<ConnectionsDashboard>;
  resources(actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<ConnectionResourceView[]>;
  beginSetup(actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<SetupReceipt>;
  claimSetup(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<SetupReceipt>;
  cancelSetup(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<SetupReceipt>;
  execute(actor: ConnectionActor, space: SpaceKind, operationId: string): Promise<ConnectionExecutionResult>;
  enroll?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  grant?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  revoke?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  task?(actor: ConnectionActor, input: unknown): Promise<ConnectionTaskResult>;
  assertTaskCurrent?(providerId: string): Promise<void>;
  assertModelCurrent?(): Promise<void>;
  reserveTaskBudget?(providerId: string, requestId: string, kind: 'model_tokens' | 'tool_calls', units: number): Promise<void>;
}
