import { describe, expect, it } from 'vitest';
import { defaultVoiceId } from '../media';
import { agentCraft, agentToPersona, groupId, personId, studioToOrg, studioToOrgConfig } from '../org-bridge';
import type { Catalog } from '../skills/catalog';
import type { AgentRole, AgentSkill } from '../skills/types';
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
  it('approved members are org people; pending people and guests are outsiders', () => {
    const s = state();
    s.guests = [{ telegramId: ID.stranger, name: 'Stranger', firstSeen: '' }];
    const org = studioToOrg(s);
    expect(org.getPersonByTelegramId(ID.alice)?.id).toBe(personId(ID.alice));
    expect(org.getPersonByTelegramId(ID.alice)?.guest).toBeFalsy();
    expect(org.getPersonByTelegramId(ID.superadmin)?.role).toBe('Super Admin');
    for (const id of [ID.pending, ID.stranger]) {
      expect(org.getPersonByTelegramId(id)).toMatchObject({ guest: true, companyIds: [] });
    }
  });

  it('only active agents with a bot become personas; unknown creators fall back to a superadmin owner', () => {
    const cfg = studioToOrgConfig(state());
    expect(cfg.personas.map((p) => p.id).sort()).toEqual(['live', 'orphan']);
    expect(cfg.personas.find((p) => p.id === 'live')?.ownerId).toBe(personId(ID.alice));
    expect(cfg.personas.find((p) => p.id === 'orphan')?.ownerId).toBe(personId(ID.superadmin));
  });

  it('maps persona identity, voice and voice-reply policy', () => {
    const silent = agentToPersona(agent({}), 'o');
    // No designed voice: voice messages are still answered, with a default voice.
    expect(silent).toMatchObject({ name: 'Nova', identityVersion: 3, telegramUsername: 'hoor_nova_bot', replyWithVoice: 'mirror' });
    expect(silent.voice.elevenLabsVoiceId).toBe(defaultVoiceId(agent({}).persona.presentation));
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
    expect(g.memberIds).toContain(personId(ID.pending));
    expect(g.hasGuests).toBe(true);
  });
});

describe('character, voice examples and craft reach the runtime persona', () => {
  const skill = (id: string, title: string): AgentSkill => ({
    id, title, summary: title, whenToUse: `Use when ${title.toLowerCase()} matters.`, method: ['First.', 'Second.', 'Third.'],
    qualityBar: ['Clear.', 'Short.', 'True.'], pitfalls: ['Vague.', 'Long.'], frameworks: [], sources: [{ name: 'Fixture', url: 'https://example.com/f' }],
  });
  const role: AgentRole = {
    id: 'mobile.live-ops-producer', pack: 'mobile', space: 'work', title: 'Live-ops Producer', summary: 'Runs events.',
    mission: 'Keep the live game fresh.', knowledge: ['Event calendars', 'Cohorts', 'Featuring'], pointOfView: ['Cut scope first.', 'No Friday releases.'],
    voice: 'Numbers first.', boundaries: 'Defers legal.', skills: ['core.scope', 'core.risk'], optionalSkills: ['core.extra'],
    starters: ['a', 'b', 'c'], hue: 'sky', traits: { warmDirect: 50, playfulSerious: 50, conciseExpansive: 50 }, keywords: ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'],
  };
  const catalog: Catalog = { version: 'fixture', packs: [], roles: [role], skills: [skill('core.scope', 'Scope trade-off'), skill('core.risk', 'Release risk'), skill('core.extra', 'Extra skill')] };

  it('renders the role with its default skills, or exactly the skills the agent carries', () => {
    const byDefault = agentToPersona(agent({ persona: personaSpec({ roleId: role.id }) }), 'o', { catalog });
    expect(byDefault.craft).toContain('Your role: Live-ops Producer.');
    expect(byDefault.craft).toContain('<skill name="Scope trade-off">');
    expect(byDefault.craft).toContain('<skill name="Release risk">');
    const chosen = agentToPersona(agent({ persona: personaSpec({ roleId: role.id, skillIds: ['core.extra', 'core.gone', 'core.extra'] }) }), 'o', { catalog });
    expect(chosen.craft).toContain('<skill name="Extra skill">');
    expect(chosen.craft).not.toContain('Scope trade-off');
    expect(chosen.craft!.match(/<skill /g)).toHaveLength(1);
    expect(agentCraft({ roleId: role.id, skillIds: [] }, catalog)).not.toContain('<skill');
  });

  it('custom agents get no craft; character and voice examples always pass through', () => {
    const custom = agentToPersona(agent({ persona: personaSpec({ voiceExamples: [{ user: 'hi', reply: 'Morning. What are we shipping?' }], opinions: ['Ship small.'] }) }), 'o', { catalog });
    expect(custom.craft).toBeUndefined();
    expect(custom.character).toContain('Views you hold: Ship small.');
    expect(custom.voiceExamples).toEqual([{ user: 'hi', reply: 'Morning. What are we shipping?' }]);
    expect(agentToPersona(agent({ persona: personaSpec({ roleId: 'tech.unknown' }) }), 'o', { catalog }).craft).toBeUndefined();
    expect(studioToOrgConfig(state(), 'HOOR', { catalog }).personas[0].character).toContain('Personality: Curious and candid');
  });
});
