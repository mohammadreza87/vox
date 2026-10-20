/** Fixture provenance only. This never writes or substitutes an install/release manifest. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
