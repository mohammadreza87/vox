'use client';
import type { ConnectionsDashboard, ConnectionResourceView, SetupReceipt, ConnectionExecutionResult } from '@/lib/connections/application';
import type { ConnectionsSnapshot, GrantInput, OperationReceipt, SpaceKind } from '@/lib/connections/contracts';
import { request, tg } from './client';
import type { ConnectionTaskInput, ConnectionTaskResult } from '@/lib/connections/task-runtime';
import type { ConnectionsWorkflowService } from '@/lib/connections/workflows/service';
import type { WorkflowChoice } from '@/lib/connections/workflows/recipes';
import type { ConnectionWorkflow } from '@/lib/connections/contracts';

export const connectionsApi = {
  read: (space: SpaceKind) => request<ConnectionsDashboard>('GET', `connections?space=${space}`),
  enroll: (space: SpaceKind, providerId: string, displayLabel: string) => request<ConnectionsSnapshot>('POST', 'connections/enroll', { space, providerId, displayLabel }),
  resources: (space: SpaceKind, connectionId: string) => request<{ resources: ConnectionResourceView[] }>('GET', `connections/resources/${encodeURIComponent(connectionId)}?space=${space}`),
  grant: (input: GrantInput) => request<ConnectionsSnapshot>('POST', 'connections/grants', input),
  revoke: (space: SpaceKind, connectionId: string, expectedRevision: number, grantId?: string, expectedGrantRevision?: number) => request<ConnectionsSnapshot>('POST', 'connections/revoke', { space, connectionId, expectedRevision, ...(grantId ? { grantId, expectedGrantRevision } : {}) }),
  setup: (space: SpaceKind, connectionId: string) => request<SetupReceipt>('POST', 'connections/setup', { space, connectionId }),
  claim: (space: SpaceKind, flowId: string) => request<SetupReceipt>('POST', 'connections/setup/claim', { space, flowId }),
  cancelSetup: (space: SpaceKind, flowId: string) => request<SetupReceipt>('POST', 'connections/setup/cancel', { space, flowId }),
  review: (space: SpaceKind, operation: OperationReceipt) => request<{ receipt: OperationReceipt; arguments: Record<string, unknown> }>('GET', `connections/review/${encodeURIComponent(operation.operationId)}?space=${space}&revision=${operation.revision}`),
  approve: (space: SpaceKind, operation: OperationReceipt) => request<OperationReceipt>('POST', 'connections/actions/approve', { space, operationId: operation.operationId, expectedRevision: operation.revision, proposalDigest: operation.proposalDigest }),
  cancel: (space: SpaceKind, operation: OperationReceipt) => request<OperationReceipt>('POST', 'connections/actions/cancel', { space, operationId: operation.operationId, expectedRevision: operation.revision }),
  execute: (space: SpaceKind, operationId: string) => request<ConnectionExecutionResult>('POST', 'connections/actions/execute', { space, operationId }),
  task: (input: ConnectionTaskInput) => request<ConnectionTaskResult>('POST', 'connections/tasks', input),
  workflows: (space: SpaceKind) => request<Awaited<ReturnType<ConnectionsWorkflowService['list']>>>('GET', `connections/workflows?space=${space}`),
  workflowChoices: (space: SpaceKind) => request<{ choices: WorkflowChoice[] }>('GET', `connections/workflow-choices?space=${space}`),
  createWorkflow: (input: unknown) => request<ConnectionWorkflow>('POST', 'connections/workflows/create', input),
  reviewWorkflow: (space: SpaceKind, workflow: ConnectionWorkflow) => request<ConnectionWorkflow>('POST', 'connections/workflows/review', { space, workflowId: workflow.id, expectedRevision: workflow.revision, reviewDigest: workflow.reviewDigest }),
  pauseWorkflow: (space: SpaceKind, workflow: ConnectionWorkflow) => request<ConnectionWorkflow>('POST', 'connections/workflows/pause', { space, workflowId: workflow.id, expectedRevision: workflow.revision }),
};

/** Only an authenticated setup response provides this URL, and the server pins
 * the provider origin. Never put a token or authorization code in the UI. */
export function openConnectionSignIn(url: string): void {
  const destination = new URL(url);
  if (destination.protocol !== 'https:' || destination.username || destination.password) throw new Error('Invalid sign-in destination');
  const app = tg();
  if (app?.initData) app.openLink(destination.href);
  else window.open(destination.href, '_blank', 'noopener,noreferrer');
}
