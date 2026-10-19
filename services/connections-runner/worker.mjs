import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from '/opt/vox/node_modules/playwright-core/index.mjs';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let activeSocket;
let job;
let started = false;
let received = 0;
const fail = () => { send({ kind: 'error', code: 'runner_failed' }); process.exitCode = 1; lines.close(); };
async function browserRead(request) {
  if (typeof request.html !== 'string' || Buffer.byteLength(request.html) > 128000) throw new Error('invalid');
  await mkdir('/tmp/vox-home', { mode: 0o700, recursive: true });
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, args: ['--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-breakpad', '--no-first-run', '--disable-component-update', '--disable-default-apps'] });
  try {
    const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    page.on('popup', popup => popup.close());
    page.on('download', download => download.cancel());
    page.on('dialog', dialog => dialog.dismiss());
    const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'">' + request.html;
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const title = (await page.title()).slice(0, 500);
    const text = (await page.locator('body').innerText({ timeout: 3000 })).slice(0, 32000);
    // Browser execution is offline. URL, cookies, storage, screenshots and hidden DOM never leave the worker.
    send({ kind: 'result', data: { title, text, offline: true, javascript: false, interactive: false }, truncated: text.length >= 32000 });
    await context.close();
  } finally { await browser.close(); }
}
async function sshRead(request) {
  if (typeof request.hostAlias !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(request.hostAlias) || typeof request.user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(request.user) || request.user === 'root' || typeof request.privateKey !== 'string' || request.privateKey.length > 16000 || typeof request.hostPublicKey !== 'string' || !/^(ssh-ed25519|ecdsa-sha2-nistp256) [A-Za-z0-9+/=]{32,1200}$/.test(request.hostPublicKey) || !/^[A-Za-z0-9_-]{1,100}$/.test(request.serviceId)) throw new Error('invalid');
  const directory = await mkdtemp(join(tmpdir(), 'vox-ssh-'));
  let server;
  try {
    const keyPath = join(directory, 'key'); const hostsPath = join(directory, 'known_hosts'); const socketPath = join(directory, 'proxy.sock');
    await writeFile(keyPath, request.privateKey, { mode: 0o600 });
    await writeFile(hostsPath, `${request.hostAlias} ${request.hostPublicKey}\n`, { mode: 0o600 });
    server = createServer(socket => {
      if (activeSocket) { socket.destroy(); return; }
      activeSocket = socket;
      socket.on('data', data => send({ kind: 'tcp', data: data.toString('base64') }));
      socket.on('end', () => send({ kind: 'tcp_end' }));
      socket.on('error', () => {});
      send({ kind: 'tcp_ready' });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const args = ['-F', '/dev/null', '-T', '-i', keyPath, '-o', `UserKnownHostsFile=${hostsPath}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=yes', '-o', `HostKeyAlias=${request.hostAlias}`, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'ForwardAgent=no', '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=1', '-o', `ProxyCommand=node /opt/vox/tunnel-proxy.mjs ${socketPath}`, '--', `${request.user}@${request.hostAlias}`, 'vox-runbook-v1'];
    const child = spawn('/usr/bin/ssh', args, { env: { PATH: '/usr/bin:/bin', HOME: '/tmp/vox-home', LANG: 'C' }, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let output = ''; let size = 0;
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 64000) child.kill('SIGKILL'); else output += chunk.toString(); });
    child.stderr.resume(); // SSH diagnostics may contain host names; never forward or log them.
    child.stdin.end(JSON.stringify({ protocol: 'vox-runbook/1', operationId: request.operationId, runbook: 'service.status', serviceId: request.serviceId }) + '\n');
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    if (code !== 0 || size > 64000) throw new Error('ssh_failed');
    const result = JSON.parse(output);
    if (result.protocol !== 'vox-runbook/1' || result.operationId !== request.operationId || result.serviceId !== request.serviceId || !['active', 'inactive', 'failed', 'activating', 'deactivating', 'unknown'].includes(result.activeState) || typeof result.subState !== 'string' || !/^[a-z-]{1,80}$/.test(result.subState)) throw new Error('invalid');
    send({ kind: 'result', data: { serviceId: result.serviceId, activeState: result.activeState, subState: result.subState }, truncated: false });
  } finally { activeSocket?.destroy(); server?.close(); await rm(directory, { recursive: true, force: true }); }
}
lines.on('line', line => {
  received += Buffer.byteLength(line);
  if (received > 4000000 || Buffer.byteLength(line) > 256000) { fail(); return; }
  let data;
  try { data = JSON.parse(line); } catch { fail(); return; }
  if (!started) {
    started = true; job = data;
    Promise.resolve(job.mode === 'browser' ? browserRead(job) : job.mode === 'ssh' ? sshRead(job) : Promise.reject(new Error('invalid'))).then(() => { lines.close(); process.stdin.destroy(); }).catch(fail);
  } else if (data.kind === 'tcp' && activeSocket && typeof data.data === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(data.data) && data.data.length <= 128000) activeSocket.write(Buffer.from(data.data, 'base64'));
  else if (data.kind === 'tcp_end' && activeSocket) activeSocket.end();
  else fail();
});
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
