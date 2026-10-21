import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { ConnectionsError } from '../errors';
import { isPublicAddress, type AddressResolver, type PinnedSender } from '../transport';

/** Deliberately narrow compatibility: canonical public HTTPS DNS names, no query or fragment. */
export function canonicalMcpUrl(input: string): string {
  try {
    if (input.length > 2000 || /[\s\\\u0000-\u001f\u007f]/.test(input)) throw new Error();
    const url = new URL(input);
    if (url.href !== input || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.port || isIP(url.hostname.replace(/^\[|\]$/g, '')) || !url.hostname.includes('.') ||
        !/^[a-z0-9.-]+$/.test(url.hostname) || url.hostname.endsWith('.') ||
        url.hostname.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
        /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname) ||
        /%2e|%2f|%5c|%25/i.test(url.pathname)) throw new Error();
    return url.href;
  } catch { throw new ConnectionsError(400, 'mcp_url_unsupported'); }
}

/** Original URL supplies TLS servername/certificate verification; lookup is replaced with one checked address. */
export type McpPinnedRequest = Parameters<PinnedSender>[0] & { beforeSend?: () => Promise<void> };
export type McpPinnedSender = (input: McpPinnedRequest) => ReturnType<PinnedSender>;
export const sendMcpPinnedHttps: McpPinnedSender = input => new Promise((resolve, reject) => {
  const req = request(input.url, { method: input.method, headers: input.headers, agent: false, signal: input.signal, family: input.family,
    maxHeaderSize: 16_384, lookup: (_name, _options, cb) => cb(null, input.address, input.family) }, response => {
    let size = 0; const chunks: Buffer[] = []; const headers: Record<string, string> = {};
    for (const name of ['content-type', 'content-encoding', 'www-authenticate', 'mcp-session-id']) {
      const value = response.headers[name]; if (typeof value === 'string') headers[name] = value;
    }
    response.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > input.maxResponseBytes) { response.destroy(); req.destroy(); reject(new ConnectionsError(502, 'mcp_body_limit')); }
      else chunks.push(chunk);
    });
    response.on('end', () => resolve({ status: response.statusCode ?? 502, headers, bytes: Buffer.concat(chunks) }));
    response.on('error', () => reject(new ConnectionsError(502, 'mcp_network_failed')));
  });
  const timeout = setTimeout(() => req.destroy(), input.timeoutMs);
  req.on('close', () => clearTimeout(timeout));
  req.on('error', () => reject(new ConnectionsError(502, 'mcp_network_failed')));
  req.on('socket', socket => {
    socket.once('secureConnect', () => {
      void (async () => {
        try { await input.beforeSend?.(); if (input.signal?.aborted) throw new Error(); req.end(input.body); }
        catch { req.destroy(); reject(new ConnectionsError(409, 'mcp_authority_withdrawn')); }
      })();
    });
  });
});
export interface McpHttpInput {
  url: string; method: 'GET' | 'POST'; body?: string; headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal; maxBytes?: number; beforeSend?: () => Promise<void>;
}
/** All destinations, including OAuth metadata/token endpoints, pass the same DNS and redirect fence. */
export class McpPublicTransport {
  constructor(private readonly options: { resolve?: AddressResolver; send?: McpPinnedSender; timeoutMs?: number } = {}) {}
  private async addresses(url: URL) {
    const answers = await (this.options.resolve ?? (host => lookup(host, { all: true, verbatim: true })))(url.hostname);
    if (!answers.length || answers.length > 16 || answers.some(answer => !isPublicAddress(answer.address) || isIP(answer.address) !== answer.family))
      throw new ConnectionsError(400, 'mcp_address_denied');
    return answers;
  }
  async validateDestination(input: string): Promise<void> {
    const url = new URL(canonicalMcpUrl(input));
    await this.bounded(undefined, async () => { await this.addresses(url); });
  }
  private async bounded<T>(signal: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (signal?.aborted) throw new ConnectionsError(409, 'mcp_cancelled');
    const controller = new AbortController(); const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work(controller.signal), new Promise<never>((_resolve, reject) => {
        const fail = () => reject(new ConnectionsError(409, 'mcp_cancelled'));
        controller.signal.addEventListener('abort', fail, { once: true });
        timer = setTimeout(() => { controller.abort(); }, Math.min(this.options.timeoutMs ?? 15_000, 30_000));
      })]);
    } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async request(input: McpHttpInput) {
    const url = new URL(canonicalMcpUrl(input.url)); const maxBytes = Math.min(input.maxBytes ?? 128_000, 256_000);
    if (input.body && Buffer.byteLength(input.body) > 64_000) throw new ConnectionsError(413, 'mcp_input_limit');
    const headers = { accept: 'application/json', 'accept-encoding': 'identity', ...input.headers };
    for (const [key, value] of Object.entries(headers)) if (!['accept', 'accept-encoding', 'content-type', 'authorization', 'mcp-protocol-version', 'mcp-session-id'].includes(key) || !/^[\x20-\x7e]{1,16010}$/.test(value)) throw new ConnectionsError(400, 'mcp_header_denied');
    return this.bounded(input.signal, async signal => {
      const addresses = await this.addresses(url);
      if (signal.aborted) throw new ConnectionsError(409, 'mcp_cancelled');
      await input.beforeSend?.();
      if (signal.aborted) throw new ConnectionsError(409, 'mcp_cancelled');
      let response;
      try { response = await (this.options.send ?? sendMcpPinnedHttps)({ url, address: addresses[0].address,
        family: addresses[0].family as 4 | 6, method: input.method, body: input.body, headers, signal,
        timeoutMs: Math.min(this.options.timeoutMs ?? 15_000, 30_000), maxResponseBytes: maxBytes, beforeSend: input.beforeSend }); }
      catch (error) { if (ConnectionsError.is(error)) throw error; throw new ConnectionsError(502, 'mcp_network_failed'); }
      if (response.bytes.byteLength > maxBytes) throw new ConnectionsError(502, 'mcp_body_limit');
      if (response.status >= 300 && response.status < 400) throw new ConnectionsError(502, 'mcp_redirect_denied');
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') throw new ConnectionsError(502, 'mcp_encoding_denied');
      return response;
    });
  }
  async json(input: McpHttpInput): Promise<{ status: number; value: unknown }> {
    const response = await this.request(input);
    if (response.status === 404) return { status: 404, value: undefined };
    if (!/^application\/json(?:;|$)/i.test(response.headers['content-type'] ?? '')) throw new ConnectionsError(502, 'mcp_json_required');
    try { return { status: response.status, value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)) }; }
    catch { throw new ConnectionsError(502, 'mcp_json_invalid'); }
  }
}
