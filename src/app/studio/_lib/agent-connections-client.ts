'use client';
import type { ConnectionsDashboard, ConnectionResourceView, SetupReceipt, ConnectionExecutionResult, McpSetupPreview } from '@/lib/connections/application';
import type { GrantInput, ConnectionsSnapshot, OperationReceipt, SpaceKind } from '@/lib/connections/contracts';
import type { ConnectionTaskInput, ConnectionTaskResult } from '@/lib/connections/task-runtime';
import { ApiError, tg } from './client';

/** One immutable bot route. Never switch a global API base or guess a bot from initDataUnsafe. */
export function createAgentConnectionsApi(agentId: string, signed: string, activeSignal?: AbortSignal | (() => AbortSignal)) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) throw new Error('Invalid agent');
  const root = `/api/agents/${encodeURIComponent(agentId)}/connections`;
  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    signal ??= typeof activeSignal === 'function' ? activeSignal() : activeSignal;
    if (signal?.aborted || !signed || tg()?.initData !== signed) throw new ApiError(401, 'authentication_required');
    const res = await fetch(`${root}${path ? `${path.startsWith('?') ? '' : '/'}${path}` : ''}`, { method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-Telegram-Init-Data': signed, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal });
    if (tg()?.initData !== signed || signal?.aborted) throw new ApiError(401, 'authentication_required');
    const type = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new ApiError(503, 'connections_unavailable');
    const data = await res.json();
    if (tg()?.initData !== signed || signal?.aborted) throw new ApiError(401, 'authentication_required');
    if (!res.ok) throw new ApiError(res.status, typeof data?.error === 'string' ? data.error : 'connections_unavailable');
    return data as T;
  }
  return {
    read: (space: SpaceKind, signal?: AbortSignal) => call<ConnectionsDashboard>('GET', `?space=${space}`, undefined, signal),
    confirm: (space: SpaceKind) => call<{ confirmed: true }>('POST', `profile/confirm?space=${space}`, { confirm: true }),
    enroll: (space: SpaceKind, providerId: string, displayLabel: string) => call<ConnectionsSnapshot>('POST', 'enroll', { space, providerId, displayLabel, agentId }),
    mcpPreview: (space: SpaceKind, flowId: string) => call<McpSetupPreview>('POST', 'mcp/setup/preview', { space, flowId }),
    mcpClaim: (space: SpaceKind, flowId: string, acceptedCatalogDigest: string) => call<SetupReceipt>('POST', 'mcp/setup/claim', { space, flowId, acceptedCatalogDigest }),
    mcpCancel: (space: SpaceKind, flowId: string) => call<SetupReceipt>('POST', 'mcp/setup/cancel', { space, flowId }),
    mcpEnroll: (space: SpaceKind, endpointUrl: string, displayLabel: string) => call<ConnectionsSnapshot>('POST', 'mcp/enroll', { space, agentId, endpointUrl, displayLabel }),
    resources: (space: SpaceKind, connectionId: string) => call<{ resources: ConnectionResourceView[] }>('GET', `resources/${encodeURIComponent(connectionId)}?space=${space}`),
    setup: (space: SpaceKind, connectionId: string) => call<SetupReceipt>('POST', 'setup', { space, connectionId }),
    claim: (space: SpaceKind, flowId: string) => call<SetupReceipt>('POST', 'setup/claim', { space, flowId }),
    cancelSetup: (space: SpaceKind, flowId: string) => call<SetupReceipt>('POST', 'setup/cancel', { space, flowId }),
    grant: (input: Omit<GrantInput, 'agentId'>) => call<ConnectionsSnapshot>('POST', 'grants', { ...input, agentId }),
    revoke: (space: SpaceKind, connectionId: string, expectedRevision: number, grantId?: string, expectedGrantRevision?: number) => call<ConnectionsSnapshot>('POST', 'revoke', { space, connectionId, expectedRevision, ...(grantId ? { grantId, expectedGrantRevision } : {}) }),
    task: (input: Omit<ConnectionTaskInput, 'agentId'>) => call<ConnectionTaskResult>('POST', 'tasks', { ...input, agentId }),
    review: (space: SpaceKind, operation: OperationReceipt) => call<{ receipt: OperationReceipt; arguments: Record<string, unknown> }>('GET', `review/${encodeURIComponent(operation.operationId)}?space=${space}&revision=${operation.revision}`),
    approve: (space: SpaceKind, operation: OperationReceipt) => call<OperationReceipt>('POST', 'actions/approve', { space, operationId: operation.operationId, expectedRevision: operation.revision, proposalDigest: operation.proposalDigest }),
    execute: (space: SpaceKind, operationId: string) => call<ConnectionExecutionResult>('POST', 'actions/execute', { space, operationId }),
  };
}
export type AgentConnectionsApi = ReturnType<typeof createAgentConnectionsApi>;
