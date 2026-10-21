import { describe, expect, it } from 'vitest';
import { MAX_ROUTABLE_SKILLS, NO_SKILL, parseSkillRouting, readSkillPick, skillMiss, skillQuestion, SKILL_QUESTION } from '../skill-routing';
import { askedSkill, MAX_TRIAGE_QUESTIONS, readTriage, triageQuestions, type DecisionAnswer } from '../triage';
import type { Persona } from '../types';

const SKILLS = [
  { id: 'ua.campaign-plan', title: 'UA campaign plan', whenToUse: 'Use when launching a title or opening new geos.' },
  { id: 'ua.creative-testing', title: 'Creative testing', whenToUse: 'Use when choosing which ads to scale.' },
  { id: 'core.decision-memo', title: 'Decision memo', whenToUse: 'Use when choosing between options with trade-offs.' },
];

describe('skillQuestion', () => {
  it('offers every routable skill plus none, within Decisions limits', () => {
    const q = skillQuestion(SKILLS)!;
    expect(q).toMatchObject({ type: 'choice', name: SKILL_QUESTION });
    expect(q.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    if (q.type !== 'choice') throw new Error('choice expected');
    expect(q.choices.map((c) => c.value)).toEqual([...SKILLS.map((s) => s.id), NO_SKILL]);
    expect(q.choices.every((c) => c.value.length <= 64 && (c.description ?? '').length <= 2048)).toBe(true);
    expect(q.instructions).toMatch(/not the person's mood, feelings or health/);
  });

  it('asks nothing when there is no real choice, ids clash, or a skill is named none', () => {
    expect(skillQuestion(SKILLS.slice(0, 1))).toBeUndefined();
    expect(skillQuestion([SKILLS[0], SKILLS[0]])).toBeUndefined();
    expect(skillQuestion([SKILLS[0], { ...SKILLS[1], id: NO_SKILL }])).toBeUndefined();
  });

  it('never exceeds 16 choices', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `x.s${i}`, title: `S${i}`, whenToUse: 'Use when testing.' }));
    const q = skillQuestion(many)!;
    if (q.type !== 'choice') throw new Error('choice expected');
    expect(q.choices).toHaveLength(MAX_ROUTABLE_SKILLS + 1);
  });
});

describe('readSkillPick', () => {
  it('routes a confident pick, adding a strong runner-up when probabilities exist', () => {
    expect(readSkillPick({ type: 'choice', choice: 'ua.creative-testing', confidence: 0.8 }, SKILLS)).toEqual({ ids: ['ua.creative-testing'], confidence: 0.8 });
    expect(readSkillPick({ type: 'choice', choice: 'ua.campaign-plan', confidence: 0.55, probabilities: [
      { value: 'ua.campaign-plan', probability: 0.55 }, { value: 'core.decision-memo', probability: 0.3 }, { value: NO_SKILL, probability: 0.15 },
    ] }, SKILLS)).toEqual({ ids: ['ua.campaign-plan', 'core.decision-memo'], confidence: 0.55 });
  });

  it('loads no playbook for a confident none', () => {
    expect(readSkillPick({ type: 'choice', choice: NO_SKILL, confidence: 0.9 }, SKILLS)).toEqual({ ids: [], confidence: 0.9 });
  });

  it('stays unrouted when unsure, malformed, refused or off-list', () => {
    expect(readSkillPick({ type: 'choice', choice: 'ua.campaign-plan', confidence: 0.3 }, SKILLS)).toBeNull();
    expect(readSkillPick({ type: 'choice', choice: 'not.a-skill', confidence: 0.9 }, SKILLS)).toBeNull();
    expect(readSkillPick({ type: 'predicate', probability: 0.9 }, SKILLS)).toBeNull();
    expect(readSkillPick({ type: 'choice', choice: 'ua.campaign-plan', confidence: Number.NaN }, SKILLS)).toBeNull();
    expect(readSkillPick(undefined, SKILLS)).toBeNull();
  });

  it('ignores runner-ups that are none, off-list or weak', () => {
    expect(readSkillPick({ type: 'choice', choice: 'ua.campaign-plan', confidence: 0.6, probabilities: [
      { value: NO_SKILL, probability: 0.39 }, { value: 'other.skill', probability: 0.5 }, { value: 'ua.creative-testing', probability: 0.1 },
    ] }, SKILLS)).toEqual({ ids: ['ua.campaign-plan'], confidence: 0.6 });
  });
});

describe('malformed per-option probabilities', () => {
  it.each([
    ['an object', { a: 1 }], ['a string', 'x'], ['a null entry', [null]], ['a number entry', [0.4]],
    ['an entry without a value', [{ probability: 0.4 }]], ['an out-of-range probability', [{ value: 'core.decision-memo', probability: 4 }]],
    ['a mixed list', [{ value: 'core.decision-memo', probability: 0.4 }, null]],
  ])('never throw and only drop the runner-up: %s', (_label, probabilities) => {
    const answer = { type: 'choice', choice: 'ua.campaign-plan', confidence: 0.6, probabilities } as unknown as DecisionAnswer;
    expect(() => readSkillPick(answer, SKILLS)).not.toThrow();
    expect(readSkillPick(answer, SKILLS)).toEqual({ ids: ['ua.campaign-plan'], confidence: 0.6 });
    const answers = {
      effort: { type: 'choice', choice: 'quick', confidence: 0.9 }, live_info: { type: 'predicate', probability: 0 },
      memorable: { type: 'predicate', probability: 0 }, skill: answer,
    } as Record<string, DecisionAnswer>;
    expect(readTriage(answers, false, 'mentions', SKILLS)).toMatchObject({ effort: 'quick', skills: { ids: ['ua.campaign-plan'] } });
  });

  it('never throw on answers of the wrong shape', () => {
    for (const answer of [null, 'x', 7, { type: 'choice' }, { type: 'choice', choice: 5, confidence: 0.9 }, { type: 'choice', choice: null, confidence: 0.9 }]) {
      expect(() => readSkillPick(answer as unknown as DecisionAnswer, SKILLS)).not.toThrow();
      expect(readSkillPick(answer as unknown as DecisionAnswer, SKILLS)).toBeNull();
      expect(() => skillMiss(answer as unknown as DecisionAnswer, SKILLS)).not.toThrow();
    }
  });
});

describe('skillMiss', () => {
  it('separates an unsure pick from no usable answer', () => {
    expect(skillMiss({ type: 'choice', choice: 'ua.campaign-plan', confidence: 0.3 }, SKILLS)).toBe('low_confidence');
    expect(skillMiss({ type: 'choice', choice: NO_SKILL, confidence: 0.2 }, SKILLS)).toBe('low_confidence');
    expect(skillMiss({ type: 'choice', choice: 'not.a-skill', confidence: 0.3 }, SKILLS)).toBe('no_answer');
    expect(skillMiss({ type: 'choice', choice: 'ua.campaign-plan', confidence: Number.NaN }, SKILLS)).toBe('no_answer');
    expect(skillMiss({ type: 'predicate', probability: 0.9 }, SKILLS)).toBe('no_answer');
    expect(skillMiss(undefined, SKILLS)).toBe('no_answer');
  });
});

describe('parseSkillRouting (STUDIO_SKILL_ROUTING)', () => {
  it('defaults to on, accepts the three modes, and treats anything else as off', () => {
    expect(parseSkillRouting(undefined)).toBe('on');
    expect(parseSkillRouting('')).toBe('on');
    expect(parseSkillRouting(' Shadow ')).toBe('shadow');
    expect(parseSkillRouting('on')).toBe('on');
    expect(parseSkillRouting('off')).toBe('off');
    for (const value of ['1', 'true', 'yes', 'enabled', 'onn']) expect(parseSkillRouting(value)).toBe('off');
  });
});

describe('skill selection inside triage', () => {
  const persona = (participation: Persona['groupParticipation']): Persona => ({
    id: 'nova', name: 'Nova', role: 'Growth Lead', personality: 'Direct', communicationStyle: 'Brief', values: [],
    voice: { elevenLabsVoiceId: '', description: '' }, ownerId: 'o', identityVersion: 1, replyWithVoice: 'mirror', groupParticipation: participation,
  });
  const base = (extra: Record<string, DecisionAnswer> = {}): Record<string, DecisionAnswer> => ({
    effort: { type: 'choice', choice: 'thoughtful', confidence: 0.9 },
    live_info: { type: 'predicate', probability: 0.1 },
    memorable: { type: 'predicate', probability: 0.1 },
    wants_voice: { type: 'predicate', probability: 0 },
    ...extra,
  });
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `x.s${i}`, title: `S${i}`, whenToUse: 'Use when testing.' }));

  it('adds the skill question last, and never exceeds the Decisions question limit', () => {
    expect(triageQuestions(persona('active'), false).map((q) => q.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice']);
    expect(triageQuestions(persona('active'), false, SKILLS).map((q) => q.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice', SKILL_QUESTION]);
    expect(triageQuestions(persona('active'), false, SKILLS.slice(0, 1)).map((q) => q.name)).not.toContain(SKILL_QUESTION);
    for (const participation of ['mentions', 'balanced', 'active'] as const) {
      for (const askAddressed of [false, true]) {
        for (const routable of [undefined, SKILLS, many]) {
          const questions = triageQuestions(persona(participation), askAddressed, routable);
          expect(questions.length).toBeLessThanOrEqual(MAX_TRIAGE_QUESTIONS);
          expect(new Set(questions.map((q) => q.name)).size).toBe(questions.length);
        }
      }
    }
    expect(triageQuestions(persona('active'), true, SKILLS).map((q) => q.name)).toEqual(['effort', 'live_info', 'memorable', 'wants_voice', 'addressed', 'proactive', SKILL_QUESTION]);
  });

  it('knows whether the skill question was among the questions sent', () => {
    expect(askedSkill(triageQuestions(persona('active'), true, SKILLS))).toBe(true);
    expect(askedSkill(triageQuestions(persona('active'), true))).toBe(false);
    expect(askedSkill(triageQuestions(persona('active'), false, SKILLS.slice(0, 1)))).toBe(false);
    // A full request leaves no room: the question is not sent, and that is visible.
    const full = Array.from({ length: MAX_TRIAGE_QUESTIONS }, (_, i) => ({ type: 'predicate' as const, name: `q${i}`, instructions: 'x' }));
    expect(askedSkill(full)).toBe(false);
  });

  it('reads the pick without letting a missing or bad skill answer reject the triage', () => {
    expect(readTriage(base(), false)).not.toHaveProperty('skills');
    expect(readTriage(base({ skill: { type: 'choice', choice: 'ua.creative-testing', confidence: 0.8 } }), false, 'mentions', SKILLS))
      .toMatchObject({ effort: 'thoughtful', skills: { ids: ['ua.creative-testing'], confidence: 0.8 } });
    expect(readTriage(base({ skill: { type: 'choice', choice: NO_SKILL, confidence: 0.9 } }), false, 'mentions', SKILLS)?.skills).toEqual({ ids: [], confidence: 0.9 });
    expect(readTriage(base(), false, 'mentions', SKILLS)).toMatchObject({ effort: 'thoughtful', skills: null, skillsMiss: 'no_answer' });
    expect(readTriage(base({ skill: { type: 'predicate', probability: 1 } }), false, 'mentions', SKILLS)).toMatchObject({ skills: null, skillsMiss: 'no_answer' });
    expect(readTriage(base({ skill: { type: 'choice', choice: 'ua.campaign-plan', confidence: 0.2 } }), false, 'mentions', SKILLS)).toMatchObject({ skills: null, skillsMiss: 'low_confidence' });
    expect(readTriage(base({ skill: { type: 'choice', choice: 'ua.campaign-plan', confidence: 0.9 } }), false, 'mentions', SKILLS)).not.toHaveProperty('skillsMiss');
    // Not asked: no skill field at all, whatever the answers contain.
    expect(readTriage(base({ skill: { type: 'choice', choice: 'ua.campaign-plan', confidence: 0.9 } }), false, 'mentions')).not.toHaveProperty('skills');
    // The other answers still decide whether there is a triage.
    expect(readTriage({ skill: { type: 'choice', choice: 'ua.campaign-plan', confidence: 0.9 } }, false, 'mentions', SKILLS)).toBeNull();
  });
});
