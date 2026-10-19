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
  const p = agent.persona;
  return {
    strangerPolicy: [p.withStrangers, p.openness !== undefined ? `Openness to strangers: ${p.openness}/100.` : ''].filter(Boolean).join(' ') || undefined,
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
  const members = new Set(people.map((p) => p.id));
  // Outsiders (guests of public agents or group chats, and people still
  // waiting for approval) are people too, flagged so they only ever see their
  // own private memories and their groups' memories.
  const outsiders = [
    ...(state.guests ?? []).map((g) => ({ id: g.telegramId, name: g.name })),
    ...state.members.filter((m) => m.role === 'pending').map((m) => ({ id: m.telegramId, name: m.name })),
  ];
  for (const o of outsiders) {
    if (members.has(personId(o.id)) || people.some((p) => p.id === personId(o.id))) continue;
    people.push({ id: personId(o.id), name: o.name, role: 'Guest', telegramUserId: o.id, companyIds: [], projectIds: [], guest: true });
  }
  const known = new Set(people.map((p) => p.id));
  const fallbackOwner = approved.find((m) => m.role === 'owner') ?? approved.find((m) => m.role === 'superadmin');

  const personas: Persona[] = state.agents
    .filter((a) => a.status === 'active' && a.bot)
    .map((a) => {
      const owner = members.has(personId(a.createdBy)) ? personId(a.createdBy) : fallbackOwner ? personId(fallbackOwner.telegramId) : '';
      return agentToPersona(a, owner);
    });

  const groups: Group[] = state.groups.map((g: StudioGroup) => ({
    id: groupId(g.chatId),
    name: g.title,
    telegramChatId: g.chatId,
    memberIds: g.memberIds.map(personId).filter((id) => known.has(id)),
    // Anyone reading who isn't an approved member makes it a guest group:
    // only the group's own memories are safe there.
    hasGuests: g.hasGuests || g.memberIds.some((id) => !members.has(personId(id))),
    audienceEpoch: g.audienceEpoch ?? 0,
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
