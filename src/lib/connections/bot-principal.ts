import type { Studio } from '../studio/service';
import type { Agent, StudioState } from '../studio/types';
import { canUseAgent, visibilityOf } from '../studio/permissions';
import type { InitDataUser } from '../studio/auth';
import { verifyAgentInitData } from '../studio/initdata-trust';
import { digest } from './repository';
import type { ConnectionActor } from './contracts';
import { deny } from './errors';

/** Server-only routing authority. Never read these fields from a browser body/header. */
export const botAuthenticationRevision = (agent: Agent): string => digest([agent.id, agent.bot?.id ?? null, agent.tokenEnc ?? null]);
export function assertCurrentBotPerson(state: StudioState, actor: ConnectionActor): Agent {
  const agent = state.agents.find(a => a.id === actor.botAgentId);
  const user = /^telegram-account:([1-9]\d{0,15})$/.exec(actor.accountId);
  const telegramId = user ? Number(user[1]) : NaN;
  if (!agent || agent.status !== 'active' || !agent.bot || !agent.tokenEnc || !Number.isSafeInteger(telegramId) ||
      !actor.botAuthenticationRevision || actor.botAuthenticationRevision !== botAuthenticationRevision(agent) ||
      (agent.blocked ?? []).includes(telegramId)) return deny('agent_unavailable');
  const member = state.members.find(m => m.telegramId === telegramId);
  if (!canUseAgent(member, agent) && visibilityOf(agent) !== 'public') return deny('agent_unavailable');
  return agent;
}
/**
 * Select exactly one bot by route, then authenticate its signature. No token search or fallback. The agent's creator
 * holds this bot's token, so Telegram's Ed25519 signature is required as well as the HMAC (never relaxed).
 */
export async function authenticateAgentConnections(studio: Studio, request: Request, agentId: string): Promise<{ actor: ConnectionActor; user: InitDataUser }> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(agentId)) return deny('agent_unavailable', 404);
  const init = request.headers.get('x-telegram-init-data') ?? '';
  if (!init || init.length > 16_384) return deny('authentication_required', 401);
  const state = await studio.deps.store.read();
  const agent = state.agents.find(a => a.id === agentId && a.status === 'active');
  const token = agent?.bot && agent.tokenEnc ? studio.botToken(agent) : null;
  if (!token) return deny('authentication_required', 401);
  const user = verifyAgentInitData(studio, init, { token: token!, botId: agent!.bot!.id }, 'connections');
  if (!user) return deny('authentication_required', 401);
  const actor: ConnectionActor = Object.freeze({ accountId: `telegram-account:${user.id}`, botAgentId: agentId,
    botAuthenticationRevision: botAuthenticationRevision(agent!) });
  assertCurrentBotPerson(await studio.deps.store.read(), actor);
  return { actor, user };
}
