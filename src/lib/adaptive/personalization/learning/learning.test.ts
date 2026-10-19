import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { learningFixture } from './fixtures';
import { ID } from '../../../studio/__tests__/helpers';
import { accountIdFor } from '../../persistence/repository';
import { NOW } from '../__tests__/fixtures';
import { AdaptiveLifecycleService } from '../../lifecycle/service';
const fixtures: Awaited<ReturnType<typeof learningFixture>>[] = [];
async function setup(options: Parameters<typeof learningFixture>[0] = {}) { const f = await learningFixture(options); fixtures.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
it('requires a fresh separate scoped intent; analytics consent and ordinary personalization never enroll', async () => {
  const x = await setup(); expect(x.enqueue()).toBe(false); await x.f.grant('optional.product_analytics'); await x.f.agent();
  expect(x.enqueue()).toBe(false); await x.f.grant(); expect(x.enqueue()).toBe(false);
  expect((await x.view()).enabled).toBe(false); expect(x.provider.evaluate).not.toHaveBeenCalled();
  await expect(x.learning.toggle(ID.alice, { ...await x.command(), enabled: true, version: 'preference-learning-v1' })).rejects.toMatchObject({ code: 'preference_learning_presentation_required' });
});
it('stores only an enum candidate and keyed opaque evidence; Use is explicit CAS with genuine absence-preserving Undo', async () => {
  const x = await setup(); await x.enable(); const logical = x.turn(), text = 'PRIVATE_LEARNING_CANARY Please use brief replies for me.';
  expect(x.enqueue(text, logical)).toBe(true); await x.learning.tasks.settle();
  const view = await x.view(); expect(view.candidates).toHaveLength(1); expect(view.candidates[0]).toMatchObject({ setting: { key: 'response_length', value: 'brief' }, reason: 'length_cue' });
  expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([]);
  const persisted = await readFile(join(x.f.directory!, createHash('sha256').update(accountIdFor(ID.alice)).digest('hex') + '.json'), 'utf8');
  expect(persisted).not.toContain('PRIVATE_LEARNING_CANARY'); expect(persisted).not.toContain(createHash('sha256').update(text).digest('hex'));
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.observer.events)).toEqual([]);
  const command = { ...await x.command(), candidateId: view.candidates[0].id, action: 'use' as const };
  await x.learning.review(ID.alice, command); await x.learning.review(ID.alice, command);
  expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([{ key: 'response_length', value: 'brief' }]);
  const state = await x.experience.readPreferenceState(ID.alice, 'work', x.agent.id), undo = state.entries[0].undo!;
  expect(undo.restore).toBeNull();
  await x.experience.undoPreference(ID.alice, { ...x.scope, expectedRevision: state.revision, eventId: randomUUID(), changeId: undo.changeId });
  await x.learning.review(ID.alice, command); expect((await x.experience.readPreferences(ID.alice, 'work', x.agent.id)).settings).toEqual([]);
  expect(x.enqueue(text, logical)).toBe(true); await x.learning.tasks.settle(); expect((await x.view()).candidates).toEqual([]);
  expect(x.provider.evaluate).toHaveBeenCalledTimes(1);
});
it('shares max-two attempts with preparation and seals duplicate or changed-content finals without another provider call', async () => {
  const x = await setup(); await x.enable(); const logical = x.turn();
  const prepare = (revision: number) => x.experience.predict(ID.alice, { ...x.scope, ...logical, revision, text: 'Current request with enough context.', question: 'intent_route' });
  await prepare(1); await prepare(2);
  x.enqueue('Please be brief.', { ...logical, revision: 2 }); await x.learning.tasks.settle();
  expect(x.provider.evaluate).toHaveBeenCalledTimes(2); expect((await x.view()).candidates).toEqual([]);
  const second = x.turn(); await x.experience.predict(ID.alice, { ...x.scope, ...second, text: 'Another current request.', question: 'intent_route' });
  x.enqueue('Please be brief.', second); await x.learning.tasks.settle(); expect(x.provider.evaluate).toHaveBeenCalledTimes(4);
  x.enqueue('Different content, same completed logical turn.', second); await x.learning.tasks.settle(); expect(x.provider.evaluate).toHaveBeenCalledTimes(4);
  expect((await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.predictionTurns.find(t => t.turnId === second.turnId)))?.evaluations).toBe(2);
});
it('withdrawal and identity changes purge candidates/intents but preserve suppression and never revive on reconfirmation', async () => {
  const x = await setup(); await x.enable(); x.enqueue(); await x.learning.tasks.settle();
  const privacy = await x.f.adaptive.read(ID.alice, 'work');
  await x.f.adaptive.changeConsent(ID.alice, { space: 'work', purpose: 'optional.personalization', state: 'withdrawn',
    expectedRevision: privacy.purposes.find(p => p.purpose === 'optional.personalization')!.revision, eventId: randomUUID() });
  expect((await x.view()).candidates).toEqual([]); expect((await x.view()).enabled).toBe(false); expect(x.enqueue()).toBe(false);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning?.suppressions.length)).toBeGreaterThan(0);
  await x.enable(); await x.f.adaptive.confirm(ID.alice, { confirm: true }); expect((await x.view()).enabled).toBe(false);
  await x.enable(); await x.f.adaptive.withAccountDocument(ID.alice, d => { delete d.binding; d.revision++; });
  await x.f.adaptive.confirm(ID.alice, { confirm: true }); expect((await x.view()).enabled).toBe(false);
});
it('expires proposals through lifecycle without a UI read and exports only the selected-space coded evidence', async () => {
  const x = await setup(); await x.enable(); x.enqueue(); await x.learning.tasks.settle();
  const lifecycle = new AdaptiveLifecycleService(x.f.adaptive), exported = await lifecycle.exportAccount(ID.alice, 'work');
  expect(exported.preferenceLearning?.candidates).toHaveLength(1); expect((await lifecycle.exportAccount(ID.alice, 'personal')).preferenceLearning?.candidates).toEqual([]);
  x.setNow(NOW + 12 * 60 * 60_000 + 1); await lifecycle.sweepAccount(ID.alice);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning?.candidates)).toEqual([]);
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning?.intents)).toEqual([]);
});
it.each([{ file: false }, { guarded: false }])('is unavailable without qualified FILE/transport prerequisites %j', async options => {
  const x = await setup(options); expect((await x.view()).available).toBe(false); expect(x.enqueue()).toBe(false);
  await x.f.grant(); await x.f.agent();
  await expect(x.learning.present(ID.alice, { ...await x.command(), locale: 'en' })).rejects.toBeDefined();
  expect(await x.f.adaptive.withAccountDocument(ID.alice, d => d.experience.preferenceLearning)).toBeUndefined();
});
