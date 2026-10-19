/** Budget only already-authorized context. Never use this ranker as an ACL.
 * Source/policy receipts still cover the full authorized set, not this subset. */
export function selectAdaptiveContext(context: readonly string[], query: string): string[] {
  const terms = new Set((query.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 128));
  const unique = [...new Set(context.filter(value => value.trim()))];
  const ranked = unique.map((value, index) => {
    const words = new Set(value.normalize('NFKC').toLocaleLowerCase('en').match(/[\p{L}\p{N}]{2,}/gu) ?? []);
    return { value, index, score: [...terms].filter(term => words.has(term)).length };
  }).sort((a, b) => b.score - a.score || b.index - a.index);
  const selected: string[] = [];
  for (const { value } of ranked) {
    if (selected.length >= 12) break;
    // Skip a whole record rather than truncating away a negation or qualification.
    if (Buffer.byteLength(JSON.stringify([...selected, value]), 'utf8') <= 8192) selected.push(value);
  }
  return selected;
}
