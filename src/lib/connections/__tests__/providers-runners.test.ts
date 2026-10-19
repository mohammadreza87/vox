import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { BrowserReadRunner, PinnedBrowserPageReader, type RunnerAuthorization, type RunnerPolicy } from '../runners/browser';
import { SshReadRunner, type SshHostTarget } from '../runners/ssh';
import { dockerSandboxArgs, type RunnerSandbox, type BrowserSandboxJob, type SshSandboxJob } from '../runners/sandbox';
import { ConfiguredRunnerExecutor } from '../providers/runners';
import { ProviderRegistry } from '../providers/registry';
import { createConnectionsCatalog } from '../catalog';
import { ProviderError } from '../transport';
const context: RunnerAuthorization = { operationId: 'fixture-operation', credentialId: 'fixture-credential', scopeKind: 'work' };
const allow: RunnerPolicy = { assertCurrent: async () => {} };
const browserResult = { title: 'Synthetic', text: 'Public fixture text', offline: true, javascript: false, interactive: false };
const publicKey = 'ssh-ed25519 ' + Buffer.alloc(32, 7).toString('base64');
const host: SshHostTarget = { id: 'synthetic-host', address: '192.0.2.50', port: 22, user: 'voxreader', hostPublicKey: publicKey,
  verifiedFingerprint: 'SHA256:' + createHash('sha256').update(Buffer.alloc(32, 7)).digest('base64').replace(/=+$/, ''), serviceIds: ['api'] };
function browser(options: { policy?: RunnerPolicy; result?: Record<string, unknown>; reader?: { read(): Promise<string> } } = {}) {
  const jobs: (BrowserSandboxJob | SshSandboxJob)[] = []; const reads = vi.fn(async () => '<title>Synthetic</title><body>Public fixture text</body>');
  const runner = new BrowserReadRunner({ targets: [{ id: 'public-page', url: 'https://example.com/registered' }], policy: options.policy ?? allow,
    reader: options.reader ?? { read: reads }, sandbox: { async run(job) { jobs.push(job); return { data: options.result ?? browserResult, truncated: false }; } } });
  return { runner, jobs, reads };
}
function ssh(options: { targets?: SshHostTarget[]; policy?: RunnerPolicy; sandbox?: RunnerSandbox } = {}) {
  const jobs: (BrowserSandboxJob | SshSandboxJob)[] = []; const keys = vi.fn(async () => ({ privateKey: 'synthetic-fixture-key' }));
  const runner = new SshReadRunner({ targets: options.targets ?? [host], policy: options.policy ?? allow, credential: keys,
    sandbox: options.sandbox ?? { async run(job, _signal, tunnel) { jobs.push(job); expect(tunnel).toEqual({ address: host.address, port: 22 }); return { data: { serviceId: 'api', activeState: 'active', subState: 'running' }, truncated: false }; } } });
  return { runner, jobs, keys };
}
describe('qualified read-only worker boundary', () => {
  it('has immutable image/network/rootfs/capability/process/resource fences without host mounts or sockets', () => {
    const args = dockerSandboxArgs({ imageId: 'sha256:' + 'a'.repeat(64), dockerBinary: '/usr/bin/docker', dockerSocket: 'unix:///var/run/docker.sock', seccompProfilePath: '/opt/vox/seccomp.json' }, 'vox-runner-10000000-0000-4000-8000-000000000001');
    expect(args).toEqual(expect.arrayContaining(['none', '--read-only', 'ALL', 'no-new-privileges', '10001:10001', '128', '768m', '1', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=192m,mode=1777']));
    for (const denied of ['--volume', '-v', '--mount', '--privileged', '--cap-add', '--pid', '--ipc', '--publish']) expect(args).not.toContain(denied);
    expect(() => dockerSandboxArgs({ imageId: 'latest', dockerBinary: '/usr/bin/docker', dockerSocket: 'unix:///var/run/docker.sock', seccompProfilePath: '/tmp/p' }, 'bad')).toThrow();
  });
  it('selects registered URLs server-side and passes only bounded HTML into offline Chromium', async () => {
    const { runner, jobs, reads } = browser(); const result = await runner.read({ targetId: 'public-page' }, context);
    expect(reads).toHaveBeenCalledOnce(); expect(jobs).toHaveLength(1); expect(jobs[0]).toEqual({ mode: 'browser', html: '<title>Synthetic</title><body>Public fixture text</body>' });
    expect(result.data).toMatchObject({ offline: true, javascript: false, interactive: false }); expect(result.resourceIds).toEqual(['browser:page:public-page']); expect(result.untrustedContent).toBe(true);
    await expect(runner.read({ targetId: 'public-page', url: 'https://internal.invalid' }, context)).rejects.toThrow();
    await expect(runner.read({ targetId: 'unregistered' }, context)).rejects.toMatchObject({ outcome: 'not_dispatched' }); expect(jobs).toHaveLength(1);
  });
  it('rechecks current authorization before fetch, before render and before model-visible results', async () => {
    let checks = 0; const { runner, jobs } = browser({ policy: { async assertCurrent() { if (++checks === 3) throw new ProviderError('revoked'); } } });
    await expect(runner.read({ targetId: 'public-page' }, context)).rejects.toMatchObject({ code: 'revoked' }); expect(checks).toBe(3); expect(jobs).toHaveLength(1);
  });
  it('does not fetch/render when revoked before dispatch', async () => {
    const { runner, reads, jobs } = browser({ policy: { async assertCurrent() { throw new ProviderError('revoked', 'not_dispatched'); } } });
    await expect(runner.read({ targetId: 'public-page' }, context)).rejects.toMatchObject({ code: 'revoked' }); expect(reads).not.toHaveBeenCalled(); expect(jobs).toHaveLength(0);
  });
  it('rejects worker-returned cookies/storage/scripts or a wider browser mode', async () => {
    for (const result of [{ ...browserResult, cookies: 'secret' }, { ...browserResult, javascript: true }, { ...browserResult, interactive: true }]) {
      const { runner } = browser({ result }); await expect(runner.read({ targetId: 'public-page' }, context)).rejects.toMatchObject({ code: 'browser_result_denied' });
    }
  });
  it('pins browser DNS and refuses private/mixed addresses, redirects, nonHTML and compression', async () => {
    let sends = 0; const reader = new PinnedBrowserPageReader(async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], async () => { sends++; throw new Error('must not send'); });
    await expect(reader.read({ id: 'public-page', url: 'https://example.com/exact' })).rejects.toMatchObject({ code: 'browser_address_denied' }); expect(sends).toBe(0);
    for (const [status, type, encoding] of [[302, 'text/html', 'identity'], [200, 'application/json', 'identity'], [200, 'text/html', 'gzip']] as const) {
      const safe = new PinnedBrowserPageReader(async () => [{ address: '8.8.8.8', family: 4 }], async request => { expect(request.url.href).toBe('https://example.com/exact'); expect(request.address).toBe('8.8.8.8'); return { status, headers: { 'content-type': type, 'content-encoding': encoding }, bytes: Buffer.from('<p>Synthetic</p>') }; });
      await expect(safe.read({ id: 'public-page', url: 'https://example.com/exact' })).rejects.toMatchObject({ code: 'browser_page_unavailable' });
    }
  });
  it('cancels browser fetch before DNS and accepts only bounded public HTTPS page bodies', async () => {
    const controller = new AbortController(); controller.abort(); const resolve = vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]);
    const reader = new PinnedBrowserPageReader(resolve, async () => ({ status: 200, headers: { 'content-type': 'text/html' }, bytes: Buffer.from('fixture') }));
    await expect(reader.read({ id: 'public-page', url: 'https://example.com/exact' }, controller.signal)).rejects.toMatchObject({ code: 'browser_fetch_cancelled' }); expect(resolve).not.toHaveBeenCalled();
    await expect(reader.read({ id: 'public-page', url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'browser_target_invalid' });
  });
  it('binds SSH exact host/service, verified hostkey, user and selected credential without ambient keys', async () => {
    const { runner, jobs, keys } = ssh(); const result = await runner.serviceStatus({ hostId: host.id, serviceId: 'api' }, context);
    expect(keys).toHaveBeenCalledWith('fixture-credential', host.id); expect(jobs[0]).toMatchObject({ mode: 'ssh', hostAlias: host.id, user: 'voxreader', hostPublicKey: publicKey, serviceId: 'api' });
    expect(result.data).toEqual({ hostId: host.id, serviceId: 'api', activeState: 'active', subState: 'running' }); expect(JSON.stringify(result)).not.toContain('synthetic-fixture-key');
    await expect(runner.serviceStatus({ hostId: host.id, serviceId: 'api;rm' }, context)).rejects.toThrow();
    await expect(runner.serviceStatus({ hostId: host.id, serviceId: 'unregistered' }, context)).rejects.toMatchObject({ code: 'ssh_target_unregistered' }); expect(jobs).toHaveLength(1);
  });
  it('rejects changed/unverified keys, root, DNS-selected hosts, duplicate host IDs and path-like service IDs', () => {
    for (const target of [{ ...host, verifiedFingerprint: 'SHA256:unverified' }, { ...host, user: 'root' }, { ...host, address: 'untrusted.example' }, { ...host, serviceIds: ['../../secret'] }]) expect(() => ssh({ targets: [target] })).toThrow();
    expect(() => ssh({ targets: [host, host] })).toThrow();
  });
  it('checks current SSH epoch before credential retrieval, immediately before dispatch and after read', async () => {
    let checks = 0; const { runner, jobs } = ssh({ policy: { async assertCurrent() { if (++checks === 3) throw new ProviderError('revoked'); } } });
    await expect(runner.serviceStatus({ hostId: host.id, serviceId: 'api' }, context)).rejects.toMatchObject({ code: 'revoked' }); expect(checks).toBe(3); expect(jobs).toHaveLength(1);
  });
  it('never relabels raw SSH stdout, host metadata or commands as a safe result', async () => {
    const { runner } = ssh({ sandbox: { async run() { return { data: { serviceId: 'api', activeState: 'active', subState: 'running', stdout: 'secret' }, truncated: false }; } } });
    await expect(runner.serviceStatus({ hostId: host.id, serviceId: 'api' }, context)).rejects.toMatchObject({ code: 'ssh_result_denied' });
  });
  it('integrates worker tools in the same reviewed catalog/grant registry while defaulting unavailable', async () => {
    const catalog = createConnectionsCatalog({ resourceIdsByTool: { 'browser.page.read': ['browser:page:public-page'], 'ssh.service.status': [`ssh:host:${host.id}:service:api`] }, destinationIds: ['vox:private'] });
    const { runner } = browser(); const sshSetup = ssh();
    const executor = new ConfiguredRunnerExecutor({ browser: runner, ssh: sshSetup.runner, authorization: async execution => ({ ...context, operationId: execution.operationId, scopeKind: execution.scopeKind }) });
    const registry = new ProviderRegistry({ catalog, runners: executor, transport: { async request() { throw new Error('workers must not use provider HTTP passthrough'); } } });
    for (const [toolId, args, providerId] of [['browser.page.read', { targetId: 'public-page' }, 'browser'], ['ssh.service.status', { hostId: host.id, serviceId: 'api' }, 'ssh']] as const) {
      const execution = { credential: { providerId, endpointProfileId: catalog.provider(providerId)!.endpointProfileId, accessToken: 'synthetic-worker-lease' }, operationId: context.operationId, scopeKind: context.scopeKind };
      const result = await registry.execute(toolId, args, execution); expect(result.untrustedContent).toBe(true);
      await expect(new ProviderRegistry({ catalog }).execute(toolId, args, execution)).rejects.toMatchObject({ code: 'runner_unavailable', outcome: 'not_dispatched' });
    }
    const metadata = catalog.listProviders().filter(p => ['browser', 'ssh'].includes(p.id)); expect(metadata).toHaveLength(2); for (const provider of metadata) expect(provider.releaseState).toBe('disabled_pending_qualification');
  });
  it('prevents a worker authorization changing operation or Work/Personal binding', async () => {
    const { runner } = browser(); const executor = new ConfiguredRunnerExecutor({ browser: runner, authorization: async () => ({ ...context, operationId: 'other' }) });
    await expect(executor.execute('browser.page.read', { targetId: 'public-page' }, { credential: { providerId: 'browser', endpointProfileId: 'browser-isolated', accessToken: 'synthetic' }, operationId: context.operationId, scopeKind: context.scopeKind })).rejects.toMatchObject({ code: 'runner_scope_mismatch' });
  });
});
