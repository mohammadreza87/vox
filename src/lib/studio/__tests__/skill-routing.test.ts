/**
 * Per-message skill selection end to end (docs/SKILL_ROUTING.md): studio
 * agent → runtime persona with a skill set → triage with the `skill`
 * question → the reply prompt in routed or unrouted mode.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeLLM } from '../../tireh/__tests__/fixtures';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { NO_SKILL, SANDBOX_SKILL_TIMEOUT_MS, SKILL_QUESTION } from '../../tireh/skill-routing';
import { MAX_TRIAGE_QUESTIONS, type DecisionAnswer, type DecisionQuestion } from '../../tireh/triage';
import { personId } from '../org-bridge';
import { renderSkill } from '../skills/render';
import { FIXTURE_MODULES, fixtureCatalog, fixtureSkill } from '../skills/__tests__/fixtures';
import type { Catalog } from '../skills/catalog';
import type { GroupBehavior } from '../types';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg, type Harness } from './helpers';

const PINNED = 'care.crisis-protocol';
const ROUTABLE = ['ua.campaign-plan', 'ua.creative-testing', 'ua.roas-model'];
const catalog: Catalog = fixtureCatalog([...FIXTURE_MODULES, { roles: [], skills: [
  fixtureSkill(PINNED, 'Crisis protocol', 'Meets risk with care and local help.', { pinned: true, whenToUse: 'Use when any message suggests risk to someone.' }),
] }]);
const playbook = (id: string) => renderSkill(catalog.skills.find((s) => s.id === id)!);
const tag = (id: string) => `<skill name="${catalog.skills.find((s) => s.id === id)!.title}">`;
const BLOCK = '<active_skill>\n';
const SECRET_TEXT = 'SYNTHETIC_PRIVATE_MESSAGE_77';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;
let updateId = 1;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
  h.studio.deps.catalog = catalog;
});

const dm = (from: number, text: string): TelegramUpdate => ({
  update_id: updateId++,
  message: { message_id: updateId, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: from, type: 'private' }, date: 0, text },
});
const inGroup = (from: number, text: string): TelegramUpdate => ({
  update_id: updateId++,
  message: { message_id: updateId, from: { id: from, is_bot: false, first_name: 'X' }, chat: { id: -700, type: 'supergroup', title: 'Team' }, date: 0, text },
});

type Answers = Record<string, DecisionAnswer>;
const answers = (skill?: DecisionAnswer, extra: Answers = {}, effort: 'quick' | 'thoughtful' = 'thoughtful'): Answers => ({
  effort: { type: 'choice', choice: effort, confidence: 0.9 },
  live_info: { type: 'predicate', probability: 0.05 },
  memorable: { type: 'predicate', probability: 0.05 },
  wants_voice: { type: 'predicate', probability: 0 },
  ...(skill ? { [SKILL_QUESTION]: skill } : {}),
  ...extra,
});
const pick = (choice: string, confidence = 0.8): DecisionAnswer => ({ type: 'choice', choice, confidence });

function decider(result: Answers | Error) {
  const decide = vi.fn<(input: string, questions: DecisionQuestion[], timeoutMs?: number) => Promise<Answers>>(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  h.studio.deps.decider = { decide };
  return decide;
}

async function growthAgent(groupBehavior?: GroupBehavior) {
  const hired = await hire(h, org.alice, { name: 'Nova', role: 'UA Manager' });
  await h.store.update((s) => {
    const a = s.agents.find((x) => x.id === hired.agent.id)!;
    a.persona.roleId = 'mobile.ua-manager';
    a.persona.skillIds = [...ROUTABLE, PINNED];
    if (groupBehavior) a.groupBehavior = groupBehavior;
    s.groups.push({ chatId: -700, title: 'Team', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [hired.agent.id], addedBy: ID.alice, addedAt: '' });
  });
  return hired;
}

const skillLogs = () => h.logger.info.mock.calls.map(([event]) => event as Record<string, unknown>).filter((e) => e?.stage === 'skill_select');
const skillQuestionOf = (decide: ReturnType<typeof decider>, call = 0) => decide.mock.calls[call][1].find((q) => q.name === SKILL_QUESTION);

function expectRouted(prompt: string, active: string[]) {
  expect(prompt).toContain('- Campaign plan — Use when');
  expect(prompt).toContain('- Creative testing — Use when');
  expect(prompt).toContain(playbook(PINNED));
  for (const id of ROUTABLE) expect(prompt.includes(playbook(id)), id).toBe(active.includes(id));
  if (active.length) expect(prompt).toContain(`${BLOCK}${active.map(playbook).join('\n\n')}\n</active_skill>`);
  else expect(prompt).not.toContain(BLOCK);
  // The chosen playbook sits after the cached prefix, never inside it.
  const prefix = prompt.slice(0, prompt.indexOf('</rules>'));
  for (const id of ROUTABLE) expect(prefix).not.toContain(tag(id));
}

function expectUnrouted(prompt: string) {
  for (const id of [...ROUTABLE, PINNED]) expect(prompt).toContain(playbook(id));
  expect(prompt).not.toContain(BLOCK);
  expect(prompt).not.toContain('- Campaign plan — ');
}

function expectContentFree() {
  const logged = JSON.stringify([...h.logger.info.mock.calls, ...h.logger.warn.mock.calls, ...h.logger.error.mock.calls]);
  for (const forbidden of [SECRET_TEXT, ...ROUTABLE, PINNED, 'Creative testing', 'Campaign plan']) expect(logged).not.toContain(forbidden);
  for (const event of skillLogs()) expect(Object.keys(event).sort()).toEqual(['outcome', 'reason', 'stage', 'type']);
}

describe('routed replies', () => {
  it('a confident pick loads that playbook only, beside the index and the pinned playbook', async () => {
    const { agent, bot } = await growthAgent();
    const decide = decider(answers(pick('ua.creative-testing')));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, `Which ads should we scale? ${SECRET_TEXT}`));
    expect(bot().sendMessage).toHaveBeenCalledWith(ID.bob, 'Sure.', expect.anything());
    expectRouted(h.chatLLM.lastPrompt, ['ua.creative-testing']);
    const question = skillQuestionOf(decide);
    if (question?.type !== 'choice') throw new Error('skill choice expected');
    // Pinned safety playbooks are never offered to Decisions.
    expect(question.choices.map((c) => c.value)).toEqual([...ROUTABLE, NO_SKILL]);
    expect(decide.mock.calls[0][1].length).toBeLessThanOrEqual(5);
    expect(skillLogs()).toEqual([{ type: 'telegram_ingress', stage: 'skill_select', reason: 'selected', outcome: 'routed' }]);
    expectContentFree();
  });

  it('a torn answer loads the runner-up too', async () => {
    const { agent } = await growthAgent();
    decider(answers({ type: 'choice', choice: 'ua.roas-model', confidence: 0.5, probabilities: [
      { value: 'ua.roas-model', probability: 0.5 }, { value: 'ua.campaign-plan', probability: 0.35 }, { value: NO_SKILL, probability: 0.15 },
    ] }));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'Will this cohort pay back before launch?'));
    expectRouted(h.chatLLM.lastPrompt, ['ua.roas-model', 'ua.campaign-plan']);
  });

  it('none loads no playbook but keeps the routed prefix', async () => {
    const { agent } = await growthAgent();
    decider(answers(pick(NO_SKILL, 0.9)));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'thanks!'));
    expectRouted(h.chatLLM.lastPrompt, []);
    expect(skillLogs()).toEqual([expect.objectContaining({ reason: 'none', outcome: 'routed' })]);
  });

  it('the quick path on the fast model is routed the same way', async () => {
    const { agent } = await growthAgent();
    const fast = new FakeLLM();
    h.studio.deps.fastLLM = fast;
    decider(answers(pick('ua.campaign-plan'), {}, 'quick'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'Quick one: which channel first?'));
    expect(h.chatLLM.replyPrompts).toHaveLength(0);
    expectRouted(fast.lastPrompt, ['ua.campaign-plan']);
  });

  it('the routed stable prefix is identical whichever playbook is active', async () => {
    const { agent } = await growthAgent();
    const prefixes: string[] = [];
    for (const answer of [pick('ua.campaign-plan'), pick('ua.roas-model'), pick(NO_SKILL, 0.9)]) {
      decider(answers(answer));
      await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'Next question'));
      prefixes.push(h.chatLLM.lastPrompt.slice(0, h.chatLLM.lastPrompt.indexOf('</rules>')));
    }
    expect(new Set(prefixes).size).toBe(1);
  });
});

describe('unrouted replies keep the full craft', () => {
  it('when Decisions fails', async () => {
    const { agent, bot } = await growthAgent();
    decider(new Error(SECRET_TEXT));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, `Plan the launch ${SECRET_TEXT}`));
    expect(bot().sendMessage).toHaveBeenCalledWith(ID.bob, 'Sure.', expect.anything());
    expectUnrouted(h.chatLLM.lastPrompt);
    expect(skillLogs()).toEqual([expect.objectContaining({ reason: 'no_answer', outcome: 'full_craft' })]);
    expectContentFree();
  });

  it('when the skill answer is missing, malformed or unsure, without losing the rest of triage', async () => {
    const { agent } = await growthAgent();
    const fast = new FakeLLM();
    h.studio.deps.fastLLM = fast;
    decider(answers(undefined, {}, 'quick'));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'hi'));
    // Triage still routed the reply to the fast model.
    expectUnrouted(fast.lastPrompt);
    decider(answers({ type: 'choice', choice: 'ua.made-up', confidence: 0.99 }));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'hi again'));
    expectUnrouted(h.chatLLM.lastPrompt);
    decider(answers(pick('ua.campaign-plan', 0.3)));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'and again'));
    expectUnrouted(h.chatLLM.lastPrompt);
    expect(skillLogs().map((e) => e.reason)).toEqual(['no_answer', 'no_answer', 'low_confidence']);
  });

  it('agents with fewer than two routable skills are never asked', async () => {
    const { agent } = await growthAgent();
    await h.store.update((s) => { s.agents.find((x) => x.id === agent.id)!.persona.skillIds = ['ua.campaign-plan', PINNED]; });
    const decide = decider(answers(pick('ua.campaign-plan')));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'Plan the launch'));
    expect(skillQuestionOf(decide)).toBeUndefined();
    expect(h.chatLLM.lastPrompt).toContain(playbook('ua.campaign-plan'));
    expect(h.chatLLM.lastPrompt).not.toContain(BLOCK);
    expect(skillLogs()).toEqual([]);
  });

  it('personal (lifestyle) roles and custom agents are never asked and keep the full craft', async () => {
    const { agent } = await growthAgent();
    const lifestyle = ['run.training-plan', 'run.injury-prevention', 'core.weekly-review'];
    for (const persona of [{ roleId: 'lifestyle.running-coach', skillIds: lifestyle }, { roleId: undefined, skillIds: [...ROUTABLE, PINNED] }]) {
      await h.store.update((s) => { Object.assign(s.agents.find((x) => x.id === agent.id)!.persona, persona); });
      h.chatLLM.replyPrompts.length = 0;
      const decide = decider(answers(pick(persona.skillIds[0])));
      await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'I feel anxious about my knee, what should I run this week?'));
      expect(skillQuestionOf(decide)).toBeUndefined();
      for (const id of persona.skillIds) expect(h.chatLLM.lastPrompt).toContain(playbook(id));
      expect(h.chatLLM.lastPrompt).not.toContain(BLOCK);
      const preview = decider({ [SKILL_QUESTION]: pick(persona.skillIds[0]) });
      await h.studio.testChat(org.alice, agent.id, [{ role: 'user', content: 'Plan my week' }]);
      expect(preview).not.toHaveBeenCalled();
    }
    expect(skillLogs()).toEqual([]);
  });

  it('Mini App call turns are never triaged or routed', async () => {
    const { agent } = await growthAgent();
    const decide = decider(answers(pick('ua.campaign-plan')));
    const { gateway, state } = await h.studio.gateway();
    expect(state.agents.some((a) => a.id === agent.id)).toBe(true);
    await gateway.converse(agent.id, personId(ID.bob), 'Plan the launch');
    expect(decide).not.toHaveBeenCalled();
    expectUnrouted(h.chatLLM.lastPrompt);
    expect(skillLogs()).toEqual([]);
  });
});

describe('groups', () => {
  it('an unaddressed message that may get a reply asks at most 7 questions and routes the reply', async () => {
    const { agent, bot } = await growthAgent({ participation: 'active', remember: true });
    const decide = decider(answers(pick('ua.creative-testing'), { addressed: { type: 'predicate', probability: 0.95 }, proactive: { type: 'predicate', probability: 0.1 } }));
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.bob, 'Can someone tell me which ads to scale?'));
    const names = decide.mock.calls[0][1].map((q) => q.name);
    expect(names).toEqual(['effort', 'live_info', 'memorable', 'wants_voice', 'addressed', 'proactive', SKILL_QUESTION]);
    expect(names.length).toBeLessThanOrEqual(MAX_TRIAGE_QUESTIONS);
    expect(bot().sendMessage).toHaveBeenCalledWith(-700, 'Sure.', expect.anything());
    expectRouted(h.chatLLM.lastPrompt, ['ua.creative-testing']);
  });

  it('a proactive contribution is routed too', async () => {
    const { agent, bot } = await growthAgent({ participation: 'active', remember: true });
    decider(answers(pick('ua.campaign-plan'), { addressed: { type: 'predicate', probability: 0.1 }, proactive: { type: 'predicate', probability: 0.95 } }));
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.bob, 'We are opening Brazil next month, no plan yet.'));
    expect(bot().sendMessage).toHaveBeenCalledWith(-700, 'Sure.', expect.anything());
    expect(h.chatLLM.lastPrompt).toContain('joining a group conversation selectively');
    expectRouted(h.chatLLM.lastPrompt, ['ua.campaign-plan']);
  });

  it('a named message asks the skill question; an unaddressed one that cannot get a reply does not', async () => {
    const { agent } = await growthAgent({ participation: 'mentions', remember: true });
    const decide = decider(answers(pick('ua.campaign-plan')));
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.bob, 'Nova, plan the Brazil launch'));
    expect(decide.mock.calls[0][1].map((q) => q.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice', SKILL_QUESTION]);
    expectRouted(h.chatLLM.lastPrompt, ['ua.campaign-plan']);
    await handleAgentUpdate(h.studio, agent.id, inGroup(ID.alice, 'Bob, lunch?'));
    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1][1].map((q) => q.name)).not.toContain(SKILL_QUESTION);
  });
});

describe('STUDIO_SKILL_ROUTING', () => {
  it('shadow asks and logs the outcome, but replies keep the full craft', async () => {
    const { agent } = await growthAgent();
    h.studio.deps.skillRouting = 'shadow';
    const decide = decider(answers(pick('ua.creative-testing')));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, `Which ads should we scale? ${SECRET_TEXT}`));
    expect(skillQuestionOf(decide)).toBeDefined();
    expectUnrouted(h.chatLLM.lastPrompt);
    decider(answers(pick(NO_SKILL, 0.9)));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'thanks'));
    expectUnrouted(h.chatLLM.lastPrompt);
    expect(skillLogs()).toEqual([
      { type: 'telegram_ingress', stage: 'skill_select', reason: 'selected', outcome: 'shadow_full_craft' },
      { type: 'telegram_ingress', stage: 'skill_select', reason: 'none', outcome: 'shadow_full_craft' },
    ]);
    expectContentFree();
  });

  it('off never asks', async () => {
    const { agent } = await growthAgent();
    h.studio.deps.skillRouting = 'off';
    const decide = decider(answers(pick('ua.creative-testing')));
    await handleAgentUpdate(h.studio, agent.id, dm(ID.bob, 'Which ads should we scale?'));
    expect(decide).toHaveBeenCalledTimes(1);
    expect(skillQuestionOf(decide)).toBeUndefined();
    expectUnrouted(h.chatLLM.lastPrompt);
    expect(skillLogs()).toEqual([]);
  });
});

describe('sandbox chat', () => {
  it('asks only the skill question and routes on a pick', async () => {
    const { agent } = await growthAgent();
    const decide = decider({ [SKILL_QUESTION]: pick('ua.roas-model') });
    await h.studio.testChat(org.alice, agent.id, [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hey.' }, { role: 'user', content: 'Will this cohort pay back?' }]);
    expect(decide).toHaveBeenCalledTimes(1);
    const [input, questions, timeout] = decide.mock.calls[0];
    expect(questions.map((q) => q.name)).toEqual([SKILL_QUESTION]);
    expect(timeout).toBe(SANDBOX_SKILL_TIMEOUT_MS);
    expect(SANDBOX_SKILL_TIMEOUT_MS).toBeLessThanOrEqual(800);
    expect(input).toContain('Alice: Will this cohort pay back?');
    expect(input).toContain('Nova: Hey.');
    expectRouted(h.chatLLM.lastPrompt, ['ua.roas-model']);
    expect(h.chatLLM.lastPrompt).toContain('private preview');
  });

  it('falls back to the full craft on failure, an unsure answer, or when routing is not on', async () => {
    const { agent } = await growthAgent();
    const messages = [{ role: 'user' as const, content: 'Plan the launch' }];
    decider(new Error('down'));
    expect(await h.studio.testChat(org.alice, agent.id, messages)).toBe('Sure.');
    expectUnrouted(h.chatLLM.lastPrompt);
    decider({ [SKILL_QUESTION]: pick('ua.campaign-plan', 0.2) });
    await h.studio.testChat(org.alice, agent.id, messages);
    expectUnrouted(h.chatLLM.lastPrompt);
    decider(null as unknown as Answers);
    await h.studio.testChat(org.alice, agent.id, messages);
    expectUnrouted(h.chatLLM.lastPrompt);
    for (const mode of ['shadow', 'off'] as const) {
      h.studio.deps.skillRouting = mode;
      const decide = decider({ [SKILL_QUESTION]: pick('ua.campaign-plan') });
      await h.studio.testChat(org.alice, agent.id, messages);
      expect(decide).not.toHaveBeenCalled();
      expectUnrouted(h.chatLLM.lastPrompt);
    }
  });
});
