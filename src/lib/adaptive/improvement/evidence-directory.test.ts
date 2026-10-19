import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExternalEvidenceDirectory } from './evidence-directory';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(separate = false) {
  const root = await fs.mkdtemp(join(tmpdir(), 'vox-evidence-directory-')); roots.push(root);
  const repo = join(root, 'repo'); const metadata = join(root, 'git-metadata');
  const env = { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Synthetic Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
  const git = (args: string[], input?: string) => execFileSync('git', args, { encoding: 'utf8', env, input, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(['init', '--template=', '--initial-branch=main', ...(separate ? [`--separate-git-dir=${metadata}`] : []), repo]);
  const tree = git(['-C', repo, 'mktree'], '');
  const commit = git(['-C', repo, 'commit-tree', tree, '-m', 'Synthetic evidence fixture']);
  git(['-C', repo, 'update-ref', 'refs/heads/main', commit]);
  await fs.mkdir(join(repo, 'data')); await fs.writeFile(join(repo, 'data', 'canary.txt'), 'authored data');
  return { root, repo, metadata, git, commit };
}
describe('external evidence directory', () => {
  it('creates a fresh sibling atomically without prefix false positives', async () => {
    const s = await fixture(); const target = join(s.root, 'repo-results');
    expect(await createExternalEvidenceDirectory(s.repo, target)).toBe(await fs.realpath(target));
    expect((await fs.stat(target)).mode & 0o777).toBe(0o700);
    await expect(createExternalEvidenceDirectory(s.repo, target)).rejects.toThrow();
    expect(await fs.readdir(target)).toEqual([]);
  });
  it('rejects checkout root, nested authored data and .git before creating anything', async () => {
    const s = await fixture();
    for (const target of [s.repo, join(s.repo, 'new-evidence'), join(s.repo, 'data', 'new-evidence'), join(s.repo, '.git', 'new-evidence')]) {
      await expect(createExternalEvidenceDirectory(s.repo, target)).rejects.toThrow('evidence_directory_must_be_external');
    }
    expect(await fs.readFile(join(s.repo, 'data', 'canary.txt'), 'utf8')).toBe('authored data');
    expect(await fs.readdir(join(s.repo, 'data'))).toEqual(['canary.txt']);
    expect(await fs.readdir(join(s.repo, '.git'))).not.toContain('new-evidence');
  });
  it('resolves symlinked parents into checkout or metadata and refuses writes', async () => {
    const s = await fixture(); const alias = join(s.root, 'outside-alias'); const gitAlias = join(s.root, 'outside-git-alias');
    await fs.symlink(join(s.repo, 'data'), alias, 'dir'); await fs.symlink(join(s.repo, '.git'), gitAlias, 'dir');
    for (const parent of [alias, gitAlias]) await expect(createExternalEvidenceDirectory(s.repo, join(parent, 'new-evidence'))).rejects.toThrow('evidence_directory_must_be_external');
    expect(await fs.readdir(alias)).toEqual(['canary.txt']); expect(await fs.readdir(gitAlias)).not.toContain('new-evidence');
  });
  it('canonicalizes repository aliases and permits a safe external-parent alias', async () => {
    const s = await fixture(); const repoAlias = join(s.root, 'repo-alias'); const external = join(s.root, 'external'); const alias = join(s.root, 'external-alias');
    await fs.symlink(s.repo, repoAlias, 'dir'); await fs.mkdir(external); await fs.symlink(external, alias, 'dir');
    await expect(createExternalEvidenceDirectory(repoAlias, join(s.repo, 'data', 'new-evidence'))).rejects.toThrow('evidence_directory_must_be_external');
    expect(await createExternalEvidenceDirectory(repoAlias, join(alias, 'fresh'))).toBe(join(await fs.realpath(external), 'fresh'));
  });
  it('protects external metadata referenced by a .git file', async () => {
    const s = await fixture(true); expect((await fs.stat(join(s.repo, '.git'))).isFile()).toBe(true);
    await expect(createExternalEvidenceDirectory(s.repo, join(s.metadata, 'new-evidence'))).rejects.toThrow('evidence_directory_must_be_external');
    expect(await fs.readdir(s.metadata)).not.toContain('new-evidence');
  });
  it('protects linked-worktree .git target and shared common directory outside checkout', async () => {
    const s = await fixture(); const linked = join(s.root, 'linked'); s.git(['-C', s.repo, 'worktree', 'add', '--detach', linked, s.commit]);
    expect((await fs.stat(join(linked, '.git'))).isFile()).toBe(true);
    const gitDirectory = s.git(['-C', linked, 'rev-parse', '--absolute-git-dir']);
    for (const parent of [linked, gitDirectory, join(s.repo, '.git')]) await expect(createExternalEvidenceDirectory(linked, join(parent, 'new-evidence'))).rejects.toThrow('evidence_directory_must_be_external');
    const alias = join(s.root, 'linked-git-alias'); await fs.symlink(gitDirectory, alias, 'dir');
    await expect(createExternalEvidenceDirectory(linked, join(alias, 'new-evidence'))).rejects.toThrow('evidence_directory_must_be_external');
    expect(await fs.readdir(gitDirectory)).not.toContain('new-evidence');
  });
  it('requires an existing parent and refuses existing final symlinks and files', async () => {
    const s = await fixture(); const external = join(s.root, 'external'); await fs.mkdir(external);
    const alias = join(s.root, 'existing-link'); await fs.symlink(external, alias, 'dir');
    const file = join(s.root, 'existing-file'); await fs.writeFile(file, 'preserve');
    for (const target of [alias, file, join(s.root, 'missing', 'fresh')]) await expect(createExternalEvidenceDirectory(s.repo, target)).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('preserve'); expect(await fs.readdir(external)).toEqual([]);
    await expect(fs.access(join(s.root, 'missing'))).rejects.toThrow();
  });
});
