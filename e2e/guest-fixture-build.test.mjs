import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { guestFixtureBuildMetadata, writeGuestFixtureBuildProof, verifyGuestFixtureBuildProof } from './guest-fixture-build.mjs';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'vox-guest-build-metadata-'));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-q');writeFileSync(join(root,'.gitignore'),'.next/\n');git('add','.gitignore');git('-c','user.name=Synthetic','-c','user.email=synthetic@invalid.test','commit','-qm','synthetic');
  mkdirSync(join(root,'.next','standalone','.next'),{recursive:true});
  writeFileSync(join(root,'.next','BUILD_ID'),'synthetic-build');
  writeFileSync(join(root,'.next','standalone','.next','BUILD_ID'),'synthetic-build');
  writeFileSync(join(root,'.next','standalone','server.js'),'// synthetic');
  mkdirSync(join(root,'.next','static'));mkdirSync(join(root,'public'));
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
test('source-only proof binds clean source, both BUILD_IDs and actual full payload without a release manifest',()=>{
  const f=fixture();const proof=writeGuestFixtureBuildProof(f.root,f.revision);
  assert.equal(proof.revision,f.revision);assert.equal(proof.sourceTree,f.sourceTree);
  assert.equal(verifyGuestFixtureBuildProof(f.root,f.revision).payload.sha256,proof.payload.sha256);
  assert.equal(existsSync(f.manifest),false);
});
test('source-only proof refuses a different event revision, dirty checkout and artifact mutation',()=>{
  const f=fixture();writeGuestFixtureBuildProof(f.root,f.revision);
  assert.throws(()=>verifyGuestFixtureBuildProof(f.root,'f'.repeat(40)),/clean checkout/);
  writeFileSync(join(f.root,'untracked'),'synthetic');assert.throws(()=>verifyGuestFixtureBuildProof(f.root,f.revision),/clean checkout/);
  const other=fixture();writeGuestFixtureBuildProof(other.root,other.revision);
  writeFileSync(join(other.root,'.next','standalone','server.js'),'changed');
  assert.throws(()=>verifyGuestFixtureBuildProof(other.root,other.revision),/mismatch/);
});
test('source-only proof refuses mixed BUILD_IDs and environment payload before binding',()=>{
  const f=fixture();writeFileSync(join(f.root,'.next','standalone','.next','BUILD_ID'),'other');
  assert.throws(()=>writeGuestFixtureBuildProof(f.root,f.revision),/BUILD_ID mismatch/);
  const other=fixture();writeFileSync(join(other.root,'.next','standalone','.env'),'SYNTHETIC');
  assert.throws(()=>writeGuestFixtureBuildProof(other.root,other.revision),/excluded environment/);
});
