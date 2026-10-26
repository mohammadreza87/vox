'use client';
import type { AgentConnectionsHandoff } from '@/lib/connections/contracts';
import { ApiError, tg } from './client';

/** One immutable bot route. Never switch a global API base or guess a bot from initDataUnsafe. */
export function createAgentConnectionsApi(agentId: string, signed: string, activeSignal?: AbortSignal | (() => AbortSignal)) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) throw new Error('Invalid agent');
  const root = `/api/agents/${encodeURIComponent(agentId)}/connections`;
  async function call<T>(method: 'GET', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
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
  // The agent-bot surface is a content-free handoff (connections/http.ts answers 404 to everything else): its initData
  // is signed with a token the agent's creator holds (decision 8). Seeing, connecting, access, tasks and approvals live in Vox.
  return {
    read: (signal?: AbortSignal) => call<AgentConnectionsHandoff>('GET', '', undefined, signal),
  };
}
export type AgentConnectionsApi = ReturnType<typeof createAgentConnectionsApi>;
