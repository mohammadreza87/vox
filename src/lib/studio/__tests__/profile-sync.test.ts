import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBots } from '../bots';
import { Studio } from '../service';
import { StudioStore } from '../store';
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
    expect(view.profileSync).toEqual({ status: 'synced', failed: [] });
  });

  it('reports missing selected media as a photo error rather than claiming success or substituting a cloud', async () => {
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
    expect((await h.studio.getAgent(org.alice, hired.agent.id)).profileSync).toEqual({ status: 'error', failed: ['photo'] });
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
    expect(String(h.imageToJpeg.mock.calls[0][0])).toContain('#FF9DB5');
    expect((await stored()).profileSync?.status).toBe('synced');
  });

  it('serializes overlapping updates and finishes with the latest profile', async () => {
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
    expect(String(h.imageToJpeg.mock.calls[0][0])).toContain('#FF9DB5');
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
