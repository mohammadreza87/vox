import { createHash } from 'crypto';
import { productPauseSchema, productPauseUseControlsSchema, productPauseCommandSchema,
  type ProductPauseAuthority, type ProductPauseV1, type ProductPauseUseControlsV1, type ProductPauseCommandV1,
  type ProductPauseReceiptV1 } from './contracts';
type Space = 'work' | 'personal';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function emptyProductPause(): ProductPauseV1 { return { version: 1, scopes: [
  { space: 'work', productPaused: false, useEpoch: 0, commandSeq: 0 },
  { space: 'personal', productPaused: false, useEpoch: 0, commandSeq: 0 },
] }; }
export function compactProductPause(pause: ProductPauseV1): ProductPauseUseControlsV1 {
  const p = productPauseSchema.parse(pause);
  return { version: 1, scopes: p.scopes.map(s => ({ space: s.space, productPaused: s.productPaused, useEpoch: s.useEpoch })) as ProductPauseUseControlsV1['scopes'] };
}
export function productPauseUseState(controls: ProductPauseAuthority, space: Space): { productPaused: boolean; useEpoch: number } {
  if (space !== 'work' && space !== 'personal') return { productPaused: true, useEpoch: 0 };
  if (controls.schemaVersion === 1 && controls.productPause === undefined) return { productPaused: false, useEpoch: 0 };
  if (controls.schemaVersion === 2) {
    const p = productPauseSchema.safeParse(controls.productPause);
    const compact = p.success ? p : productPauseUseControlsSchema.safeParse(controls.productPause);
    if (compact.success) { const s = compact.data.scopes[space === 'work' ? 0 : 1]; return { productPaused: s.productPaused, useEpoch: s.useEpoch }; }
  }
  return { productPaused: true, useEpoch: 0 };
}
export function mayUseStoredPersonalization(controls: ProductPauseAuthority, space: Space): boolean {
  return !productPauseUseState(controls, space).productPaused;
}
/** Legacy callers deliberately retain their old fingerprint bytes. */
export function productPauseUseStamp(controls: ProductPauseAuthority, space: Space): string {
  if (controls.schemaVersion === 1 && controls.productPause === undefined) return 'legacy-v1';
  return hash(['product-pause-use-v1', controls.schemaVersion, space, productPauseUseState(controls, space)]);
}
export class ProductPauseConflict extends Error {
  constructor(readonly code: 'product_pause_conflict' | 'product_pause_stale' | 'product_pause_capacity') { super(code); }
}
/** Pure canonical reducer. The caller provides actual sampled service time and owns revision/CAS commit. */
export function applyProductPauseCommand(pause: ProductPauseV1, owner: string, raw: ProductPauseCommandV1, now: number):
  { pause: ProductPauseV1; receipt: ProductPauseReceiptV1; replayed: boolean } {
  const command = productPauseCommandSchema.parse(raw), current = productPauseSchema.parse(pause);
  if (!Number.isSafeInteger(now) || now < 0 || current.scopes.some(s => s.latest && s.latest.recordedAt > now)) throw new Error('Invalid pause observation');
  const s = current.scopes[command.space === 'work' ? 0 : 1];
  const fingerprint = hash(['product-pause-command-v1', owner, command.space, command.expectedCommandSeq, command.action]);
  if (s.latest?.eventId === command.eventId) {
    if (s.latest.fingerprint !== fingerprint) throw new ProductPauseConflict('product_pause_conflict');
    return { pause: current, receipt: s.latest, replayed: true };
  }
  if (s.commandSeq !== command.expectedCommandSeq) throw new ProductPauseConflict('product_pause_stale');
  const requested = command.action === 'pause', changed = requested !== s.productPaused;
  if (s.commandSeq === Number.MAX_SAFE_INTEGER || changed && s.useEpoch === Number.MAX_SAFE_INTEGER) throw new ProductPauseConflict('product_pause_capacity');
  s.commandSeq++; if (changed) s.useEpoch++; s.productPaused = requested;
  s.latest = { eventId: command.eventId, fingerprint, seq: s.commandSeq, result: changed ? 'changed' : 'unchanged', resultingUseEpoch: s.useEpoch, recordedAt: now };
  return { pause: current, receipt: s.latest, replayed: false };
}
