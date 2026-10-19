import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { brandError } from '../../error-contract';
import { ConnectionsError } from '../errors';
import { BrokerAuthenticator, signBrokerRequest } from '../broker/auth';
import { createConnectionsBrokerServer } from '../broker/server';
import type { ConnectionsBroker } from '../broker/service';

const PRIVATE_CANARY = 'SYNTHETIC_PRIVATE_ERROR_PAYLOAD';
class OtherBundleConnectionsError extends Error {
  readonly name = 'ConnectionsError';
  constructor(readonly status: number, readonly code: string) { super(PRIVATE_CANARY); brandError(this, this.name); }
}

/** Actual HTTP listener with a test-only outer rejection boundary. The old
 * handler can throw while classifying hostile errors; containment converts that
 * rejection to 599 without an unhandled rejection, socket hang or private log. */
async function requestThrowingBroker(thrown: unknown) {
  const execute = vi.fn(async () => { throw thrown; });
  // This error-boundary fixture exercises only execute; no provider/vault methods run.
  const broker = { execute } as unknown as ConnectionsBroker;
  const key = randomBytes(32);
  const server = createConnectionsBrokerServer(broker, new BrokerAuthenticator(key));
  const listener = server.listeners('request')[0] as RequestListener;
  if (typeof listener !== 'function') throw new Error('Missing broker listener');
  server.removeAllListeners('request');
  let rejectedHandlers = 0;
  server.on('request', (incoming, outgoing) => {
    Promise.resolve().then(() => listener(incoming, outgoing)).catch(() => {
      rejectedHandlers++;
      if (!outgoing.headersSent) outgoing.writeHead(599, { 'content-type': 'application/json' });
      if (!outgoing.writableEnded) outgoing.end('{"error":"test_contained_handler_rejection"}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const path = '/v1/execute';
    const raw = JSON.stringify({ actor: { accountId: 'synthetic-account' }, space: 'work', operationId: 'synthetic-operation' });
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
      method: 'POST', body: raw, signal: AbortSignal.timeout(3000),
      headers: { 'content-type': 'application/json', ...signBrokerRequest(key, 'POST', path, raw) },
    });
    const text = await response.text();
    return { status: response.status, text, rejectedHandlers, calls: execute.mock.calls.length };
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
function expectSafeResponse(result: Awaited<ReturnType<typeof requestThrowingBroker>>, status: number, code: string) {
  // Boolean checks avoid printing private payloads even when running the red baseline.
  expect(result.text.includes(PRIVATE_CANARY)).toBe(false);
  expect(result.rejectedHandlers).toBe(0);
  expect(result.calls).toBe(1);
  expect(result.status).toBe(status);
  expect(JSON.parse(result.text)).toEqual({ error: code });
}

describe('broker HTTP safe error classification', () => {
  it('preserves a legitimate Zod validation failure as a generic 400', async () => {
    const result = z.object({ [PRIVATE_CANARY]: z.string() }).safeParse({});
    if (result.success) throw new Error('Fixture must fail validation');
    expectSafeResponse(await requestThrowingBroker(result.error), 400, 'broker_input_invalid');
  });

  it('preserves a legitimate domain 409 from another route bundle', async () => {
    const thrown = new OtherBundleConnectionsError(409, 'revision_conflict');
    expect(thrown instanceof ConnectionsError).toBe(false);
    expectSafeResponse(await requestThrowingBroker(thrown), 409, 'revision_conflict');
  });

  it('preserves the existing local domain status and safe code', async () => {
    expectSafeResponse(await requestThrowingBroker(new ConnectionsError(403, 'grant_denied')), 403, 'grant_denied');
  });

  it.each([new Error(PRIVATE_CANARY), { name: 'ConnectionsError', status: 409, code: 'revision_conflict', private: PRIVATE_CANARY }, null])
  ('fails closed on unknown thrown value #%#', async thrown => {
    expectSafeResponse(await requestThrowingBroker(thrown), 500, 'broker_internal_error');
  });

  it('never reads public error-code accessors, even on an otherwise legitimate branded error', async () => {
    let getterReads = 0;
    const thrown = new ConnectionsError(409, 'revision_conflict');
    Object.defineProperty(thrown, 'code', { get() { getterReads++; return PRIVATE_CANARY; } });
    const result = await requestThrowingBroker(thrown);
    expect(getterReads).toBe(0);
    expectSafeResponse(result, 500, 'broker_internal_error');
  });

  it('never invokes Zod metadata accessors during classification', async () => {
    let getterReads = 0;
    const thrown = new Error(PRIVATE_CANARY);
    Object.defineProperty(thrown, '_zod', { get() { getterReads++; throw new Error(PRIVATE_CANARY); } });
    const result = await requestThrowingBroker(thrown);
    expect(getterReads).toBe(0);
    expectSafeResponse(result, 500, 'broker_internal_error');
  });

  it('never enters proxy traps while handling a thrown proxy', async () => {
    let proxyTraps = 0;
    const trap = () => { proxyTraps++; throw new Error(PRIVATE_CANARY); };
    const thrown = new Proxy(new Error(PRIVATE_CANARY), { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap });
    const result = await requestThrowingBroker(thrown);
    expect(proxyTraps).toBe(0);
    expectSafeResponse(result, 500, 'broker_internal_error');
  });

  it('fails closed on a revoked proxy without rejecting the async HTTP handler', async () => {
    const { proxy, revoke } = Proxy.revocable(new Error(PRIVATE_CANARY), {}); revoke();
    expectSafeResponse(await requestThrowingBroker(proxy), 500, 'broker_internal_error');
  });
});
