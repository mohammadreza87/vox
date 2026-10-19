import { describe, expect, it } from 'vitest';
import { selectAdaptiveContext } from '../memory/adaptive-context';
describe('Bounded authorized context packing', () => {
  it('ranks matching complete facts in English and Persian above unrelated records', () => {
    expect(selectAdaptiveContext(['Deadline is Monday.', 'جلسه سه شنبه است.', 'Use blue.'], 'جلسه deadline')).toEqual(['جلسه سه شنبه است.', 'Deadline is Monday.', 'Use blue.']);
  });
  it('caps actual serialized UTF-8 bytes and items, deduplicates and never truncates a fact', () => {
    const input = ['x'.repeat(9000), ...Array.from({ length: 30 }, (_, i) => `${i} ${'ی'.repeat(1500)}`), 'No: do not share this.'];
    const result = selectAdaptiveContext([...input, input.at(-1)!], 'share');
    expect(result[0]).toBe('No: do not share this.');
    expect(result.length).toBeLessThanOrEqual(12);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
    expect(result.every(value => input.includes(value))).toBe(true);
    expect(new Set(result).size).toBe(result.length);
    expect(selectAdaptiveContext(Array.from({ length: 30 }, (_, i) => String(i)), '')).toHaveLength(12);
  });
  it('does not invent missing context', () => { expect(selectAdaptiveContext([], 'private secret')).toEqual([]); });
});
