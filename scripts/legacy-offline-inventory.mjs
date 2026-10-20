/** LIA1 guarded FD-only CLI. Trusted Node startup is an external prerequisite. */
import { closeSync, fstatSync, write } from 'node:fs';
import process from 'node:process';

const owned = new Set();
let transferred = false, safeError = false;
const validFd = fd => Number.isSafeInteger(fd) && fd >= 3 && fd <= 2147483647;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const closeOwned = () => {
  let failed = false;
  if (!transferred) for (const fd of owned) { try { closeSync(fd); } catch { failed = true; } }
  owned.clear(); return failed;
};
const writeAll = async (fd, text) => {
  const bytes = Buffer.from(text);
  let position = 0;
  while (position < bytes.length) {
    const count = await new Promise((resolve, reject) => write(fd, bytes, position, bytes.length - position,
      (error, size) => error ? reject(error) : resolve(size)));
    if (!Number.isSafeInteger(count) || count < 1) throw new Error('output_failed');
    position += count;
  }
};

async function main() {
  let snapshotFd, selectionFd;
  const seen = new Set();
  let valid = process.argv.length === 6;
  // Gather only range-validated transfer-owned arguments, even when flags repeat.
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], raw = process.argv[i + 1];
    const fd = typeof raw === 'string' && /^[0-9]+$/.test(raw) ? Number(raw) : NaN;
    if ((flag === '--snapshot-fd' || flag === '--selection-fd') && validFd(fd)) owned.add(fd);
    if (seen.has(flag) || !validFd(fd)) valid = false;
    seen.add(flag);
    if (flag === '--snapshot-fd') snapshotFd = fd;
    else if (flag === '--selection-fd') selectionFd = fd;
    else valid = false;
  }
  // No code path writes until both outputs are checked against every owned input.
  let alias = false;
  try {
    const inputs = [...owned].map(fd => fstatSync(fd, { bigint: true }));
    const stderr = fstatSync(2, { bigint: true });
    safeError = !inputs.some(input => sameFile(input, stderr));
    const stdout = fstatSync(1, { bigint: true });
    alias = !safeError || inputs.some(input => sameFile(input, stdout));
  } catch { process.exitCode = 2; closeOwned(); return; }
  if (!valid || !seen.has('--snapshot-fd') || !seen.has('--selection-fd') || snapshotFd === selectionFd || alias) {
    closeOwned(); process.exitCode = 2;
    if (safeError) { try { await writeAll(2, 'invalid_descriptor\n'); } catch { process.exitCode = 3; } }
    return;
  }
  let report;
  try {
    // Scoped CJS registration matches this package's TS module format. After guard only.
    const { register } = await import('tsx/cjs/api');
    const registration = register({ namespace: 'vox-lia1-offline' });
    try {
      const inspector = registration.require('../src/lib/legacy-inventory/offline/inspect.ts', import.meta.url);
      transferred = true;
      report = await inspector.inspectOfflineTirehSnapshot(snapshotFd, selectionFd);
    } finally { await registration.unregister(); }
  } catch {
    closeOwned(); process.exitCode = 2;
    if (safeError) { try { await writeAll(2, 'internal_failed\n'); } catch { process.exitCode = 3; } }
    return;
  }
  owned.clear();
  try {
    const output = JSON.stringify(report) + '\n';
    if (Buffer.byteLength(output) > 2 * 1024 * 1024) throw new Error('output_failed');
    await writeAll(1, output);
    process.exitCode = report.status === 'complete' ? 0 : 2;
  } catch {
    process.exitCode = 3;
    if (safeError) { try { await writeAll(2, 'output_failed\n'); } catch { /* Exit status remains output failure. */ } }
  }
}
await main().catch(async () => {
  closeOwned(); process.exitCode = 2;
  if (safeError) { try { await writeAll(2, 'internal_failed\n'); } catch { process.exitCode = 3; } }
});
