/** Serve the compiled standalone artifact with the same static/public layout as
 * studio-production install. This changes only ignored build output. */
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve('.'), built = resolve('.next/standalone');
if (!existsSync(`${built}/server.js`)) throw new Error('Build the standalone application first');
cpSync(`${root}/.next/static`, `${built}/.next/static`, { recursive: true });
if (existsSync(`${root}/public`)) cpSync(`${root}/public`, `${built}/public`, { recursive: true });
const child = spawn(process.execPath, [`${built}/server.js`], {
  cwd: built, stdio: 'inherit', env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3104' },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => process.exit(1));
child.on('exit', code => process.exit(code ?? 1));
