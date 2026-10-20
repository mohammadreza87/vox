import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const checks = {};
  for (const [label, action] of [
    ['fetch', () => fetch('https://example.invalid/never')],
    ['net', () => net.connect({host: '198.51.100.10', port: 443})],
    ['tls', () => tls.connect({host: '198.51.100.10', port: 443})],
    ['http', () => http.get('http://198.51.100.10/never')],
    ['https', () => https.get('https://198.51.100.10/never')],
    ['dns', () => dns.lookup('example.invalid', () => undefined)],
    ['resolve', () => dns.resolve4('example.invalid', () => undefined)],
  ]) {
    try { await action(); checks[label] = false; }
    catch (error) { checks[label] = error?.code === 'FIXTURE_NETWORK_DENIED'; }
  }
  return Response.json({checks}, {status: Object.values(checks).every(Boolean) ? 200 : 500});
}
