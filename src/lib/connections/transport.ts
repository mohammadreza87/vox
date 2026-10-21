import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export interface EndpointProfile {
  readonly id: string;
  readonly providerId: string;
  readonly origin: string;
  /** Only an operator-reviewed internal connector may pin private addresses. Never a wire input. */
  readonly internalAddresses?: readonly string[];
}
export interface ProviderCredential {
  readonly providerId: string;
  readonly endpointProfileId: string;
  readonly accessToken: string;
  readonly expiresAt?: number;
}
export interface ProviderHttpRequest {
  readonly profileId: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly maxResponseBytes?: number;
  readonly timeoutMs?: number;
}
export interface ProviderHttpResponse { status: number; headers: Readonly<Record<string, string>>; body: unknown }
export interface ProviderTransport {
  request(request: ProviderHttpRequest, credential: ProviderCredential, signal?: AbortSignal): Promise<ProviderHttpResponse>;
}
/** Contains safe fixed codes only. Raw responses, request headers and network errors never escape. */
export class ProviderError extends Error {
  readonly name = 'ProviderError';
  constructor(readonly code: string, readonly outcome: 'not_dispatched' | 'failed' | 'unknown' = 'failed', readonly retryAfterSeconds?: number) {
    super(code);
  }
}
export const DEFAULT_ENDPOINT_PROFILES: readonly EndpointProfile[] = Object.freeze([
  { id: 'github-api', providerId: 'github', origin: 'https://api.github.com' },
  { id: 'notion-api', providerId: 'notion', origin: 'https://api.notion.com' },
  { id: 'slack-api', providerId: 'slack', origin: 'https://slack.com' },
  { id: 'google-drive-api', providerId: 'google_drive', origin: 'https://www.googleapis.com' },
  { id: 'google-docs-api', providerId: 'google_docs', origin: 'https://docs.googleapis.com' },
  { id: 'google-sheets-api', providerId: 'google_sheets', origin: 'https://sheets.googleapis.com' },
  { id: 'google-slides-api', providerId: 'google_slides', origin: 'https://slides.googleapis.com' },
  { id: 'gmail-api', providerId: 'gmail', origin: 'https://gmail.googleapis.com' },
  { id: 'figma-api', providerId: 'figma', origin: 'https://api.figma.com' },
  { id: 'forgejo-joyixir', providerId: 'forgejo', origin: 'https://git.joyixir.com' },
  { id: 'hetzner-api', providerId: 'hetzner', origin: 'https://api.hetzner.cloud' },
  { id: 'google-analytics-api', providerId: 'google_analytics', origin: 'https://analyticsdata.googleapis.com' },
  { id: 'gamend-mcp', providerId: 'gamend', origin: 'https://gamend.joyixir.com' },
  { id: 'posthog-us', providerId: 'posthog', origin: 'https://us.posthog.com' },
  { id: 'posthog-eu', providerId: 'posthog', origin: 'https://eu.posthog.com' },
]);

/** Fail closed on special-use space, IPv4-embedded IPv6, link local and multicast. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (isIP(address) === 6) {
    // Currently public global-unicast space is 2000::/3. Exclude transition/documentation ranges.
    const lower = address.toLowerCase();
    const pieces = lower.split(':');
    const first = Number.parseInt(pieces[0], 16);
    const second = Number.parseInt(pieces[1] || '0', 16);
    return first >= 0x2000 && first < 0x3fff && first !== 0x2002 && !lower.includes('.') &&
      !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8));
  }
  return false;
}
export interface PinnedRequest {
  url: URL; address: string; family: 4 | 6; method: ProviderHttpRequest['method'];
  headers: Record<string, string>; body?: string; timeoutMs: number; maxResponseBytes: number; signal?: AbortSignal;
}
export interface WireResponse { status: number; headers: Record<string, string>; bytes: Uint8Array }
export type PinnedSender = (request: PinnedRequest) => Promise<WireResponse>;
export type AddressResolver = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

/** HTTPS connects to the resolved checked address, preserving hostname/SNI certificate checks. No DNS rebinding window. */
export const sendPinnedHttps: PinnedSender = input => new Promise((resolve, reject) => {
  const req = httpsRequest(input.url, {
    method: input.method, headers: input.headers, agent: false, signal: input.signal,
    lookup: (_hostname, _options, callback) => callback(null, input.address, input.family),
  }, res => {
    let size = 0;
    const chunks: Buffer[] = [];
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'content-encoding', 'retry-after', 'etag', 'x-request-id', 'x-github-request-id']) {
      const value = res.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    res.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > input.maxResponseBytes) {
        res.destroy(); req.destroy(); reject(new ProviderError('provider_result_too_large', input.method === 'GET' ? 'failed' : 'unknown'));
      } else chunks.push(chunk);
    });
    res.on('end', () => resolve({ status: res.statusCode ?? 502, headers, bytes: Buffer.concat(chunks) }));
    res.on('error', () => reject(new ProviderError('provider_network_error', input.method === 'GET' ? 'failed' : 'unknown')));
  });
  const timer = setTimeout(() => req.destroy(new Error('timeout')), input.timeoutMs);
  req.on('close', () => clearTimeout(timer));
  req.on('error', () => reject(new ProviderError('provider_network_error', input.method === 'GET' ? 'failed' : 'unknown')));
  req.end(input.body);
});

export class SafeProviderTransport implements ProviderTransport {
  private readonly profiles: ReadonlyMap<string, EndpointProfile>;
  constructor(options: { profiles?: readonly EndpointProfile[]; resolve?: AddressResolver; send?: PinnedSender } = {}) {
    const entries = options.profiles ?? DEFAULT_ENDPOINT_PROFILES;
    this.profiles = new Map(entries.map(profile => {
      const url = new URL(profile.origin);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          url.pathname !== '/' || (url.port && url.port !== '443') || !profile.id || !profile.providerId ||
          (profile.internalAddresses && profile.internalAddresses.some(address => !isIP(address)))) throw new ProviderError('endpoint_profile_invalid', 'not_dispatched');
      return [profile.id, Object.freeze({ ...profile, internalAddresses: profile.internalAddresses && Object.freeze([...profile.internalAddresses]) })];
    }));
    if (this.profiles.size !== entries.length) throw new ProviderError('endpoint_profile_invalid', 'not_dispatched');
    this.resolve = options.resolve ?? (hostname => dnsLookup(hostname, { all: true, verbatim: true }));
    this.send = options.send ?? sendPinnedHttps;
  }
  private readonly resolve: AddressResolver;
  private readonly send: PinnedSender;
  async request(input: ProviderHttpRequest, credential: ProviderCredential, signal?: AbortSignal): Promise<ProviderHttpResponse> {
    const profile = this.profiles.get(input.profileId);
    if (!profile || credential.providerId !== profile.providerId || credential.endpointProfileId !== profile.id ||
        !credential.accessToken || credential.accessToken.length > 16000 || /[^\x21-\x7e]/.test(credential.accessToken)) throw new ProviderError('credential_profile_mismatch', 'not_dispatched');
    if (!input.path.startsWith('/') || input.path.startsWith('//') || /[\r\n\\#]/.test(input.path) ||
        /%2e|%2f|%5c/i.test(input.path.split('?')[0]) || input.path.split('?')[0].split('/').includes('..')) throw new ProviderError('provider_path_invalid', 'not_dispatched');
    const url = new URL(input.path, profile.origin);
    if (url.origin !== new URL(profile.origin).origin) throw new ProviderError('provider_origin_denied', 'not_dispatched');
    const headers: Record<string, string> = { accept: 'application/json', 'accept-encoding': 'identity', 'user-agent': 'Vox-Connections/1' };
    const allowed = ['notion-version', 'x-github-api-version', 'if-match', 'mcp-protocol-version', 'mcp-method', 'mcp-name'];
    for (const [name, value] of Object.entries(input.headers ?? {})) {
      if (!allowed.includes(name.toLowerCase()) || /[\r\n]/.test(value) || value.length > 1000) throw new ProviderError('provider_header_denied', 'not_dispatched');
      headers[name.toLowerCase()] = value;
    }
    headers.authorization = `${profile.providerId === 'forgejo' ? 'token' : 'Bearer'} ${credential.accessToken}`;
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body && Buffer.byteLength(body) > 128_000) throw new ProviderError('provider_input_too_large', 'not_dispatched');
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (signal?.aborted) throw new ProviderError('provider_cancelled', 'not_dispatched');
    const timeoutMs = Math.max(100, Math.min(input.timeoutMs ?? 15_000, 30_000));
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const maxResponseBytes = Math.max(1, Math.min(input.maxResponseBytes ?? 256_000, 1_000_000));
    // The total deadline includes DNS resolution. Every advertised answer must be permitted.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const addresses = await this.resolve(url.hostname);
          if (!addresses.length || addresses.some(entry => !isIP(entry.address) ||
            (profile.internalAddresses ? !profile.internalAddresses.includes(entry.address) : !isPublicAddress(entry.address)))) throw new ProviderError('provider_address_denied', 'not_dispatched');
          const first = addresses[0];
          if (controller.signal.aborted) throw new ProviderError('provider_cancelled', 'not_dispatched');
          const response = await this.send({ url, address: first.address, family: isIP(first.address) as 4 | 6,
            method: input.method, headers, body, timeoutMs, maxResponseBytes, signal: controller.signal });
          if (response.bytes.byteLength > maxResponseBytes) throw new ProviderError('provider_result_too_large', input.method === 'GET' ? 'failed' : 'unknown');
          if (response.status >= 300 && response.status < 400) throw new ProviderError('provider_redirect_denied', input.method === 'GET' ? 'failed' : 'unknown');
          if (response.status < 200 || response.status >= 300) {
            const retry = response.headers['retry-after'];
            const seconds = retry && /^\d{1,5}$/.test(retry) ? Math.min(Number(retry), 3600) : undefined;
            throw new ProviderError(response.status === 401 ? 'provider_reauth_required' : response.status === 403 ? 'provider_scope_denied' :
              response.status === 404 ? 'provider_resource_unavailable' : response.status === 429 ? 'provider_rate_limited' :
                response.status === 409 || response.status === 412 ? 'provider_revision_conflict' : 'provider_request_failed',
            response.status >= 500 && input.method !== 'GET' ? 'unknown' : 'failed', seconds);
          }
          if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new ProviderError('provider_encoding_denied', input.method === 'GET' ? 'failed' : 'unknown');
          if (!/^application\/json\b/i.test(response.headers['content-type'] ?? '')) throw new ProviderError('provider_content_type_invalid', input.method === 'GET' ? 'failed' : 'unknown');
          let parsed: unknown;
          try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)); }
          catch { throw new ProviderError('provider_json_invalid', input.method === 'GET' ? 'failed' : 'unknown'); }
          // Return only a revision header. Provider request IDs/error metadata never become arbitrary log strings.
          const safeHeaders: Record<string, string> = {};
          const etag = response.headers.etag;
          if (etag && /^[\x20-\x7e]{1,200}$/.test(etag)) safeHeaders.etag = etag;
          return { status: response.status, headers: safeHeaders, body: parsed };
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError('provider_timeout', input.method === 'GET' ? 'failed' : 'unknown')); }, timeoutMs); }),
      ]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('provider_network_error', input.method === 'GET' ? 'failed' : 'unknown');
    } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
}
