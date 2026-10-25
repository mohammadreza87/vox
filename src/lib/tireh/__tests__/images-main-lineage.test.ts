/**
 * Cases from main's earlier S12 lineage (images-policy.test.ts and
 * images-questions.test.ts, d99e3a5) that compile and pass against the chosen
 * wave A image module. The cases that test main-only APIs (imagePolicy,
 * explicitRemember, replyDetail, ackText, IMAGE_QUESTIONS, imageTriageText) or
 * contradict wave A's reader are recorded in WAVE_A_MAIN_INTEGRATION.md (S12).
 */
import { describe, expect, it } from 'vitest';
import { forceQuickTriage, IMAGE_TRIAGE_TIMEOUT_MS, readImageTriage } from '../images';
import { TRIAGE_TIMEOUT_MS, type Triage } from '../triage';
import { imageAnswers } from './images-fixtures';

describe('forceQuickTriage (main lineage)', () => {
  it('turns a missing triage into a quick, search-free one and keeps skillAsked', async () => {
    const out = await forceQuickTriage(Promise.resolve({ triage: null as Triage | null, skillAsked: true }));
    expect(out.skillAsked).toBe(true);
    expect(out.triage).toEqual({ memorable: true, wantsVoice: false, effort: 'quick', needsWeb: false });
    expect(out.triage).not.toHaveProperty('skills');
  });

  it('keeps skills and skillsMiss and never mutates the original', async () => {
    const original = { triage: { effort: 'thoughtful', needsWeb: true, memorable: false, wantsVoice: true, skills: null, skillsMiss: 'low_confidence' } as Triage, skillAsked: true };
    const snapshot = JSON.stringify(original);
    const out = await forceQuickTriage(Promise.resolve(original));
    expect(out.triage).toEqual({ effort: 'quick', needsWeb: false, memorable: false, wantsVoice: true, skills: null, skillsMiss: 'low_confidence' });
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(out).not.toBe(original);
  });
});

describe('image triage timeout (main lineage)', () => {
  it('reuses the text triage timeout', () => {
    expect(IMAGE_TRIAGE_TIMEOUT_MS).toBe(TRIAGE_TIMEOUT_MS);
    expect(IMAGE_TRIAGE_TIMEOUT_MS).toBe(2000);
  });
});

describe('readImageTriage (main lineage)', () => {
  const good = () => imageAnswers({ kind: 'receipt', task: 'explain', people: 0.1, sensitive: 0.2 });

  it('reads a complete answer', () => {
    expect(readImageTriage(good())).toEqual({ kind: 'receipt', task: 'explain', containsPeople: 0.1, containsSensitiveDocument: 0.2 });
  });

  // Main also asserted null for a missing image_kind; wave A's reader reads it as 'other' (recorded as contradictory).
  it.each(['image_task', 'contains_people', 'contains_sensitive_document'])('returns null when %s is missing', (name) => {
    const answers = good();
    delete answers[name];
    expect(readImageTriage(answers)).toBeNull();
  });
});
