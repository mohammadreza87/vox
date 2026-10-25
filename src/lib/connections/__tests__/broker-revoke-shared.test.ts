import { createHash, randomUUID } from 'crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectionsCatalog } from '../catalog';
import type { BrokerControlInput } from '../broker/control';
import type { ConnectionContext } from '../contracts';
import { ConnectionsRepository } from '../repository';
import { ConnectionsService } from '../service';
import { InMemoryConnectionsStorage } from '../storage';
import { ConnectionsBroker } from '../broker/service';
import { dispatchBrokerControl } from '../broker/control';
import { FileBrokerVault } from '../broker/vault';
import type { OAuthProfile, OAuthToken } from '../broker/oauth';
import type { ProviderResult } from '../providers/types';

/**
 * Settings Part 2b S0: one Google sign-in (one OAuth client and one Google account) can back several Vox connections,
 * and Google's revoke ends the whole grant. These exercise the broker directly, with no sockets: the control plane is
 * an in-process call and the vault is the real encrypted file vault in a temporary directory.
 */
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

const now = 1_800_000_000_000;
const SUBJECT = 'qa-google-subject';
const google = (providerId: string): OAuthProfile => ({ providerId, issuer: 'https://accounts.google.com', authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token', revokeUrl: 'https://oauth2.googleapis.com/revoke', clientId: 'SYNTHETIC_SHARED_CLIENT',
  clientSecret: 'SYNTHETIC_CLIENT_SECRET', callbackUrl: `https://vox-qa.example.invalid/oauth/callback/${providerId}`,
  scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] });
// GitHub has no revoke endpoint: nothing can be revoked later, so nothing is ever deferred.
const github: OAuthProfile = { providerId: 'github', issuer: 'https://github.com', authorizeUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token', clientId: 'SYNTHETIC_GITHUB_CLIENT', clientSecret: 'SYNTHETIC_CLIENT_SECRET',
  callbackUrl: 'https://vox-qa.example.invalid/oauth/callback/github', scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] };
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const TOOLS = { google_drive: { toolId: 'google_drive.file.get', resourceId: 'google_drive:file:qa-file', args: { fileId: 'qa-file' } },
  google_docs: { toolId: 'google_docs.document.get', resourceId: 'google_docs:document:qa-doc', args: { documentId: 'qa-doc' } } } as const;
type Provider = keyof typeof TOOLS;

async function fixture(options: { expiresSoon?: boolean; expectedSubject?: string } = {}) {
  const actor = { accountId: 'telegram-account:7' };
  const context: ConnectionContext = { ...actor, personId: 'qa-person', bindingId: 'qa-binding', bindingRevision: 1,
    bindingExpiresAt: now + 3_600_000, currentAgentIds: ['qa-agent'], scope: { tenantId: 'qa-tenant', spaceId: 'qa-work', spaceKind: 'work',
      containerId: 'qa-private', audiencePersonIds: ['qa-person'], audienceRevision: 'qa-audience' } };
  const destinationIds = ['provider:google_drive', 'provider:google_docs', 'model:studio', 'vox:private'];
  const catalog = createConnectionsCatalog({ destinationIds,
    resourceIdsByTool: { [TOOLS.google_drive.toolId]: [TOOLS.google_drive.resourceId], [TOOLS.google_docs.toolId]: [TOOLS.google_docs.resourceId] } });
  const service = new ConnectionsService(new ConnectionsRepository(new InMemoryConnectionsStorage()), { catalog, resolveContext: async () => context, now: () => now });
  const directory = await mkdtemp(join(tmpdir(), 'vox-revoke-shared-')); directories.push(directory);
  const vault = new FileBrokerVault(directory, new Uint8Array(32).fill(71));
  let issued = 0;
  const oauth = {
    exchange: vi.fn(async (): Promise<OAuthToken> => { issued++; return { accessToken: `SYNTHETIC_ACCESS_${issued}`, refreshToken: `SYNTHETIC_REFRESH_${issued}`,
      expiresAt: now + (options.expiresSoon ? 1000 : 3_600_000), scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] }; }),
    refresh: vi.fn(async (_profile: OAuthProfile, refreshToken: string): Promise<OAuthToken> => ({ accessToken: refreshToken.replace('REFRESH', 'ROTATED'),
      expiresAt: now + 3_600_000, scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] })),
    identity: vi.fn(async (providerId: string, accessToken: string) => ({ subject: accessToken.includes('WRONG') ? 'another-subject' : SUBJECT,
      tenant: 'google', displayLabel: 'Synthetic Google account', issuer: providerId === 'github' ? 'https://github.com' : 'https://accounts.google.com' })),
    revoke: vi.fn(async () => 'verified' as const),
  };
  const result = (provider: Provider): ProviderResult => ({ data: { id: 'qa' }, resourceIds: [TOOLS[provider].resourceId], providerReceiptRef: 'qa-receipt',
    resourceRevision: 'qa-revision', untrustedContent: true, truncated: false });
  const executor = { execute: vi.fn(async (toolId: string) => result(toolId.startsWith('google_docs') ? 'google_docs' : 'google_drive')) };
  // Rights erasure asks Studio for 'erasedContext'; in-process, the plain context of the revoked connection stands in for it.
  const control = { call: (input: BrokerControlInput) => dispatchBrokerControl(service, input.action === 'erasedContext' ? { ...input, action: 'context' } : input) as never };
  const profiles: Record<string, OAuthProfile> = { google_drive: google('google_drive'), google_docs: google('google_docs'), github };
  const broker = new ConnectionsBroker({ control, vault, oauth, catalog, executor, now: () => now, oauthProfiles: profiles, enabledProviderIds: Object.keys(profiles),
    ...(options.expectedSubject ? { expectedIdentity: async () => ({ subject: options.expectedSubject!, tenant: 'google' }) } : {}) });

  const connect = async (provider: Provider | 'github', code = 'SYNTHETIC_CODE') => {
    const pending = (await service.enroll(actor, { space: 'work', providerId: provider, displayLabel: `Synthetic ${provider}` })).connections.find(c => c.providerId === provider && c.lifecycle === 'pending')!;
    const start = await broker.beginSetup({ actor, space: 'work', connectionId: pending.id, expectedRevision: pending.revision, providerId: provider });
    const state = new URL(start.authorizationUrl!).searchParams.get('state')!;
    const callback = () => broker.callback(provider, { state, code, iss: profiles[provider].issuer });
    return { id: pending.id, provider, flowId: start.flowId, callback, claim: () => broker.claimSetup({ actor, space: 'work', flowId: start.flowId }) };
  };
  const ready = async (provider: Provider) => {
    const setup = await connect(provider); await setup.callback(); await setup.claim();
    const connection = (await service.list(actor, { space: 'work' })).connections.find(c => c.id === setup.id)!;
    const grant = (await service.grant(actor, { space: 'work', connectionId: setup.id, expectedRevision: connection.revision, agentId: 'qa-agent',
      toolIds: [TOOLS[provider].toolId], resourceIds: [TOOLS[provider].resourceId], destinationIds: [`provider:${provider}`, 'model:studio', 'vox:private'],
      effects: ['read'], expiresAt: now + 60_000, maxCalls: 10, maxBytes: 64_000 })).grants.find(g => g.connectionId === setup.id)!;
    return { id: setup.id, provider, grantId: grant.id };
  };
  const execute = async (connection: { id: string; provider: Provider; grantId: string }) => {
    const requestId = randomUUID();
    const operation = await service.propose(actor, { space: 'work', requestId, idempotencyKey: requestId, connectionId: connection.id, grantId: connection.grantId,
      agentId: 'qa-agent', toolId: TOOLS[connection.provider].toolId, arguments: TOOLS[connection.provider].args, destinationId: `provider:${connection.provider}`,
      expectedTargetRevision: null, sourceIds: [], retention: 'retained', deadlineAt: now + 30_000 });
    return broker.execute({ actor, space: 'work', operationId: operation.operationId });
  };
  const disconnect = async (connection: { id: string; provider: Provider | 'github' }) => {
    const current = (await service.list(actor, { space: 'work' })).connections.find(c => c.id === connection.id)!;
    await service.revoke(actor, { space: 'work', connectionId: connection.id, expectedRevision: current.revision });
    return broker.revoke({ actor, space: 'work', connectionId: connection.id, providerId: connection.provider });
  };
  const erase = async (connection: { id: string; provider: Provider }) => {
    const current = (await service.list(actor, { space: 'work' })).connections.find(c => c.id === connection.id)!;
    await service.revoke(actor, { space: 'work', connectionId: connection.id, expectedRevision: current.revision });
    return broker.revokeErased({ actor, space: 'work', connectionId: connection.id, providerId: connection.provider });
  };
  const grantrefFiles = async () => { try { return await readdir(join(directory, 'grantref')); } catch { return []; } };
  const revokedTokens = () => oauth.revoke.mock.calls.map(call => (call as unknown[])[1]);
  // The shared Google client's grantref for this account, as the broker names it.
  const grantrefId = `grantref:${sha(JSON.stringify(['https://accounts.google.com', 'SYNTHETIC_SHARED_CLIENT', actor.accountId]))}`;
  /** A broker that crashed while holding the grantref lock leaves its lock directory behind. */
  const stickGrantrefLock = () => mkdir(join(directory, 'locks', sha(grantrefId)), { recursive: true });
  const unstickGrantrefLock = () => rm(join(directory, 'locks', sha(grantrefId)), { recursive: true, force: true });
  const seedDeferred = (deferred: Array<{ subject: string | null; token: string }>) => vault.write('grantref', grantrefId,
    { accountId: actor.accountId, personId: actor.accountId, space: 'work', connectionId: grantrefId, providerId: 'grantref' }, { version: 1, deferred });
  const credentialOf = async (connectionId: string) => { const binding = await vault.binding('credential', connectionId); return binding && vault.read('credential', connectionId, binding); };
  return { actor, service, broker, vault, oauth, executor, directory, connect, ready, execute, disconnect, erase, grantrefFiles, revokedTokens,
    stickGrantrefLock, unstickGrantrefLock, seedDeferred, credentialOf };
}

describe('revokeShared: a shared Google grant is revoked only by the last Vox connection', () => {
  it('a failed refresh on one connection never revokes the grant the other still refreshes and uses', async () => {
    const f = await fixture({ expiresSoon: true });
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    // Drive's refreshed token belongs to a different Google account: the broker refuses it and must drop it.
    f.oauth.refresh.mockImplementationOnce(async () => ({ accessToken: 'SYNTHETIC_WRONG_ROTATED', expiresAt: now + 3_600_000, scopes: ['openid'] }));
    expect((await f.execute(drive)).receipt.state).not.toBe('committed');
    expect(f.oauth.revoke).not.toHaveBeenCalled();
    // Docs still refreshes and runs: its grant at Google was never revoked.
    const run = await f.execute(docs);
    expect(run.receipt.state).toBe('committed');
    expect(f.oauth.refresh).toHaveBeenCalledTimes(2);
    expect(f.executor.execute).toHaveBeenCalledTimes(1);
    expect(f.oauth.revoke).not.toHaveBeenCalled();
  });

  it('the last disconnect revokes its own token plus every deferred one; earlier ones keep the shared grant', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    expect(await f.disconnect(drive)).toEqual({ futureUseStopped: true, providerRevocation: 'shared_grant_kept' });
    expect(f.oauth.revoke).not.toHaveBeenCalled();
    // The dropped connection can no longer read its credential; the other still runs.
    expect(await f.vault.binding('credential', drive.id)).toBeUndefined();
    expect((await f.execute(docs)).receipt.state).toBe('committed');
    expect(await f.disconnect(docs)).toEqual({ futureUseStopped: true, providerRevocation: 'verified' });
    // Docs' own refresh token first (it ends the grant even once the access token expired), then Drive's deferred one.
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_2', 'SYNTHETIC_REFRESH_1']);
    expect(await f.grantrefFiles()).toEqual([]);
  });

  it('deferred tokens are sealed in the vault, never stored in plaintext', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive'); await f.ready('google_docs');
    await f.disconnect(drive);
    const files = await f.grantrefFiles(); expect(files).toHaveLength(1);
    const raw = await readFile(join(f.directory, 'grantref', files[0]), 'utf8');
    expect(raw).not.toMatch(/SYNTHETIC_(ACCESS|REFRESH)/);
    expect(raw).not.toContain('telegram-account:7|');
  });

  it('erasure (/v1/erase) releases each connection and empties the index after the last', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    expect((await f.erase(drive)).providerRevocation).toBe('shared_grant_kept');
    expect(await f.grantrefFiles()).toHaveLength(1);
    expect(f.oauth.revoke).not.toHaveBeenCalled();
    expect((await f.erase(docs)).providerRevocation).toBe('verified');
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_2', 'SYNTHETIC_REFRESH_1']);
    expect(await f.grantrefFiles()).toEqual([]);
    // A repeat erasure has nothing left to revoke and creates no index.
    expect((await f.erase(docs)).providerRevocation).toBe('unavailable');
    expect(f.oauth.revoke).toHaveBeenCalledTimes(2);
    expect(await f.grantrefFiles()).toEqual([]);
  });

  it('holders are read from the sealed credentials themselves: a sign-in writes no index, and older connections count', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive'); await f.ready('google_docs');
    expect(await f.grantrefFiles()).toEqual([]);
    expect((await f.disconnect(drive)).providerRevocation).toBe('shared_grant_kept');
    expect(f.oauth.revoke).not.toHaveBeenCalled();
  });

  it('a failed sign-in for a second app drops its new token without revoking the first app\'s grant', async () => {
    const f = await fixture();
    await f.ready('google_drive');
    const docs = await f.connect('google_docs');
    f.oauth.exchange.mockImplementationOnce(async () => ({ accessToken: 'SYNTHETIC_WRONG_ACCESS', refreshToken: 'SYNTHETIC_WRONG_REFRESH', scopes: ['openid'] }));
    f.oauth.identity.mockImplementationOnce(async () => { throw new Error('synthetic identity failure'); });
    await expect(docs.callback()).rejects.toMatchObject({ code: 'oauth_verification_failed' });
    expect(f.oauth.revoke).not.toHaveBeenCalled();
  });

  it('a single connection still revokes at once, exactly as before', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive');
    expect(await f.disconnect(drive)).toEqual({ futureUseStopped: true, providerRevocation: 'verified' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1']);
    expect(await f.grantrefFiles()).toEqual([]);
  });

  it('a different Vox account never shares the index, even with the same Google client', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive');
    // Another account's credential under the same client must not count as a holder for this account.
    await f.vault.write('credential', 'other-account-connection', { accountId: 'telegram-account:8', personId: 'other', space: 'work',
      connectionId: 'other-account-connection', providerId: 'google_docs' }, { synthetic: true });
    expect((await f.disconnect(drive)).providerRevocation).toBe('verified');
  });
});

describe('revokeShared review fixes: never drop a token unrevoked, and only defer for the same grant', () => {
  it('a stuck grantref lock blocks no sign-in, and a disconnect then revokes its token at once instead of dropping it', async () => {
    const f = await fixture();
    await f.stickGrantrefLock();
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    expect(await f.disconnect(drive)).toEqual({ futureUseStopped: true, providerRevocation: 'verified' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1']);
    expect(await f.credentialOf(drive.id)).toBeUndefined();
    expect(await f.credentialOf(docs.id)).toBeDefined();
  }, 15_000);

  it('a failed sign-in with a stuck grantref lock still revokes its new token instead of dropping it', async () => {
    const f = await fixture();
    await f.stickGrantrefLock();
    const docs = await f.connect('google_docs');
    f.oauth.identity.mockImplementationOnce(async () => { throw new Error('synthetic identity failure'); });
    await expect(docs.callback()).rejects.toMatchObject({ code: 'oauth_verification_failed' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1']);
  }, 15_000);

  it('erasure with a stuck lock revokes the token, then stays pending until the deferred ones are revoked and the grantref is gone', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    expect((await f.erase(drive)).providerRevocation).toBe('shared_grant_kept');
    await f.stickGrantrefLock();
    await expect(f.erase(docs)).rejects.toMatchObject({ code: 'vault_operation_busy' });
    // The last token was revoked directly and its copy is gone; Drive's deferred token waits in the sealed grantref.
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_2']);
    expect(await f.credentialOf(docs.id)).toBeUndefined();
    expect(await f.grantrefFiles()).toHaveLength(1);
    // Rights erasure retries; with the lock released the retry revokes what was deferred and clears the grantref.
    await f.unstickGrantrefLock();
    expect(await f.broker.revokeErased({ actor: f.actor, space: 'work', connectionId: docs.id, providerId: 'google_docs' }))
      .toEqual({ futureUseStopped: true, providerRevocation: 'unavailable' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_2', 'SYNTHETIC_REFRESH_1']);
    expect(await f.grantrefFiles()).toEqual([]);
  }, 15_000);

  it('one damaged credential record (any account) neither blocks a sign-in nor turns a shared disconnect into a revoke', async () => {
    const f = await fixture();
    await mkdir(join(f.directory, 'credential'), { recursive: true });
    await writeFile(join(f.directory, 'credential', `${sha('damaged')}.json`), '{"truncated":');
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    expect((await f.disconnect(drive)).providerRevocation).toBe('shared_grant_kept');
    expect(f.oauth.revoke).not.toHaveBeenCalled();
    expect((await f.disconnect(docs)).providerRevocation).toBe('verified');
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_2', 'SYNTHETIC_REFRESH_1']);
  });

  it('the last revoke falls back to the access token when the refresh token is refused', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive');
    f.oauth.revoke.mockImplementation((async (_profile: OAuthProfile, token: string) => token.includes('REFRESH') ? 'unavailable' : 'verified') as never);
    expect((await f.disconnect(drive)).providerRevocation).toBe('verified');
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1', 'SYNTHETIC_ACCESS_1']);
  });

  it('a sign-in that picks a different Google account than the expected one is revoked at once, never deferred', async () => {
    const f = await fixture({ expectedSubject: SUBJECT });
    const drive = await f.ready('google_drive');
    const docs = await f.connect('google_docs');
    f.oauth.exchange.mockImplementationOnce(async () => ({ accessToken: 'SYNTHETIC_WRONG_ACCESS', refreshToken: 'SYNTHETIC_WRONG_REFRESH', scopes: ['openid'] }));
    await expect(docs.callback()).rejects.toMatchObject({ code: 'oauth_verification_failed' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_WRONG_REFRESH']);
    expect(await f.grantrefFiles()).toEqual([]);
    // Drive's own grant (the expected account) is untouched.
    expect(await f.disconnect(drive)).toEqual({ futureUseStopped: true, providerRevocation: 'verified' });
  });

  it('connections to two different Google accounts never hold each other\'s grant', async () => {
    const f = await fixture();
    const drive = await f.ready('google_drive');
    f.oauth.exchange.mockImplementationOnce(async () => ({ accessToken: 'SYNTHETIC_WRONG_ACCESS', refreshToken: 'SYNTHETIC_WRONG_REFRESH', expiresAt: now + 3_600_000, scopes: ['openid'] }));
    const docs = await f.ready('google_docs');
    expect(await f.disconnect(docs)).toEqual({ futureUseStopped: true, providerRevocation: 'verified' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_WRONG_REFRESH']);
    expect(await f.grantrefFiles()).toEqual([]);
    expect((await f.execute(drive)).receipt.state).toBe('committed');
  });

  it('a failed sign-in of unknown account is revoked at once when nothing else holds the client', async () => {
    const f = await fixture();
    const docs = await f.connect('google_docs');
    f.oauth.identity.mockImplementationOnce(async () => { throw new Error('synthetic identity failure'); });
    await expect(docs.callback()).rejects.toMatchObject({ code: 'oauth_verification_failed' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1']);
  });

  it('a full deferred list drops a redundant token of a held account, never one of unknown account unrevoked', async () => {
    const f = await fixture();
    await f.ready('google_drive');
    await f.seedDeferred(Array.from({ length: 100 }, (_, i) => ({ subject: null, token: `SYNTHETIC_UNKNOWN_${i}` })));
    const first = await f.connect('google_docs');
    f.oauth.identity.mockImplementationOnce(async () => { throw new Error('synthetic identity failure'); });
    await expect(first.callback()).rejects.toMatchObject({ code: 'oauth_verification_failed' });
    // Nothing redundant to drop: the oldest unknown one is revoked now rather than lost.
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_UNKNOWN_0']);
    await f.seedDeferred(Array.from({ length: 100 }, (_, i) => ({ subject: SUBJECT, token: `SYNTHETIC_HELD_${i}` })));
    const second = await f.connect('google_docs');
    f.oauth.identity.mockImplementationOnce(async () => { throw new Error('synthetic identity failure'); });
    await expect(second.callback()).rejects.toMatchObject({ code: 'oauth_verification_failed' });
    // A token of the account Drive still holds is redundant (Drive's own revoke ends that grant), so it may go.
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_UNKNOWN_0']);
  });

  it('dropping a candidate token never releases the connection\'s own credential from the grant', async () => {
    const f = await fixture({ expiresSoon: true });
    const drive = await f.ready('google_drive'); const docs = await f.ready('google_docs');
    // Drive's refresh widens scopes: the refreshed token is dropped and Drive's credential is kept (marked revoked).
    f.oauth.refresh.mockImplementationOnce(async () => ({ accessToken: 'SYNTHETIC_WIDE_ACCESS', expiresAt: now + 3_600_000,
      scopes: ['openid', 'https://www.googleapis.com/auth/drive'] }));
    expect((await f.execute(drive)).receipt.state).not.toBe('committed');
    expect(await f.credentialOf(drive.id)).toMatchObject({ status: 'revoked' });
    // Drive's credential (and its refresh token) still holds the grant, so Docs' disconnect keeps it.
    expect((await f.disconnect(docs)).providerRevocation).toBe('shared_grant_kept');
    expect(f.oauth.revoke).not.toHaveBeenCalled();
    expect((await f.disconnect(drive)).providerRevocation).toBe('verified');
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1', 'SYNTHETIC_WIDE_ACCESS', 'SYNTHETIC_REFRESH_2']);
    expect(await f.grantrefFiles()).toEqual([]);
  });

  it('a dropped refresh of the only connection waits for its disconnect: the connection still holds that grant', async () => {
    const f = await fixture({ expiresSoon: true });
    const drive = await f.ready('google_drive');
    f.oauth.refresh.mockImplementationOnce(async () => ({ accessToken: 'SYNTHETIC_WIDE_ACCESS', expiresAt: now + 3_600_000,
      scopes: ['openid', 'https://www.googleapis.com/auth/drive'] }));
    expect((await f.execute(drive)).receipt.state).not.toBe('committed');
    expect(f.oauth.revoke).not.toHaveBeenCalled();
    expect((await f.disconnect(drive)).providerRevocation).toBe('verified');
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_REFRESH_1', 'SYNTHETIC_WIDE_ACCESS']);
  });

  it('GitHub (no revoke endpoint) drops a token at once and never defers it, even with another GitHub connection', async () => {
    const f = await fixture();
    const connectGithub = async () => { const setup = await f.connect('github'); await setup.callback(); await setup.claim(); return { id: setup.id, provider: 'github' as const }; };
    const first = await connectGithub(); await connectGithub();
    expect(await f.disconnect(first)).toEqual({ futureUseStopped: true, providerRevocation: 'verified' });
    expect(f.revokedTokens()).toEqual(['SYNTHETIC_ACCESS_1']);
    expect(await f.grantrefFiles()).toEqual([]);
    expect(await f.credentialOf(first.id)).toBeUndefined();
  });
});
