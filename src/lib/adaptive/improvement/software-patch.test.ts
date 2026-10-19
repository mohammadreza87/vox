import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from './contracts';
import { SOFTWARE_TARGET_PATH, softwareEvaluationSchema, softwareRunInputSchema, softwareRunOutputSchema, type FrozenSoftwareBase } from './software-contracts';
import { createSyntheticPersianPatch, materializeSoftwarePatch, readFrozenSoftwareBase } from './software-patch';
const commit = 'e1186f258d38de538c8f20537ee7579f577f1269';
const policyDigest = hash('protected-test-policy');
function fixture(): FrozenSoftwareBase {
  const source = ['export class SentenceDetector {', '  // punctuation boundary', '  private static SENTENCE_END = /([.!?]+)(?:\\s+|$)/g;', '  // following context', '}', ''].join('\n');
  return { repositoryCommit: commit, repositoryTreeOid: 'a'.repeat(40), targetPath: SOFTWARE_TARGET_PATH,
    baseBlobOid: createHash('sha1').update(`blob ${Buffer.byteLength(source)}\0${source}`).digest('hex'), baseSourceDigest: hash(source), source };
}
describe('software patch artifact boundary', () => {
  it('materializes actual source replacement with exact content identities', () => {
    const base = fixture(); const artifact = createSyntheticPersianPatch(base, 'persian_stream_boundary', policyDigest);
    const result = materializeSoftwarePatch(base, artifact.patch);
    expect(result.source).toContain('/([.!?؟]+)(?:\\s+|$)/g');
    expect(artifact.identity).toMatchObject({ baseBlobOid: base.baseBlobOid, repositoryTreeOid: base.repositoryTreeOid,
      patchDigest: hash(artifact.patch), resultSourceDigest: hash(result.source) });
    expect(base.source).not.toContain('؟');
  });
  it('reads immutable Git objects without requiring history or a checkout', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'vox-frozen-git-'));
    const env = { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV,
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Synthetic Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Synthetic Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
    const git = (args: string[], input?: string) => execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', env, input, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    try {
      git(['init', '--bare', '--template=']);
      const source = fixture().source;
      const blob = git(['hash-object', '-w', '--stdin'], source);
      let tree = git(['mktree'], `100644 blob ${blob}\tsentence-detector.ts\n`);
      for (const directory of ['utils', 'lib', 'src']) tree = git(['mktree'], `040000 tree ${tree}\t${directory}\n`);
      const revision = git(['commit-tree', tree, '-m', 'Synthetic frozen module']);
      const base = await readFrozenSoftwareBase(root, revision);
      expect(base).toMatchObject({ repositoryCommit: revision, repositoryTreeOid: tree, baseBlobOid: blob, source });
      expect(createSyntheticPersianPatch(base, 'persian_stream_boundary', policyDigest).identity.baseSourceDigest).toBe(hash(source));
      expect(await fs.readdir(root)).not.toContain('src');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  it.each(['HEAD', '--help', '../HEAD', 'a'.repeat(64)])('rejects mutable or option base %s', async revision => {
    await expect(readFrozenSoftwareBase(process.cwd(), revision)).rejects.toThrow('exact_commit_required');
  });
  it.each([
    (p: string) => p.replace(SOFTWARE_TARGET_PATH, '../outside.ts'),
    (p: string) => p.replace('+++ b/', '+++ /'),
    (p: string) => p + 'diff --git a/secret b/secret\n',
    (p: string) => p.replace('@@ -2,3 +2,3 @@', '@@ -1,3 +1,3 @@'),
    (p: string) => p.replace('@@ -2,3 +2,3 @@', '@@ -2,2 +2,3 @@'),
    (p: string) => p.replace(' // punctuation boundary', ' // changed context'),
    (p: string) => p.replace(/\n/g, '\r\n'),
    (p: string) => p + '\\ No newline at end of file\n',
    (p: string) => 'old mode 100644\nnew mode 100755\n' + p,
    (p: string) => p + '@@ -2,3 +2,3 @@\n',
    (p: string) => p.slice(0, -1),
    (p: string) => p + '\0\n',
  ])('rejects path, context, metadata, count and byte tampering', change => {
    const base = fixture(); const artifact = createSyntheticPersianPatch(base, 'issue', policyDigest);
    expect(() => materializeSoftwarePatch(base, change(artifact.patch))).toThrow();
  });
  it('rejects source bytes whose Git blob or SHA256 does not match', () => {
    const base = fixture(); const artifact = createSyntheticPersianPatch(base, 'issue', policyDigest);
    expect(() => materializeSoftwarePatch({ ...base, baseBlobOid: 'b'.repeat(40) }, artifact.patch)).toThrow('base_identity_mismatch');
    expect(() => materializeSoftwarePatch({ ...base, source: base.source + '\n' }, artifact.patch)).toThrow('base_identity_mismatch');
  });
  it('rejects huge patches and absent exact synthetic target', () => {
    expect(() => materializeSoftwarePatch(fixture(), ' '.repeat(32769))).toThrow();
    const base = fixture(); const artifact = createSyntheticPersianPatch(base, 'issue', policyDigest);
    const result = materializeSoftwarePatch(base, artifact.patch);
    const changed = { ...base, source: result.source, baseSourceDigest: hash(result.source),
      baseBlobOid: createHash('sha1').update(`blob ${Buffer.byteLength(result.source)}\0${result.source}`).digest('hex') };
    expect(() => createSyntheticPersianPatch(changed, 'issue', policyDigest)).toThrow('synthetic_reproduction_base_mismatch');
  });
});
describe('strict candidate protocol', () => {
  it('permits operations and no expected answer or case identity', () => {
    const request = { schemaVersion: 1, operations: [{ kind: 'chunk', text: 'آیا امروز آماده هستید؟ ' }, { kind: 'flush' }, { kind: 'reset' }] };
    expect(softwareRunInputSchema.safeParse(request).success).toBe(true);
    expect(softwareRunInputSchema.safeParse({ ...request, expected: [] }).success).toBe(false);
    expect(softwareRunInputSchema.safeParse({ ...request, id: 'hidden-case' }).success).toBe(false);
    expect(softwareRunInputSchema.safeParse({ schemaVersion: 1, operations: [{ kind: 'chunk', text: '؟'.repeat(4096) }, { kind: 'chunk', text: '؟'.repeat(4096) }] }).success).toBe(false);
    expect(softwareRunOutputSchema.safeParse({ schemaVersion: 1, steps: [{ sentences: [], flushed: null, buffer: '', currentIndex: 0 }], passed: true }).success).toBe(false);
  });
  it('does not permit a signed pass without baseline reproduction', () => {
    const identity = createSyntheticPersianPatch(fixture(), 'issue', policyDigest).identity;
    const receipt = { identity, datasetDigest: hash('dataset'), evaluatorDigest: hash('evaluator'), imageDigest: `sha256:${hash('image')}`,
      checks: 3, baselineFailures: 0, candidateFailures: 0, status: 'passed', testedAt: 1, phase: 'protected_final', isolation: 'docker_candidate_only_host_scored' };
    expect(softwareEvaluationSchema.safeParse(receipt).success).toBe(false);
    expect(softwareEvaluationSchema.safeParse({ ...receipt, baselineFailures: 1 }).success).toBe(true);
  });
});
