import { z } from 'zod';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ProviderError } from '../transport';
import { componentId } from '../providers/normalization';
import type { ProviderResult } from '../providers/types';
import type { RunnerSandbox } from './sandbox';
import type { RunnerAuthorization, RunnerPolicy } from './browser';
export const sshServiceStatusSchema = z.object({ hostId: componentId.max(80), serviceId: componentId.max(80) }).strict();
export interface SshHostTarget {
  id: string; address: string; port: number; user: string;
  hostPublicKey: string; verifiedFingerprint: string;
  serviceIds: readonly string[];
}
export interface SshRunnerCredential { privateKey: string }
export class SshReadRunner {
  private readonly targets: ReadonlyMap<string, SshHostTarget>;
  constructor(private readonly options: { targets: readonly SshHostTarget[]; sandbox: RunnerSandbox; policy: RunnerPolicy; credential: (credentialId: string, hostId: string) => Promise<SshRunnerCredential> }) {
    this.targets = new Map(options.targets.map(target => {
      componentId.max(80).parse(target.id);
      if (!isIP(target.address) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535 || !/^[a-z_][a-z0-9_-]{0,31}$/.test(target.user) || target.user === 'root' || !/^(ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{32,1200}$/.test(target.hostPublicKey) || !target.serviceIds.length || target.serviceIds.some(id => !componentId.max(80).safeParse(id).success)) throw new ProviderError('ssh_inventory_invalid', 'not_dispatched');
      const publicBytes = Buffer.from(target.hostPublicKey.split(' ')[1], 'base64');
      const fingerprint = 'SHA256:' + createHash('sha256').update(publicBytes).digest('base64').replace(/=+$/, '');
      const expected = Buffer.from(target.verifiedFingerprint); const actual = Buffer.from(fingerprint);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ProviderError('ssh_host_key_unverified', 'not_dispatched');
      return [target.id, Object.freeze({ ...target, serviceIds: Object.freeze([...target.serviceIds]) })];
    }));
    if (this.targets.size !== options.targets.length) throw new ProviderError('ssh_inventory_invalid', 'not_dispatched');
  }
  async serviceStatus(raw: unknown, context: RunnerAuthorization): Promise<ProviderResult> {
    const args = sshServiceStatusSchema.parse(raw); const target = this.targets.get(args.hostId); const resources = [`ssh:host:${args.hostId}:service:${args.serviceId}`];
    if (!target || !target.serviceIds.includes(args.serviceId)) throw new ProviderError('ssh_target_unregistered', 'not_dispatched');
    await this.options.policy.assertCurrent(context, 'ssh.service.status', resources);
    const credential = await this.options.credential(context.credentialId, args.hostId);
    if (!credential.privateKey || credential.privateKey.length > 16000) throw new ProviderError('ssh_credential_invalid', 'not_dispatched');
    await this.options.policy.assertCurrent(context, 'ssh.service.status', resources);
    const result = await this.options.sandbox.run({ mode: 'ssh', operationId: context.operationId, hostAlias: target.id, user: target.user,
      privateKey: credential.privateKey, hostPublicKey: target.hostPublicKey, serviceId: args.serviceId }, context.signal, { address: target.address, port: target.port });
    await this.options.policy.assertCurrent(context, 'ssh.service.status', resources);
    const parsed = z.object({ serviceId: z.literal(args.serviceId), activeState: z.enum(['active', 'inactive', 'failed', 'activating', 'deactivating', 'unknown']), subState: z.string().regex(/^[a-z-]{1,80}$/) }).strict().safeParse(result.data);
    if (!parsed.success || context.signal?.aborted || JSON.stringify(result.data).includes(credential.privateKey)) throw new ProviderError('ssh_result_denied');
    return { data: { ...parsed.data, hostId: args.hostId }, resourceIds: resources, providerReceiptRef: null, resourceRevision: null, untrustedContent: true, truncated: false };
  }
}
