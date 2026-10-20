/**
 * Surfaces that must stay unrouted (docs/SKILL_ROUTING.md): indexed/compact
 * turns, live calls and Mini App call turns get the full craft, are never
 * asked the skill question, and log no skill diagnostic.
 */
import { describe, expect, it, vi } from 'vitest';
import { PersonaGateway, type RuntimePrivacy } from '../gateway';
import { InMemoryChatHistoryStore, InMemoryMemoryStore, InMemoryShareOfferStore, InMemoryUpdateDeduper } from '../memory/store';
import { OrgDirectory } from '../org/directory';
import { SKILL_QUESTION } from '../skill-routing';
import type { TelegramBotClient } from '../telegram/client';
import type { DecisionAnswer, DecisionQuestion } from '../triage';
import type { Persona, PersonaSkillSet } from '../types';
import { FakeLLM, fakeBot, privateText, TG, testOrgConfig } from './fixtures';

const PLAYBOOKS = { a: '<skill name="Alpha">ALPHA_PLAYBOOK</skill>', b: '<skill name="Beta">BETA_PLAYBOOK</skill>', p: '<skill name="Pinned">PINNED_PLAYBOOK</skill>' };
const skillSet: PersonaSkillSet = {
  role: 'Your role: Growth Lead.',
  pinned: [{ id: 'care.pinned', playbook: PLAYBOOKS.p }],
  routable: [
    { id: 'x.alpha', title: 'Alpha', whenToUse: 'Use when alpha work is asked for.', playbook: PLAYBOOKS.a },
    { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.', playbook: PLAYBOOKS.b },
  ],
};
const craft = `Your role: Growth Lead.\n\nSkills you practise.\n\n${PLAYBOOKS.a}\n\n${PLAYBOOKS.b}\n\n${PLAYBOOKS.p}`;

function compactPrivacy(): RuntimePrivacy {
  const authority = () => ({ revision: 'scope-v1', memoryEnabled: false, historyEnabled: false });
  return {
    legacyStores: 'unavailable', read: async () => ({ ...authority(), context: [] }), readAuthority: async () => authority(),
    finalReadNow: () => ({ ...authority(), validUntil: Number.MAX_SAFE_INTEGER }), validateAudience: async () => true, validateAudienceNow: () => true,
  };
}

function setup(runtimePrivacy?: RuntimePrivacy) {
  const config = testOrgConfig();
  config.personas = config.personas.map((p): Persona => p.id === 'aria' ? { ...p, craft, skillSet } : p);
  const org = new OrgDirectory(config);
  const llm = new FakeLLM();
  Object.defineProperty(llm, 'committedExportFence', { value: true });
  const bot = Object.assign(fakeBot(), { committedSendFence: true });
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const decide = vi.fn<(input: string, questions: DecisionQuestion[], timeoutMs?: number) => Promise<Record<string, DecisionAnswer>>>(async () => ({
    effort: { type: 'choice', choice: 'thoughtful', confidence: 0.9 }, live_info: { type: 'predicate', probability: 0 },
    memorable: { type: 'predicate', probability: 0 }, wants_voice: { type: 'predicate', probability: 0 },
    [SKILL_QUESTION]: { type: 'choice', choice: 'x.alpha', confidence: 0.9 },
  }));
  const epochs = new Map<string, number>();
  const gateway = new PersonaGateway({
    org, llm, memories: new InMemoryMemoryStore(epochs), offers: new InMemoryShareOfferStore(), history: new InMemoryChatHistoryStore(epochs),
    deduper: new InMemoryUpdateDeduper(), voice: null, botFor: () => bot as unknown as TelegramBotClient, logger,
    decider: { decide }, now: () => new Date('2026-10-19T10:00:00Z'), ...(runtimePrivacy ? { runtimePrivacy } : {}),
  });
  const skillLogs = () => logger.info.mock.calls.filter(([e]) => (e as { stage?: string })?.stage === 'skill_select');
  return { gateway, llm, decide, skillLogs };
}

const expectFullCraft = (prompt: string) => {
  for (const playbook of Object.values(PLAYBOOKS)) expect(prompt).toContain(playbook);
  expect(prompt).not.toContain('<active_skill>');
};

describe('skill routing stays off the unrouted surfaces', () => {
  it('routes an ordinary Telegram turn (control)', async () => {
    const h = setup();
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'Do the alpha work'))).toBe('replied');
    expect(h.decide.mock.calls[0][1].map((q) => q.name)).toContain(SKILL_QUESTION);
    expect(h.llm.lastPrompt).toContain(`<active_skill>\n${PLAYBOOKS.a}\n</active_skill>`);
    expect(h.llm.lastPrompt).not.toContain(PLAYBOOKS.b);
    expect(h.skillLogs()).toHaveLength(1);
  });

  it('indexed (compact) Telegram turns skip triage and keep the full craft', async () => {
    const h = setup(compactPrivacy());
    await h.gateway.handleUpdate('aria', privateText(TG.reza, 'Do the alpha work'));
    expect(h.llm.replyPrompts).toHaveLength(1);
    expect(h.decide).not.toHaveBeenCalled();
    expectFullCraft(h.llm.lastPrompt);
    expect(h.skillLogs()).toEqual([]);
  });

  it('live calls keep the full craft', async () => {
    for (const privacy of [undefined, compactPrivacy()]) {
      const h = setup(privacy);
      const parts: string[] = [];
      for await (const part of h.gateway.liveTurn('aria', 'reza', [{ role: 'user', content: 'Do the alpha work' }])) parts.push(part);
      expect(parts.join('')).toBe('Sure.');
      expect(h.decide).not.toHaveBeenCalled();
      expectFullCraft(h.llm.lastPrompt);
      expect(h.llm.lastPrompt).toContain('## Live voice call');
      expect(h.skillLogs()).toEqual([]);
    }
  });

  it('Mini App call turns keep the full craft', async () => {
    const h = setup();
    expect(await h.gateway.converse('aria', 'reza', 'Do the alpha work')).toBe('Sure.');
    expect(h.decide).not.toHaveBeenCalled();
    expectFullCraft(h.llm.lastPrompt);
    expect(h.skillLogs()).toEqual([]);
  });
});
