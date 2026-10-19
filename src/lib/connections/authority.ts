import type { Studio } from '../studio/service';
import { canUseAgent } from '../studio/permissions';
import { containerIdFor, digest, spaceIdFor, tenantIdFor } from '../adaptive/persistence/repository';
import type { ConnectionActor, ConnectionContext, SpaceKind } from './contracts';
import { deny } from './errors';

/** Resolve again for each boundary. An administrator's role never selects another
 * person's account or establishes provider authority. Wider group audiences need
 * their own reviewed resolver and are deliberately absent from this private API. */
export function createStudioConnectionAuthority(studio: Studio, now: () => number = Date.now) {
  return async (actor: ConnectionActor, space: SpaceKind): Promise<ConnectionContext> => {
    const match = /^telegram-account:([1-9]\d{0,15})$/.exec(actor.accountId);
    const telegramId = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(telegramId) || !['work', 'personal'].includes(space)) return deny('authentication_required', 401);
    const state = await studio.deps.store.read();
    const member = state.members.find(row => row.telegramId === telegramId);
    if (!member || member.role === 'pending') return deny('approval_required');
    const adaptive = studio.deps.adaptive;
    if (!adaptive) return deny('identity_unavailable', 503);
    const timestamp = now();
    return adaptive.repository.transaction(actor.accountId, timestamp, document => {
      const binding = document.binding;
      if (!binding) return deny('profile_confirmation_required');
      if (!adaptive.isProfileConfirmed(document, timestamp) || binding.expiresAt <= timestamp) return deny('profile_confirmation_required');
      return {
        accountId: actor.accountId, personId: document.personId, bindingId: binding.id,
        bindingRevision: binding.revision, bindingExpiresAt: binding.expiresAt,
        scope: { tenantId: tenantIdFor(actor.accountId), spaceId: spaceIdFor(actor.accountId, space), spaceKind: space,
          containerId: containerIdFor(actor.accountId, space), audiencePersonIds: [document.personId],
          audienceRevision: digest([document.personId, binding.id, binding.revision]) },
        currentAgentIds: state.agents.filter(agent => canUseAgent(member, agent) && !(agent.blocked ?? []).includes(telegramId)).map(agent => agent.id),
      };
    });
  };
}
