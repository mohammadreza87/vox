import { describe, expect, it } from 'vitest';
import { TelegramMemoryArchive } from './service';
import { archiveStateSchema, type ArchiveAuthority, type ArchiveEvent, type ArchivePublicationClaim,
  type ArchiveRepository, type ArchiveScope, type ArchiveState, type ArchiveTransport } from './contracts';
import { isCurrentPublicationClaim, retireArchiveOperation } from './publication';
import { MAX_ARCHIVE_STATE_BYTES } from './limits';
import { planArchiveSnapshot, verifyArchiveSnapshot } from './compaction';

const scope: ArchiveScope = { accountId: 'telegram-account:42', personId: 'person42', agentId: 'agent1', space: 'work', containerId: 'private42' };
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  let state: ArchiveState | null = null, now = 1000, enabled = true, current = true, uploadCount = 0;
  const auth: ArchiveAuthority = { scope, revision: 'authority1', allowed: true, botId: 7, expiresAt: 900_000, suppressedEventIds: [] };
  const files = new Map<string, Uint8Array>(), downloads: string[] = [], publicationSizes: number[] = [];
  const repo: ArchiveRepository = {
    read: async () => structuredClone(state),
    isPublicationCurrent: (_scope, claim) => isCurrentPublicationClaim(state, claim),
    transact: async (_scope, mutate, beforeCommit) => {
      const next = mutate(structuredClone(state)); beforeCommit(); state = archiveStateSchema.parse(structuredClone(next.state));
      if (state.publication) publicationSizes.push(encode(state).byteLength);
      return next.result;
    },
  };
  const transport: ArchiveTransport = {
    upload: async (_chat, _filename, bytes, authorize) => {
      if (!authorize()) throw new Error('Denied synthetic dispatch');
      const fileId = `synthetic-${++uploadCount}`;
      files.set(fileId, bytes.slice()); return { fileId, messageId: uploadCount };
    },
    download: async fileId => { downloads.push(fileId); const bytes = files.get(fileId); if (!bytes) throw new Error('Missing synthetic file'); return bytes.slice(); },
  };
  const service = () => new TelegramMemoryArchive(repo, { read: async () => structuredClone(auth),
    isCurrent: snapshot => current && snapshot.revision === auth.revision }, transport,
  { now: () => now, snapshotPublicationEnabled: () => enabled });
  const event = (n: number, patch: Partial<ArchiveEvent> = {}): ArchiveEvent => ({ eventId: `event${n}`, logicalId: `logical${n}`, revision: 1,
    occurredAt: 100 + n, receivedAt: now, expiresAt: 800_000, text: `SOURCE_${n}`, role: 'user', ...patch });
  const seed = async (count = 8) => { const s = service(); for (let n = 1; n <= count; n++) await s.capture(scope, event(n)); await s.checkpoint(scope, { force: true }); };
  return { auth, repo, transport, files, downloads, publicationSizes, service, event, seed,
    get state() { return state!; }, set state(value) { state = value; }, get uploads() { return uploadCount; },
    set now(value) { now = value; }, set enabled(value) { enabled = value; }, set current(value) { current = value; } };
}

describe('bounded explicit snapshot publication', () => {
  it('refuses unavailable publication, unsupported repositories and unflushed source without sends', async () => {
    const h = fixture(); await h.seed(); h.enabled = false;
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'authority' });
    h.enabled = true; h.repo.isPublicationCurrent = undefined;
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'authority' });
    h.repo.isPublicationCurrent = (_scope, claim) => isCurrentPublicationClaim(h.state, claim);
    await h.service().capture(scope, h.event(9));
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'unknown_delivery' });
    expect(h.uploads).toBe(2); expect(h.state.pending).toHaveLength(1);
  });
  it('publishes, restarts without old source files, and recovers later checkpoint suffixes', async () => {
    const h = fixture(); await h.seed(); const sourceIds = [...h.files.keys()], originalHead = structuredClone(h.state.head);
    expect(await h.service().compact(scope)).toEqual({ status: 'published', sequence: 1, chunks: 1 });
    expect(h.state.head).toEqual(originalHead); expect(h.state.receipts).toHaveLength(8);
    for (const id of sourceIds) h.files.delete(id);
    expect((await h.service().recover(scope)).events.map(e => e.text)).toEqual(Array.from({ length: 8 }, (_, i) => `SOURCE_${i + 1}`));
    await h.service().capture(scope, h.event(9)); await h.service().checkpoint(scope, { force: true });
    expect(h.state.head?.sequence).toBe(2); expect(h.state.receipts).toHaveLength(9);
    expect((await h.service().recover(scope)).events).toHaveLength(9);
    const before = h.uploads; expect((await h.service().compact(scope)).status).toBe('already_published'); expect(h.uploads).toBe(before);
    expect(new Set(h.publicationSizes).size).toBe(1); expect(h.publicationSizes[0]).toBeLessThanOrEqual(MAX_ARCHIVE_STATE_BYTES);
  });
  it('does not revive older snapshot text when a later version expires or is suppressed', async () => {
    const h = fixture(); await h.seed(1); await h.service().compact(scope);
    await h.service().capture(scope, h.event(2, { logicalId: 'logical1', revision: 2, text: 'NEW_SOURCE', expiresAt: 1100 }));
    await h.service().checkpoint(scope, { force: true }); h.now = 1200;
    expect((await h.service().recover(scope)).events).toEqual([]);
    h.auth.suppressedEventIds = ['logical1']; h.auth.revision = 'authority2';
    for (const receipt of h.state.receipts) receipt.suppressed = true;
    expect((await h.service().recover(scope)).events).toEqual([]);
  });
  it('retains uncertain upload outcomes and never automatically resends after restart', async () => {
    const h = fixture(); await h.seed(); const upload = h.transport.upload;
    h.transport.upload = async (...args) => { await upload(...args); throw new Error('Lost synthetic upload response'); };
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'unknown_delivery' });
    expect(h.state.publication?.stage).toBe('unknown'); const sent = h.uploads;
    expect(await h.service().compact(scope)).toEqual({ status: 'unknown' }); expect(h.uploads).toBe(sent);
    expect((await h.service().recover(scope)).events).toHaveLength(8);
    await h.service().abandonUnknown(scope); h.transport.upload = upload;
    expect((await h.service().compact(scope)).status).toBe('published');
  });
  it('resumes a committed upload receipt by retrying readback without uploading it again', async () => {
    const h = fixture(); await h.seed(); const download = h.transport.download; let failOnce = true;
    h.transport.download = async (...args) => {
      if (h.state.publication?.stage === 'chunk_uploaded' && failOnce) { failOnce = false; throw new Error('Synthetic readback outage'); }
      return download(...args);
    };
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'integrity' });
    expect(h.state.publication?.stage).toBe('chunk_uploaded'); expect(h.uploads).toBe(3);
    expect((await h.service().compact(scope)).status).toBe('published'); expect(h.uploads).toBe(4);
  });
  it('resolves a lost final commit response from canonical state without repeating effects', async () => {
    const h = fixture(); await h.seed(); const transact = h.repo.transact; let loseOnce = true;
    h.repo.transact = async (...args) => {
      const before = !!h.state.publication, result = await transact(...args);
      if (before && h.state.snapshot && !h.state.publication && loseOnce) { loseOnce = false; throw new Error('Lost commit response'); }
      return result;
    };
    expect((await h.service().compact(scope)).status).toBe('already_published');
    const before = h.uploads; expect((await h.service().compact(scope)).status).toBe('already_published'); expect(h.uploads).toBe(before);
  });
  it('blocks stale dispatch after explicit abandonment under unchanged authority', async () => {
    const h = fixture(); await h.seed(); const upload = h.transport.upload;
    let entered!: () => void, release!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    h.transport.upload = async (...args) => { entered(); await held; return upload(...args); };
    const old = h.service().compact(scope); await waiting;
    expect(h.state.publication?.stage).toBe('chunk_sending');
    await h.service().abandonUnknown(scope);
    h.transport.upload = upload;
    expect((await h.service().compact(scope)).status).toBe('published');
    const afterReplacement = structuredClone(h.state), sent = h.uploads;
    release(); await expect(old).rejects.toMatchObject({ code: 'unknown_delivery' });
    expect(h.uploads).toBe(sent); expect(h.state).toEqual(afterReplacement);
  });
  it('fails closed on publication kill switch or source authority changing before dispatch', async () => {
    const h = fixture(); await h.seed(); const upload = h.transport.upload;
    h.transport.upload = async (...args) => { h.enabled = false; return upload(...args); };
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'unknown_delivery' });
    expect(h.uploads).toBe(2); expect(h.state.publication?.stage).toBe('unknown');
    h.enabled = true; await h.service().abandonUnknown(scope);
    h.transport.upload = async (...args) => { h.current = false; return upload(...args); };
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'unknown_delivery' });
    expect(h.uploads).toBe(2); expect(h.state.publication?.stage).toBe('unknown');
  });
  it('preserves source expiry and cancels prepared work without sending expired text', async () => {
    const h = fixture(); await h.seed(1); const transact = h.repo.transact;
    h.repo.transact = async (...args) => { const result = await transact(...args);
      if (h.state.publication?.stage === 'prepared' && !h.state.publication.chunkRefs.length) h.now = 800_000;
      return result;
    };
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'authority' });
    expect(h.uploads).toBe(2); expect(h.state.publication).toBeUndefined(); expect(h.state.head?.sequence).toBe(1);
  });
  it('authenticates the published root and refuses missing or corrupt snapshot chunks', async () => {
    const h = fixture(); await h.seed(); await h.service().compact(scope);
    const published = JSON.parse(new TextDecoder().decode(h.files.get(h.state.snapshot!.manifest.fileId)));
    h.files.set(published.chunks[0].fileId, encode({ kind: 'corrupt' }));
    await expect(h.service().recover(scope)).rejects.toMatchObject({ code: 'integrity' });
  });
  it('projects checkpoint and snapshot uncertainty without retaining source text or overwriting roots', async () => {
    const h = fixture(); await h.seed(); const source = structuredClone(h.state);
    source.operation = { id: 'checkpoint-uncertain', sequence: 2, authorityRevision: 'authority1', eventIds: ['event1'],
      stage: 'bundle_verified', bundle: { fileId: 'known', messageId: 1, digest: 'a'.repeat(64) }, createdAt: 1000 };
    expect(retireArchiveOperation(source)).toMatchObject({ kind: 'checkpoint', stage: 'unknown', files: [{ fileId: 'known' }] });
    const upload = h.transport.upload; h.transport.upload = async (...args) => { await upload(...args); throw new Error('Lost'); };
    await expect(h.service().compact(scope)).rejects.toBeDefined();
    const retired = retireArchiveOperation(h.state);
    expect(retired).toMatchObject({ kind: 'snapshot', stage: 'unknown' }); expect(JSON.stringify(retired)).not.toContain('SOURCE_');
  });
  it('keeps pure snapshot APIs closed to already-published or staged state', async () => {
    const h = fixture(); await h.seed(); const raw = [...h.files].map(([fileId, bytes]) => ({ fileId, bytes }));
    const plan = planArchiveSnapshot({ state: h.state, authority: h.auth, now: 1000, files: raw });
    await h.service().compact(scope);
    expect(() => planArchiveSnapshot({ state: h.state, authority: h.auth, now: 1000, files: raw })).toThrow();
    expect(() => verifyArchiveSnapshot({ state: h.state, authority: h.auth, now: 1000 }, plan, plan.digest)).toThrow();
  });
  it('checks synchronous committed claims and denies changed stage, identity or source proof', async () => {
    const h = fixture(); await h.seed(); let saved: ArchivePublicationClaim | undefined;
    const current = h.repo.isPublicationCurrent!;
    h.repo.isPublicationCurrent = (key, claim) => { saved = claim; return current(key, claim); };
    await h.service().compact(scope); expect(saved).toBeDefined();
    expect(isCurrentPublicationClaim(h.state, saved!)).toBe(false);
  });
  it('reserves the full JSON escaping cost of accepted provider IDs and maximum message IDs', async () => {
    const h = fixture(); await h.seed(); const upload = h.transport.upload;
    h.transport.upload = async (...args) => {
      const receipt = await upload(...args), bytes = h.files.get(receipt.fileId)!;
      const fileId = '\u0000'.repeat(199) + String.fromCharCode(65 + receipt.messageId);
      h.files.delete(receipt.fileId); h.files.set(fileId, bytes);
      return { fileId, messageId: Number.MAX_SAFE_INTEGER };
    };
    expect((await h.service().compact(scope)).status).toBe('published');
    expect((await h.service().recover(scope)).events).toHaveLength(8);
    expect(new Set(h.publicationSizes).size).toBe(1);
    expect(h.publicationSizes[0]).toBeLessThanOrEqual(MAX_ARCHIVE_STATE_BYTES);
  });
  it('refuses more than sixteen runtime chunks before sending or discarding any source', async () => {
    const h = fixture(), s = h.service();
    for (let n = 1; n <= 100; n++) {
      await s.capture(scope, h.event(n, { text: '\u0001'.repeat(4096) }));
      if (n % 2 === 0) await s.checkpoint(scope, { force: true });
    }
    const before = h.uploads, receiptCount = h.state.receipts.length;
    await expect(s.compact(scope)).rejects.toMatchObject({ code: 'capacity' });
    expect(h.uploads).toBe(before); expect(h.state.publication).toBeUndefined();
    expect(h.state.receipts).toHaveLength(receiptCount); expect(h.state.head?.sequence).toBe(50);
  });
  it('refuses insufficient numeric revision space before uploading a snapshot', async () => {
    const h = fixture(); await h.seed(); h.state.revision = Number.MAX_SAFE_INTEGER - 1;
    await expect(h.service().compact(scope)).rejects.toMatchObject({ code: 'capacity' });
    expect(h.state.publication).toBeUndefined(); expect(h.uploads).toBe(2);
  });
});
