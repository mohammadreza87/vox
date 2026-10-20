/** Server-only local review queue. A filesystem operator is trusted; candidates
 * receive no registry mount. A crashed writer lock requires operator recovery. */
import { promises as fs, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { caseRecordSchema, recipeSchema, sidecarSchema, withdrawalSchema, type LearningCaseRecipe, type LearningCasePreparation, type PreparedLearningCases } from './learning-cases/contracts';
import { learningCaseId, materializeLearningCase, LEARNING_CASE_CATALOG_DIGEST } from './learning-cases/catalog';
import { legacyStateSchema, learningStateSchema, type LearningState } from './learning-cases/state';
import { manifestSchema, type EvaluationCorpus } from './evaluation/contracts';
import { validateEvaluationInputs, evaluationProtocolDigest } from './evaluation/manifest';
import { z } from 'zod';
import { protocolReceiptSchema, protocolReservationSchema, type ProtocolReservation, type ProtocolReceipt } from './evaluation/contracts';
import { assessPromotion, improvementCandidateSchema, type ImprovementCandidate, type EvaluationReceipt } from './index';
import { approvalSchema, canonical, evaluationDetailsSchema, findingSchema, hash, identifier, proposalSchema, protectedEvaluationSchema, routingArtifactSchema,
  validateTrust, verifyAttestation, routeCancellation, type Attestation, type HumanApproval, type MinimizedFinding, type Proposal, type RoutingArtifact, type TrustStore } from './contracts';
export interface ProtectedEvaluation {
  receipt: EvaluationReceipt;
  details: z.infer<typeof evaluationDetailsSchema>;
}
interface CandidateRecord { candidate: ImprovementCandidate; proposalId: string; authorKeyId: string; protocol?: Attestation<ProtocolReceipt>; protocolReservation?: Attestation<ProtocolReservation>; evaluation?: Attestation<ProtectedEvaluation>; approval?: Attestation<HumanApproval> }
interface LegacyState { findings: Record<string, MinimizedFinding>; proposals: Record<string, Proposal>; candidates: Record<string, CandidateRecord>;
  revokedLineages: string[]; finalUses: string[]; protocolUses?: string[]; rollbacks: Record<string, RollbackReceipt>; operations: Record<string, string> }
type State = LegacyState | LearningState;
interface Event { schemaVersion?: 2; kind?: 'vox_improvement_audit'; sequence: number; previous: string; action: string; operationId: string; at: number; state: State; digest: string }
export interface RollbackReceipt { candidateId: string; artifactDigest: string; restoredRevision: string; restoredArtifactDigest: string;
  scope: 'local_rehearsal'; comparisonOnly: true; productionMutation: false; derivedState: 'none_created'; rehearsedAt: number; checks: { candidateOnCancelled: 'stop' | 'continue'; restoredOnCancelled: 'stop' | 'continue' } }
const empty = (): State => ({ findings: {}, proposals: {}, candidates: {}, revokedLineages: [], finalUses: [], rollbacks: {}, operations: {} });
const isLearning = (state: State): state is LearningState => 'schemaVersion' in state && state.schemaVersion === 2;
const head = (events: Event[]) => events.at(-1)?.digest ?? '0'.repeat(64);
const fail = (reason: string): never => { throw new Error(reason); };
export class ImprovementWorkflow {
  readonly root: string;
  private readonly trust: TrustStore;
  constructor(options: { root: string; trust: TrustStore; now?: () => number }) {
    this.root = resolve(options.root); this.trust = structuredClone(options.trust); validateTrust(this.trust); this.now = options.now ?? Date.now;
  }
  private readonly now: () => number;
  readonly #prepared = new WeakMap<PreparedLearningCases, { head: string; lineageDigest: string; protocolDigest: string; corpus: EvaluationCorpus; reserved?: {candidateId:string;artifactDigest:string} }>();
  private sample(state?: State): number {
    const now = this.now(); if (!Number.isSafeInteger(now) || now < 0 || state && isLearning(state) && now < state.observedAt) fail('learning_case_clock_invalid'); return now;
  }
  private trustDigest(): string { return hash(canonical(this.trust)); }
  private async load(): Promise<{ state: State; events: Event[] }> {
    const audit=await fs.lstat(join(this.root,'audit')).catch((e:NodeJS.ErrnoException)=>e.code==='ENOENT'?undefined:Promise.reject(e));
    if(audit && (!audit.isDirectory() || audit.isSymbolicLink())) fail('audit_corrupt');
    const files = (await fs.readdir(join(this.root, 'audit')).catch((e: NodeJS.ErrnoException) => e.code === 'ENOENT' ? [] : Promise.reject(e))).sort();
    if (files.length > 5000 || files.some(name => !/^\d{10}\.json$/.test(name))) fail('audit_corrupt');
    const events: Event[] = []; let previous = '0'.repeat(64), total = 0;
    for (const name of files) {
      const file = await fs.open(join(this.root, 'audit', name), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try { const stat = await file.stat(); if (!stat.isFile() || stat.size > 2000000 || (total += stat.size) > 64000000) fail('audit_capacity_reached'); bytes = await file.readFile(); }
      finally { await file.close(); }
      const entry = JSON.parse(bytes!.toString()) as Event;
      const { digest, ...body } = entry;
      const v2 = entry.schemaVersion === 2;
      const allowed = ['sequence','previous','action','operationId','at','state','digest', ...(v2 ? ['schemaVersion','kind'] : [])].sort().join(',');
      if (Object.keys(entry).sort().join(',') !== allowed || v2 && entry.kind !== 'vox_improvement_audit' || !v2 && events.at(-1)?.schemaVersion === 2 ||
        name !== `${String(events.length + 1).padStart(10, '0')}.json` || entry.sequence !== events.length + 1 || entry.previous !== previous ||
        !Number.isSafeInteger(entry.at) || entry.at < 0 || !identifier.safeParse(entry.operationId).success || !identifier.safeParse(entry.action).success ||
        digest !== hash(canonical(v2 ? { domain: 'vox.improvement.audit.v2', body } : body))) fail('audit_corrupt');
      entry.state = (v2 ? learningStateSchema : legacyStateSchema).parse(entry.state);
      const prior = events.at(-1)?.state;
      if (v2) {
        const state = entry.state as LearningState;
        if (state.observedAt !== entry.at || state.generation !== (prior && isLearning(prior) ? prior.generation + 1 : 1) ||
          prior && isLearning(prior) && (state.registryId !== prior.registryId || state.trustDigest !== prior.trustDigest || state.observedAt < prior.observedAt) ||
          (!prior || !isLearning(prior)) && (entry.action !== 'learning_cases_migrated' || events.some(e=>e.at>state.observedAt))) fail('audit_corrupt');
      }
      if (!entry.state.operations[entry.operationId]) fail('audit_corrupt');
      if (prior) {
        for (const key of ['operations','findings','proposals'] as const) for (const [id, value] of Object.entries(prior[key])) if (canonical(entry.state[key][id]) !== canonical(value)) fail('audit_corrupt');
        for (const [id,record] of Object.entries(prior.candidates)) { const next=entry.state.candidates[id]; if (!next || canonical(next.candidate)!==canonical(record.candidate) || next.proposalId!==record.proposalId || next.authorKeyId!==record.authorKeyId) fail('audit_corrupt'); for(const field of ['protocolReservation','protocol','evaluation','approval'] as const) if(record[field] && canonical(record[field])!==canonical(next[field])) fail('audit_corrupt'); }
        for (const key of ['revokedLineages','finalUses','protocolUses'] as const) if ((prior[key] ?? []).some(id => !(entry.state[key] ?? []).includes(id))) fail('audit_corrupt');
        if (isLearning(prior) && isLearning(entry.state)) {
          for (const key of ['learningCases','learningCorpora'] as const) for (const [id,value] of Object.entries(prior[key])) if (canonical(entry.state[key][id]) !== canonical(value)) fail('audit_corrupt');
          if (prior.withdrawnCases.some(id => !entry.state || !isLearning(entry.state) || !entry.state.withdrawnCases.includes(id))) fail('audit_corrupt');
        }
      }
      events.push(entry); previous = digest;
    }
    return { state: events.length ? structuredClone(events[events.length - 1].state) : empty(), events };
  }
  private async locked<T>(consume: () => Promise<T>, create = true): Promise<T> {
    if (create) await fs.mkdir(join(this.root, 'audit'), { recursive: true, mode: 0o700 });
    const lock = join(this.root, 'writer.lock'), deadline = Date.now() + 3000;
    while (true) { try { await fs.mkdir(lock, { mode: 0o700 }); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (Date.now() > deadline) fail('workflow_busy'); await new Promise(r => setTimeout(r, 10)); } }
    try { return await consume(); } finally { await fs.rmdir(lock); }
  }
  private async transaction(operationId: string, action: string, input: unknown, mutate: (state: State, events: Event[]) => void, after?: (state: State, events: Event[]) => void): Promise<void> {
    identifier.parse(operationId); const payload = structuredClone(input);
    await this.locked(async () => {
      const { state, events } = await this.load(); const request = hash(canonical({ action, payload }));
      if (isLearning(state) && state.trustDigest !== this.trustDigest()) fail('learning_case_trust_changed');
      this.sample(state);
      if (state.operations[operationId]) { if (state.operations[operationId] !== request) fail('idempotency_conflict'); return; }
      let deferredFailure:unknown, committedRequest=request;
      const before=structuredClone(state);
      try { mutate(state,events); }
      catch(error) {
        // Explicit LC1 transitions durably observe valid trusted time even when
        // eligibility denies. Reads never enter this path. Restore all attempted
        // data mutations; persist only the monotonic observation, no raw error.
        const observed=this.sample(before);
        if (!isLearning(before) || observed <= before.observedAt) throw error;
        for(const key of Object.keys(state)) delete (state as unknown as Record<string,unknown>)[key]; Object.assign(state,before);
        operationId=`clock_${randomUUID()}`; action='learning_cases_clock_observed'; committedRequest=hash(canonical({action,payload:{}})); deferredFailure=error;
      }
      const append=async(op:string,verb:string,fingerprint:string)=>{
        state.operations[op]=fingerprint; const at=this.sample(state);
        if(isLearning(state)){state.observedAt=at;state.generation++;learningStateSchema.parse(state);}
        const body={...(isLearning(state)?{schemaVersion:2 as const,kind:'vox_improvement_audit' as const}:{}),sequence:events.length+1,previous:head(events),action:verb,operationId:op,at,state:structuredClone(state)};
        const event={...body,digest:hash(canonical(isLearning(state)?{domain:'vox.improvement.audit.v2',body}:body))};
        if(Buffer.byteLength(canonical(event))>2000000||events.length>=5000) fail('workflow_capacity_reached');
        const temporary=join(this.root,`.${randomUUID()}.tmp`),target=join(this.root,'audit',`${String(body.sequence).padStart(10,'0')}.json`);
        const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(canonical(event));await handle.sync();}finally{await handle.close();}
        await fs.link(temporary,target);await fs.unlink(temporary);
        const directory=await fs.open(join(this.root,'audit'),'r');try{await directory.sync();}finally{await directory.close();}events.push(event);
      };
      await append(operationId,action,committedRequest); if(deferredFailure) throw deferredFailure;
      try { after?.(state,events); }
      catch(error) {
        // A valid clock can advance across fsync/publication. Latch a later
        // denied observation under this same writer before releasing it.
        if(isLearning(state)&&this.sample(state)>state.observedAt) {
          const verb='learning_cases_clock_observed';await append(`clock_${randomUUID()}`,verb,hash(canonical({action:verb,payload:{}})));
        }
        throw error;
      }

    });
  }
  /** Explicit format conversion; never called by reads or normal startup. */
  async migrateLearningCases(operationId: string): Promise<void> {
    await this.transaction(operationId, 'learning_cases_migrated', {trustDigest:this.trustDigest()}, (state, events) => {
      if (isLearning(state)) fail('learning_cases_already_migrated');
      const now = this.sample(); if (events.some(e => e.at > now)) fail('learning_case_clock_invalid');
      Object.assign(state, {schemaVersion:2,trustDigest:this.trustDigest(),registryId:randomUUID(),generation:0,observedAt:now,
        protocolUses:state.protocolUses ?? [],learningCases:{},learningCorpora:{},withdrawnCases:[]});
    });
  }
  private learning(state: State): LearningState {
    if (!isLearning(state)) return fail('learning_case_migration_required');
    if (state.trustDigest !== this.trustDigest()) fail('learning_case_trust_changed'); this.sample(state); return state;
  }
  private currentCase(state: LearningState, id: string, events?: Event[]) {
    const record = state.learningCases[id]; if (!record || state.withdrawnCases.includes(id)) return fail('learning_case_ineligible');
    const recipe = recipeSchema.parse(record.review.payload), finding = this.eligible(state, recipe.findingId), now = this.sample(state);
    if (!verifyAttestation(record.finding,'analyst','approved_finding',this.trust) || !verifyAttestation(record.review,'human','learning_case_review',this.trust) ||
      canonical(finding) !== canonical(record.finding.payload) || recipe.findingEnvelopeDigest !== hash(canonical(record.finding)) || learningCaseId(recipe,finding) !== id || recipe.catalogDigest !== LEARNING_CASE_CATALOG_DIGEST ||
      finding.kind !== 'synthetic' || finding.lineageIds.length !== new Set(finding.lineageIds).size || canonical(finding.lineageIds) !== canonical([...finding.lineageIds].sort()) ||
      recipe.reviewedAt > now || recipe.expiresAt <= now || recipe.expiresAt > finding.expiresAt || recipe.retainUntil <= now || recipe.reviewedAt < finding.reviewedAt ||
      state.operations[recipe.findingImportOperationId] !== hash(canonical({action:'finding_imported',payload:record.finding})) ||
      events && !events.some(e => e.action === 'finding_imported' && e.operationId === recipe.findingImportOperationId)) fail('learning_case_ineligible');
    return record;
  }
  async admitLearningCase(operationId: string, input: {finding:Attestation<MinimizedFinding>;review:Attestation<LearningCaseRecipe>}): Promise<string> {
    const record = caseRecordSchema.parse(structuredClone(input));
    if (!verifyAttestation(record.finding,'analyst','approved_finding',this.trust) || !verifyAttestation(record.review,'human','learning_case_review',this.trust)) fail('untrusted_learning_case');
    const recipe = record.review.payload, id = learningCaseId(recipe,record.finding.payload);
    await this.transaction(operationId,'learning_case_admitted',record,(raw,events) => {
      const state = this.learning(raw);
      if (state.learningCases[id] || state.withdrawnCases.includes(id)) fail('learning_case_exists_or_withdrawn');
      if (Object.values(state.proposals).some(p => p.findingId === recipe.findingId && !p.learningCases)) fail('learning_case_legacy_source_in_use');
      state.learningCases[id] = record; this.currentCase(state,id,events);
    });
    return id;
  }
  async withdrawLearningCase(operationId: string, input: Attestation<{caseId:string;reviewedAt:number}>): Promise<void> {
    const envelope = structuredClone(input), payload = withdrawalSchema.parse(envelope.payload);
    if (!verifyAttestation(envelope,'human','withdraw_learning_case',this.trust)) fail('untrusted_learning_case_withdrawal');
    await this.transaction(operationId,'learning_case_withdrawn',envelope,raw => {
      const state=this.learning(raw); if (!state.learningCases[payload.caseId] || payload.reviewedAt > this.sample(state)) fail('learning_case_missing');
      if (!state.withdrawnCases.includes(payload.caseId)) state.withdrawnCases.push(payload.caseId);
    });
  }
  /** Bounded logical retirement only. Retention floors/replay tombstones and
   * immutable audit metadata are never erased by this operation. */
  async reconcileLearningCases(operationId:string):Promise<void> {
    await this.transaction(operationId,'learning_cases_reconciled',{},raw=>{
      const state=this.learning(raw), now=this.sample(state);
      for(const [id,record] of Object.entries(state.learningCases)) {
        const finding=state.findings[record.review.payload.findingId];
        if (now >= record.review.payload.expiresAt || !finding || now >= finding.expiresAt || finding.lineageIds.some(id=>state.revokedLineages.includes(id))) {
          if(!state.withdrawnCases.includes(id)) state.withdrawnCases.push(id);
        }
      }
    });
  }
  private currentCorpus(state: LearningState, lineageDigest: string, events?: Event[]): EvaluationCorpus {
    const record = state.learningCorpora[lineageDigest]; if (!record) return fail('learning_case_corpus_missing');
    const sidecar=sidecarSchema.parse(record.sidecar.payload), manifest=manifestSchema.parse(record.manifest), now=this.sample(state);
    if (!verifyAttestation(record.sidecar,'evaluator','learning_case_corpus',this.trust) || hash(canonical(record.sidecar)) !== lineageDigest ||
      manifest.schemaVersion !== 2 || manifest.learningCases?.lineageDigest !== lineageDigest || sidecar.catalogDigest !== LEARNING_CASE_CATALOG_DIGEST ||
      sidecar.reviewedAt > now || sidecar.expiresAt <= now || sidecar.retainUntil <= now || manifest.expiresAt > sidecar.expiresAt ||
      manifest.reviewedAt < sidecar.reviewedAt || manifest.retention.retainUntil < sidecar.retainUntil || new Set(sidecar.cases.map(c=>c.caseId)).size !== sidecar.cases.length) fail('learning_case_corpus_ineligible');
    const corpus: EvaluationCorpus={schemaVersion:2,provenance:'synthetic_only',optimization:[],validation:[],final:[]};
    for (const partition of ['optimization','validation','final'] as const) {
      const refs=sidecar.cases.filter(c=>c.partition===partition);
      for (let ordinal=0;ordinal<refs.length;ordinal++) {
        const ref=refs[ordinal], current=this.currentCase(state,ref.caseId,events), recipe=current.review.payload;
        if (ref.caseRecordDigest !== hash(canonical(current)) || ref.ordinal !== ordinal || sidecar.reviewedAt < recipe.reviewedAt || sidecar.expiresAt > recipe.expiresAt || sidecar.retainUntil < recipe.retainUntil) fail('learning_case_corpus_ineligible');
        const materialized=materializeLearningCase(recipe,current.finding.payload);
        if (hash(canonical(materialized)) !== ref.materializedDigest) fail('learning_case_materialization_mismatch'); corpus[partition].push(materialized);
      }
    }
    if (hash(canonical(corpus)) !== sidecar.corpusDigest || manifest.digests.corpus !== sidecar.corpusDigest) fail('learning_case_corpus_mismatch');
    return validateEvaluationInputs(manifest,corpus,now).corpus;
  }
  async prepareLearningCases(input: LearningCasePreparation): Promise<PreparedLearningCases> {
    const captured=structuredClone(input), manifest=manifestSchema.parse(captured.manifest), sidecar={...captured.sidecar,payload:sidecarSchema.parse(captured.sidecar.payload)};
    const lineageDigest=hash(canonical(sidecar)); let prepared: PreparedLearningCases | undefined;
    await this.transaction(`prepare_${lineageDigest}`,'learning_cases_prepared',{manifest,sidecar},raw=> {
      const state=this.learning(raw); if (manifest.learningCases?.lineageDigest !== lineageDigest) fail('learning_case_corpus_mismatch');
      const existing=state.learningCorpora[lineageDigest]; if (existing && canonical(existing) !== canonical({manifest,sidecar})) fail('learning_case_corpus_mismatch');
      state.learningCorpora[lineageDigest]={manifest,sidecar}; this.currentCorpus(state,lineageDigest);
    });
    // Explicit preparation after a legitimate workflow write may mint a new
    // unreserved handle. It never refreshes a consumed reservation or stale handle.
    await this.transaction(`observe_${randomUUID()}`,'learning_cases_observed',{lineageDigest},raw=>{
      this.currentCorpus(this.learning(raw),lineageDigest);
    },(raw,events)=>{ const state=this.learning(raw), corpus=this.currentCorpus(state,lineageDigest,events);
      prepared=Object.freeze({}) as PreparedLearningCases; this.#prepared.set(prepared,{head:head(events),lineageDigest,protocolDigest:evaluationProtocolDigest(manifest),corpus}); });
    return prepared!;
  }
  private checkPrepared(raw: State, events: Event[], handle: PreparedLearningCases | undefined, binding:{protocolDigest:string;lineageDigest:string;candidateId?:string;artifactDigest?:string}, requireReservation=false) {
    const state=this.learning(raw), capability=handle && this.#prepared.get(handle);
    if (!capability || capability.head !== head(events) || capability.lineageDigest !== binding.lineageDigest || capability.protocolDigest !== binding.protocolDigest) return fail('learning_case_authority_stale');
    this.currentCorpus(state,capability.lineageDigest,events);
    if (requireReservation && (!capability.reserved || capability.reserved.candidateId !== binding.candidateId || capability.reserved.artifactDigest !== binding.artifactDigest)) fail('learning_case_reservation_required');
    return capability;
  }
  async withLearningCaseAuthority<T>(handle:PreparedLearningCases,binding:{protocolDigest:string;lineageDigest:string;candidateId?:string;artifactDigest?:string},phase:'optimization'|'reservation'|'adapter'|'result'|'receipt',consume:(view:{corpus:EvaluationCorpus;lineageDigest:string})=>T):Promise<T> {
    if (typeof consume !== 'function' || consume.constructor.name === 'AsyncFunction') fail('learning_case_async_handoff_forbidden');
    z.enum(['optimization','reservation','adapter','result','receipt']).parse(phase);
    const fixed=z.object({protocolDigest:z.string().regex(/^[a-f0-9]{64}$/),lineageDigest:z.string().regex(/^[a-f0-9]{64}$/),candidateId:identifier.optional(),artifactDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().parse(structuredClone(binding)); let result:T | undefined;
    await this.transaction(`use_${randomUUID()}`,'learning_cases_used',{binding:fixed,phase},(state,events)=>{
      this.checkPrepared(state,events,handle,fixed,['adapter','result','receipt'].includes(phase));
    },(state,events)=>{
      const capability=this.#prepared.get(handle)!; capability.head=head(events); this.currentCorpus(this.learning(state),fixed.lineageDigest,events);
      // The audit commit linearizes this handoff. The same writer remains held
      // only through this synchronous callback; adapter promises must be wrapped.
      result=consume({corpus:structuredClone(capability.corpus),lineageDigest:fixed.lineageDigest});
      if (result && typeof (result as {then?:unknown}).then === 'function') fail('learning_case_async_handoff_forbidden');
    });
    return result!;
  }
  private checkRecordLearning(state: State, record: CandidateRecord): void {
    const commitment=record.candidate.learningCases, proposal=state.proposals[record.proposalId];
    if (canonical(commitment ?? null) !== canonical(proposal?.learningCases ?? null)) fail('learning_case_binding_mismatch');
    if (commitment) {
      const current=this.learning(state); this.currentCorpus(current,commitment.lineageDigest);
      const corpus=current.learningCorpora[commitment.lineageDigest];
      if (evaluationProtocolDigest(corpus.manifest) !== record.candidate.evaluationProtocolDigest || !corpus.sidecar.payload.cases.some(c => current.learningCases[c.caseId].review.payload.findingId === proposal.findingId)) fail('learning_case_binding_mismatch');
    }
  }
  private eligible(state: State, findingId: string): MinimizedFinding {
    const finding = state.findings[findingId]; const now=this.sample(state);
    if (!finding || finding.expiresAt <= now || finding.lineageIds.some(id => state.revokedLineages.includes(id))) return fail('finding_ineligible');
    return finding;
  }
  async importFinding(operationId: string, envelope: Attestation<MinimizedFinding>): Promise<void> {
    envelope = structuredClone(envelope);
    if (!verifyAttestation(envelope, 'analyst', 'approved_finding', this.trust)) fail('untrusted_finding');
    const finding = findingSchema.parse(envelope.payload);
    if (finding.reviewedAt > this.now() || finding.expiresAt <= this.now()) fail('finding_ineligible');
    await this.transaction(operationId, 'finding_imported', envelope, state => { if (state.findings[finding.id]) fail('finding_exists');
      if (finding.lineageIds.some(id => state.revokedLineages.includes(id))) fail('finding_ineligible'); state.findings[finding.id] = finding; });
  }
  async proposeRouting(operationId: string, input: Proposal): Promise<void> {
    const proposal = proposalSchema.parse(input);
    if (proposal.createdAt > this.now()) fail('invalid_proposal_time');
    await this.transaction(operationId, 'proposal_created', proposal, state => { const finding = this.eligible(state, proposal.findingId);
      if (proposal.learningCases) { const current=this.learning(state); this.currentCorpus(current,proposal.learningCases.lineageDigest); const frozen=current.learningCorpora[proposal.learningCases.lineageDigest]; if (proposal.createdAt < frozen.manifest.reviewedAt || evaluationProtocolDigest(frozen.manifest) !== proposal.evaluationProtocolDigest || !frozen.sidecar.payload.cases.some(c=>current.learningCases[c.caseId].review.payload.findingId===proposal.findingId)) fail('learning_case_binding_mismatch'); }
      else if (isLearning(state) && Object.values(state.learningCases).some(c=>c.review.payload.findingId===proposal.findingId)) fail('learning_case_authority_required');
      if (proposal.baselineRevision !== finding.sourceDigest) fail('proposal_source_mismatch');
      if (state.proposals[proposal.id]) fail('proposal_exists'); state.proposals[proposal.id] = proposal; });
  }
  async registerCandidate(operationId: string, envelope: Attestation<{ proposalId: string; candidate: ImprovementCandidate; artifact: RoutingArtifact }>): Promise<void> {
    envelope = structuredClone(envelope);
    if (!verifyAttestation(envelope, 'author', 'candidate_artifact', this.trust)) fail('untrusted_candidate');
    const payload = z.object({ proposalId: identifier, candidate: improvementCandidateSchema, artifact: routingArtifactSchema }).strict().parse(envelope.payload);
    const candidate = payload.candidate; identifier.parse(candidate.id); const artifact = payload.artifact;
    const digest = hash(canonical(artifact));
    if (candidate.artifactDigest !== digest || candidate.candidateRevision !== digest || candidate.authorServiceId !== envelope.keyId ||
      candidate.problemCode !== 'audio_cancellation' || candidate.changedPaths.length !== 1 || candidate.changedPaths[0] !== 'src/features/call/cancellation-routing.ts' || candidate.createdAt > this.now()) fail('candidate_binding_mismatch');
    await this.transaction(operationId, 'candidate_registered', envelope, state => {
      const proposal = state.proposals[payload.proposalId]; if (!proposal) fail('proposal_missing');
      const finding = this.eligible(state, proposal.findingId);
      if (candidate.evidenceKind !== finding.kind || candidate.evidenceIds.length !== 1 || candidate.evidenceIds[0] !== finding.id || candidate.baselineRevision !== proposal.baselineRevision || candidate.createdAt < proposal.createdAt || candidate.evaluationProtocolDigest !== proposal.evaluationProtocolDigest || canonical(candidate.learningCases ?? null) !== canonical(proposal.learningCases ?? null)) fail('candidate_binding_mismatch');
      if (Object.values(state.candidates).filter(c => c.proposalId === proposal.id).length >= proposal.budget.maxCandidates) fail('candidate_budget_exhausted');
      if (state.candidates[candidate.id]) fail('candidate_exists');
      state.candidates[candidate.id] = { candidate, proposalId: proposal.id, authorKeyId: envelope.keyId }; this.checkRecordLearning(state,state.candidates[candidate.id]);
    });
    await this.putObject(digest, canonical(artifact));
  }
  private async putObject(digest: string, contents: string): Promise<void> {
    await fs.mkdir(join(this.root, 'objects'), { recursive: true, mode: 0o700 });
    const file = join(this.root, 'objects', digest);
    const temporary = join(this.root, 'objects', `.${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, 'wx', 0o400);
    try {
      try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
      // A digest path is visible only after complete bytes are durable. Retried
      // registration can repair a crash between registry append and object commit.
      try { await fs.link(temporary, file); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (hash(await fs.readFile(file)) !== digest) fail('artifact_corrupt'); }
      const directory = await fs.open(join(this.root, 'objects'), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.unlink(temporary).catch(() => undefined); }
  }
  async readArtifact(candidateId: string): Promise<RoutingArtifact> {
    const { state } = await this.load(); const record = state.candidates[candidateId]; if (!record) return fail('candidate_missing');
    this.eligible(state, state.proposals[record.proposalId].findingId); this.checkRecordLearning(state,record);
    const bytes = await fs.readFile(join(this.root, 'objects', record.candidate.artifactDigest));
    if (hash(bytes) !== record.candidate.artifactDigest) fail('artifact_corrupt'); return routingArtifactSchema.parse(JSON.parse(bytes.toString()));
  }
  /** Returns true only for the first committed attempt, false for exact replay.
   * Reserve before giving the protected runner final-case access. A crash burns
   * this final-set attempt; neither a retry nor another candidate may rerun it. */
  async reserveEvaluationProtocol(operationId: string, envelope: Attestation<ProtocolReservation>, handle?:PreparedLearningCases): Promise<boolean> {
    envelope = structuredClone(envelope);
    if (!verifyAttestation(envelope, 'evaluator', 'evaluation_protocol_reservation', this.trust)) fail('untrusted_evaluation_protocol');
    const reservation = protocolReservationSchema.parse(envelope.payload); await this.readArtifact(reservation.candidateId);
    let claimed = false;
    await this.transaction(operationId, 'evaluation_protocol_reserved', envelope, (state,events) => {
      const record = state.candidates[reservation.candidateId]; if (!record) return fail('candidate_missing');
      const candidate = record.candidate, proposal = state.proposals[record.proposalId]; this.eligible(state, proposal.findingId); this.checkRecordLearning(state,record);
      if (canonical(candidate.learningCases ?? null) !== canonical(reservation.learningCases ?? null)) fail('learning_case_binding_mismatch');
      if (candidate.learningCases) this.checkPrepared(state,events,handle,{protocolDigest:reservation.protocolDigest,lineageDigest:candidate.learningCases.lineageDigest});
      if (record.protocolReservation || !candidate.evaluationProtocolDigest || reservation.protocolDigest !== candidate.evaluationProtocolDigest || envelope.keyId === record.authorKeyId ||
        reservation.evaluatorServiceId !== envelope.keyId || reservation.reservedAt < candidate.createdAt || reservation.reservedAt > this.now() || Math.min(reservation.retainUntil, reservation.protocolMetadata.expiresAt) <= this.now() ||
        reservation.candidateRevision !== candidate.candidateRevision || reservation.artifactDigest !== candidate.artifactDigest || reservation.baselineRevision !== candidate.baselineRevision ||
        reservation.baselineArtifactDigest !== proposal.baselineArtifactDigest || reservation.legacyDatasetDigest !== candidate.datasetVersion || reservation.candidateEvaluatorDigest !== candidate.evaluatorVersion ||
        reservation.promotionPolicyDigest !== candidate.promotionPolicyVersion || reservation.budget.maxCases > proposal.budget.maxCases) fail('evaluation_protocol_binding_mismatch');
      state.protocolUses ??= [];
      if (state.protocolUses.includes(reservation.bindings.final)) fail('protocol_final_dataset_consumed');
      state.protocolUses.push(reservation.bindings.final); record.protocolReservation = envelope; claimed = true;
    },(state,events)=>{ if (reservation.learningCases) { const capability=this.#prepared.get(handle!)!; this.checkRecordLearning(state,state.candidates[reservation.candidateId]); capability.head=head(events); capability.reserved={candidateId:reservation.candidateId,artifactDigest:reservation.artifactDigest}; } });
    return claimed;
  }
  async attachEvaluationProtocol(operationId: string, envelope: Attestation<ProtocolReceipt>, handle?:PreparedLearningCases): Promise<void> {
    envelope = structuredClone(envelope);
    if (!verifyAttestation(envelope, 'evaluator', 'evaluation_protocol', this.trust)) fail('untrusted_evaluation_protocol');
    const protocol = protocolReceiptSchema.parse(envelope.payload);
    await this.readArtifact(protocol.candidateId);
    await this.transaction(operationId, 'evaluation_protocol_attached', envelope, (state,events) => {
      const record = state.candidates[protocol.candidateId]; if (!record) return fail('candidate_missing');
      const candidate = record.candidate, proposal = state.proposals[record.proposalId]; this.eligible(state, proposal.findingId); this.checkRecordLearning(state,record);
      if (canonical(candidate.learningCases ?? null) !== canonical(protocol.learningCases ?? null)) fail('learning_case_binding_mismatch');
      if (candidate.learningCases) this.checkPrepared(state,events,handle,{protocolDigest:protocol.protocolDigest,lineageDigest:candidate.learningCases.lineageDigest,candidateId:candidate.id,artifactDigest:candidate.artifactDigest},true);
      if (!record.protocolReservation || record.protocolReservation.keyId !== envelope.keyId || record.protocolReservation.payload.protocolDigest !== protocol.protocolDigest || record.protocolReservation.payload.reservedAt > protocol.testedAt) fail('evaluation_protocol_reservation_required');
      if (record.protocol || !candidate.evaluationProtocolDigest || protocol.protocolDigest !== candidate.evaluationProtocolDigest || proposal.evaluationProtocolDigest !== candidate.evaluationProtocolDigest ||
          envelope.keyId === record.authorKeyId || protocol.evaluatorServiceId !== envelope.keyId || protocol.testedAt < candidate.createdAt || protocol.testedAt > this.now() || Math.min(protocol.retainUntil, protocol.protocolMetadata.expiresAt) <= this.now() ||
          protocol.candidateRevision !== candidate.candidateRevision || protocol.artifactDigest !== candidate.artifactDigest || protocol.baselineRevision !== candidate.baselineRevision ||
          protocol.baselineArtifactDigest !== proposal.baselineArtifactDigest || protocol.legacyDatasetDigest !== candidate.datasetVersion || protocol.candidateEvaluatorDigest !== candidate.evaluatorVersion ||
          protocol.promotionPolicyDigest !== candidate.promotionPolicyVersion || protocol.budget.maxCases > proposal.budget.maxCases) fail('evaluation_protocol_binding_mismatch');
      if (!state.protocolUses?.includes(protocol.bindings.final)) fail('evaluation_protocol_reservation_required');
      record.protocol = envelope;
    },(state,events)=>{if(protocol.learningCases){this.checkRecordLearning(state,state.candidates[protocol.candidateId]);this.#prepared.get(handle!)!.head=head(events);}});
  }
  async attachEvaluation(operationId: string, envelope: Attestation<ProtectedEvaluation>): Promise<void> {
    envelope=structuredClone(envelope);
    if (!verifyAttestation(envelope, 'evaluator', 'protected_evaluation', this.trust)) fail('untrusted_evaluation');
    const { details, receipt } = protectedEvaluationSchema.parse(envelope.payload);
    await this.readArtifact(receipt.candidateId);
    await this.transaction(operationId, 'evaluation_attached', envelope, state => {
      const record = state.candidates[receipt.candidateId]; if (!record) fail('candidate_missing');
      const candidate = record.candidate; this.eligible(state, state.proposals[record.proposalId].findingId); this.checkRecordLearning(state,record);
      if (canonical(candidate.learningCases ?? null) !== canonical(receipt.learningCases ?? null)) fail('learning_case_binding_mismatch');
      if (candidate.evaluationProtocolDigest ? (!record.protocol || record.protocol.keyId !== envelope.keyId || record.protocol.payload.status !== 'passed' || Math.min(record.protocol.payload.retainUntil, record.protocol.payload.protocolMetadata.expiresAt) <= this.now() ||
        receipt.evaluationProtocolDigest !== candidate.evaluationProtocolDigest || details.protocolReceiptDigest !== hash(canonical(record.protocol)) || receipt.testedAt < record.protocol.payload.testedAt) :
        (receipt.evaluationProtocolDigest !== undefined || details.protocolReceiptDigest !== undefined)) fail('evaluation_protocol_required');
      if (details.checks > state.proposals[record.proposalId].budget.maxCases) fail('evaluation_case_budget_exceeded');
      if (record.evaluation || envelope.keyId === record.authorKeyId || receipt.evaluatorServiceId !== envelope.keyId ||
        details.baselineArtifactDigest !== state.proposals[record.proposalId].baselineArtifactDigest || details.artifactDigest !== candidate.artifactDigest || details.sourceDigest !== candidate.baselineRevision || details.datasetDigest !== candidate.datasetVersion ||
        details.evaluatorDigest !== candidate.evaluatorVersion || details.policyDigest !== candidate.promotionPolicyVersion || details.checks < 1 || details.candidateFailures > details.checks || details.baselineFailures > details.checks ||
        receipt.failedChecks !== details.candidateFailures || receipt.skippedChecks !== 0 || receipt.privacyFailures !== 0 ||
        receipt.status !== (details.candidateFailures === 0 ? 'passed' : 'failed') || receipt.testedAt < candidate.createdAt || receipt.testedAt > this.now() ||
        receipt.candidateRevision !== candidate.candidateRevision || receipt.artifactDigest !== candidate.artifactDigest || receipt.baselineRevision !== candidate.baselineRevision ||
        receipt.datasetVersion !== candidate.datasetVersion || receipt.evaluatorVersion !== candidate.evaluatorVersion || receipt.promotionPolicyVersion !== candidate.promotionPolicyVersion) fail('evaluation_binding_mismatch');
      // Final corpus is consumed once in this registry, even if failed. A retry needs a newly reviewed final dataset.
      const use = details.datasetDigest; if (state.finalUses.includes(use)) fail('final_dataset_consumed');
      state.finalUses.push(use); record.evaluation = envelope;
    });
  }
  async approve(operationId: string, envelope: Attestation<HumanApproval>): Promise<void> {
    envelope = structuredClone(envelope);
    if (!verifyAttestation(envelope, 'human', 'release_review', this.trust)) fail('untrusted_approval'); const approval = approvalSchema.parse(envelope.payload);
    await this.transaction(operationId, 'human_reviewed', envelope, state => {
      const record = state.candidates[approval.candidateId]; if (!record?.evaluation) fail('evaluation_missing');
      this.eligible(state, state.proposals[record.proposalId].findingId); this.checkRecordLearning(state,record);
      if (record.candidate.evaluationProtocolDigest && (!record.protocol || record.protocol.payload.status !== 'passed' || Math.min(record.protocol.payload.retainUntil, record.protocol.payload.protocolMetadata.expiresAt) <= this.now())) fail('evaluation_protocol_required');
      if (record.approval || approval.artifactDigest !== record.candidate.artifactDigest || approval.evaluationDigest !== hash(canonical(record.evaluation)) ||
        approval.approvedAt < record.evaluation!.payload.receipt.testedAt || approval.approvedAt > this.now() || approval.expiresAt <= this.now()) fail('approval_binding_mismatch');
      record.approval = envelope;
    });
  }
  async readiness(candidateId: string) {
    return this.locked(async()=>{
    const { state } = await this.load(); const record = state.candidates[candidateId]; if (!record) fail('candidate_missing');
    this.eligible(state, state.proposals[record.proposalId].findingId); this.checkRecordLearning(state,record); await this.readArtifact(candidateId);
    if (record.candidate.evaluationProtocolDigest && (!record.protocol || record.protocol.payload.status !== 'passed' || Math.min(record.protocol.payload.retainUntil, record.protocol.payload.protocolMetadata.expiresAt) <= this.now())) return { ready: false as const, reason: 'failed' as const };
    const candidate={...record.candidate}; delete candidate.learningCases;
    const rawReceipt=record.evaluation?.payload.receipt;
    const projectedReceipt=rawReceipt ? {...rawReceipt} : undefined;
    if(projectedReceipt) {delete projectedReceipt.learningCases;delete projectedReceipt.schemaVersion;}
    const result=await assessPromotion({...candidate,schemaVersion:1}, projectedReceipt, { now: this.now(),
      verifyReceipt: async () => !!record.evaluation && verifyAttestation(record.evaluation, 'evaluator', 'protected_evaluation', this.trust),
      verifyProtocol: async () => !!record.protocol && verifyAttestation(record.protocol, 'evaluator', 'evaluation_protocol', this.trust) &&
        record.protocol.payload.protocolDigest === record.candidate.evaluationProtocolDigest && record.evaluation?.payload.details.protocolReceiptDigest === hash(canonical(record.protocol)),
      humanApproved: async () => !!record.approval && verifyAttestation(record.approval, 'human', 'release_review', this.trust) &&
        record.approval.payload.decision === 'approve' && record.approval.payload.expiresAt > this.now() && record.approval.payload.evaluationDigest === hash(canonical(record.evaluation)),
    });
    this.eligible(state,state.proposals[record.proposalId].findingId); this.checkRecordLearning(state,record);
    return result;
    },false);
  }
  async revokeLineage(operationId: string, envelope: Attestation<{ lineageId: string }>): Promise<void> {
    envelope = structuredClone(envelope);
    if (!verifyAttestation(envelope, 'human', 'revoke_lineage', this.trust) || !/^[a-f0-9]{64}$/.test(envelope.payload.lineageId)) fail('untrusted_revocation');
    await this.transaction(operationId, 'lineage_revoked', envelope, state => { if (!state.revokedLineages.includes(envelope.payload.lineageId)) state.revokedLineages.push(envelope.payload.lineageId); });
  }
  async rollbackRehearsal(operationId: string, candidateId: string, baseline: RoutingArtifact): Promise<RollbackReceipt> {
    const artifact = routingArtifactSchema.parse(baseline); const { state } = await this.load(); const record = state.candidates[candidateId]; if (!record) fail('candidate_missing');
    if (!(await this.readiness(candidateId)).ready) fail('promotion_not_ready');
    const proposal = state.proposals[record.proposalId]; if (hash(canonical(artifact)) !== proposal.baselineArtifactDigest) fail('rollback_artifact_mismatch');
    await this.putObject(proposal.baselineArtifactDigest, canonical(artifact));
    const result: RollbackReceipt = { candidateId, artifactDigest: record.candidate.artifactDigest, restoredRevision: record.candidate.rollbackRevision,
      restoredArtifactDigest: proposal.baselineArtifactDigest, scope: 'local_rehearsal', comparisonOnly: true, productionMutation: false, derivedState: 'none_created', rehearsedAt: this.now(),
      checks: { candidateOnCancelled: routeCancellation(await this.readArtifact(candidateId), true), restoredOnCancelled: routeCancellation(artifact, true) } };
    await this.transaction(operationId, 'rollback_rehearsed', { candidateId, baseline: artifact }, current => { const record=current.candidates[candidateId]; if(!record) fail('candidate_missing'); this.eligible(current,current.proposals[record.proposalId].findingId); this.checkRecordLearning(current,record); if(!record.approval || record.approval.payload.decision!=='approve' || record.approval.payload.expiresAt<=this.sample(current) || record.protocol && Math.min(record.protocol.payload.retainUntil,record.protocol.payload.protocolMetadata.expiresAt)<=this.sample(current)) fail('promotion_not_ready'); current.rollbacks[candidateId] = result; });
    return (await this.load()).state.rollbacks[candidateId];
  }
  async listReviewQueue() {
    const { state } = await this.load(); if(isLearning(state)) this.learning(state);
    return { findings: Object.values(state.findings).filter(f => f.expiresAt > this.now() && !f.lineageIds.some(id => state.revokedLineages.includes(id))),
      proposals: Object.values(state.proposals).filter(p => { try { this.eligible(state, p.findingId); return true; } catch { return false; } }),
      candidates: Object.values(state.candidates).map(r => ({ ...r, eligible: (() => { try { this.eligible(state, state.proposals[r.proposalId].findingId); this.checkRecordLearning(state,r); return true; } catch { return false; } })() })) };
  }
  async report() {
    const { state, events } = await this.load(); const queue = await this.listReviewQueue();
    return { schemaVersion: 1, evidenceLevel: 'E1_local_workflow' as const, auditHead: events.at(-1)?.digest ?? null, auditEvents: events.length,
      candidates: queue.candidates.map(r => ({ candidateId: r.candidate.id, artifactDigest: r.candidate.artifactDigest, eligible: r.eligible,
        evaluationStatus: r.evaluation?.payload.receipt.status ?? 'UNAVAILABLE', humanDecision: r.approval?.payload.decision ?? 'UNAVAILABLE',
        rollback: state.rollbacks[r.candidate.id] ?? 'UNAVAILABLE' })), ci: 'UNAVAILABLE', deployment: 'UNAVAILABLE', measuredProductionEffect: 'UNAVAILABLE',
      causalClaim: 'hypothesis_only', cost: 'UNAVAILABLE', productionMutation: false };
  }
}
