import { scopedRelationshipKeySchema } from '../adaptive/relationships/contracts';
import type { Intention, DrainReport } from '../relationships';
import { relationshipId } from '../relationships';
import { composeFollowUp } from '../relationships/compose';
import { buildSystemPrompt } from '../tireh/conversation/prompt';
import { agentToPersona, personId, studioToOrg } from './org-bridge';
import { canUseAgent } from './permissions';
import type { Studio } from './service';

const emptyReport = (): DrainReport => ({ claimed: 0, sent: 0, deferred: 0, closed: 0, suppressed: 0, failed: 0, shadow: 0 });

/** Details are committed to the authenticated inbox. A separately authorized
 * external alert carries no relationship content and is never blindly retried. */
export async function drainScopedRelationships(studio: Studio, limit: number): Promise<DrainReport> {
  const { relationships: loop, relationshipAuthority: authority } = studio.deps;
  if (!loop || !authority || !studio.deps.adaptive) return emptyReport();
  const snapshots = new Map<string, { revision: string; fingerprint: string; persona: string; system: string }>();

  const recipient = (job: Intention) => {
    const parsed = scopedRelationshipKeySchema.safeParse(job.key);
    if (!parsed.success) return null;
    const match = /^telegram-account:([1-9]\d{0,15})$/.exec(parsed.data.scope.accountId);
    const telegramId = match ? Number(match[1]) : NaN;
    return Number.isSafeInteger(telegramId) && telegramId > 0 ? { telegramId, space: parsed.data.scope.space } : null;
  };
  const currentTarget = async (job: Intention) => {
    const target = recipient(job);
    if (!target || loop.mode !== 'live' || !await studio.relationshipCohortEnabled(job.key.personaId, target.telegramId)) return null;
    const state = await studio.deps.store.read();
    const agent = state.agents.find(a => a.id === job.key.personaId);
    const member = state.members.find(m => m.telegramId === target.telegramId);
    if (!agent || agent.status !== 'active' || !member || !['owner', 'superadmin'].includes(member.role) ||
        !canUseAgent(member, agent) || (agent.blocked ?? []).includes(target.telegramId)) return null;
    return { ...target, state, agent, member };
  };
  const personaRevision = (target: NonNullable<Awaited<ReturnType<typeof currentTarget>>>) => JSON.stringify([target.agent.persona, target.agent.identityVersion]);
  const authorize = async (job: Intention): Promise<boolean> => {
    const target = await currentTarget(job);
    if (!target) return false;
    const snapshot = snapshots.get(job.id);
    const permit = await authority.authorize(job.key, job.sourceIds, 'inbox', snapshot?.fingerprint ?? job.authorizationFingerprint);
    if (!permit) return false;
    if (snapshot) {
      const privacy = await studio.adaptiveContext(job.key.personaId, personId(target.telegramId), target.space);
      if (privacy.revision !== snapshot.revision || personaRevision(target) !== snapshot.persona) return false;
    }
    return true;
  };
  const priorPrivateTelegram = async (job: Intention, telegramId: number, token: string) => authority.adaptive.withAccountDocument(telegramId, (document, now) =>
    document.relationships.sources.some(source => source.channel === 'telegram' && source.status === 'active' && source.createdAt <= now &&
      source.endpointId === studio.relationshipEndpointId(token) &&
      source.expiresAt > now && job.sourceIds.includes(source.id) && relationshipId(source.key) === relationshipId(job.key)));

  return loop.drain({ limit, authorize,
    loadContext: async job => {
      const target = await currentTarget(job);
      if (!target) throw new Error('Relationship recipient unavailable');
      const permit = await authority.authorize(job.key, job.sourceIds, 'inbox', job.authorizationFingerprint);
      if (!permit) throw new Error('Relationship authority changed');
      const privacy = await studio.adaptiveContext(job.key.personaId, personId(target.telegramId), target.space);
      // Build the persona prompt from the current identity and this recipient
      // only. Neither the legacy history nor the wider directory is retrieved.
      const org = studioToOrg({ ...target.state, members: [target.member], agents: [target.agent], groups: [], guests: [] }, studio.deps.orgName, { webSearch: false, groupObservation: false });
      const persona = agentToPersona(target.agent, personId(target.member.telegramId), { webSearch: false, groupObservation: false });
      const system = buildSystemPrompt({ org, persona, chat: { kind: 'private', chatKey: job.key.chatKey, personId: personId(target.telegramId) },
        speakerId: personId(target.telegramId), memories: [], space: target.space, now: studio.deps.now?.() ?? new Date(), canFollowUp: true, followUpChannel: 'inbox' });
      snapshots.set(job.id, { revision: privacy.revision, fingerprint: permit.fingerprint, persona: personaRevision(target), system });
      // The loop supplies source-tracked context to both providers. Flattened
      // private/shared context has no persisted lineage for inbox revocation.
      return JSON.stringify({ agent: system });
    },
    compose: async (job, context) => {
      if (!await authorize(job)) throw new Error('Relationship context changed');
      const snapshot = snapshots.get(job.id)!;
      return composeFollowUp({ complete: request => studio.deps.chatLLM.complete({ ...request, system: `${request.system}\n\n${snapshot.system}` }) }, job.purpose, context, job.timing);
    },
    send: async (job, text, signal) => {
      if (signal?.aborted || !await authorize(job) || !await loop.mayDeliver(job) || !await authorize(job) || signal?.aborted) throw new Error('Relationship changed before publication');
      const snapshot = snapshots.get(job.id)!;
      const published = await authority.publish(job.key, job.id, text, job.sourceIds, snapshot.fingerprint);
      if (!published) throw new Error('Relationship publication denied');
      // Publication has succeeded. Optional alert failures must never turn the
      // detailed inbox side effect into a retry or duplicate delivery.
      if (published.external && !signal?.aborted) {
        let reservationId: string | undefined;
        let attempted = false;
        try {
          const target = await currentTarget(job);
          const token = target && studio.botToken(target.agent);
          if (!target || !token || !await priorPrivateTelegram(job, target.telegramId, token)) return published.id;
          const reservation = await authority.reserveExternal(job.key, published.id, snapshot.fingerprint);
          if (!reservation) return published.id;
          reservationId = reservation.reservationId;
          const fresh = await currentTarget(job);
          if (signal?.aborted || !fresh || studio.botToken(fresh.agent) !== token || !await priorPrivateTelegram(job, fresh.telegramId, token) ||
              !await loop.mayDeliver(job) || !await authority.maySendExternal(job.key, published.id, reservationId) || signal?.aborted) {
            await authority.recordExternal(job.key, published.id, reservationId, 'cancelled');
            return published.id;
          }
          const bot = studio.deps.botFor(token);
          attempted = true;
          const result = await bot.sendMessage(fresh.telegramId, reservation.text, { signal });
          await authority.recordExternal(job.key, published.id, reservationId, 'accepted', String(result.message_id));
        } catch {
          if (reservationId) await authority.recordExternal(job.key, published.id, reservationId, attempted ? 'unknown' : 'cancelled').catch(() => undefined);
        }
      }
      return published.id;
    },
  });
}
