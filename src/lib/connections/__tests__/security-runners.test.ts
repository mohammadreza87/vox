import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { BrowserReadRunner } from '../runners/browser';
import { SshReadRunner } from '../runners/ssh';
import { dockerSandboxArgs } from '../runners/sandbox';

const context = { operationId: 'qa-operation', credentialId: 'qa-credential', scopeKind: 'work' as const };
describe('independent narrow worker source boundaries (no Docker or host contacted)', () => {
  it('pins the container image and restrictive runtime flags without host mounts or ambient network', () => {
    const config = { imageId: `sha256:${'a'.repeat(64)}`, dockerBinary: '/usr/local/bin/docker', dockerSocket: 'unix:///var/run/qa-docker.sock', seccompProfilePath: '/qa/reviewed-seccomp.json' };
    const args = dockerSandboxArgs(config, 'vox-runner-00000000-0000-0000-0000-000000000000');
    expect(args).toEqual(expect.arrayContaining(['--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
      'no-new-privileges', '--user', '10001:10001', '--pids-limit', '128', '--memory', '768m', '--cpus', '1', 'core=0:0']));
    expect(args).not.toContain('--privileged'); expect(args).not.toContain('--volume'); expect(args).not.toContain('--mount');
    expect(() => dockerSandboxArgs({ ...config, imageId: 'qa-runner:latest' }, 'vox-runner-00000000-0000-0000-0000-000000000000')).toThrow('runner_configuration_invalid');
  });

  it('unregistered browser targets and arbitrary URL/schema additions fail before reader or sandbox', async () => {
    const reader = { read: vi.fn(async () => '<p>synthetic</p>') }; const sandbox = { run: vi.fn() };
    const policy = { assertCurrent: vi.fn(async () => undefined) };
    const runner = new BrowserReadRunner({ targets: [{ id: 'qa-page', url: 'https://qa.example.invalid/page' }], reader, sandbox, policy });
    await expect(runner.read({ targetId: 'unregistered' }, context)).rejects.toThrow('browser_target_unregistered');
    await expect(runner.read({ targetId: 'qa-page', url: 'http://169.254.169.254/' }, context)).rejects.toThrow();
    expect(reader.read).not.toHaveBeenCalled(); expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('browser policy revocation after capture prevents handing page content to a worker', async () => {
    const sandbox = { run: vi.fn() }; let current = true;
    const runner = new BrowserReadRunner({ targets: [{ id: 'qa-page', url: 'https://qa.example.invalid/page' }], sandbox,
      reader: { read: vi.fn(async () => { current = false; return '<p>PRIVATE_CAPTURE_CANARY</p>'; }) },
      policy: { assertCurrent: async () => { if (!current) throw new Error('synthetic policy revoked'); } } });
    await expect(runner.read({ targetId: 'qa-page' }, context)).rejects.toThrow('synthetic policy revoked');
    expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('browser output cannot claim an interactive or JavaScript-enabled session', async () => {
    const runner = new BrowserReadRunner({ targets: [{ id: 'qa-page', url: 'https://qa.example.invalid/page' }],
      reader: { read: async () => '<p>synthetic</p>' }, policy: { assertCurrent: async () => undefined },
      sandbox: { run: async () => ({ data: { title: 'QA', text: 'Synthetic', offline: false, javascript: true, interactive: true }, truncated: false }) } });
    await expect(runner.read({ targetId: 'qa-page' }, context)).rejects.toThrow('browser_result_denied');
  });

  const publicBytes = Buffer.alloc(40, 91); const hostPublicKey = `ssh-ed25519 ${publicBytes.toString('base64')}`;
  const target = { id: 'qa-host', address: '192.0.2.7', port: 22, user: 'vox_readonly', hostPublicKey,
    verifiedFingerprint: `SHA256:${createHash('sha256').update(publicBytes).digest('base64').replace(/=+$/, '')}`, serviceIds: ['qa-service'] };
  it('SSH requires a non-root inventory user and independently pinned host fingerprint', () => {
    const rest = { sandbox: { run: vi.fn() }, policy: { assertCurrent: vi.fn() }, credential: vi.fn() };
    expect(() => new SshReadRunner({ ...rest, targets: [{ ...target, user: 'root' }] })).toThrow('ssh_inventory_invalid');
    expect(() => new SshReadRunner({ ...rest, targets: [{ ...target, verifiedFingerprint: 'SHA256:untrusted' }] })).toThrow('ssh_host_key_unverified');
    expect(rest.credential).not.toHaveBeenCalled();
  });

  it('SSH rejects unregistered service/free command before credential release', async () => {
    const credential = vi.fn(); const sandbox = { run: vi.fn() };
    const runner = new SshReadRunner({ targets: [target], credential, sandbox, policy: { assertCurrent: async () => undefined } });
    await expect(runner.serviceStatus({ hostId: target.id, serviceId: 'unregistered' }, context)).rejects.toThrow('ssh_target_unregistered');
    await expect(runner.serviceStatus({ hostId: target.id, serviceId: 'qa-service', command: 'cat /secrets' }, context)).rejects.toThrow();
    expect(credential).not.toHaveBeenCalled(); expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('SSH rechecks current policy after secret retrieval and before sandbox transmission', async () => {
    let current = true; const sandbox = { run: vi.fn() };
    const runner = new SshReadRunner({ targets: [target], sandbox,
      credential: async () => { current = false; return { privateKey: 'SYNTHETIC_PRIVATE_KEY' }; },
      policy: { assertCurrent: async () => { if (!current) throw new Error('synthetic grant revoked'); } } });
    await expect(runner.serviceStatus({ hostId: target.id, serviceId: 'qa-service' }, context)).rejects.toThrow('synthetic grant revoked');
    expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('SSH rejects unreviewed output fields that could carry private key material', async () => {
    const runner = new SshReadRunner({ targets: [target], credential: async () => ({ privateKey: 'SYNTHETIC_PRIVATE_KEY' }),
      policy: { assertCurrent: async () => undefined }, sandbox: { run: async () => ({ data: { serviceId: 'qa-service', activeState: 'active', subState: 'running', extra: 'SYNTHETIC_PRIVATE_KEY' }, truncated: false }) } });
    await expect(runner.serviceStatus({ hostId: target.id, serviceId: 'qa-service' }, context)).rejects.toThrow('ssh_result_denied');
  });
});
