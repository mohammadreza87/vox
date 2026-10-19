import { z } from 'zod';
import { digest } from '../adaptive/persistence/repository';
import { PreferenceLearningService } from '../adaptive/personalization/learning/service';
import { canUseAgent } from './permissions';
import type { Studio } from './service';
const authorityRevision = z.number().int().nonnegative().safe().optional();
const number = z.number().int().positive().safe();
const memberSchema = z.object({ learningAuthorityRevision: authorityRevision, telegramId: number, role: z.enum(['pending', 'member', 'admin', 'superadmin', 'owner']) }).passthrough();
const agentSchema = z.object({ learningAuthorityRevision: authorityRevision, id: z.string(), status: z.enum(['draft', 'awaiting_bot', 'active', 'fired']), createdBy: number,
  visibility: z.enum(['private', 'org', 'public']).optional(), access: z.union([z.literal('everyone'), z.array(number)]), blocked: z.array(number).optional() }).passthrough();
export function createStudioPreferenceLearning(studio: Studio): PreferenceLearningService {
  if (!studio.deps.adaptive) throw new Error('adaptive_required');
  const agentAuthorityNow = (telegramId: number, agentId: string) => {
      const state = studio.deps.store.readCommittedForEffect?.();
      if (!state) return null;
      const members = state.members.filter(m => m.telegramId === telegramId), agents = state.agents.filter(a => a.id === agentId);
      const member = members[0], agent = agents[0];
      if (members.length !== 1 || agents.length !== 1 || !memberSchema.safeParse(member).success || !agentSchema.safeParse(agent).success ||
          !canUseAgent(member, agent) || (agent.blocked ?? []).includes(telegramId)) return null;
      return digest([member.telegramId, member.role, agent.id, agent.status, agent.createdBy, agent.visibility, agent.access, agent.blocked, member.learningAuthorityRevision ?? 0, agent.learningAuthorityRevision ?? 0]);
    };
  const service = new PreferenceLearningService(studio.deps.adaptive, { secret: studio.deps.secret, decisions: studio.deps.experience?.learningDecisions,
    now: () => studio.deps.now?.().getTime() ?? Date.now(), agentAuthorityNow });
  studio.deps.adaptive.setPreferenceLearningAuthority(agentAuthorityNow);
  studio.deps.adaptive.setPreferenceLearningInvalidator(id => service.tasks.cancel(id));
  return service;
}
