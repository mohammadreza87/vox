/**
 * QA round 2, lens code-quality (wave A on main). Known gaps pinned as
 * `it.fails`: each case asserts the intended behaviour and is expected to fail
 * until the fix lands; when a fix lands, vitest reports the case as passing
 * unexpectedly, and `it.fails` must then become `it`.
 *
 *  - CQ2-1: memory/requests.ts NEGATED_MEMORY_REQUEST allows at most two words
 *    between the negation and the verb and knows no modal negation, so the
 *    most natural refusals ("I don't want you to remember this", "you
 *    shouldn't keep this", Persian "نمی‌خوام ... یادت بمونه") are read as
 *    explicit remember requests: extraction runs on that image turn.
 *  - CQ2-2: MEMORY_REQUEST matches "remember this" inside a question or a
 *    statement about the person's own memory, so "do you remember this?" is
 *    an explicit remember request on an image turn.
 *  - CQ2-3: withAuditRetention swallows a failed vox_audit sweep with no
 *    content-free signal (the decision-log sink reports through onError).
 */

import { describe, expect, it, vi } from 'vitest';
import { explicitRememberRequest, suppressImageMemory, type ImageTriage } from '../images';
import { explicitMemoryRequest, negatedMemoryRequest } from '../memory/requests';
import { InMemoryAuditStore, withAuditRetention } from '../audit';

const explainTriage: ImageTriage = { kind: 'other', task: 'explain', containsPeople: 0, containsSensitiveDocument: 0 };

describe('CQ2-1: a refusal phrased with a modal or a longer gap is a negation', () => {
  for (const caption of [
    "I don't want you to remember this",
    'I do not want you to save this photo',
    "you shouldn't keep this",
    'نمی‌خوام اینو یادت بمونه',
  ]) {
    it.fails(`"${caption}" is not an explicit remember request and suppresses image memory`, () => {
      expect(negatedMemoryRequest(caption)).toBe(true);
      expect(explicitRememberRequest(caption)).toBe(false);
      expect(suppressImageMemory(explainTriage, caption)).toBe(true);
    });
  }

  it('control: the r1 cases still hold', () => {
    for (const caption of ["don't keep this", 'never save this', 'dont save this', "please don't ever save this", 'ذخیره‌اش نکن']) {
      expect(explicitMemoryRequest(caption)).toBe(false);
    }
    expect(explicitMemoryRequest('please remember this')).toBe(true);
    expect(explicitMemoryRequest('این را ذخیره کن')).toBe(true);
  });
});

describe('CQ2-2: a question about memory is not a request to keep the image', () => {
  for (const caption of ['do you remember this?', "I can't remember this place, where is it?"]) {
    it.fails(`"${caption}" is not an explicit remember request`, () => {
      expect(explicitRememberRequest(caption)).toBe(false);
      expect(suppressImageMemory(explainTriage, caption)).toBe(true);
    });
  }
});

describe('CQ2-3: a failed audit sweep leaves a content-free signal', () => {
  it.fails('withAuditRetention reports a rejected sweep through an onError option', async () => {
    const inner = new InMemoryAuditStore();
    vi.spyOn(inner, 'sweep').mockRejectedValue(new Error('unavailable'));
    const onError = vi.fn();
    const store = withAuditRetention(inner, { now: () => new Date('2026-10-25T00:00:00Z'), ...({ onError } as object) });
    await store.append({ kind: 'write', personaId: 'aria', memoryIds: ['m1'], audiencePersonIds: [], outcome: 'applied', at: new Date('2026-10-25T00:00:00Z') });
    await store.flush();
    expect(onError).toHaveBeenCalledWith('sweep_failed');
  });
});
