/**
 * H3 (F233), TRIAGE_QUESTION_SET=v2-live: a correction may make a message
 * memorable only in a private chat, and only when the model does not read it
 * as confidential or about private life. The smalltalk effort adjustment is
 * unchanged. Pure unit tests of readTriage.
 */
import { describe, expect, it } from 'vitest';
import { readTriage, V2_LIVE_SENSITIVE_PROBABILITY, type DecisionAnswer } from '../triage';

type Answers = Record<string, DecisionAnswer>;
const pred = (probability: number): DecisionAnswer => ({ type: 'predicate', probability });
const choice = (value: string, confidence = 0.9, probabilities?: Array<{ value: string; probability: number }>): DecisionAnswer =>
  ({ type: 'choice', choice: value, confidence, ...(probabilities ? { probabilities } : {}) });

const v1 = (memorable = 0.1, group = false): Answers => ({
  effort: choice('thoughtful'), live_info: pred(0.1), memorable: pred(memorable), wants_voice: pred(0),
  ...(group ? { addressed: pred(0.95) } : {}),
});
const correction = (extra: Answers = {}): Answers => ({
  route: choice('correction', 0.8), explicit_correction: pred(0.6), confidential: pred(0.05), personal_life: pred(0.05), ...extra,
});
const live = (answers: Answers, askAddressed = false, group = false) => readTriage(answers, askAddressed, 'mentions', undefined, 'v2-live', group);

describe('v2-live correction adjustment (F233)', () => {
  it('positive control: a private correction with low confidential becomes memorable', () => {
    const triage = live({ ...v1(0.1), ...correction() });
    expect(triage).toMatchObject({ memorable: true, v2: { route: 'correction', confidential: 0.05 } });
    // explicit_correction alone does it too.
    expect(live({ ...v1(0.1), ...correction({ route: choice('answer') }) })!.memorable).toBe(true);
    // absent confidential and personal_life count as below the threshold.
    expect(live({ ...v1(0.1), route: choice('correction', 0.8) })!.memorable).toBe(true);
  });

  it('a group v2-live correction with v1 memorable 0.1 stays not memorable (askAddressed)', () => {
    const triage = live({ ...v1(0.1, true), ...correction({ confidential: pred(0.95) }) }, true);
    expect(triage).toMatchObject({ memorable: false, addressed: true });
    expect(live({ ...v1(0.1, true), ...correction() }, true)!.memorable).toBe(false);
  });

  it('an addressed group message (askAddressed false) stays not memorable when the caller marks the chat as a group', () => {
    expect(live({ ...v1(0.1), ...correction() }, false, true)!.memorable).toBe(false);
  });

  it('a private correction with confidential 0.7 stays not memorable', () => {
    expect(live({ ...v1(0.1), ...correction({ confidential: pred(0.7) }) })!.memorable).toBe(false);
    expect(live({ ...v1(0.1), ...correction({ confidential: pred(V2_LIVE_SENSITIVE_PROBABILITY) }) })!.memorable).toBe(false);
    expect(live({ ...v1(0.1), ...correction({ confidential: pred(0.49) }) })!.memorable).toBe(true);
  });

  it('a private correction about private life stays not memorable', () => {
    expect(live({ ...v1(0.1), ...correction({ personal_life: pred(0.8) }) })!.memorable).toBe(false);
  });

  it('never lowers v1: a message v1 already finds memorable stays memorable', () => {
    expect(live({ ...v1(0.9, true), ...correction({ confidential: pred(0.9) }) }, true)!.memorable).toBe(true);
  });

  it('the smalltalk effort adjustment is unchanged, in groups too', () => {
    const smalltalk = { route: choice('smalltalk', 0.8), confidential: pred(0.9) };
    expect(live({ ...v1(0.1), ...smalltalk })!.effort).toBe('quick');
    expect(live({ ...v1(0.1, true), ...smalltalk }, true)!.effort).toBe('quick');
  });

  it('v2 (shadow) never adjusts', () => {
    expect(readTriage({ ...v1(0.1), ...correction() }, false, 'mentions', undefined, 'v2')!.memorable).toBe(false);
  });
});
