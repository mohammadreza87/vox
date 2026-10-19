import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { hash } from './contracts';
import { SOFTWARE_TARGET_PATH } from './software-contracts';
import { describe, expect, it } from 'vitest';
import { createSyntheticPersianPatch, materializeSoftwarePatch } from './software-patch';
import { evaluateSoftwareIsolated, SOFTWARE_IMAGE_DIGEST, SOFTWARE_POLICY_DIGEST, SOFTWARE_HARNESS } from './software-sandbox';

const keys = generateKeyPairSync('ed25519');
const evaluatorPrivateKey = keys.privateKey.export({ type:'pkcs8',format:'pem' }).toString();
const source = readFileSync(process.cwd()+'/src/lib/adaptive/improvement/fixtures/sentence-detector-base.ts.txt','utf8');
const base = { repositoryCommit:'1'.repeat(40),repositoryTreeOid:'2'.repeat(40),targetPath:SOFTWARE_TARGET_PATH,
  source,baseSourceDigest:hash(source),baseBlobOid:createHash('sha1').update(Buffer.from(`blob ${Buffer.byteLength(source)}\0`)).update(source).digest('hex') };

const artifact = createSyntheticPersianPatch(base,'VOX-045-test',SOFTWARE_POLICY_DIGEST);
const options = { base, artifact, imageDigest: SOFTWARE_IMAGE_DIGEST, evaluatorKeyId:'software-evaluator', evaluatorPrivateKey, now: Date.UTC(2026,9,19) };

describe('software host evaluator boundary',()=>{
  it('freezes exact synthetic reproduction source without Git history',()=>{
    expect(base.baseSourceDigest).toBe('e74e42676a8e977cacbfb119e1531220cd925058cc5dacdd6352f926d88fae95');
  });
  it('rejects unpinned images before execution',async()=>{
    await expect(evaluateSoftwareIsolated({...options,imageDigest:'node:latest'})).rejects.toThrow('pinned_local_software_image_required');
  });
  it('binds exact identity and policy before execution',async()=>{
    for(const identity of [{...artifact.identity,policyDigest:'a'.repeat(64)},{...artifact.identity,resultSourceDigest:'b'.repeat(64)},{...artifact.identity,repositoryTreeOid:'c'.repeat(40)}]) {
      await expect(evaluateSoftwareIsolated({...options,artifact:{...artifact,identity}})).rejects.toThrow('software_evaluation_identity_mismatch');
    }
  });
  it('runner contains only operation execution, with no expected answers or signing',()=>{
    expect(SOFTWARE_HARNESS).not.toMatch(/expected|privateKey|baselineFailures|candidateFailures|attest|protectedCorpus/);
    expect(SOFTWARE_HARNESS).toContain("from './source.ts'");
  });
  it.runIf(process.env.VOX_SOFTWARE_DOCKER_TEST === '1')('rejects candidate-authored fake pass logs, crashes and timeouts',async()=>{
    for (const suffix of [' static { console.log(JSON.stringify({status:"passed",candidateFailures:0})); }', ' static { throw new Error("synthetic_crash"); }', ' static { while(true) {} }']) {
      const patch = artifact.patch.replace(/(\+  private static SENTENCE_END = [^\n]+)/, '$1'+suffix);
      const result = materializeSoftwarePatch(base,patch);
      const changed = {...artifact,patch,identity:{...artifact.identity,patchDigest:result.patchDigest,resultSourceDigest:result.resultSourceDigest}};
      const receipt = await evaluateSoftwareIsolated({...options,artifact:changed});
      expect(receipt.payload.status).toBe('incomplete');
    }
  },60000);
  it.runIf(process.env.VOX_SOFTWARE_DOCKER_TEST === '1')('exposes only source, runner and operations to candidate code',async()=>{
    const suffix = ' static { const fs = process.getBuiltinModule("fs"); if(fs.readdirSync("/input").sort().join(",") !== "operations.json,runner.mjs,source.ts") throw new Error("unexpected_mount"); for(const path of ["/protected/dataset.json","/input/expected.json","/input/.git","/var/run/docker.sock","/root/.ssh"]) { if(fs.existsSync(path)) throw new Error("protected_file_exposed"); } for(const path of ["/input/probe","/probe"]) { let denied=false; try { fs.writeFileSync(path,"x"); } catch { denied=true; } if(!denied) throw new Error("write_allowed"); } if(fs.readFileSync("/proc/net/route","utf8").trim().split("\\n").length !== 1) throw new Error("network_route_available"); }';
    const patch = artifact.patch.replace(/(\+  private static SENTENCE_END = [^\n]+)/, '$1'+suffix);
    const result = materializeSoftwarePatch(base,patch);
    const changed = {...artifact,patch,identity:{...artifact.identity,patchDigest:result.patchDigest,resultSourceDigest:result.resultSourceDigest}};
    const receipt = await evaluateSoftwareIsolated({...options,artifact:changed});
    expect(receipt.payload.status).toBe('passed');
  },60000);
  it.runIf(process.env.VOX_SOFTWARE_DOCKER_TEST === '1')('reproduces baseline and accepts independently scored candidate in pinned Docker',async()=>{
    const result = await evaluateSoftwareIsolated(options);
    expect(result.purpose).toBe('software_protected_evaluation');
    expect(result.payload.status).toBe('passed');
    expect(result.payload.baselineFailures).toBeGreaterThan(0);
    expect(result.payload.candidateFailures).toBe(0);
  },60000);
});
