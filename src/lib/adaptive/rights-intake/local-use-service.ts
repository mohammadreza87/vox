import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { accountIdFor } from '../persistence/repository';
import type { RightsUseHoldService } from '../rights-use-holds/service';
import { RightsError, RightsReplay, fail, type RightsRepository } from './repository';
import { rightsPolicySchema, type RightsPolicy } from './policy';
import type { RightsOptions } from './service';
import type { AccountLedger, RightsSpace } from './contracts';
import { localUseActionInputSchema, localUsePlanInputSchema, localUseScopeSchema, localUseStatusSchema, type LocalUseActionInput, type LocalUseIntent, type LocalUsePlanInput, type LocalUseScope, type LocalUseStatus } from './local-use-contracts';
import { localUseDigest, localUseIntentDigest, localUseExecutionDeadline } from './local-use-state';

type Policy = Extract<RightsPolicy, { version: 2 | 3 }>;
type Backend = RightsUseHoldService;
type Descriptor = Extract<ReturnType<Backend['inspectNow']>, { status: 'ready' }>['value']['effects'][number];
const number = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), hash = z.string().regex(/^[a-f0-9]{64}$/);
const tokenSchema = z.object({ version: z.literal(1), accountRef: hash, requestId: z.uuidv4(), requestRevision: number.positive(), scope: localUseScopeSchema,
  action: z.enum(['apply', 'release']), supersedesEventId: z.uuidv4().optional(), effectId: z.uuidv4().optional(), expectedEffectRevision: number.positive().optional(), expectedEffectDigest: hash.optional(),
  accountRevision: number.positive(), useEpoch: number, policyDigest: hash, notice: z.object({ version: z.string().min(1).max(100), digest: hash }).strict(), issuedAt: number, expiresAt: number }).strict();
type Token = z.infer<typeof tokenSchema>;
const add = (now: number, duration: number) => { if (!Number.isSafeInteger(now + duration) || duration <= 0) return fail(503, 'reviewed_policy_unavailable'); return now + duration; };
const bump = (n: number) => { if (!Number.isSafeInteger(n + 1)) return fail(409, 'rights_capacity'); return n + 1; };
const sameScope = (a: LocalUseScope, b: LocalUseScope) => a.space === b.space && a.purpose === b.purpose;
export interface LocalUseView { version: 1; status: LocalUseStatus; availableActions: Array<'apply' | 'release'> }

/** Request-local workflow. The canonical service is the sole effect authority;
 * this ledger records only the exact requester's intent and current proof. */
export class RightsLocalUseWorkflow {
  constructor(readonly repository: RightsRepository, readonly options: RightsOptions) {}
  private backend(): Backend { return this.options.localUse ?? fail(503, 'rights_local_use_unsupported'); }
  private now(d?: AccountLedger | null): number {
    this.options.assertRequestNow?.(); const now = (this.options.clock ?? Date.now)();
    if (!Number.isSafeInteger(now) || now < 0 || now < (d?.observedServerTime ?? 0)) return fail(503, 'rights_clock_unavailable');
    this.repository.observeTime(now); this.options.assertRequestNow?.(); return now;
  }
  private auth(id: number): void { this.options.assertRequestNow?.(); this.options.assertAccountNow(id); this.options.assertRequestNow?.(); }
  private read(id: number): AccountLedger | null { this.auth(id); const d = this.repository.read(accountIdFor(id)); this.now(d); return d; }
  private row(d: AccountLedger | null, requestId: string, space: RightsSpace) {
    const r = d?.requests.find(r => r.requestId === requestId && r.space === space);
    return r ?? fail(404, 'not_found');
  }
  private policy(now: number): Policy | undefined {
    const parsed = rightsPolicySchema.safeParse(this.options.policy());
    if (!parsed.success || (parsed.data.version !== 2 && parsed.data.version !== 3) || this.options.key?.length !== 32 || parsed.data.effectiveAt > now || parsed.data.expiresAt <= now) return;
    if (Object.entries(parsed.data.localFulfillment).some(([k, value]) => k.endsWith('Ms') && typeof value === 'number' && !Number.isSafeInteger(now + value))) return;
    return parsed.data;
  }
  private requirePolicy(scope: LocalUseScope, action: 'apply' | 'release' | 'reconcile', expected?: Policy): Policy {
    const p = this.policy(this.now());
    const name = action === 'apply' ? 'apply_local_use_hold' : action === 'release' ? 'release_local_use_hold' : 'reconcile_recorded_effect';
    if (!p || !p.localFulfillment.purposes.includes(scope.purpose) || !p.localFulfillment.allowedActions.includes(name) || expected && localUseDigest(p) !== localUseDigest(expected)) return fail(503, action === 'release' ? 'rights_release_not_allowed' : 'reviewed_policy_unavailable');
    return p;
  }
  private key(): Buffer { if (this.options.key?.length !== 32) return fail(503, 'reviewed_policy_unavailable'); return createHmac('sha256', this.options.key).update('vox-rights-local-use-plan:v1').digest(); }
  private accountRef(id: number): string { return createHmac('sha256', this.key()).update(accountIdFor(id)).digest('hex'); }
  private seal(token: Token): string { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv); cipher.setAAD(Buffer.from('vox-rights-local-use-plan:v1')); const body = Buffer.concat([cipher.update(JSON.stringify(token)), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url'); }
  private open(raw: string, id: number, requestId: string): Token {
    try {
      if (!/^[A-Za-z0-9_-]{40,4096}$/.test(raw)) return fail(403, 'operation_handle_invalid');
      const bytes = Buffer.from(raw, 'base64url'); if (bytes.toString('base64url') !== raw) return fail(403, 'operation_handle_invalid');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0,12)); decipher.setAAD(Buffer.from('vox-rights-local-use-plan:v1')); decipher.setAuthTag(bytes.subarray(12,28));
      const token = tokenSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')));
      if (token.accountRef !== this.accountRef(id) || token.requestId !== requestId || token.expiresAt <= token.issuedAt || token.action === 'apply' && token.supersedesEventId !== undefined || (token.action === 'release') !== !!token.effectId || (token.action === 'release') !== (token.expectedEffectRevision !== undefined && token.expectedEffectDigest !== undefined)) return fail(403, 'operation_handle_invalid');
      return token;
    } catch (e) { if (RightsError.is(e)) throw e; return fail(403, 'operation_handle_invalid'); }
  }
  private unknown(scope: LocalUseScope, reason: LocalUseStatus['reason']): LocalUseView { return { version: 1, status: { version: 1, scope, technical: { current: 'unknown', reconciliation: 'none' }, effectiveBlocked: null, observedAt: null, useEpoch: null, reason }, availableActions: [] }; }
  status(id: number, requestId: string, scope: LocalUseScope): LocalUseView {
    z.uuidv4().parse(requestId); localUseScopeSchema.parse(scope);
    const d = this.read(id), row = this.row(d, requestId, scope.space);
    if ((d?.version !== 3 && d?.version !== 4) || !this.options.localUse) return this.unknown(scope, 'storage_unsupported');
    const read = this.backend().inspectNow(id, scope, () => this.auth(id));
    if (read.status !== 'ready') return this.unknown(scope, read.status === 'unsupported' ? 'storage_unsupported' : 'authority_unavailable');
    const value = read.value, intents = d.localUse.intents.filter(i => i.requestId === requestId && sameScope(i.scope, scope));
    const latest = intents.at(-1), effect = value.effects.filter(e => e.requestId === requestId).at(-1);
    const now=this.now(d);
    const expiredAbsent=(i:LocalUseIntent)=>i.action==='apply' && now>=localUseExecutionDeadline(i) && value.observedAt>=localUseExecutionDeadline(i) && !value.effects.some(e=>e.effectId===i.effectId);
    const pending = intents.find(i => !d.localUse.acknowledgements.some(a => a.eventId === i.eventId) && !intents.some(s => s.supersedesEventId === i.eventId) && !expiredAbsent(i));
    const matching = pending && effect && this.matches(pending, effect);
    const linked = !effect || intents.some(i => i.action === 'apply' && this.matches(i,effect));
    const reconciliation = pending ? 'pending' : intents.some(i=>d.localUse.acknowledgements.some(a=>a.eventId===i.eventId)) ? 'recorded' : 'none';
    const status: LocalUseStatus = { version: 1, scope, ...(effect ? { selectedEffectId: effect.effectId } : {}), technical: { current: effect?.state ?? 'not_applied', reconciliation }, effectiveBlocked: value.effectiveBlocked, observedAt: value.observedAt, useEpoch: value.useEpoch,
      reason: !linked ? 'authority_unavailable' : pending ? matching ? 'receipt_pending' : 'intent_pending' : null };
    const availableActions: LocalUseView['availableActions'] = [];
    if (linked && !pending) {
      try { this.requirePolicy(scope, 'apply'); if (row.state !== 'closed_unfulfilled' && ['restriction','objection'].includes(row.kind) && effect?.state !== 'active') availableActions.push('apply'); } catch { /* Readable current proof is independent of admission policy. */ }
    }
    // A proven active effect can be deliberately released even if its apply ack
    // failed. Release is a distinct command, never an automatic apply retry.
    try { this.requirePolicy(scope, 'release'); if (effect?.state === 'active' && ['restriction','objection'].includes(row.kind) && linked && !!latest && (!pending || pending.action === 'apply' && matching || pending.action === 'release')) availableActions.push('release'); } catch { /* No implicit release policy. */ }
    if (!availableActions.length && status.reason === null && !this.policy(this.now(d))) status.reason = 'policy_unavailable';
    this.auth(id); return { version: 1, status: localUseStatusSchema.parse(status), availableActions };
  }
  plan(id: number, requestId: string, space: RightsSpace, raw: LocalUsePlanInput) {
    const input = localUsePlanInputSchema.parse(raw), scope = { space, purpose: input.purpose }, d = this.read(id), row = this.row(d, requestId, space);
    if ((d?.version !== 3 && d?.version !== 4)) return fail(503, 'rights_local_use_unsupported');
    const p = this.requirePolicy(scope, input.action), view = this.status(id, requestId, scope);
    if (!view.availableActions.includes(input.action)) return fail(409, 'rights_conflict');
    const current = this.backend().inspectNow(id, scope, () => this.auth(id)); if (current.status !== 'ready') return fail(503, 'rights_local_use_unavailable');
    const effect = input.action === 'release' ? current.value.effects.find(e => e.effectId === (input.effectId ?? view.status.selectedEffectId) && e.requestId === requestId && e.state === 'active') : undefined;
    if (input.action === 'release' && !effect || input.action === 'apply' && input.effectId) return fail(409, 'rights_conflict');
    const superseded = input.action === 'release' && effect ? d.localUse.intents.filter(i => i.action === 'release' && i.effectId === effect.effectId && !d.localUse.acknowledgements.some(a => a.eventId === i.eventId) && !d.localUse.intents.some(s => s.supersedesEventId === i.eventId)).at(-1) : undefined;
    const now = this.now(d), expiresAt = Math.min(p.expiresAt, add(now, p.localFulfillment.handleLifetimeMs));
    const token: Token = { version: 1, accountRef: this.accountRef(id), requestId, requestRevision: row.revision, scope, action: input.action, ...(superseded ? {supersedesEventId:superseded.eventId} : {}), ...(effect ? { effectId: effect.effectId, expectedEffectRevision: effect.revision, expectedEffectDigest: effect.effectDigest } : {}), accountRevision: current.value.accountRevision, useEpoch: current.value.useEpoch, policyDigest: localUseDigest(p), notice: { version: p.localFulfillment.noticeVersion, digest: p.localFulfillment.noticeHashes[input.locale] }, issuedAt: now, expiresAt };
    this.auth(id); this.requirePolicy(scope, input.action, p);
    return { version: 1 as const, action: input.action, scope, planHandle: this.seal(token), expiresAt };
  }
  private matches(intent: LocalUseIntent, effect: Descriptor): boolean { return effect.effectId === intent.effectId && effect.requestId === intent.requestId && effect.space === intent.scope.space && effect.purpose === intent.scope.purpose && (intent.action === 'apply' ? effect.applyIntentDigest : effect.releaseIntentDigest) === intent.intentDigest; }
  private intentGuard(id: number, intent: LocalUseIntent, p: Policy): void {
    this.auth(id); this.requirePolicy(intent.scope, intent.action, p);
    const d = this.read(id); if ((d?.version !== 3 && d?.version !== 4)) return fail(503, 'rights_local_use_unsupported');
    const stored = d.localUse.intents.find(i => i.eventId === intent.eventId), row = this.row(d, intent.requestId, intent.scope.space);
    if (!stored || d.localUse.intents.some(s => s.supersedesEventId === intent.eventId) || localUseDigest(stored) !== localUseDigest(intent) || stored.intentDigest !== localUseIntentDigest(accountIdFor(id), stored) || row.revision !== intent.requestRevision || intent.action === 'apply' && row.state === 'closed_unfulfilled' || this.now(d) >= localUseExecutionDeadline(intent)) return fail(409, 'rights_conflict');
  }
  private async acknowledge(id: number, intent: LocalUseIntent, p: Policy, operatorGuard?: () => void): Promise<void> {
    const guard = () => { this.auth(id); operatorGuard?.(); this.requirePolicy(intent.scope, operatorGuard ? 'reconcile' : intent.action, p); };
    const proof = this.backend().receiptNow(id, intent.scope, intent.effectId, guard);
    if (proof.status !== 'ready' || !proof.value.effect || !this.matches(intent, proof.value.effect)) return fail(409, 'rights_conflict');
    const current = proof.value, effect = current.effect!;
    try { await this.repository.transaction(accountIdFor(id), () => this.now(), d => {
      if ((d.version !== 3 && d.version !== 4)) return fail(503, 'rights_local_use_unsupported');
      const stored = d.localUse.intents.find(i => i.eventId === intent.eventId); if (!stored || d.localUse.intents.some(s => s.supersedesEventId === intent.eventId) || localUseDigest(stored) !== localUseDigest(intent)) return fail(409, 'rights_conflict');
      if (d.localUse.acknowledgements.some(a => a.eventId === intent.eventId)) throw new RightsReplay();
      const now = this.now(d), retainUntil = Math.max(intent.receiptRetainUntil, add(now, p.localFulfillment.receiptRetentionMs));
      d.localUse.acknowledgements.push({ version: 1, eventId: intent.eventId, intentDigest: intent.intentDigest, effectId: intent.effectId, accountRevision: current.accountRevision, useEpoch: current.useEpoch, effectRevision: effect.revision, effectDigest: effect.effectDigest, effectState: effect.state, observedAt: current.observedAt, recordedAt: now, retainUntil }); d.revision = bump(d.revision);
    }, () => {
      guard(); const final = this.backend().receiptNow(id, intent.scope, intent.effectId, guard);
      if (final.status !== 'ready' || !final.value.effect || !this.matches(intent, final.value.effect) || final.value.effect.effectDigest !== effect.effectDigest || final.value.useEpoch !== current.useEpoch || final.value.accountRevision !== current.accountRevision) return fail(409, 'rights_conflict');
    }); } catch (e) { if (!(e instanceof RightsReplay)) throw e; }
  }
  async act(id: number, requestId: string, space: RightsSpace, raw: LocalUseActionInput) {
    const input = localUseActionInputSchema.parse(raw), token = this.open(input.planHandle, id, requestId), accountId = accountIdFor(id);
    if (token.scope.space !== space || token.action !== input.action) return fail(409, 'rights_conflict');
    const fp = localUseDigest(['vox.rights.local-use.command.v1', { accountId, requestId, scope: token.scope, action: input.action, eventId: input.eventId, policyDigest: token.policyDigest, notice: token.notice, ...(token.supersedesEventId ? {supersedesEventId:token.supersedesEventId} : {}), ...(token.effectId ? { selectedEffectId: token.effectId } : {}) }]);
    const initial = this.read(id); if ((initial?.version !== 3 && initial?.version !== 4)) return fail(503, 'rights_local_use_unsupported');
    const known = initial.localUse.intents.find(i => i.eventId === input.eventId);
    if (known) {
      if (known.fingerprint !== fp) return fail(409,'rights_conflict');
      const proof=this.backend().receiptNow(id,known.scope,known.effectId,()=>this.auth(id));
      if (initial.localUse.intents.some(s=>s.supersedesEventId===known.eventId) || proof.status==='ready' && proof.value.effect && (this.matches(known,proof.value.effect) || proof.value.effect.state==='released')) return {...this.status(id,requestId,token.scope),replayed:true};
      const p=this.requirePolicy(known.scope,known.action),now=this.now(initial);
      if(token.expiresAt<=now || token.issuedAt>now || token.policyDigest!==localUseDigest(p)) return fail(403,'operation_handle_invalid');
      // Only another explicit requester POST retries this exact immutable
      // command. Status/reconcile never enter execution or rebase its CAS.
      return this.execute(id,known,p,true);
    }
    const p = this.requirePolicy(token.scope, input.action), now = this.now(initial);
    if (token.issuedAt > now || token.expiresAt <= now || token.policyDigest !== localUseDigest(p)) return fail(403, 'operation_handle_invalid');
    const row = this.row(initial, requestId, space);
    if (row.revision !== token.requestRevision || !['restriction','objection'].includes(row.kind) || input.action === 'apply' && row.state === 'closed_unfulfilled') return fail(409, 'rights_conflict');
    const intent: LocalUseIntent = { version: 1, eventId: input.eventId, fingerprint: fp, intentDigest: '', requestId, requestRevision: row.revision, scope: token.scope, action: input.action, ...(token.supersedesEventId ? {supersedesEventId:token.supersedesEventId} : {}), effectId: token.effectId ?? randomUUID(), createdAt: now, expectedCanonicalRevision: token.accountRevision, expectedUseEpoch: token.useEpoch,
      ...(token.expectedEffectRevision !== undefined ? { expectedEffectRevision: token.expectedEffectRevision, expectedEffectDigest: token.expectedEffectDigest! } : {}),
      policy: { id: p.id, revision: p.revision, digest: localUseDigest(p), approvalReference: p.localFulfillment.approvalReference, decisionReference: p.localFulfillment.decisionReference }, notice: token.notice,
      reviewAt: add(now,p.localFulfillment.reviewAfterMs), metadataRetainUntil: add(now,p.localFulfillment.metadataRetentionMs), replayRetainUntil: add(now,p.localFulfillment.replayRetentionMs), receiptRetainUntil: add(now,p.localFulfillment.receiptRetentionMs) };
    intent.intentDigest = localUseIntentDigest(accountId, intent);
    let recoveryIntents:LocalUseIntent[]=[];
    try { await this.repository.transaction(accountId, () => this.now(), d => {
      if ((d.version !== 3 && d.version !== 4)) return fail(503, 'rights_local_use_unsupported');
      const existing = d.localUse.intents.find(i => i.eventId === input.eventId);
      if (existing) { if (existing.fingerprint !== fp) return fail(409, 'rights_conflict'); throw new RightsReplay(); }
      const r = this.row(d, requestId, space); if (r.revision !== intent.requestRevision || input.action === 'apply' && r.state === 'closed_unfulfilled' || d.commandReceipts.some(r => r.eventId === input.eventId)) return fail(409, 'rights_conflict');
      if (intent.action === 'apply') recoveryIntents=d.localUse.intents.filter(i=>i.action==='apply' && i.requestId===requestId && sameScope(i.scope,intent.scope) && !d.localUse.acknowledgements.some(a=>a.eventId===i.eventId));
      if (intent.action === 'release') {
        const head=d.localUse.intents.filter(i=>i.action==='release' && i.effectId===intent.effectId).at(-1);
        if(head ? intent.supersedesEventId !== head.eventId || d.localUse.acknowledgements.some(a=>a.eventId===head.eventId) : intent.supersedesEventId !== undefined) return fail(409,'rights_conflict');
      }
      d.localUse.intents.push(intent); d.revision = bump(d.revision);
    }, () => { this.auth(id); this.requirePolicy(token.scope, input.action, p); if (this.now() >= token.expiresAt) return fail(403, 'operation_handle_invalid');
      if(intent.action==='apply') {
        const proof=this.backend().inspectNow(id,intent.scope,()=>{this.auth(id);this.requirePolicy(intent.scope,'apply',p);}),now=this.now();
        if(proof.status!=='ready' || proof.value.accountRevision!==intent.expectedCanonicalRevision || proof.value.useEpoch!==intent.expectedUseEpoch || proof.value.effects.some(e=>e.requestId===requestId && e.state==='active') || recoveryIntents.some(old=>now<localUseExecutionDeadline(old) || proof.value.observedAt<localUseExecutionDeadline(old) || proof.value.effects.some(e=>e.effectId===old.effectId))) return fail(409,'rights_conflict');
      }
      if(intent.action==='release') {
        const proof=this.backend().receiptNow(id,intent.scope,intent.effectId,()=>{this.auth(id);this.requirePolicy(intent.scope,'release',p);});
        if(proof.status!=='ready' || !proof.value.effect || proof.value.effect.state!=='active' || proof.value.effect.requestId!==requestId || proof.value.effect.revision!==intent.expectedEffectRevision || proof.value.effect.effectDigest!==intent.expectedEffectDigest || proof.value.accountRevision!==intent.expectedCanonicalRevision || proof.value.useEpoch!==intent.expectedUseEpoch) return fail(409,'rights_conflict');
      } }); }
    catch (e) { if (!(e instanceof RightsReplay)) throw e; return { replayed: true, ...this.status(id, requestId, token.scope) }; }
    return this.execute(id,intent,p,false);
  }
  private async execute(id:number,intent:LocalUseIntent,p:Policy,replayed:boolean) {
    const base = { version: 1 as const, scope: intent.scope, effectId: intent.effectId, requestId: intent.requestId, expectedCanonicalRevision: intent.expectedCanonicalRevision, expectedUseEpoch: intent.expectedUseEpoch, policy: intent.policy, notice: intent.notice, reviewAt: intent.reviewAt, metadataRetainUntil: intent.metadataRetainUntil, replayRetainUntil: intent.replayRetainUntil };
    if (intent.action === 'apply') await this.backend().apply(id, { ...base, applyIntentDigest: intent.intentDigest }, () => this.intentGuard(id,intent,p));
    else await this.backend().release(id, { ...base, expectedEffectRevision: intent.expectedEffectRevision!, expectedEffectDigest: intent.expectedEffectDigest!, releaseIntentDigest: intent.intentDigest }, () => this.intentGuard(id,intent,p));
    let failed = false;
    try { await this.acknowledge(id,intent,p); } catch { failed = true; }
    const result = this.status(id,intent.requestId,intent.scope);
    if (failed && result.status.technical.reconciliation === 'pending') result.status.technical.reconciliation = 'failed';
    return { ...result, replayed };
  }
  /** Existing committed operator authority is checked by the caller and again
   * at every proof/ack publication. No canonical mutation is performed here. */
  async reconcile(id: number, requestId: string, commandEventId: string, assertOperator: () => void): Promise<LocalUseView> {
    assertOperator(); const d = this.read(id); if ((d?.version !== 3 && d?.version !== 4)) return fail(503,'rights_local_use_unsupported');
    const intent = d.localUse.intents.find(i => i.eventId === commandEventId && i.requestId === requestId) ?? fail(404,'not_found');
    const p = this.requirePolicy(intent.scope,'reconcile'); await this.acknowledge(id,intent,p,assertOperator); assertOperator(); return this.status(id,requestId,intent.scope);
  }
}
