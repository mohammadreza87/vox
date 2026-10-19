import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RunnerAdmissionRegistry, runnerProfileConfigurationDigest, runnerAttestationPayload, runnerScopeTenant, RUNNER_IDENTITY_ISSUER, type RunnerAdmissionConfiguration } from '../broker/runner-admission';
import { createConnectionsCatalog } from '../catalog';
import { REVIEWED_SECCOMP_SHA256, type RunnerSandbox } from '../runners/sandbox';
import type { BrokerAuthority, BrokerControlPlane } from '../broker/control';
const accountId = 'telegram-account:1000000000000001'; const now = 1000000;
const { privateKey, publicKey } = generateKeyPairSync('ed25519'); const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const sandboxConfig = { imageId: 'sha256:' + 'a'.repeat(64), dockerBinary: '/usr/bin/docker', dockerSocket: 'unix:///var/run/docker.sock', seccompProfilePath: '/opt/vox/seccomp.json' };
function configuration(provider: 'browser' | 'ssh' = 'browser'): RunnerAdmissionConfiguration {
  const profile = { id: 'worker-profile', accountId, space: 'work' as const, providerId: provider,
    subject: 'runner-service:synthetic-worker', tenant: runnerScopeTenant(accountId, 'work'), displayLabel: 'Synthetic attested worker',
    browserTargets: provider === 'browser' ? [{ id: 'public-page', url: 'https://example.com/approved' }] : [],
    sshTargets: provider === 'ssh' ? [{ id: 'test-host', address: '192.0.2.8', port: 22, user: 'voxreader', hostPublicKey: 'ssh-ed25519 ' + Buffer.alloc(32, 7).toString('base64'), verifiedFingerprint: 'SHA256:' + createHash('sha256').update(Buffer.alloc(32, 7)).digest('base64').replace(/=+$/, ''), serviceIds: ['api'], privateKeyFile: '/run/broker-only/test-host-key' }] : [],
    attestation: { issuedAt: now - 1000, expiresAt: now + 60000, evidenceReference: 'fixture:reviewed-sandbox-and-target', configurationDigest: '0'.repeat(64), signature: 'a'.repeat(86) } };
  const result = { schemaVersion: 1 as const, enabled: true, releasePublicKeyFile: '/etc/root-owned/runner-release.pub', sandbox: sandboxConfig, profiles: [profile] };
  profile.attestation.configurationDigest = runnerProfileConfigurationDigest(result, profile);
  profile.attestation.signature = sign(null, Buffer.from(runnerAttestationPayload(profile)), privateKey).toString('base64url'); return result;
}
function current(provider = 'browser'): BrokerAuthority {
  const scope = { tenantId: 't1', spaceId: 'work1', spaceKind: 'work', containerId: 'private', audiencePersonIds: ['p1'], audienceRevision: '1' };
  return { context: { accountId, personId: 'p1', bindingRevision: 1, scope }, connection: { id: 'connection1', providerId: provider, ownerAccountId: accountId, ownerPersonId: 'p1', scope, lifecycle: 'connected', revision: 1, revocationEpoch: 0 } } as BrokerAuthority;
}
function setup(config = configuration()) {
  const jobs: unknown[] = []; const reads = vi.fn(async () => '<title>Synthetic</title><body>Attested read</body>'); const keyReads = vi.fn(async () => 'synthetic-private-key');
  const sandbox: RunnerSandbox = { async run(job) { jobs.push(job); return { data: job.mode === 'browser' ? { title: 'Synthetic', text: 'Attested read', offline: true, javascript: false, interactive: false } : { serviceId: 'api', activeState: 'active', subState: 'running' }, truncated: false }; } };
  const registry = new RunnerAdmissionRegistry(config, pem, { now: () => now, sandbox, browserReader: { read: reads }, readPrivateKey: keyReads, runtimeProbe: async () => ({ imageId: config.sandbox.imageId, seccompDigest: REVIEWED_SECCOMP_SHA256 }) });
  return { registry, jobs, reads, keyReads };
}
describe('signed deployment admission for per-scope worker identities', () => {
  it('admits a signed exact service/scope identity with an internal marker, without claiming OAuth/native account auth', async () => {
    const { registry } = setup(); const identity = await registry.enrollmentIdentity(current());
    expect(identity.identity).toEqual({ subject: 'runner-service:synthetic-worker', tenant: runnerScopeTenant(accountId, 'work'), displayLabel: 'Synthetic attested worker', issuer: RUNNER_IDENTITY_ISSUER });
    expect(identity.scopes).toEqual(['worker:public_page_read']); expect(identity.leaseMarker).toMatch(/^runner-local:[a-f0-9]{64}$/);
  });
  it('rejects wrong account/space, unsigned inventory changes and forged/expired attestations', async () => {
    const different = current(); different.context.accountId = 'telegram-account:1000000000000002'; await expect(setup().registry.enrollmentIdentity(different)).rejects.toThrow();
    for (const mutate of [
      (config: RunnerAdmissionConfiguration) => { config.profiles[0].browserTargets[0].url = 'https://other.example/secret'; },
      (config: RunnerAdmissionConfiguration) => { config.profiles[0].attestation.signature = 'b'.repeat(86); },
      (config: RunnerAdmissionConfiguration) => { config.profiles[0].attestation.expiresAt = now - 1; },
      (config: RunnerAdmissionConfiguration) => { config.profiles[0].tenant = 'runner-scope:' + 'f'.repeat(64); },
      (config: RunnerAdmissionConfiguration) => { config.sandbox.imageId = 'sha256:' + 'b'.repeat(64); },
    ]) { const config = configuration(); mutate(config); await expect(setup(config).registry.enrollmentIdentity(current())).rejects.toMatchObject({ code: 'runner_attestation_invalid' }); }
  });
  it('requires the actual immutable image and exact reviewed seccomp bytes before enrollment', async () => {
    const config = configuration(); const registry = new RunnerAdmissionRegistry(config, pem, { now: () => now, runtimeProbe: async () => ({ imageId: 'sha256:' + 'f'.repeat(64), seccompDigest: REVIEWED_SECCOMP_SHA256 }) });
    await expect(registry.enrollmentIdentity(current())).rejects.toMatchObject({ code: 'runner_runtime_unqualified' });
  });
  it('routes the ordinary grant-bound ProviderRegistry through offline worker while rechecking current dispatch authority', async () => {
    const f = setup(); const authority = current(); const identity = await f.registry.enrollmentIdentity(authority); const calls: string[] = [];
    const control: BrokerControlPlane = { async call<T>(input) { calls.push(input.action); return (input.action === 'context' ? authority : { allowed: true }) as T; } };
    const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'browser.page.read': ['browser:page:public-page'] }, destinationIds: ['vox:private'] });
    const executor = f.registry.executorForAuthority(authority, catalog, control);
    const result = await executor.execute('browser.page.read', { targetId: 'public-page' }, { credential: { providerId: 'browser', endpointProfileId: 'browser-isolated', accessToken: identity.leaseMarker }, operationId: 'op1', scopeKind: 'work' });
    expect(result.data).toMatchObject({ text: 'Attested read', interactive: false }); expect(f.jobs).toHaveLength(1); expect(calls.filter(action => action === 'assertDispatchable')).toHaveLength(3);
  });
  it('cannot replace a service marker with an arbitrary bearer token or access a target outside signed inventory', async () => {
    const f = setup(); const authority = current(); const identity = await f.registry.enrollmentIdentity(authority);
    const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'browser.page.read': ['browser:page:public-page', 'browser:page:other-page'] }, destinationIds: ['vox:private'] });
    const control: BrokerControlPlane = { async call<T>(input) { return (input.action === 'context' ? authority : { allowed: true }) as T; } };
    const executor = f.registry.executorForAuthority(authority, catalog, control);
    const context = { credential: { providerId: 'browser', endpointProfileId: 'browser-isolated', accessToken: 'arbitrary-token' }, operationId: 'op1', scopeKind: 'work' as const };
    await expect(executor.execute('browser.page.read', { targetId: 'public-page' }, context)).rejects.toMatchObject({ code: 'runner_lease_marker_invalid' });
    await expect(executor.execute('browser.page.read', { targetId: 'other-page' }, { ...context, credential: { ...context.credential, accessToken: identity.leaseMarker } })).rejects.toMatchObject({ code: 'browser_target_unregistered' }); expect(f.jobs).toHaveLength(0);
  });
  it('stops between capture and worker on a changed connection revision and suppresses all output', async () => {
    const f = setup(); const authority = current(); const identity = await f.registry.enrollmentIdentity(authority); let boundaries = 0;
    const control: BrokerControlPlane = { async call<T>(input) {
      if (input.action === 'context') { const latest = structuredClone(authority); if (++boundaries === 2) latest.connection.revision++; return latest as T; } return { allowed: true } as T;
    } };
    const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'browser.page.read': ['browser:page:public-page'] }, destinationIds: ['vox:private'] });
    await expect(f.registry.executorForAuthority(authority, catalog, control).execute('browser.page.read', { targetId: 'public-page' }, { credential: { providerId: 'browser', endpointProfileId: 'browser-isolated', accessToken: identity.leaseMarker }, operationId: 'op1', scopeKind: 'work' })).rejects.toMatchObject({ code: 'runner_authorization_changed' });
    expect(f.reads).toHaveBeenCalledOnce(); expect(f.jobs).toHaveLength(0);
  });
  it('hands only one signed host key/service and its broker-only key file to the SSH sandbox', async () => {
    const f = setup(configuration('ssh')); const authority = current('ssh'); const identity = await f.registry.enrollmentIdentity(authority);
    const control: BrokerControlPlane = { async call<T>(input) { return (input.action === 'context' ? authority : { allowed: true }) as T; } };
    const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'ssh.service.status': ['ssh:host:test-host:service:api'] }, destinationIds: ['vox:private'] });
    const result = await f.registry.executorForAuthority(authority, catalog, control).execute('ssh.service.status', { hostId: 'test-host', serviceId: 'api' }, { credential: { providerId: 'ssh', endpointProfileId: 'ssh-isolated', accessToken: identity.leaseMarker }, operationId: 'op1', scopeKind: 'work' });
    expect(f.keyReads).toHaveBeenCalledWith('/run/broker-only/test-host-key'); expect(result.data).toMatchObject({ hostId: 'test-host', serviceId: 'api', activeState: 'active' }); expect(JSON.stringify(result)).not.toContain('synthetic-private-key');
  });
});
