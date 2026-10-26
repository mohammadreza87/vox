/**
 * S11L hardening (F014, F060): demoting a member to pending removes their
 * voiceprint templates at once (VoiceprintService.invalidate, both spaces)
 * when STUDIO_VOICE_RECOGNITION is on, instead of keeping them until the next
 * startup sweep. With the flag unset nothing is called. A failed invalidate
 * never fails the role change.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceprintService } from '../identity/voice';
import { ID, makeStudio, memberOf, seedOrg } from './helpers';

vi.setConfig({ testTimeout: 60_000 });

afterEach(() => { vi.unstubAllEnvs(); });

/** A structural stand-in for VoiceprintService: enrolled templates keyed by telegram id. */
function fakeVoiceprints(options: { fail?: boolean } = {}) {
  const enrolled = new Set<number>();
  const invalidate = vi.fn(async (telegramId: number) => {
    if (options.fail) throw new Error('store unavailable');
    enrolled.delete(telegramId);
  });
  const service = { enroll: async (telegramId: number) => { enrolled.add(telegramId); }, invalidate };
  return { enrolled, invalidate, service, asDep: service as unknown as VoiceprintService };
}

async function setup(options: { fail?: boolean } = {}) {
  const h = makeStudio({ adaptive: false });
  const org = await seedOrg(h);
  const vp = fakeVoiceprints(options);
  h.studio.deps.voiceprints = vp.asDep;
  await vp.service.enroll(ID.bob);
  return { h, org, vp };
}

describe('demotion invalidates voiceprints', () => {
  it('with STUDIO_VOICE_RECOGNITION=1: demoting to pending calls invalidate with that telegram id and removes the template', async () => {
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '1');
    const { h, org, vp } = await setup();
    expect(vp.enrolled.has(ID.bob)).toBe(true);
    const changed = await h.studio.setRole(org.admin, ID.bob, 'pending');
    expect(changed.role).toBe('pending');
    expect(vp.invalidate).toHaveBeenCalledTimes(1);
    // Both spaces: no space argument.
    expect(vp.invalidate).toHaveBeenCalledWith(ID.bob);
    expect(vp.enrolled.has(ID.bob)).toBe(false);
  });

  it('with the flag on, a role change that stays at member or above does not invalidate', async () => {
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '1');
    const { h, org, vp } = await setup();
    await h.studio.setRole(org.superadmin, ID.bob, 'admin');
    await h.studio.setRole(org.superadmin, ID.bob, 'member');
    expect(vp.invalidate).not.toHaveBeenCalled();
    expect(vp.enrolled.has(ID.bob)).toBe(true);
  });

  it('flag unset: demoting does not call invalidate', async () => {
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '');
    const { h, org, vp } = await setup();
    await h.studio.setRole(org.admin, ID.bob, 'pending');
    expect((await memberOf(h, ID.bob)).role).toBe('pending');
    expect(vp.invalidate).not.toHaveBeenCalled();
    expect(vp.enrolled.has(ID.bob)).toBe(true);
  });

  it('a failed invalidate is logged without content and never fails the role change', async () => {
    vi.stubEnv('STUDIO_VOICE_RECOGNITION', '1');
    const { h, org, vp } = await setup({ fail: true });
    await expect(h.studio.setRole(org.admin, ID.bob, 'pending')).resolves.toMatchObject({ telegramId: ID.bob, role: 'pending' });
    expect(vp.invalidate).toHaveBeenCalledWith(ID.bob);
    expect(h.logger.warn).toHaveBeenCalledWith('[vox] voiceprint invalidate_failed');
    expect((await memberOf(h, ID.bob)).role).toBe('pending');
  });
});
