/** Fixture provenance only. This never writes or substitutes an install/release manifest. */
import { existsSync, readFileSync, lstatSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export function guestFixtureBuildMetadata(root) {
  const buildId = readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim();
  const standaloneId = readFileSync(join(root, '.next', 'standalone', '.next', 'BUILD_ID'), 'utf8').trim();
  if (!buildId || buildId !== standaloneId || !existsSync(join(root, '.next', 'standalone', 'server.js'))) throw Error('Guest fixture standalone BUILD_ID mismatch or incomplete build');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const revision = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
  const path = join(root, '.next', 'studio-release.json');
  if (!existsSync(path)) return { metadataSource: 'next-build-source-binding', revision, sourceTree, buildId, releaseManifestPresent: false };
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest.buildId !== buildId || manifest.revision !== revision || manifest.sourceTree !== sourceTree) throw Error('Guest fixture release manifest/source mismatch');
  return { metadataSource: 'studio-release-manifest', revision, sourceTree, buildId, releaseManifestPresent: true, builtAt: manifest.builtAt };
}

const PROOF = '.next/fro1-fixture-build-v1.json';
const INPUTS = ['.next/standalone', '.next/static', 'public'];
function actualSource(root, expectedRevision) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const revision = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
  if (git('status', '--porcelain=v1') || expectedRevision && revision !== expectedRevision) throw Error('Fixture build source is not the exact clean checkout');
  return { revision, sourceTree };
}
function payload(root) {
  const entries = [];
  const visit = path => {
    if (/^\.env(?:\.|$)/.test(basename(path))) throw Error('Fixture build contains an excluded environment entry');
    const info = lstatSync(path);
    if (info.isDirectory()) { for (const name of readdirSync(path)) visit(join(path, name)); }
    else if (info.isFile() || info.isSymbolicLink()) entries.push({ path, name: relative(root, path).replaceAll('\\', '/'), info });
    else throw Error('Fixture build contains an unsupported entry');
  };
  for (const input of INPUTS) visit(join(root, input));
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
  const hash = createHash('sha256'); let files = 0, bytes = 0, links = 0;
  for (const entry of entries) {
    if (entry.info.isSymbolicLink()) { hash.update(`L\0${entry.name}\0${readlinkSync(entry.path)}\0`); links++; }
    else { const value = readFileSync(entry.path); hash.update(`F\0${entry.name}\0${value.length}\0`).update(value); files++; bytes += value.length; }
    const after = lstatSync(entry.path);
    if (after.dev !== entry.info.dev || after.ino !== entry.info.ino || after.size !== entry.info.size || after.mtimeMs !== entry.info.mtimeMs) throw Error('Fixture build changed while hashing');
  }
  return { inputs: INPUTS, files, bytes, links, sha256: hash.digest('hex') };
}
/** Source-only QA receipt made after the actual build, before artifact upload. */
export function writeGuestFixtureBuildProof(root, expectedRevision) {
  const source = actualSource(root, expectedRevision), build = guestFixtureBuildMetadata(root);
  const value = { version: 1, kind: 'vox-next-fixture-build', ...source, buildId: build.buildId, payload: payload(root) };
  writeFileSync(join(root, PROOF), JSON.stringify(value) + '\n', { mode: 0o600 });
  return value;
}
export function verifyGuestFixtureBuildProof(root, expectedRevision) {
  const source = actualSource(root, expectedRevision), path = join(root, PROOF), info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw Error('Unsafe fixture build proof');
  const raw = readFileSync(path), value = JSON.parse(raw.toString('utf8')), build = guestFixtureBuildMetadata(root);
  if (Object.keys(value).sort().join() !== 'buildId,kind,payload,revision,sourceTree,version' || value.version !== 1 || value.kind !== 'vox-next-fixture-build' || value.revision !== source.revision || value.sourceTree !== source.sourceTree || value.buildId !== build.buildId || JSON.stringify(value.payload) !== JSON.stringify(payload(root))) throw Error('Fixture build proof/source/artifact mismatch');
  return { ...value, proofSha256: createHash('sha256').update(raw).digest('hex') };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve('.'), command = process.argv[2];
  if (process.argv.length !== 3 || !['--write-build-proof', '--qualify-runtime-owner'].includes(command)) throw Error('Explicit fixture build proof command required');
  if (command === '--write-build-proof') console.log('FRO1_NEXT_BUILD_PROOF', JSON.stringify(writeGuestFixtureBuildProof(root, process.env.GITHUB_SHA)));
  else {
    const proof = verifyGuestFixtureBuildProof(root, process.env.GITHUB_SHA);
    const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=actual built Next', 'scripts/studio-runtime-owner.test.mjs'], { cwd: root, stdio: 'inherit', env: {
      ...process.env, FRO1_BUILT_NEXT: '1', FRO1_EXPECTED_REVISION: proof.revision, FRO1_EXPECTED_TREE: proof.sourceTree,
      FRO1_EXPECTED_BUILD_ID: proof.buildId, FRO1_BUILD_PROOF_SHA256: proof.proofSha256,
    } });
    if (result.error || result.signal) throw Error('Built runtime ownership fixture process failed');
    process.exitCode = result.status ?? 1;
  }
}
