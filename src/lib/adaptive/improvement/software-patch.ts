import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { hash } from './contracts';
import { SOFTWARE_TARGET_PATH, syntheticSoftwarePatchArtifactSchema, type FrozenSoftwareBase, type SyntheticSoftwarePatchArtifact } from './software-contracts';
const execute = promisify(execFile);
const oid = /^[a-f0-9]{40}$/;
const fail = (reason: string): never => { throw new Error(reason); };
function validateSource(source: string): void {
  if (!source.endsWith('\n') || source.includes('\r') || source.includes('\0') || Buffer.byteLength(source) > 65536) fail('unsupported_source_bytes');
}
function blobOid(source: string): string {
  const bytes = Buffer.from(source);
  return createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
}
function validateBase(base: FrozenSoftwareBase): void {
  if (!oid.test(base.repositoryCommit) || !oid.test(base.repositoryTreeOid) || base.targetPath !== SOFTWARE_TARGET_PATH ||
    !oid.test(base.baseBlobOid) || hash(base.source) !== base.baseSourceDigest || blobOid(base.source) !== base.baseBlobOid) fail('base_identity_mismatch');
  validateSource(base.source);
}
/** Reads immutable Git objects only. No checkout, filters, hooks, scripts or candidate execution. */
export async function readFrozenSoftwareBase(repositoryRoot: string, repositoryCommit: string): Promise<FrozenSoftwareBase> {
  if (!oid.test(repositoryCommit)) fail('exact_commit_required');
  const git = async (args: string[]) => (await execute('git', ['--no-replace-objects', '-C', repositoryRoot, ...args], {
    encoding: 'utf8', maxBuffer: 131072, timeout: 5000,
    env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  })).stdout;
  const commit = await git(['cat-file', 'commit', repositoryCommit]);
  const treeMatch = /^tree ([a-f0-9]{40})\n/.exec(commit);
  if (!treeMatch) fail('invalid_base_commit');
  const repositoryTreeOid = treeMatch![1];
  const entry = await git(['ls-tree', '-z', repositoryTreeOid, '--', SOFTWARE_TARGET_PATH]);
  const match = /^100644 blob ([a-f0-9]{40})\tsrc\/lib\/utils\/sentence-detector\.ts\0$/.exec(entry);
  if (!match) fail('regular_target_blob_required');
  const baseBlobOid = match![1];
  const source = await git(['cat-file', 'blob', baseBlobOid]);
  const base = { repositoryCommit, repositoryTreeOid, targetPath: SOFTWARE_TARGET_PATH, baseBlobOid, baseSourceDigest: hash(source), source };
  validateBase(base); return base;
}
/** Deliberately small canonical single-file, single-hunk dialect; no fuzzy matching. */
export function materializeSoftwarePatch(base: FrozenSoftwareBase, patch: string): { source: string; patchDigest: string; resultSourceDigest: string } {
  validateBase(base);
  if (Buffer.byteLength(patch) > 32768 || patch.includes('\r') || patch.includes('\0') || !patch.endsWith('\n')) fail('invalid_patch_bytes');
  const lines = patch.slice(0, -1).split('\n');
  if (lines[0] !== `--- a/${SOFTWARE_TARGET_PATH}` || lines[1] !== `+++ b/${SOFTWARE_TARGET_PATH}`) fail('patch_target_denied');
  const header = /^@@ -([1-9][0-9]*),([1-9][0-9]*) \+([1-9][0-9]*),([1-9][0-9]*) @@$/.exec(lines[2] ?? '');
  if (!header) fail('canonical_single_hunk_required');
  const [oldStart, oldCount, newStart, newCount] = header!.slice(1).map(Number);
  if (![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger) || oldStart !== newStart || oldCount > 128 || newCount > 128) fail('patch_budget_or_position');
  const sourceLines = base.source.slice(0, -1).split('\n');
  const removed: string[] = []; const replacement: string[] = []; let additions = 0; let deletions = 0; let contexts = 0;
  for (const line of lines.slice(3)) {
    if (line.startsWith(' ')) { removed.push(line.slice(1)); replacement.push(line.slice(1)); contexts++; }
    else if (line.startsWith('-') && !line.startsWith('---')) { removed.push(line.slice(1)); deletions++; }
    else if (line.startsWith('+') && !line.startsWith('+++')) { replacement.push(line.slice(1)); additions++; }
    else fail('invalid_patch_line');
  }
  if (!additions || !deletions || contexts < 2 || additions + deletions > 32 || removed.length !== oldCount || replacement.length !== newCount || oldStart - 1 + oldCount > sourceLines.length) fail('patch_shape_or_budget');
  if (removed.some((line, index) => line !== sourceLines[oldStart - 1 + index])) fail('patch_context_mismatch');
  const result = [...sourceLines.slice(0, oldStart - 1), ...replacement, ...sourceLines.slice(oldStart - 1 + oldCount)].join('\n') + '\n';
  validateSource(result); if (result === base.source) fail('patch_must_change_source');
  return { source: result, patchDigest: hash(patch), resultSourceDigest: hash(result) };
}
export function createSyntheticPersianPatch(base: FrozenSoftwareBase, issueId: string, policyDigest: string): SyntheticSoftwarePatchArtifact {
  validateBase(base);
  const lines = base.source.slice(0, -1).split('\n');
  const before = '  private static SENTENCE_END = /([.!?]+)(?:\\s+|$)/g;';
  const index = lines.indexOf(before);
  if (index < 1 || index >= lines.length - 1 || lines.lastIndexOf(before) !== index) fail('synthetic_reproduction_base_mismatch');
  const after = before.replace('[.!?]', '[.!?؟]');
  const patch = [`--- a/${SOFTWARE_TARGET_PATH}`, `+++ b/${SOFTWARE_TARGET_PATH}`, `@@ -${index},3 +${index},3 @@`,
    ` ${lines[index - 1]}`, `-${before}`, `+${after}`, ` ${lines[index + 1]}`, ''].join('\n');
  const result = materializeSoftwarePatch(base, patch);
  return syntheticSoftwarePatchArtifactSchema.parse({ authorMode: 'deterministic_synthetic', patch, identity: {
    schemaVersion: 1, issueId, repositoryCommit: base.repositoryCommit, repositoryTreeOid: base.repositoryTreeOid,
    targetPath: base.targetPath, baseBlobOid: base.baseBlobOid, baseSourceDigest: base.baseSourceDigest,
    patchDigest: result.patchDigest, resultSourceDigest: result.resultSourceDigest, policyDigest,
  } });
}
