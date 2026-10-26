import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBots } from '../bots';
import { TONES } from '../character';
import { Studio } from '../service';
import { StudioStore } from '../store';
import { handleAgentUpdate } from '../updates';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { hire, makeStudio, seedOrg, type Harness } from './helpers';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let hired: Awaited<ReturnType<typeof hire>>;
let stop: (() => void) | undefined;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
  hired = await hire(h, org.alice, { name: 'Neda' });
  clearCalls();
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); });

function clearCalls() {
  const bot = hired.bot();
  for (const method of [bot.setMyName, bot.setMyProfilePhoto, bot.setMyDescription, bot.setMyShortDescription, bot.setMyCommands, bot.setWebhook]) method.mockClear();
  h.imageToJpeg.mockClear();
}
async function stored() { return (await h.store.read()).agents.find((a) => a.id === hired.agent.id)!; }
async function legacy() {
  await h.store.update((state) => { delete state.agents.find((a) => a.id === hired.agent.id)!.profileSync; });
}
function advance(ms: number) { h.clock.now = new Date(h.clock.now.getTime() + ms); }
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('Telegram profile reconciliation', () => {
  it('backfills a legacy cloud photo once and persists success across a fresh Studio instance', async () => {
    await legacy();
    await h.studio.reconcileBotProfiles();
    expect(h.imageToJpeg).toHaveBeenCalledTimes(1);
    expect(String(h.imageToJpeg.mock.calls[0][0])).toContain('<svg');
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(String(hired.bot().setMyProfilePhoto.mock.calls[0][0])).toContain('JPEG:<svg');
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', failed: [] });

    await h.studio.reconcileBotProfiles();
    await new Studio({ ...h.studio.deps, store: new StudioStore(h.dir) }).reconcileBotProfiles();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(h.imageToJpeg).toHaveBeenCalledTimes(1);
    const view = await h.studio.getAgent(org.alice, hired.agent.id);
    expect(view.profileSync).toEqual({ status: 'synced', failed: [], updatedAt: h.clock.now.toISOString() });
  });

  it('reports missing selected media as a photo error rather than claiming success or substituting a cloud', async () => {
    await legacy();
    await h.store.update((state) => {
      const agent = state.agents.find((a) => a.id === hired.agent.id)!;
      agent.look.avatar = 'av-missing.jpg';
      agent.look.avatarSource = 'generated';
    });
    const failed = await h.studio.configureBotProfile(await stored());
    expect(failed).toContain('photo');
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
    expect(h.imageToJpeg).not.toHaveBeenCalled();
    expect(hired.bot().setMyName).toHaveBeenCalledWith('Neda');
    expect(hired.bot().setMyDescription).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyCommands).toHaveBeenCalledTimes(1);
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['photo'] });
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync).toMatchObject({ status: 'error', failed: ['photo'], retryAt: expect.any(String) });
  });

  it.each(['missing', 'rejecting'] as const)('persists a photo error when the JPEG converter is %s', async (converter) => {
    await legacy();
    if (converter === 'missing') h.studio.deps.imageToJpeg = undefined;
    else h.imageToJpeg.mockRejectedValue(new Error('Synthetic conversion error'));
    expect(await h.studio.configureBotProfile(await stored())).toContain('photo');
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
    expect(hired.bot().setMyCommands).toHaveBeenCalledTimes(1);
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['photo'] });
  });

  it.each(['missing', 'corrupt'] as const)('does not trust a previously synced receipt when its token becomes %s', async (token) => {
    expect((await stored()).profileSync?.status).toBe('synced');
    await h.store.update((state) => { state.agents.find((a) => a.id === hired.agent.id)!.tokenEnc = token === 'missing' ? undefined : 'invalid-fixture-ciphertext'; });
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync).toEqual({ status: 'pending', failed: [] });
    await h.studio.reconcileBotProfiles();
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['token'] });
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
  });

  it('persists an error if the Telegram client cannot be created', async () => {
    h.botFor.mockImplementation(() => { throw new Error('Synthetic client construction failure'); });
    expect(await h.studio.configureBotProfile(await stored())).toEqual(['profile']);
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['profile'] });
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
  });

  it('continues every cosmetic step after a webhook failure and exposes the failed step', async () => {
    await legacy();
    h.studio.deps.webhookBase = 'https://fixture.example';
    hired.bot().setWebhook.mockRejectedValue(new Error('Synthetic webhook refusal'));
    expect(await h.studio.configureBotProfile(await stored())).toContain('webhook');
    expect(hired.bot().setMyName).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyShortDescription).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyDescription).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyCommands).toHaveBeenCalledTimes(1);
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['webhook'] });
  });

  it('backs off automatic retries from 60 seconds to one hour and retries exactly when due', async () => {
    await legacy();
    hired.bot().setMyProfilePhoto.mockRejectedValue(new Error('Synthetic photo refusal'));
    for (let attempt = 1; attempt <= 8; attempt++) {
      await h.studio.reconcileBotProfiles();
      const status = (await stored()).profileSync!;
      const delay = Math.min(60_000 * 2 ** (attempt - 1), 3_600_000);
      expect(status).toMatchObject({ status: 'error', failed: ['photo'], attempts: attempt });
      expect(Date.parse(status.retryAt!) - h.clock.now.getTime()).toBe(delay);
      expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(attempt);
      advance(delay - 1);
      await h.studio.reconcileBotProfiles();
      expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(attempt);
      advance(1);
    }
    hired.bot().setMyProfilePhoto.mockResolvedValue(true);
    await h.studio.reconcileBotProfiles();
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', failed: [] });
    expect((await stored()).profileSync?.retryAt).toBeUndefined();
  });

  it('retries immediately when a changed desired profile fixes the previous failure', async () => {
    await h.store.update((state) => { state.agents.find((a) => a.id === hired.agent.id)!.look.avatar = 'av-missing.jpg'; });
    await h.studio.reconcileBotProfiles();
    expect((await stored()).profileSync?.status).toBe('error');
    await h.store.saveMedia('av-fixed.jpg', Buffer.from('FIXED_SELECTED_JPEG'));
    await h.store.update((state) => { state.agents.find((a) => a.id === hired.agent.id)!.look.avatar = 'av-fixed.jpg'; });
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenLastCalledWith(Buffer.from('FIXED_SELECTED_JPEG'));
    expect((await stored()).profileSync?.status).toBe('synced');
  });

  it('re-reads current name and look instead of applying the caller’s stale snapshot', async () => {
    const stale = await stored();
    await h.store.update((state) => { const agent = state.agents.find((a) => a.id === hired.agent.id)!; agent.persona.name = 'Neda Latest'; agent.look.hue = 'rose'; });
    await h.studio.configureBotProfile(stale);
    expect(hired.bot().setMyName).toHaveBeenLastCalledWith('Neda Latest');
    expect(String(h.imageToJpeg.mock.calls[0][0])).toContain(TONES.rose.light);
    expect((await stored()).profileSync?.status).toBe('synced');
  });

  it('serializes overlapping updates and finishes with the latest profile', async () => {
    await legacy();
    const stale = await stored();
    const firstStarted = deferred(), firstRelease = deferred(), secondStarted = deferred(), secondRelease = deferred();
    hired.bot().setMyProfilePhoto
      .mockImplementationOnce(async () => { firstStarted.resolve(); await firstRelease.promise; return true; })
      .mockImplementationOnce(async () => { secondStarted.resolve(); await secondRelease.promise; return true; });
    const older = h.studio.configureBotProfile(stale);
    await firstStarted.promise;
    await h.store.update((state) => { const agent = state.agents.find((a) => a.id === hired.agent.id)!; agent.persona.name = 'Neda Latest'; agent.look.hue = 'rose'; });
    const newer = h.studio.configureBotProfile(stale);
    await Promise.resolve();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    firstRelease.resolve();
    await secondStarted.promise;
    await older;
    expect((await stored()).profileSync?.status).not.toBe('synced');
    secondRelease.resolve();
    await newer;
    expect(hired.bot().setMyName).toHaveBeenLastCalledWith('Neda Latest');
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
    expect((await stored()).profileSync?.status).toBe('synced');
    clearCalls();
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
  });

  it('skips fired agents even when a stale active snapshot requests synchronization', async () => {
    const stale = await stored();
    await h.studio.fire(org.admin, hired.agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Neda' });
    await h.studio.configureBotProfile(stale);
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
  });

  it('synchronizes a changed cloud look and the automatically selected first generated avatar', async () => {
    await h.studio.setLook(org.alice, hired.agent.id, { hue: 'rose' });
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(String(h.imageToJpeg.mock.calls[0][0])).toContain(TONES.rose.light);
    const generated = await h.studio.generateAvatars(org.alice, hired.agent.id, 1);
    expect(generated.look.avatar).toBeDefined();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenLastCalledWith(await h.store.readMedia(generated.look.avatar!));
    expect((await stored()).profileSync?.status).toBe('synced');
  });

  it('repairs legacy and changed profiles from runner refresh without an explicit sync action', async () => {
    await legacy();
    vi.useFakeTimers();
    stop = startBots(h.studio).stop;
    await vi.advanceTimersByTimeAsync(0);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect((await stored()).profileSync?.status).toBe('synced');
    await h.store.update((state) => { state.agents.find((a) => a.id === hired.agent.id)!.look.hue = 'rose'; });
    await vi.advanceTimersByTimeAsync(8000);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
    expect((await stored()).profileSync?.status).toBe('synced');
  });

  it('keeps starting new bots and removing fired bots while a profile upload is stalled', async () => {
    await legacy();
    vi.useFakeTimers();
    const started = deferred(), release = deferred();
    hired.bot().setMyProfilePhoto.mockImplementationOnce(async () => { started.resolve(); await release.promise; return true; });
    stop = startBots(h.studio).stop;
    await vi.advanceTimersByTimeAsync(0);
    await started.promise;
    const newcomer = await hire(h, org.alice, { name: 'New teammate' });
    expect(newcomer.bot().getUpdates).not.toHaveBeenCalled();
    await h.studio.fire(org.admin, hired.agent.id, { reason: '', memoryPolicy: 'archive', confirmName: 'Neda' });
    try {
      await vi.advanceTimersByTimeAsync(8000);
      expect(newcomer.bot().getUpdates).toHaveBeenCalledTimes(1);
      expect(h.logger.info).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'lifecycle', reason: 'deactivated', outcome: 'offline' });
    } finally {
      release.resolve();
      // Join the outstanding per-agent queue so no background fixture job leaks.
      await h.studio.configureBotProfile(await stored());
    }
  });
});

describe('Telegram profile photo follows the latest character', () => {
  it('regenerating for an agent that already has a picture pushes the new picture', async () => {
    const first = await h.studio.generateAvatars(org.alice, hired.agent.id, 1);
    const second = await h.studio.generateAvatars(org.alice, hired.agent.id, 1);
    expect(second.look.avatar).not.toBe(first.look.avatar);
    expect(second.look.avatarVariants).toEqual([second.look.avatar, first.look.avatar]);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenLastCalledWith(await h.store.readMedia(second.look.avatar!));
    expect(second.profileSync).toMatchObject({ status: 'synced', failed: [] });
  });

  it('adds variants without pushing when select is false, and choosing Cloud pushes the character JPEG', async () => {
    const picked = await h.studio.generateAvatars(org.alice, hired.agent.id, 1);
    clearCalls();
    const added = await h.studio.generateAvatars(org.alice, hired.agent.id, 1, { select: false });
    expect(added.look.avatar).toBe(picked.look.avatar);
    expect(added.look.avatarVariants).toHaveLength(2);
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();

    const cloud = await h.studio.chooseAvatar(org.alice, hired.agent.id, null);
    expect(cloud.look.avatar).toBeUndefined();
    expect(String(h.imageToJpeg.mock.calls.at(-1)![0])).toMatch(new RegExp(`^<svg[\\s\\S]*${TONES.sky.light}`));
    expect(String(hired.bot().setMyProfilePhoto.mock.calls[0][0])).toMatch(/^JPEG:<svg/);
    expect(cloud.profileSync).toMatchObject({ status: 'synced', failed: [] });
  });

  it('a photo-only change calls only setMyProfilePhoto; Retry and legacy receipts push every step', async () => {
    await h.studio.syncProfile(org.alice, hired.agent.id);
    const variant = (await h.studio.generateAvatars(org.alice, hired.agent.id, 2, { select: false })).look.avatarVariants![1];
    clearCalls();
    const chosen = await h.studio.chooseAvatar(org.alice, hired.agent.id, variant);
    const bot = hired.bot();
    expect(bot.setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(bot.setMyProfilePhoto).toHaveBeenCalledWith(await h.store.readMedia(variant));
    for (const other of [bot.setMyName, bot.setMyShortDescription, bot.setMyDescription, bot.setMyCommands, bot.setWebhook]) expect(other).not.toHaveBeenCalled();
    expect(chosen.profileSync).toMatchObject({ status: 'synced', failed: [] });

    expect((await h.studio.chooseAvatar(org.alice, hired.agent.id, variant)).profileSync?.status).toBe('synced');
    expect(bot.setMyProfilePhoto).toHaveBeenCalledTimes(1);

    clearCalls();
    expect((await h.studio.syncProfile(org.alice, hired.agent.id)).failed).toEqual([]);
    for (const step of [bot.setMyName, bot.setMyProfilePhoto, bot.setMyShortDescription, bot.setMyDescription, bot.setMyCommands]) expect(step).toHaveBeenCalledTimes(1);
    clearCalls();
    expect((await h.studio.syncProfile(org.alice, hired.agent.id, { force: false })).failed).toEqual([]);
    expect(bot.setMyName).not.toHaveBeenCalled();
    expect(bot.setMyProfilePhoto).not.toHaveBeenCalled();

    await legacy();
    await h.studio.configureBotProfile(await stored());
    for (const step of [bot.setMyName, bot.setMyProfilePhoto, bot.setMyShortDescription, bot.setMyDescription, bot.setMyCommands]) expect(step).toHaveBeenCalledTimes(1);
  });

  it('a refused photo surfaces as failed:[photo] in the chooseAvatar response', async () => {
    const variant = (await h.studio.generateAvatars(org.alice, hired.agent.id, 1, { select: false })).look.avatarVariants![0];
    hired.bot().setMyProfilePhoto.mockRejectedValueOnce(new Error('Bad Request: PHOTO_INVALID_DIMENSIONS'));
    const chosen = await h.studio.chooseAvatar(org.alice, hired.agent.id, variant);
    expect(chosen.look.avatar).toBe(variant);
    expect(chosen.profileSync).toMatchObject({ status: 'error', failed: ['photo'], retryAt: expect.any(String) });
    // Retry pushes the same photo again.
    const retried = await h.studio.syncProfile(org.alice, hired.agent.id);
    expect(retried.failed).toEqual([]);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
  });

  it('a name rate limit never marks a photo change failed and is not retried until it is due', async () => {
    const variant = (await h.studio.generateAvatars(org.alice, hired.agent.id, 1, { select: false })).look.avatarVariants![0];
    // Synced name: a photo change doesn't even attempt it.
    await h.studio.syncProfile(org.alice, hired.agent.id);
    clearCalls();
    await h.studio.chooseAvatar(org.alice, hired.agent.id, variant);
    expect(hired.bot().setMyName).not.toHaveBeenCalled();

    // A 429 on the name while backing off: the photo still goes, and the failure stays the name's.
    hired.bot().setMyName.mockRejectedValueOnce(new Error('Too Many Requests: retry after 3600'));
    expect((await h.studio.syncProfile(org.alice, hired.agent.id)).failed).toEqual(['name']);
    clearCalls();
    const cloud = await h.studio.chooseAvatar(org.alice, hired.agent.id, null);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
    expect(cloud.profileSync).toMatchObject({ status: 'error', failed: ['name'] });

    // Once due, the reconcile loop retries just the name.
    advance(60_000);
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyName).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', failed: [] });
  });

  it('a look change while a picture is selected marks it stale without pushing, until a new photo is chosen', async () => {
    const generated = await h.studio.generateAvatars(org.alice, hired.agent.id, 1);
    expect(generated.look.avatarStale).toBe(false);
    clearCalls();
    const recoloured = await h.studio.setLook(org.alice, hired.agent.id, { hue: 'matcha' });
    expect(recoloured.look).toMatchObject({ hue: 'matcha', avatar: generated.look.avatar, avatarStale: true });
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();

    expect((await h.studio.generateAvatars(org.alice, hired.agent.id, 1)).look.avatarStale).toBe(false);
    expect((await h.studio.setLook(org.alice, hired.agent.id, { family: 'tower' })).look.avatarStale).toBe(true);
    expect((await h.studio.chooseAvatar(org.alice, hired.agent.id, null)).look.avatarStale).toBe(false);
    await h.studio.chooseAvatar(org.alice, hired.agent.id, generated.look.avatar!);
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).look.avatarStale).toBe(true);
    expect((await h.studio.uploadAvatar(org.alice, hired.agent.id, Buffer.from('PNG'), 'image/png')).look.avatarStale).toBe(false);
  });

  it('look edits with sync:false wait for the editor to close, then push the photo once', async () => {
    clearCalls();
    await h.studio.setLook(org.alice, hired.agent.id, { hue: 'rose' }, { sync: false });
    const edited = await h.studio.setLook(org.alice, hired.agent.id, { species: 'cat' }, { sync: false });
    expect(edited.look).toMatchObject({ hue: 'rose', species: 'cat' });
    // Held, not in flight: the status is what Telegram shows now, so clients neither spin nor poll.
    expect(edited.profileSync).toMatchObject({ status: 'synced', failed: [], held: true });
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync).toMatchObject({ status: 'synced', held: true });
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
    // The hold is stored, so another instance (webhook mode, a poll landing elsewhere) waits too.
    const other = new Studio({ ...h.studio.deps, store: new StudioStore(h.dir), webhookBase: 'https://fixture.example' });
    await other.getAgent(org.alice, hired.agent.id);
    await other.reconcileBotProfiles();
    await Promise.resolve();
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();

    const closed = await h.studio.syncProfile(org.alice, hired.agent.id, { force: false });
    expect(closed.failed).toEqual([]);
    expect(closed.agent.profileSync).toEqual({ status: 'synced', failed: [], updatedAt: h.clock.now.toISOString() });
    expect((await stored()).profileHeldUntil).toBeUndefined();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
    expect(String(h.imageToJpeg.mock.calls.at(-1)![0])).toContain(TONES.rose.light);

    // An editor that never closes doesn't hold the bot back for long.
    await h.studio.setLook(org.alice, hired.agent.id, { hue: 'butter' }, { sync: false });
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
    advance(120_000);
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(2);
  });

  it('an edit that reverts during the hold reports the receipt as is, and a hold without a receipt still says held', async () => {
    await h.studio.syncProfile(org.alice, hired.agent.id);
    await h.studio.setLook(org.alice, hired.agent.id, { hue: 'rose' }, { sync: false });
    const reverted = await h.studio.setLook(org.alice, hired.agent.id, { hue: hired.agent.look.hue }, { sync: false });
    expect(reverted.profileSync).toEqual({ status: 'synced', failed: [], updatedAt: expect.any(String) });
    await legacy();
    expect((await h.studio.setLook(org.alice, hired.agent.id, { hue: 'rose' }, { sync: false })).profileSync).toEqual({ status: 'pending', failed: [], held: true });
    advance(120_000);
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync).toEqual({ status: 'pending', failed: [] });
  });

  it('a refused step waiting out its backoff is not another attempt: an editor closing with no net change keeps the retry time', async () => {
    hired.bot().setMyName.mockRejectedValueOnce(new Error('Too Many Requests: retry after 3600'));
    await h.studio.syncProfile(org.alice, hired.agent.id);
    const refused = (await stored()).profileSync!;
    expect(refused).toMatchObject({ status: 'error', failed: ['name'], attempts: 1 });
    clearCalls();
    advance(30_000);
    for (let i = 0; i < 3; i++) {
      await h.studio.setLook(org.alice, hired.agent.id, { hue: 'rose' }, { sync: false });
      await h.studio.setLook(org.alice, hired.agent.id, { hue: hired.agent.look.hue }, { sync: false });
      expect((await h.studio.syncProfile(org.alice, hired.agent.id, { force: false })).failed).toEqual(['name']);
    }
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
    expect((await stored()).profileSync).toEqual(refused);
    advance(30_000);
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyName).toHaveBeenCalledTimes(1);
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', failed: [] });
  });

  it('a stage change makes the character photo stale and an editor opening the agent pushes the photo only (webhook mode)', async () => {
    h.studio.deps.webhookBase = 'https://fixture.example';
    await h.studio.syncProfile(org.alice, hired.agent.id);
    clearCalls();
    h.advanceDays(1);
    await h.studio.getAgent(org.alice, hired.agent.id);
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();

    // Day 5: stage 3 (the photo never shows less than stage 2, so days 1–4 look the same).
    h.advanceDays(3);
    expect((await h.studio.getAgent(org.bob, hired.agent.id)).profileSync?.status).toBe('pending');
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
    const view = await h.studio.getAgent(org.alice, hired.agent.id);
    expect(view).toMatchObject({ stage: 3, profileSync: { status: 'pending' } });
    await vi.waitFor(() => expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await h.studio.getAgent(org.bob, hired.agent.id)).profileSync?.status).toBe('synced'));
    for (const other of [hired.bot().setMyName, hired.bot().setMyDescription, hired.bot().setWebhook]) expect(other).not.toHaveBeenCalled();
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync?.status).toBe('synced');
    expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1);
  });

  it('an update reaching the bot repairs a stale profile in webhook mode', async () => {
    h.studio.deps.webhookBase = 'https://fixture.example';
    await h.studio.syncProfile(org.alice, hired.agent.id);
    clearCalls();
    h.advanceDays(4);
    const from = { id: 999, is_bot: true, first_name: 'Other bot' };
    await handleAgentUpdate(h.studio, hired.agent.id, { update_id: 1, message: { message_id: 1, date: 0, chat: { id: 999, type: 'private' }, from } } as TelegramUpdate);
    await vi.waitFor(() => expect(hired.bot().setMyProfilePhoto).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await stored()).profileSync?.status).toBe('synced'));
    expect(hired.bot().setMyName).not.toHaveBeenCalled();
  });

  it('opening an agent never pushes in the polling runtime (its reconcile loop does)', async () => {
    await h.store.update((state) => { state.agents.find((a) => a.id === hired.agent.id)!.look.hue = 'rose'; });
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync?.status).toBe('pending');
    await Promise.resolve();
    expect(hired.bot().setMyProfilePhoto).not.toHaveBeenCalled();
  });
});

describe('Settings v2 command menus (scoped and localised)', () => {
  /** The commands key exactly as the profile sync computed it before Part 3. */
  const legacyKey = (botId: number, name: string) => createHash('sha256').update(JSON.stringify([botId, [
    { command: 'start', description: `Meet ${name}` }, { command: 'memories', description: 'What I remember that you can see' },
    { command: 'forget', description: 'Delete something you told me' }, { command: 'whoami', description: 'How I know you' },
  ]])).digest('base64url').slice(0, 16);
  afterEach(() => vi.unstubAllEnvs());

  it('flag off: the commands key is the pre-Part-3 value, so nothing re-pushes; one setMyCommands with one argument', async () => {
    expect((await stored()).profileSync?.steps?.commands).toBe(legacyKey(hired.botId, 'Neda'));
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyCommands).not.toHaveBeenCalled();
    await h.studio.configureBotProfile(await stored(), { force: true });
    expect(hired.bot().setMyCommands.mock.calls).toEqual([[[
      { command: 'start', description: 'Meet Neda' }, { command: 'memories', description: 'What I remember that you can see' },
      { command: 'forget', description: 'Delete something you told me' }, { command: 'whoami', description: 'How I know you' }]]]);
    expect(hired.bot().deleteMyCommands).not.toHaveBeenCalled();
  });

  it('flag on: one re-push of five menus (default, private EN/FA, group EN/FA); then nothing; flag back off: the default menu and the scoped ones removed, once', async () => {
    // Settle the fixture first (hire() changes visibility after its own sync, so the description is stale).
    await h.studio.reconcileBotProfiles();
    clearCalls();
    vi.stubEnv('STUDIO_SETTINGS_V2', '1');
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync?.status).toBe('pending');
    await h.studio.reconcileBotProfiles();
    const pushed = hired.bot().setMyCommands.mock.calls as unknown as Array<[Array<{ command: string }>, { scope?: { type: string }; languageCode?: string }?]>;
    expect(pushed.map(([menu, target]) => [target?.scope?.type ?? 'default', target?.languageCode ?? 'en', menu.map((c) => c.command).join(',')])).toEqual([
      ['default', 'en', 'start,memories,forget,whoami'],
      ['all_private_chats', 'en', 'start,settings,memory,voice,activity,connectors,memories,forget,whoami'],
      ['all_private_chats', 'fa', 'start,settings,memory,voice,activity,connectors,memories,forget,whoami'],
      ['all_group_chats', 'en', 'settings,whoami'],
      ['all_group_chats', 'fa', 'settings,whoami'],
    ]);
    expect(pushed[2][0][0]).toEqual({ command: 'start', description: 'آشنایی با Neda' });
    // Only the commands step moved.
    for (const other of [hired.bot().setMyName, hired.bot().setMyDescription, hired.bot().setMyShortDescription, hired.bot().setMyProfilePhoto]) expect(other).not.toHaveBeenCalled();
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', steps: { commands: expect.stringMatching(/^scoped:/) } });
    clearCalls();
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyCommands).not.toHaveBeenCalled();

    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyCommands).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyCommands.mock.calls[0]).toHaveLength(1);
    expect(hired.bot().deleteMyCommands.mock.calls).toEqual([
      [{ scope: { type: 'all_private_chats' } }], [{ scope: { type: 'all_private_chats' }, languageCode: 'fa' }],
      [{ scope: { type: 'all_group_chats' } }], [{ scope: { type: 'all_group_chats' }, languageCode: 'fa' }],
    ]);
    expect((await stored()).profileSync?.steps?.commands).toBe(legacyKey(hired.botId, 'Neda'));
    clearCalls(); hired.bot().deleteMyCommands.mockClear();
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyCommands).not.toHaveBeenCalled();
    expect(hired.bot().deleteMyCommands).not.toHaveBeenCalled();
  });

  it('a refused cleanup keeps its marker and is retried when due', async () => {
    vi.stubEnv('STUDIO_SETTINGS_V2', '1');
    await h.studio.reconcileBotProfiles();
    vi.stubEnv('STUDIO_SETTINGS_V2', '0');
    hired.bot().deleteMyCommands.mockRejectedValueOnce(new Error('Too Many Requests'));
    await h.studio.reconcileBotProfiles();
    expect((await stored()).profileSync).toMatchObject({ status: 'error', failed: ['commands'], steps: { commands: expect.stringMatching(/^!scoped:/) } });
    hired.bot().deleteMyCommands.mockClear();
    advance(61_000);
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().deleteMyCommands).toHaveBeenCalledTimes(4);
    expect((await stored()).profileSync).toMatchObject({ status: 'synced', steps: { commands: legacyKey(hired.botId, 'Neda') } });
  });

  it('a bot that never had the flag on: a rename with the flag off never removes scoped menus', async () => {
    await h.studio.updatePersona(org.alice, hired.agent.id, { name: 'Nima' });
    await h.studio.reconcileBotProfiles();
    expect(hired.bot().setMyCommands).toHaveBeenCalledTimes(1);
    expect(hired.bot().setMyCommands.mock.calls[0]).toHaveLength(1);
    expect(hired.bot().deleteMyCommands).not.toHaveBeenCalled();
  });
});
