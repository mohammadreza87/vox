import { describe, expect, it } from 'vitest';
import { IMAGE_KINDS, IMAGE_QUESTION_SET, IMAGE_TASKS, IMAGE_TRIAGE_QUESTIONS, imageTriageInput } from '../images';
import { MAX_TRIAGE_QUESTIONS } from '../triage';
import { testOrg } from './fixtures';

/** The S09 catalogue lint (shared contract); image questions pass it with no allowlist. */
const CATALOGUE_LINT = /\b(emotion\w*|mood\w*|stress\w*|attitude\w*|personalit\w*|health\w*|performance\w*|feel\w*)\b/i;

/** Caps of the base Decisions seam (src/lib/adaptive/decisions/index.ts). */
const SEAM_MAX_QUESTIONS = 7;
const SEAM_MAX_CHOICES = 16;

describe('image-v1 catalogue', () => {
  it('has the agreed question set name', () => {
    expect(IMAGE_QUESTION_SET).toBe('image-v1');
  });

  it('passes the catalogue lint without an allowlist', () => {
    const texts = IMAGE_TRIAGE_QUESTIONS.flatMap((q) => [q.instructions, ...(q.type === 'choice' ? q.choices.map((c) => c.description ?? c.value) : [])]);
    expect(texts.length).toBeGreaterThan(4);
    for (const text of texts) expect(text).not.toMatch(CATALOGUE_LINT);
  });

  it('asks exactly the four agreed questions with the contract enums', () => {
    expect(IMAGE_TRIAGE_QUESTIONS.map((q) => [q.name, q.type])).toEqual([
      ['image_kind', 'choice'], ['image_task', 'choice'], ['contains_people', 'predicate'], ['contains_sensitive_document', 'predicate'],
    ]);
    const choices = (name: string) => {
      const q = IMAGE_TRIAGE_QUESTIONS.find((x) => x.name === name);
      return q?.type === 'choice' ? q.choices.map((c) => c.value) : [];
    };
    expect(choices('image_kind')).toEqual(['screenshot', 'document', 'receipt', 'chart', 'photo_of_people', 'meme', 'other']);
    expect(choices('image_task')).toEqual(['explain', 'extract_text', 'decide', 'react', 'remember', 'unclear']);
    expect(choices('image_kind')).toEqual([...IMAGE_KINDS]);
    expect(choices('image_task')).toEqual([...IMAGE_TASKS]);
  });

  it('fits the base seam caps', () => {
    expect(IMAGE_TRIAGE_QUESTIONS.length).toBeLessThanOrEqual(Math.min(SEAM_MAX_QUESTIONS, MAX_TRIAGE_QUESTIONS));
    for (const q of IMAGE_TRIAGE_QUESTIONS) if (q.type === 'choice') expect(q.choices.length).toBeLessThanOrEqual(SEAM_MAX_CHOICES);
  });

  it('sends only the persona name and the caption as text', () => {
    const persona = testOrg().getPersona('aria')!;
    const input = imageTriageInput(persona, '  the bill  ');
    expect(input).toBe('Image shared with Aria in a private chat.\nCaption: the bill');
    expect(imageTriageInput(persona, '')).toBe('Image shared with Aria in a private chat.\nCaption: (none)');
    for (const leak of [persona.role, persona.personality ?? '', persona.communicationStyle ?? '', 'HOOR', 'Reza', 'GameEnd'].filter(Boolean)) {
      expect(input).not.toContain(leak);
    }
  });
});
