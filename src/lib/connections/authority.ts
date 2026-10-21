import type { Studio } from '../studio/service';
import { canUseAgent } from '../studio/permissions';
import { containerIdFor, digest, spaceIdFor, tenantIdFor } from '../adaptive/persistence/repository';
import type { ConnectionActor, ConnectionContext, SpaceKind } from './contracts';
import { deny } from './errors';
import { assertCurrentBotPerson } from './bot-principal';

/** Resolve again for each boundary. An administrator's role never selects another
 * person's account or establishes provider authority. Wider group audiences need
 * their own reviewed resolver and are deliberately absent from this private API. */
/** Synchronous final fence for the FILE/committed transport used by bot-owned effects.
 * Legacy async-only manager facades retain their pre-existing path; they do not qualify bot self-service. */
export function assertStudioConnectionAuthorityCurrent(studio: Studio, actor: ConnectionActor, context: ConnectionContext, now = Date.now()): void {
  const current = studio.deps.store.readCommittedForEffect?.();
  if (!current && actor.botAgentId) return deny('connection_authority_transport_unavailable', 503);
  if (current) {
    const telegramId = Number(actor.accountId.slice('telegram-account:'.length));
    if (actor.botAgentId) assertCurrentBotPerson(current, actor);
    else {
      const member = current.members.find(row => row.telegramId === telegramId);
      if (!member || member.role === 'pending') return deny('approval_required');
      const agents = current.agents.filter(agent => canUseAgent(member, agent) && !(agent.blocked ?? []).includes(telegramId)).map(agent => agent.id);
      if (JSON.stringify([...agents].sort()) !== JSON.stringify([...context.currentAgentIds].sort())) return deny('agent_authority_changed');
    }
  }
  const adaptive = studio.deps.adaptive;
  if (!adaptive) return deny('identity_unavailable', 503);
  const committed = adaptive.repository.readCommittedForEffect(actor.accountId, now);
  if (committed.status !== 'ready') { if (actor.botAgentId) return deny('connection_authority_transport_unavailable', 503); return; }
  const document = committed.document, binding = document?.binding;
  if (!document || !binding || !adaptive.isProfileConfirmed(document, now) || binding.expiresAt <= now || document.personId !== context.personId ||
      binding.id !== context.bindingId || binding.revision !== context.bindingRevision || binding.expiresAt !== context.bindingExpiresAt ||
      digest([document.personId, binding.id, binding.revision]) !== context.scope.audienceRevision) return deny('profile_confirmation_required');
}
export function createStudioConnectionAuthority(studio: Studio, now: () => number = Date.now) {
  return async (actor: ConnectionActor, space: SpaceKind): Promise<ConnectionContext> => {
    const match = /^telegram-account:([1-9]\d{0,15})$/.exec(actor.accountId);
    const telegramId = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(telegramId) || !['work', 'personal'].includes(space)) return deny('authentication_required', 401);
    const state = await studio.deps.store.read();
    const member = state.members.find(row => row.telegramId === telegramId);
    if (actor.botAgentId) assertCurrentBotPerson(state, actor);
    else if (actor.botAuthenticationRevision || !member || member.role === 'pending') return deny('approval_required');
    const adaptive = studio.deps.adaptive;
    if (!adaptive) return deny('identity_unavailable', 503);
    const timestamp = now();
    const context: ConnectionContext = await adaptive.repository.transaction(actor.accountId, timestamp, document => {
      const binding = document.binding;
      if (!binding) return deny('profile_confirmation_required');
      if (!adaptive.isProfileConfirmed(document, timestamp) || binding.expiresAt <= timestamp) return deny('profile_confirmation_required');
      return {
        accountId: actor.accountId, personId: document.personId, bindingId: binding.id,
        bindingRevision: binding.revision, bindingExpiresAt: binding.expiresAt,
        scope: { tenantId: tenantIdFor(actor.accountId), spaceId: spaceIdFor(actor.accountId, space), spaceKind: space,
          containerId: containerIdFor(actor.accountId, space), audiencePersonIds: [document.personId],
          audienceRevision: digest([document.personId, binding.id, binding.revision]) },
        ...(actor.botAgentId ? { botAgentId: actor.botAgentId, botAuthenticationRevision: actor.botAuthenticationRevision } : {}),
        currentAgentIds: actor.botAgentId ? [actor.botAgentId] : state.agents.filter(agent => canUseAgent(member, agent) && !(agent.blocked ?? []).includes(telegramId)).map(agent => agent.id),
      };
    });
    assertStudioConnectionAuthorityCurrent(studio, actor, context, now());
    return context;
  };
}
