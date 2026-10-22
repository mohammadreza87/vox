/**
 * S09 (docs/implementation/agent-intelligence/S09-prepass-v2.md): versioned
 * triage question sets. The V1 GOLDEN block below was written and its inline
 * snapshots filled at the untouched base 6d00b80 (before any S09 source edit).
 * Never regenerate those snapshots: a diff there is a v1 drift.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';
import { MAX_TRIAGE_QUESTIONS, readTriage, readTriageV2, triageInput, triageQuestions, V2_LIVE_CORRECTION_PROBABILITY, V2_LIVE_SMALLTALK_CONFIDENCE, type DecisionAnswer } from '../triage';
import type { SkillChoice } from '../skill-routing';
import type { Persona } from '../types';
import { memory, privateText, TG, testOrgConfig } from './fixtures';
import { questionSchema, MAX_DECISION_QUESTIONS } from '../../adaptive/decisions';
import { PERSONA_HEADER_PREFIX, TRIAGE_V2_QUESTIONS, triageQuestionSetNow, V2_QUESTION_NAMES } from '../decisions/catalog';
import { decisionsGateway, v1Answers } from './decisions-fixtures';

const basePersona = (): Persona => testOrgConfig().personas.find((p) => p.id === 'aria')!;
const ROUTABLE: SkillChoice[] = [
  { id: 'x.alpha', title: 'Alpha', whenToUse: 'Use when alpha work is asked for.' },
  { id: 'x.beta', title: 'Beta', whenToUse: 'Use when beta work is asked for.' },
];
const LONG_PERSONALITY = Array.from({ length: 60 }, (_, i) => `trait${i} "q"`).join(', ');

/** The six golden question cases: [label, persona, askAddressed, routable]. */
function goldenCases(): Array<[string, Persona, boolean, SkillChoice[] | undefined]> {
  const p = basePersona();
  return [
    ['private', p, false, undefined],
    ['group mentions', p, true, undefined],
    ['group balanced', { ...p, groupParticipation: 'balanced' }, true, undefined],
    ['group active + skills', { ...p, groupParticipation: 'active' }, true, ROUTABLE],
    ['private + skills', p, false, ROUTABLE],
    ['long personality', { ...p, personality: LONG_PERSONALITY }, false, undefined],
  ];
}

const pred = (probability: number): DecisionAnswer => ({ type: 'predicate', probability });
const base4 = (effort: 'quick' | 'thoughtful', confidence: number): Record<string, DecisionAnswer> => ({
  effort: { type: 'choice', choice: effort, confidence }, live_info: pred(0.1), memorable: pred(0.1), wants_voice: pred(0.1),
});

/** The eight golden readTriage cases: [label, answers, askAddressed, participation, routable]. */
function readCases(): Array<[string, Record<string, DecisionAnswer>, boolean, 'mentions' | 'balanced' | 'active', SkillChoice[] | undefined]> {
  return [
    ['valid quick', base4('quick', 0.9), false, 'mentions', undefined],
    ['valid thoughtful', { ...base4('thoughtful', 0.8), live_info: pred(0.7), memorable: pred(0.5), wants_voice: pred(0.9) }, false, 'mentions', undefined],
    ['missing effort', { live_info: pred(0.1), memorable: pred(0.1), wants_voice: pred(0.1) }, false, 'mentions', undefined],
    ['bad predicate', { ...base4('quick', 0.9), live_info: pred(1.5) }, false, 'mentions', undefined],
    ['askAddressed', { ...base4('quick', 0.9), addressed: pred(0.9) }, true, 'mentions', undefined],
    ['proactive active', { ...base4('thoughtful', 0.7), addressed: pred(0.2), proactive: pred(0.85) }, true, 'active', undefined],
    ['skill pick', { ...base4('thoughtful', 0.9), skill: { type: 'choice', choice: 'x.alpha', confidence: 0.9, probabilities: [{ value: 'x.alpha', probability: 0.6 }, { value: 'x.beta', probability: 0.3 }, { value: 'none', probability: 0.1 }] } }, false, 'mentions', ROUTABLE],
    ['skill miss', { ...base4('thoughtful', 0.9), skill: { type: 'choice', choice: 'x.gamma', confidence: 0.9 } }, false, 'mentions', ROUTABLE],
  ];
}

const questionsJson = (i: number, ...extra: unknown[]) => {
  const [, persona, askAddressed, routable] = goldenCases()[i];
  return JSON.stringify((triageQuestions as (...args: unknown[]) => unknown)(persona, askAddressed, routable, ...extra));
};
const readOut = (i: number, ...extra: unknown[]) => {
  const [, answers, askAddressed, participation, routable] = readCases()[i];
  return (readTriage as (...args: unknown[]) => unknown)(answers, askAddressed, participation, routable, ...extra);
};

describe('V1 GOLDEN (captured at base 6d00b80; never regenerate)', () => {
  beforeEach(() => { vi.stubEnv('TRIAGE_QUESTION_SET', undefined); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('private', () => {
    expect(questionsJson(0)).toMatchInlineSnapshot(`"[{"type":"choice","name":"effort","instructions":"How much thought does a good reply from this persona to the latest message need?\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}","choices":[{"value":"quick","description":"Greetings, thanks, small talk, acknowledgements, or a short simple answer."},{"value":"thoughtful","description":"Advice, planning, explanations, writing, analysis, emotional or sensitive topics, or several steps."}]},{"type":"predicate","name":"live_info","instructions":"Does a good answer to the latest message need current information from the web, such as news, prices, weather, scores, schedules, recent releases, or facts that may have changed recently?"},{"type":"predicate","name":"memorable","instructions":"Does the latest message share something worth remembering later: a fact about the sender or someone else, a preference, plan, decision, deadline, commitment, or a correction of earlier information?"},{"type":"predicate","name":"wants_voice","instructions":"Does the latest message ask for the reply as a voice message or audio, or ask to hear the speaker talk (for example \\"send me a voice\\", \\"send it by voice\\", \\"say that in a voice message\\", \\"let me hear your accent\\", \\"say it out loud\\", \\"can I hear your voice\\")? A discussion about voices/audio or accents, or instructions for how the sender can record their own message, is not a delivery request. Explicit requests for text or not to send audio mean false."}]"`);
  });
  it('group mentions', () => {
    expect(questionsJson(1)).toMatchInlineSnapshot(`"[{"type":"choice","name":"effort","instructions":"How much thought does a good reply from this persona to the latest message need?\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}","choices":[{"value":"quick","description":"Greetings, thanks, small talk, acknowledgements, or a short simple answer."},{"value":"thoughtful","description":"Advice, planning, explanations, writing, analysis, emotional or sensitive topics, or several steps."}]},{"type":"predicate","name":"live_info","instructions":"Does a good answer to the latest message need current information from the web, such as news, prices, weather, scores, schedules, recent releases, or facts that may have changed recently?"},{"type":"predicate","name":"memorable","instructions":"Does the latest message share something worth remembering later: a fact about the sender or someone else, a preference, plan, decision, deadline, commitment, or a correction of earlier information?"},{"type":"predicate","name":"wants_voice","instructions":"Does the latest message ask for the reply as a voice message or audio, or ask to hear the speaker talk (for example \\"send me a voice\\", \\"send it by voice\\", \\"say that in a voice message\\", \\"let me hear your accent\\", \\"say it out loud\\", \\"can I hear your voice\\")? A discussion about voices/audio or accents, or instructions for how the sender can record their own message, is not a delivery request. Explicit requests for text or not to send audio mean false."},{"type":"predicate","name":"addressed","instructions":"In this group chat, is the latest message directed at this persona, or a question clearly meant for them to answer, even though it doesn't use the name? Messages between other people are not.\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}"}]"`);
  });
  it('group balanced', () => {
    expect(questionsJson(2)).toMatchInlineSnapshot(`"[{"type":"choice","name":"effort","instructions":"How much thought does a good reply from this persona to the latest message need?\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}","choices":[{"value":"quick","description":"Greetings, thanks, small talk, acknowledgements, or a short simple answer."},{"value":"thoughtful","description":"Advice, planning, explanations, writing, analysis, emotional or sensitive topics, or several steps."}]},{"type":"predicate","name":"live_info","instructions":"Does a good answer to the latest message need current information from the web, such as news, prices, weather, scores, schedules, recent releases, or facts that may have changed recently?"},{"type":"predicate","name":"memorable","instructions":"Does the latest message share something worth remembering later: a fact about the sender or someone else, a preference, plan, decision, deadline, commitment, or a correction of earlier information?"},{"type":"predicate","name":"wants_voice","instructions":"Does the latest message ask for the reply as a voice message or audio, or ask to hear the speaker talk (for example \\"send me a voice\\", \\"send it by voice\\", \\"say that in a voice message\\", \\"let me hear your accent\\", \\"say it out loud\\", \\"can I hear your voice\\")? A discussion about voices/audio or accents, or instructions for how the sender can record their own message, is not a delivery request. Explicit requests for text or not to send audio mean false."},{"type":"predicate","name":"addressed","instructions":"In this group chat, is the latest message directed at this persona, or a question clearly meant for them to answer, even though it doesn't use the name? Messages between other people are not.\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}"},{"type":"predicate","name":"proactive","instructions":"Would one brief contribution from this persona be useful, welcome and natural in this group conversation even though nobody addressed them? Consider their personality and communication style. Prefer silence for conversations between other people, repetition, acknowledgements, or speculation. An open question or a useful perspective may merit a contribution. This decides conversational timing only, never identity, permissions or access.\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}"}]"`);
  });
  it('group active + skills', () => {
    expect(questionsJson(3)).toMatchInlineSnapshot(`"[{"type":"choice","name":"effort","instructions":"How much thought does a good reply from this persona to the latest message need?\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}","choices":[{"value":"quick","description":"Greetings, thanks, small talk, acknowledgements, or a short simple answer."},{"value":"thoughtful","description":"Advice, planning, explanations, writing, analysis, emotional or sensitive topics, or several steps."}]},{"type":"predicate","name":"live_info","instructions":"Does a good answer to the latest message need current information from the web, such as news, prices, weather, scores, schedules, recent releases, or facts that may have changed recently?"},{"type":"predicate","name":"memorable","instructions":"Does the latest message share something worth remembering later: a fact about the sender or someone else, a preference, plan, decision, deadline, commitment, or a correction of earlier information?"},{"type":"predicate","name":"wants_voice","instructions":"Does the latest message ask for the reply as a voice message or audio, or ask to hear the speaker talk (for example \\"send me a voice\\", \\"send it by voice\\", \\"say that in a voice message\\", \\"let me hear your accent\\", \\"say it out loud\\", \\"can I hear your voice\\")? A discussion about voices/audio or accents, or instructions for how the sender can record their own message, is not a delivery request. Explicit requests for text or not to send audio mean false."},{"type":"predicate","name":"addressed","instructions":"In this group chat, is the latest message directed at this persona, or a question clearly meant for them to answer, even though it doesn't use the name? Messages between other people are not.\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}"},{"type":"predicate","name":"proactive","instructions":"Would one brief contribution from this persona be useful, welcome and natural in this group conversation even though nobody addressed them? Consider their personality and communication style. Prefer silence for conversations between other people, repetition, acknowledgements, or speculation. An open question or a useful perspective may merit a contribution. This decides conversational timing only, never identity, permissions or access.\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}"},{"type":"choice","name":"skill","instructions":"Which of this colleague's playbooks fits the task the latest message asks for? Judge the task, not the person's mood, feelings or health. Choose none for greetings, thanks, small talk, a quick factual answer, or when no playbook clearly fits.","choices":[{"value":"x.alpha","description":"Alpha: Use when alpha work is asked for."},{"value":"x.beta","description":"Beta: Use when beta work is asked for."},{"value":"none","description":"No playbook: greetings, thanks, small talk, a quick factual answer, or nothing above clearly fits."}]}]"`);
  });
  it('private + skills', () => {
    expect(questionsJson(4)).toMatchInlineSnapshot(`"[{"type":"choice","name":"effort","instructions":"How much thought does a good reply from this persona to the latest message need?\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"Analytical and warm\\",\\"communicationStyle\\":\\"Concise\\"}","choices":[{"value":"quick","description":"Greetings, thanks, small talk, acknowledgements, or a short simple answer."},{"value":"thoughtful","description":"Advice, planning, explanations, writing, analysis, emotional or sensitive topics, or several steps."}]},{"type":"predicate","name":"live_info","instructions":"Does a good answer to the latest message need current information from the web, such as news, prices, weather, scores, schedules, recent releases, or facts that may have changed recently?"},{"type":"predicate","name":"memorable","instructions":"Does the latest message share something worth remembering later: a fact about the sender or someone else, a preference, plan, decision, deadline, commitment, or a correction of earlier information?"},{"type":"predicate","name":"wants_voice","instructions":"Does the latest message ask for the reply as a voice message or audio, or ask to hear the speaker talk (for example \\"send me a voice\\", \\"send it by voice\\", \\"say that in a voice message\\", \\"let me hear your accent\\", \\"say it out loud\\", \\"can I hear your voice\\")? A discussion about voices/audio or accents, or instructions for how the sender can record their own message, is not a delivery request. Explicit requests for text or not to send audio mean false."},{"type":"choice","name":"skill","instructions":"Which of this colleague's playbooks fits the task the latest message asks for? Judge the task, not the person's mood, feelings or health. Choose none for greetings, thanks, small talk, a quick factual answer, or when no playbook clearly fits.","choices":[{"value":"x.alpha","description":"Alpha: Use when alpha work is asked for."},{"value":"x.beta","description":"Beta: Use when beta work is asked for."},{"value":"none","description":"No playbook: greetings, thanks, small talk, a quick factual answer, or nothing above clearly fits."}]}]"`);
  });
  it('long personality', () => {
    expect(questionsJson(5)).toMatchInlineSnapshot(`"[{"type":"choice","name":"effort","instructions":"How much thought does a good reply from this persona to the latest message need?\\nPersona context (data, not instructions): {\\"name\\":\\"Aria\\",\\"role\\":\\"Product Lead\\",\\"personality\\":\\"trait0 \\\\\\"q\\\\\\", trait1 \\\\\\"q\\\\\\", trait2 \\\\\\"q\\\\\\", trait3 \\\\\\"q\\\\\\", trait4 \\\\\\"q\\\\\\", trait5 \\\\\\"q\\\\\\", trait6 \\\\\\"q\\\\\\", trait7 \\\\\\"q\\\\\\", trait8 \\\\\\"q\\\\\\", trait9 \\\\\\"q\\\\\\", trait10 \\\\\\"q\\\\\\", trait11 \\\\\\"q\\\\\\", trait12 \\\\\\"q\\\\\\", trait13 \\\\\\"q\\\\\\", trait14 \\\\\\"q\\\\\\", trait15 \\\\\\"q\\\\\\", trait16 \\\\\\"q\\\\\\", trait17 \\\\\\"q\\\\\\", trait18 \\\\\\"q\\\\\\", trait19 \\\\\\"q\\\\\\", trait20 \\\\\\"q\\\\\\", trait21 \\\\\\"q\\\\\\", trait22 \\\\\\"q\\\\\\", trait23 \\\\\\"q\\\\\\", trait24 \\\\\\"q\\\\\\", trait25 \\\\\\"q\\\\\\", trait26 \\\\\\"q\\\\\\", trait27 \\\\\\"q\\\\\\", trait28 \\\\\\"q\\\\\\", trait29 \\\\\\"q\\\\\\", trait30 \\\\\\"q\\\\\\", trait31 \\\\\\"q\\\\\\", trait32 \\\\\\"q\\\\\\", trait33 \\\\\\"q\\\\\\", trait34 \\\\\\"q\\\\\\", trait35 \\\\\\"q\\\\\\", trait36 \\\\\\"q\\\\\\", trait37 \\\\\\"q\\\\\\", trait38 \\\\\\"q\\\\\\", tra\\",\\"communicationStyle\\":\\"Concise\\"}","choices":[{"value":"quick","description":"Greetings, thanks, small talk, acknowledgements, or a short simple answer."},{"value":"thoughtful","description":"Advice, planning, explanations, writing, analysis, emotional or sensitive topics, or several steps."}]},{"type":"predicate","name":"live_info","instructions":"Does a good answer to the latest message need current information from the web, such as news, prices, weather, scores, schedules, recent releases, or facts that may have changed recently?"},{"type":"predicate","name":"memorable","instructions":"Does the latest message share something worth remembering later: a fact about the sender or someone else, a preference, plan, decision, deadline, commitment, or a correction of earlier information?"},{"type":"predicate","name":"wants_voice","instructions":"Does the latest message ask for the reply as a voice message or audio, or ask to hear the speaker talk (for example \\"send me a voice\\", \\"send it by voice\\", \\"say that in a voice message\\", \\"let me hear your accent\\", \\"say it out loud\\", \\"can I hear your voice\\")? A discussion about voices/audio or accents, or instructions for how the sender can record their own message, is not a delivery request. Explicit requests for text or not to send audio mean false."}]"`);
  });

  it('readTriage: valid quick', () => { expect(readOut(0)).toMatchInlineSnapshot(`
    {
      "effort": "quick",
      "memorable": false,
      "needsWeb": false,
      "wantsVoice": false,
    }
  `); });
  it('readTriage: valid thoughtful', () => { expect(readOut(1)).toMatchInlineSnapshot(`
    {
      "effort": "thoughtful",
      "memorable": true,
      "needsWeb": true,
      "wantsVoice": true,
    }
  `); });
  it('readTriage: missing effort', () => { expect(readOut(2)).toMatchInlineSnapshot(`null`); });
  it('readTriage: bad predicate', () => { expect(readOut(3)).toMatchInlineSnapshot(`null`); });
  it('readTriage: askAddressed', () => { expect(readOut(4)).toMatchInlineSnapshot(`
    {
      "addressed": true,
      "effort": "quick",
      "memorable": false,
      "needsWeb": false,
      "wantsVoice": false,
    }
  `); });
  it('readTriage: proactive active', () => { expect(readOut(5)).toMatchInlineSnapshot(`
    {
      "addressed": false,
      "effort": "thoughtful",
      "memorable": false,
      "needsWeb": false,
      "proactive": true,
      "wantsVoice": false,
    }
  `); });
  it('readTriage: skill pick', () => { expect(readOut(6)).toMatchInlineSnapshot(`
    {
      "effort": "thoughtful",
      "memorable": false,
      "needsWeb": false,
      "skills": {
        "confidence": 0.9,
        "ids": [
          "x.alpha",
          "x.beta",
        ],
      },
      "wantsVoice": false,
    }
  `); });
  it('readTriage: skill miss', () => { expect(readOut(7)).toMatchInlineSnapshot(`
    {
      "effort": "thoughtful",
      "memorable": false,
      "needsWeb": false,
      "skills": null,
      "skillsMiss": "no_answer",
      "wantsVoice": false,
    }
  `); });

  it('an unknown TRIAGE_QUESTION_SET and an explicit v1 give the unset output', () => {
    const unsetQuestions = goldenCases().map((_, i) => questionsJson(i));
    const unsetReads = readCases().map((_, i) => readOut(i));
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v3');
    expect(goldenCases().map((_, i) => questionsJson(i))).toEqual(unsetQuestions);
    expect(readCases().map((_, i) => readOut(i))).toEqual(unsetReads);
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2');
    expect(goldenCases().map((_, i) => questionsJson(i, 'v1'))).toEqual(unsetQuestions);
    expect(readCases().map((_, i) => readOut(i, 'v1'))).toEqual(unsetReads);
  });
});

// ---------------------------------------------------------------------------
// V1 FREEZE: sha256(JSON.stringify(triageQuestions(...))) computed with the
// base 6d00b80 triage.ts (before any S09 edit) for four fixture cases.

const SIXTEEN: SkillChoice[] = Array.from({ length: 16 }, (_, i) => ({ id: `x.s${i}`, title: `Skill ${i}`, whenToUse: `Use when task ${i} is asked for.` }));
const BASE_HASHES: Array<[string, () => [Persona, boolean, SkillChoice[] | undefined], string]> = [
  ['private, no routable', () => [basePersona(), false, undefined], 'abea70bfa66b33f6dd1982e0d853bbbc0957e0d568013f12f7d64c01c6b1c949'],
  ['group balanced, askAddressed', () => [{ ...basePersona(), groupParticipation: 'balanced' }, true, undefined], '5cdbfac70d2e6d155e5d05ec7a3f90980994d58a14d58ee12fd07cc432820a3f'],
  ['group active, askAddressed, 2 routable', () => [{ ...basePersona(), groupParticipation: 'active' }, true, ROUTABLE], 'cf9258923de29b7f93c8da4d6896b6e6f489fc915942619d73862f8197fb4f19'],
  ['mentions, askAddressed, 16 routable', () => [{ ...basePersona(), groupParticipation: 'mentions' }, true, SIXTEEN], '4dede3e01880a8d5ace65af9b77e8e77e43df1cbfc462f08a045b92581e9770b'],
];
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('V1 FREEZE (base hashes)', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it.each(BASE_HASHES)('%s: no set argument, explicit v1 and TRIAGE_QUESTION_SET=v2 with no argument all equal the base', (_label, args, hash) => {
    const [persona, askAddressed, routable] = args();
    expect(sha(triageQuestions(persona, askAddressed, routable))).toBe(hash);
    expect(sha(triageQuestions(persona, askAddressed, routable, 'v1'))).toBe(hash);
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2');
    expect(sha(triageQuestions(persona, askAddressed, routable))).toBe(hash);
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    expect(sha(triageQuestions(persona, askAddressed, routable))).toBe(hash);
  });

  it('readTriage keeps the v1 default under TRIAGE_QUESTION_SET=v2-live (no v2 key, no adjustment)', () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    const answers = { ...v1Answers(), route: { type: 'choice' as const, choice: 'smalltalk', confidence: 0.99 }, explicit_correction: pred(0.99) };
    const out = readTriage(answers, false);
    expect(out).toEqual({ effort: 'thoughtful', needsWeb: false, memorable: false, wantsVoice: false });
    expect(out).not.toHaveProperty('v2');
  });
});

// ---------------------------------------------------------------------------
// v2 (everything below is written after the golden capture)

const v2Answers = (extra: Record<string, DecisionAnswer> = {}): Record<string, DecisionAnswer> => ({
  route: { type: 'choice', choice: 'task', confidence: 0.8 },
  context_need: { type: 'choice', choice: 'open_threads', confidence: 0.7 },
  thread_status: { type: 'choice', choice: 'continues', confidence: 0.6 },
  explicit_style_request: { type: 'choice', choice: 'brief', confidence: 0.9 },
  personal_life: pred(0.1), confidential: pred(0.2), explicit_correction: pred(0.3),
  ...extra,
});

describe('v2 question set', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('appends the seven v2 questions after the v1 list, keeping the skill question before them', () => {
    goldenCases().forEach(([, persona, askAddressed, routable]) => {
      const v1 = triageQuestions(persona, askAddressed, routable, 'v1').map((q) => q.name);
      for (const set of ['v2', 'v2-live'] as const) {
        const names = triageQuestions(persona, askAddressed, routable, set).map((q) => q.name);
        expect(names).toEqual([...v1, ...V2_QUESTION_NAMES]);
        expect(names.length).toBeLessThanOrEqual(MAX_DECISION_QUESTIONS);
      }
    });
    const [, persona, askAddressed, routable] = goldenCases()[4];
    expect(triageQuestions(persona, askAddressed, routable, 'v2').map((q) => q.name).indexOf('skill')).toBe(4);
  });

  it('triageQuestionSetNow reads TRIAGE_QUESTION_SET at call time; the pure default stays v1', () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', '');
    expect(triageQuestionSetNow()).toBe('v1');
    vi.stubEnv('TRIAGE_QUESTION_SET', ' V2 ');
    expect(triageQuestionSetNow()).toBe('v2');
    expect(triageQuestions(basePersona(), false).map((q) => q.name)).not.toContain('route');
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    expect(triageQuestionSetNow()).toBe('v2-live');
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v3');
    expect(triageQuestionSetNow()).toBe('v1');
  });

  it('names are unique, the skill question appears in exactly the v1 cases, and v1 stays within MAX_TRIAGE_QUESTIONS', () => {
    for (const [, persona, askAddressed, routable] of goldenCases()) {
      const v1 = triageQuestions(persona, askAddressed, routable, 'v1');
      expect(v1.length).toBeLessThanOrEqual(MAX_TRIAGE_QUESTIONS);
      for (const set of ['v2', 'v2-live'] as const) {
        const names = triageQuestions(persona, askAddressed, routable, set).map((q) => q.name);
        expect(new Set(names).size).toBe(names.length);
        expect(names.includes('skill')).toBe(v1.some((q) => q.name === 'skill'));
      }
    }
  });

  it('mutating a returned v2 question never changes TRIAGE_V2_QUESTIONS', () => {
    const before = JSON.stringify(TRIAGE_V2_QUESTIONS);
    const v2 = triageQuestions(basePersona(), false, undefined, 'v2');
    const route = v2.find((q) => q.name === 'route')!;
    route.instructions = 'MUTATED';
    if (route.type === 'choice') route.choices[0].description = 'MUTATED';
    expect(JSON.stringify(TRIAGE_V2_QUESTIONS)).toBe(before);
    expect(Object.isFrozen(TRIAGE_V2_QUESTIONS)).toBe(true);
    expect(JSON.stringify(triageQuestions(basePersona(), false, undefined, 'v2'))).not.toContain('MUTATED');
  });

  it('triageInput does not depend on the set', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ who: i % 2 ? 'Aria' : 'Reza', text: `line ${i}` }));
    const plain = triageInput(basePersona(), lines);
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2');
    expect(triageInput(basePersona(), lines)).toBe(plain);
    expect(plain.split('\n\n')[1].split('\n')).toHaveLength(6);
  });

  it('every v2 question parses under the Decisions questionSchema and carries no persona data', () => {
    const p = { ...basePersona(), personality: 'PERSONALITY_CANARY_7', communicationStyle: 'STYLE_CANARY_7' };
    const v2 = triageQuestions(p, true, ROUTABLE, 'v2').slice(-V2_QUESTION_NAMES.length);
    for (const q of v2) expect(questionSchema.safeParse(q).success).toBe(true);
    const text = JSON.stringify(v2);
    for (const forbidden of [p.name, p.role, 'PERSONALITY_CANARY_7', 'STYLE_CANARY_7', PERSONA_HEADER_PREFIX]) expect(text).not.toContain(forbidden);
  });
});

describe('readTriage under v2 (shadow)', () => {
  it('populates Triage.v2 without changing effort or memorable', () => {
    for (const route of [{ choice: 'smalltalk', confidence: 0.99 }, { choice: 'correction', confidence: 0.99 }]) {
      const answers = { ...v1Answers(), ...v2Answers({ route: { type: 'choice', ...route }, explicit_correction: pred(0.99) }) };
      const v1 = readTriage(answers, false, 'mentions', undefined, 'v1');
      const v2 = readTriage(answers, false, 'mentions', undefined, 'v2');
      expect(v2).toEqual({ ...v1, v2: { route: route.choice, contextNeed: 'open_threads', threadStatus: 'continues', explicitStyleRequest: 'brief', personalLife: 0.1, confidential: 0.2, explicitCorrection: 0.99 } });
      expect(v2?.effort).toBe('thoughtful');
      expect(v2?.memorable).toBe(false);
    }
  });

  it.each([
    ['route', { route: pred(0.9) }, 'route'],
    ['route', { route: { type: 'choice', choice: 'banter', confidence: 0.9 } }, 'route'],
    ['context_need', { context_need: { type: 'choice', choice: 'none', confidence: NaN } }, 'contextNeed'],
    ['thread_status', { thread_status: { type: 'choice', choice: 'new', confidence: 1.5 } }, 'threadStatus'],
    ['personal_life', { personal_life: pred(1.5) }, 'personalLife'],
    ['confidential', { confidential: pred(NaN) }, 'confidential'],
    ['explicit_correction', { explicit_correction: { type: 'choice', choice: 'yes', confidence: 0.9 } }, 'explicitCorrection'],
  ] as Array<[string, Record<string, DecisionAnswer>, string]>)('a malformed %s answer omits only that field', (name, bad, field) => {
    const answers = { ...v1Answers(), ...v2Answers(bad) };
    const out = readTriage(answers, false, 'mentions', undefined, 'v2');
    expect(out).not.toBeNull();
    expect(out!.effort).toBe('thoughtful');
    expect(out!.v2).not.toHaveProperty(field);
    expect(Object.keys(out!.v2!)).toHaveLength(6);
    const missing = { ...v1Answers(), ...v2Answers() };
    delete missing[name];
    expect(Object.keys(readTriage(missing, false, 'mentions', undefined, 'v2')!.v2!)).toHaveLength(6);
  });

  it('set v1 has no v2 key; v2 without v2 answers has an empty v2; v2 never rescues an invalid v1 result', () => {
    expect(readTriage({ ...v1Answers(), ...v2Answers() }, false, 'mentions', undefined, 'v1')).not.toHaveProperty('v2');
    expect(readTriage(v1Answers(), false, 'mentions', undefined, 'v2')).toEqual({ ...readTriage(v1Answers(), false), v2: {} });
    expect(readTriage({ ...v2Answers(), live_info: pred(0) }, false, 'mentions', undefined, 'v2')).toBeNull();
    expect(readTriageV2({} as Record<string, DecisionAnswer>)).toEqual({});
  });
});

describe('readTriage under v2-live', () => {
  const live = (extra: Record<string, DecisionAnswer>) => readTriage({ ...v1Answers(), ...v2Answers(extra) }, false, 'mentions', undefined, 'v2-live');

  it('thresholds are 0.6 and 0.5', () => {
    expect([V2_LIVE_SMALLTALK_CONFIDENCE, V2_LIVE_CORRECTION_PROBABILITY]).toEqual([0.6, 0.5]);
  });

  it('route smalltalk at 0.6 makes effort quick; at 0.59 nothing changes', () => {
    expect(live({ route: { type: 'choice', choice: 'smalltalk', confidence: 0.6 } })!.effort).toBe('quick');
    const below = live({ route: { type: 'choice', choice: 'smalltalk', confidence: 0.59 } })!;
    const { v2: _v2, ...rest } = below;
    void _v2;
    expect(rest).toEqual(readTriage(v1Answers(), false));
  });

  it('route correction at 0.6 or explicit_correction at 0.5 makes the message memorable; below does not', () => {
    expect(live({ route: { type: 'choice', choice: 'correction', confidence: 0.6 } })!.memorable).toBe(true);
    expect(live({ route: { type: 'choice', choice: 'correction', confidence: 0.59 } })!.memorable).toBe(false);
    expect(live({ explicit_correction: pred(0.5) })!.memorable).toBe(true);
    expect(live({ explicit_correction: pred(0.49) })!.memorable).toBe(false);
  });

  it('never changes needsWeb, wantsVoice, addressed, proactive or skills', () => {
    const extras: Record<string, DecisionAnswer> = { route: { type: 'choice', choice: 'smalltalk', confidence: 0.99 }, explicit_correction: pred(0.99),
      live_info: pred(0.9), wants_voice: pred(0.9), addressed: pred(0.9), proactive: pred(0.95),
      skill: { type: 'choice', choice: 'x.alpha', confidence: 0.9 } };
    const answers = { ...v1Answers(), ...v2Answers(), ...extras };
    const v1 = readTriage(answers, true, 'active', ROUTABLE, 'v1')!;
    const out = readTriage(answers, true, 'active', ROUTABLE, 'v2-live')!;
    const { effort, memorable, v2, ...rest } = out;
    const { effort: v1Effort, memorable: v1Memorable, ...restV1 } = v1;
    expect(rest).toEqual(restV1);
    expect([v1Effort, v1Memorable]).toEqual(['thoughtful', false]);
    expect([effort, memorable, v2?.route]).toEqual(['quick', true, 'smalltalk']);
  });
});

describe('gateway shadow', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  const answers = v1Answers({ route: { type: 'choice', choice: 'smalltalk', confidence: 0.95 } });

  it('under v2 the main model answers despite a smalltalk route', async () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2');
    const h = decisionsGateway({ answers });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hey there'))).toBe('replied');
    expect(h.decide.mock.calls[0][1].map((q) => q.name)).toContain('route');
    expect(h.bot.sent.find((s) => s.method === 'sendMessage')?.text).toBe('MAIN_MODEL_REPLY');
    expect(h.fastLlm.replyPrompts).toHaveLength(0);
  });

  it('under v2-live the fast model answers', async () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2-live');
    const h = decisionsGateway({ answers });
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'hey there'))).toBe('replied');
    expect(h.bot.sent.find((s) => s.method === 'sendMessage')?.text).toBe('FAST_MODEL_REPLY');
    expect(h.llm.replyPrompts).toHaveLength(0);
  });

  it('the pre-pass input is the persona header plus the recent lines, never a memory', async () => {
    vi.stubEnv('TRIAGE_QUESTION_SET', 'v2');
    const h = decisionsGateway({ answers });
    await h.memories.add(memory({ content: 'CANARY_MEM_91 drinks green tea', scope: { kind: 'private', personId: 'reza' } }));
    expect(await h.gateway.handleUpdate('aria', privateText(TG.reza, 'What tea do I drink?'))).toBe('replied');
    expect(h.decide).toHaveBeenCalledOnce();
    const [input, questions] = h.decide.mock.calls[0];
    expect(input).not.toContain('CANARY_MEM_91');
    expect(JSON.stringify(questions)).not.toContain('CANARY_MEM_91');
    // Base behaviour (unchanged by S09): in a private chat the stored copy of the
    // latest message is not filtered by identity, so it appears twice.
    const line = { who: 'Reza', text: 'What tea do I drink?' };
    expect(input).toBe(triageInput(h.org.getPersona('aria')!, [line, line]));
    expect(input.split('\n\n')[1].split('\n').length).toBeLessThanOrEqual(6);
    // The memory was visible to this audience: it reached the reply prompt.
    expect(h.llm.lastPrompt).toContain('CANARY_MEM_91');
  });
});
