import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectOfflineTirehSnapshot } from '../inspect';
import { OfflineError, fixedStop, OFFLINE_LIMITS } from '../contracts';
const CANARY = 'PRIVATE_LIA1_شخصی_CANARY';
const AT = '2026-10-20T00:00:00.000Z';
const memory = (id = CANARY) => ({ id, personaId: CANARY, content: CANARY, type: 'fact',
  scope: { kind: 'private', personId: CANARY }, sensitivity: 'personal', source: { personId: CANARY, chatKind: 'private', at: AT },
  aboutPersonIds: [CANARY], confidence: 1, createdAt: AT, updatedAt: AT });
const empty = () => ({ memories: [], offers: [], chats: {} });
let dir: string, opened: number[];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'vox-lia1-inspect-')); opened = []; });
afterEach(() => { vi.restoreAllMocks(); for (const fd of opened) { try { closeSync(fd); } catch { /* Owned by inspector. */ } } rmSync(dir, { recursive: true, force: true }); });
async function inspect(input: object | string | Uint8Array, options?: { signal?: AbortSignal }) {
  const bytes = typeof input === 'string' ? Buffer.from(input) : input instanceof Uint8Array ? input : Buffer.from(JSON.stringify(input));
  const sourcePath = join(dir, `${opened.length}-synthetic-${CANARY}.json`), selectionPath = join(dir, `${opened.length}-selection.json`);
  writeFileSync(sourcePath, bytes, { mode: 0o600 });
  writeFileSync(selectionPath, JSON.stringify({ schema: 'vox.legacy-offline-selection/1', format: 'tireh-file-state/1', purpose: 'offline-deny-all-inventory',
    expectedBytes: bytes.length, expectedSha256: createHash('sha256').update(bytes).digest('hex'), provenance: 'operator_asserted_offline_copy' }), { mode: 0o600 });
  const fd = openSync(sourcePath, 'r'), selector = openSync(selectionPath, 'r'); opened.push(fd, selector);
  const result = await inspectOfflineTirehSnapshot(fd, selector, options);
  expect(readFileSync(sourcePath)).toEqual(Buffer.from(bytes));
  expect(JSON.stringify(result)).not.toContain(CANARY);
  expect(JSON.stringify(result)).not.toContain(createHash('sha256').update(bytes).digest('hex'));
  for (const row of result.rows) expect(row).toMatchObject({ target: null, currentAuthority: 'unverified', use: 'denied' });
  expect(result.sourceCoverage).toBe('unavailable'); expect(result.currentness).toBe('unavailable');
  return result;
}
describe('LIA1 native inventory', () => {
  it('native pretty JSON and CRLF count actual occurrences without an invented transport envelope', async () => {
    const payload = { memories: [memory(), memory(), { ...memory(), id: 'different' }], offers: [],
      chats: { [CANARY]: [{ role: 'user', text: CANARY, at: AT }, { role: 'assistant', text: CANARY, at: AT }] },
      revisions: { [CANARY]: 2 }, tombstones: { [CANARY]: [CANARY] }, epochs: { [CANARY]: 1 } };
    const result = await inspect(JSON.stringify(payload, null, 2).replaceAll('\n', '\r\n') + '\r\n');
    expect(result.status).toBe('complete'); expect(result.stop).toBe('none');
    expect(result.counts).toMatchObject({ expectedUnits: 1, consumedUnits: 1, inventoriedUnits: 1, unresolvedFragments: 0, envelopeRows: 1, childRows: 5, quarantineRows: 5, preserveSourceOnlyRows: 1 });
    expect(result.rows.filter(r => r.reasons.includes('repeated_source_key'))).toHaveLength(2);
    expect(result.rows[0].reasons).toContain('source_suppression_observed');
    expect(result.effects).toMatchObject({ imports: 0, grants: 0, identityLinks: 0, consentReceipts: 0, sourceByteMutations: 0 });
    expect(result.mode).toBe('offline-snapshot-dry-run'); expect(result.policy).toBe('LIA1-deny-all-use');
  });
  it('empty native containers are one complete selected document, never an empty database claim', async () => {
    const result = await inspect(empty());
    expect(result.rows).toHaveLength(1); expect(result.selectedDocumentCoverage).toBe('complete');
    expect(result.provenance).toBe('operator_assertion_only'); expect(result.creatorConsistency).toBe('unavailable');
  });
  it.each([{ offers: [], chats: {} }, { ...empty(), memories: null }, { ...empty(), chats: [] }, { ...empty(), [CANARY]: [CANARY] }, []])('opaque or unknown native portions remain incomplete', async payload => {
    const result = await inspect(payload);
    expect(result.status).toBe('incomplete'); expect(result.stop).toBe('unsupported_native_shape');
    expect(result.counts.unresolvedFragments).toBeGreaterThan(0); expect(result.counts.consumedUnits).toBe(1);
    expect(result.counts.inventoriedUnits).toBe(0);
  });
  it('well-delimited malformed children remain counted quarantine', async () => {
    const result = await inspect({ ...empty(), memories: [null, 9, memory()] });
    expect(result.status).toBe('complete'); expect(result.counts.childRows).toBe(3);
    expect(result.rows.filter(r => r.reasons.includes('malformed_record'))).toHaveLength(2);
  });
  it.each(['{"memories":[],"memories":[],"offers":[],"chats":{}}', '{"__proto__":{}}', '{} {}', '{', '\ufeff{}', '[1e999]'])('invalid lexical input never admits rows', async text => {
    const result = await inspect(text);
    expect(result.stop).toBe('invalid_native_json'); expect(result.rows).toEqual([]); expect(result.counts.consumedUnits).toBe(0);
    expect(result.acquisition.acquisition).toBe('verified_selected_bytes');
  });
  it('invalid UTF8 fails after byte verification, without data in errors', async () => {
    const result = await inspect(new Uint8Array([0xff, 0xfe, 0x80]));
    expect(result.stop).toBe('invalid_native_json'); expect(result.rows).toEqual([]);
  });
  it('exact native depth32 is admitted, depth33 is refused atomically', async () => {
    const text = (depth: number) => '{"memories":[],"offers":[],"chats":{},"unknown":' + '['.repeat(depth - 1) + '0' + ']'.repeat(depth - 1) + '}';
    expect((await inspect(text(32))).stop).toBe('unsupported_native_shape');
    const over = await inspect(text(33)); expect(over.stop).toBe('capacity_exceeded'); expect(over.rows).toEqual([]);
  });
  it('native token budget counts punctuation and keys at exact50000 independently', async () => {
    // Three empty native containers cost16. Adding x:[n zeros] costs4+2n.
    const prefix = '{"memories":[],"offers":[],"chats":{},"x":[';
    const at = prefix + '0,'.repeat(24989) + '0]}'; // 20+2*24990 =50000.
    expect((await inspect(at)).stop).toBe('unsupported_native_shape');
    const over = prefix + '0,'.repeat(24989) + '[]]}'; // Replace one scalar(1) with [](2):50001.
    expect((await inspect(over)).stop).toBe('capacity_exceeded');
  });
  it('1000 children admits1001 rows;1001 children rejects the whole document', async () => {
    const at = await inspect({ ...empty(), memories: Array(1000).fill(null) });
    expect(at.rows).toHaveLength(1001); expect(at.status).toBe('complete');
    const over = await inspect({ ...empty(), memories: Array(1001).fill(null) });
    expect(over.stop).toBe('capacity_exceeded'); expect(over.rows).toEqual([]); expect(over.counts.childRows).toBe(0);
  });
  it('native byte bound permits524288 bytes including legal whitespace, one-over rejects selection', async () => {
    const base = JSON.stringify(empty());
    expect((await inspect(base + ' '.repeat(OFFLINE_LIMITS.snapshotBytes - base.length))).status).toBe('complete');
    const over = await inspect(base + ' '.repeat(OFFLINE_LIMITS.snapshotBytes + 1 - base.length));
    expect(over.stop).toBe('invalid_selection'); expect(over.acquisition.snapshotReadCalls).toBe(0);
  });
  it('aborted invocation has no rows and fixed cancellation code', async () => {
    const controller = new AbortController(); controller.abort();
    const result = await inspect(empty(), { signal: controller.signal });
    expect(result.stop).toBe('cancelled'); expect(result.rows).toEqual([]);
  });
  it('error class/accessor cannot smuggle arbitrary codes', () => {
    const error = new OfflineError('reader_failed');
    Object.defineProperty(error, 'code', { get() { throw new Error(CANARY); } });
    expect(fixedStop(error, 'internal_failed')).toBe('internal_failed');
    expect(fixedStop({ code: CANARY }, 'reader_failed')).toBe('reader_failed');
  });
});
