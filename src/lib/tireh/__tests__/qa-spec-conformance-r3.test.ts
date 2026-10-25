/**
 * QA wave A round 3 (spec-conformance lens). Pure unit tests: no network, no
 * providers, no filesystem.
 *
 * - The flag table in WAVE_A_INTEGRATION.md: every flag defaults off, and the
 *   two dependent flags stay off without their parent.
 * - Formerly a known gap written as `it.fails`, closed by fixer r2 on main and a
 *   plain `it` now: section 4.3 keeps an L3 record only
 *   "until superseded, revoked or expired", and section 4.6 lets a successor
 *   inherit only valid normal group/people/project records. S08's
 *   isSuccessorTransferable checks supersededBy only, so a record that S06 marks
 *   invalidated or expired was still copied to a successor under
 *   TIREH_SHARING_V2. It now takes the clock and refuses both.
 */
import { describe, expect, it } from 'vitest';
import { tirehFlags } from '../flags';
import { isSuccessorTransferable } from '../memory/sharing';
import { memory } from './fixtures';

describe('QA r3 spec conformance: flag table', () => {
  it('every Wave A flag defaults off with an empty environment', () => {
    expect(tirehFlags({})).toEqual({
      cachedPrompt: false, promptSystemTail: false, retrievalV2: false, vectorRetrieval: false,
      sharingV2: false, auditLog: false, decider: 'default', triageQuestionSet: 'v1',
      decisionLog: false, images: false, voiceRecognition: false, voiceShadow: false,
      webhookFailClosed: false,
    });
  });

  it('dependent flags need their parent flag', () => {
    expect(tirehFlags({ TIREH_PROMPT_SYSTEM_TAIL: '1' }).promptSystemTail).toBe(false);
    expect(tirehFlags({ TIREH_PROMPT_SYSTEM_TAIL: '1', TIREH_CACHED_PROMPT: '1' }).promptSystemTail).toBe(true);
    expect(tirehFlags({ TIREH_VECTOR_RETRIEVAL: '1' }).vectorRetrieval).toBe(false);
    expect(tirehFlags({ TIREH_VECTOR_RETRIEVAL: '1', TIREH_RETRIEVAL_V2: '1' }).vectorRetrieval).toBe(true);
    expect(tirehFlags({ TRIAGE_QUESTION_SET: 'v3' }).triageQuestionSet).toBe('v1');
    expect(tirehFlags({ STUDIO_DECIDER: 'openai' }).decider).toBe('default');
  });
});

describe('QA r3 spec conformance: successor filter (closed by fixer r2 on main)', () => {
  const past = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-10-25T00:00:00Z');
  const future = new Date('2026-12-01T00:00:00Z');

  it('a valid normal group record is transferable (positive control)', () => {
    expect(isSuccessorTransferable(memory({ content: 'Launch is Friday', scope: { kind: 'group', groupId: 'g-launch' } }), now)).toBe(true);
    expect(isSuccessorTransferable(memory({ content: 'Offsite in December', scope: { kind: 'group', groupId: 'g-launch' }, expiresAt: future }), now)).toBe(true);
  });

  it('an invalidated or expired record is not transferable', () => {
    expect(isSuccessorTransferable(memory({ content: 'Launch was Thursday', scope: { kind: 'group', groupId: 'g-launch' }, invalidatedAt: past }), now)).toBe(false);
    expect(isSuccessorTransferable(memory({ content: 'Offsite in March', scope: { kind: 'group', groupId: 'g-launch' }, expiresAt: past }), now)).toBe(false);
    expect(isSuccessorTransferable(memory({ content: 'Offsite today', scope: { kind: 'group', groupId: 'g-launch' }, expiresAt: now }), now)).toBe(false);
  });
});
