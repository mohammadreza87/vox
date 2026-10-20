/**
 * Studio state → the persona runtime's organization model, rebuilt per update
 * so new members, agents and groups take effect immediately.
 */

import { OrgDirectory } from '../tireh/org/directory';
import type { Group, OrgConfig, Person, Persona, PersonaSkillSet } from '../tireh/types';
import { defaultVoiceId } from './media';
import { personaToRuntime } from './persona';
import { CATALOG, type Catalog } from './skills/catalog';
import { renderCraft, renderSkillSet } from './skills/render';
import type { AgentSkill } from './skills/types';
import type { Agent, Member, PersonaSpec, StudioGroup, StudioState } from './types';

export const personId = (telegramId: number) => `tg-${telegramId}`;
export const groupId = (chatId: number) => `chat-${Math.abs(chatId)}`;

const ROLE_LABEL: Record<Member['role'], string> = {
  owner: 'Owner', superadmin: 'Super Admin', admin: 'Admin', member: 'Member', pending: 'Pending',
};

export interface OrgOptions {
  /** The chat model can search the web (agents may still turn it off) */
  webSearch?: boolean;
  groupObservation?: boolean;
  /** The skill library roles and skills resolve against (default: the shipped CATALOG). */
  catalog?: Catalog;
}

/**
 * Rendered craft (and its routed split) per catalog, keyed by role and skill
 * ids: rebuilt orgs reuse the same strings. Bounded (least recently used out)
 * because every skill toggle creates a new combination.
 */
interface AgentRender { craft: string; skillSet?: PersonaSkillSet }
const craftCache = new WeakMap<Catalog, Map<string, AgentRender>>();
const CRAFT_CACHE_LIMIT = 256;
const NO_CRAFT: AgentRender = { craft: '' };

function agentRender(p: Pick<PersonaSpec, 'roleId' | 'skillIds'>, catalog: Catalog): AgentRender {
  if (!p.roleId && !p.skillIds?.length) return NO_CRAFT;
  const key = `${p.roleId ?? ''}|${(p.skillIds ?? []).join(',')}|${p.skillIds ? 'explicit' : 'default'}`;
  let cache = craftCache.get(catalog);
  if (!cache) craftCache.set(catalog, cache = new Map());
  const cached = cache.get(key);
  if (cached !== undefined) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const role = p.roleId ? catalog.roles.find((r) => r.id === p.roleId) : undefined;
  const ids = p.skillIds ?? role?.skills ?? [];
  const skills = [...new Set(ids)].map((id) => catalog.skills.find((s) => s.id === id)).filter((s): s is AgentSkill => Boolean(s));
  const skillSet = renderSkillSet(role, skills);
  const rendered: AgentRender = { craft: renderCraft(role, skills), ...(skillSet ? { skillSet } : {}) };
  cache.set(key, rendered);
  if (cache.size > CRAFT_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return rendered;
}

/**
 * The agent's role and skills as prompt text. No skill list means the role's
 * defaults; unknown ids (a catalog change since hiring) are skipped.
 */
export function agentCraft(p: Pick<PersonaSpec, 'roleId' | 'skillIds'>, catalog: Catalog = CATALOG): string {
  return agentRender(p, catalog).craft;
}

/** The same craft split for per-message skill selection; undefined below two routable skills. */
export function agentSkillSet(p: Pick<PersonaSpec, 'roleId' | 'skillIds'>, catalog: Catalog = CATALOG): PersonaSkillSet | undefined {
  return agentRender(p, catalog).skillSet;
}

export function agentToPersona(agent: Agent, ownerId: string, { webSearch = true, groupObservation = true, catalog }: OrgOptions = {}): Persona {
  const runtime = personaToRuntime(agent.persona);
  const p = agent.persona;
  const { craft, skillSet } = agentRender(p, catalog ?? CATALOG);
  return {
    strangerPolicy: [p.withStrangers, p.openness !== undefined ? `Openness to strangers: ${p.openness}/100.` : ''].filter(Boolean).join(' ') || undefined,
    id: agent.id,
    name: agent.persona.name,
    role: agent.persona.role,
    personality: runtime.personality,
    communicationStyle: runtime.communicationStyle,
    values: runtime.values,
    character: runtime.character,
    ...(runtime.voiceExamples.length ? { voiceExamples: runtime.voiceExamples } : {}),
    ...(craft ? { craft } : {}),
    ...(craft && skillSet ? { skillSet } : {}),
    voice: { elevenLabsVoiceId: agent.voice?.voiceId ?? defaultVoiceId(agent.persona.presentation), description: agent.persona.voiceBrief },
    ownerId,
    telegramUsername: agent.bot?.username,
    telegramId: agent.bot?.id,
    groupParticipation: agent.groupBehavior?.participation ?? 'balanced',
    groupRemember: agent.groupBehavior?.remember ?? true,
    groupObservation,
    identityVersion: agent.identityVersion,
    // Voice messages get voice replies; agents without a designed voice use a default one.
    replyWithVoice: 'mirror',
    webSearch: webSearch && agent.liveWeb !== false,
  };
}

export function studioToOrgConfig(state: StudioState, orgName = 'HOOR', options: OrgOptions = {}): OrgConfig {
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
      return agentToPersona(a, owner, options);
    });

  const groups: Group[] = state.groups.map((g: StudioGroup) => ({
    id: groupId(g.chatId),
    name: g.title,
    telegramChatId: g.chatId,
    agentIds: g.agentIds,
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

export function studioToOrg(state: StudioState, orgName?: string, options?: OrgOptions): OrgDirectory {
  return new OrgDirectory(studioToOrgConfig(state, orgName, options));
}
