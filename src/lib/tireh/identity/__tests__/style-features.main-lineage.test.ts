/**
 * Main-lineage style-feature cases (S10L, earlier run 83848b7,
 * style-features.test.ts) ported onto the chosen wave A implementation
 * (aiq/identity-lib b34b7c0). Wave A's feature set is flat (kind, buckets,
 * ratios) where main's had a modality block; only shape-independent intents
 * are kept here. The rest are listed in
 * docs/implementation/agent-intelligence/WAVE_A_MAIN_INTEGRATION.md.
 */
import { describe, expect, it } from 'vitest';
import { extractStyleFeatures, styleFeaturesSchema } from '../style-features';

const AT = Date.UTC(2026, 9, 20, 9, 0);
const text = (value: string) => extractStyleFeatures({ kind: 'text', text: value, edited: false, at: AT });

describe('main-lineage: extractStyleFeatures Unicode safety and bounds', () => {
  it('does not throw on lone surrogates', () => {
    expect(() => text('\uD800abc')).not.toThrow();
    expect(() => text('abc\uDC00')).not.toThrow();
    expect(text('\uD800abc').latinScriptRatio).toBe(1);
  });

  it('gives empty measures for empty or whitespace-only text', () => {
    expect(text('').lengthBucket).toBe(0);
    for (const value of ['', '   \n\t ']) {
      const f = text(value);
      expect(f.wordBucket).toBe(0);
      expect(f.persianScriptRatio).toBeNull();
      expect(f.latinScriptRatio).toBeNull();
      expect(f.endsWithPunctuation).toBe(false);
      expect(styleFeaturesSchema.safeParse(f).success).toBe(true);
    }
  });

  it('bounds the work on a 100k-character input', () => {
    const big = 'سلام دنیا hello world :) '.repeat(4000).slice(0, 100_000);
    const start = performance.now();
    const f = text(big);
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(f.lengthBucket).toBe(6);
    expect(styleFeaturesSchema.safeParse(f).success).toBe(true);
  });

  it('returns objects without strings except the kind', () => {
    const f = text('سلام PRIVATE_TEXT');
    const strings: string[] = [];
    JSON.stringify(f, (_k, v) => { if (typeof v === 'string') strings.push(v); return v; });
    expect(strings).toEqual(['text']);
  });
});
