import { describe, expect, it } from 'vitest';
import { TelegramMemoryArchive, MAX_ARCHIVE_PENDING_BYTES } from './service';
import { archiveStateSchema, type ArchiveAuthority, type ArchiveEvent, type ArchiveRepository, type ArchiveScope, type ArchiveState, type ArchiveTransport } from './contracts';

const scope: ArchiveScope = { accountId: 'telegram-account:42', personId: 'person42', agentId: 'agent1', space: 'work', containerId: 'private42' };
function harness() {
  let now = 1000, state: ArchiveState | null = null, uploads = 0, current = true;
  const auth: ArchiveAuthority = { scope, revision: 'grants1', allowed: true, botId: 7, expiresAt: 1_000_000, suppressedEventIds: [] };
  const files = new Map<string, Uint8Array>();
  const repo: ArchiveRepository = { read: async () => structuredClone(state), transact: async (_scope, mutate, fence) => {
    const next = mutate(structuredClone(state)); fence(); state = structuredClone(next.state); return next.result;
  } };
  const authority = { read: async () => structuredClone(auth), isCurrent: (snapshot: ArchiveAuthority) => current && snapshot.revision === auth.revision };
  const transport: ArchiveTransport = { upload: async (chat, _name, bytes, fence) => {
    expect(chat).toBe(42); if (!fence()) throw new Error('Denied');
    const fileId = `file${++uploads}`; files.set(fileId, bytes.slice()); return { fileId, messageId: uploads };
  }, download: async id => { const bytes = files.get(id); if (!bytes) throw new Error('Missing'); return bytes.slice(); } };
  const service = () => new TelegramMemoryArchive(repo, authority, transport, { now: () => now });
  const event = (n: number, patch: Partial<ArchiveEvent> = {}): ArchiveEvent => ({ eventId: `event${n}`, logicalId: `logical${n}`, revision: 1,
    occurredAt: 500 + n, receivedAt: now, expiresAt: 900_000, role: 'user', text: `Topic ${n}`, ...patch });
  return { service, event, auth, repo, transport, files, get state() { return state; }, set state(value) { state = value; },
    get uploads() { return uploads; }, set now(value) { now = value; }, set current(value) { current = value; } };
}

describe('T1 immutable archive author checks', () => {
  it('captures one pending event durably and recovers it through a fresh service', async () => {
    const h = harness();
    expect(await h.service().capture(scope, h.event(1))).toEqual({ status: 'captured', eventId: 'event1', recoverable: false });
    expect(await h.service().checkpoint(scope)).toEqual({ status: 'pending' });
    expect((await h.service().recover(scope)).events.map(e => e.text)).toEqual(['Topic 1']);
    expect(h.uploads).toBe(0);
  });
  it('verifies immutable files before committing a recoverable head and links checkpoints', async () => {
    const h = harness(), s = h.service();
    for (let n = 1; n <= 8; n++) await s.capture(scope, h.event(n));
    expect(await s.checkpoint(scope)).toEqual({ status: 'recoverable', sequence: 1 });
    expect(h.state?.pending).toHaveLength(0);
    const first = h.state?.head;
    await s.capture(scope, h.event(9)); await s.checkpoint(scope, { force: true });
    const manifest = JSON.parse(new TextDecoder().decode(h.files.get(h.state!.head!.fileId)));
    expect(manifest.previous).toEqual(first);
    expect((await h.service().recover(scope)).events).toHaveLength(9);
    expect(h.uploads).toBe(4);
  });
  it('flushes a small batch at maximum age and refuses additional overdue intake', async () => {
    const h = harness(), s = h.service(); await s.capture(scope, h.event(1)); h.now = 61_000;
    await expect(s.capture(scope, h.event(2))).rejects.toMatchObject({ code: 'outbox_overdue' });
    expect((await s.status(scope)).overdue).toBe(true);
    expect(await s.checkpoint(scope)).toEqual({ status: 'recoverable', sequence: 1 });
  });
  it('deduplicates retries while preserving original expiry and rejects changed source payload', async () => {
    const h = harness(), s = h.service(), first = h.event(1); await s.capture(scope, first); h.now = 2000;
    expect((await s.capture(scope, { ...first, receivedAt: 2000, expiresAt: 999_999 })).status).toBe('duplicate');
    expect(h.state?.pending[0].expiresAt).toBe(first.expiresAt);
    await expect(s.capture(scope, { ...first, text: 'Different' })).rejects.toMatchObject({ code: 'integrity' });
  });
  it('applies a correction before forgetting and cannot fall back to an older revision', async () => {
    const h = harness(), s = h.service(); await s.capture(scope, h.event(1)); await s.checkpoint(scope, { force: true });
    await s.capture(scope, h.event(2, { logicalId: 'logical1', revision: 2, text: 'Corrected' }));
    expect((await s.recover(scope)).events.map(e => e.text)).toEqual(['Corrected']);
    h.auth.suppressedEventIds = ['event2']; h.auth.revision = 'grants2';
    expect((await s.recover(scope)).events).toEqual([]);
  });
  it('fails closed on bot transfer, scope mismatch, current policy loss, and tampered bytes', async () => {
    const h = harness(), s = h.service(); await s.capture(scope, h.event(1)); await s.checkpoint(scope, { force: true });
    h.auth.botId = 8; await expect(s.recover(scope)).rejects.toMatchObject({ code: 'scope' }); h.auth.botId = 7;
    await expect(s.recover({ ...scope, space: 'personal' })).rejects.toMatchObject({ code: 'scope' });
    h.current = false; await expect(s.recover(scope)).rejects.toMatchObject({ code: 'authority' }); h.current = true;
    h.files.set(h.state!.head!.fileId, new TextEncoder().encode('{}'));
    await expect(s.recover(scope)).rejects.toMatchObject({ code: 'integrity' });
  });
  it('records unknown upload outcomes across restart without retry and permits explicit abandonment', async () => {
    const h = harness(); await h.service().capture(scope, h.event(1));
    const original = h.transport.upload;
    h.transport.upload = async (...args) => { await original(...args); throw new Error('Lost response'); };
    await expect(h.service().checkpoint(scope, { force: true })).rejects.toMatchObject({ code: 'unknown_delivery' });
    expect(h.state?.operation?.stage).toBe('unknown');
    expect(await h.service().checkpoint(scope, { force: true })).toEqual({ status: 'unknown' });
    expect(h.uploads).toBe(1);
    expect((await h.service().recover(scope)).events).toHaveLength(1);
    await h.service().abandonUnknown(scope); h.transport.upload = original;
    expect((await h.service().checkpoint(scope, { force: true })).status).toBe('recoverable');
  });
  it('rechecks canonical policy after async preparation before committing uploaded content', async () => {
    const h = harness(); await h.service().capture(scope, h.event(1)); const original = h.transport.upload;
    h.transport.upload = async (...args) => { const file = await original(...args); h.current = false; return file; };
    await expect(h.service().checkpoint(scope, { force: true })).rejects.toMatchObject({ code: 'authority' });
    expect(h.state?.head).toBeUndefined(); expect(h.state?.pending).toHaveLength(1);
  });
  it('bounds serialized pending bytes and leaves accepted state intact on capacity failure', async () => {
    const h = harness(), s = h.service(); let accepted = 0;
    for (let n = 0; n < 16; n++) {
      try { await s.capture(scope, h.event(n, { text: '😀'.repeat(2048) })); accepted++; }
      catch (error) { expect(error).toMatchObject({ code: 'capacity' }); break; }
    }
    expect(accepted).toBeGreaterThan(0); expect(accepted).toBeLessThan(16);
    expect(new TextEncoder().encode(JSON.stringify(h.state!.pending)).byteLength).toBeLessThanOrEqual(MAX_ARCHIVE_PENDING_BYTES);
    expect(h.state!.pending).toHaveLength(accepted); archiveStateSchema.parse(h.state);
  });
  it('rejects a source edit racing cold reconstruction', async () => {
    const h = harness(), s = h.service(); await s.capture(scope, h.event(1)); await s.checkpoint(scope, { force: true });
    const original = h.transport.download; let once = true;
    h.transport.download = async (...args) => { const bytes = await original(...args);
      if (once) { once = false; await s.capture(scope, h.event(2, { logicalId: 'logical1', revision: 2 })); } return bytes;
    };
    await expect(s.recover(scope)).rejects.toMatchObject({ code: 'authority' });
  });
});
