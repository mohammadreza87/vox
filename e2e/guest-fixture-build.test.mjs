import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { guestFixtureBuildMetadata } from './guest-fixture-build.mjs';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'vox-guest-build-metadata-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q');git('-c','user.name=Synthetic','-c','user.email=synthetic@invalid.test','commit','--allow-empty','-qm','synthetic');
  mkdirSync(join(root,'.next','standalone','.next'),{recursive:true});
  writeFileSync(join(root,'.next','BUILD_ID'),'synthetic-build');
  writeFileSync(join(root,'.next','standalone','.next','BUILD_ID'),'synthetic-build');
  writeFileSync(join(root,'.next','standalone','server.js'),'// synthetic');
  return {root,manifest:join(root,'.next','studio-release.json'),revision:git('rev-parse','HEAD'),sourceTree:git('rev-parse','HEAD^{tree}')};
}
test('plain Next CI artifact has explicit source-only provenance and never creates a release manifest',()=>{
  const f=fixture();assert.deepEqual(guestFixtureBuildMetadata(f.root),{metadataSource:'next-build-source-binding',revision:f.revision,sourceTree:f.sourceTree,buildId:'synthetic-build',releaseManifestPresent:false});assert.equal(existsSync(f.manifest),false);
});
test('standalone BUILD_ID mismatch denies both CI and manifest paths',()=>{
  const f=fixture();writeFileSync(join(f.root,'.next','standalone','.next','BUILD_ID'),'other');assert.throws(()=>guestFixtureBuildMetadata(f.root),/BUILD_ID mismatch/);
});
test('existing release manifest must match actual source and both build IDs',()=>{
  const f=fixture();writeFileSync(f.manifest,JSON.stringify({...f,buildId:'synthetic-build',builtAt:'synthetic'}));assert.equal(guestFixtureBuildMetadata(f.root).metadataSource,'studio-release-manifest');writeFileSync(f.manifest,JSON.stringify({...f,buildId:'other'}));assert.throws(()=>guestFixtureBuildMetadata(f.root),/manifest\/source mismatch/);
});
test('malformed existing manifest cannot silently become CI fallback',()=>{
  const f=fixture();writeFileSync(f.manifest,'{');assert.throws(()=>guestFixtureBuildMetadata(f.root));
});
