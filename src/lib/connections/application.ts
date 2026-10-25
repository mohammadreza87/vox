import type { ConnectionsService } from './service';
import type { ConnectionActor, ConnectionsSnapshot, Effect, OperationReceipt, SpaceKind } from './contracts';
import type { ConnectionTaskResult } from './task-runtime';
import type { ConnectionsWorkflowService } from './workflows/service';
import type { McpConnectionsCatalog } from './mcp/catalog';
import type { WorkflowChoice } from './workflows/recipes';

/** Safe presentation contract. Provider endpoints, credentials and account subjects
 * stay behind the broker; a declared service is not evidence of account access. */
export interface ConnectionProviderView {
  id: string; name: string; description: string; setup: 'oauth' | 'operator';
  availability: 'ready' | 'setup_required' | 'unavailable'; reason: string;
  tools: Array<{ id: string; name: string; effect: Effect }>;
  /** Settings v2 only: this person's true state for the requested agent and space, from Studio-visible facts (no subjects, resources or paths). */
  state?: ProviderSetupState;
}
/** What is missing, named without secrets: Connections off, no broker, no operator profile for this person+agent+space, Personal-only,
 * answers not approved, or (`vox_enrolls`) an operator-token or runner app that only a Vox operator can finish connecting (broker CLI). */
export type ProviderNeed = 'connections_off' | 'service_off' | 'not_set_up_for_you' | 'personal_only' | 'answers_off' | 'vox_enrolls';
export interface ProviderSetupState {
  status: 'connected' | 'pending' | 'available' | 'needs_vox' | 'not_here';
  /** How a person gets it: browser sign-in (broker OAuth), Vox adds it (operator token), or an attested runner. */
  how: 'sign_in' | 'vox_adds' | 'runner';
  needs: ProviderNeed[];
  connectionId?: string;
  /** End of this agent's live access (an active, unexpired grant). */
  connectedUntil?: number;
}
/** `main_app_off`: this Vox server has no committed identity fence for the main app (e.g. Firestore), so servers can't be added from it. */
export type McpNeed = 'connections_off' | 'service_off' | 'mcp_off' | 'main_app_off' | 'answers_off';
export interface ConnectionResourceView { id: string; label: string; toolIds: string[]; destinationIds: string[]; tools?: ConnectionProviderView['tools'] }
export interface ConnectionsDashboard extends ConnectionsSnapshot {
  providers: ConnectionProviderView[];
  agents: Array<{ id: string; name: string }>;
  enabled: boolean;
  mcpAvailable?: boolean;
  maxGrantExpiryAt: number;
  canRunTasks?: boolean;
  modelProcessor?: { provider: string; model: string };
  skills?: Array<{ id: string; version: 1; title: string; providerIds: readonly string[] }>;
  /** Settings v2 only: whether custom MCP servers can be added here, and what is missing when not. */
  mcp?: { available: boolean; needs: McpNeed[] };
}
export interface SetupReceipt { flowId: string; status: 'pending' | 'connected' | 'cancelled' | 'expired' | 'failed';
  kind?: 'remote_mcp'; authorizationUrl?: string; expiresAt: number; reason?: string }
export interface McpSetupPreview extends SetupReceipt { catalog: ReturnType<McpConnectionsCatalog['view']> }
export interface ConnectionExecutionResult { receipt: OperationReceipt; output?: unknown; sourceIds?: string[] }
export interface ConnectionsApplication {
  service: ConnectionsService;
  workflows?: ConnectionsWorkflowService;
  workflowChoices?(actor: ConnectionActor, space: SpaceKind): Promise<WorkflowChoice[]>;
  assertWorkflowMutationAllowed?(): Promise<void>;
  dashboard(actor: ConnectionActor, space: SpaceKind, agentId?: string): Promise<ConnectionsDashboard>;
  resources(actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<ConnectionResourceView[]>;
  beginSetup(actor: ConnectionActor, space: SpaceKind, connectionId: string): Promise<SetupReceipt>;
  claimSetup(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<SetupReceipt>;
  cancelSetup(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<SetupReceipt>;
  execute(actor: ConnectionActor, space: SpaceKind, operationId: string): Promise<ConnectionExecutionResult>;
  enrollMcp?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  previewMcpSetup?(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<McpSetupPreview>;
  claimMcpSetup?(actor: ConnectionActor, space: SpaceKind, flowId: string, acceptedCatalogDigest: string): Promise<SetupReceipt>;
  cancelMcpSetup?(actor: ConnectionActor, space: SpaceKind, flowId: string): Promise<SetupReceipt>;
  enroll?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  grant?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  revoke?(actor: ConnectionActor, input: unknown): Promise<ConnectionsSnapshot>;
  task?(actor: ConnectionActor, input: unknown): Promise<ConnectionTaskResult>;
  assertTaskCurrent?(providerId: string, agentId?: string): Promise<void>;
  assertModelCurrent?(): Promise<void>;
  reserveTaskBudget?(providerId: string, requestId: string, kind: 'model_tokens' | 'tool_calls', units: number, agentId?: string): Promise<void>;
}
