import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileRelationshipStore, InMemoryRelationshipStore, RelationshipLoop, SafeRelationshipObserver, InMemoryObservationStore, parseExplicitControl } from '..';
import type { Assessment, DrainDeps, RelationshipKey } from '..';
const key: RelationshipKey = { personaId: 'aria', chatKey: 'private-reza', audience: { kind: 'private', personId: 'reza' } };
function harness(mode: 'off' | 'shadow' | 'live' = 'live', store = new InMemoryRelationshipStore()) {
  let now = new Date('2026-10-19T12:00:00Z');
  const assess = vi.fn(async ({ text }: { text: string }): Promise<Assessment> => ({ timeZone: 'UTC', preferences: [{ key: 'style', value: 'concise' }], situations: [{ topic: 'boss', summary: 'Planning a difficult conversation', status: 'open' }], followUp: { topic: 'boss', purpose: 'Ask how things are going', timing: { kind: 'ongoing', evidenceQuote: text }, dueAt: new Date(now.getTime() + 3600_000).toISOString() } }));
  const choose = vi.fn(async () => 'send' as const);
  const observations = new InMemoryObservationStore();
  const loop = new RelationshipLoop({ store, mode, assessor: { assess }, decisions: { choose }, observer: new SafeRelationshipObserver(observations, 'x'.repeat(32), () => now), now: () => now });
  const send = vi.fn(async () => 'telegram-123');
  const delivery: DrainDeps = { authorize: vi.fn(async () => true), loadContext: vi.fn(async () => 'The conversation is still unresolved.'), compose: vi.fn(async () => 'How did today go?'), send };
  return { loop, assess, choose, store, observations, delivery, send, advance: (ms = 3600_000) => { now = new Date(now.getTime() + ms); }, turn: (eventId = 'one', text = 'I have a difficult conversation tomorrow') => loop.observeTurn({ ...key, eventId, text, source: 'telegram', speakerId: 'reza' }) };
}
describe('relationship loop', () => {
  it('persists scoped personalization and follows up once without a permission prompt', async () => {
    const h = harness(); await h.turn(); expect(await h.loop.context(key)).toContain('concise'); h.advance();
    expect((await h.loop.drain(h.delivery)).sent).toBe(1); expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ topic: 'boss' }), 'How did today go?', expect.any(AbortSignal));
    h.advance(86400_000); await h.loop.drain(h.delivery); expect(h.send).toHaveBeenCalledTimes(1);
    expect((await h.loop.status(key)).unansweredCount).toBe(1);
  });
  it('keeps off provider-free and shadow free of personalization and job writes', async () => {
    for (const mode of ['off', 'shadow'] as const) { const h = harness(mode); expect((await h.turn()).context).toBe(''); h.advance(); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled(); expect((await h.loop.status(key)).revision).toBe(0); if (mode === 'off') expect(h.assess).not.toHaveBeenCalled(); }
  });
  it('preserves source timing across a day boundary and bounded context truncation', async () => {
    const h = harness(); await h.turn(); h.advance(86400_000);
    h.delivery.loadContext = async () => 'Long authorized history '.repeat(2000);
    await h.loop.drain(h.delivery);
    const decisionInput = h.choose.mock.calls[0] as unknown as [{ context: string; now: Date }];
    expect(decisionInput[0].now.toISOString()).toBe('2026-10-20T12:00:00.000Z');
    const pending = JSON.parse(decisionInput[0].context.split('\n')[0].replace('Pending purpose: ', ''));
    expect(pending).toMatchObject({ sourceAt: '2026-10-19T12:00:00.000Z', dueAt: '2026-10-19T13:00:00.000Z', timeZone: 'UTC' });
    expect(decisionInput[0].context).toContain('"updatedAt":"2026-10-19T12:00:00.000Z"');
    expect(decisionInput[0].context.length).toBeLessThanOrEqual(24000);
  });
  it('bounds repeated model deferrals without sending or leaving an endless job', async () => {
    const h = harness(); await h.turn(); h.choose.mockResolvedValue('defer' as 'send');
    for (let attempt = 1; attempt <= h.loop.policy.maxAttempts; attempt++) {
      h.advance(); const report = await h.loop.drain(h.delivery);
      expect(report[attempt === h.loop.policy.maxAttempts ? 'closed' : 'deferred']).toBe(1);
    }
    h.advance(); expect((await h.loop.drain(h.delivery)).claimed).toBe(0);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('deduplicates events and separates people, personas and groups', async () => {
    const h = harness(); await h.turn(); expect((await h.turn()).duplicate).toBe(true); expect(h.assess).toHaveBeenCalledTimes(1);
    expect(await h.loop.context({ ...key, audience: { kind: 'private', personId: 'sara' } })).toBe('');
    expect(await h.loop.context({ ...key, personaId: 'other' })).toBe('');
    expect(await h.loop.context({ ...key, audience: { kind: 'group', groupId: 'team' } })).toBe('');
  });
  it('never accepts a different person in a private context', async () => {
    const h = harness(); await expect(h.loop.observeTurn({ ...key, eventId: 'intruder', text: 'Remember my private data', source: 'telegram', speakerId: 'sara' })).rejects.toThrow('does not own');
  });
  it('closes a topic that resolved before the job became due', async () => {
    const h = harness(); await h.turn(); h.assess.mockResolvedValueOnce({ situations: [{ topic: 'boss', summary: 'Resolved', status: 'closed' }] }); await h.turn('two', 'We talked and it is fine now'); h.advance(); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled(); expect((await h.loop.status(key)).intentions[0].status).toBe('closed');
  });
  it('treats stop as deterministic and resume never revives cancelled outreach', async () => {
    const h = harness(); await h.turn(); await h.turn('stop', "don't message me"); expect(h.assess).toHaveBeenCalledTimes(1); h.advance(); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled(); await h.loop.control(key, 'resume'); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled();
  });
  it.each(['Please stop checking in.', "Please don't send me any more check-ins.", 'Stop following up, please.'])('honors polite direct stop: %s', async (text) => {
    const h = harness(); await h.turn(); await h.turn('boundary', text); h.advance();
    expect((await h.loop.status(key)).disabled).toBe(true);
    expect(h.assess).toHaveBeenCalledTimes(1);
    await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled();
  });
  it('persists a validated natural contact boundary beyond the recent conversation window', async () => {
    const h = harness(); await h.turn();
    h.assess.mockResolvedValueOnce({ control: { action: 'stop' } });
    await h.turn('boundary', 'I would rather be the one to start our conversations from now on.');
    for (let i = 0; i < 14; i++) { h.assess.mockResolvedValueOnce({}); await h.turn(`later-${i}`, 'A normal chat turn.'); }
    h.advance(); await h.loop.drain(h.delivery);
    expect((await h.loop.status(key)).disabled).toBe(true);
    expect(h.send).not.toHaveBeenCalled();
  });
  it('does not obey quoted controls', () => { expect(parseExplicitControl('My friend said "stop messaging me"')).toBeNull(); expect(parseExplicitControl('پیگیری نکن')).toBe('stop'); });
  it('forgets grounding and cancels dependent jobs, including a source memory ID', async () => {
    const h = harness(); await h.loop.observeTurn({ ...key, eventId: 'one', text: 'Private fact', memoryIds: ['memory-42'], source: 'call', speakerId: 'reza' });
    await h.loop.invalidate(key, { sourceIds: ['memory-42'], reason: 'memory_deleted' }); h.advance(); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled(); expect((await h.loop.status(key)).situations).toEqual([]);
  });
  it('suppresses stale decisions when a new turn arrives during composition', async () => {
    const h = harness(); await h.turn(); h.advance(); h.delivery.compose = async () => { await h.turn('new', 'A new development'); return 'Stale follow-up'; };
    const report = await h.loop.drain(h.delivery); expect(report.suppressed).toBe(1); expect(h.send).not.toHaveBeenCalled(); expect(h.choose).not.toHaveBeenCalled();
  });
  it('reviews the identical complete message before delivering and retains a scoped feedback target', async () => {
    const h = harness(); await h.turn(); h.advance(); await h.loop.drain(h.delivery);
    expect(h.choose).toHaveBeenCalledWith(expect.objectContaining({ candidate: 'How did today go?', context: expect.stringContaining('Current time: 2026-10-19T13:00:00.000Z') }));
    const state = await h.loop.status(key);
    expect(state.lastOutreach).toMatchObject({ intentionId: state.intentions[0].id, messageId: 'telegram-123', topic: 'boss', sourceIds: ['one'] });
    expect(JSON.stringify(state.lastOutreach)).not.toContain('How did today go?');
  });
  it('never forwards a composed draft after forgetting its grounding', async () => {
    const h = harness(); await h.turn(); h.advance();
    h.delivery.compose = async () => { await h.loop.invalidatePersona(key.personaId, { reason: 'revoked' }); return 'Old private fact'; };
    await h.loop.drain(h.delivery);
    expect(h.choose).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  it('suppresses a revoked recipient immediately before send', async () => {
    const h = harness(); await h.turn(); h.advance(); h.delivery.authorize = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled();
  });
  it('claims a due job once across simultaneous workers', async () => {
    const h = harness(); await h.turn(); h.advance(); await Promise.all([h.loop.drain(h.delivery), h.loop.drain(h.delivery)]); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('serializes different due topics across workers while transport is in progress', async () => {
    const h = harness(); await h.turn();
    h.assess.mockResolvedValueOnce({ timeZone: 'UTC', followUp: { topic: 'launch', purpose: 'Ask about launch', timing: { kind: 'ongoing', evidenceQuote: 'Launch is also happening' }, dueAt: '2026-10-19T13:00:00Z' } }); await h.turn('two', 'Launch is also happening');
    h.advance(); let release!: (value: string) => void;
    h.send.mockImplementationOnce(() => new Promise<string>((done) => { release = done; }));
    const first = h.loop.drain(h.delivery); await vi.waitFor(() => expect(h.send).toHaveBeenCalledTimes(1));
    const second = await h.loop.drain(h.delivery); expect(second.claimed).toBe(0); release('message-1'); await first;
    await h.loop.drain(h.delivery); expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('enforces a changed feature mode immediately before the sending fence', async () => {
    const h = harness(); await h.turn(); h.advance();
    h.delivery.compose = async () => { h.loop.deps.mode = 'off'; return 'Must not send'; };
    await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled();
  });
  it('commits stop before a blocked observer can permit another drain', async () => {
    const h = harness(); await h.turn(); h.advance(); let unblock!: () => void;
    h.loop.deps.observer = { emit: async (_key, _mode, type) => { if (type === 'turn') await new Promise<void>((done) => { unblock = done; }); } };
    const stopping = h.turn('stop', 'stop messaging me'); await vi.waitFor(() => expect(unblock).toBeDefined());
    expect((await h.loop.status(key)).disabled).toBe(true); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled(); unblock(); await stopping;
  });
  it('returns within a bounded worker budget when composition hangs', async () => {
    const h = harness(); await h.turn(); h.advance(); h.delivery.compose = () => new Promise<string>(() => undefined);
    const report = await h.loop.drain({ ...h.delivery, budgetMs: 30 }); expect(report.failed).toBe(1); expect(h.send).not.toHaveBeenCalled();
  });
  it('redacts purpose text in terminal outbox receipts', async () => {
    const h = harness(); await h.turn(); h.advance(); await h.loop.drain(h.delivery);
    const receipt = (await h.loop.status(key)).intentions[0]; expect(receipt.status).toBe('sent'); expect(receipt.purpose).toBe(''); expect(receipt.topic).toBe(''); expect(receipt.sourceIds).toEqual([]);
  });
  it('does not retry an ambiguous Telegram send', async () => {
    const h = harness(); await h.turn(); h.advance(); h.send.mockRejectedValue(new Error('network lost after server accepted request'));
    await h.loop.drain(h.delivery); h.advance(86400_000); await h.loop.drain(h.delivery); expect(h.send).toHaveBeenCalledTimes(1); expect((await h.loop.status(key)).intentions[0].status).toBe('delivery_unknown');
  });
  it('defers provider failure and quiet hours without sending', async () => {
    const h = harness(); await h.turn(); h.advance(); h.choose.mockRejectedValue(new Error('provider unavailable')); expect((await h.loop.drain(h.delivery)).failed).toBe(1); expect(h.send).not.toHaveBeenCalled();
    const quiet = harness(); quiet.assess.mockResolvedValueOnce({ timeZone: 'UTC', quietHours: { start: 12, end: 15 }, followUp: { topic: 'boss', purpose: 'Check in', dueAt: '2026-10-19T13:00:00Z' } }); await quiet.turn(); quiet.advance(); expect((await quiet.loop.drain(quiet.delivery)).deferred).toBe(1); expect(quiet.choose).not.toHaveBeenCalled();
  });
  it('makes stay_quiet a terminal successful outcome', async () => {
    const h = harness(); await h.turn(); h.advance(); h.choose.mockResolvedValue('stay_quiet' as 'send'); const report = await h.loop.drain(h.delivery); expect(report.closed).toBe(1); expect(report.failed).toBe(0); expect(h.send).not.toHaveBeenCalled();
  });
  it('does not schedule automatic group outreach by default', async () => {
    const h = harness(); await h.loop.observeTurn({ ...key, chatKey: 'group-team', audience: { kind: 'group', groupId: 'team' }, eventId: 'group-1', speakerId: 'reza', source: 'telegram', text: 'A team deadline is tomorrow' }); h.advance(); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled();
  });
  it('observer exports no private content, raw identifiers or arbitrary fields', async () => {
    const h = harness(); await h.turn('private-event', 'secret company launch and person name'); const data = JSON.stringify(await h.observations.recent()); expect(data).not.toContain('secret'); expect(data).not.toContain('reza'); expect(data).not.toContain('aria'); expect(data).not.toContain('private-event'); expect(data).not.toContain('boss'); expect(data).toContain('scopeHash');
  });
  it('rejects old source events before they can reopen a resolved topic or reset restraint', async () => {
    const h = harness();
    await h.loop.observeTurn({ ...key, eventId: 'telegram:123:20', source: 'telegram', speakerId: 'reza', text: 'Synthetic current topic', at: new Date('2026-10-19T12:00:00Z') });
    h.advance(); await h.loop.drain(h.delivery); expect((await h.loop.status(key)).unansweredCount).toBe(1);
    expect((await h.loop.observeTurn({ ...key, eventId: 'telegram:123:19', source: 'telegram', speakerId: 'reza', text: 'Old repeated concern', at: new Date('2026-10-19T11:00:00Z') })).duplicate).toBe(true);
    expect((await h.loop.status(key)).unansweredCount).toBe(1); expect(h.assess).toHaveBeenCalledTimes(1);
  });
  it('persona invalidation prevents an in-flight assessment recreating forgotten data', async () => {
    const h = harness(); let resolve!: (value: Assessment) => void;
    h.assess.mockImplementationOnce(() => new Promise<Assessment>((done) => { resolve = done; }));
    const turn = h.turn(); await vi.waitFor(() => expect(h.assess).toHaveBeenCalled());
    await h.loop.invalidatePersona(key.personaId, { reason: 'forget' });
    resolve({ preferences: [{ key: 'secret', value: 'must not return' }], followUp: { topic: 'secret', purpose: 'must not send', dueAt: '2026-10-19T13:00:00Z' } });
    await turn; expect(await h.loop.context(key)).toBe(''); expect((await h.loop.status(key)).intentions).toEqual([]);
  });
  it('persona forget preserves a person choice to stop outreach', async () => {
    const h = harness(); await h.turn(); await h.loop.control(key, 'stop'); await h.loop.clearPersona(key.personaId);
    const state = await h.loop.status(key); expect(state.disabled).toBe(true); expect(state.preferences).toEqual([]); expect(state.intentions).toEqual([]);
  });
  it('requires a known timezone and expires stale working memory after ninety days', async () => {
    const h = harness(); h.assess.mockResolvedValueOnce({ preferences: [{ key: 'style', value: 'brief' }], followUp: { topic: 'deadline', purpose: 'Check in', dueAt: '2026-10-19T13:00:00Z' } });
    await h.turn(); h.advance(); await h.loop.drain(h.delivery); expect(h.send).not.toHaveBeenCalled();
    await h.loop.configure(key, { timeZone: 'Europe/Tallinn' }); expect((await h.loop.status(key)).timeZone).toBe('Europe/Tallinn');
    h.advance(91 * 86400_000); expect(await h.loop.context(key)).toBe(''); expect((await h.loop.status(key)).preferences).toEqual([]);
  });
  it('recovers durable intentions and personalized context after a file-store restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vox-rel-')); const path = join(dir, 'relationships.json');
    try { const first = harness('live', new FileRelationshipStore(path)); await first.turn(); const second = harness('live', new FileRelationshipStore(path)); expect(await second.loop.context(key)).toContain('concise'); second.advance(); await second.loop.drain(second.delivery); expect(second.send).toHaveBeenCalledTimes(1); expect(readFileSync(path, 'utf8')).toContain('telegram-123'); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
