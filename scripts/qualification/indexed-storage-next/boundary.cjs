'use strict';
// Invoked only in a clean child env. No source node_modules fallback or outbound network.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const evidence = process.env.FIXTURE_BOUNDARY_LOG;
function log(event) { if (evidence) fs.appendFileSync(evidence, JSON.stringify({at: Date.now(), pid: process.pid, ...event}) + '\n'); }
function denied() { log({event: 'network_denied'}); const error = new Error('Synthetic boundary denies outbound network'); error.code = 'FIXTURE_NETWORK_DENIED'; throw error; }
net.Socket.prototype.connect = denied;
net.connect = denied;
net.createConnection = denied;
tls.connect = denied;
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
globalThis.fetch = async () => denied();
const originalLookup = dns.lookup;
dns.lookup = function (hostname, ...args) {
  if (!['127.0.0.1', 'localhost'].includes(hostname)) return denied();
  return originalLookup.call(this, hostname, ...args);
};
dns.promises.lookup = async hostname => {
  if (!['127.0.0.1', 'localhost'].includes(hostname)) return denied();
  return {address: '127.0.0.1', family: 4};
};
for (const name of ['resolve', 'resolve4', 'resolve6', 'reverse']) {
  dns[name] = denied;
  dns.promises[name] = async () => denied();
}
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  const first = args[0];
  const host = typeof first === 'object' ? first.host : args[1];
  const port = typeof first === 'object' ? first.port : first;
  if (!['127.0.0.1', 'localhost'].includes(host) || Number(port) !== Number(process.env.PORT)) throw new Error('fixture_listen_boundary');
  return originalListen.apply(this, args);
};
const runtimeRoot = process.env.FIXTURE_RUNTIME_ROOT;
if (runtimeRoot) {
  const root = fs.realpathSync(runtimeRoot);
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (...args) {
    const result = resolve.apply(this, args);
    if (typeof result === 'string' && path.isAbsolute(result)) {
      const real = fs.realpathSync(result);
      if (!real.startsWith(root + path.sep)) throw new Error('fixture_source_module_fallback_denied');
    }
    return result;
  };
  const loadNative = Module._extensions['.node'];
  Module._extensions['.node'] = function (module, filename) {
    const real = fs.realpathSync(filename);
    if (!real.startsWith(root + path.sep)) throw new Error('fixture_native_outside_runtime');
    log({event: 'native_loaded', path: real, sha256: crypto.createHash('sha256').update(fs.readFileSync(real)).digest('hex')});
    return loadNative(module, filename);
  };
}
log({event: 'boundary_ready', runtime: Boolean(runtimeRoot)});
