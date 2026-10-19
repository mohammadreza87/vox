import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SafeProviderTransport, ProviderError, type EndpointProfile, type ProviderTransport, type ProviderHttpRequest } from '../transport';
import { cleanText } from '../providers/normalization';
import type { VerifiedProviderIdentity } from './oauth';
const GOOGLE = ['google_drive', 'google_docs', 'google_sheets', 'google_slides', 'gmail', 'google_analytics'] as const;
const uid = z.string().uuid().transform(value => value.toLowerCase());
const positive = z.number().int().positive().safe();
const identifier = z.union([z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:@/-]+$/), positive.transform(String)]);
const label = z.string().max(1000).nullable().optional();
const numString = z.string().regex(/^[1-9]\d{0,15}$/);
export const PROVIDER_IDENTITY_PROFILES: readonly EndpointProfile[] = Object.freeze([
  { id: 'github-identity', providerId: 'github', origin: 'https://api.github.com' },
  { id: 'forgejo-identity', providerId: 'forgejo', origin: 'https://git.joyixir.com' },
  { id: 'notion-identity', providerId: 'notion', origin: 'https://api.notion.com' },
  { id: 'slack-identity', providerId: 'slack', origin: 'https://slack.com' },
  { id: 'figma-identity', providerId: 'figma', origin: 'https://api.figma.com' },
  { id: 'hetzner-identity', providerId: 'hetzner', origin: 'https://api.hetzner.cloud' },
  { id: 'posthog-us-identity', providerId: 'posthog', origin: 'https://us.posthog.com' },
  { id: 'posthog-eu-identity', providerId: 'posthog', origin: 'https://eu.posthog.com' },
  { id: 'gamend-identity', providerId: 'gamend', origin: 'https://gamend.joyixir.com' },
  ...GOOGLE.map(providerId => ({ id: `${providerId}-identity`, providerId, origin: 'https://openidconnect.googleapis.com' })),
]);
export type IdentityAdmission =
  | { providerId: 'github'; kind: 'user' }
  | { providerId: 'github'; kind: 'credential_resource'; repositories: readonly { owner: string; repository: string }[] }
  | { providerId: 'hetzner'; kind: 'credential_resource'; serverIds: readonly number[] }
  | { providerId: 'posthog'; kind: 'user_project'; region: 'us' | 'eu'; projectId: string }
  | { providerId: 'posthog'; kind: 'credential_resource'; region: 'us' | 'eu'; projectId: string; insightIds: readonly string[] }
  | { providerId: 'gamend'; kind: 'native_delegation'; orgId: string; gameId: string; envId: string };
const repoName = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/);
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
export const identityAdmissionSchema = z.union([
  z.object({ providerId: z.literal('github'), kind: z.literal('user') }).strict(),
  z.object({ providerId: z.literal('github'), kind: z.literal('credential_resource'), repositories: z.array(z.object({ owner: repoName, repository: repoName }).strict()).min(1).max(10) }).strict(),
  z.object({ providerId: z.literal('hetzner'), kind: z.literal('credential_resource'), serverIds: z.array(positive).min(1).max(10).refine(unique) }).strict(),
  z.object({ providerId: z.literal('posthog'), kind: z.literal('user_project'), region: z.enum(['us', 'eu']), projectId: numString }).strict(),
  z.object({ providerId: z.literal('posthog'), kind: z.literal('credential_resource'), region: z.enum(['us', 'eu']), projectId: numString, insightIds: z.array(numString).min(1).max(10).refine(unique) }).strict(),
  z.object({ providerId: z.literal('gamend'), kind: z.literal('native_delegation'), orgId: uid, gameId: uid, envId: uid }).strict(),
]);
export interface ProviderIdentityEvidence {
  identityKind: 'provider_user' | 'integration_bot' | 'native_delegation' | 'credential_resource';
  providerSubjectVerified: boolean;
  providerTenantVerified: boolean;
  /** Only API-returned scope information belongs here. Operator assertions are not verified scopes. */
  verifiedScopes: readonly string[] | null;
  permittedNativeOperationIds: readonly string[] | null;
  resourceAccess: readonly string[];
  writeCapability: 'unavailable';
  limitations: readonly string[];
}
export interface ProviderIdentityQualification { identity: VerifiedProviderIdentity; evidence: ProviderIdentityEvidence }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ProviderError('provider_identity_invalid');
  return parsed.data;
}
function safeLabel(value: string | null | undefined, fallback: string): string { return cleanText(value ?? '', 160).trim() || fallback; }
const fingerprint = (token: string): string => createHash('sha256').update(token).digest('hex');
const userEvidence = (resources: readonly string[] = [], limitations: readonly string[] = []): ProviderIdentityEvidence => ({ identityKind: 'provider_user', providerSubjectVerified: true, providerTenantVerified: true, verifiedScopes: null, permittedNativeOperationIds: null, resourceAccess: resources, writeCapability: 'unavailable', limitations: ['Identity authentication does not grant resource or action authority.', ...limitations] });
const resourceEvidence = (resources: readonly string[], tenantVerified: boolean): ProviderIdentityEvidence => ({ identityKind: 'credential_resource', providerSubjectVerified: false, providerTenantVerified: tenantVerified, verifiedScopes: null, permittedNativeOperationIds: null, resourceAccess: resources, writeCapability: 'unavailable', limitations: ['Credential fingerprint is not a provider person, account, project or installation identity.', 'Successful resource reads do not prove write permission, provider OAuth scopes or a Vox resource grant.'] });
/** Server-only identity qualification; provider labels and user-declared IDs never become authority. */
export class ProviderIdentityQualifier {
  private readonly transport: ProviderTransport;
  private readonly admissions: ReadonlyMap<string, IdentityAdmission>;
  private readonly now: () => number;
  constructor(options: { transport?: ProviderTransport; admissions?: readonly IdentityAdmission[]; now?: () => number } = {}) {
    this.transport = options.transport ?? new SafeProviderTransport({ profiles: PROVIDER_IDENTITY_PROFILES });
    this.now = options.now ?? Date.now;
    this.admissions = new Map((options.admissions ?? []).map(input => {
      const admission = parse(identityAdmissionSchema, input);
      if ('repositories' in admission) admission.repositories.forEach(Object.freeze);
      for (const value of Object.values(admission)) if (Array.isArray(value)) Object.freeze(value);
      return [admission.providerId, Object.freeze(admission) as IdentityAdmission];
    }));
    if (this.admissions.size !== (options.admissions ?? []).length) throw new ProviderError('provider_identity_admission_invalid', 'not_dispatched');
  }
  private async request(providerId: string, token: string, input: Omit<ProviderHttpRequest, 'profileId'>, profileId = `${providerId}-identity`, signal?: AbortSignal): Promise<unknown> {
    if (!PROVIDER_IDENTITY_PROFILES.some(profile => profile.id === profileId && profile.providerId === providerId)) throw new ProviderError('provider_identity_unavailable', 'not_dispatched');
    const response = await this.transport.request({ ...input, profileId, maxResponseBytes: 128000, timeoutMs: 10000 }, { providerId, endpointProfileId: profileId, accessToken: token }, signal);
    return response.body;
  }
  async identity(providerId: string, token: string, signal?: AbortSignal): Promise<VerifiedProviderIdentity> { return (await this.qualify(providerId, token, signal)).identity; }
  async qualify(providerId: string, token: string, signal?: AbortSignal): Promise<ProviderIdentityQualification> {
    if (!token || token.length > 16000 || /[^\x21-\x7e]/.test(token)) throw new ProviderError('provider_credential_invalid', 'not_dispatched');
    try {
      const result = await this.qualifyInternal(providerId, token, signal);
      if (JSON.stringify(result).includes(token)) throw new ProviderError('provider_identity_invalid');
      return result;
    } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError('provider_identity_invalid'); }
  }
  private async qualifyInternal(providerId: string, token: string, signal?: AbortSignal): Promise<ProviderIdentityQualification> {
    const admission = this.admissions.get(providerId);
    if ((GOOGLE as readonly string[]).includes(providerId)) {
      const data = parse(z.object({ sub: identifier, name: label }), await this.request(providerId, token, { method: 'GET', path: '/v1/userinfo' }, undefined, signal));
      return { identity: { subject: data.sub, tenant: data.sub, displayLabel: safeLabel(data.name, 'Google account'), issuer: 'https://accounts.google.com' }, evidence: userEvidence([], ['Google hosted-domain/email labels are not used as tenant identity.']) };
    }
    if (providerId === 'github' && admission?.kind !== 'credential_resource') {
      const data = parse(z.object({ id: positive, login: z.string().min(1).max(100), name: label }), await this.request(providerId, token, { method: 'GET', path: '/user', headers: { 'x-github-api-version': '2026-03-10' } }, undefined, signal));
      return { identity: { subject: String(data.id), tenant: String(data.id), displayLabel: safeLabel(data.name ?? data.login, 'GitHub account'), issuer: 'https://github.com' }, evidence: userEvidence([], ['User identity does not qualify a GitHub App installation or repository permission.']) };
    }
    if (providerId === 'github' && admission?.providerId === 'github' && admission.kind === 'credential_resource') {
      let ownerId: number | undefined; const resources: string[] = [];
      for (const repository of admission.repositories) {
        const data = parse(z.object({ id: positive, full_name: z.string(), owner: z.object({ id: positive }) }), await this.request(providerId, token, { method: 'GET', path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repository)}`, headers: { 'x-github-api-version': '2026-03-10' } }, undefined, signal));
        if (data.full_name.toLowerCase() !== `${repository.owner}/${repository.repository}`.toLowerCase() || (ownerId && ownerId !== data.owner.id)) throw new ProviderError('provider_identity_scope_mismatch');
        ownerId = data.owner.id; resources.push(`github:repo:${data.full_name.toLowerCase()}`);
      }
      return { identity: { subject: `credential:${fingerprint(token)}`, tenant: `repository_owner:${ownerId}`, displayLabel: 'GitHub repository credential (installation ID unavailable)', issuer: 'https://github.com' }, evidence: resourceEvidence(resources, true) };
    }
    if (providerId === 'forgejo') {
      const data = parse(z.object({ id: positive, login: z.string().min(1).max(100), full_name: label }), await this.request(providerId, token, { method: 'GET', path: '/api/v1/user' }, undefined, signal));
      return { identity: { subject: String(data.id), tenant: String(data.id), displayLabel: safeLabel(data.full_name ?? data.login, 'Forgejo account'), issuer: 'https://git.joyixir.com' }, evidence: userEvidence([], ['Instance version and token restrictions remain separately unverified.']) };
    }
    if (providerId === 'notion') {
      const data = parse(z.object({ object: z.literal('user'), id: uid, type: z.literal('bot'), name: label, bot: z.object({ workspace_id: uid, workspace_name: label }) }), await this.request(providerId, token, { method: 'GET', path: '/v1/users/me', headers: { 'notion-version': '2026-03-11' } }, undefined, signal));
      return { identity: { subject: data.id, tenant: data.bot.workspace_id, displayLabel: safeLabel(data.name, 'Notion integration'), issuer: 'https://www.notion.so' }, evidence: { ...userEvidence([], ['The verified subject is the integration bot; the owner person is not inferred.', 'Workspace names are labels; only bot.workspace_id identifies the workspace.']), identityKind: 'integration_bot' } };
    }
    if (providerId === 'slack') {
      const data = parse(z.object({ ok: z.literal(true), user_id: z.string().regex(/^[UW][A-Z0-9]{8,20}$/), team_id: z.string().regex(/^T[A-Z0-9]{8,20}$/), user: label, team: label }), await this.request(providerId, token, { method: 'POST', path: '/api/auth.test', body: {} }, undefined, signal));
      return { identity: { subject: data.user_id, tenant: data.team_id, displayLabel: safeLabel(data.user, 'Slack token user'), issuer: 'https://slack.com' }, evidence: userEvidence([], ['Bot/user token type, channel membership, installation governance and scopes are separate qualifications.']) };
    }
    if (providerId === 'figma') {
      const data = parse(z.object({ id: identifier, handle: label }), await this.request(providerId, token, { method: 'GET', path: '/v1/me' }, undefined, signal));
      return { identity: { subject: data.id, tenant: data.id, displayLabel: safeLabel(data.handle, 'Figma account'), issuer: 'https://www.figma.com' }, evidence: userEvidence([], ['The user identity does not prove seat, plan, file-content scope or canvas-write entitlement.']) };
    }
    if (providerId === 'hetzner') {
      if (!admission || admission.providerId !== 'hetzner' || admission.kind !== 'credential_resource') throw new ProviderError('provider_identity_admission_required', 'not_dispatched');
      const resources: string[] = [];
      for (const serverId of admission.serverIds) {
        parse(z.object({ server: z.object({ id: z.literal(serverId) }) }), await this.request(providerId, token, { method: 'GET', path: `/v1/servers/${serverId}` }, undefined, signal));
        resources.push(`hetzner:server:${serverId}`);
      }
      const bound = fingerprint(token);
      return { identity: { subject: `credential:${bound}`, tenant: `credential_scope:${bound}`, displayLabel: 'Hetzner credential (account and project ID unavailable)', issuer: 'https://api.hetzner.cloud' }, evidence: resourceEvidence(resources, false) };
    }
    if (providerId === 'posthog') {
      if (!admission || admission.providerId !== 'posthog') throw new ProviderError('provider_identity_admission_required', 'not_dispatched');
      const profile = `posthog-${admission.region}-identity`; const issuer = `https://${admission.region}.posthog.com`;
      if (admission.kind === 'user_project') {
        const user = parse(z.object({ uuid: uid, first_name: label, last_name: label, is_impersonated: z.boolean().optional() }), await this.request(providerId, token, { method: 'GET', path: '/api/users/@me/' }, profile, signal));
        if (user.is_impersonated) throw new ProviderError('provider_identity_impersonation_denied');
        const project = parse(z.object({ id: positive, organization: uid }), await this.request(providerId, token, { method: 'GET', path: `/api/projects/${admission.projectId}/` }, profile, signal));
        if (String(project.id) !== admission.projectId) throw new ProviderError('provider_identity_scope_mismatch');
        return { identity: { subject: user.uuid, tenant: String(project.id), displayLabel: safeLabel([user.first_name, user.last_name].filter(Boolean).join(' '), 'PostHog account'), issuer }, evidence: userEvidence([`posthog:project:${project.id}`], ['Successful user/project reads verify those capabilities only; insight:read still needs resource-level qualification.']) };
      }
      const resources: string[] = [];
      for (const insightId of admission.insightIds) {
        const insight = parse(z.object({ id: positive }), await this.request(providerId, token, { method: 'GET', path: `/api/projects/${admission.projectId}/insights/${insightId}/` }, profile, signal));
        if (String(insight.id) !== insightId) throw new ProviderError('provider_identity_scope_mismatch');
        resources.push(`posthog:project:${admission.projectId}:insight:${insightId}`);
      }
      return { identity: { subject: `credential:${fingerprint(token)}`, tenant: `project:${admission.projectId}`, displayLabel: 'PostHog insight credential (user identity unavailable)', issuer }, evidence: resourceEvidence(resources, true) };
    }
    if (providerId === 'gamend') {
      if (!admission || admission.providerId !== 'gamend') throw new ProviderError('provider_identity_admission_required', 'not_dispatched');
      const body = await this.request(providerId, token, { method: 'POST', path: '/v1/mcp', headers: { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/call', 'mcp-name': 'gamend_context' }, body: { jsonrpc: '2.0', id: 'vox-identity', method: 'tools/call', params: { name: 'gamend_context', arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'vox-connections', version: '1.0.0' } } } } }, undefined, signal);
      const rpc = parse(z.object({ jsonrpc: z.literal('2.0'), id: z.literal('vox-identity'), result: z.object({ isError: z.literal(false), structuredContent: z.unknown() }) }), body);
      const data = parse(z.object({ organizationId: uid, organization: z.object({ id: uid }), grant: z.object({ id: uid, orgId: uid, ownerAdminId: uid, name: label, gameIds: z.array(uid).max(100).nullable(), environmentIds: z.array(uid).max(100).nullable(), scopes: z.array(z.string().regex(/^[a-z][a-z0-9-]*:(read|write)$/)).max(100), operationIds: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,159}$/)).max(200).nullable(), revokedAt: z.string().nullable(), expiresAt: z.string().datetime() }), games: z.array(z.object({ id: uid })).max(100), environments: z.array(z.object({ id: uid, gameId: uid })).max(1000), protocolVersions: z.array(z.string().max(50)).max(10) }), rpc.result.structuredContent);
      if (data.organizationId !== admission.orgId || data.organization.id !== admission.orgId || data.grant.orgId !== admission.orgId || data.grant.revokedAt !== null || Date.parse(data.grant.expiresAt) <= this.now() || !data.protocolVersions.includes('2026-07-28') || !data.games.some(game => game.id === admission.gameId) || !data.environments.some(env => env.id === admission.envId && env.gameId === admission.gameId) || (data.grant.gameIds && !data.grant.gameIds.includes(admission.gameId)) || (data.grant.environmentIds && !data.grant.environmentIds.includes(admission.envId))) throw new ProviderError('provider_identity_scope_mismatch');
      return { identity: { subject: data.grant.ownerAdminId, tenant: data.grant.orgId, displayLabel: safeLabel(data.grant.name, 'Gamend delegated account'), issuer: 'https://gamend.joyixir.com' }, evidence: { identityKind: 'native_delegation', providerSubjectVerified: true, providerTenantVerified: true, verifiedScopes: data.grant.scopes, permittedNativeOperationIds: data.grant.operationIds, resourceAccess: [`gamend:org:${admission.orgId}:game:${admission.gameId}:env:${admission.envId}`], writeCapability: 'unavailable', limitations: ['Verified native delegation is an upper bound; Vox still requires exact resource/action/audience grants.', 'This adapter exposes only code-reviewed reads even if native grant permits writes.'] } };
    }
    throw new ProviderError(providerId === 'browser' || providerId === 'ssh' ? 'runner_identity_requires_attestation' : 'provider_identity_unavailable', 'not_dispatched');
  }
}
