/**
 * Circles S4 (GROUP_AGENTS_SPEC R2 decision 5, F4): each person opens their own pet over the group. pet-http
 * authenticates (the agent's own token, or the manager's for a launch whose code names this agent) and calls in
 * here; everything below is per request and re-checked:
 *  - A code (`p_<agent short>_<joinCode>`, or a bare join code from the DM button) is unverified intent: it must
 *    name a group this agent is in, and the person must be a present member (getChatMember) before the group's
 *    title, counts or card are shown. A short for another agent names nothing here.
 *  - A decision goes through the group card's own path (circle-groups decide → settle): the same checks, the same
 *    ledger state and copyHash, surface mini_app; a withdrawal is invalidated before the response.
 *  - Leave withdraws whatever the flag (it only stops use); notes are the requester's own copies only.
 * Errors are circle_* codes the pet shows in place; they never end the pet session.
 */

import { randomUUID } from 'crypto';
import { agentShortCode, JOIN_CODE, parsePetLaunch, sameShort } from '../circles/codec';
import { activeAgents, activeJoin, CircleService, groupIdOf, joinedOf } from '../circles/service';
import type { CircleDecision, PetCircle, PetNote } from '../circles/contracts';
import { groupCard } from '../circles/notice';
import type { Studio } from './service';
import type { Agent, StudioGroup, StudioState } from './types';

export type CirclePetCode = 'circle_unavailable' | 'circle_not_member' | 'circle_full' | 'circle_stale' | 'circle_failed';
const STATUS: Record<CirclePetCode, number> = { circle_unavailable: 404, circle_not_member: 403, circle_full: 409, circle_stale: 409, circle_failed: 503 };

const REFUSED: Partial<Record<string, CirclePetCode>> = { stale: 'circle_stale', early: 'circle_stale', full: 'circle_full', limit: 'circle_full', not_member: 'circle_not_member' };

export class CirclePetError extends Error {
  readonly status: number;
  constructor(readonly code: CirclePetCode) { super(code); this.name = 'CirclePetError'; this.status = STATUS[code]; }
  /** By shape, not instanceof (route bundles carry their own class copies). */
  static is(error: unknown): error is CirclePetError { return (error as { name?: unknown } | null)?.name === 'CirclePetError' && (error as { code: string }).code in STATUS; }
}
function refuse(code: CirclePetCode): never { throw new CirclePetError(code); }

/** The group a launch code (or a bare join code) names with this agent in it; null for anything else. */
export function groupForCode(studio: Studio, state: StudioState, agent: Agent, code?: string | null): StudioGroup | null {
  if (!code) return null;
  const launch = parsePetLaunch(code);
  const joinCode = launch ? (sameShort(launch.short, agentShortCode(studio.deps.secret, agent.id)) ? launch.joinCode : null) : JOIN_CODE.test(code) ? code : null;
  return joinCode ? state.groups.find((g) => g.joinCode === joinCode && g.agentIds.includes(agent.id)) ?? null : null;
}

function botOf(studio: Studio, agent: Agent) {
  const token = studio.botToken(agent);
  if (!token) refuse('circle_unavailable');
  return studio.deps.botFor(token);
}

/** The open circle this agent is in, while Circles is on for the chat. */
async function circleOf(studio: Studio, agent: Agent, group: StudioGroup | null) {
  if (!group || !studio.circleGroups.on(group.chatId)) refuse('circle_unavailable');
  const doc = await studio.deps.circleLedger!.get(group.chatId).catch(() => null);
  if (!doc || doc.status !== 'active' || !doc.card || !activeAgents(doc).includes(agent.id)) refuse('circle_unavailable');
  return { doc, card: doc.card, group, chatId: group.chatId };
}

/**
 * GET circle: only a present member learns anything about the group. `launched`: the Mini App's own bot is the manager
 * (route b), not this agent's, so its write access would never let this agent's bot send the 📌 copies: the pet
 * offers this agent's DM instead (`dm`).
 */
export async function circleView(studio: Studio, agent: Agent, telegramId: number, group: StudioGroup | null, launched = false): Promise<PetCircle> {
  const first = await circleOf(studio, agent, group), { chatId, group: g } = first;
  let { doc, card } = first;
  const bot = botOf(studio, agent);
  if (!await studio.circleGroups.present(bot, chatId, telegramId)) refuse('circle_not_member');
  const at = studio.deps.now?.() ?? new Date();
  const me0 = doc.participants.find((p) => p.telegramId === telegramId);
  let members: string[] | undefined;
  if (me0 && activeJoin(me0, at)) {
    // Named only while Telegram says they are still here; anyone it says left is marked left first (as refresh does).
    const seen = await studio.circleGroups.presentNames(bot, chatId, joinedOf(doc, at).filter((p) => p.telegramId !== telegramId).map((p) => p.telegramId));
    members = seen.names;
    if (seen.gone.length) ({ doc, card } = await circleOf(studio, agent, group));
  }
  const shown = CircleService.cardShown(doc, at);
  const names = (await studio.circleGroups.agents(card.agentIds)).map((a) => a.persona.name);
  // The card's own copy: its notice and labels (the details label only when the card carries the link), so the sheet shows what copyHash covers.
  const copy = groupCard(names, card.locale, shown, !!g.joinCode);
  const me = doc.participants.find((p) => p.telegramId === telegramId);
  return {
    chatTitle: g.title, agents: names, joined: shown.joined, total: shown.total, on: shown.on, myState: me?.state ?? null, ...(members ? { members } : {}),
    ...(launched && agent.bot ? { dm: { bot: agent.bot.username, name: agent.persona.name } } : {}),
    card: { copy: { notice: copy.notice, join: copy.labels.join, reply: copy.labels.reply, decline: copy.labels.decline }, copyHash: card.copyHash, revision: card.id, locale: card.locale },
  };
}

/**
 * POST circle/decision: the group card's path with surface mini_app; answered with the circle as it now stands. A
 * Join covers the card's agents, so someone any of them blocked is refused here (the group card, tapped through the
 * card owner's own bot, checks that owner), whichever agent's pet asks.
 */
export async function circleDecision(studio: Studio, agent: Agent, telegramId: number, group: StudioGroup | null, input: { choice: CircleDecision; revision: string; eventId?: string }, launched = false): Promise<PetCircle> {
  const { chatId, card } = await circleOf(studio, agent, group);
  if ((await studio.circleGroups.agents(card.agentIds)).some((a) => (a.blocked ?? []).includes(telegramId))) refuse('circle_unavailable');
  const bot = botOf(studio, agent), eventId = `pet:${input.eventId ?? randomUUID()}`;
  const decided = await studio.circleGroups.decide(agent, bot, chatId, telegramId, input.choice, input.revision, eventId, 'mini_app');
  if (!decided.ok) refuse(REFUSED[decided.reason] ?? 'circle_unavailable');
  await studio.circleGroups.settle(chatId, telegramId, input.choice, decided, eventId, 'mini_app');
  return circleView(studio, agent, telegramId, group, launched);
}

/** POST circle/leave: out of this group's notes (nothing erased), committed and invalidated before the answer. */
export async function circleLeave(studio: Studio, agent: Agent, telegramId: number, group: StudioGroup | null): Promise<{ left: boolean }> {
  if (!group || !studio.deps.circleLedger) refuse('circle_unavailable');
  const result = await studio.circleGroups.leave(group.chatId, telegramId, `pet-leave:${randomUUID()}`);
  return { left: result.changed };
}

/** GET notes: the requester's own copies this agent may use; "From this group" only for a group the code names. */
export async function circleNotes(studio: Studio, agent: Agent, telegramId: number, group: StudioGroup | null): Promise<{ mine: PetNote[]; group: PetNote[] }> {
  const notes = await studio.circleNotes.petNotes(agent.id, telegramId, group ? groupIdOf(group.chatId) : undefined);
  if (!notes) refuse('circle_unavailable');
  return notes;
}
