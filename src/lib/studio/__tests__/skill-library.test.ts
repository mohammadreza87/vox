import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecisionAnswer, DecisionQuestion } from '../../tireh/triage';
import { StudioError } from '../service';
import { fixtureCatalog } from '../skills/__tests__/fixtures';
import { MAX_AGENT_SKILLS } from '../skills/types';
import type { PersonaSpec, SpawnBrief } from '../types';
import { draftJson, hire, makeStudio, personaSpec, seedOrg, type Harness } from './helpers';
import { expectContentFreeTelegramLogs } from '@/test/telegram-diagnostics';

let h: Harness;
let org: Awaited<ReturnType<typeof seedOrg>>;

beforeEach(async () => {
  h = makeStudio();
  org = await seedOrg(h);
  h.studio.deps.catalog = fixtureCatalog();
});

async function expectStudioError(p: Promise<unknown>, status: number, message?: RegExp) {
  const error = await p.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(StudioError);
  expect((error as StudioError).status).toBe(status);
  if (message) expect((error as StudioError).message).toMatch(message);
}

async function draft(brief: SpawnBrief, persona: Partial<PersonaSpec> = {}) {
  h.personaLLM.push(draftJson(persona));
  return (await h.studio.draft(org.alice, brief)).agent;
}

const UA_DEFAULTS = ['ua.campaign-plan', 'ua.creative-testing', 'ua.roas-model', 'core.weekly-review'];

describe('drafting from the library', () => {
  it('stores the role, its default skills and its cloud colour, with one Claude call', async () => {
    const agent = await draft({ description: 'Runs paid UA for our launch', roleId: 'mobile.ua-manager', routing: { source: 'local', confidence: 0.8 } });
    expect(agent.persona.roleId).toBe('mobile.ua-manager');
    expect(agent.persona.skillIds).toEqual(UA_DEFAULTS);
    expect(agent.look.hue).toBe('lagoon'); // draftJson's look says sky
    expect(h.personaLLM.requests).toHaveLength(1);
    // The persona prompt sees the role title when the creator wrote no role.
    expect(h.personaLLM.requests[0].messages.at(-1)?.content).toContain('Role: UA Manager');
  });

  it('keeps a role the creator wrote', async () => {
    await draft({ roleId: 'mobile.ua-manager', role: 'Growth lead for Turkey' });
    const prompt = String(h.personaLLM.requests[0].messages.at(-1)?.content);
    expect(prompt).toContain('Role: Growth lead for Turkey');
    expect(prompt).not.toContain('Role: UA Manager');
  });

  it('keeps known skills in order, drops unknown and repeated ones, and caps the list', async () => {
    const agent = await draft({ roleId: 'mobile.ua-manager', skillIds: ['ua.geo-launch', 'nope.missing', 'ua.geo-launch', 'core.goal-setting'] });
    expect(agent.persona.skillIds).toEqual(['ua.geo-launch', 'core.goal-setting']);
    const many = await draft({ roleId: 'mobile.ua-manager', skillIds: [...fixtureCatalog().skills.map((s) => s.id)] });
    expect(many.persona.skillIds).toHaveLength(MAX_AGENT_SKILLS);
    // The creator turned every skill off.
    expect((await draft({ roleId: 'mobile.ua-manager', skillIds: [] })).persona.skillIds).toEqual([]);
  });

  it('allows skills on a custom agent and keeps custom agents free of library fields', async () => {
    const skilled = await draft({ skillIds: ['core.decision-memo'] });
    expect(skilled.persona.skillIds).toEqual(['core.decision-memo']);
    expect(skilled.persona.roleId).toBeUndefined();
    expect(skilled.look.hue).toBe('sky');
    const plain = await draft({});
    expect('roleId' in plain.persona).toBe(false);
    expect('skillIds' in plain.persona).toBe(false);
  });

  it('never takes library ids from Claude', async () => {
    const agent = await draft({}, { roleId: 'tech.product-manager', skillIds: ['pm.prd'] });
    expect(agent.persona.roleId).toBeUndefined();
    expect(agent.persona.skillIds).toBeUndefined();
  });

  it('refuses unknown roles and malformed skill lists before calling Claude', async () => {
    await expectStudioError(h.studio.draft(org.alice, { roleId: 'tech.nope' }), 400, /Unknown role/);
    await expectStudioError(h.studio.draft(org.alice, { roleId: 42 as never }), 400, /Unknown role/);
    await expectStudioError(h.studio.draft(org.alice, { skillIds: 'pm.prd' as never }), 400, /Skills must be a list/);
    expect(h.personaLLM.requests).toHaveLength(0);
    await expectStudioError(h.studio.draft(org.pending, { roleId: 'mobile.ua-manager' }), 403);
  });
});

describe('refine and hand edits', () => {
  it('refine keeps the role, skills and voice examples Claude does not return', async () => {
    const agent = await draft({ roleId: 'mobile.ua-manager' });
    const voiceExamples = [{ user: 'How is the launch going?', reply: 'Payback is on day 9. We scale Turkey next.' }];
    await h.store.update((s) => { s.agents.find((a) => a.id === agent.id)!.persona.voiceExamples = voiceExamples; });
    h.personaLLM.push(JSON.stringify(personaSpec({ personality: 'Sharper' })));
    const refined = await h.studio.refine(org.alice, agent.id, 'more direct');
    expect(refined.persona).toMatchObject({ personality: 'Sharper', roleId: 'mobile.ua-manager', skillIds: UA_DEFAULTS, voiceExamples });
    expect((await h.studio.getAgent(org.alice, agent.id)).persona.roleId).toBe('mobile.ua-manager');
  });

  it('refine leaves custom agents without library ids', async () => {
    const agent = await draft({});
    h.personaLLM.push(JSON.stringify(personaSpec({ personality: 'Sharper' })));
    const refined = await h.studio.refine(org.alice, agent.id, 'more direct');
    expect('roleId' in refined.persona).toBe(false);
    expect('skillIds' in refined.persona).toBe(false);
  });

  it('hand edits keep working on library agents and must name known skills and roles', async () => {
    const agent = await draft({ roleId: 'mobile.ua-manager' });
    expect((await h.studio.updatePersona(org.alice, agent.id, { tagline: 'Pays back by day 9' })).persona).toMatchObject({
      tagline: 'Pays back by day 9', roleId: 'mobile.ua-manager', skillIds: UA_DEFAULTS,
    });
    const updated = await h.studio.updatePersona(org.alice, agent.id, { skillIds: ['ua.geo-launch', 'core.decision-memo'] });
    expect(updated.persona.skillIds).toEqual(['ua.geo-launch', 'core.decision-memo']);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { skillIds: ['ua.geo-launch', 'nope.missing'] }), 400, /Unknown or repeated skill/);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { skillIds: ['ua.geo-launch', 'ua.geo-launch'] }), 400, /Unknown or repeated skill/);
    const nine = fixtureCatalog().skills.slice(0, MAX_AGENT_SKILLS + 1).map((s) => s.id);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { skillIds: nine }), 400);
    await expectStudioError(h.studio.updatePersona(org.alice, agent.id, { roleId: 'tech.nope' }), 400, /Unknown role/);
    expect((await h.studio.getAgent(org.alice, agent.id)).persona.skillIds).toEqual(['ua.geo-launch', 'core.decision-memo']);
  });
});

describe('routing and the catalog', () => {
  type Answers = Record<string, DecisionAnswer>;

  it('serves the injected catalog to members only', async () => {
    const view = h.studio.catalogView(org.alice);
    expect(view.version).toBe(h.studio.deps.catalog!.version);
    expect(view.roles.map((r) => r.id)).toContain('mobile.ua-manager');
    expect(() => h.studio.catalogView(org.pending)).toThrow(StudioError);
  });

  it('routes locally for members while typing, and refuses pending members', async () => {
    const decide = vi.fn<(input: string, questions: DecisionQuestion[], timeoutMs?: number) => Promise<Answers>>(async () => ({}));
    h.studio.deps.decider = { decide };
    const r = await h.studio.routeBrief(org.alice, { text: 'A running coach who keeps me honest', final: false });
    expect(r).toMatchObject({ roleId: 'lifestyle.running-coach', source: 'local' });
    expect(decide).not.toHaveBeenCalled();
    await expectStudioError(h.studio.routeBrief(org.pending, { text: 'A running coach' }), 403);
  });

  it('uses Decisions on submit', async () => {
    h.studio.deps.decider = { decide: vi.fn(async () => ({
      pack: { type: 'choice', choice: 'mobile', confidence: 0.95 }, role_mobile: { type: 'choice', choice: 'mobile.ua-manager', confidence: 0.9 },
    }) as Answers) };
    expect(await h.studio.routeBrief(org.alice, { text: 'Someone to run UA for our puzzle game launch', final: true })).toMatchObject({
      roleId: 'mobile.ua-manager', source: 'decisions',
    });
  });

  it.each([
    ['failed', new Error('CANARY_PRIVATE_TRANSCRIPT_021 provider body'), 'operation_failed'],
    ['refused', null, 'no_answer'],
  ] as const)('logs a %s Decisions request content-free and still answers locally', async (_, error, reason) => {
    h.studio.deps.decider = { decide: vi.fn(async () => { if (error) throw error; return {}; }) };
    const text = 'CANARY_PRIVATE_TRANSCRIPT_021 wants a running coach';
    const r = await h.studio.routeBrief(org.alice, { text, final: true });
    expect(r.source).toBe('local');
    expect(h.logger.warn).toHaveBeenCalledWith({ type: 'telegram_ingress', stage: 'skill_route', reason, outcome: 'local_fallback' });
    expectContentFreeTelegramLogs([...h.logger.warn.mock.calls, ...h.logger.error.mock.calls, ...h.logger.info.mock.calls], [text, 'running coach']);
  });
});

describe('successor template', () => {
  it('is allowed exactly when draft() accepts the predecessor, and carries only name, role and skills', async () => {
    const pred = await draft({ roleId: 'mobile.ua-manager', skillIds: ['ua.campaign-plan', 'ua.roas-model'] }, { name: 'Aria' });
    await h.store.update((st) => { const a = st.agents.find((x) => x.id === pred.id)!; a.status = 'fired'; a.firedAt = new Date().toISOString(); });
    const { agent: active } = await hire(h, org.alice);

    // Bob is a member who cannot see the fired agent itself.
    await expectStudioError(h.studio.getAgent(org.bob, pred.id), 404);
    expect(await h.studio.successorTemplate(org.bob, pred.id)).toStrictEqual({ name: 'Aria', roleId: 'mobile.ua-manager', skillIds: ['ua.campaign-plan', 'ua.roas-model'] });
    h.personaLLM.push(draftJson());
    expect((await h.studio.draft(org.bob, {}, pred.id)).agent.successorOf).toBe(pred.id);

    for (const id of [active.id, 'agnope']) {
      await expectStudioError(h.studio.successorTemplate(org.bob, id), 404, /Predecessor not found/);
      await expectStudioError(h.studio.draft(org.bob, {}, id), 404, /Predecessor not found/);
    }
    await expectStudioError(h.studio.successorTemplate(org.pending, pred.id), 403);
    await expectStudioError(h.studio.draft(org.pending, {}, pred.id), 403);
  });
});
