import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramUpdate } from '../../tireh/telegram/client';
import { NO_SKILL, SKILL_QUESTION } from '../../tireh/skill-routing';
import type { DecisionAnswer, DecisionQuestion } from '../../tireh/triage';
import { CATALOG } from '../skills/catalog';
import { renderSkill, renderSkillSet, routableSkillsFor } from '../skills/render';
import { handleAgentUpdate } from '../updates';
import { hire, ID, makeStudio, seedOrg } from './helpers';

// Regression for valid persisted combinations outside a role's recommendations.
// Real catalog IDs bind the reported safety regression; all services are fakes.
const HEALTH = ['fitness.readiness-screen', 'fitness.program-design'];
const MOOD = ['wellbeing.grounding-practice', 'wellbeing.reframe-journal'];
const role = CATALOG.roles.find((r) => r.id === 'tech.cto')!;
const skills = (ids: string[]) => ids.map((id) => {
  const skill = CATALOG.skills.find((s) => s.id === id);
  if (!skill) throw new Error(`Missing regression skill: ${id}`);
  return skill;
});
const pick = (choice: string): DecisionAnswer => ({ type: 'choice', choice, confidence: 0.99 });
const selections: Array<[string, DecisionAnswer]> = [
  ['selected', pick(HEALTH[1])],
  ['none', pick(NO_SKILL)],
  ['runner-up', {
    ...pick(HEALTH[1]),
    probabilities: [
      { value: HEALTH[1], probability: 0.6 },
      { value: HEALTH[0], probability: 0.4 },
    ],
  } as DecisionAnswer],
];

afterEach(() => vi.unstubAllGlobals());

describe('routing eligibility of custom skill combinations', () => {
  it('keeps the entire set unrouted when any unpinned skill is outside the work role list', () => {
    for (const ids of [HEALTH, MOOD, [role.skills[0], role.skills[1], HEALTH[0]]]) {
      expect(routableSkillsFor(role, skills(ids))).toEqual([]);
      expect(renderSkillSet(role, skills(ids))).toBeUndefined();
    }
    // Check before the display cap too: an unreviewed stored combination must
    // not become eligible just because its last attachment is out of view.
    expect(renderSkillSet(role, [...skills(role.skills), ...skills(role.skills), ...skills(HEALTH)])).toBeUndefined();
  });

  it('preserves routing for every recommended work skill, including optional skills beyond the display cap', () => {
    for (const work of CATALOG.roles.filter((r) => r.space === 'work')) {
      const approved = [...new Set([...work.skills, ...work.optionalSkills])];
      for (const id of approved) {
        const skill = skills([id])[0];
        expect(routableSkillsFor(work, [skill]).map((s) => s.id), `${work.id}: ${id}`)
          .toEqual(skill.pinned ? [] : [id]);
      }
    }
  });

  it('keeps pinned safety from outside the role list in full without offering it as a choice', () => {
    const pinned = { ...skills([HEALTH[0]])[0], pinned: true as const };
    const attached = [...skills(role.skills.slice(0, 2)), pinned];
    const set = renderSkillSet(role, attached);
    expect(set).toBeDefined();
    expect(set!.pinned).toContainEqual({ id: pinned.id, playbook: renderSkill(pinned) });
    expect(set!.routable.map((s) => s.id)).not.toContain(pinned.id);
  });
});

for (const [surface, text] of [
  ['private', 'Please help plan my next week.'],
  ['group', 'Nova، لطفاً برای هفته بعد کمکم کن.'],
] as const) {
  describe(`${surface} mixed-skill replies`, () => {
    it.each(selections)('ignores a %s answer and keeps the readiness screen', async (_label, selection) => {
      vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this synthetic test'); }));
      const h = makeStudio();
      const org = await seedOrg(h);
      h.studio.deps.catalog = CATALOG;
      const { agent, bot } = await hire(h, org.alice, { name: 'Nova', role: 'CTO' });
      // Exercise the supported edit API; this is not an invalid-state injection.
      await h.studio.updatePersona(org.alice, agent.id, { roleId: role.id, skillIds: HEALTH });
      await h.store.update((s) => {
        s.groups.push({ chatId: -700, title: 'Team', memberIds: [ID.alice, ID.bob], hasGuests: false, agentIds: [agent.id], addedBy: ID.alice, addedAt: '' });
      });
      const decide = vi.fn<(input: string, questions: DecisionQuestion[]) => Promise<Record<string, DecisionAnswer>>>(async () => ({
        effort: pick('thoughtful'),
        live_info: { type: 'predicate', probability: 0 },
        memorable: { type: 'predicate', probability: 0 },
        wants_voice: { type: 'predicate', probability: 0 },
        addressed: { type: 'predicate', probability: 1 },
        proactive: { type: 'predicate', probability: 0 },
        [SKILL_QUESTION]: selection,
      }));
      h.studio.deps.decider = { decide };
      const chatId = surface === 'private' ? ID.bob : -700;
      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1, from: { id: ID.bob, is_bot: false, first_name: 'Bob' },
          chat: { id: chatId, type: surface === 'private' ? 'private' : 'supergroup' },
          date: 0, text,
        },
      };
      await handleAgentUpdate(h.studio, agent.id, update);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(decide.mock.calls[0][1].map((q) => q.name)).not.toContain(SKILL_QUESTION);
      expect(bot().sendMessage).toHaveBeenCalledWith(chatId, 'Sure.', expect.anything());
      for (const skill of skills(HEALTH)) expect(h.chatLLM.lastPrompt).toContain(renderSkill(skill));
      expect(h.chatLLM.lastPrompt).toContain('PAR-Q');
      expect(h.chatLLM.lastPrompt).not.toContain('<active_skill>');
      expect(fetch).not.toHaveBeenCalled();
    });
  });
}

it('does not send mixed mood/health preview text to the skill decider in any mode', async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this synthetic test'); }));
  const h = makeStudio();
  const org = await seedOrg(h);
  h.studio.deps.catalog = CATALOG;
  const { agent } = await hire(h, org.alice, { name: 'Nova', role: 'CTO' });
  const decide = vi.fn(async (): Promise<Record<string, DecisionAnswer>> => ({ [SKILL_QUESTION]: pick(NO_SKILL) }));
  h.studio.deps.decider = { decide };
  for (const ids of [HEALTH, MOOD]) {
    await h.studio.updatePersona(org.alice, agent.id, { roleId: role.id, skillIds: ids });
    for (const mode of ['on', 'shadow', 'off'] as const) {
      h.studio.deps.skillRouting = mode;
      await h.studio.testChat(org.alice, agent.id, [{ role: 'user', content: 'برای هفته بعد کمکم کن.' }]);
      expect(decide).not.toHaveBeenCalled();
      for (const skill of skills(ids)) expect(h.chatLLM.lastPrompt).toContain(renderSkill(skill));
      expect(h.chatLLM.lastPrompt).not.toContain('<active_skill>');
    }
  }
  expect(fetch).not.toHaveBeenCalled();
});
