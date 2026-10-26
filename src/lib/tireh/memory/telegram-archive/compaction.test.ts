import { describe, expect, it } from 'vitest';
import { archiveDigest, type ArchiveAuthority, type ArchiveEvent, type ArchiveHead, type ArchiveState } from './contracts';
import { MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_STATE_BYTES, TelegramMemoryArchive } from './service';
import { MAX_SNAPSHOT_CHUNKS, MAX_SNAPSHOT_SOURCE_FILES, planArchiveSnapshot, verifyArchiveSnapshot,
  type ArchiveSnapshotFile } from './compaction';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const scope = { accountId: 'telegram-account:42', personId: 'person42', agentId: 'agent1', space: 'work' as const, containerId: 'private42' };
const now = 10_000;
const event = (n: number, patch: Partial<ArchiveEvent> = {}): ArchiveEvent => ({ eventId: `e${n}`, logicalId: `l${n}`,
  revision: 1, occurredAt: 100 + n, receivedAt: 1000, expiresAt: 900_000, role: 'user', text: `Synthetic ${n}`, ...patch });
function fixture(events: ArchiveEvent[] = [event(1), event(2)], pending: ArchiveEvent[] = []) {
  const files: ArchiveSnapshotFile[] = [];
  const authority: ArchiveAuthority = { scope, revision: 'authority-1', allowed: true, botId: 7,
    expiresAt: 1_000_000, suppressedEventIds: [] };
  const state: ArchiveState = { schemaVersion: 1, scope, botId: 7, revision: 3, pending: structuredClone(pending), receipts: [] };
  for (const item of [...events, ...pending]) state.receipts.push({ eventId: item.eventId, logicalId: item.logicalId,
    sourceRevision: item.revision, fingerprint: archiveDigest(encode([item.eventId, item.logicalId, item.revision,
      item.occurredAt, item.role, item.text, item.sourceMessageId ?? null])) });
  let head: ArchiveHead | undefined;
  for (let offset = 0; offset < events.length; offset += 8) {
    const sequence = offset / 8 + 1, operationId = `op${sequence}`;
    const common = { schemaVersion: 1, scope, botId: 7, sequence, operationId };
    const bundleBytes = encode({ ...common, kind: 'events', events: events.slice(offset, offset + 8) });
    const bundle = { fileId: `b${sequence}`, messageId: sequence * 2 - 1, digest: archiveDigest(bundleBytes) };
    const manifestBytes = encode({ ...common, kind: 'manifest', authorityRevision: 'original-authority', createdAt: 2000,
      bundle, previous: head ?? null });
    head = { fileId: `m${sequence}`, messageId: sequence * 2, digest: archiveDigest(manifestBytes), sequence };
    files.push({ fileId: bundle.fileId, bytes: bundleBytes }, { fileId: head.fileId, bytes: manifestBytes });
  }
  if (head) state.head = head;
  const input = { state, authority, now, files };
  return { input, state, authority, files };
}
function expectFailure(action: () => unknown, code?: string) {
  try { action(); throw new Error('Expected refusal'); }
  catch (error) {
    expect(error).toMatchObject({ name: 'ArchiveUnavailableError', ...(code ? { code } : {}) });
  }
}

describe('offline authority-preserving snapshot prerequisite author checks', () => {
  it('matches existing recovery, including pending and latest-version selection', async () => {
    const h = fixture([event(1), event(2, { logicalId: 'l1', revision: 2 })], [event(3)]);
    const original = structuredClone(h.input), plan = planArchiveSnapshot(h.input);
    const service = new TelegramMemoryArchive({ read: async () => structuredClone(h.state), transact: async () => { throw new Error('No mutation'); } },
      { read: async () => structuredClone(h.authority), isCurrent: () => true },
      { upload: async () => { throw new Error('No upload'); }, download: async fileId => h.files.find(file => file.fileId === fileId)!.bytes }, { now: () => now });
    const result = verifyArchiveSnapshot(h.input, plan, plan.digest);
    expect(result.events).toEqual((await service.recover(scope)).events);
    expect(result.receipts).toEqual(h.state.receipts);
    expect(h.input).toEqual(original);
    result.events[0].text = 'Caller mutation'; result.receipts[0].logicalId = 'Caller mutation';
    expect(verifyArchiveSnapshot(h.input, plan, plan.digest).events[0].text).toBe('Synthetic 2');
    expect(h.input).toEqual(original);
  });

  it('preserves full suppressed receipts without retaining removed pending text', () => {
    const h = fixture([event(1)], [event(2)]);
    h.state.pending = [];
    h.state.receipts[1].suppressed = true;
    h.authority.suppressedEventIds = ['l2', 'unmatched-suppression'];
    const plan = planArchiveSnapshot(h.input), result = verifyArchiveSnapshot(h.input, plan, plan.digest);
    expect(result.receipts).toEqual(h.state.receipts);
    expect(result.events.map(e => e.eventId)).toEqual(['e1']);
    expect(decode(plan.manifest).suppressedEventIds).toEqual(['l2', 'unmatched-suppression']);
    expect(plan.chunks.map(bytes => new TextDecoder().decode(bytes)).join('')).not.toContain('Synthetic 2');
    const incomplete = { ...h.input, authority: { ...h.authority, suppressedEventIds: [] } };
    expectFailure(() => planArchiveSnapshot(incomplete), 'authority');
  });

  it('drops excluded text and never revives older text after latest expires or is suppressed', () => {
    for (const suppressed of [false, true]) {
      const h = fixture([event(1), event(2, { logicalId: 'l1', revision: 2, expiresAt: suppressed ? 900_000 : now })]);
      if (suppressed) h.authority.suppressedEventIds = ['e2'];
      const plan = planArchiveSnapshot(h.input), result = verifyArchiveSnapshot(h.input, plan, plan.digest);
      expect(result.events).toEqual([]); expect(result.receipts).toHaveLength(2);
      expect(plan.chunks.map(bytes => new TextDecoder().decode(bytes)).join('')).not.toContain('Synthetic');
    }
  });

  it('preserves original expiry and removes newly expired events on later verification', () => {
    const h = fixture([event(1, { expiresAt: now + 1 })]);
    const plan = planArchiveSnapshot(h.input);
    expect(verifyArchiveSnapshot(h.input, plan, plan.digest).events[0].expiresAt).toBe(now + 1);
    expect(verifyArchiveSnapshot({ ...h.input, now: now + 1 }, plan, plan.digest).events).toEqual([]);
    expectFailure(() => verifyArchiveSnapshot({ ...h.input, now: now - 1 }, plan, plan.digest), 'authority');
  });

  it.each(['prepared', 'bundle_sending', 'bundle_verified', 'manifest_sending', 'unknown'] as const)('refuses %s operation without mutating it', stage => {
    const h = fixture();
    const plan = planArchiveSnapshot(h.input);
    h.state.operation = { id: 'uncertain', sequence: 2, authorityRevision: h.authority.revision, eventIds: ['e1'], stage, createdAt: now };
    const original = structuredClone(h.input);
    expectFailure(() => planArchiveSnapshot(h.input), 'unknown_delivery');
    expectFailure(() => verifyArchiveSnapshot(h.input, plan, plan.digest), 'unknown_delivery');
    expect(h.input).toEqual(original);
  });

  it('requires original trusted head bytes to authenticate expiry, complete chain and corpus', () => {
    const h = fixture(Array.from({ length: 9 }, (_, n) => event(n)));
    const original = structuredClone(h.input);
    expectFailure(() => planArchiveSnapshot({ ...h.input, files: h.files.slice(1) }), 'integrity');
    expectFailure(() => planArchiveSnapshot({ ...h.input, files: [...h.files, { fileId: 'extra', bytes: encode({}) }] }), 'integrity');
    expectFailure(() => planArchiveSnapshot({ ...h.input, files: [...h.files, h.files[0]] }), 'integrity');
    const forged = structuredClone(h.files), bundle = decode(forged[0].bytes);
    bundle.events[0].expiresAt++;
    forged[0].bytes = encode(bundle);
    expectFailure(() => planArchiveSnapshot({ ...h.input, files: forged }), 'integrity');
    expect(h.input).toEqual(original);
  });

  it('rejects root, receipt, source identity and pending/archive inconsistencies', () => {
    const h = fixture();
    for (const change of [
      (s: ArchiveState) => { s.head!.digest = '0'.repeat(64); },
      (s: ArchiveState) => { s.receipts.pop(); },
      (s: ArchiveState) => { s.receipts[0].fingerprint = '0'.repeat(64); },
      (s: ArchiveState) => { s.receipts[0].sourceRevision++; },
      (s: ArchiveState) => { s.receipts[0].logicalId = 'wrong'; },
      (s: ArchiveState) => { s.pending.push(event(1)); },
      (s: ArchiveState) => { s.receipts.push({ ...s.receipts[0] }); },
      (s: ArchiveState) => { s.receipts.push({ ...s.receipts[0], eventId: 'duplicate-revision' }); },
    ]) {
      const state = structuredClone(h.state); change(state);
      expectFailure(() => planArchiveSnapshot({ ...h.input, state }), 'integrity');
    }
    const missing = fixture([], [event(1)]); missing.state.pending = [];
    expectFailure(() => planArchiveSnapshot(missing.input), 'integrity');
  });

  it('rejects stale authority, expiry, bot, account/person/space/container and state revisions', () => {
    const h = fixture(), plan = planArchiveSnapshot(h.input);
    const authorities: ArchiveAuthority[] = [
      { ...h.authority, allowed: false }, { ...h.authority, expiresAt: now },
      { ...h.authority, revision: 'revoked' }, { ...h.authority, botId: 8 },
      { ...h.authority, suppressedEventIds: ['e1'] }, { ...h.authority, expiresAt: h.authority.expiresAt + 1 },
      ...(['accountId', 'personId', 'agentId', 'containerId'] as const).map(key => ({ ...h.authority, scope: { ...scope, [key]: 'different' } })),
      { ...h.authority, scope: { ...scope, space: 'personal' as const } },
    ];
    for (const authority of authorities) expectFailure(() => verifyArchiveSnapshot({ ...h.input, authority }, plan, plan.digest));
    expectFailure(() => verifyArchiveSnapshot({ ...h.input, state: { ...h.state, revision: h.state.revision + 1 } }, plan, plan.digest), 'authority');
  });

  it('rejects changed, reordered, missing, extra and redigested snapshot artifacts', () => {
    const h = fixture(Array.from({ length: 16 }, (_, n) => event(n, { text: '\u0000'.repeat(2500) })));
    const plan = planArchiveSnapshot(h.input);
    expect(plan.chunks.length).toBeGreaterThan(1);
    const alteredManifest = decode(plan.manifest); alteredManifest.createdAt--;
    const changedChunks = plan.chunks.map(bytes => bytes.slice()); changedChunks[0][5] ^= 1;
    for (const artifacts of [
      { manifest: encode(alteredManifest), chunks: plan.chunks },
      { manifest: plan.manifest, chunks: changedChunks },
      { manifest: plan.manifest, chunks: [...plan.chunks].reverse() },
      { manifest: plan.manifest, chunks: plan.chunks.slice(1) },
      { manifest: plan.manifest, chunks: [...plan.chunks, plan.chunks[0]] },
    ]) expectFailure(() => verifyArchiveSnapshot(h.input, artifacts, plan.digest), 'integrity');
    const chunk = decode(plan.chunks[0]); chunk.entries[0].event.expiresAt++;
    const forgedChunks = [encode(chunk), ...plan.chunks.slice(1)];
    const forgedManifest = decode(plan.manifest);
    forgedManifest.chunks[0].digest = archiveDigest(forgedChunks[0]); forgedManifest.chunks[0].bytes = forgedChunks[0].byteLength;
    expectFailure(() => verifyArchiveSnapshot(h.input, { manifest: encode(forgedManifest), chunks: forgedChunks }, plan.digest), 'integrity');
  });

  it('supports empty plans and canonical-pending-only plans', () => {
    for (const h of [fixture([]), fixture([], [event(1, { text: 'فارسی 😀 \\"\n' })])]) {
      const plan = planArchiveSnapshot(h.input);
      expect(verifyArchiveSnapshot(h.input, plan, plan.digest).events).toEqual(h.state.pending);
      expect(plan.metrics.sourceFiles).toBe(0);
    }
  });

  it('bounds input/state/artifact bytes, files and chunks without partial output', () => {
    const h = fixture(), plan = planArchiveSnapshot(h.input);
    expectFailure(() => planArchiveSnapshot({ ...h.input, files: Array.from({ length: MAX_SNAPSHOT_SOURCE_FILES + 1 }, () => h.files[0]) }), 'capacity');
    expectFailure(() => planArchiveSnapshot({ ...h.input, files: [{ fileId: 'too-large', bytes: new Uint8Array(MAX_ARCHIVE_FILE_BYTES + 1) }] }), 'capacity');
    expectFailure(() => verifyArchiveSnapshot(h.input, { ...plan, manifest: new Uint8Array(MAX_ARCHIVE_FILE_BYTES + 1) }, plan.digest), 'capacity');
    expectFailure(() => verifyArchiveSnapshot(h.input, { ...plan, chunks: Array.from({ length: MAX_SNAPSHOT_CHUNKS + 1 }, () => plan.chunks[0]) }, plan.digest), 'capacity');
    const tooLarge = fixture(Array.from({ length: 1024 }, (_, n) => event(n, { logicalId: `logical${n}`.padEnd(200, 'x') })));
    expect(encode(tooLarge.state).byteLength).toBeGreaterThan(MAX_ARCHIVE_STATE_BYTES);
    expectFailure(() => planArchiveSnapshot(tooLarge.input), 'capacity');
  });

  it('sanitizes malformed source JSON and schema errors without exposing decoded text', () => {
    const h = fixture(), sentinel = 'PRIVATE-SOURCE-SENTINEL';
    for (const bytes of [new TextEncoder().encode(`{${sentinel}`), encode({ [sentinel]: sentinel })]) {
      const input = structuredClone(h.input);
      const file = input.files.find(f => f.fileId === input.state.head!.fileId)!;
      file.bytes = bytes; input.state.head!.digest = archiveDigest(bytes);
      try { planArchiveSnapshot(input); throw new Error('Expected refusal'); }
      catch (error) {
        expect(error).toMatchObject({ name: 'ArchiveUnavailableError' });
        expect(String(error)).not.toContain(sentinel);
        expect(JSON.stringify(error)).not.toContain(sentinel);
      }
    }
  });

  it('qualifies a full 1024-receipt / 128-checkpoint synthetic horizon deterministically', () => {
    const h = fixture(Array.from({ length: 1024 }, (_, n) => event(n, { text: `فارسی 😀 ${n}` })));
    expect(encode(h.state).byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_STATE_BYTES);
    const original = structuredClone(h.input), started = performance.now(), plan = planArchiveSnapshot(h.input);
    const plannedMs = performance.now() - started, verifyStarted = performance.now();
    const result = verifyArchiveSnapshot(h.input, plan, plan.digest), verifiedMs = performance.now() - verifyStarted;
    expect(result.events).toHaveLength(1024); expect(result.receipts).toEqual(h.state.receipts);
    expect(plan.metrics.sourceFiles).toBe(256); expect(plan.metrics.networkRequests).toBe(0);
    expect(plan.manifest.byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_FILE_BYTES);
    for (const chunk of plan.chunks) expect(chunk.byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_FILE_BYTES);
    expect(planArchiveSnapshot({ ...h.input, files: [...h.files].reverse() })).toEqual(plan);
    expect(h.input).toEqual(original);
    process.stdout.write(`Synthetic snapshot measurements ${JSON.stringify({ ...plan.metrics, stateBytes: encode(h.state).byteLength, plannedMs, verifiedMs })}\n`);
  });
});
