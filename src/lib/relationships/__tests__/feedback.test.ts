import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessFeedback, FEEDBACK_RETENTION_MS, FEEDBACK_TARGET_RETENTION_MS, forgetFeedback, OpenAIRelationshipFeedback, prepareFeedback, pruneFeedback, recordFeedback } from '../feedback';
import { emptyRelationship, InMemoryRelationshipStore } from '../store';
import { InMemoryObservationStore, SafeRelationshipObserver } from '../observer';
import type { FeedbackOutcome, FeedbackProvider, FeedbackScope, RelationshipKey, RelationshipState, TurnInput } from '../types';
import { StudioRelationshipAssessor } from '../../studio/relationship-assessor';

afterEach(() => vi.unstubAllEnvs());

const key: RelationshipKey = { personaId: 'aria', chatKey: 'private-a', audience: { kind: 'private', personId: 'a' } };
const now = new Date('2026-10-19T12:00:00Z');
const sentAt = new Date(now.getTime() - 60_000).toISOString();
function harness(text = 'That check-in helped. Thank you.') {
  const state = emptyRelationship(key);
  state.revision = 3; state.eventIds = ['origin', 'reply'];
  state.lastOutreach = { intentionId: 'intention-sensitive-id', messageId: '123', topic: 'boss', sourceIds: ['origin', 'memory-sensitive-id'], sentAt };
  const input: TurnInput = { ...key, eventId: 'reply', speakerId: 'a', text, at: now, source: 'telegram', contextEpoch: state.epoch,
    previousAssistant: { text: 'How did the conversation with your boss go?', at: new Date(sentAt), intentionId: state.lastOutreach.intentionId } };
  return { state, input, attempt: () => prepareFeedback(state, input, now) };
}
const classifier = (outcome: FeedbackOutcome, scope: FeedbackScope = 'message'): FeedbackProvider => ({ classify: vi.fn(async () => ({ outcome, scope })) });

describe('relationship feedback attribution and durable fences', () => {
  it.each([
    ['That check-in helped. Thank you.', 'helpful', 'message'],
    ["I didn't want this message.", 'unwanted', 'message'],
    ["Please don't ask about my boss again.", 'unwanted', 'topic'],
    ["I don't want you to start conversations with me anymore.", 'unwanted', 'global'],
    ['I meant my sister, not my boss.', 'correction', 'topic'],
    ['That was too much advice. Please listen first.', 'correction', 'message'],
    ['By the way, what time is it in Tokyo?', 'neutral', 'message'],
    ['It went well, thanks.', 'neutral', 'message'],
  ] as const)('stores only the bounded classified outcome: %s', async (text, outcome, scope) => {
    const h = harness(text); const provider = classifier(outcome, scope);
    const candidate = await assessFeedback(provider, h.attempt(), now);
    expect(recordFeedback(h.state, candidate, now)).toMatchObject({ outcome, scope, sourceId: 'reply', intentionId: 'intention-sensitive-id', messageId: '123', at: now.toISOString() });
    const saved = JSON.stringify(h.state.feedback);
    expect(saved).not.toContain(text); expect(saved).not.toContain(h.input.previousAssistant!.text);
    expect(h.state.feedback![0].sourceIds).toEqual(['reply', 'origin', 'memory-sensitive-id']);
    expect(h.state.disabled).toBe(false); // Classification cannot operate controls.
    expect(h.state.preferences).toEqual([]); // Praise alone is not a learned preference.
  });

  it('does not classify silence, unaccepted events or a new unrelated assistant reply', async () => {
    const h = harness(''); expect(h.attempt()).toBeUndefined();
    h.input.text = 'That helped'; h.input.eventId = 'not-accepted'; expect(h.attempt()).toBeUndefined();
    h.input.eventId = 'reply'; h.input.previousAssistant!.intentionId = undefined; expect(h.attempt()).toBeUndefined();
    h.input.previousAssistant!.intentionId = 'different-outreach'; expect(h.attempt()).toBeUndefined();
    const provider = classifier('helpful'); expect(await assessFeedback(provider, h.attempt(), now)).toBeUndefined();
    expect(provider.classify).not.toHaveBeenCalled();
  });

  it('requires a current relationship epoch captured before authorized history', () => {
    const h = harness(); delete h.input.contextEpoch; expect(h.attempt()).toBeUndefined();
    h.input.contextEpoch = 0; h.state.epoch = 1; expect(h.attempt()).toBeUndefined();
  });

  it('prevents cross-person, cross-persona and group attribution even with a matching intention marker', () => {
    const h = harness();
    for (const patch of [{ speakerId: 'b' }, { personaId: 'other' }, { chatKey: 'private-b' }, { audience: { kind: 'group', groupId: 'team' } as const }]) {
      expect(prepareFeedback(h.state, { ...h.input, ...patch }, now)).toBeUndefined();
    }
  });

  it('rejects duplicates, stale revisions, changed deliveries and source revocation after classification', async () => {
    for (const mutation of [
      (s: RelationshipState) => { s.revision++; },
      (s: RelationshipState) => { s.epoch++; },
      (s: RelationshipState) => { s.lastOutreach!.intentionId = 'later'; },
      (s: RelationshipState) => { s.lastOutreach!.sentAt = now.toISOString(); },
      (s: RelationshipState) => { s.forgottenSourceIds.push('memory-sensitive-id'); },
      (s: RelationshipState) => { s.eventIds = []; },
    ]) {
      const h = harness(); const candidate = await assessFeedback(classifier('helpful'), h.attempt(), now); mutation(h.state);
      expect(recordFeedback(h.state, candidate, now)).toBeUndefined(); expect(h.state.feedback ?? []).toEqual([]);
    }
    const h = harness(); const candidate = await assessFeedback(classifier('helpful'), h.attempt(), now);
    expect(recordFeedback(h.state, candidate, now)).toBeDefined();
    expect(recordFeedback(h.state, candidate, now)).toBeUndefined(); expect(h.attempt()).toBeUndefined();
  });

  it('bounds attribution to seven days and retained outcomes to thirty days and twenty-four records', async () => {
    const h = harness();
    h.state.lastOutreach!.sentAt = new Date(now.getTime() - FEEDBACK_TARGET_RETENTION_MS - 1).toISOString(); expect(h.attempt()).toBeUndefined();
    h.state.lastOutreach!.sentAt = sentAt;
    const candidate = await assessFeedback(classifier('helpful'), h.attempt(), now);
    for (let i = 0; i < 30; i++) { h.state.eventIds.push(`reply-${i}`); recordFeedback(h.state, { ...candidate!, sourceId: `reply-${i}` }, now); }
    expect(h.state.feedback).toHaveLength(24);
    pruneFeedback(h.state, new Date(now.getTime() + FEEDBACK_RETENTION_MS + 1));
    expect(h.state.feedback).toEqual([]); expect(h.state.lastOutreach).toBeUndefined();
  });

  it('forgets feedback on the source fact, feedback turn, or epoch invalidation without clearing stop controls', async () => {
    for (const id of ['memory-sensitive-id', 'reply']) {
      const h = harness(); recordFeedback(h.state, await assessFeedback(classifier('correction'), h.attempt(), now), now);
      forgetFeedback(h.state, [id]); expect(h.state.feedback).toEqual([]);
      if (id === 'memory-sensitive-id') expect(h.state.lastOutreach).toBeUndefined();
    }
    const h = harness(); recordFeedback(h.state, await assessFeedback(classifier('helpful'), h.attempt(), now), now);
    const store = new InMemoryRelationshipStore(); await store.update(key, (s) => { Object.assign(s, h.state); s.disabled = true; });
    await store.bumpEpoch(key.personaId); const fresh = await store.read(key);
    expect(fresh.feedback ?? []).toEqual([]); expect(fresh.lastOutreach).toBeUndefined(); expect(fresh.disabled).toBe(true);
    forgetFeedback(h.state); expect(h.state.feedback).toEqual([]); expect(h.state.lastOutreach).toBeUndefined();
  });

  it('drops provider failures, hangs and malformed scopes without breaking a conversation', async () => {
    const h = harness();
    const providers: FeedbackProvider[] = [{ classify: async () => { throw new Error('private provider body'); } }, { classify: () => new Promise(() => undefined) }, classifier('helpful', 'global')];
    for (const provider of providers) expect(await assessFeedback(provider, h.attempt(), now, 5)).toBeUndefined();
    expect(h.state.feedback ?? []).toEqual([]);
  });
});

describe('bounded feedback Decisions adapter', () => {
  const input = { text: 'That check-in helped.', previousAssistant: 'How did today go?', topic: 'boss', now };
  it('uses the Decisions choice API with explicit no-reply-reward criteria and bounded content', async () => {
    const fetcher = vi.fn(async () => Response.json({ answers: [{ type: 'choice', name: 'feedback', choice: 'helpful_message', confidence: 0.9 }] }));
    expect(await new OpenAIRelationshipFeedback('fake-key', fetcher).classify({ ...input, text: 'u'.repeat(30_000), previousAssistant: 'a'.repeat(30_000) })).toEqual({ outcome: 'helpful', scope: 'message' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; const body = JSON.parse(init.body as string);
    expect(url).toBe('https://api.openai.com/v1/decisions'); expect(body.model).toBe('gpt-6-luna'); expect(body.questions[0].type).toBe('choice');
    expect(body.questions[0].instructions).toContain('A reply, politeness, thanks alone'); expect(body.questions[0].instructions).toContain('Silence is missing evidence');
    expect(JSON.parse(body.input).currentUserMessage).toHaveLength(8000); expect(JSON.parse(body.input).previousAssistant).toHaveLength(4000);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([
    ['unwanted_topic', 'unwanted', 'topic'], ['unwanted_global', 'unwanted', 'global'], ['correction_message', 'correction', 'message'], ['correction_topic', 'correction', 'topic'], ['neutral_message', 'neutral', 'message'],
  ])('preserves the bounded scope of %s', async (choice, outcome, scope) => {
    expect(await new OpenAIRelationshipFeedback('test', async () => Response.json({ answers: [{ type: 'choice', name: 'feedback', choice, confidence: 0.9 }] })).classify(input)).toEqual({ outcome, scope });
  });
  it.each([
    { answers: [{ type: 'refusal', name: 'feedback' }] }, { answers: {} }, { answers: [{ type: 'choice', name: 'feedback', choice: 'helpful_message', confidence: 0.69 }] },
    { answers: [{ type: 'choice', name: 'feedback', choice: 'helpful_global', confidence: 0.9 }] }, { answers: [{ type: 'choice', name: 'feedback', choice: 'helpful_message', confidence: 2 }] },
  ])('drops refusal, malformed or uncertain provider evidence without recording neutral', async (response) => {
    const provider = new OpenAIRelationshipFeedback('test', async () => Response.json(response));
    await expect(provider.classify(input)).rejects.toThrow('result unavailable');
    expect(await assessFeedback(provider, harness().attempt(), now)).toBeUndefined();
  });
  it('bounds hung fetches, oversized bodies and provider errors', async () => {
    await expect(new OpenAIRelationshipFeedback('test', () => new Promise(() => undefined), 5).classify(input)).rejects.toThrow('timed out');
    await expect(new OpenAIRelationshipFeedback('test', async () => new Response('x'.repeat(70_000))).classify(input)).rejects.toThrow('exceeds limit');
    await expect(new OpenAIRelationshipFeedback('test', async () => new Response('sensitive private body', { status: 429 })).classify(input)).rejects.toThrow('Feedback Decisions request failed (429)');
  });
});

it('exports linked content-free pseudonymous feedback, isolated across relationships', async () => {
  const revision = 'a'.repeat(40);
  vi.stubEnv('STUDIO_REVISION', revision);
  const h = harness(); const receipt = recordFeedback(h.state, await assessFeedback(classifier('helpful'), h.attempt(), now), now)!;
  const store = new InMemoryObservationStore(); const observer = new SafeRelationshipObserver(store, 's'.repeat(32), () => now);
  await observer.emitFeedback(key, 'live', receipt); await observer.emitFeedback(key, 'live', receipt);
  await observer.emitFeedback({ ...key, chatKey: 'private-b', audience: { kind: 'private', personId: 'b' } }, 'live', receipt);
  const events = await store.recent(); expect(events).toHaveLength(3);
  expect(events[0].intentionHash).not.toBe(events[1].intentionHash); expect(events[1].intentionHash).toBe(events[2].intentionHash);
  expect(events[1]).toMatchObject({ type: 'feedback', outcome: 'helpful', feedbackScope: 'message', revision });
  expect(Object.keys(events[1]).sort()).toEqual(['id', 'at', 'schemaVersion', 'feature', 'mode', 'type', 'scope', 'scopeHash', 'policyVersion', 'decisionModel', 'outcome', 'feedbackScope', 'intentionHash', 'sourceHash', 'revision'].sort());
  const exported = JSON.stringify(events);
  for (const privateValue of [h.input.text, h.input.previousAssistant!.text, 'intention-sensitive-id', 'memory-sensitive-id', 'boss', 'private-a']) expect(exported).not.toContain(privateValue);
  await observer.emit(key, 'live', 'sent', undefined, receipt.intentionId);
  const sent = (await store.recent())[0]; expect(sent.intentionHash).toBe(events[1].intentionHash);
  expect(JSON.stringify(sent)).not.toContain(receipt.intentionId);
});

it('gives the assessor bounded preceding context for a direct correction without treating assistant claims as preferences', async () => {
  const complete = vi.fn(async () => '{"preferences":[{"key":"advice","value":"Listen before offering advice"}]}');
  const assessor = new StudioRelationshipAssessor({ complete });
  expect(await assessor.assess({ key, text: 'That was too much advice. Please listen first.', context: '', now,
    previousAssistant: { text: 'a'.repeat(9000), at: new Date(sentAt), intentionId: 'private-intention' } })).toEqual({ preferences: [{ key: 'advice', value: 'Listen before offering advice' }] });
  const call = complete.mock.calls[0] as unknown as [{ system: string; messages: Array<{ content: string }> }];
  // Thinking shares the cap: dated timing extraction keeps medium effort with headroom.
  expect(call[0]).toMatchObject({ maxTokens: 4096, effort: 'medium', requireComplete: true });
  expect(call[0].system).toContain('only from the current person\'s explicit statement');
  expect(call[0].system).toContain('Topic-specific feedback must not become a global communication preference');
  const body = JSON.parse(call[0].messages[0].content);
  expect(body.previousAssistant.text).toHaveLength(4000); expect(body.previousAssistant.at).toBe(sentAt);
  expect(JSON.stringify(body)).not.toContain('private-intention');
});
