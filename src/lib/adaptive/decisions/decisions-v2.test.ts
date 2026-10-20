/** S09: raised caps, structured text/image parts and a per-call deadline for the Decisions seam. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DecisionService, OpenAIDecisionProvider, requestSchema, decisionEvidenceSchema,
  DEFAULT_DECISION_DEADLINE_MS, MAX_DECISION_DEADLINE_MS, MAX_DECISION_QUESTIONS, MAX_DECISION_CHOICES,
  MAX_DECISION_LEVELS, MAX_DECISION_TEXT_PARTS, MAX_DECISION_IMAGE_PARTS,
  type DecisionContext, type DecisionInput, type DecisionProvider, type DecisionQuestion,
} from './index';
import { minimizeImageDataUrl } from '../prediction/image';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind: string, data: number[]): number[] {
  const body = [...kind].map((c) => c.charCodeAt(0)).concat(data);
  const len = data.length, crc = crc32(Uint8Array.from(body));
  return [len >>> 24, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255];
}
/** A 1x1 RGBA PNG with a metadata tEXt chunk that minimizeImageDataUrl strips. */
function syntheticPng(): string {
  const ihdr = [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0];
  const idat = [0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff];
  const bytes = [137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', ihdr), ...chunk('tEXt', [...'Comment\0CANARY_META'].map((c) => c.charCodeAt(0))), ...chunk('IDAT', idat), ...chunk('IEND', [])];
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
}

const predicates = (n: number): DecisionQuestion[] => Array.from({ length: n }, (_, i) => ({ type: 'predicate', name: `q${i}`, instructions: `Question ${i}?` }));
const choiceQuestion = (n: number): DecisionQuestion => ({ type: 'choice', name: 'pick', instructions: 'Pick one.', choices: Array.from({ length: n }, (_, i) => ({ value: `v${i}`, description: `Value ${i}` })) });
const scoreQuestion = (n: number): DecisionQuestion => ({ type: 'score', name: 'level', instructions: 'Score it.', levels: Array.from({ length: n }, (_, i) => ({ label: `l${i}`, description: `Level ${i}` })) });

/** A provider that answers every predicate question with 0.5. */
function echoProvider(): DecisionProvider & { evaluate: ReturnType<typeof vi.fn> } {
  return {
    evaluate: vi.fn(async (input: DecisionInput) => ({
      model: 'gpt-6-luna', usage: { input_tokens: 7 },
      answers: input.questions.map((q) => ({ name: q.name, type: 'predicate', probability: 0.5 })),
    })),
  };
}
const context = (input: unknown, extra: Partial<DecisionContext> = {}): DecisionContext => ({
  enabled: true, revision: 1, currentRevision: () => 1, authorize: async () => 'v1', loadInput: async () => input as DecisionInput, ...extra,
});

afterEach(() => { vi.useRealTimers(); });

describe('exported caps', () => {
  it('have exactly the contract values and requestSchema is exported', () => {
    expect([DEFAULT_DECISION_DEADLINE_MS, MAX_DECISION_DEADLINE_MS, MAX_DECISION_QUESTIONS, MAX_DECISION_CHOICES, MAX_DECISION_LEVELS, MAX_DECISION_TEXT_PARTS, MAX_DECISION_IMAGE_PARTS])
      .toEqual([500, 5_000, 24, 32, 12, 8, 1]);
    expect(typeof requestSchema.safeParse).toBe('function');
  });
});

describe('question caps', () => {
  it('answers 24 questions and rejects 25 without calling the provider', async () => {
    const ok = echoProvider();
    expect(await new DecisionService(ok).evaluate(context({ input: 'text', questions: predicates(24) }))).toMatchObject({ status: 'answered' });
    const no = echoProvider();
    expect(await new DecisionService(no).evaluate(context({ input: 'text', questions: predicates(25) }))).toMatchObject({ status: 'unknown', reason: 'invalid_input' });
    expect(no.evaluate).not.toHaveBeenCalled();
  });

  it('accepts 32 choices and 12 levels; rejects 33 choices and 13 levels', async () => {
    expect(requestSchema.safeParse({ input: 'text', questions: [choiceQuestion(32)] }).success).toBe(true);
    expect(requestSchema.safeParse({ input: 'text', questions: [scoreQuestion(12)] }).success).toBe(true);
    for (const question of [choiceQuestion(33), scoreQuestion(13)]) {
      const provider = echoProvider();
      expect(await new DecisionService(provider).evaluate(context({ input: 'text', questions: [question] }))).toMatchObject({ reason: 'invalid_input' });
      expect(provider.evaluate).not.toHaveBeenCalled();
    }
  });

  it('still rejects duplicate names and duplicate choice values', () => {
    expect(requestSchema.safeParse({ input: 'text', questions: [...predicates(1), ...predicates(1)] }).success).toBe(false);
    const dup = choiceQuestion(3) as Extract<DecisionQuestion, { type: 'choice' }>;
    expect(requestSchema.safeParse({ input: 'text', questions: [{ ...dup, choices: [dup.choices[0], dup.choices[0]] }] }).success).toBe(false);
  });
});

describe('evidence', () => {
  const text = (t: string) => ({ type: 'input_text', text: t });
  const image = () => ({ type: 'input_image', image_url: syntheticPng(), detail: 'low' });
  const message = (content: unknown[], extra: Record<string, unknown> = {}) => [{ role: 'user', content, ...extra }];

  it.each([
    ['a string of 8192 chars', 'x'.repeat(8192)],
    ['1 text part', message([text('one')])],
    ['8 text parts', message(Array.from({ length: 8 }, (_, i) => text(`part ${i}`)))],
    ['text plus one image', message([text('look'), image()])],
    ['image first then text', message([image(), text('look')])],
  ])('accepts %s', (_label, input) => {
    expect(decisionEvidenceSchema.safeParse(input).success).toBe(true);
  });

  it('keeps the base [input_text, input_image] tuple valid and minimizes its image', () => {
    const raw = syntheticPng();
    const parsed = requestSchema.parse({ input: message([text('Inspect'), { type: 'input_image', image_url: raw, detail: 'low' }]), questions: predicates(1) });
    const part = (parsed.input as Array<{ content: Array<{ type: string; image_url?: string }> }>)[0].content[1];
    expect(part.image_url).toBe(minimizeImageDataUrl(raw));
    expect(part.image_url).not.toBe(raw);
    expect(atob(part.image_url!.split(',')[1])).not.toContain('CANARY_META');
  });

  it.each([
    ['9 text parts', message(Array.from({ length: 9 }, (_, i) => text(`part ${i}`)))],
    ['2 images', message([text('look'), image(), image()])],
    ['image only', message([image()])],
    ['text total of 8193', message([text('a'.repeat(4096)), text('b'.repeat(4096)), text('c')])],
    ['an unknown part type', message([text('x'), { type: 'input_audio', data: 'RAW' }])],
    ['an extra key on a part', message([{ ...text('x'), cache: true }])],
    ['role assistant', [{ role: 'assistant', content: [text('x')] }]],
    ['two messages', [...message([text('x')]), ...message([text('y')])]],
    ['an empty content array', message([])],
    ['an extra key on the message', message([text('x')], { name: 'someone' })],
    ['a high-detail image', message([text('x'), { ...image(), detail: 'high' }])],
  ])('rejects %s as invalid_input without a provider call', async (_label, input) => {
    expect(decisionEvidenceSchema.safeParse(input).success).toBe(false);
    const provider = echoProvider();
    expect(await new DecisionService(provider).evaluate(context({ input, questions: predicates(1) }))).toMatchObject({ reason: 'invalid_input' });
    expect(provider.evaluate).not.toHaveBeenCalled();
  });
});

describe('deadline', () => {
  const pending = () => {
    const options: unknown[] = [];
    const provider: DecisionProvider = { evaluate: vi.fn((_i, _s, _a, o) => { options.push(o); return new Promise(() => {}); }) };
    return { provider, options };
  };
  const input = { input: 'text', questions: predicates(1) };

  it('defaults to 500 ms and hands it to the provider', async () => {
    vi.useFakeTimers();
    const { provider, options } = pending();
    let settled: unknown;
    void new DecisionService(provider).evaluate(context(input)).then((r) => { settled = r; });
    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBeUndefined();
    expect(options).toEqual([{ timeoutMs: 500 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ status: 'unknown', reason: 'timeout' });
  });

  it('honours a 2000 ms deadline, answering a provider that resolves at 1500 ms', async () => {
    vi.useFakeTimers();
    const options: unknown[] = [];
    const provider: DecisionProvider = { evaluate: vi.fn((i: DecisionInput, _s, _a, o) => { options.push(o); return new Promise((resolve) => setTimeout(() => resolve({ model: 'gpt-6-luna', answers: i.questions.map((q) => ({ name: q.name, type: 'predicate', probability: 0.9 })) }), 1500)); }) };
    let settled: unknown;
    void new DecisionService(provider).evaluate(context(input, { deadlineMs: 2000 })).then((r) => { settled = r; });
    await vi.advanceTimersByTimeAsync(1500);
    expect(options).toEqual([{ timeoutMs: 2000 }]);
    expect(settled).toMatchObject({ status: 'answered' });
  });

  it('clamps 9000 ms to 5000 ms', async () => {
    vi.useFakeTimers();
    const { provider, options } = pending();
    let settled: unknown;
    void new DecisionService(provider).evaluate(context(input, { deadlineMs: 9000 })).then((r) => { settled = r; });
    await vi.advanceTimersByTimeAsync(4999);
    expect(settled).toBeUndefined();
    expect(options).toEqual([{ timeoutMs: 5000 }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toMatchObject({ reason: 'timeout' });
  });

  it('times out at 5 ms (existing behaviour)', async () => {
    const { provider } = pending();
    expect(await new DecisionService(provider).evaluate(context(input, { deadlineMs: 5 }))).toMatchObject({ reason: 'timeout' });
  });

  it.each([NaN, 0, -1, Infinity])('treats deadline %s as invalid_input', async (deadlineMs) => {
    const provider = echoProvider();
    expect(await new DecisionService(provider).evaluate(context(input, { deadlineMs }))).toMatchObject({ reason: 'invalid_input' });
    expect(provider.evaluate).not.toHaveBeenCalled();
  });
});

describe('OpenAIDecisionProvider (S15 handoff)', () => {
  it('still sends timeout 500 and maxRetries 0 whatever options.timeoutMs says', async () => {
    const post = vi.fn(async () => ({}));
    // Through the interface: the class body (S15) still declares three parameters.
    const provider: DecisionProvider = new OpenAIDecisionProvider({ post } as never);
    await provider.evaluate({ input: 'text', questions: predicates(1) } as DecisionInput, new AbortController().signal, undefined, { timeoutMs: 2000 });
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]).toEqual(['/decisions', expect.objectContaining({ timeout: 500, maxRetries: 0 })]);
  });
});
