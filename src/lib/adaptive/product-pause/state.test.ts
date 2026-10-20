import { expect, it } from 'vitest';
import { productPauseSchema, productPauseCommandSchema, PRODUCT_PAUSE_RESERVED_BYTES } from './contracts';
import { applyProductPauseCommand, compactProductPause, emptyProductPause, mayUseStoredPersonalization, productPauseUseStamp } from './state';
const command = (id: string, seq: number, action: 'pause' | 'resume', space: 'work' | 'personal' = 'work') =>
  ({ version: 1 as const, eventId: id.repeat(22), expectedCommandSeq: seq, action, space });
it('uses exact latest identity, consumes no-op seq, and never rebases a superseded command', () => {
  const a = command('a', 0, 'pause'), b = command('b', 1, 'resume');
  const first = applyProductPauseCommand(emptyProductPause(), 'owner', a, 1000);
  expect(applyProductPauseCommand(first.pause, 'owner', a, 2000)).toMatchObject({ replayed: true, receipt: first.receipt });
  expect(() => applyProductPauseCommand(first.pause, 'owner', { ...a, action: 'resume' }, 2000)).toThrow('product_pause_conflict');
  const second = applyProductPauseCommand(first.pause, 'owner', b, 2000);
  expect(() => applyProductPauseCommand(second.pause, 'owner', a, 3000)).toThrow('product_pause_stale');
  const before = productPauseUseStamp({ schemaVersion: 2, productPause: second.pause }, 'work');
  const noop = applyProductPauseCommand(second.pause, 'owner', command('c', 2, 'resume'), 3000);
  expect(noop.receipt).toMatchObject({ result: 'unchanged', seq: 3, resultingUseEpoch: 2 });
  expect(productPauseUseStamp({ schemaVersion: 2, productPause: noop.pause }, 'work')).toBe(before);
  expect(noop.pause.scopes[1]).toEqual(emptyProductPause().scopes[1]);
  expect(() => applyProductPauseCommand(first.pause, 'other-owner', a, 2000)).toThrow('product_pause_conflict');
});
it('strict canonical and compact versions fail closed, and maximum two-row proof fits reserved 2KiB', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const pause = emptyProductPause();
  for (const s of pause.scopes) Object.assign(s, { productPaused: true, commandSeq: maximum, useEpoch: maximum, latest: {
    eventId: '_'.repeat(128), fingerprint: 'f'.repeat(64), seq: maximum, result: 'unchanged', resultingUseEpoch: maximum, recordedAt: maximum } });
  expect(productPauseSchema.safeParse(pause).success).toBe(true);
  const maximumBlock = productPauseSchema.parse({ ...pause, scopes: pause.scopes.map(s => ({ ...s, productPaused: false })) });
  expect(Buffer.byteLength(JSON.stringify({ productPause: maximumBlock }))).toBe(927);
  expect(Buffer.byteLength(JSON.stringify({ productPause: maximumBlock }))).toBeLessThanOrEqual(PRODUCT_PAUSE_RESERVED_BYTES);
  expect(() => applyProductPauseCommand(pause, 'owner', command('a', maximum, 'pause'), maximum)).toThrow('product_pause_capacity');
  expect(mayUseStoredPersonalization({ schemaVersion: 2 }, 'work')).toBe(false);
  expect(mayUseStoredPersonalization({ schemaVersion: 1 }, 'work')).toBe(true);
  expect(mayUseStoredPersonalization({ schemaVersion: 1, productPause: emptyProductPause() }, 'work')).toBe(false);
  expect(mayUseStoredPersonalization({ schemaVersion: 2, productPause: compactProductPause(pause) }, 'work')).toBe(false);
  expect(productPauseSchema.safeParse({ ...pause, extra: true }).success).toBe(false);
  expect(productPauseSchema.safeParse({ version: 2, scopes: pause.scopes }).success).toBe(false);
  expect(productPauseSchema.safeParse({ version: 1, scopes: [...pause.scopes].reverse() }).success).toBe(false);
  expect(productPauseCommandSchema.safeParse({ ...command('a', 0, 'pause'), accountId: 'other' }).success).toBe(false);
  expect(productPauseCommandSchema.safeParse({ ...command('a', 0, 'pause'), eventId: 'short' }).success).toBe(false);
});
it('rejects missing or inconsistent latest proof and future trusted time', () => {
  const p = emptyProductPause(); p.scopes[0].commandSeq = 1;
  expect(productPauseSchema.safeParse(p).success).toBe(false);
  const applied = applyProductPauseCommand(emptyProductPause(), 'owner', command('a', 0, 'pause'), 100);
  expect(() => applyProductPauseCommand(applied.pause, 'owner', command('b', 1, 'resume'), 99)).toThrow('Invalid pause observation');
});
