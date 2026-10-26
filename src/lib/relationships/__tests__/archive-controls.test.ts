import { describe, expect, it } from 'vitest';
import { parseExplicitControl } from '../policy';
describe('explicit archive forget controls', () => {
  it.each(['forget everything I told you', 'Please forget everything that I told you.', 'forget everything I have told you', 'forget everything I said to you, please'])('recognizes the direct owner request: %s', text => {
    expect(parseExplicitControl(text)).toBe('forget');
  });
  it.each(['My friend said "forget everything I told you"', 'Do not forget everything I told you', 'Explain what "forget everything I told you" means', 'I asked them to forget everything I told you', '"forget everything I told you"'])('does not act on reported, negated, or quoted control: %s', text => {
    expect(parseExplicitControl(text)).toBeNull();
  });
});
