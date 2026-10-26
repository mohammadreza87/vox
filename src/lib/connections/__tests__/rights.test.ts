import { randomUUID, webcrypto } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpToolId } from '../mcp';
import { partitionIdFor } from '../repository';
import { ERASED_EVENT, erasedAuthority, eraseConnections, exportConnections, retryErasedRevocations, type ConnectionsRightsPort } from '../rights';
import { InMemoryConnectionsStorage } from '../storage';
import { SYNTHETIC_TOKEN, settingsV2Fixture } from './settings-v2-fixture';

const directories: string[] = [];
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('CryptoKey', webcrypto.CryptoKey); vi.stubEnv('STUDIO_SETTINGS_V2', '1'); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

const ACCOUNT = 'telegram-account:123';
/** Every key anywhere in a value (recursively). */
const keysOf = (value: unknown): string[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(keysOf)
  : Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);

/** A connected custom MCP server for "alpha" with live access and one task waiting for review. */
async function connectedWithActivity() {
  const f = await settingsV2Fixture({ directories });
  const done = await f.connect(f.manager, 'alpha');
  const resource = (await done.app.resources(f.manager, 'personal', done.connection.id))[0];
  await done.app.grant!(f.manager, { space: 'personal', agentId: 'alpha', connectionId: done.connection.id, expectedRevision: done.connection.revision,
    toolIds: resource.toolIds, resourceIds: [resource.id], destinationIds: resource.destinationIds, effects: ['privileged'], expiresAt: Date.now() + 3_600_000, maxCalls: 10, maxBytes: 128_000 });
  f.llm.complete.mockResolvedValueOnce(JSON.stringify({ kind: 'tool', toolId: mcpToolId('files.get'), arguments: { id: 'synthetic-own-document' }, expectedTargetRevision: null }));
  const task = await done.app.task!(f.manager, { space: 'personal', agentId: 'alpha', connectionId: done.connection.id, message: 'Read my selected document', requestId: randomUUID() });
  expect(task.status).toBe('review_required');
  const port: ConnectionsRightsPort = { storage: f.storage, revoke: input => f.brokerPort.revoke(input), actorFor: async () => f.manager, log: { warn: vi.fn() } };
  return { f, done, port };
}

describe('rights coverage of connections', () => {
  it('export: the person\'s own records, allowlisted, with no token, secret or verifier anywhere', async () => {
    const { done, port } = await connectedWithActivity();
    const exported = await exportConnections(port, ACCOUNT, 'personal');
    expect(exported).not.toBeNull();
    expect(exported!.connections).toEqual([expect.objectContaining({ id: done.connection.id, providerId: 'remote_mcp', agentId: 'alpha', lifecycle: 'connected',
      mcp: { server: done.connection.mcp!.canonicalResourceUri, tools: ['files.get'] } })]);
    expect(exported!.grants).toHaveLength(1);
    expect(exported!.operations).toEqual([expect.objectContaining({ state: 'needs_approval', agentId: 'alpha' })]);
    expect(exported!.providerAccounts).toHaveLength(1);
    const json = JSON.stringify(exported);
    expect(json).not.toContain(SYNTHETIC_TOKEN);
    expect(keysOf(exported).filter(k => /token|secret|verifier|refresh|secretRef|subject|tenant/i.test(k))).toEqual([]);
    // Nothing for a space with no records.
    expect(await exportConnections(port, ACCOUNT, 'work')).toBeNull();
  });

  it('erasure revokes in the broker vault, then the records go', async () => {
    const { f, done, port } = await connectedWithActivity();
    expect(await f.vault.binding('credential', done.connection.id)).toBeTruthy();
    expect(await eraseConnections(port, ACCOUNT, ['personal', 'work'])).toEqual({ erased: 1, pending: 0 });
    expect(f.brokerPort.revoke).toHaveBeenCalledWith(expect.objectContaining({ connectionId: done.connection.id, providerId: 'remote_mcp', space: 'personal' }));
    expect(await f.vault.binding('credential', done.connection.id)).toBeUndefined();
    const left = await f.storage.peek(partitionIdFor(ACCOUNT, 'personal'));
    for (const [name, rows] of Object.entries(left)) expect(rows, name).toEqual([]);
  });

  it('a broker failure keeps the connection revoked (no further use) and marked; a confirmed Connections load finishes it', async () => {
    const { f, done, port } = await connectedWithActivity();
    const failing: ConnectionsRightsPort = { ...port, revoke: async () => { throw new Error('broker down'); } };
    expect(await eraseConnections(failing, ACCOUNT, ['personal'])).toEqual({ erased: 1, pending: 1 });
    expect(failing.log!.warn).toHaveBeenCalledWith('[studio] connections_revoke_pending');
    const raw = await f.storage.peek(partitionIdFor(ACCOUNT, 'personal'));
    expect(raw.connections).toEqual([expect.objectContaining({ id: done.connection.id, lifecycle: 'revoked', displayLabel: 'Custom MCP', mcp: expect.objectContaining({ catalog: null }) })]);
    expect(raw.grants).toEqual([expect.objectContaining({ status: 'revoked' })]);
    expect(raw.operations).toEqual([expect.objectContaining({ state: 'cancelled', safeReason: 'erased' })]);
    expect(raw.payloads).toEqual([]); expect(raw.approvals).toEqual([]); expect(raw.sources).toEqual([]);
    expect(raw.audits).toEqual([expect.objectContaining({ event: ERASED_EVENT, subjectId: done.connection.id })]);
    expect(raw.tombstones).toEqual([expect.objectContaining({ reason: 'disconnect', providerRevocation: 'pending' })]);
    // The broker refuses any use of a revoked connection.
    await expect(done.app.resources(f.manager, 'personal', done.connection.id)).rejects.toBeTruthy();
    // The next confirmed dashboard load retries the vault revocation and purges.
    const dashboard = await done.app.dashboard(f.manager, 'personal');
    expect(dashboard.connections).toEqual([]);
    expect(await f.vault.binding('credential', done.connection.id)).toBeUndefined();
    expect(await retryErasedRevocations(port, ACCOUNT, 'personal', { force: true })).toBe(0);
  });

  it('never throws, and writes nothing when there is nothing to erase', async () => {
    const storage = new InMemoryConnectionsStorage();
    const transact = vi.spyOn(storage, 'transact');
    const port: ConnectionsRightsPort = { storage, actorFor: async () => undefined, log: { warn: vi.fn() } };
    expect(await eraseConnections(port, ACCOUNT, ['work', 'personal'])).toEqual({ erased: 0, pending: 0 });
    expect(transact).not.toHaveBeenCalled();
    const broken: ConnectionsRightsPort = { storage: { transact: async () => { throw new Error('disk'); }, peek: async () => { throw new Error('disk'); } }, actorFor: async () => undefined, log: { warn: vi.fn() } };
    await expect(eraseConnections(broken, ACCOUNT, ['personal'])).resolves.toEqual({ erased: 0, pending: 0 });
    expect(broken.log!.warn).toHaveBeenCalledWith('[studio] connections_erasure_failed');
    await expect(retryErasedRevocations(broken, ACCOUNT, 'personal', { force: true })).resolves.toBe(0);
  });

  it('without a broker or a current actor the revocation waits (pending), never a silent purge', async () => {
    const { f, done } = await connectedWithActivity();
    const noBroker: ConnectionsRightsPort = { storage: f.storage, actorFor: async () => undefined, log: { warn: vi.fn() } };
    expect(await eraseConnections(noBroker, ACCOUNT, ['personal'])).toEqual({ erased: 1, pending: 1 });
    expect(await f.vault.binding('credential', done.connection.id)).toBeTruthy();
    expect((await f.storage.peek(partitionIdFor(ACCOUNT, 'personal'))).connections[0]).toMatchObject({ lifecycle: 'revoked' });
  });

  it('erasure needs no identity confirmation: /v1/erase revokes and purges after the binding lapsed and with no current actor', async () => {
    const { f, done } = await connectedWithActivity();
    // The person's identity binding is gone (as when it expired) and no actor is current (as for a fired agent).
    (f.studio.deps as { adaptive?: unknown }).adaptive = undefined;
    const revokeOnly: ConnectionsRightsPort = { storage: f.storage, revoke: input => f.brokerPort.revoke(input), actorFor: async () => f.manager, log: { warn: vi.fn() } };
    // The old path alone cannot finish: /v1/revoke resolves identity and is refused.
    expect(await eraseConnections(revokeOnly, ACCOUNT, ['personal'])).toEqual({ erased: 1, pending: 1 });
    expect(await f.vault.binding('credential', done.connection.id)).toBeTruthy();
    const raw = await f.storage.peek(partitionIdFor(ACCOUNT, 'personal'));
    expect(raw.providerAccounts).toEqual([expect.objectContaining({ status: 'revoked', providerSubject: 'erased', providerTenantId: 'erased' })]);
    // /v1/erase finishes it with no actor at all.
    const erasing: ConnectionsRightsPort = { storage: f.storage, erase: input => f.brokerPort.erase(input), actorFor: async () => undefined, log: { warn: vi.fn() } };
    expect(await retryErasedRevocations(erasing, ACCOUNT, 'personal', { force: true })).toBe(1);
    expect(f.brokerPort.erase).toHaveBeenCalledWith({ actor: { accountId: ACCOUNT }, space: 'personal', connectionId: done.connection.id, providerId: 'remote_mcp' });
    expect(await f.vault.binding('credential', done.connection.id)).toBeUndefined();
    const left = await f.storage.peek(partitionIdFor(ACCOUNT, 'personal'));
    for (const [name, rows] of Object.entries(left)) expect(rows, name).toEqual([]);
  });

  it('a first erasure through /v1/erase leaves nothing pending, whatever the identity state', async () => {
    const { f, done } = await connectedWithActivity();
    (f.studio.deps as { adaptive?: unknown }).adaptive = undefined;
    const port: ConnectionsRightsPort = { storage: f.storage, erase: input => f.brokerPort.erase(input), revoke: input => f.brokerPort.revoke(input), actorFor: async () => undefined, log: { warn: vi.fn() } };
    expect(await eraseConnections(port, ACCOUNT, ['personal', 'work'])).toEqual({ erased: 1, pending: 0 });
    expect(f.brokerPort.revoke).not.toHaveBeenCalled();
    expect(await f.vault.binding('credential', done.connection.id)).toBeUndefined();
  });

  it('erasedContext answers only for a connection an erasure marked, and only for the plain account actor', async () => {
    const { f, done, port } = await connectedWithActivity();
    // Live connection: never.
    await expect(erasedAuthority(port, f.manager, 'personal', done.connection.id)).rejects.toMatchObject({ code: 'connection_unavailable' });
    // Revoked by an ordinary disconnect (no erasure mark): never.
    await done.app.revoke(f.manager, { space: 'personal', connectionId: done.connection.id, expectedRevision: done.connection.revision });
    await expect(erasedAuthority(port, f.manager, 'personal', done.connection.id)).rejects.toMatchObject({ code: 'connection_unavailable' });
    // The broker refuses /v1/erase for it as well.
    await expect(f.brokerPort.erase({ actor: { accountId: ACCOUNT }, space: 'personal', connectionId: done.connection.id, providerId: 'remote_mcp' })).rejects.toBeTruthy();
  });

  it('erasedContext refuses a bot actor, another account and the other space', async () => {
    const { f, done } = await connectedWithActivity();
    const failing: ConnectionsRightsPort = { storage: f.storage, actorFor: async () => undefined, log: { warn: vi.fn() } };
    await eraseConnections(failing, ACCOUNT, ['personal']);
    const ok = await erasedAuthority(failing, f.manager, 'personal', done.connection.id);
    expect(ok.context).toMatchObject({ accountId: ACCOUNT, currentAgentIds: [] });
    expect(ok.connection.ownerPersonId).toBe(ok.context.personId);
    await expect(erasedAuthority(failing, await f.botActor('alpha'), 'personal', done.connection.id)).rejects.toMatchObject({ code: 'connection_unavailable' });
    await expect(erasedAuthority(failing, { accountId: 'telegram-account:999' }, 'personal', done.connection.id)).rejects.toMatchObject({ code: 'connection_unavailable' });
    await expect(erasedAuthority(failing, f.manager, 'work', done.connection.id)).rejects.toMatchObject({ code: 'connection_unavailable' });
    await expect(f.brokerPort.erase({ actor: await f.botActor('alpha'), space: 'personal', connectionId: done.connection.id, providerId: 'remote_mcp' })).rejects.toBeTruthy();
  });

  it('a Connections load retries only connections its actor may act on, and is paced', async () => {
    const { f, done } = await connectedWithActivity();
    const beta = await f.connect(f.manager, 'beta');
    const failing: ConnectionsRightsPort = { storage: f.storage, actorFor: async () => undefined, log: { warn: vi.fn() } };
    expect(await eraseConnections(failing, ACCOUNT, ['personal'])).toEqual({ erased: 2, pending: 2 });
    // Broker outage for /v1/erase: only the /v1/revoke fallback is left, and alpha's bot may act only on alpha's connection.
    f.brokerPort.erase.mockRejectedValue(new Error('broker down'));
    f.brokerPort.revoke.mockClear();
    const bot = await f.botActor('alpha');
    const botApp = await f.appFor(bot);
    await botApp.dashboard(bot, 'personal');
    expect(f.brokerPort.revoke.mock.calls.map(([input]) => input.connectionId)).toEqual([done.connection.id]);
    expect(f.brokerPort.revoke.mock.calls.map(([input]) => input.connectionId)).not.toContain(beta.connection.id);
    // Paced: the next load within minutes makes no broker call and reads nothing extra.
    f.brokerPort.revoke.mockClear(); f.brokerPort.erase.mockClear();
    const peek = vi.spyOn(f.storage, 'peek');
    await botApp.dashboard(bot, 'personal');
    expect(f.brokerPort.revoke).not.toHaveBeenCalled();
    expect(f.brokerPort.erase).not.toHaveBeenCalled();
    expect(peek).not.toHaveBeenCalled();
  });

  it('an ordinary disconnect does not make every Connections load re-read the partition', async () => {
    const { f, done } = await connectedWithActivity();
    await done.app.revoke(f.manager, { space: 'personal', connectionId: done.connection.id, expectedRevision: done.connection.revision });
    const peek = vi.spyOn(f.storage, 'peek');
    await done.app.dashboard(f.manager, 'personal');
    await done.app.dashboard(f.manager, 'personal');
    await done.app.dashboard(f.manager, 'personal');
    expect(peek).toHaveBeenCalledTimes(1);
    expect(f.brokerPort.erase).not.toHaveBeenCalled();
  });
});
