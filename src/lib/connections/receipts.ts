import type { ConnectionsSnapshot } from './contracts';
import { listProviderDefinitions } from './catalog';
import type { ReceiptInput, ReceiptKind } from '../studio/receipts';
import { mcpHost } from '../studio/receipts';

/**
 * Settings v2 quiet records for connection changes, from a before/after pair of the person's own snapshot:
 * an account newly connected or disconnected for an agent, an agent's access allowed (with its duration) or
 * ended, an MCP server added or removed. Agent-bound (schema-2) connections only. Content-light by design:
 * a provider label or an MCP host, never an account label, resource, path or id.
 */
export function connectionReceipts(before: ConnectionsSnapshot, after: ConnectionsSnapshot, now = Date.now()): Array<Pick<ReceiptInput, 'agentId' | 'kind' | 'provider' | 'host' | 'hours'>> {
  const labels = new Map(listProviderDefinitions().map(p => [p.id, p.label]));
  const out: Array<Pick<ReceiptInput, 'agentId' | 'kind' | 'provider' | 'host' | 'hours'>> = [];
  const describe = (c: ConnectionsSnapshot['connections'][number]) => c.mcp ? { host: mcpHost(c.mcp.canonicalResourceUri) } : { provider: labels.get(c.providerId) ?? c.providerId };
  for (const c of after.connections) {
    if (!c.agentId) continue;
    const was = before.connections.find(b => b.id === c.id);
    let kind: ReceiptKind | undefined;
    if (c.lifecycle === 'connected' && was?.lifecycle !== 'connected') kind = c.mcp ? 'mcp_added' : 'connected';
    // Only an app or server that was usable (connected or paused) is "removed"; dropping an unfinished setup changes no one's access.
    else if ((c.lifecycle === 'revoked' || c.lifecycle === 'deleted') && (was?.lifecycle === 'connected' || was?.lifecycle === 'paused')) kind = c.mcp ? 'mcp_removed' : 'disconnected';
    if (kind) out.push({ agentId: c.agentId, kind, ...describe(c) });
  }
  for (const g of after.grants) {
    if (g.status !== 'active' || before.grants.some(b => b.id === g.id)) continue;
    const c = after.connections.find(x => x.id === g.connectionId);
    if (!c?.agentId || c.agentId !== g.agentId) continue;
    out.push({ agentId: g.agentId, kind: 'access', hours: Math.max(1, Math.round((g.expiresAt - now) / 3_600_000)), ...describe(c) });
  }
  for (const g of before.grants) {
    // Access that had already run out ended then, not now (e.g. Renew revokes an expired grant first): no record.
    if (g.status !== 'active' || g.expiresAt <= now || after.grants.some(a => a.id === g.id && a.status === 'active')) continue;
    const c = after.connections.find(x => x.id === g.connectionId);
    // A whole disconnect already says so; this is one agent's access ending on a still-connected account.
    if (!c?.agentId || c.agentId !== g.agentId || c.lifecycle !== 'connected') continue;
    out.push({ agentId: g.agentId, kind: 'access_ended', ...describe(c) });
  }
  return out.filter(r => r.provider || r.host);
}
