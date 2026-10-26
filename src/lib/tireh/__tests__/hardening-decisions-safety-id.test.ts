/**
 * H3 (F070, F121): section 4.8's hashed safety_identifier on Decisions requests.
 * Sent only when the runtime has a configured salt and the caller names a
 * subject; it is a salted sha256 prefix, never the raw person id. Without a
 * salt the request body is byte-identical to before. No network: the guarded
 * provider gets a fake fetch.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DecisionService, DECISIONS_MODEL, OpenAIDecisionProvider } from '../../adaptive/decisions';
import { ServiceDecider } from '../decisions/service-decider';
import { safetyIdentifierHasher } from '../decisions/readiness';
import type { DeciderAuthority, DecisionQuestion } from '../triage';

type Fetch = typeof globalThis.fetch;
const SALT = 'synthetic-salt-0123456789abcdef-0123456789';
const PERSON = 'person-tg-424242';
const questions: DecisionQuestion[] = [{ type: 'predicate', name: 'memorable', instructions: 'Is it worth remembering?' }];
const answer = { model: DECISIONS_MODEL, answers: [{ name: 'memorable', type: 'predicate', probability: 0.4 }] };

function harness(env: NodeJS.ProcessEnv) {
  const fetcher = vi.fn<Fetch>(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
  const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
  const safetyIdentifier = safetyIdentifierHasher(env);
  const decider = new ServiceDecider(new DecisionService(provider), { deadlineMs: 2000, ...(safetyIdentifier ? { safetyIdentifier } : {}) });
  const bodies = () => fetcher.mock.calls.map(([, init]) => String((init as RequestInit).body));
  return { decider, fetcher, bodies };
}
const authority = (subject?: string): DeciderAuthority => ({ authorize: async () => 'turn-key', ...(subject ? { subject } : {}) });

describe('safety_identifier on Decisions requests', () => {
  it('with a salt and a subject the body carries vox_ + 32 hex = the salted sha256 prefix, never the raw id', async () => {
    const h = harness({ DECISIONS_SAFETY_ID_SALT: SALT, STUDIO_SECRET: 'a-different-studio-secret-of-sufficient-length' });
    expect(await h.decider.decide('SYNTHETIC text', questions, 2000, authority(PERSON))).toEqual({ memorable: { type: 'predicate', probability: 0.4 } });
    expect(h.fetcher).toHaveBeenCalledOnce();
    const [raw] = h.bodies();
    const body = JSON.parse(raw) as Record<string, unknown>;
    const expected = `vox_${createHash('sha256').update(`${SALT}:${PERSON}`).digest('hex').slice(0, 32)}`;
    expect(body.safety_identifier).toBe(expected);
    expect(body.safety_identifier).toMatch(/^vox_[0-9a-f]{32}$/);
    expect(raw).not.toContain(PERSON);
    expect(raw).not.toContain(SALT);
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'prompt_cache_options', 'questions', 'safety_identifier']);
  });

  it('different subjects get different identifiers; the same subject the same one', async () => {
    const h = harness({ DECISIONS_SAFETY_ID_SALT: SALT });
    await h.decider.decide('a', questions, 2000, authority('person-a'));
    await h.decider.decide('b', questions, 2000, authority('person-a'));
    await h.decider.decide('c', questions, 2000, authority('person-b'));
    const ids = h.bodies().map((b) => (JSON.parse(b) as { safety_identifier?: string }).safety_identifier);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).not.toBe(ids[2]);
  });

  it('without a salt the body has no safety_identifier key and equals a call without a subject', async () => {
    const h = harness({});
    await h.decider.decide('SYNTHETIC text', questions, 2000, authority(PERSON));
    await h.decider.decide('SYNTHETIC text', questions, 2000, authority());
    const [withSubject, without] = h.bodies();
    expect(JSON.parse(withSubject)).not.toHaveProperty('safety_identifier');
    expect(withSubject).toBe(without);
    expect(withSubject).not.toContain(PERSON);
  });

  it('a salt that is too short or equals STUDIO_SECRET is ignored', async () => {
    expect(safetyIdentifierHasher({ DECISIONS_SAFETY_ID_SALT: 'short-salt' })).toBeUndefined();
    expect(safetyIdentifierHasher({ DECISIONS_SAFETY_ID_SALT: SALT, STUDIO_SECRET: SALT })).toBeUndefined();
    const h = harness({ DECISIONS_SAFETY_ID_SALT: SALT, STUDIO_SECRET: SALT });
    await h.decider.decide('SYNTHETIC text', questions, 2000, authority(PERSON));
    expect(JSON.parse(h.bodies()[0])).not.toHaveProperty('safety_identifier');
  });

  it('with a salt but no subject (callers that name nobody) the body has no safety_identifier', async () => {
    const h = harness({ DECISIONS_SAFETY_ID_SALT: SALT });
    await h.decider.decide('SYNTHETIC text', questions, 2000);
    await h.decider.decide('SYNTHETIC text', questions, 2000, authority());
    for (const body of h.bodies()) expect(JSON.parse(body)).not.toHaveProperty('safety_identifier');
  });

  it('a throwing or identity mapping never sends anything and never fails the decision', async () => {
    for (const map of [() => { throw new Error('boom'); }, (s: string) => s, () => '']) {
      const fetcher = vi.fn<Fetch>(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
      const decider = new ServiceDecider(new DecisionService(OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher)),
        { safetyIdentifier: map as (s: string) => string });
      expect(await decider.decide('x', questions, 2000, authority(PERSON))).toHaveProperty('memorable');
      const raw = String((fetcher.mock.calls[0][1] as RequestInit).body);
      expect(JSON.parse(raw)).not.toHaveProperty('safety_identifier');
      expect(raw).not.toContain(PERSON);
    }
  });

  it('the provider drops a non-opaque identifier instead of serialising it', async () => {
    const fetcher = vi.fn<Fetch>(async () => new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = OpenAIDecisionProvider.guarded({ apiKey: 'synthetic-only', dangerouslyAllowBrowser: true }, fetcher);
    await provider.evaluate({ input: 'x', questions: [{ type: 'predicate', name: 'memorable', instructions: 'Q?' }] }, new AbortController().signal, undefined,
      { safetyIdentifier: 'reza@example.com has spaces' });
    expect(JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body))).not.toHaveProperty('safety_identifier');
  });
});
