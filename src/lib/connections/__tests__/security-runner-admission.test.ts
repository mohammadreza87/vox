import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RunnerAdmissionRegistry, runnerScopeTenant, runnerProfileConfigurationDigest, runnerAttestationPayload, type RunnerAdmissionConfiguration } from '../broker/runner-admission';
import type { BrokerAuthority, BrokerControlPlane } from '../broker/control';
import { createConnectionsCatalog } from '../catalog';
import { REVIEWED_SECCOMP_SHA256 } from '../runners/sandbox';
import { ProviderError } from '../transport';

// Synthetic keys and injected wire/runtime seams. No daemon, host or account is contacted.
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = 1_800_000_000_000;
const accountId = 'telegram-account:1001';
function configuration(): RunnerAdmissionConfiguration {
  const config: RunnerAdmissionConfiguration = { schemaVersion: 1, enabled: true, releasePublicKeyFile: '/synthetic/root/release.pub',
    sandbox: { imageId: `sha256:${'e'.repeat(64)}`, dockerBinary: '/synthetic/docker', dockerSocket: 'unix:///synthetic/docker.sock', seccompProfilePath: '/synthetic/seccomp.json' },
    profiles: [{ id: 'heldout-runner', accountId, space: 'work', providerId: 'browser', subject: 'runner-service:heldout',
      tenant: runnerScopeTenant(accountId, 'work'), displayLabel: 'Synthetic local worker, not a native account',
      browserTargets: [{ id: 'heldout-page', url: 'https://example.invalid/registered' }], sshTargets: [],
      attestation: { issuedAt: now - 1000, expiresAt: now + 60000, evidenceReference: 'synthetic-only', configurationDigest: '0'.repeat(64), signature: 'a'.repeat(86) } }] };
  return resign(config);
}
function resign(config: RunnerAdmissionConfiguration) {
  const profile = config.profiles[0]; profile.attestation.configurationDigest = runnerProfileConfigurationDigest(config, profile);
  profile.attestation.signature = sign(null, Buffer.from(runnerAttestationPayload(profile)), keys.privateKey).toString('base64url'); return config;
}
function authority(): BrokerAuthority {
  const scope = { tenantId: 'heldout-tenant', spaceId: 'heldout-space', spaceKind: 'work', containerId: 'heldout-private', audiencePersonIds: ['heldout-person'], audienceRevision: '1' };
  return { context: { accountId, personId: 'heldout-person', bindingRevision: 1, scope }, connection: { id: 'heldout-connection', providerId: 'browser',
    ownerAccountId: accountId, ownerPersonId: 'heldout-person', scope, lifecycle: 'connected', revision: 1, revocationEpoch: 0 } } as BrokerAuthority;
}
function fixture(config = configuration()) {
  let configurationCurrent = true; let dispatchAllowed = true; let changeAfterWorker = false;
  const capture = vi.fn(async () => '<p>HELDOUT_LOCAL_PAGE</p>');
  const worker = vi.fn(async () => { if (changeAfterWorker) dispatchAllowed = false;
    return { data: { title: 'Heldout', text: 'HELDOUT_LOCAL_PAGE', offline: true, javascript: false, interactive: false }, truncated: false }; });
  const current = authority();
  const control: BrokerControlPlane = { async call<T>(input) {
    if (input.action === 'context') return structuredClone(current) as T;
    if (!dispatchAllowed) throw new ProviderError('heldout_dispatch_denied', 'not_dispatched');
    return { allowed: true } as T;
  } };
  const registry = new RunnerAdmissionRegistry(config, publicKey, { now: () => now,
    assertConfigurationUnchanged: async () => { if (!configurationCurrent) throw new Error('heldout configuration changed'); },
    runtimeProbe: async () => ({ imageId: config.sandbox.imageId, seccompDigest: REVIEWED_SECCOMP_SHA256 }),
    browserReader: { read: capture }, sandbox: { run: worker } });
  const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'browser.page.read': ['browser:page:heldout-page'] }, destinationIds: ['provider:browser', 'vox:private'] });
  return { registry, current, capture, worker, invalidateConfig: () => { configurationCurrent = false; }, revokeAfterWorker: () => { changeAfterWorker = true; },
    execute: async () => { const identity = await registry.enrollmentIdentity(current);
      return registry.executorForAuthority(current, catalog, control).execute('browser.page.read', { targetId: 'heldout-page' }, {
        credential: { providerId: 'browser', endpointProfileId: 'browser-isolated', accessToken: identity.leaseMarker }, operationId: 'heldout-op', scopeKind: 'work' }); } };
}

describe('independent signed runner admission and final-use fencing', () => {
  it.each(['sandbox', 'target', 'evidence'] as const)('signed approval cannot be replayed after %s changes', async field => {
    const config = configuration();
    if (field === 'sandbox') config.sandbox.dockerSocket = 'unix:///other/privileged.sock';
    if (field === 'target') config.profiles[0].browserTargets[0].url = 'https://example.invalid/unreviewed';
    if (field === 'evidence') config.profiles[0].attestation.evidenceReference = 'another-evidence';
    const f = fixture(config); await expect(f.execute()).rejects.toMatchObject({ code: 'runner_attestation_invalid' });
    expect(f.capture).not.toHaveBeenCalled(); expect(f.worker).not.toHaveBeenCalled();
  });
  it('even a correctly signed service cannot claim another account scope tenant', async () => {
    const config = configuration(); config.profiles[0].tenant = runnerScopeTenant('telegram-account:1002', 'work'); resign(config);
    await expect(fixture(config).execute()).rejects.toMatchObject({ code: 'runner_attestation_invalid' });
  });
  it('rejects a correctly signed approval lasting longer than the maximum qualification period', async () => {
    const config = configuration(); config.profiles[0].attestation.expiresAt = now + 31 * 86400000; resign(config);
    await expect(fixture(config).execute()).rejects.toMatchObject({ code: 'runner_attestation_invalid' });
  });
  it('the runtime must match both the approved image and reviewed seccomp bytes', async () => {
    const config = configuration(); const registry = new RunnerAdmissionRegistry(config, publicKey, { now: () => now,
      runtimeProbe: async () => ({ imageId: config.sandbox.imageId, seccompDigest: 'f'.repeat(64) }) });
    await expect(registry.enrollmentIdentity(authority())).rejects.toMatchObject({ code: 'runner_runtime_unqualified' });
  });
  it('an enrollment marker cannot bypass a changed deployment configuration', async () => {
    const f = fixture(); await f.registry.enrollmentIdentity(f.current); f.invalidateConfig();
    await expect(f.execute()).rejects.toThrow('heldout configuration changed');
    expect(f.capture).not.toHaveBeenCalled(); expect(f.worker).not.toHaveBeenCalled();
  });
  it('revocation after the worker completes suppresses its captured output', async () => {
    const f = fixture(); f.revokeAfterWorker();
    await expect(f.execute()).rejects.toMatchObject({ code: 'heldout_dispatch_denied' }); expect(f.worker).toHaveBeenCalledOnce();
  });
});
