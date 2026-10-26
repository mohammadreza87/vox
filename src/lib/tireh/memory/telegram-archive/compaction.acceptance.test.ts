/** Independent AM-05/AM-12 pure-compaction precursor acceptance.
 * Synthetic bytes only. No network, canonical writes, publication or capacity relief. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { planArchiveSnapshot, verifyArchiveSnapshot, MAX_SNAPSHOT_CHUNKS, MAX_SNAPSHOT_SOURCE_BYTES, MAX_SNAPSHOT_SOURCE_FILES } from './compaction';
import { ArchiveUnavailableError, type ArchiveAuthority, type ArchiveEvent, type ArchiveHead, type ArchiveState } from './contracts';
import { MAX_ARCHIVE_FILE_BYTES, MAX_ARCHIVE_STATE_BYTES } from './service';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Independent receipt oracle: receivedAt and expiresAt deliberately are not authenticated by this receipt hash.
const fingerprint = (e: ArchiveEvent) => hash(encode([e.eventId, e.logicalId, e.revision, e.occurredAt, e.role, e.text, e.sourceMessageId ?? null]));
const receipt = (e: ArchiveEvent) => ({ eventId: e.eventId, logicalId: e.logicalId, sourceRevision: e.revision, fingerprint: fingerprint(e) });
const event = (n: number, overrides: Partial<ArchiveEvent> = {}): ArchiveEvent => ({ eventId: `qa-event-${n}`, logicalId: `qa-source-${n}`, revision: 1,
  occurredAt: 100 + n, receivedAt: 200 + n, expiresAt: 1_000_000 + n, role: 'user', text: `QA_TEXT_${n}`, sourceMessageId: n + 1, ...overrides });
function corpus(groups: ArchiveEvent[][] = [[event(1), event(2)]], pending: ArchiveEvent[] = [], padFiles = false) {
  const scope = { accountId: 'telegram-account:101', personId: 'qa-person', agentId: 'qa-agent', space: 'work' as const, containerId: 'qa-private-work' };
  const authority: ArchiveAuthority = { scope, revision: 'qa-current-authority', allowed: true, botId: 7001, expiresAt: 10_000_000, suppressedEventIds: [] };
  const state: ArchiveState = { schemaVersion: 1, scope, botId: 7001, revision: 7, pending, receipts: [...groups.flat(), ...pending].map(receipt) };
  const files: { fileId: string; bytes: Uint8Array }[] = [];
  const sourceBytes = (value: unknown) => { const raw = encode(value); if (!padFiles) return raw;
    const padded = new Uint8Array(MAX_ARCHIVE_FILE_BYTES).fill(32); padded.set(raw); return padded; };
  let previous: ArchiveHead | null = null;
  for (const [i, events] of groups.entries()) {
    const common = { schemaVersion: 1, scope, botId: 7001, sequence: i + 1, operationId: `qa-op-${i + 1}` };
    const bundle = { fileId: `qa-bundle-${i + 1}`, bytes: sourceBytes({ ...common, kind: 'events', events }) }; files.push(bundle);
    const manifest = { fileId: `qa-manifest-${i + 1}`, bytes: sourceBytes({ ...common, kind: 'manifest', authorityRevision: 'qa-historical-authority', createdAt: 1000 + i,
      bundle: { fileId: bundle.fileId, messageId: i * 2 + 1, digest: hash(bundle.bytes) }, previous }) }; files.push(manifest);
    previous = { fileId: manifest.fileId, messageId: i * 2 + 2, digest: hash(manifest.bytes), sequence: i + 1 };
  }
  if (previous) state.head = previous;
  return { state, authority, now: 10_000, files };
}
function unavailable(action: () => unknown) {
  try { action(); throw Error('QA_EXPECTED_REFUSAL'); }
  catch (error) { expect(error).toBeInstanceOf(ArchiveUnavailableError); expect(String(error)).not.toContain('QA_PRIVATE_CANARY'); }
}
// Rebind synthetic immutable-source digests after deliberately changing a source's semantics.
function rewriteFirstSource(f: ReturnType<typeof corpus>, change: (bundle: ReturnType<typeof decode>, manifest: ReturnType<typeof decode>) => void) {
  const bundle = decode(f.files[0].bytes), manifest = decode(f.files[1].bytes); change(bundle, manifest);
  f.files[0].bytes = encode(bundle); manifest.bundle.digest = hash(f.files[0].bytes); f.files[1].bytes = encode(manifest); f.state.head!.digest = hash(f.files[1].bytes);
}

describe('AM-05/AM-12 independent pure snapshot precursor acceptance', () => {
  it('round-trips an empty authorized archive without inventing sources or chunks', () => {
    const f = corpus([], []), plan = planArchiveSnapshot(f); expect(plan.chunks).toEqual([]);
    expect(verifyArchiveSnapshot(f, plan, plan.digest)).toMatchObject({ events: [], receipts: [], metrics: { sourceFiles: 0, sourceBytes: 0, chunks: 0, networkRequests: 0 } });
  });
  it('round-trips trusted chain plus canonical pending with original scope, receipts, text and expiry', () => {
    const f = corpus([[event(1)], [event(2)]], [event(3, { text: 'QA_FA ارائه جمعه' })]);
    const plan = planArchiveSnapshot(f), restored = verifyArchiveSnapshot(f, plan, plan.digest);
    expect(plan.digest).toBe(hash(plan.manifest)); expect(restored.events).toEqual([event(1), event(2), event(3, { text: 'QA_FA ارائه جمعه' })]);
    expect(restored.receipts).toEqual(f.state.receipts); expect(restored.metrics).toMatchObject({ sourceFiles: 4, receipts: 3, activeEvents: 3, networkRequests: 0 });
    expect(decode(plan.manifest)).toMatchObject({ scope: f.state.scope, botId: 7001, sourceRevision: 7, sourceHead: f.state.head,
      authorityRevision: f.authority.revision, authorityExpiresAt: f.authority.expiresAt });
  });

  it('keeps every source revision/receipt while retaining no suppressed, expired or superseded text', () => {
    const old = event(1, { logicalId: 'qa-topic', text: 'QA_OLD_TEXT', revision: 1 }), current = event(2, { logicalId: 'qa-topic', revision: 2 });
    const expired = event(3, { expiresAt: 9000, text: 'QA_EXPIRED_TEXT' }), suppressed = event(4, { text: 'QA_SUPPRESSED_TEXT' });
    const f = corpus([[old, current, expired, suppressed]]); f.state.receipts[3].suppressed = true; f.authority.suppressedEventIds = [suppressed.logicalId];
    const plan = planArchiveSnapshot(f), restored = verifyArchiveSnapshot(f, plan, plan.digest), text = new TextDecoder().decode(plan.manifest) + plan.chunks.map(b => new TextDecoder().decode(b)).join();
    expect(restored.events).toEqual([current]); expect(restored.receipts).toEqual(f.state.receipts);
    for (const secret of [old.text, expired.text, suppressed.text]) expect(text).not.toContain(secret);
    const entries = plan.chunks.flatMap(b => decode(b).entries);
    expect(entries.map(e => e.disposition)).toEqual(['superseded', 'active', 'expired', 'suppressed']);
    expect(entries[0].timing.expiresAt).toBe(old.expiresAt); expect(entries[2].timing.expiresAt).toBe(expired.expiresAt); expect(entries[3].timing).toBeUndefined();
  });

  it('permits removed never-uploaded suppressed payload, but never missing unsuppressed or expired payload', () => {
    const f = corpus([], []), omitted = event(8); f.state.receipts = [{ ...receipt(omitted), suppressed: true }]; f.authority.suppressedEventIds = [omitted.logicalId];
    const plan = planArchiveSnapshot(f); expect(verifyArchiveSnapshot(f, plan, plan.digest)).toMatchObject({ events: [], receipts: f.state.receipts });
    delete f.state.receipts[0].suppressed; f.authority.suppressedEventIds = []; unavailable(() => planArchiveSnapshot(f));
  });

  it('selects the latest receipt before filtering expiry, so older still-unexpired text never revives', () => {
    const old = event(1, { logicalId: 'qa-topic', revision: 1 }), latest = event(2, { logicalId: 'qa-topic', revision: 2, expiresAt: 9000 });
    const f = corpus([[old, latest]]), plan = planArchiveSnapshot(f); expect(verifyArchiveSnapshot(f, plan, plan.digest).events).toEqual([]);
  });

  it('expires a planned active source at its original deadline without extending retention or dropping its receipt', () => {
    const f = corpus([[event(1, { expiresAt: 10001 })]]), plan = planArchiveSnapshot(f);
    expect(verifyArchiveSnapshot({ ...f, now: 10001 }, plan, plan.digest)).toMatchObject({ events: [], receipts: f.state.receipts });
  });

  it('refuses a detached corpus and filtered recover() evidence instead of treating them as complete lineage', () => {
    const f = corpus(); delete f.state.head;
    unavailable(() => planArchiveSnapshot(f)); unavailable(() => planArchiveSnapshot({ ...f, files: [] }));
    const pending = corpus([], [event(1)]); expect(verifyArchiveSnapshot(pending, planArchiveSnapshot(pending), planArchiveSnapshot(pending).digest).events).toEqual([event(1)]);
  });

  it.each(['prepared', 'bundle_sending', 'bundle_verified', 'manifest_sending', 'unknown'] as const)('refuses outstanding operation %s without cancelling or reconciling it', stage => {
    const f = corpus(), clean = planArchiveSnapshot(f); f.state.operation = { id: 'qa-uncertain', sequence: 2, authorityRevision: 'qa-current-authority', eventIds: ['qa-event-1'], stage, createdAt: 1000 };
    const before = structuredClone(f.state); unavailable(() => planArchiveSnapshot(f)); unavailable(() => verifyArchiveSnapshot(f, clean, clean.digest)); expect(f.state).toEqual(before);
  });

  it.each(['person', 'agent', 'space', 'container', 'account', 'bot'] as const)('refuses state/current-authority scope mismatch: %s', key => {
    const f = corpus();
    if (key === 'bot') f.authority.botId++;
    else if (key === 'space') f.authority.scope = { ...f.authority.scope, space: 'personal' };
    else { const field = `${key}Id` as 'personId' | 'agentId' | 'containerId' | 'accountId'; f.authority.scope = { ...f.authority.scope, [field]: 'qa-other' }; }
    unavailable(() => planArchiveSnapshot(f));
  });

  it.each(['denied', 'expired', 'missing-suppression'] as const)('refuses absent current authority: %s', cause => {
    const f = corpus();
    if (cause === 'denied') f.authority.allowed = false;
    else if (cause === 'expired') f.authority.expiresAt = f.now;
    else f.state.receipts[0].suppressed = true;
    unavailable(() => planArchiveSnapshot(f));
  });

  it.each(['revision', 'expiry', 'suppression', 'state-revision', 'pending-expiry', 'head', 'time-rewind'] as const)('rejects stale snapshot when current binding changes: %s', changed => {
    const f = corpus([[event(1)]], [event(2)]), plan = planArchiveSnapshot(f);
    if (changed === 'revision') f.authority.revision = 'qa-new-authority';
    if (changed === 'expiry') f.authority.expiresAt--;
    if (changed === 'suppression') { f.state.receipts[0].suppressed = true; f.authority.suppressedEventIds = ['qa-source-1']; }
    if (changed === 'state-revision') f.state.revision++;
    if (changed === 'pending-expiry') f.state.pending[0].expiresAt++;
    if (changed === 'head') f.state.head!.fileId = 'qa-other-head';
    if (changed === 'time-rewind') f.now--;
    unavailable(() => verifyArchiveSnapshot(f, plan, plan.digest));
  });

  it.each(['missing-file', 'extra-file', 'duplicate-file', 'corrupt-bytes', 'invalid-utf8'] as const)('rejects incomplete or conflicting raw coverage: %s', change => {
    const f = corpus();
    if (change === 'missing-file') f.files.pop();
    if (change === 'extra-file') f.files.push({ fileId: 'qa-unrelated', bytes: encode({}) });
    if (change === 'duplicate-file') f.files.push({ ...f.files[0] });
    if (change === 'corrupt-bytes') f.files[0].bytes[0] ^= 1;
    if (change === 'invalid-utf8') { f.files[1].bytes = new Uint8Array([0xff, 0xfe]); f.state.head!.digest = hash(f.files[1].bytes); }
    unavailable(() => planArchiveSnapshot(f));
  });

  it.each(['scope', 'bot', 'sequence', 'operation', 'future-created', 'unknown-version', 'unknown-secret-key'] as const)('rejects internally invalid but rehashed trusted source: %s', change => {
    const f = corpus(); rewriteFirstSource(f, (bundle, manifest) => {
      if (change === 'scope') bundle.scope = { ...bundle.scope, personId: 'qa-other' };
      if (change === 'bot') bundle.botId++;
      if (change === 'sequence') manifest.sequence++;
      if (change === 'operation') bundle.operationId = 'qa-other-operation';
      if (change === 'future-created') manifest.createdAt = f.now + 1;
      if (change === 'unknown-version') bundle.schemaVersion = 2;
      if (change === 'unknown-secret-key') bundle.QA_PRIVATE_CANARY = 'QA_PRIVATE_CANARY';
    }); unavailable(() => planArchiveSnapshot(f));
  });

  it('detects expiry-only corruption through source head hashes despite unchanged admission fingerprint', () => {
    const f = corpus(), bundle = decode(f.files[0].bytes), original = fingerprint(bundle.events[0]); bundle.events[0].expiresAt += 999999;
    expect(fingerprint(bundle.events[0])).toBe(original); f.files[0].bytes = encode(bundle); unavailable(() => planArchiveSnapshot(f));
  });

  it.each(['fingerprint', 'logical-id', 'revision', 'duplicate-event', 'duplicate-logical-version', 'missing-receipt', 'missing-payload'] as const)('refuses receipt/source accounting mismatch: %s', change => {
    const f = corpus();
    if (change === 'fingerprint') f.state.receipts[0].fingerprint = 'a'.repeat(64);
    if (change === 'logical-id') f.state.receipts[0].logicalId = 'qa-other';
    if (change === 'revision') f.state.receipts[0].sourceRevision++;
    if (change === 'duplicate-event') f.state.receipts[1].eventId = f.state.receipts[0].eventId;
    if (change === 'duplicate-logical-version') f.state.receipts[1].logicalId = f.state.receipts[0].logicalId;
    if (change === 'missing-receipt') f.state.receipts.pop();
    if (change === 'missing-payload') f.state.receipts.push(receipt(event(99)));
    unavailable(() => planArchiveSnapshot(f));
  });

  it.each(['manifest', 'chunk', 'drop-chunk', 'extra-chunk', 'repinned-untrusted-manifest'] as const)('returns no partial result for tampered snapshot %s', change => {
    const f = corpus(), plan = planArchiveSnapshot(f), expected = plan.digest;
    if (change === 'manifest') plan.manifest[0] ^= 1;
    if (change === 'chunk') plan.chunks[0][0] ^= 1;
    const chunks = [...plan.chunks];
    if (change === 'drop-chunk') chunks.pop();
    if (change === 'extra-chunk') chunks.push(plan.chunks[0]);
    if (change === 'repinned-untrusted-manifest') { const chunk = decode(chunks[0]); chunk.entries[0].event.expiresAt += 5000; chunk.entries[0].timing.expiresAt += 5000;
      chunks[0] = encode(chunk); const manifest = decode(plan.manifest); manifest.chunks[0].digest = hash(chunks[0]); manifest.chunks[0].bytes = chunks[0].byteLength; plan.manifest = encode(manifest);
      expect(hash(plan.manifest)).not.toBe(expected); }
    unavailable(() => verifyArchiveSnapshot(f, { manifest: plan.manifest, chunks }, expected));
  });

  it('handles all 128 checkpoints / 256 files / 1024 receipts without truncation and measures bounded snapshot work', () => {
    const events = Array.from({ length: 1024 }, (_, n) => event(n + 1, { text: `QA_${n}_` + 'x'.repeat(600) }));
    const f = corpus(Array.from({ length: 128 }, (_, n) => events.slice(n * 8, n * 8 + 8)), [], true);
    expect(encode(f.state).byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_STATE_BYTES);
    const start = performance.now(), plan = planArchiveSnapshot(f), planned = performance.now(), restored = verifyArchiveSnapshot(f, plan, plan.digest), done = performance.now();
    expect(restored.receipts).toEqual(f.state.receipts); expect(restored.events).toEqual(events); expect(plan.metrics.receipts).toBe(1024);
    expect(plan.metrics.sourceFiles).toBe(256); expect(plan.metrics.sourceBytes).toBe(MAX_SNAPSHOT_SOURCE_BYTES); expect(plan.manifest.byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_FILE_BYTES);
    expect(plan.chunks.length).toBeGreaterThan(1); expect(plan.chunks.length).toBeLessThanOrEqual(MAX_SNAPSHOT_CHUNKS); for (const b of plan.chunks) expect(b.byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_FILE_BYTES);
    console.info('QA_COMPACTION_SYNTHETIC_BOUNDS', { ...plan.metrics, planMs: planned - start, verifyMs: done - planned });
    unavailable(() => verifyArchiveSnapshot(f, { manifest: plan.manifest, chunks: [...plan.chunks].reverse() }, plan.digest));
  });

  it('supports all 128 snapshot chunks with maximally escaped source text without dropping accepted sources', () => {
    const events = Array.from({ length: 640 }, (_, n) => event(n + 1, { text: '\u0000'.repeat(4096) }));
    const f = corpus(Array.from({ length: 128 }, (_, n) => events.slice(n * 5, n * 5 + 5))), plan = planArchiveSnapshot(f);
    expect(plan.chunks).toHaveLength(MAX_SNAPSHOT_CHUNKS); for (const b of plan.chunks) expect(b.byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_FILE_BYTES);
    expect(verifyArchiveSnapshot(f, plan, plan.digest).events).toEqual(events); expect(plan.metrics.receipts).toBe(640);
  });

  it.each(['files', 'file-bytes', 'state-bytes', 'checkpoints', 'receipts', 'manifest-bytes', 'snapshot-chunks'] as const)('fails closed beyond declared bound: %s', bound => {
    const f = corpus(), plan = planArchiveSnapshot(f);
    if (bound === 'files') { f.files = Array.from({ length: MAX_SNAPSHOT_SOURCE_FILES + 1 }, (_, n) => ({ fileId: `qa-${n}`, bytes: encode({}) })); unavailable(() => planArchiveSnapshot(f)); }
    if (bound === 'file-bytes') { f.files[0].bytes = new Uint8Array(MAX_ARCHIVE_FILE_BYTES + 1); unavailable(() => planArchiveSnapshot(f)); }
    if (bound === 'state-bytes') { f.state.receipts = Array.from({ length: 1024 }, (_, n) => ({ eventId: `qa-${n}`.padEnd(200, 'x'), logicalId: `qa-${n}`.padEnd(200, 'y'), sourceRevision: 1, fingerprint: 'a'.repeat(64) })); unavailable(() => planArchiveSnapshot(f)); }
    if (bound === 'checkpoints') { f.state.head!.sequence = 129; unavailable(() => planArchiveSnapshot(f)); }
    if (bound === 'receipts') { f.state.receipts = Array.from({ length: 1025 }, (_, n) => receipt(event(n))); unavailable(() => planArchiveSnapshot(f)); }
    if (bound === 'manifest-bytes') unavailable(() => verifyArchiveSnapshot(f, { manifest: new Uint8Array(MAX_ARCHIVE_FILE_BYTES + 1), chunks: [] }, plan.digest));
    if (bound === 'snapshot-chunks') unavailable(() => verifyArchiveSnapshot(f, { manifest: plan.manifest, chunks: Array.from({ length: MAX_SNAPSHOT_CHUNKS + 1 }, () => plan.chunks[0]) }, plan.digest));
  });

  it('preserves UTF8, control escaping and deterministic output without mutating or aliasing caller state', () => {
    const f = corpus([[event(1, { text: 'فارسی 👋\n"\\' + '\u0000'.repeat(100) })]], [event(2)]), before = structuredClone(f);
    const first = planArchiveSnapshot(f), second = planArchiveSnapshot({ ...f, files: [...f.files].reverse() });
    expect(first).toEqual(second); expect(f).toEqual(before);
    const restored = verifyArchiveSnapshot(f, first, first.digest); expect(restored.events[0].text).toBe(decode(f.files[0].bytes).events[0].text);
    restored.events[0].text = 'QA_MUTATED_OUTPUT'; restored.receipts[0].fingerprint = 'c'.repeat(64);
    expect(f).toEqual(before); expect(verifyArchiveSnapshot(f, first, first.digest).events[0].text).not.toBe('QA_MUTATED_OUTPUT');
  });
});
