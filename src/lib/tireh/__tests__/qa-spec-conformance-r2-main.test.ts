/**
 * QA round 2 on main, lens spec-conformance. Known gaps written as `it.fails`
 * so the suite stays green; each turns red once the gap is closed, and must
 * then become a plain `it`.
 *
 * - SC2-1: fixer r1 (b142d00) made the gateway's flag-independent NO_MEMORY
 *   read memory/requests.ts NEGATED_MEMORY_REQUEST, whose "up to two words
 *   between" gap also spans "forget to". A request to keep something
 *   ("please don't forget to save this") is then read as "do not keep this",
 *   with every wave A flag unset (group memory, relationship observation)
 *   and for S12 image retention. Fails closed (less memory), but it changes
 *   base behaviour with flags unset and drops an explicit remember request.
 */

import { describe, expect, it } from 'vitest';
import { explicitMemoryRequest, negatedMemoryRequest } from '../memory/requests';

describe('QA r2 main spec-conformance: memory request negation', () => {
  it('control: plain negations and plain requests still classify as fixer r1 intended', () => {
    expect(negatedMemoryRequest("don't save this")).toBe(true);
    expect(negatedMemoryRequest('never save this')).toBe(true);
    expect(explicitMemoryRequest('remember this')).toBe(true);
  });

  for (const text of ["please don't forget to save this", "don't forget to remember this","don't forget to keep this"]) {
    it.fails(`SC2-1: "${text}" is a remember request, not a negation`, () => {
      expect(negatedMemoryRequest(text)).toBe(false);
      expect(explicitMemoryRequest(text)).toBe(true);
    });
  }
});
