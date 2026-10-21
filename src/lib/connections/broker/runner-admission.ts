import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { idSchema, type ConnectionsCatalog } from '../contracts';
import { canonical } from '../repository';
import { sameScope } from '../policy';
import { ProviderRegistry } from '../providers/registry';
import { ConfiguredRunnerExecutor } from '../providers/runners';
import { BrowserReadRunner, type BrowserPageReader, type RunnerPolicy } from '../runners/browser';
import { SshReadRunner } from '../runners/ssh';
import { DockerRunnerSandbox, REVIEWED_SECCOMP_SHA256, type RunnerSandbox } from '../runners/sandbox';
import { ProviderError } from '../transport';
import type { BrokerAuthority, BrokerControlPlane } from './control';
import type { VerifiedProviderIdentity } from './oauth';
const execute = promisify(execFile);
const absolute = z.string().min(1).max(500).refine(isAbsolute);
const localId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const sandboxSchema = z.object({ imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/), dockerBinary: absolute,
  dockerSocket: z.string().regex(/^unix:\/\/\/[^\r\n\u0000]{1,500}$/), seccompProfilePath: absolute }).strict();
const browserTargetSchema = z.object({ id: localId, url: z.string().url().max(2000).refine(value => {
  const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!url.port || url.port === '443');
}) }).strict();
const sshTargetSchema = z.object({ id: localId, address: z.union([z.ipv4(), z.ipv6()]), port: z.number().int().min(1).max(65535),
  user: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/).refine(value => value !== 'root'),
  hostPublicKey: z.string().regex(/^(ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{32,1200}$/),
  verifiedFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/), serviceIds: z.array(localId).min(1).max(50), privateKeyFile: absolute }).strict();
const attestationSchema = z.object({ issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
  evidenceReference: z.string().trim().min(1).max(300), configurationDigest: hex,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/) }).strict();
const profileSchema = z.object({ id: localId, accountId: z.string().regex(/^telegram-account:[1-9]\d{0,15}$/), space: z.enum(['work', 'personal']),
  agentId: idSchema.optional(), providerId: z.enum(['browser', 'ssh']), subject: z.string().regex(/^runner-service:[A-Za-z0-9_-]{1,100}$/),
  tenant: z.string().regex(/^runner-scope:[a-f0-9]{64}$/), displayLabel: z.string().trim().min(1).max(160),
  browserTargets: z.array(browserTargetSchema).max(50), sshTargets: z.array(sshTargetSchema).max(50), attestation: attestationSchema,
}).strict().superRefine((profile, context) => {
  if (profile.providerId === 'browser' ? !profile.browserTargets.length || profile.sshTargets.length > 0 : !profile.sshTargets.length || profile.browserTargets.length > 0)
    context.addIssue({ code: 'custom', message: 'One finite worker family per profile' });
  if (new Set(profile.browserTargets.map(target => target.id)).size !== profile.browserTargets.length || new Set(profile.sshTargets.map(target => target.id)).size !== profile.sshTargets.length || profile.sshTargets.some(target => new Set(target.serviceIds).size !== target.serviceIds.length))
    context.addIssue({ code: 'custom', message: 'Duplicate registered target' });
});
export const runnerAdmissionConfigurationSchema = z.object({ schemaVersion: z.literal(1), enabled: z.boolean(), releasePublicKeyFile: absolute,
  sandbox: sandboxSchema, profiles: z.array(profileSchema).max(100) }).strict().superRefine((configuration, context) => {
  const keys = configuration.profiles.map(profile => JSON.stringify([profile.accountId, profile.space, profile.agentId ?? null, profile.providerId]));
  if (new Set(keys).size !== keys.length || new Set(configuration.profiles.map(profile => profile.id)).size !== configuration.profiles.length)
    context.addIssue({ code: 'custom', message: 'Duplicate runner authority partition' });
});
export type RunnerAdmissionConfiguration = z.infer<typeof runnerAdmissionConfigurationSchema>;
export type RunnerAdmissionProfile = z.infer<typeof profileSchema>;
export const RUNNER_IDENTITY_ISSUER = 'https://connections.vox.invalid/worker-identity';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const runnerScopeTenant = (accountId: string, space: string, agentId?: string): string => `runner-scope:${hash(canonical({ accountId, space, ...(agentId ? { agentId } : {}) }))}`;
/** Release signer computes this over non-secret exact deployment/target inventory; never sign arbitrary model input. */
export function runnerProfileConfigurationDigest(configuration: Pick<RunnerAdmissionConfiguration, 'schemaVersion' | 'sandbox'>, profile: Omit<RunnerAdmissionProfile, 'attestation'> | RunnerAdmissionProfile): string {
  return hash(canonical({ schemaVersion: configuration.schemaVersion, sandbox: configuration.sandbox, profile: {
    id: profile.id, accountId: profile.accountId, space: profile.space, ...(profile.agentId ? { agentId: profile.agentId } : {}), providerId: profile.providerId, subject: profile.subject,
    tenant: profile.tenant, displayLabel: profile.displayLabel, browserTargets: profile.browserTargets, sshTargets: profile.sshTargets,
  } }));
}
export function runnerAttestationPayload(profile: RunnerAdmissionProfile): string {
  return canonical({ version: 1, profileId: profile.id, accountId: profile.accountId, space: profile.space, ...(profile.agentId ? { agentId: profile.agentId } : {}), providerId: profile.providerId,
    subject: profile.subject, tenant: profile.tenant, issuedAt: profile.attestation.issuedAt, expiresAt: profile.attestation.expiresAt,
    evidenceReference: profile.attestation.evidenceReference, configurationDigest: profile.attestation.configurationDigest });
}
export function verifyRunnerProfile(configuration: RunnerAdmissionConfiguration, profile: RunnerAdmissionProfile, publicKey: string | KeyObject, now: number): void {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519' || !configuration.enabled ||
      profile.tenant !== runnerScopeTenant(profile.accountId, profile.space, profile.agentId) || profile.attestation.issuedAt > now + 30000 ||
      profile.attestation.expiresAt <= now || profile.attestation.expiresAt <= profile.attestation.issuedAt ||
      profile.attestation.expiresAt - profile.attestation.issuedAt > 30 * 86400000 ||
      profile.attestation.configurationDigest !== runnerProfileConfigurationDigest(configuration, profile) ||
      !verify(null, Buffer.from(runnerAttestationPayload(profile)), key, Buffer.from(profile.attestation.signature, 'base64url')))
    throw new ProviderError('runner_attestation_invalid', 'not_dispatched');
}
export interface AttestedRunnerIdentity { identity: VerifiedProviderIdentity; scopes: string[]; leaseMarker: string }
export interface RunnerAdmissionDependencies {
  now?: () => number;
  /** Trusted application dependencies for deterministic fixtures. Never wire these callbacks from an API. */
  assertConfigurationUnchanged?: () => Promise<void>;
  sandbox?: RunnerSandbox;
  browserReader?: BrowserPageReader;
  runtimeProbe?: () => Promise<{ imageId: string; seccompDigest: string }>;
  readPrivateKey?: (path: string) => Promise<string>;
}
export class RunnerAdmissionRegistry {
  private readonly configuration: RunnerAdmissionConfiguration;
  private readonly publicKey: KeyObject;
  private readonly now: () => number;
  constructor(configuration: unknown, releasePublicKey: string, private readonly dependencies: RunnerAdmissionDependencies = {}) {
    this.configuration = runnerAdmissionConfigurationSchema.parse(configuration);
    this.publicKey = createPublicKey(releasePublicKey); this.now = dependencies.now ?? Date.now;
    if (this.publicKey.asymmetricKeyType !== 'ed25519') throw new ProviderError('runner_release_key_invalid', 'not_dispatched');
  }
  private async selected(current: BrokerAuthority): Promise<RunnerAdmissionProfile> {
    await this.dependencies.assertConfigurationUnchanged?.();
    const profile = this.configuration.profiles.find(profile => profile.accountId === current.context.accountId && profile.space === current.context.scope.spaceKind && profile.providerId === current.connection.providerId && profile.agentId === (current.connection.schemaVersion === 2 ? current.connection.agentId : undefined));
    if (!profile || current.connection.ownerAccountId !== current.context.accountId || current.connection.ownerPersonId !== current.context.personId || !sameScope(current.connection.scope, current.context.scope)) throw new ProviderError('runner_attestation_scope_mismatch', 'not_dispatched');
    verifyRunnerProfile(this.configuration, profile, this.publicKey, this.now());
    return profile;
  }
  private async runtimeProof(): Promise<void> {
    const proof = this.dependencies.runtimeProbe ? await this.dependencies.runtimeProbe() : await (async () => {
      const { stdout } = await execute(this.configuration.sandbox.dockerBinary, ['--host', this.configuration.sandbox.dockerSocket, 'image', 'inspect', this.configuration.sandbox.imageId, '--format', '{{.Id}}'], { shell: false, env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', DOCKER_CONFIG: '/nonexistent' }, timeout: 3000, maxBuffer: 1000 });
      return { imageId: stdout.trim(), seccompDigest: hash(await fs.readFile(this.configuration.sandbox.seccompProfilePath)) };
    })();
    if (proof.imageId !== this.configuration.sandbox.imageId || proof.seccompDigest !== REVIEWED_SECCOMP_SHA256) throw new ProviderError('runner_runtime_unqualified', 'not_dispatched');
  }
  async enrollmentIdentity(current: BrokerAuthority): Promise<AttestedRunnerIdentity> {
    const profile = await this.selected(current); await this.runtimeProof();
    return { identity: { subject: profile.subject, tenant: profile.tenant, displayLabel: profile.displayLabel, issuer: RUNNER_IDENTITY_ISSUER },
      scopes: [profile.providerId === 'browser' ? 'worker:public_page_read' : 'worker:service_status'], leaseMarker: `runner-local:${hash(runnerAttestationPayload(profile))}` };
  }
  executorForAuthority(current: BrokerAuthority, catalog: ConnectionsCatalog, control: BrokerControlPlane): ProviderRegistry {
    const actor = { accountId: current.context.accountId }; const space = current.context.scope.spaceKind;
    const policy: RunnerPolicy = { assertCurrent: async (authorization, toolId, resources) => {
      const profile = await this.selected(current);
      if (authorization.credentialId !== profile.id || authorization.scopeKind !== space || authorization.signal?.aborted) throw new ProviderError('runner_authorization_changed', 'not_dispatched');
      const latest = await control.call<BrokerAuthority>({ action: 'context', actor, space, connectionId: current.connection.id });
      if (latest.context.personId !== current.context.personId || latest.context.bindingRevision !== current.context.bindingRevision ||
          !sameScope(latest.context.scope, current.context.scope) || latest.connection.lifecycle !== 'connected' || latest.connection.revision !== current.connection.revision || latest.connection.revocationEpoch !== current.connection.revocationEpoch) throw new ProviderError('runner_authorization_changed', 'not_dispatched');
      const reviewed = catalog.get(toolId);
      if (!reviewed || reviewed.providerId !== profile.providerId || resources.some(resource => !reviewed.resourceIds.includes(resource))) throw new ProviderError('runner_resource_denied', 'not_dispatched');
      await control.call({ action: 'assertDispatchable', actor, space, operationId: authorization.operationId });
    } };
    // Targets and sandbox are selected only after a fresh signed profile check in authorization below.
    const runnerExecutor = new ConfiguredRunnerExecutor({
      authorization: async (execution, toolId, args) => {
        const profile = await this.selected(current); await this.runtimeProof();
        const marker = `runner-local:${hash(runnerAttestationPayload(profile))}`;
        if (execution.credential.providerId !== profile.providerId || execution.credential.accessToken !== marker || execution.scopeKind !== space) throw new ProviderError('runner_lease_marker_invalid', 'not_dispatched');
        const resources = catalog.mapResources(toolId, args);
        if (resources.length !== 1) throw new ProviderError('runner_resource_denied', 'not_dispatched');
        return { operationId: idSchema.parse(execution.operationId), credentialId: profile.id, scopeKind: space, signal: execution.signal };
      },
      // Lazy implementations preserve the same signed profile and current-policy checks per boundary.
      browser: { read: async (args: unknown, authorization: Parameters<BrowserReadRunner['read']>[1]) => {
        const profile = await this.selected(current);
        const sandbox = this.dependencies.sandbox ?? new DockerRunnerSandbox(this.configuration.sandbox);
        return new BrowserReadRunner({ targets: profile.browserTargets, sandbox, policy, reader: this.dependencies.browserReader }).read(args, authorization);
      } },
      ssh: { serviceStatus: async (args: unknown, authorization: Parameters<SshReadRunner['serviceStatus']>[1]) => {
        const profile = await this.selected(current);
        const sandbox = this.dependencies.sandbox ?? new DockerRunnerSandbox(this.configuration.sandbox);
        return new SshReadRunner({ targets: profile.sshTargets, sandbox, policy, credential: async (_credentialId, hostId) => {
          const target = profile.sshTargets.find(target => target.id === hostId); if (!target || !this.dependencies.readPrivateKey) throw new ProviderError('runner_key_unavailable', 'not_dispatched');
          return { privateKey: await this.dependencies.readPrivateKey(target.privateKeyFile) };
        } }).serviceStatus(args, authorization);
      } },
    });
    return new ProviderRegistry({ catalog, runners: runnerExecutor });
  }
}
async function secureFile(path: string, expectedUid: number, maxBytes: number, publicFile = false): Promise<Buffer> {
  const stat = await fs.lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== expectedUid || (stat.mode & (publicFile ? 0o022 : 0o077)) !== 0 || stat.size > maxBytes) throw new ProviderError('runner_configuration_file_invalid', 'not_dispatched');
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new ProviderError('runner_configuration_file_invalid', 'not_dispatched');
    const buffer = Buffer.alloc(maxBytes + 1); let size = 0;
    while (size <= maxBytes) {
      const { bytesRead } = await handle.read(buffer, size, maxBytes + 1 - size, size);
      if (!bytesRead) break; size += bytesRead;
    }
    if (size > maxBytes) throw new ProviderError('runner_configuration_file_invalid', 'not_dispatched');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}
/** Production entrypoint. No users, service keys, signatures, host trust or credentials are generated here. */
export async function loadRunnerAdmissionRegistry(path: string, brokerUid: number): Promise<RunnerAdmissionRegistry> {
  if (!isAbsolute(path) || brokerUid <= 0) throw new ProviderError('runner_configuration_file_invalid', 'not_dispatched');
  const bytes = await secureFile(path, brokerUid, 200000);
  const configuration = runnerAdmissionConfigurationSchema.parse(JSON.parse(bytes.toString('utf8')));
  const publicKey = await secureFile(configuration.releasePublicKeyFile, 0, 2000, true);
  const initialConfigDigest = hash(bytes); const initialKeyDigest = hash(publicKey);
  return new RunnerAdmissionRegistry(configuration, publicKey.toString('utf8'), {
    assertConfigurationUnchanged: async () => {
      if (hash(await secureFile(path, brokerUid, 200000)) !== initialConfigDigest || hash(await secureFile(configuration.releasePublicKeyFile, 0, 2000, true)) !== initialKeyDigest || hash(await fs.readFile(configuration.sandbox.seccompProfilePath)) !== REVIEWED_SECCOMP_SHA256)
        throw new ProviderError('runner_configuration_changed', 'not_dispatched');
    },
    readPrivateKey: async keyPath => (await secureFile(keyPath, brokerUid, 16000)).toString('utf8'),
  });
}
