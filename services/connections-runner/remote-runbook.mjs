#!/usr/bin/node
// Install as a root-owned executable forced command for the dedicated unprivileged SSH user.
// authorized_keys: restrict,command="/usr/local/libexec/vox-runbook" <dedicated-public-key>
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
try {
  if (process.getuid?.() === 0 || process.env.SSH_ORIGINAL_COMMAND !== 'vox-runbook-v1') throw new Error('denied');
  const input = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { process.stdin.destroy(); reject(new Error('denied')); }, 5000);
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > 1000) { clearTimeout(timer); process.stdin.destroy(); reject(new Error('denied')); }
      else chunks.push(chunk);
    });
    process.stdin.once('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
    process.stdin.once('error', () => { clearTimeout(timer); reject(new Error('denied')); });
  });
  const request = JSON.parse(input);
  if (Object.keys(request).sort().join(',') !== 'operationId,protocol,runbook,serviceId' || request.protocol !== 'vox-runbook/1' || request.runbook !== 'service.status' || !/^[A-Za-z0-9_.:@/-]{1,200}$/.test(request.operationId) || !/^[A-Za-z0-9_-]{1,100}$/.test(request.serviceId)) throw new Error('denied');
  // Root-owned immutable mapping; clients provide only a registered opaque service ID.
  const inventory = JSON.parse(readFileSync('/etc/vox-runner/services.json', 'utf8'));
  const unit = inventory[request.serviceId];
  if (typeof unit !== 'string' || !/^[A-Za-z0-9_.@-]{1,160}\.service$/.test(unit) || unit.startsWith('-')) throw new Error('denied');
  const child = spawnSync('/usr/bin/systemctl', ['show', '--property=ActiveState,SubState', '--', unit], { env: { PATH: '/usr/bin:/bin', LANG: 'C' }, encoding: 'utf8', timeout: 5000, maxBuffer: 4000, shell: false });
  if (child.status !== 0) throw new Error('failed');
  const fields = Object.fromEntries(child.stdout.trim().split('\n').map(line => line.split('=')));
  if (!['active', 'inactive', 'failed', 'activating', 'deactivating', 'unknown'].includes(fields.ActiveState) || !/^[a-z-]{1,80}$/.test(fields.SubState ?? '')) throw new Error('failed');
  process.stdout.write(JSON.stringify({ protocol: 'vox-runbook/1', operationId: request.operationId, serviceId: request.serviceId, activeState: fields.ActiveState, subState: fields.SubState }) + '\n');
} catch { process.stderr.write('runbook_denied\n'); process.exitCode = 1; }
