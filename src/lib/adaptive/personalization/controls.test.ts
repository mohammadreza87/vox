import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AdaptiveLifecycleService } from '../lifecycle/service';
import { preferenceFixture, NOW } from './__tests__/fixtures';
import * as resolver from './index';
const fixtures: Awaited<ReturnType<typeof preferenceFixture>>[] = [];
async function setup(file = false) { const f = await preferenceFixture({ file }); fixtures.push(f); return f; }
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(fixtures.splice(0).map(f => f.close())); });
const brief = { key: 'response_length', value: 'brief' } as const;
const detailed = { key: 'response_length', value: 'detailed' } as const;
const entry = (state: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['state']>>) => state.entries.find(row => row.setting.key === 'response_length')!;
async function undo(f: Awaited<ReturnType<typeof setup>>, changeId: string) {
  const current = await f.state();
  const input = { space: 'work' as const, agentId: f.agentId, changeId, expectedRevision: current.revision, eventId: randomUUID() };
  return { input, snapshot: await f.experience.undoPreference(f.telegramId, input) };
}
it('connects all explicit settings to the scoped resolver and explains default/choice/reset', async () => {
  const f = await setup(); await f.grant(); await f.agent();
  expect((await f.state()).entries.every(row => row.source === 'default' && row.explanation === 'default')).toBe(true);
  await f.save(brief); await f.save({ key: 'language', value: 'fa' }); await f.save({ key: 'formatting', value: 'structured' });
  expect((await f.experience.readPreferences(f.telegramId, 'work', f.agentId)).settings).toEqual([brief, { key: 'language', value: 'fa' }, { key: 'formatting', value: 'structured' }]);
  expect(entry(await f.state())).toMatchObject({ source: 'explicit', applied: true, explanation: 'explicit_choice' });
  await f.save(brief, 'reset');
  expect(entry(await f.state())).toMatchObject({ source: 'reset', applied: false, explanation: 'explicit_reset', setting: { value: 'balanced' } });
  expect((await f.experience.readPreferences(f.telegramId, 'personal', f.agentId)).settings).toEqual([]);
});
it('undo restores true absence, consumes its token, and save/undo replays never resurrect old values', async () => {
  const f = await setup(true); const saved = await f.save(brief), state = await f.state();
  expect(entry(state).undo?.restore).toBeNull();
  const undone = await undo(f, saved.input.eventId);
  expect(undone.snapshot.preferences).toEqual([]); expect(entry(await f.state()).undo).toBeUndefined();
  await f.experience.savePreference(f.telegramId, saved.input);
  await f.experience.undoPreference(f.telegramId, undone.input);
  expect((await f.experience.read(f.telegramId, 'work')).preferences).toEqual([]);
  await expect(f.experience.undoPreference(f.telegramId, { ...undone.input, changeId: 'another-change' })).rejects.toMatchObject({ code: 'event_conflict' });
});
it('undo restores an earlier explicit value with a fresh revision and survives file restart', async () => {
  const f = await setup(true); await f.grant(); await f.agent(); await f.save(brief);
  const last = await f.save(detailed), before = entry(await f.state());
  const restarted = f.factory();
  await restarted.experience.undoPreference(f.telegramId, { space: 'work', agentId: f.agentId, changeId: last.input.eventId,
    expectedRevision: (await f.state()).revision, eventId: randomUUID() });
  expect(entry(await f.state()).saved).toMatchObject({ setting: brief, revision: before.saved!.revision + 1 });
  expect((await f.experience.readPreferences(f.telegramId, 'work', f.agentId)).settings).toEqual([brief]);
});
it('serializes duplicate file-backed undo commands and never imports a stale preference from an account export', async () => {
  const f = await setup(true); await f.save(brief); const last = await f.save(detailed);
  const lifecycle = new AdaptiveLifecycleService(f.adaptive), exported = await lifecycle.exportAccount(f.telegramId, 'work');
  const current = await f.state(), input = { space: 'work' as const, agentId: f.agentId, changeId: last.input.eventId,
    expectedRevision: current.revision, eventId: randomUUID() };
  const results = await Promise.all([f.experience.undoPreference(f.telegramId, input), f.factory().experience.undoPreference(f.telegramId, input)]);
  expect(results[0].revision).toBe(results[1].revision);
  expect(entry(await f.state()).saved).toMatchObject({ setting: brief, revision: 3 });
  expect(entry(await f.state()).undo).toBeUndefined();
  expect((await lifecycle.reconcileSnapshot(f.telegramId, exported)).importedPayloads).toBe(0);
  expect(entry(await f.state()).saved?.setting).toEqual(brief);
  expect(entry(await f.state()).undo).toBeUndefined();
});
it('undo preserves an explicit reset rather than turning it into absence or a stored default', async () => {
  const f = await setup(); await f.grant(); await f.agent(); await f.save(brief, 'reset');
  const last = await f.save(detailed);
  expect(entry(await f.state()).undo?.restore?.status).toBe('reset'); await undo(f, last.input.eventId);
  expect(entry(await f.state())).toMatchObject({ source: 'reset', explanation: 'explicit_reset', saved: { status: 'reset' } });
  expect((await f.experience.readPreferences(f.telegramId, 'work', f.agentId)).settings).toEqual([]);
});
it('keeps same-key choices and undo tokens separate for every exact agent and space', async () => {
  const f = await setup(true), work = await f.save(brief);
  const personal = await f.save(detailed, 'set', 'personal');
  const current = await f.experience.read(f.telegramId, 'work');
  await f.experience.savePreference(f.telegramId, { space: 'work', agentId: 'other-agent', setting: detailed, action: 'set',
    expectedRevision: current.revision, eventId: randomUUID() });
  await expect(undo(f, personal.input.eventId)).rejects.toMatchObject({ code: 'preference_undo_unavailable' });
  const before = await f.state();
  await expect(f.experience.undoPreference(f.telegramId, { space: 'work', agentId: 'other-agent', changeId: work.input.eventId,
    expectedRevision: before.revision, eventId: randomUUID() })).rejects.toMatchObject({ code: 'preference_undo_unavailable' });
  await undo(f, work.input.eventId);
  expect(entry(await f.state()).saved).toBeUndefined();
  expect(entry(await f.state('personal')).saved?.setting).toEqual(detailed);
  expect(entry(await f.experience.readPreferenceState(f.telegramId, 'work', 'other-agent')).saved?.setting).toEqual(detailed);
});
it('rejects stale CAS and superseded undo while retaining the latest choice', async () => {
  const f = await setup(true), initial = await f.experience.read(f.telegramId, 'work');
  const input = { space: 'work' as const, agentId: f.agentId, expectedRevision: initial.revision, setting: brief, action: 'set' as const };
  const concurrent = await Promise.allSettled([f.experience.savePreference(f.telegramId, { ...input, eventId: randomUUID() }),
    f.factory().experience.savePreference(f.telegramId, { ...input, setting: detailed, eventId: randomUUID() })]);
  expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const old = entry(await f.state()).undo!; await f.save({ key: 'response_length', value: 'balanced' });
  await expect(undo(f, old.changeId)).rejects.toMatchObject({ code: 'preference_undo_unavailable' });
  await expect(f.experience.undoPreference(f.telegramId, { space: 'work', agentId: f.agentId, expectedRevision: initial.revision,
    changeId: entry(await f.state()).undo!.changeId, eventId: randomUUID() })).rejects.toMatchObject({ code: 'revision_conflict' });
  expect(entry(await f.state()).saved?.setting.value).toBe('balanced');
});
it('never revives personalization consent, agent grants, memories or analytics when undo restores a choice', async () => {
  const f = await setup(); await f.grant(); await f.agent(); await f.save(brief); const last = await f.save(detailed);
  const privacy = await f.adaptive.read(f.telegramId, 'work');
  await f.adaptive.changeConsent(f.telegramId, { space: 'work', purpose: 'optional.personalization', state: 'withdrawn',
    expectedRevision: privacy.purposes.find(row => row.purpose === 'optional.personalization')!.revision, eventId: randomUUID() });
  await f.agent(false);
  const before = await f.adaptive.withAccountDocument(f.telegramId, d => ({ permissions: d.permissions, grants: d.agentGrants, memories: d.memories, observer: d.observer }));
  await undo(f, last.input.eventId);
  expect(await f.adaptive.withAccountDocument(f.telegramId, d => ({ permissions: d.permissions, grants: d.agentGrants, memories: d.memories, observer: d.observer }))).toEqual(before);
  expect(entry(await f.state())).toMatchObject({ applied: false, explanation: 'personalization_off', saved: { setting: brief } });
  expect((await f.experience.readPreferences(f.telegramId, 'work', f.agentId)).settings).toEqual([]);
});
it('distinguishes missing agent grants and unavailable release capability without exporting saved settings', async () => {
  const f = await setup(); await f.grant(); await f.save(brief);
  expect(entry(await f.state()).explanation).toBe('agent_grant_missing'); await f.agent(); f.denyPersonalization();
  expect(entry(await f.state()).explanation).toBe('capability_unavailable');
  expect((await f.experience.readPreferences(f.telegramId, 'work', f.agentId)).settings).toEqual([]);
});
it('purges expired undo payloads in maintenance/export and invalidates undo after reconfirmation', async () => {
  const f = await setup(true); await f.save(brief); const last = await f.save(detailed);
  const lifecycle = new AdaptiveLifecycleService(f.adaptive);
  expect((await lifecycle.exportAccount(f.telegramId, 'work')).preferenceChanges[0].previous?.setting).toEqual(brief);
  f.setNow(NOW + 10 * 60_000 + 1); await lifecycle.sweepAccount(f.telegramId);
  expect(await f.adaptive.withAccountDocument(f.telegramId, d => d.experience.preferenceUndo)).toBeUndefined();
  expect((await lifecycle.exportAccount(f.telegramId, 'work')).preferenceChanges).toEqual([]);
  await expect(undo(f, last.input.eventId)).rejects.toMatchObject({ code: 'preference_undo_unavailable' });
  await f.adaptive.confirm(f.telegramId, { confirm: true });
  await expect(undo(f, last.input.eventId)).rejects.toMatchObject({ code: 'preference_undo_unavailable' });
  const next = await f.save(brief); await f.adaptive.confirm(f.telegramId, { confirm: true });
  await expect(undo(f, next.input.eventId)).rejects.toMatchObject({ code: 'preference_undo_unavailable' });
  expect(entry(await f.state()).saved?.setting).toEqual(brief);
});
it('suppresses a replaced or expired account binding without allowing undo to revive it', async () => {
  const f = await setup(true); const saved = await f.save(brief);
  await f.adaptive.withAccountDocument(f.telegramId, d => { delete d.binding; d.revision++; });
  await new AdaptiveLifecycleService(f.adaptive).sweepAccount(f.telegramId);
  expect(await f.adaptive.withAccountDocument(f.telegramId, d => d.experience.preferenceUndo)).toBeUndefined();
  await expect(f.experience.undoPreference(f.telegramId, { space: 'work', agentId: f.agentId, changeId: saved.input.eventId,
    eventId: randomUUID(), expectedRevision: (await f.experience.read(f.telegramId, 'work')).revision })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
  expect((await f.experience.readPreferences(f.telegramId, 'work', f.agentId)).settings).toEqual([]);
  await f.adaptive.confirm(f.telegramId, { confirm: true });
  const next = await f.save(detailed); f.setNow(NOW + 12 * 60 * 60_000 + 1);
  await new AdaptiveLifecycleService(f.adaptive).sweepAccount(f.telegramId);
  expect(await f.adaptive.withAccountDocument(f.telegramId, d => d.experience.preferenceUndo)).toBeUndefined();
  await expect(f.experience.undoPreference(f.telegramId, { space: 'work', agentId: f.agentId, changeId: next.input.eventId,
    eventId: randomUUID(), expectedRevision: (await f.experience.read(f.telegramId, 'work')).revision })).rejects.toMatchObject({ code: 'profile_confirmation_required' });
});
it('fences a grant withdrawal during the awaited resolver before returning private preference context', async () => {
  const f = await setup(); await f.grant(); await f.agent(); await f.save(brief);
  const resolve = resolver.resolvePreferences;
  vi.spyOn(resolver, 'resolvePreferences').mockImplementationOnce(async (...args) => {
    const result = await resolve(...args); await f.agent(false); return result;
  });
  await expect(f.experience.readPreferences(f.telegramId, 'work', f.agentId)).rejects.toMatchObject({ code: 'preference_authority_changed' });
});
