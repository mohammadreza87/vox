#!/usr/bin/env node
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { isAbsolute, resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const [output] = process.argv.slice(2);
if (!output || process.argv.length !== 3 || !isAbsolute(output) || git('status', '--porcelain')) throw Error('A clean committed source and a new absolute output directory are required');
await mkdir(output, { mode: 0o700 });
const revision = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/connections-broker.mjs'], bundle: true,
  platform: 'node', target: 'node22', format: 'esm', write: false, metafile: true });
if (bundle.outputFiles.length !== 1 || Object.values(bundle.metafile.outputs).some(row => row.imports.some(i => i.external &&
    !i.path.startsWith('node:') && !['crypto', 'fs', 'path', 'http', 'https'].includes(i.path)))) throw Error('Unexpected broker runtime dependency');
await writeFile(join(output, 'broker.mjs'), bundle.outputFiles[0].contents, { mode: 0o500, flag: 'wx' });
for (const [dependency, license] of [['zod', 'LICENSE'], ['jose', 'LICENSE.md']])
  await copyFile(join(root, 'node_modules', dependency, license), join(output, `${dependency}-LICENSE.txt`));
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== revision) throw Error('Source changed during broker build');
const files = {};
for (const name of ['broker.mjs', 'zod-LICENSE.txt', 'jose-LICENSE.txt']) files[name] = createHash('sha256').update(await readFile(join(output, name))).digest('hex');
const receipt = { revision, sourceTree, builtAt: new Date().toISOString(), files, bundledThirdParty: ['zod', 'jose'],
  qualification: 'Build artifact only; independent review, isolation proof and live provider journey remain separate.' };
await writeFile(join(output, 'artifact.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(receipt));
