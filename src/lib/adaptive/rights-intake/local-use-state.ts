import { createHash } from 'node:crypto';
import type { AccountLedger } from './contracts';
import type { LocalUseIntent } from './local-use-contracts';
import { fail } from './repository';
/** Sorted-key canonical JSON; transport handles and serialization order are not command identity. */
export function localUseDigest(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, item]) => [k, stable(item)])) : v;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function localUseIntentDigest(accountId: string, intent: Omit<LocalUseIntent, 'intentDigest'> | LocalUseIntent): string {
  const { intentDigest: _digest, version: _version, ...command } = intent as LocalUseIntent;
  void _digest; void _version;
  return localUseDigest(['vox.rights.local-use.intent.v1', { accountId, ...command }]);
}
export function localUseExecutionDeadline(intent:LocalUseIntent):number { return Math.min(intent.reviewAt,intent.metadataRetainUntil,intent.replayRetainUntil,intent.receiptRetainUntil); }
export function validateLocalUseLedger(d: AccountLedger): void {
  if (d.version !== 3) return;
  const { intents, acknowledgements: acks } = d.localUse;
  if (new Set(intents.map(i => i.eventId)).size !== intents.length || new Set(acks.map(a => a.eventId)).size !== acks.length ||
      intents.some(i => i.createdAt > d.observedServerTime || i.intentDigest !== localUseIntentDigest(d.accountId, i) || !d.requests.some(r => r.requestId === i.requestId && r.space === i.scope.space && r.revision >= i.requestRevision && ['restriction', 'objection'].includes(r.kind)) || d.commandReceipts.some(r => r.eventId === i.eventId)) ||
      intents.filter(i => i.action === 'apply').some(i => intents.filter(other => other.action === 'apply' && other.effectId === i.effectId).length !== 1) ||
      intents.filter(i => i.action === 'release').some(i => {
        if (!intents.some(a => a.action === 'apply' && a.effectId === i.effectId && a.requestId === i.requestId && localUseDigest(a.scope) === localUseDigest(i.scope))) return true;
        const earlier = intents.slice(0,intents.indexOf(i)).filter(r => r.action === 'release' && r.effectId === i.effectId);
        const predecessor = earlier.at(-1);
        return predecessor ? i.supersedesEventId !== predecessor.eventId || predecessor.requestId !== i.requestId || localUseDigest(predecessor.scope) !== localUseDigest(i.scope) || predecessor.createdAt > i.createdAt || acks.some(a => a.eventId === predecessor.eventId) : i.supersedesEventId !== undefined;
      }) ||
      acks.some(a => { const i = intents.find(i => i.eventId === a.eventId); return !i || intents.some(s => s.supersedesEventId === i.eventId) || a.intentDigest !== i.intentDigest || a.effectId !== i.effectId || a.observedAt < i.createdAt || a.accountRevision <= i.expectedCanonicalRevision || a.useEpoch <= i.expectedUseEpoch || i.action === 'release' && a.effectRevision <= i.expectedEffectRevision! || a.recordedAt < a.observedAt || a.recordedAt > d.observedServerTime || a.retainUntil < i.receiptRetainUntil || a.retainUntil <= a.recordedAt || i.action === 'release' && a.effectState !== 'released'; })) return fail(503, 'rights_storage_unavailable');
}
/** Reserve complete maximum-schema future release + both missing acknowledgements.
 * All normal RI writers invoke this at the repository boundary. Six JSON UTF8
 * bytes per bounded code unit cover escaping, including surrogate input. */
export function requireLocalUseCapacity(d: AccountLedger): void {
  if (d.version !== 3) return;
  const projected = structuredClone(d), rows = projected.localUse, max = Number.MAX_SAFE_INTEGER;
  const ackFor = (i: LocalUseIntent) => ({ version: 1 as const, eventId: i.eventId, intentDigest: 'f'.repeat(64), effectId: i.effectId, accountRevision: max, useEpoch: max, effectRevision: max, effectDigest: 'f'.repeat(64), effectState: 'released' as const, observedAt: max, recordedAt: max, retainUntil: max });
  const applies = d.localUse.intents.filter(i => i.action === 'apply');
  for (const apply of applies) {
    const head = d.localUse.intents.filter(i => i.action === 'release' && i.effectId === apply.effectId).at(-1);
    const released = head && d.localUse.acknowledgements.some(a => a.eventId === head.eventId && a.effectState === 'released');
    if (released) continue;
    // First release plus one replacement; an existing current release already
    // occupies the first slot. Historical excluded rows remain actual usage.
    const futureCount = head ? 1 : 2;
    for(let index=0;index<futureCount;index++) {
      const placeholder: LocalUseIntent = { ...apply, eventId: apply.effectId, action: 'release', supersedesEventId: head?.eventId ?? apply.eventId, expectedEffectRevision: max, expectedEffectDigest: 'f'.repeat(64), policy: { id: '\u0000'.repeat(100), revision: max, digest: 'f'.repeat(64), approvalReference: '\u0000'.repeat(200), decisionReference: '\u0000'.repeat(200) }, notice: { version: '\u0000'.repeat(100), digest: 'f'.repeat(64) } };
      rows.intents.push(placeholder); rows.acknowledgements.push(ackFor(placeholder));
    }
  }
  for (const intent of d.localUse.intents) if (!d.localUse.acknowledgements.some(a => a.eventId === intent.eventId) && !d.localUse.intents.some(s => s.supersedesEventId === intent.eventId)) rows.acknowledgements.push(ackFor(intent));
  if (rows.intents.length > 128 || rows.acknowledgements.length > 128) return fail(409, 'rights_capacity');
  const widen = (v: unknown): unknown => typeof v === 'number' ? max : Array.isArray(v) ? v.map(widen) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, item]) => [k, widen(item)])) : v;
  if (Buffer.byteLength(JSON.stringify(widen(projected)), 'utf8') > 65_536 || d.revision >= max - (rows.intents.length + rows.acknowledgements.length + 1)) return fail(409, 'rights_capacity');
}
/** No reviewed local-control retirement capability exists in RF1. Minimum
 * floors are not permission to discard dependencies or the linked legal row. */
export function hasLocalUseDependency(d: AccountLedger, requestId: string): boolean {
  return d.version === 3 && d.localUse.intents.some(i => i.requestId === requestId);
}
