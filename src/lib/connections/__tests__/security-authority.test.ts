import { describe, expect, it } from 'vitest';
import { AdaptiveRepository } from '../../adaptive/persistence/repository';
import { AdaptiveService } from '../../adaptive/persistence/service';
import { MemoryAdaptiveStorage } from '../../adaptive/runtime/storage';
import type { Studio } from '../../studio/service';
import type { StudioState } from '../../studio/types';
import { createStudioConnectionAuthority } from '../authority';

async function fixture() {
  let time = 1_800_000_000_000;
  const adaptive = new AdaptiveService(new AdaptiveRepository(new MemoryAdaptiveStorage()), { now: () => time });
  const state = { members: [{ telegramId: 1001, role: 'member', firstName: 'QA' }, { telegramId: 1002, role: 'owner', firstName: 'Owner' }],
    agents: [{ id: 'qa-private-agent', status: 'active', createdBy: 1001, visibility: 'private', access: [] },
      { id: 'qa-fired-agent', status: 'fired', createdBy: 1001, visibility: 'org', access: 'everyone' }], groups: [], audit: [] } as unknown as StudioState;
  const studio = { deps: { store: { read: async () => structuredClone(state) }, adaptive } } as unknown as Studio;
  const resolve = createStudioConnectionAuthority(studio, () => time);
  return { adaptive, studio, state, resolve, advance: (ms: number) => { time += ms; } };
}

describe('independent real adaptive-profile to Connections authority integration', () => {
  it('a signed account still needs a current verified person binding', async () => {
    const f = await fixture();
    await expect(f.resolve({ accountId: 'telegram-account:1001' }, 'work')).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    await f.adaptive.confirm(1001, { confirm: true });
    const context = await f.resolve({ accountId: 'telegram-account:1001' }, 'work');
    expect(context.currentAgentIds).toEqual(['qa-private-agent']); expect(context.scope.audiencePersonIds).toEqual([context.personId]);
    expect(context.bindingRevision).toBe(1);
  });

  it('Work and Personal have different exact scope IDs for one verified account', async () => {
    const f = await fixture(); await f.adaptive.confirm(1001, { confirm: true });
    const work = await f.resolve({ accountId: 'telegram-account:1001' }, 'work');
    const personal = await f.resolve({ accountId: 'telegram-account:1001' }, 'personal');
    expect(personal.personId).toBe(work.personId); expect(personal.scope.spaceId).not.toBe(work.scope.spaceId);
    expect(personal.scope.containerId).not.toBe(work.scope.containerId);
  });

  it('Studio ownership cannot select another person profile or another account scope', async () => {
    const f = await fixture(); await f.adaptive.confirm(1001, { confirm: true }); await f.adaptive.confirm(1002, { confirm: true });
    const member = await f.resolve({ accountId: 'telegram-account:1001' }, 'work');
    const owner = await f.resolve({ accountId: 'telegram-account:1002' }, 'work');
    expect(owner.personId).not.toBe(member.personId); expect(owner.scope.tenantId).not.toBe(member.scope.tenantId);
    expect(owner.scope.audiencePersonIds).not.toContain(member.personId);
  });

  it('rechecks current Studio membership and active-agent status instead of reusing a stale context', async () => {
    const f = await fixture(); await f.adaptive.confirm(1001, { confirm: true });
    expect((await f.resolve({ accountId: 'telegram-account:1001' }, 'work')).currentAgentIds).toContain('qa-private-agent');
    f.state.agents[0].status = 'fired';
    expect((await f.resolve({ accountId: 'telegram-account:1001' }, 'work')).currentAgentIds).toEqual([]);
    f.state.members[0].role = 'pending';
    await expect(f.resolve({ accountId: 'telegram-account:1001' }, 'work')).rejects.toMatchObject({ code: 'approval_required' });
  });

  it('expires profile confirmation and changes binding revision on explicit reconfirmation', async () => {
    const f = await fixture(); await f.adaptive.confirm(1001, { confirm: true });
    const initial = await f.resolve({ accountId: 'telegram-account:1001' }, 'work');
    f.advance(12 * 60 * 60 * 1000 + 1);
    await expect(f.resolve({ accountId: 'telegram-account:1001' }, 'work')).rejects.toMatchObject({ code: 'profile_confirmation_required' });
    await f.adaptive.confirm(1001, { confirm: true });
    const next = await f.resolve({ accountId: 'telegram-account:1001' }, 'work');
    expect(next.bindingRevision).toBeGreaterThan(initial.bindingRevision); expect(next.scope.audienceRevision).not.toBe(initial.scope.audienceRevision);
  });

  it.each(['telegram-account:0', 'telegram-account:1e3', 'telegram-account:1001/other', 'forged-person:1001'])
    ('rejects malformed account identity %s', async accountId => {
      const f = await fixture(); await expect(f.resolve({ accountId }, 'work')).rejects.toMatchObject({ code: 'authentication_required' });
    });
});
