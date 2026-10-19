import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import { sendPinnedHttps, isPublicAddress, type PinnedSender, type AddressResolver, type ProviderTransport } from '../transport';
import { ProviderIdentityQualifier } from './provider-identity';
import { ConnectionsError } from '../errors';
export interface OAuthProfile {
  providerId: string; issuer: string; authorizeUrl: string; tokenUrl: string; revokeUrl?: string;
  clientId: string; clientSecret: string; callbackUrl: string; scopes: readonly string[];
}
export interface VerifiedProviderIdentity { subject: string; tenant: string; displayLabel: string; issuer: string }
export interface OAuthToken { accessToken: string; refreshToken?: string; expiresAt?: number; scopes: string[] }
export interface BrokerIdentityContext { accountId: string; space: 'work' | 'personal'; connectionId: string }
export interface BrokerOAuthTransport {
  exchange(profile: OAuthProfile, code: string, verifier: string): Promise<OAuthToken>;
  refresh(profile: OAuthProfile, refreshToken: string): Promise<OAuthToken>;
  identity(providerId: string, accessToken: string, context?: BrokerIdentityContext): Promise<VerifiedProviderIdentity>;
  revoke(profile: OAuthProfile, accessToken: string): Promise<'verified' | 'unavailable'>;
}
const tokenSchema = z.object({ access_token: z.string().min(1).max(16000), token_type: z.string().optional(),
  refresh_token: z.string().min(1).max(16000).optional(), expires_in: z.number().int().positive().max(31_536_000).optional(), scope: z.string().max(16000).optional() });
const GOOGLE_IDS = ['google_drive', 'google_docs', 'google_sheets', 'google_slides', 'gmail', 'google_analytics'];
/** Pinned, code-owned authorization endpoints; config supplies app identity and approved scopes only. */
export function validateOAuthProfile(profile: OAuthProfile): void {
  const expected = profile.providerId === 'github' ? { issuer: 'https://github.com', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', revoke: undefined } :
    GOOGLE_IDS.includes(profile.providerId) ? { issuer: 'https://accounts.google.com', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke' } : undefined;
  if (!expected || profile.issuer !== expected.issuer || profile.authorizeUrl !== expected.authorize || profile.tokenUrl !== expected.token ||
      profile.revokeUrl !== expected.revoke || !profile.clientId || !profile.clientSecret || profile.scopes.length > 100 ||
      !profile.scopes.length || profile.scopes.some(s => !/^[A-Za-z0-9_.:/-]{1,200}$/.test(s))) throw new ConnectionsError(503, 'oauth_profile_invalid');
  const callback = new URL(profile.callbackUrl);
  if (callback.protocol !== 'https:' || callback.username || callback.password || callback.search || callback.hash ||
      callback.pathname !== `/oauth/callback/${profile.providerId}`) throw new ConnectionsError(503, 'oauth_callback_invalid');
}
export class PinnedOAuthTransport implements BrokerOAuthTransport {
  private readonly send: PinnedSender;
  private readonly resolve: AddressResolver;
  private readonly identityQualifier: ProviderIdentityQualifier;
  private readonly identityQualifierForContext?: (context: BrokerIdentityContext, providerId: string) => Promise<ProviderIdentityQualifier>;
  constructor(options: { send?: PinnedSender; resolve?: AddressResolver; identityTransport?: ProviderTransport; now?: () => number;
    identityQualifierForContext?: (context: BrokerIdentityContext, providerId: string) => Promise<ProviderIdentityQualifier> } = {}) {
    this.send = options.send ?? sendPinnedHttps;
    this.resolve = options.resolve ?? (host => lookup(host, { all: true, verbatim: true }));
    this.identityQualifier = new ProviderIdentityQualifier({ transport: options.identityTransport });
    this.identityQualifierForContext = options.identityQualifierForContext;
    this.now = options.now ?? Date.now;
  }
  private readonly now: () => number;
  private async form(urlString: string, values: Record<string, string>, allowEmpty = false): Promise<unknown> {
    const url = new URL(urlString);
    const addresses = await this.resolve(url.hostname);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new ConnectionsError(502, 'oauth_address_denied');
    const response = await this.send({ url, address: addresses[0].address, family: isIP(addresses[0].address) as 4 | 6,
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', 'accept-encoding': 'identity' },
      body: new URLSearchParams(values).toString(), timeoutMs: 15_000, maxResponseBytes: 100_000, signal: AbortSignal.timeout(15_000) });
    if (response.bytes.byteLength > 100_000) throw new ConnectionsError(502, 'oauth_response_invalid');
    if (response.status < 200 || response.status >= 300 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) throw new ConnectionsError(502, 'oauth_exchange_failed');
    if (allowEmpty && response.bytes.byteLength === 0) return {};
    if (!/^application\/json\b/i.test(response.headers['content-type'] ?? '')) throw new ConnectionsError(502, 'oauth_response_invalid');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)); }
    catch { throw new ConnectionsError(502, 'oauth_response_invalid'); }
  }
  private normalize(raw: unknown, requestedScopes: readonly string[]): OAuthToken {
    const parsed = tokenSchema.safeParse(raw);
    if (!parsed.success || (parsed.data.token_type && parsed.data.token_type.toLowerCase() !== 'bearer')) throw new ConnectionsError(502, 'oauth_token_invalid');
    const scopes = parsed.data.scope?.split(/[ ,]+/).filter(Boolean) ?? [...requestedScopes];
    if (scopes.some(scope => !requestedScopes.includes(scope))) throw new ConnectionsError(403, 'oauth_scope_expansion_denied');
    return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token,
      expiresAt: parsed.data.expires_in ? this.now() + parsed.data.expires_in * 1000 : undefined, scopes };
  }
  async exchange(profile: OAuthProfile, code: string, verifier: string): Promise<OAuthToken> {
    validateOAuthProfile(profile);
    return this.normalize(await this.form(profile.tokenUrl, { grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: profile.clientId, client_secret: profile.clientSecret, redirect_uri: profile.callbackUrl }), profile.scopes);
  }
  async refresh(profile: OAuthProfile, refreshToken: string): Promise<OAuthToken> {
    validateOAuthProfile(profile);
    return this.normalize(await this.form(profile.tokenUrl, { grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: profile.clientId, client_secret: profile.clientSecret }), profile.scopes);
  }
  async identity(providerId: string, accessToken: string, context?: BrokerIdentityContext): Promise<VerifiedProviderIdentity> {
    const qualifier = context && this.identityQualifierForContext ? await this.identityQualifierForContext(context, providerId) : this.identityQualifier;
    return qualifier.identity(providerId, accessToken);
  }
  async revoke(profile: OAuthProfile, accessToken: string): Promise<'verified' | 'unavailable'> {
    validateOAuthProfile(profile);
    if (!profile.revokeUrl) return 'unavailable';
    try { await this.form(profile.revokeUrl, { token: accessToken }, true); return 'verified'; } catch { return 'unavailable'; }
  }
}
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
