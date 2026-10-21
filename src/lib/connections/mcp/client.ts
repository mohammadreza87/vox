import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { z } from 'zod';
import { ConnectionsError } from '../errors';
import type { ProviderExecutionContext, ProviderResult } from '../providers/types';
import { ProviderError } from '../transport';
import { MCP_PROTOCOL_VERSION, McpConnectionsCatalog, mcpToolId, snapshotMcpCatalog, type McpCatalogSnapshot } from './catalog';
import { canonicalMcpUrl, McpPublicTransport } from './transport';

function rpcResult(value: unknown, id: string): unknown {
  const parsed = z.object({ jsonrpc: z.literal('2.0'), id: z.literal(id), result: z.unknown().optional(), error: z.unknown().optional() }).strict().safeParse(value);
  if (!parsed.success || !Object.hasOwn(parsed.data, 'result') || Object.hasOwn(parsed.data, 'error')) throw new ConnectionsError(502, 'mcp_rpc_failed');
  return parsed.data.result;
}
/** Buffered SSE exposes no result parts until the broker's final current-authority fence. No automatic reconnect/retry. */
function decodeRpc(bytes: Uint8Array, contentType: string, id: string): unknown {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/^application\/json(?:;|$)/i.test(contentType)) return rpcResult(JSON.parse(text), id);
    if (!/^text\/event-stream(?:;|$)/i.test(contentType)) throw new Error();
    const messages: unknown[] = [];
    for (const event of text.replace(/\r\n/g, '\n').split('\n\n')) {
      const lines = event.split('\n'); const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      if (messages.length >= 100) throw new Error();
      const value = JSON.parse(data) as Record<string, unknown>;
      if (value.method !== undefined && value.id !== undefined) throw new ConnectionsError(502, 'mcp_server_request_unsupported');
      messages.push(value);
    }
    const matching = messages.filter(value => value && typeof value === 'object' && (value as Record<string, unknown>).id === id);
    if (matching.length !== 1) throw new Error();
    return rpcResult(matching[0], id);
  } catch (error) { if (ConnectionsError.is(error)) throw error; throw new ConnectionsError(502, 'mcp_response_unsupported'); }
}
export class McpSession {
  private sessionId?: string;
  private initialized = false;
  readonly resource: string;
  constructor(resource: string, private readonly transport: McpPublicTransport, private readonly accessToken?: string,
    private readonly signal?: AbortSignal, private readonly beforeRequest: () => Promise<void> = async () => undefined,
    private readonly expiresAt?: number) {
    this.resource = canonicalMcpUrl(resource);
    if (accessToken && (!/^[\x21-\x7e]{1,16000}$/.test(accessToken))) throw new ConnectionsError(400, 'mcp_token_invalid');
  }
  private async current(): Promise<void> {
    await this.beforeRequest();
    if (this.signal?.aborted) throw new ConnectionsError(409, 'mcp_cancelled');
    // Signature/issuer are verified at credential admission. Recheck the admitted
    // JWT's clock after every awaited authority/DNS/socket preparation.
    if (this.accessToken) {
      try {
        const claims = decodeJwt(this.accessToken);
        if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now() || this.expiresAt !== undefined && this.expiresAt <= Date.now() ||
            (Array.isArray(claims.aud) ? claims.aud.length !== 1 || claims.aud[0] !== this.resource : claims.aud !== this.resource)) throw Error();
      } catch { throw new ConnectionsError(401, 'mcp_reauth_required'); }
    }
  }
  async rpc(method: string, params: unknown, notification = false): Promise<unknown> {
    await this.current();
    const id = randomUUID(); const headers: Record<string, string> = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    if (this.initialized) headers['mcp-protocol-version'] = MCP_PROTOCOL_VERSION;
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    const response = await this.transport.request({ url: this.resource, method: 'POST', headers, signal: this.signal, beforeSend: () => this.current(),
      body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id } : {}), method, params }) });
    await this.current();
    if (response.status === 401) throw new ConnectionsError(401, 'mcp_reauth_required');
    if (response.status < 200 || response.status >= 300) throw new ConnectionsError(502, 'mcp_request_failed');
    if (notification) { if (response.status !== 202 || response.bytes.byteLength) throw new ConnectionsError(502, 'mcp_notification_failed'); return; }
    const sessionId = response.headers['mcp-session-id'];
    if (sessionId) {
      if (!/^[\x21-\x7e]{1,200}$/.test(sessionId) || (this.sessionId && sessionId !== this.sessionId) || this.accessToken && sessionId.includes(this.accessToken)) throw new ConnectionsError(502, 'mcp_session_invalid');
      this.sessionId = sessionId;
    }
    return decodeRpc(response.bytes, response.headers['content-type'] ?? '', id);
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const result = z.object({ protocolVersion: z.literal(MCP_PROTOCOL_VERSION), capabilities: z.object({ tools: z.record(z.string(), z.unknown()).optional() }).passthrough(), serverInfo: z.object({ name: z.string().max(200), version: z.string().max(100) }).passthrough() }).passthrough().parse(
      await this.rpc('initialize', { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Vox', version: '1.0.0' } }));
    if (!result.capabilities.tools) throw new ConnectionsError(400, 'mcp_tools_unavailable');
    this.initialized = true; await this.rpc('notifications/initialized', {}, true);
  }
  async discover(): Promise<McpCatalogSnapshot> {
    await this.initialize(); const tools: unknown[] = []; let cursor: string | undefined; const cursors = new Set<string>();
    for (let page = 0; page < 5; page++) {
      const list = z.object({ tools: z.array(z.unknown()).max(100), nextCursor: z.string().max(1000).optional(), _meta: z.unknown().optional() }).strict().parse(await this.rpc('tools/list', cursor ? { cursor } : {}));
      tools.push(...list.tools); if (!list.nextCursor) return snapshotMcpCatalog(this.resource, tools);
      if (cursors.has(list.nextCursor)) throw new ConnectionsError(502, 'mcp_catalog_limit');
      cursor = list.nextCursor; cursors.add(cursor);
    }
    throw new ConnectionsError(502, 'mcp_catalog_limit');
  }
}
/** Drop-in BrokerExecutor. It is connection-scoped, verifies the live catalog, and never retries an uncertain effect. */
export class McpBrokerExecutor {
  constructor(private readonly catalog: McpConnectionsCatalog, private readonly transport: McpPublicTransport,
    private readonly assertCurrent: () => Promise<void>) {}
  async execute(toolId: string, rawArguments: unknown, context: ProviderExecutionContext): Promise<ProviderResult> {
    const descriptor = this.catalog.get(toolId); const provider = this.catalog.provider('remote_mcp');
    if (!descriptor || !provider || context.credential.providerId !== 'remote_mcp' || context.credential.endpointProfileId !== provider.endpointProfileId) throw new ProviderError('mcp_binding_mismatch', 'not_dispatched');
    const args = this.catalog.validateArguments(toolId, rawArguments); let dispatched = false;
    try {
      const session = new McpSession(this.catalog.snapshot.resource, this.transport, context.credential.accessToken, context.signal, this.assertCurrent, context.credential.expiresAt);
      const live = await session.discover();
      if (live.catalogDigest !== this.catalog.snapshot.catalogDigest) throw new ConnectionsError(409, 'mcp_catalog_drift');
      await this.assertCurrent(); dispatched = true;
      const result = z.object({ content: z.array(z.unknown()).max(100), structuredContent: z.record(z.string(), z.unknown()).optional(), isError: z.boolean().optional(), _meta: z.unknown().optional() }).strict().parse(
        await session.rpc('tools/call', { name: this.catalog.snapshot.tools.find(tool => mcpToolId(tool.name) === toolId)!.name, arguments: args }));
      await this.assertCurrent();
      if (context.signal?.aborted || result.isError || JSON.stringify(result).includes(context.credential.accessToken)) throw new ConnectionsError(502, 'mcp_result_denied');
      const data: Record<string, unknown> = { content: result.content, ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}) };
      if (Buffer.byteLength(JSON.stringify(data)) > descriptor.maxOutputBytes) throw new ConnectionsError(502, 'mcp_result_limit');
      return { data, resourceIds: [this.catalog.resourceId], providerReceiptRef: null, resourceRevision: this.catalog.snapshot.catalogDigest, untrustedContent: true, truncated: false };
    } catch { throw new ProviderError(dispatched ? 'mcp_outcome_unknown' : 'mcp_preflight_denied', dispatched ? 'unknown' : 'not_dispatched'); }
  }
}
