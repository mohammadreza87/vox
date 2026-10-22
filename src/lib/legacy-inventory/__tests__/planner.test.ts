import { describe, expect, it, vi } from 'vitest';
import { planLegacyFixtures } from '../planner';
import { InventoryError, LIMITS, REASONS, type InventoryReportV1, type ManifestV1, type StopV1 } from '../contracts';
import { AT, CANARY, appMessage, chunks, corpus, encodeFixtures, factFixture, memoryFixture, orgFixture, studioFixture } from './fixtures';

async function run(adapter: ManifestV1['sources'][number]['adapter'], payloads: unknown[]) { const f = encodeFixtures([{ adapter, payloads }]); return planLegacyFixtures(f.manifest, chunks(f.bytes)); }
function accounting(r: InventoryReportV1) {
  expect(r.rows.length).toBe(r.counts.envelopeRows + r.counts.childRows);
  expect(r.rows.length).toBe(r.counts.quarantineRows + r.counts.preserveSourceOnlyRows);
  expect(r.rows.length).toBe(Object.values(r.counts.byKind).reduce((a, b) => a + b, 0));
  expect(new Set(r.rows.map(x => `${x.source}/${x.unit}/${x.item}`)).size).toBe(r.rows.length);
  for (const reason of REASONS) expect(r.counts.byReason[reason]).toBe(r.rows.filter(x => x.reasons.includes(reason)).length);
  for (const k of ['expectedUnits', 'consumedUnits', 'inventoriedUnits', 'unresolvedFragments', 'envelopeRows', 'childRows', 'quarantineRows', 'preserveSourceOnlyRows'] as const) expect(r.counts[k]).toBe(r.sources.reduce((n, s) => n + s.counts[k], 0));
  for (const s of r.sources) {
    const rows = r.rows.filter(x => x.source === s.source);
    expect(rows.length).toBe(s.counts.envelopeRows + s.counts.childRows);
    for (const reason of REASONS) expect(s.counts.byReason[reason]).toBe(rows.filter(x => x.reasons.includes(reason)).length);
  }
}

describe('LIP1 synthetic inventory planner', () => {
  it('hand reconciles eight native adapter fixtures while denying all use and preserving bytes', async () => {
    const f = encodeFixtures(corpus()), original = Buffer.from(f.bytes);
    const current = Object.freeze({ consent: Object.freeze({ proactive: false }), tombstones: Object.freeze(['source-gone']), access: Object.freeze(['existing-private']), queued: Object.freeze([]) });
    const before = JSON.stringify(current);
    const r = await planLegacyFixtures(f.manifest, chunks(f.bytes));
    expect(r.status).toBe('complete'); expect(r.stop).toBe('none');
    expect(r.counts).toMatchObject({ expectedUnits: 8, consumedUnits: 8, inventoriedUnits: 8, unresolvedFragments: 0, envelopeRows: 8, childRows: 28 });
    expect(r.rows).toHaveLength(36); expect(r.bytesConsumed).toBe(f.bytes.length); expect(r.endOfInputObserved).toBe(true);
    expect(r.counts.byReason.repeated_source_key).toBe(5);
    for (const row of r.rows) expect(row).toMatchObject({ use: 'denied', target: null, currentAuthority: 'unverified' });
    expect(r.effects).toEqual({ writes: 0, imports: 0, grants: 0, identityLinks: 0, consentReceipts: 0, enrollments: 0, notificationsQueued: 0, notificationsSent: 0, providerCalls: 0, sourceMutation: 'none', rollback: 'discard_plan_only' });
    expect(f.bytes).toEqual(original); expect(JSON.stringify(current)).toBe(before); expect(JSON.stringify(r)).not.toContain(CANARY);
    accounting(r);
  });

  it('produces identical complete reports with one-byte, irregular and full valid chunks', async () => {
    const f = encodeFixtures(corpus());
    const reports = await Promise.all([1, 7, 113, LIMITS.chunkBytes].map(size => planLegacyFixtures(f.manifest, chunks(f.bytes, size))));
    for (const r of reports) expect(r).toEqual(reports[0]);
  });

  it.each([
    [{ notifications: true }, 'true', 'historical_flag_not_consent'],
    [{ notifications: false }, 'false', 'restrictive_flag_observed'],
    [{}, 'missing', 'missing_notification_setting'],
    [undefined, 'missing', 'missing_notification_setting'],
    [{ notifications: null }, 'invalid', 'invalid_notification_setting'],
    [{ notifications: 'true' }, 'invalid', 'invalid_notification_setting'],
    [null, 'invalid', 'invalid_notification_setting'],
  ])('preserves notification observation for %j', async (settings, observation, reason) => {
    const r = await run('app-user/1', [{ userId: 'account', data: settings === undefined ? {} : { settings } }]);
    const row = r.rows.find(x => x.kind === 'notification_setting')!;
    expect(row.notificationObservation).toBe(observation); expect(row.reasons).toContain(reason); expect(row.reasons).toContain('consent_not_established'); expect(row.target).toBeNull(); accounting(r);
  });

  it('counts anonymous history occurrences, preserving duplicates without invented keys', async () => {
    const r = await run('tireh-file-state/1', [{ memories: [], offers: [], chats: { a: [{ role: 'user', text: CANARY, at: AT }, { role: 'user', text: CANARY, at: AT }] } }]);
    expect(r.status).toBe('complete'); expect(r.counts.byKind.history).toBe(2); expect(r.counts.byReason.repeated_source_key).toBe(0); accounting(r);
  });

  it.each(['private', 'people', 'group', 'project', 'company', 'org'])('never resolves a %s memory scope', async kind => {
    const scope = kind === 'private' ? { kind, personId: 'a' } : kind === 'people' ? { kind, personIds: ['a', 'b'] } : kind === 'group' ? { kind, groupId: 'g' } : kind === 'project' ? { kind, projectId: 'p' } : kind === 'company' ? { kind, companyId: 'c' } : { kind };
    const r = await run('tireh-file-state/1', [{ memories: [{ ...memoryFixture(), scope }], offers: [], chats: {} }]);
    const row = r.rows[1]; expect(row.reasons).toEqual(expect.arrayContaining(['space_unresolved', 'audience_unresolved', 'purpose_unresolved', 'subject_authority_unresolved']));
    expect(row.reasons.includes('legacy_scope_not_transferable')).toBe(['project', 'company', 'org'].includes(kind)); expect(row.target).toBeNull();
  });

  it('quarantines conflicting wrapper metadata and never repairs it', async () => {
    const payload = { userId: 'a', contactId: 'b', data: { userId: 'different', contactId: 'b', facts: [factFixture()], sessions: [], lastInteraction: null } };
    const original = JSON.stringify(payload), r = await run('app-contact-memory/1', [payload]);
    expect(r.rows.every(x => x.reasons.includes('conflicting_source_metadata'))).toBe(true); expect(JSON.stringify(payload)).toBe(original); accounting(r);
  });

  it('supports document controls, offers and history without live constructors', async () => {
    const r = await run('tireh-document/1', [
      { collection: 'tireh_memory_state', id: 'a', data: { revision: 2, tombstones: [CANARY] } },
      { collection: 'tireh_privacy_epochs', id: 'a', data: { epoch: 4 } },
      { collection: 'tireh_messages', id: 'm', parent: { personaId: 'a', chatKey: 'c' }, data: { role: 'user', text: CANARY, at: { seconds: 123, nanoseconds: 1 } } },
      { collection: 'tireh_share_offers', id: 'o', data: { personaId: 'a', memoryId: 'm', ownerPersonId: 'a', proposedScope: { kind: 'org' }, status: 'approved', createdAt: AT } },
    ]);
    expect(r.status).toBe('complete'); expect(r.counts.byKind.control).toBe(2); expect(r.counts.byKind.share_offer).toBe(1); expect(r.counts.byReason.source_suppression_observed).toBe(2); accounting(r);
  });

  it('parses Studio nested JSON with the same no-content projection', async () => {
    const direct = await run('studio-state/1', [studioFixture()]);
    const wrapped = await run('studio-state/1', [{ json: JSON.stringify(studioFixture()) }]);
    expect(wrapped.status).toBe('complete'); expect(wrapped.rows).toEqual(direct.rows); expect(wrapped.counts).toEqual(direct.counts);
  });

  it('knows the Circles group fields (kind, joinCode, circle), so a Studio state carrying them stays complete', async () => {
    const state = studioFixture();
    Object.assign(state.groups[0], { kind: 'group', joinCode: 'abcdefghijklmnopqrstuv', circle: { enabled: true, revision: 'r1', card: { agentId: 'studio-agent', messageId: 5, editedAt: AT } } });
    const r = await run('studio-state/1', [{ json: JSON.stringify(state) }]);
    expect(r.status).toBe('complete'); expect(r.counts.unresolvedFragments).toBe(0); expect(r.rows.map(x => [x.kind, x.reasons])).toEqual((await run('studio-state/1', [studioFixture()])).rows.map(x => [x.kind, x.reasons]));
  });

  it('marks missing and unsupported containers as unavailable rather than zero', async () => {
    for (const payload of [{ offers: [], chats: {} }, { memories: [], offers: [], chats: null }, { memories: [], offers: [], chats: {}, [CANARY]: { raw: CANARY } }]) {
      const r = await run('tireh-file-state/1', [payload]);
      expect(r.status).toBe('incomplete'); expect(r.stop).toBe('invalid_payload'); expect(r.structuralCoverage).toBe('unavailable'); expect(r.counts.unresolvedFragments).toBeGreaterThan(0); expect(r.counts.inventoriedUnits).toBe(0); expect(JSON.stringify(r)).not.toContain(CANARY); accounting(r);
    }
  });

  it('keeps malformed children counted and continues later units', async () => {
    const r = await run('app-contact-memory/1', [{ userId: 'a', contactId: 'b', data: { facts: [null, { ...factFixture(), extractedAt: '2026-02-30T00:00:00Z' }], sessions: [], lastInteraction: null } }]);
    expect(r.status).toBe('complete'); expect(r.counts.byKind.memory_fact).toBe(2); expect(r.counts.byReason.malformed_record).toBe(2); accounting(r);
  });

  it('does not coerce a malformed scope kind into executable/string interpretation', async () => {
    const r = await run('tireh-file-state/1', [{ memories: [{ ...memoryFixture(), scope: { kind: { toString: CANARY } } }, memoryFixture('sibling')], offers: [], chats: {} }]);
    // A known child with an invalid scalar type is counted and quarantined; its boundary is known.
    expect(r.status).toBe('complete'); expect(r.stop).toBe('none'); expect(r.counts.byKind.memory).toBe(2); expect(r.rows[1].reasons).toContain('malformed_record'); expect(JSON.stringify(r)).not.toContain(CANARY); accounting(r);
  });

  it('rejects unsupported manifest inputs before obtaining the iterator', async () => {
    const f = encodeFixtures([]), iterable = { [Symbol.asyncIterator]: vi.fn(() => { throw new Error(CANARY); }) };
    const invalids = [null, { ...f.manifest, extra: true }, { ...f.manifest, sources: [{ source: 0, adapter: 'unsupported', expectedUnits: 1 }] }, { ...f.manifest, sources: [{ source: 0, adapter: 'app-user/1', expectedUnits: LIMITS.units + 1 }] }, Object.defineProperty({}, 'schema', { get() { throw new Error(CANARY); } })];
    for (const m of invalids) { const r = await planLegacyFixtures(m as ManifestV1, iterable); expect(r.status).toBe('rejected'); expect(JSON.stringify(r)).not.toContain(CANARY); }
    expect(iterable[Symbol.asyncIterator]).not.toHaveBeenCalled();
  });

  it('reconciles empty input and explicitly empty sources only after EOF', async () => {
    for (const sources of [[], [{ adapter: 'app-user/1' as const, payloads: [] }]]) { const f = encodeFixtures(sources), r = await planLegacyFixtures(f.manifest, chunks(f.bytes)); expect(r.status).toBe('complete'); expect(r.rows).toEqual([]); expect(r.endOfInputObserved).toBe(true); accounting(r); }
  });

  it('rejects repeated transport ordinals and retains only the committed prefix', async () => {
    const f = encodeFixtures([{ adapter: 'app-user/1', payloads: [{ userId: 'a', data: {} }] }]);
    const bytes = Buffer.concat([f.bytes, f.bytes]);
    const manifest = { ...f.manifest, sources: [{ ...f.manifest.sources[0], expectedUnits: 2 }], expectedTransportBytes: bytes.length };
    const r = await planLegacyFixtures(manifest, chunks(bytes)); expect(r.stop).toBe('invalid_transport'); expect(r.counts.consumedUnits).toBe(1); expect(r.rows).toHaveLength(3); expect(r.counts.byReason.repeated_source_key).toBe(0); accounting(r);
  });

  it('requires observed EOF, exact expected units and delivered byte counts', async () => {
    const f = encodeFixtures([{ adapter: 'app-user/1', payloads: [{ userId: 'a', data: {} }] }]);
    const short = await planLegacyFixtures({ ...f.manifest, sources: [{ ...f.manifest.sources[0], expectedUnits: 2 }] }, chunks(f.bytes)); expect(short.stop).toBe('input_truncated');
    const mismatch = await planLegacyFixtures({ ...f.manifest, expectedTransportBytes: f.bytes.length + 1 }, chunks(f.bytes)); expect(mismatch.stop).toBe('byte_count_mismatch');
    const surplus = await planLegacyFixtures(f.manifest, chunks(Buffer.concat([f.bytes, f.bytes]))); expect(surplus.stop).toBe('input_surplus');
    for (const r of [short, mismatch, surplus]) { expect(r.status).toBe('incomplete'); accounting(r); }
  });

  it('leaves admitted duplicate state untouched when a later unit exceeds capacity', async () => {
    const f = encodeFixtures([{ adapter: 'app-local-chats/1', payloads: [ [{ id: 'same', contactId: 'c', messages: [] }], [{ id: 'same', contactId: 'c', messages: Array.from({ length: 1000 }, (_, i) => appMessage(`m${i}`)) }] ] }]);
    // A chat metadata row plus 1000 message rows exceeds the 1000-child budget.
    const r = await planLegacyFixtures(f.manifest, chunks(f.bytes));
    expect(r.stop).toBe('capacity_exceeded'); expect(r.counts.consumedUnits).toBe(1); expect(r.rows).toHaveLength(2); expect(r.counts.byReason.repeated_source_key).toBe(0); accounting(r);
  });

  it('caps total admitted rows without exposing staged duplicate updates', async () => {
    const payload = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, contactId: 'contact', messages: [] }));
    const f = encodeFixtures([{ adapter: 'app-local-chats/1', payloads: [...Array.from({ length: 19 }, () => payload), payload.slice(0, 980), []] }]);
    const r = await planLegacyFixtures(f.manifest, chunks(f.bytes));
    expect(r.stop).toBe('capacity_exceeded'); expect(r.counts.consumedUnits).toBe(20); expect(r.rows.length).toBe(20_000); accounting(r);
  });

  it('applies key bounds without leaking or manufacturing an identity', async () => {
    const r = await run('app-user/1', [{ userId: 'a'.repeat(LIMITS.keyBytes), data: {} }, { userId: 'a'.repeat(LIMITS.keyBytes + 1), data: {} }]);
    expect(r.rows[1].reasons).not.toContain('malformed_record'); expect(r.rows[4].reasons).toContain('malformed_record'); expect(r.counts.byReason.repeated_source_key).toBe(0);
  });

  it('scrubs unknown nested keys, error content and raw IDs from every public result', async () => {
    const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    try {
      const f = encodeFixtures([{ adapter: 'app-user/1', payloads: [{ userId: CANARY, data: { [CANARY]: { nested: CANARY }, settings: { notifications: true } } }] }]);
      const r = await planLegacyFixtures(f.manifest, chunks(f.bytes));
      expect(JSON.stringify(r)).not.toContain(CANARY); expect(r.status).toBe('incomplete');
      async function* failing() { yield f.bytes; throw new Error(CANARY); }
      const failed = await planLegacyFixtures(f.manifest, failing()); expect(failed.stop).toBe('reader_failed'); expect(JSON.stringify(failed)).not.toContain(CANARY);
      expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { log.mockRestore(); error.mockRestore(); warn.mockRestore(); }
  });

  it('does not trust a producer-created InventoryError or a changing error-code getter', async () => {
    const f = encodeFixtures([]);
    const forged = new InventoryError(CANARY as StopV1);
    const signal = { get aborted(): boolean { throw forged; } } as AbortSignal;
    const r = await planLegacyFixtures(f.manifest, chunks(f.bytes), { signal });
    expect(r.stop).toBe('internal_failed'); expect(JSON.stringify(r)).not.toContain(CANARY);
    let reads = 0;
    const changing = Object.defineProperty(new InventoryError('cancelled'), 'code', { get() { return ++reads === 1 ? 'cancelled' : CANARY; } });
    const r2 = await planLegacyFixtures(f.manifest, chunks(f.bytes), { signal: { get aborted(): boolean { throw changing; } } as AbortSignal });
    expect(r2.stop).toBe('cancelled'); expect(JSON.stringify(r2)).not.toContain(CANARY); expect(reads).toBe(1);
  });

  it('cancels before reading and cleans up after a committed prefix', async () => {
    const f = encodeFixtures([{ adapter: 'app-user/1', payloads: [{ userId: 'same', data: {} }, { userId: 'same', data: {} }] }]);
    const signal = new AbortController(); signal.abort();
    const next = vi.fn(); const pre = await planLegacyFixtures(f.manifest, { [Symbol.asyncIterator]: () => ({ next }) }, { signal: signal.signal }); expect(pre.stop).toBe('cancelled'); expect(next).not.toHaveBeenCalled();
    const controller = new AbortController();
    const lines = f.bytes.toString().trimEnd().split('\n').map(x => Buffer.from(x + '\n'));
    let closed = false;
    async function* aborting() { try { yield lines[0]; controller.abort(); yield lines[1]; } finally { closed = true; } }
    const r = await planLegacyFixtures(f.manifest, aborting(), { signal: controller.signal });
    expect(r.stop).toBe('cancelled'); expect(r.counts.consumedUnits).toBe(1); expect(r.counts.byReason.repeated_source_key).toBe(0); expect(closed).toBe(true); accounting(r);
  });

  it('enforces the same atomic prefix under deterministic cancellation throughout unit admission', async () => {
    const f = encodeFixtures([{ adapter: 'app-user/1', payloads: [{ userId: 'same', data: {} }, { userId: 'same', data: {} }] }]);
    let observedCommittedPrefix = 0, observedComplete = false;
    for (let threshold = 1; threshold <= 80; threshold++) {
      let reads = 0;
      const signal = { get aborted() { return ++reads >= threshold; } } as AbortSignal;
      const r = await planLegacyFixtures(f.manifest, chunks(f.bytes), { signal });
      if (r.counts.consumedUnits === 1) { observedCommittedPrefix++; expect(r.counts.byReason.repeated_source_key).toBe(0); expect(r.rows).toHaveLength(3); }
      if (r.status === 'complete') { observedComplete = true; expect(r.counts.byReason.repeated_source_key).toBe(2); }
      accounting(r);
    }
    expect(observedCommittedPrefix).toBeGreaterThan(0); expect(observedComplete).toBe(true);
  });

  it('shares frame tokens and actual json-value depth with nested Studio parsing', async () => {
    const largeInner = JSON.stringify({ members: [], agents: [], groups: [], audit: [], extra: Array.from({ length: 24980 }, () => 0) });
    const tokens = await run('studio-state/1', [{ json: largeInner }]);
    expect(tokens.stop).toBe('capacity_exceeded'); expect(tokens.rows).toEqual([]);
    const deepInner = '{"members":[],"agents":[],"groups":[],"audit":[],"extra":' + '['.repeat(30) + '0' + ']'.repeat(30) + '}';
    const depth = await run('studio-state/1', [{ json: deepInner }]);
    expect(depth.stop).toBe('capacity_exceeded'); expect(depth.rows).toEqual([]);
    const boundaryInner = '{"members":[],"agents":[],"groups":[],"audit":[],"extra":' + '['.repeat(29) + '0' + ']'.repeat(29) + '}';
    const boundary = await run('studio-state/1', [{ json: boundaryInner }]);
    expect(boundary.stop).toBe('invalid_payload'); expect(boundary.counts.consumedUnits).toBe(1); accounting(boundary);
  });

  it('admits exact source and declared-unit bounds without widening them', async () => {
    const sources = encodeFixtures(Array.from({ length: LIMITS.sources }, () => ({ adapter: 'app-user/1' as const, payloads: [] })));
    expect((await planLegacyFixtures(sources.manifest, chunks(sources.bytes))).status).toBe('complete');
    const extra = encodeFixtures(Array.from({ length: LIMITS.sources + 1 }, () => ({ adapter: 'app-user/1' as const, payloads: [] })));
    expect((await planLegacyFixtures(extra.manifest, chunks(extra.bytes))).status).toBe('rejected');
    const units = encodeFixtures([{ adapter: 'app-user/1', payloads: Array.from({ length: LIMITS.units }, (_, i) => ({ userId: `a${i}`, data: {} })) }]);
    const r = await planLegacyFixtures(units.manifest, chunks(units.bytes)); expect(r.status).toBe('complete'); expect(r.counts.consumedUnits).toBe(LIMITS.units); accounting(r);
  });

  it('accepts the native Firestore message personaId only in document-history data', async () => {
    const message = { role: 'user', text: CANARY, at: AT, personaId: 'native-persona', privacyEpoch: 2 };
    const r = await run('tireh-document/1', [{ collection: 'tireh_messages', id: 'message-a', parent: { personaId: 'native-persona', chatKey: 'chat-a' }, data: message }]);
    expect(r.status).toBe('complete'); expect(r.counts.unresolvedFragments).toBe(0); expect(r.rows[1].hasUnsupportedFields).toBe(false); expect(r.rows[1].reasons).not.toContain('conflicting_source_metadata'); accounting(r);
    const file = await run('tireh-file-state/1', [{ memories: [], offers: [], chats: { opaque: [message] } }]);
    expect(file.status).toBe('incomplete'); expect(file.rows[1].hasUnsupportedFields).toBe(true); expect(file.counts.unresolvedFragments).toBe(1); accounting(file);
  });

  it('quarantines conflicting document persona metadata without duplicate-index evidence', async () => {
    const base = { collection: 'tireh_messages', id: 'same-message', parent: { personaId: 'native-persona', chatKey: 'chat-a' } };
    const r = await run('tireh-document/1', [
      { ...base, data: { role: 'user', text: CANARY, at: AT, personaId: 'native-persona' } },
      { ...base, data: { role: 'user', text: CANARY, at: AT, personaId: 'different-persona' } },
      { ...base, data: { role: 'user', text: CANARY, at: AT, personaId: 'different-persona' } },
    ]);
    expect(r.status).toBe('complete'); expect(r.counts.byReason.conflicting_source_metadata).toBe(2); expect(r.counts.byReason.repeated_source_key).toBe(0);
    expect(r.rows.filter(x => x.kind === 'history').slice(1).every(x => x.reasons.includes('conflicting_source_metadata'))).toBe(true); expect(r.rows.every(x => x.target === null && x.use === 'denied')).toBe(true); accounting(r);
  });

  it.each([undefined, 'native-persona'])('preserves normal document-history duplicates with optional persona stamp %j', async personaId => {
    const payload = { collection: 'tireh_messages', id: 'same-message', parent: { personaId: 'native-persona', chatKey: 'chat-a' }, data: { role: 'user', text: CANARY, at: AT, personaId } };
    const r = await run('tireh-document/1', [payload, payload]);
    expect(r.status).toBe('complete'); expect(r.counts.byReason.repeated_source_key).toBe(2); expect(r.counts.byReason.conflicting_source_metadata).toBe(0); accounting(r);
  });

  it('does not manufacture native document-history keys from invalid explicit parent or persona data', async () => {
    const payloads = [
      { personaId: 1, parent: { personaId: 1, chatKey: 'a' } },
      { personaId: 'a', parent: { personaId: 'a', chatKey: 12 } },
      { personaId: 'a', parent: { personaId: '', chatKey: 'a' } },
    ].flatMap(({ personaId, parent }) => Array.from({ length: 2 }, () => ({ collection: 'tireh_messages', id: 'same-message', parent, data: { role: 'user', text: CANARY, at: AT, personaId } })));
    const r = await run('tireh-document/1', payloads);
    expect(r.counts.byReason.repeated_source_key).toBe(0); expect(r.counts.byReason.malformed_record).toBeGreaterThan(0); accounting(r);
  });

  it('reports hidden app-chat data.messages as unresolved without skipping local Chat.messages', async () => {
    const app = await run('app-chat/1', [{ chatId: 'a', data: { userId: 'u', contactId: 'c', messages: [appMessage()] }, messages: [] }]);
    expect(app.status).toBe('incomplete'); expect(app.stop).toBe('invalid_payload'); expect(app.counts.unresolvedFragments).toBe(1); expect(app.counts.byKind.history).toBe(0); expect(app.rows[1].hasUnsupportedFields).toBe(true); expect(app.rows[1].reasons).toContain('unsupported_fields'); accounting(app);
    const local = await run('app-local-chats/1', [[{ id: 'a', contactId: 'c', messages: [appMessage()] }]]);
    expect(local.status).toBe('complete'); expect(local.counts.byKind.history).toBe(1); expect(local.counts.unresolvedFragments).toBe(0); accounting(local);
  });

  it('keeps identical config-local IDs in different explicit organizations separate', async () => {
    const first = orgFixture(), second = { ...orgFixture(), organization: { id: 'different-org', name: CANARY } };
    const r = await run('tireh-org-config/1', [first, second]);
    expect(r.status).toBe('complete'); expect(r.counts.byReason.repeated_source_key).toBe(0); expect(r.counts.childRows).toBe(12); accounting(r);
  });

  it('annotates all same-organization config duplicates, including across fixture sources', async () => {
    const f = encodeFixtures([{ adapter: 'tireh-org-config/1', payloads: [orgFixture()] }, { adapter: 'tireh-org-config/1', payloads: [orgFixture()] }]);
    const r = await planLegacyFixtures(f.manifest, chunks(f.bytes));
    expect(r.status).toBe('complete'); expect(r.counts.byReason.repeated_source_key).toBe(10); expect(r.sources.every(s => s.counts.byReason.repeated_source_key === 5)).toBe(true); accounting(r);
  });

  it.each([undefined, null, 0, {}, '', 'x'.repeat(LIMITS.keyBytes + 1)])('does not invent an organization namespace for invalid owner %j', async id => {
    const config = { ...orgFixture(), organization: { id, name: CANARY } };
    const r = await run('tireh-org-config/1', [config, config]);
    expect(r.counts.byReason.repeated_source_key).toBe(0); expect(r.rows.every(x => x.target === null && x.currentAuthority === 'unverified')).toBe(true); expect(JSON.stringify(r)).not.toContain(CANARY); accounting(r);
  });

  it('bounds organization namespace bytes and leaves absent organization unlinked', async () => {
    for (const [organization, repeated] of [
      [{ id: 'x'.repeat(LIMITS.keyBytes), name: CANARY }, 10],
      [{ id: 'ش'.repeat(129), name: CANARY }, 0],
      [undefined, 0],
    ] as const) {
      const config = { ...orgFixture(), organization };
      const r = await run('tireh-org-config/1', [config, config]);
      expect(r.counts.byReason.repeated_source_key).toBe(repeated); expect(JSON.stringify(r)).not.toContain(CANARY); accounting(r);
    }
  });
});
