/**
 * Studio state → the persona runtime's organization model, rebuilt per update
 * so new members, agents and groups take effect immediately.
 */

import { OrgDirectory } from '../tireh/org/directory';
import type { Group, OrgConfig, Person, Persona } from '../tireh/types';
import { personaToRuntime } from './persona';
import type { Agent, Member, StudioGroup, StudioState } from './types';

export const personId = (telegramId: number) => `tg-${telegramId}`;
export const groupId = (chatId: number) => `chat-${Math.abs(chatId)}`;

const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Owner', superadmin: 'Super Admin', admin: 'Admin', member: 'Member', pending: 'Pending',
};

export function agentToPersona(agent: Agent, ownerId: string): Persona {
  const runtime = personaToRuntime(agent.persona);
  return {
    id: agent.id,
    name: agent.persona.name,
    role: agent.persona.role,
    personality: runtime.personality,
    communicationStyle: runtime.communicationStyle,
    values: runtime.values,
    voice: { elevenLabsVoiceId: agent.voice?.voiceId ?? '', description: agent.persona.voiceBrief },
    ownerId,
    telegramUsername: agent.bot?.username,
    identityVersion: agent.identityVersion,
    replyWithVoice: agent.voice ? 'mirror' : 'never',
  };
}

export function studioToOrgConfig(state: StudioState, orgName = 'HOOR'): OrgConfig {
  const approved = state.members.filter((m) => m.role !== 'pending');
  const people: Person[] = approved.map((m) => ({
    id: personId(m.telegramId),
    name: m.name,
    role: ROLE_LABEL[m.role],
    telegramUserId: m.telegramId,
    companyIds: ['hoor'],
    projectIds: [],
  }));
  const known = new Set(people.map((p) => p.id));
  const fallbackOwner = approved.find((m) => m.role === 'owner') ?? approved.find((m) => m.role === 'superadmin');

  const personas: Persona[] = state.agents
    .filter((a) => a.status === 'active' && a.bot)
    .map((a) => {
      const owner = known.has(personId(a.createdBy)) ? personId(a.createdBy) : fallbackOwner ? personId(fallbackOwner.telegramId) : '';
      return agentToPersona(a, owner);
    });

  const groups: Group[] = state.groups.map((g: StudioGroup) => ({
    id: groupId(g.chatId),
    name: g.title,
    telegramChatId: g.chatId,
    memberIds: g.memberIds.map(personId).filter((id) => known.has(id)),
    // A known reader who is no longer approved (e.g. demoted to pending) still
    // reads the group but is not part of the audience: treat them as a guest.
    hasGuests: g.hasGuests || g.memberIds.some((id) => !known.has(personId(id))),
  }));

  return {
    organization: { id: 'hoor', name: orgName },
    people,
    relationships: [],
    companies: [{ id: 'hoor', name: orgName }],
    projects: [],
    groups,
    personas,
  };
}

export function studioToOrg(state: StudioState, orgName?: string): OrgDirectory {
  return new OrgDirectory(studioToOrgConfig(state, orgName));
}
