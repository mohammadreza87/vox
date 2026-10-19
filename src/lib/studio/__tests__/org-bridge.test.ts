import { describe, expect, it } from 'vitest';
import { agentToPersona, groupId, personId, studioToOrg, studioToOrgConfig } from '../org-bridge';
import type { Agent, StudioState } from '../types';
import { fakeMember, ID, personaSpec, T0 } from './helpers';

function agent(partial: Partial<Agent>): Agent {
  return {
    id: 'ag1', status: 'active', persona: personaSpec(),
    look: { hue: 'sky', family: 'puff', features: { cheeks: true, lashes: false, brows: false } },
    createdBy: ID.alice, createdAt: T0.toISOString(), isAdmin: false, access: 'everyone', identityVersion: 3,
    bot: { id: 1, username: 'hoor_nova_bot' }, ...partial,
  };
}

function state(): StudioState {
  return {
    members: [fakeMember(ID.superadmin, 'superadmin'), fakeMember(ID.alice, 'member'), fakeMember(ID.pending, 'pending')],
    agents: [
      agent({ id: 'live' }),
      agent({ id: 'orphan', createdBy: 12345 }),
      agent({ id: 'draft', status: 'draft', bot: undefined }),
      agent({ id: 'fired', status: 'fired' }),
    ],
    groups: [{ chatId: -100777, title: 'Team', memberIds: [ID.alice, ID.superadmin], hasGuests: false, agentIds: ['live'], addedAt: T0.toISOString() }],
    audit: [],
  };
}

describe('studio → runtime org', () => {
  it('only approved members become people', () => {
    const org = studioToOrg(state());
    expect(org.getPersonByTelegramId(ID.alice)?.id).toBe(personId(ID.alice));
    expect(org.getPersonByTelegramId(ID.superadmin)?.role).toBe('Super Admin');
    expect(org.getPersonByTelegramId(ID.pending)).toBeUndefined();
  });

  it('only active agents with a bot become personas; unknown creators fall back to a superadmin owner', () => {
    const cfg = studioToOrgConfig(state());
    expect(cfg.personas.map((p) => p.id).sort()).toEqual(['live', 'orphan']);
    expect(cfg.personas.find((p) => p.id === 'live')?.ownerId).toBe(personId(ID.alice));
    expect(cfg.personas.find((p) => p.id === 'orphan')?.ownerId).toBe(personId(ID.superadmin));
  });

  it('maps persona identity, voice and voice-reply policy', () => {
    const silent = agentToPersona(agent({}), 'o');
    expect(silent).toMatchObject({ name: 'Nova', identityVersion: 3, telegramUsername: 'hoor_nova_bot', replyWithVoice: 'never' });
    const voiced = agentToPersona(agent({ voice: { provider: 'elevenlabs', voiceId: 'v9', label: 'l', source: 'design' } }), 'o');
    expect(voiced.voice.elevenLabsVoiceId).toBe('v9');
    expect(voiced.replyWithVoice).toBe('mirror');
  });

  it('groups keep their chat id, guest flag and known members', () => {
    const org = studioToOrg(state());
    const g = org.getGroupByChatId(-100777)!;
    expect(g.id).toBe(groupId(-100777));
    expect(g.memberIds.sort()).toEqual([personId(ID.alice), personId(ID.superadmin)].sort());
    expect(g.hasGuests).toBe(false);
  });

  it('a group reader who is no longer approved counts as a guest', () => {
    const s = state();
    s.groups[0].memberIds.push(ID.pending);
    const g = studioToOrg(s).getGroupByChatId(-100777)!;
    expect(g.memberIds).not.toContain(personId(ID.pending));
    expect(g.hasGuests).toBe(true);
  });
});
