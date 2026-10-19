import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { ConnectionsError } from '../errors';
import { BrokerAuthenticator } from './auth';
import type { ConnectionsBroker } from './service';
function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Buffer> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += data.length; if (bytes > 350_000) throw new ConnectionsError(413, 'broker_body_limit'); chunks.push(data);
  }
  return Buffer.concat(chunks);
}
/** Independent broker server. Caller provides already-validated UID, filesystem and provider configuration. */
export function createConnectionsBrokerServer(broker: ConnectionsBroker, authenticator: BrokerAuthenticator): Server {
  return createServer(async (request, response) => {
    try {
      const path = request.url ?? '';
      const webhook = /^\/webhooks\/(github|slack)\/([A-Za-z0-9-]{36})$/.exec(path);
      if (request.method === 'POST' && webhook) {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new ConnectionsError(415, 'event_content_type_invalid');
        const raw = await body(request);
        const safeHeaders: Record<string, string | undefined> = {};
        for (const name of ['x-hub-signature-256', 'x-github-delivery', 'x-github-event', 'x-slack-request-timestamp', 'x-slack-signature'])
          safeHeaders[name] = typeof request.headers[name] === 'string' ? request.headers[name] as string : undefined;
        reply(response, 200, await broker.receiveEvent(webhook[1], webhook[2], raw, safeHeaders)); return;
      }
      const callback = /^\/oauth\/callback\/([a-z_]+)\?/.exec(path);
      if (request.method === 'GET' && callback) {
        const url = new URL(path, 'http://127.0.0.1');
        const query: Record<string, string> = {};
        for (const [key, value] of url.searchParams) { if (key in query) throw new ConnectionsError(400, 'oauth_query_invalid'); query[key] = value; }
        reply(response, 200, await broker.callback(callback[1], query)); return;
      }
      if (request.method !== 'POST' || !['/v1/enrollments', '/v1/enrollments/claim', '/v1/enrollments/cancel', '/v1/execute', '/v1/revoke', '/v1/invalidate'].includes(path)) {
        reply(response, 404, { error: 'broker_route_unavailable' }); return;
      }
      if (request.headers['content-type'] !== 'application/json') throw new ConnectionsError(415, 'broker_content_type_invalid');
      const raw = (await body(request)).toString('utf8');
      authenticator.verify('POST', path, raw, { 'x-vox-timestamp': typeof request.headers['x-vox-timestamp'] === 'string' ? request.headers['x-vox-timestamp'] : undefined,
        'x-vox-nonce': typeof request.headers['x-vox-nonce'] === 'string' ? request.headers['x-vox-nonce'] : undefined,
        'x-vox-signature': typeof request.headers['x-vox-signature'] === 'string' ? request.headers['x-vox-signature'] : undefined });
      let input: unknown; try { input = JSON.parse(raw); } catch { throw new ConnectionsError(400, 'broker_json_invalid'); }
      const result = path === '/v1/enrollments' ? await broker.beginSetup(input) : path === '/v1/enrollments/claim' ? await broker.claimSetup(input) :
        path === '/v1/enrollments/cancel' ? await broker.cancelSetup(input) : path === '/v1/execute' ? await broker.execute(input) : path === '/v1/invalidate' ? await broker.invalidate(input) : await broker.revoke(input);
      reply(response, 200, result);
    } catch (error) {
      const status = error instanceof ConnectionsError ? error.status : error instanceof ZodError ? 400 : 500;
      const code = error instanceof ConnectionsError ? error.code : error instanceof ZodError ? 'broker_input_invalid' : 'broker_internal_error';
      reply(response, status, { error: code });
    }
  });
}
