import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { learningFixture } from './fixtures';
import { ID } from '../../../studio/__tests__/helpers';
import { NOW } from '../__tests__/fixtures';

type Fixture = Awaited<ReturnType<typeof learningFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(x => x.close())); });
async function setup() {
  const x = await learningFixture(); fixtures.push(x); await x.f.grant(); await x.f.agent(); return x;
}
/** A real FILE read transaction holds rename while the command tries to acquire
 * its own lock. No timer guess or mocked committed authority is involved. */
async function behindWriter(x: Fixture, command: () => Promise<unknown>, queued?: () => Promise<void> | void) {
  const rename = fs.rename.bind(fs), mkdir = fs.mkdir.bind(fs);
  let release!: () => void, reached!: () => void, waiting!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { reached = resolve; });
  const attempted = new Promise<void>(resolve => { waiting = resolve; });
  let armed = true;
  vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
    if (armed && String(args[1]).startsWith(x.f.directory!)) { armed = false; reached(); await gate; }
    return rename(...args);
  });
  const writer = x.view();
  await held;
  vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
    if (String(args[0]).startsWith(x.f.directory!) && String(args[0]).endsWith('.lock')) waiting();
    return mkdir(...args);
  });
  const result = command().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  try {
    expect(await Promise.race([attempted.then(() => 'queued'), result.then(() => 'settled-before-lock')])).toBe('queued');
    await queued?.(); release(); await writer; return await result;
  } finally { release(); await writer; await result; vi.restoreAllMocks(); }
}

it('serializes a deliberate presentation behind an unrelated FILE writer without retries or an unavailable error', async () => {
  const x = await setup(), input = { ...await x.command(), locale: 'en' as const };
  const outcome = await behindWriter(x, () => x.learning.present(ID.alice, input));
  expect(outcome.error).toBeUndefined();
  const view = await x.view(); expect(view.presentation?.locale).toBe('en'); expect(view.enabled).toBe(false);
  const events = await x.f.adaptive.withAccountDocument(ID.alice, d => d.events.filter(e => e.eventId === input.eventId));
  expect(events).toHaveLength(1); expect(x.provider.evaluate).not.toHaveBeenCalled();
});
it('checks an aborted queued command before it can create a presentation', async () => {
  const x = await setup(), input = { ...await x.command(), locale: 'en' as const }, controller = new AbortController();
  const outcome = await behindWriter(x, () => x.learning.present(ID.alice, input, controller.signal), () => controller.abort());
  expect(outcome.error).toMatchObject({ code: 'preference_learning_changed' });
  expect((await x.view()).presentation).toBeUndefined();
});
it('pins Studio authority before waiting so block and restore cannot authorize the queued command', async () => {
  const x = await setup(), input = { ...await x.command(), locale: 'en' as const };
  const owner = (await x.h.store.read()).members.find(m => m.role === 'owner')!;
  const outcome = await behindWriter(x, () => x.learning.present(ID.alice, input), async () => {
    await x.h.studio.blockByAgent(x.agent.id, ID.alice); await x.h.studio.unblock(owner, x.agent.id, ID.alice);
  });
  expect(outcome.error).toMatchObject({ code: 'preference_learning_changed' });
  expect((await x.view()).presentation).toBeUndefined();
});
it('samples canonical expiry after waiting and never writes a now-ineligible presentation', async () => {
  const x = await setup(), input = { ...await x.command(), locale: 'en' as const };
  x.f.expirePersonalizationAt(NOW + 1);
  const outcome = await behindWriter(x, () => x.learning.present(ID.alice, input), () => x.setNow(NOW + 2));
  expect(outcome.error).toMatchObject({ code: 'preference_learning_unavailable', status: 403 });
  expect((await x.view()).presentation).toBeUndefined();
});
it('still rejects stale CAS after waiting without recording an event', async () => {
  const x = await setup(), input = { ...await x.command(), expectedRevision: 1, eventId: randomUUID(), locale: 'en' as const };
  const outcome = await behindWriter(x, () => x.learning.present(ID.alice, input));
  expect(outcome.error).toMatchObject({ code: 'revision_conflict' });
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.events.some(e => e.eventId === input.eventId))).toBe(false);
});
