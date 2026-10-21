import { createServer } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
const run = promisify(execFile);
it('actual TLS sender pins socket, preserves original SNI and checks authority before credential bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vox-mcp-tls-fixture-'));
  const key = join(directory, 'key.pem'); const cert = join(directory, 'cert.pem');
  let requests = 0; let servername: string | undefined;
  const server = createServer();
  try {
    await run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=mcp.fixture.net', '-addext', 'subjectAltName=DNS:mcp.fixture.net']);
    server.setSecureContext({ key: await readFile(key), cert: await readFile(cert) });
    server.on('secureConnection', socket => { servername = socket.servername; });
    server.on('request', (req, res) => { requests++; expect(req.headers.authorization).toBe('Bearer synthetic-tls-secret'); res.end('{}'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port;
    const modulePath = join(process.cwd(), 'src/lib/connections/mcp/transport.ts');
    const script = (deny: boolean) => `import { sendMcpPinnedHttps } from ${JSON.stringify(modulePath)};
      try { const result = await sendMcpPinnedHttps({ url:new URL('https://mcp.fixture.net:${port}/mcp'),address:'127.0.0.1',family:4,method:'POST',headers:{authorization:'Bearer synthetic-tls-secret'},body:'{}',timeoutMs:3000,maxResponseBytes:1000,beforeSend:async()=>{${deny ? "throw new Error('authority withdrawn')" : ''}} }); process.stdout.write(String(result.status)); }
      catch(error) { process.stdout.write(error.code || 'tls_rejected'); }`;
    // Explicit test CA only in these isolated fixture children; production always uses the normal trusted roots.
    const env = { ...process.env, NODE_EXTRA_CA_CERTS: cert };
    const accepted = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script(false)], { env });
    expect(accepted.stdout).toBe('200'); expect(servername).toBe('mcp.fixture.net'); expect(requests).toBe(1);
    const denied = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script(true)], { env });
    expect(denied.stdout).toBe('mcp_authority_withdrawn'); expect(requests).toBe(1);
    const untrusted = await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script(false)], { env: { ...process.env, NODE_EXTRA_CA_CERTS: '' } });
    expect(untrusted.stdout).toBe('mcp_network_failed'); expect(requests).toBe(1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}, 15000);
