import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { isIP } from 'node:net';
import { ProviderError } from '../transport';
export interface BrowserSandboxJob { mode: 'browser'; html: string }
export interface SshSandboxJob { mode: 'ssh'; operationId: string; hostAlias: string; user: string; privateKey: string; hostPublicKey: string; serviceId: string }
export interface RunnerSandboxResult { data: Record<string, unknown>; truncated: boolean }
export interface PinnedSshTunnel { address: string; port: number }
export interface RunnerSandbox {
  run(job: BrowserSandboxJob | SshSandboxJob, signal?: AbortSignal, tunnel?: PinnedSshTunnel): Promise<RunnerSandboxResult>;
}
export interface DockerSandboxConfig {
  /** Immutable locally reviewed image ID; floating tags are forbidden. */
  imageId: string;
  dockerBinary: string;
  dockerSocket: string;
  seccompProfilePath: string;
}
export const REVIEWED_SECCOMP_SHA256 = '513c31efdc06215e0c5c84cc60cbef110ea619962df9e78d62a68633094cbeab';
export function dockerSandboxArgs(config: DockerSandboxConfig, name: string): string[] {
  if (!/^sha256:[0-9a-f]{64}$/.test(config.imageId) || !/^\/[^\u0000\r\n]{1,500}$/.test(config.dockerBinary) ||
      !/^unix:\/\/\/[^\u0000\r\n]{1,500}$/.test(config.dockerSocket) || !/^\/[^\u0000\r\n]{1,500}$/.test(config.seccompProfilePath) || !/^vox-runner-[0-9a-f-]{36}$/.test(name)) throw new ProviderError('runner_configuration_invalid', 'not_dispatched');
  return ['--host', config.dockerSocket, 'run', '--pull', 'never', '--rm', '--init', '-i', '--name', name,
    '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--security-opt', `seccomp=${config.seccompProfilePath}`,
    '--user', '10001:10001', '--pids-limit', '128', '--memory', '768m', '--cpus', '1', '--shm-size', '128m',
    '--ulimit', 'nofile=256:256', '--ulimit', 'core=0:0', '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=192m,mode=1777', config.imageId];
}
/** Dedicated orchestration service only. The Docker socket is never mounted in a worker. */
export class DockerRunnerSandbox implements RunnerSandbox {
  constructor(private readonly config: DockerSandboxConfig) {
    dockerSandboxArgs(config, `vox-runner-${randomUUID()}`);
    if (createHash('sha256').update(readFileSync(config.seccompProfilePath)).digest('hex') !== REVIEWED_SECCOMP_SHA256) throw new ProviderError('runner_seccomp_unreviewed', 'not_dispatched');
  }
  async run(job: BrowserSandboxJob | SshSandboxJob, signal?: AbortSignal, tunnel?: PinnedSshTunnel): Promise<RunnerSandboxResult> {
    if ((job.mode === 'ssh') !== !!tunnel || (tunnel && (!isIP(tunnel.address) || !Number.isInteger(tunnel.port) || tunnel.port < 1 || tunnel.port > 65535))) throw new ProviderError('runner_target_invalid', 'not_dispatched');
    if (Buffer.byteLength(JSON.stringify(job)) > 160000 || signal?.aborted) throw new ProviderError('runner_cancelled', 'not_dispatched');
    if (createHash('sha256').update(readFileSync(this.config.seccompProfilePath)).digest('hex') !== REVIEWED_SECCOMP_SHA256) throw new ProviderError('runner_seccomp_unreviewed', 'not_dispatched');
    const name = `vox-runner-${randomUUID()}`; let socket: Socket | undefined;
    const child = spawn(this.config.dockerBinary, dockerSandboxArgs(this.config, name), { shell: false, env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', DOCKER_CONFIG: '/nonexistent' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let outputBytes = 0; let tunnelBytes = 0; let result: RunnerSandboxResult | undefined; let failed = false; let tunnelStarted = false;
    const stop = () => { failed = true; socket?.destroy(); child.kill('SIGKILL'); };
    const timer = setTimeout(stop, 20000); signal?.addEventListener('abort', stop, { once: true });
    child.stderr.resume(); // Docker/SSH diagnostics are not application logs.
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length; if (outputBytes > 1_000_000) { stop(); return; }
      output += chunk.toString('utf8'); if (output.length > 256000) { stop(); return; }
      let newline: number;
      while ((newline = output.indexOf('\n')) >= 0) {
        const line = output.slice(0, newline); output = output.slice(newline + 1);
        let frame: Record<string, unknown>;
        try { frame = JSON.parse(line); } catch { stop(); return; }
        if (frame.kind === 'result' && !result && frame.data && typeof frame.data === 'object' && !Array.isArray(frame.data)) {
          result = { data: frame.data as Record<string, unknown>, truncated: frame.truncated === true };
        } else if (frame.kind === 'tcp_ready' && tunnel && !tunnelStarted) {
          tunnelStarted = true;
          // The socket destination is a server-inventory IP. No DNS or supplied hostnames reach connect().
          socket = connect({ host: tunnel.address, port: tunnel.port });
          socket.on('data', data => {
            tunnelBytes += data.length; if (tunnelBytes > 512000) { stop(); return; }
            child.stdin.write(JSON.stringify({ kind: 'tcp', data: data.toString('base64') }) + '\n');
          });
          socket.on('end', () => child.stdin.write('{"kind":"tcp_end"}\n'));
          socket.on('error', stop);
        } else if (frame.kind === 'tcp' && tunnel && socket && typeof frame.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(frame.data) && frame.data.length <= 128000) {
          const data = Buffer.from(frame.data, 'base64'); tunnelBytes += data.length; if (tunnelBytes > 512000) { stop(); return; } socket.write(data);
        } else if (frame.kind === 'tcp_end' && tunnel && socket) socket.end();
        else { stop(); return; }
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify(job) + '\n');
    if (job.mode === 'browser') child.stdin.end();
    try {
      const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      if (failed || code !== 0 || !result || output.trim() || signal?.aborted) throw new ProviderError(signal?.aborted ? 'runner_cancelled' : 'runner_execution_failed');
      if (Buffer.byteLength(JSON.stringify(result)) > 128000) throw new ProviderError('runner_result_too_large');
      return result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('runner_execution_failed');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', stop); socket?.destroy(); child.stdin.destroy();
      // Cancellation of the CLI does not prove its container exited; explicit bounded removal follows every run.
      await new Promise<void>(resolve => {
        const cleanup = spawn(this.config.dockerBinary, ['--host', this.config.dockerSocket, 'rm', '--force', name], { shell: false, env: { NODE_ENV: 'production', PATH: '/usr/bin:/bin', DOCKER_CONFIG: '/nonexistent' }, stdio: 'ignore' });
        const timer = setTimeout(() => { cleanup.kill('SIGKILL'); resolve(); }, 5000);
        cleanup.once('error', () => { clearTimeout(timer); resolve(); }); cleanup.once('close', () => { clearTimeout(timer); resolve(); });
      });
    }
  }
}
