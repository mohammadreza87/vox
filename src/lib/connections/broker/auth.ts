import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ConnectionsError } from '../errors';
export interface BrokerAuthHeaders { 'x-vox-timestamp': string; 'x-vox-nonce': string; 'x-vox-signature': string }
const signed = (method: string, path: string, body: string, timestamp: string, nonce: string) =>
  `${timestamp}\n${nonce}\n${method}\n${path}\n${createHash('sha256').update(body).digest('hex')}`;
export function signBrokerRequest(key: Uint8Array, method: string, path: string, body: string, now = Date.now()): BrokerAuthHeaders {
  const timestamp = String(now); const nonce = randomUUID();
  return { 'x-vox-timestamp': timestamp, 'x-vox-nonce': nonce,
    'x-vox-signature': createHmac('sha256', key).update(signed(method, path, body, timestamp, nonce)).digest('hex') };
}
export class BrokerAuthenticator {
  private readonly seen = new Map<string, number>();
  constructor(private readonly key: Uint8Array, private readonly now: () => number = Date.now) {
    if (key.byteLength < 32) throw new ConnectionsError(503, 'broker_auth_key_invalid');
  }
  verify(method: string, path: string, body: string, headers: Headers | Record<string, string | undefined>): void {
    const get = (key: string) => headers instanceof Headers ? headers.get(key) ?? undefined : headers[key];
    const timestamp = get('x-vox-timestamp'); const nonce = get('x-vox-nonce'); const signature = get('x-vox-signature');
    const now = this.now();
    for (const [id, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(id);
    if (!timestamp || !/^\d{1,16}$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp)) || Math.abs(Number(timestamp) - now) > 60_000 ||
        !nonce || !/^[0-9a-f-]{36}$/.test(nonce) || this.seen.has(nonce) || !signature || !/^[0-9a-f]{64}$/.test(signature) || this.seen.size >= 10_000) throw new ConnectionsError(401, 'broker_auth_denied');
    const expected = createHmac('sha256', this.key).update(signed(method, path, body, timestamp, nonce)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new ConnectionsError(401, 'broker_auth_denied');
    this.seen.set(nonce, now + 120_000);
  }
}
export interface BrokerJsonClient { call<T>(path: string, input: unknown): Promise<T> }
/** Loopback HTTP only. No redirects, ambient proxy/cookies or arbitrary paths. */
export class AuthenticatedBrokerClient implements BrokerJsonClient {
  private readonly origin: URL;
  constructor(origin: string, private readonly key: Uint8Array, private readonly allowedPaths: readonly string[],
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    this.origin = new URL(origin);
    if (this.origin.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(this.origin.hostname) || this.origin.username || this.origin.password ||
        this.origin.pathname !== '/' || this.origin.search || this.origin.hash) throw new ConnectionsError(503, 'broker_origin_invalid');
  }
  async call<T>(path: string, input: unknown): Promise<T> {
    if (!this.allowedPaths.includes(path)) throw new ConnectionsError(400, 'broker_path_denied');
    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > 350_000) throw new ConnectionsError(413, 'broker_body_limit');
    const response = await this.fetcher(new URL(path, this.origin), { method: 'POST', body, redirect: 'error',
      headers: { ...signBrokerRequest(this.key, 'POST', path, body, this.now()), 'content-type': 'application/json' }, signal: AbortSignal.timeout(65_000) });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 400_000) throw new ConnectionsError(502, 'broker_response_limit');
    const parsed: unknown = JSON.parse(raw);
    if (!response.ok) {
      const code = parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string' && /^[a-z_]{1,100}$/.test(parsed.error) ? parsed.error : 'broker_request_failed';
      throw new ConnectionsError(response.status, code);
    }
    return parsed as T;
  }
}
