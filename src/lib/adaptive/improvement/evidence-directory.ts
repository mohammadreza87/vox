/** Evidence belongs outside the repository and its Git metadata. The local host
 * and parent-directory ownership are trusted; this is not a hostile-filesystem sandbox. */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
function contains(directory: string, candidate: string): boolean {
  const path = relative(directory, candidate);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}
/** Resolves the actual worktree and Git directories (including linked-worktree
 * .git files), canonicalizes the existing output parent, then atomically creates
 * one fresh directory. Existing paths and missing parents are refused. */
export async function createExternalEvidenceDirectory(repositoryRoot: string, outputDirectory: string): Promise<string> {
  const gitPath = async (flag: string) => {
    const { stdout } = await execute('git', ['--no-replace-objects', '-C', repositoryRoot,
      'rev-parse', '--path-format=absolute', flag], { encoding: 'utf8', timeout: 5000, maxBuffer: 16384,
      env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } });
    return fs.realpath(stdout.trim());
  };
  const protectedDirectories = await Promise.all([
    gitPath('--show-toplevel'), gitPath('--absolute-git-dir'), gitPath('--git-common-dir'),
  ]);
  const requested = resolve(outputDirectory);
  const parent = await fs.realpath(dirname(requested));
  const target = join(parent, basename(requested));
  if (protectedDirectories.some(directory => contains(directory, target))) throw new Error('evidence_directory_must_be_external');
  // No recursive mkdir: the canonical parent must already exist. mkdir itself
  // refuses files, directories and symlinks already occupying the final name.
  await fs.mkdir(target, { mode: 0o700 });
  return target;
}
