import type { RelationshipMode } from '../relationships/types';

export interface RelationshipConfig {
  mode: RelationshipMode;
  agentIds: string[];
  personIds: string[];
  roles?: Array<'owner' | 'superadmin'>;
}

export function relationshipConfig(env: NodeJS.ProcessEnv): RelationshipConfig {
  const mode = env.STUDIO_RELATIONSHIPS?.trim() || 'off';
  if (!['off', 'shadow', 'live'].includes(mode)) throw new Error('STUDIO_RELATIONSHIPS must be off, shadow or live');
  const split = (raw?: string) => [...new Set((raw ?? '').split(/[,\s]+/).filter(Boolean))];
  const agentIds = split(env.STUDIO_RELATIONSHIP_AGENTS);
  const people = split(env.STUDIO_RELATIONSHIP_PEOPLE);
  const roles = split(env.STUDIO_RELATIONSHIP_ROLES);
  if (roles.some((role) => role !== 'owner' && role !== 'superadmin')) throw new Error('STUDIO_RELATIONSHIP_ROLES permits only owner and superadmin');
  if (agentIds.includes('*') && (!roles.length || agentIds.length !== 1)) throw new Error('Wildcard agents require privileged relationship roles and no other agent IDs');
  if (people.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new Error('STUDIO_RELATIONSHIP_PEOPLE must contain positive Telegram user IDs');
  if (mode !== 'off') {
    if (!env.OPENAI_API_KEY?.trim()) throw new Error('OPENAI_API_KEY is required for relationship decisions');
    if (!agentIds.length || (!people.length && !roles.length)) throw new Error('Relationship evaluation requires explicit agent and person allowlists');
    if (env.STUDIO_PUBLIC_URL && (!env.STUDIO_RELATIONSHIP_WORKER_SECRET || env.STUDIO_RELATIONSHIP_WORKER_SECRET.length < 32)) throw new Error('Webhook relationship evaluation requires STUDIO_RELATIONSHIP_WORKER_SECRET (32+ chars)');
  }
  return { mode: mode as RelationshipMode, agentIds, personIds: people.map((id) => `tg-${id}`), ...(roles.length ? { roles: roles as RelationshipConfig['roles'] } : {}) };
}
