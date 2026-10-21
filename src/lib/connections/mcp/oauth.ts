import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ConnectionsError } from '../errors';
import { canonicalMcpUrl, McpPublicTransport } from './transport';
import { verifyMcpAccessToken } from './token-verifier';
export function canonicalOAuthIssuer(value: string): string {
  let canonical: string; try { canonical = canonicalMcpUrl(new URL(value).href); } catch { throw new ConnectionsError(400, 'mcp_oauth_issuer_invalid'); }
  if (value.length > 500 || value !== canonical && `${value}/` !== canonical) throw new ConnectionsError(400, 'mcp_oauth_issuer_invalid');
  return value;
}
export interface McpOAuthMetadata {
  resource: string; issuer: string; authorizationEndpoint: string; tokenEndpoint: string;
  scopesSupported: string[]; clientMetadataSupported: boolean; tokenAuthMethods: string[];
  issuerParameterSupported: boolean;
  jwksUri: string;
}
export interface McpRegisteredClient { issuer: string; clientId: string; clientSecret?: string; scopes: readonly string[] }
export interface McpClientConfiguration { registeredClients?: readonly McpRegisteredClient[]; clientMetadataUrl?: string; scopes?: readonly string[] }
export interface McpOAuthClient { clientId: string; clientSecret?: string; scopes: string[]; registration: 'preregistered' | 'client_id_metadata' }
export interface McpOAuthToken { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[];
  verification: { schemaVersion: 1; tokenDigest: string; issuer: string; resource: string; jwksUri: string; expiresAt: number } }
const scope = z.string().min(1).max(200).regex(/^[\x21\x23-\x5b\x5d-\x7e]+$/);
const protectedMetadata = z.object({ resource: z.string().max(2000), authorization_servers: z.array(z.string().max(2000)).min(1).max(8), scopes_supported: z.array(scope).max(100).optional() }).passthrough();
const authMetadata = z.object({ issuer: z.string().max(2000), authorization_endpoint: z.string().max(2000), token_endpoint: z.string().max(2000),
  response_types_supported: z.array(z.string()).max(50), code_challenge_methods_supported: z.array(z.string()).max(20),
  grant_types_supported: z.array(z.string()).max(20).optional(), token_endpoint_auth_methods_supported: z.array(z.string()).max(20).optional(),
  client_id_metadata_document_supported: z.boolean().optional(), authorization_response_iss_parameter_supported: z.boolean().optional(),
  jwks_uri: z.string().max(2000).optional() }).passthrough();
export class McpOAuth {
  constructor(private readonly transport: McpPublicTransport, private readonly now = Date.now) {}
  async discover(resourceInput: string, assertCurrent: () => Promise<void> = async () => undefined): Promise<McpOAuthMetadata> {
    const resource = canonicalMcpUrl(resourceInput); const url = new URL(resource);
    const candidates = [...new Set([`${url.origin}/.well-known/oauth-protected-resource${url.pathname === '/' ? '' : url.pathname}`, `${url.origin}/.well-known/oauth-protected-resource`])];
    let protectedRaw: unknown;
    for (const candidate of candidates) {
      const result = await this.transport.json({ url: candidate, method: 'GET', maxBytes: 32_000, beforeSend: assertCurrent });
      if (result.status === 404) continue;
      if (result.status !== 200) throw new ConnectionsError(400, 'mcp_oauth_metadata_unavailable');
      protectedRaw = result.value; break;
    }
    // RFC 9728 challenge-based metadata may live at a different canonical public HTTPS URL.
    if (!protectedRaw) {
      const challenge = await this.transport.request({ url: resource, method: 'POST', beforeSend: assertCurrent, headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'discovery', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Vox', version: '1.0.0' } } }) });
      const header = challenge.headers['www-authenticate'] ?? '';
      const matches = [...header.matchAll(/(?:^|[,\s])resource_metadata="([^"\\]+)"/g)];
      if (challenge.status !== 401 || !/^Bearer\s/i.test(header) || matches.length !== 1) throw new ConnectionsError(400, 'mcp_oauth_metadata_unavailable');
      const result = await this.transport.json({ url: canonicalMcpUrl(matches[0][1]), method: 'GET', maxBytes: 32_000, beforeSend: assertCurrent });
      if (result.status !== 200) throw new ConnectionsError(400, 'mcp_oauth_metadata_unavailable'); protectedRaw = result.value;
    }
    const protectedResource = protectedMetadata.parse(protectedRaw);
    if (canonicalMcpUrl(protectedResource.resource) !== resource) throw new ConnectionsError(403, 'mcp_oauth_resource_mismatch');
    // Multiple issuers require an explicit issuer choice, never silently select the attacker's first option.
    if (protectedResource.authorization_servers.length !== 1) throw new ConnectionsError(400, 'mcp_oauth_issuer_choice_unsupported');
    const issuer = canonicalOAuthIssuer(protectedResource.authorization_servers[0]); const issuerUrl = new URL(issuer);
    const issuerPath = issuerUrl.pathname === '/' ? '' : issuerUrl.pathname.replace(/\/$/, '');
    const discovery = [...new Set([`${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerPath}`,
      `${issuerUrl.origin}${issuerPath}/.well-known/openid-configuration`, `${issuerUrl.origin}/.well-known/openid-configuration${issuerPath}`])];
    let metadata: z.infer<typeof authMetadata> | undefined;
    for (const target of discovery) {
      const result = await this.transport.json({ url: target, method: 'GET', maxBytes: 32_000, beforeSend: assertCurrent });
      if (result.status === 404) continue;
      if (result.status !== 200) throw new ConnectionsError(400, 'mcp_oauth_discovery_failed');
      metadata = authMetadata.parse(result.value); break;
    }
    if (!metadata || metadata.issuer !== issuer || !metadata.response_types_supported.includes('code') ||
        !metadata.code_challenge_methods_supported.includes('S256') || metadata.grant_types_supported && !metadata.grant_types_supported.includes('authorization_code')) throw new ConnectionsError(400, 'mcp_oauth_protocol_unsupported');
    const authorizationEndpoint = canonicalMcpUrl(metadata.authorization_endpoint); const tokenEndpoint = canonicalMcpUrl(metadata.token_endpoint);
    if (!metadata.jwks_uri) throw new ConnectionsError(400, 'mcp_token_verification_unsupported');
    const jwksUri = canonicalMcpUrl(metadata.jwks_uri);
    await this.transport.validateDestination(authorizationEndpoint); await this.transport.validateDestination(tokenEndpoint);
    await this.transport.validateDestination(jwksUri);
    return { resource, issuer, authorizationEndpoint, tokenEndpoint, scopesSupported: protectedResource.scopes_supported ?? [],
      jwksUri,
      clientMetadataSupported: metadata.client_id_metadata_document_supported === true,
      tokenAuthMethods: metadata.token_endpoint_auth_methods_supported ?? ['client_secret_basic'],
      issuerParameterSupported: metadata.authorization_response_iss_parameter_supported === true };
  }
  selectClient(metadata: McpOAuthMetadata, configuration: McpClientConfiguration): McpOAuthClient {
    const registered = configuration.registeredClients?.filter(client => client.issuer === metadata.issuer) ?? [];
    if (registered.length > 1) throw new ConnectionsError(503, 'mcp_client_configuration_invalid');
    const match = registered[0];
    if (match && (!/^[\x21-\x7e]{1,2000}$/.test(match.clientId) || match.clientSecret && !/^[\x21-\x7e]{1,4000}$/.test(match.clientSecret))) throw new ConnectionsError(503, 'mcp_client_configuration_invalid');
    const result: McpOAuthClient = match ? { clientId: match.clientId, clientSecret: match.clientSecret, scopes: [...match.scopes], registration: 'preregistered' } :
      metadata.clientMetadataSupported && configuration.clientMetadataUrl ? { clientId: canonicalMcpUrl(configuration.clientMetadataUrl), scopes: [...(configuration.scopes ?? [])], registration: 'client_id_metadata' } :
        (() => { throw new ConnectionsError(400, 'mcp_client_registration_unsupported'); })();
    if (!metadata.tokenAuthMethods.includes(result.clientSecret ? 'client_secret_post' : 'none')) throw new ConnectionsError(400, 'mcp_client_auth_unsupported');
    if (result.scopes.length > 100 || result.scopes.some(item => !scope.safeParse(item).success || !metadata.scopesSupported.includes(item))) throw new ConnectionsError(400, 'mcp_scope_unsupported');
    return result;
  }
  authorizationUrl(metadata: McpOAuthMetadata, client: McpOAuthClient, callbackUrl: string, state: string, challenge: string): string {
    const url = new URL(metadata.authorizationEndpoint);
    url.search = new URLSearchParams({ response_type: 'code', client_id: client.clientId, redirect_uri: callbackUrl, resource: metadata.resource,
      state, code_challenge: challenge, code_challenge_method: 'S256', ...(client.scopes.length ? { scope: client.scopes.join(' ') } : {}) }).toString();
    return url.href;
  }
  async token(metadata: McpOAuthMetadata, client: McpOAuthClient, form: Record<string, string>, signal?: AbortSignal, assertCurrent: () => Promise<void> = async () => undefined): Promise<McpOAuthToken> {
    if (!metadata.jwksUri) throw new ConnectionsError(400, 'mcp_token_verification_unsupported');
    const response = await this.transport.json({ url: metadata.tokenEndpoint, method: 'POST', maxBytes: 32_000, signal, beforeSend: assertCurrent,
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form,
        client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}), resource: metadata.resource }).toString() });
    if (response.status !== 200) throw new ConnectionsError(502, 'mcp_oauth_exchange_failed');
    const receivedAt = this.now();
    const token = z.object({ access_token: z.string().regex(/^[\x21-\x7e]{1,16000}$/), refresh_token: z.string().regex(/^[\x21-\x7e]{1,16000}$/).optional(),
      token_type: z.string().refine(value => value.toLowerCase() === 'bearer'), expires_in: z.number().int().min(1).max(31_536_000).optional(), scope: z.string().max(20_000).optional(), resource: z.string().optional() }).passthrough().parse(response.value);
    const scopes = token.scope === undefined ? client.scopes : token.scope.split(' ').filter(Boolean);
    if (scopes.some(item => !client.scopes.includes(item)) || token.resource !== undefined && token.resource !== metadata.resource) throw new ConnectionsError(403, 'mcp_oauth_token_binding_denied');
    const signedExpiresAt = await verifyMcpAccessToken({ accessToken: token.access_token, issuer: metadata.issuer, resource: metadata.resource,
      jwksUri: metadata.jwksUri, scopes, transport: this.transport, now: this.now, signal, assertCurrent });
    return { accessToken: token.access_token, ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
      expiresAt: Math.min(signedExpiresAt, token.expires_in ? receivedAt + token.expires_in * 1000 : signedExpiresAt), scopes: [...scopes],
      verification: { schemaVersion: 1, tokenDigest: createHash('sha256').update(token.access_token).digest('hex'), issuer: metadata.issuer,
        resource: metadata.resource, jwksUri: metadata.jwksUri, expiresAt: signedExpiresAt } };
  }
}
