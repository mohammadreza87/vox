#!/usr/bin/env node
// Run with node --import tsx scripts/connections-broker.mjs. Never loads Studio dotenv/bot startup.
import { loadConnectionsBroker } from '../src/lib/connections/broker/bootstrap.ts';
import { ConnectionsError } from '../src/lib/connections/errors.ts';
const [mode, configFile, accountId, space, flowId] = process.argv.slice(2);
try {
  if (!['serve', 'check-config', 'enroll', 'subscribe', 'drain', 'enroll-runner'].includes(mode) || !configFile) throw new ConnectionsError(400, 'broker_cli_arguments_invalid');
  const { broker, control, server, configuration } = await loadConnectionsBroker(configFile);
  if (mode === 'check-config') process.stdout.write('Broker configuration and independent process identity verified. Provider account access is unverified.\n');
  else if (mode === 'serve') {
    server.listen(configuration.port, configuration.host, () => process.stdout.write('Connections broker listening on its configured loopback address.\n'));
    const shutdown = () => server.close(() => process.exit(0));
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
    server.on('error', () => { process.stderr.write('broker_server_failed\n'); process.exitCode = 1; });
  } else if (mode === 'enroll-runner') {
    if (!accountId || !['work', 'personal'].includes(space) || !flowId) throw new ConnectionsError(400, 'broker_cli_arguments_invalid');
    const receipt = await broker.operatorEnrollRunner({ actor: { accountId }, space, flowId });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } else if (mode === 'drain') {
    const { readConnectionsConfiguration } = await import('../src/lib/connections/config.ts');
    const manifest = await readConnectionsConfiguration(configuration.connectionsManifestFile);
    if (!manifest.enabled) throw new ConnectionsError(503, 'connections_paused');
    const scopes = new Map(manifest.profiles.filter(p => p.qualified).map(p => [JSON.stringify([p.accountId, p.space]), p]));
    let occurrences = 0;
    for (const profile of scopes.values()) {
      const result = await control.call({ action: 'drainWorkflows', actor: { accountId: profile.accountId }, space: profile.space, maxOccurrences: 3 });
      occurrences += result.occurrences.length;
    }
    process.stdout.write(`${JSON.stringify({ drainedOccurrences: occurrences, quiet: true })}\n`);
  } else {
    if (!accountId || !['work', 'personal'].includes(space) || !flowId || process.stdin.isTTY) throw new ConnectionsError(400, 'broker_operator_stdin_required');
    const chunks = []; let bytes = 0;
    for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 16001) throw new ConnectionsError(413, 'broker_operator_input_limit'); chunks.push(chunk); }
    const accessToken = Buffer.concat(chunks).toString('utf8').trim();
    if (!accessToken || /[^\x21-\x7e]/.test(accessToken)) throw new ConnectionsError(400, 'broker_operator_input_invalid');
    const receipt = mode === 'subscribe' ? await broker.registerEventSubscription({ actor: { accountId }, space, ...JSON.parse(flowId), secret: Buffer.from(accessToken, 'utf8') }) : await broker.operatorEnroll({ actor: { accountId }, space, flowId, accessToken });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof ConnectionsError ? error.code : 'broker_startup_failed'}\n`);
  process.exitCode = 1;
}
