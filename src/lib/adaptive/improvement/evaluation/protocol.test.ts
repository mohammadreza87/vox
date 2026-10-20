import { afterEach, expect, it } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attest, canonical, hash, type Authority, type RoutingArtifact, type TrustStore } from '../contracts';
import { assessPromotion, type ImprovementCandidate } from '../index';
import { ImprovementWorkflow, type ProtectedEvaluation } from '../workflow';
import { EVALUATOR_DIGEST, POLICY_DIGEST } from '../sandbox';
import { validateEvaluationInputs, optimizerProjection, evaluationProtocolDigest } from './manifest';
import { runEvaluation, deterministicSyntheticAdapter, type SyntheticEvaluationAdapter } from './runner';
import { syntheticProtocolInputs, SYNTHETIC_PROTOCOL_NOW as now } from './synthetic';
import { bindProtocolFinalEvaluation, evaluateReservedProtocol, protocolReservationRequest } from './binding';
import { optimizeProtocolRouting } from './optimizer';
import type { EvaluationCorpus, EvaluationManifest } from './contracts';
const baseline: RoutingArtifact = { schemaVersion: 1, kind: 'cancellation_routing', onCancelled: 'complete', onActive: 'continue' };
const artifact: RoutingArtifact = { ...baseline, onCancelled: 'stop' };
const legacyDatasetDigest = hash('separately-frozen-routing-final-dataset');
function candidate(m: EvaluationManifest): ImprovementCandidate { return { schemaVersion: 1, id: 'candidate', authorServiceId: 'author', baselineRevision: hash('base'), candidateRevision: hash(canonical(artifact)), artifactDigest: hash(canonical(artifact)),
  problemCode: 'audio_cancellation', evidenceIds: ['finding'], evidenceKind: 'synthetic', changedPaths: ['src/features/call/cancellation-routing.ts'], evaluatorVersion: EVALUATOR_DIGEST,
  datasetVersion: legacyDatasetDigest, promotionPolicyVersion: POLICY_DIGEST, rollbackRevision: hash('base'), createdAt: now, evaluationProtocolDigest: evaluationProtocolDigest(m) }; }
const run = (m: EvaluationManifest, corpus: EvaluationCorpus, adapter = deterministicSyntheticAdapter, signal?: AbortSignal) => runEvaluation({ manifest: m, corpus, candidate: candidate(m), artifact, baseline, evaluatorServiceId: 'evaluator', adapter, clock: () => now, signal });
function rehash(m: EvaluationManifest, c: EvaluationCorpus) { m.digests.corpus = hash(canonical(c)); for (const partition of ['optimization','validation','final'] as const) m.digests[partition] = hash(canonical(c[partition])); }
it.each(['taskId','personId','groupId','conversationId'] as const)('rejects %s leakage even when the attacker recomputes corpus digests', field => {
  const {manifest,corpus}=syntheticProtocolInputs(); if (field === 'groupId') { corpus.optimization[2].groupId = corpus.final[2].groupId; } else corpus.optimization[0][field]=corpus.final[0][field];
  rehash(manifest,corpus); expect(()=>validateEvaluationInputs(manifest,corpus,now)).toThrow(`evaluation_${field}_split_leak`);
});
it('rejects time-window leakage, missing required coverage, changed corpus and expired approval',()=>{
  const f=syntheticProtocolInputs(); f.corpus.final[0].occurredAt=200; rehash(f.manifest,f.corpus); expect(()=>validateEvaluationInputs(f.manifest,f.corpus,now)).toThrow('partition_mismatch');
  const fresh=syntheticProtocolInputs(); fresh.corpus.final[2].input.locale='en'; fresh.corpus.final[5].input.locale='en'; rehash(fresh.manifest,fresh.corpus); expect(()=>validateEvaluationInputs(fresh.manifest,fresh.corpus,now)).toThrow('locale_coverage_missing');
  const other=syntheticProtocolInputs(); other.corpus.final[0].input.text='modified'; expect(()=>validateEvaluationInputs(other.manifest,other.corpus,now)).toThrow('corpus_mismatch'); expect(()=>validateEvaluationInputs(other.manifest,other.corpus,1000)).toThrow('expired');
});
it('optimizer capability contains optimization cases only and no judge/scoring configuration or final canary',()=>{
  const {manifest,corpus}=syntheticProtocolInputs(); corpus.final[0].input.text='PROTECTED_FINAL_CANARY'; corpus.validation[0].input.text='PROTECTED_VALIDATION_CANARY'; rehash(manifest,corpus);
  const projected=optimizerProjection(manifest,corpus,now), bytes=JSON.stringify(projected); expect(projected.cases).toHaveLength(6); expect(bytes).not.toMatch(/PROTECTED_|minimumSuccessRate|calibrationDigest|maximumP95|"judge"|"scoring"/);
  projected.cases[0].input.text='changed'; expect(corpus.optimization[0].input.text).not.toBe('changed');
});
it('paired run preserves notification uncertainty and success denominator while separating deterministic safety from judge score',async()=>{
  const {manifest,corpus}=syntheticProtocolInputs(), receipt=await run(manifest,corpus);
  expect(receipt.status).toBe('passed'); expect(receipt.calls).toBe(12); expect(receipt.candidate).toMatchObject({ assigned:6,complete:6,successes:5,successRate:5/6,coverage:1,privacyFailures:0,p95LatencyMs:1,totalCostMicrousd:0 });
  expect(receipt.baseline.deterministicFailures).toBe(1); expect(receipt.baseline.successes).toBe(4);
  const unsafe: SyntheticEvaluationAdapter={...deterministicSyntheticAdapter,async run(input,signal){ const result=await deterministicSyntheticAdapter.run(input,signal) as Record<string,unknown>;return input.input.sharing==='revoked'?{...result,action:'continue',judgeScore:1,privacyFailure:false}:result; }};
  const failed=await run(manifest,corpus,unsafe);expect(failed.status).toBe('failed');expect(failed.candidate.privacyFailures).toBe(1);expect(failed.candidate.deterministicFailures).toBe(1);
});
it.each(['invalid','refused','unavailable','skipped'] as const)('%s never improves metrics by shrinking assigned denominators',async status=>{
  const {manifest,corpus}=syntheticProtocolInputs();const adapter={...deterministicSyntheticAdapter,async run(input: Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){const result=await deterministicSyntheticAdapter.run(input,signal) as Record<string,unknown>;return input.artifact.onCancelled==='stop'&&input.input.cancelled?{...result,status}:result;}};
  const receipt=await run(manifest,corpus,adapter);expect(receipt.status).toBe('incomplete');expect(receipt.candidate.assigned).toBe(6);expect(receipt.candidate.complete).toBe(5);expect(receipt.candidate.successRate).toBe(4/6);expect(receipt.candidate.coverage).toBe(5/6);
});
it('counts discarded work and unknown cost/latency, enforces budgets and cancels late adapters without dropping cases',async()=>{
  const {manifest,corpus}=syntheticProtocolInputs();const costly={...deterministicSyntheticAdapter,async run(input:Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){return {...await deterministicSyntheticAdapter.run(input,signal) as object,costMicrousd:1,discardedCostMicrousd:2};}};
  const measured=await run(manifest,corpus,costly);expect(measured.candidate.totalCostMicrousd).toBe(18);expect(measured.candidate.costPerSuccessMicrousd).toBe(18/5);
  manifest.budget.maxCostMicrousd=1;const over=await run(manifest,corpus,costly);expect(over.status).toBe('incomplete');expect(over.calls).toBe(1);expect(over.candidate.assigned).toBe(6);
  const missing=syntheticProtocolInputs();const unknown={...deterministicSyntheticAdapter,async run(input:Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){return {...await deterministicSyntheticAdapter.run(input,signal) as object,costMicrousd:null,latencyMs:null};}};
  const unmeasured=await run(missing.manifest,missing.corpus,unknown);expect(unmeasured.status).toBe('incomplete');expect(unmeasured.candidate.totalCostMicrousd).toBeNull();expect(unmeasured.candidate.p95LatencyMs).toBeNull();
  missing.manifest.budget.maxWallTimeMs=5;const hung={...deterministicSyntheticAdapter,async run(){return new Promise(()=>{});}};const timed=await run(missing.manifest,missing.corpus,hung);expect(timed.status).toBe('incomplete');expect(timed.calls).toBe(1);
  const controller=new AbortController();controller.abort();const cancelled=await run(missing.manifest,missing.corpus,deterministicSyntheticAdapter,controller.signal);expect(cancelled.calls).toBe(0);expect(cancelled.candidate.skipped).toBe(6);
});
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function workflowFixture(){
 const {manifest,corpus}=syntheticProtocolInputs(),c=candidate(manifest),root=await mkdtemp(join(tmpdir(),'vox-evaluation-protocol-'));roots.push(root);const trust:TrustStore={},keys:Record<string,string>={};
 for(const role of ['analyst','author','evaluator','human'] as Authority[]){const pair=generateKeyPairSync('ed25519');trust[role]={role,publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString()};keys[role]=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString();}
 const sign=<T>(role:Authority,purpose:string,payload:T)=>attest(role,keys[role],purpose,payload),workflow=new ImprovementWorkflow({root,trust,now:()=>now});
 await workflow.importFinding('finding',sign('analyst','approved_finding',{schemaVersion:1,id:'finding',kind:'synthetic',problemCode:'audio_cancellation',sourceDigest:c.baselineRevision,lineageIds:[hash('lineage')],sampleCount:10,failureCount:1,purpose:'product_improvement',reviewedAt:now,expiresAt:now+10000}));
 await workflow.proposeRouting('proposal',{id:'proposal',findingId:'finding',kind:'routing_change',hypothesis:'cancelled_turn_should_stop',expectedOutcome:'zero_post_cancel_work',baselineRevision:c.baselineRevision,baselineArtifactDigest:hash(canonical(baseline)),createdAt:now,evaluationProtocolDigest:c.evaluationProtocolDigest,budget:{maxCases:6,maxCandidates:2}});
 await workflow.registerCandidate('candidate',sign('author','candidate_artifact',{proposalId:'proposal',candidate:c,artifact}));
 const optimized=optimizeProtocolRouting(baseline,optimizerProjection(manifest,corpus,now),2);expect(optimized.artifact).toEqual(artifact);expect(optimized.evidence).toBe('optimization_only');
 const reservation=sign('evaluator','evaluation_protocol_reservation',protocolReservationRequest(c,manifest,hash(canonical(baseline)),'evaluator',now));
 const protocol=sign('evaluator','evaluation_protocol',await evaluateReservedProtocol(workflow,'reserve-final',reservation,{manifest,corpus,candidate:c,artifact,baseline,evaluatorServiceId:'evaluator',adapter:deterministicSyntheticAdapter,clock:()=>now}));
 // Explicit synthetic signed host receipt fixture. No Docker execution is claimed by this E1 test.
 const evaluation:ProtectedEvaluation={receipt:{candidateId:c.id,candidateRevision:c.candidateRevision,artifactDigest:c.artifactDigest,evaluatorServiceId:'evaluator',evaluatorVersion:c.evaluatorVersion,datasetVersion:c.datasetVersion,promotionPolicyVersion:c.promotionPolicyVersion,baselineRevision:c.baselineRevision,status:'passed',privacyFailures:0,failedChecks:0,skippedChecks:0,testedAt:now},details:{sourceDigest:c.baselineRevision,artifactDigest:c.artifactDigest,baselineArtifactDigest:hash(canonical(baseline)),datasetDigest:c.datasetVersion,evaluatorDigest:c.evaluatorVersion,imageDigest:`sha256:${hash('synthetic-image-not-executed')}`,policyDigest:c.promotionPolicyVersion,phase:'protected_final',isolation:'docker_network_none_readonly',checks:2,baselineFailures:1,candidateFailures:0}};
 const legacy=sign('evaluator','protected_evaluation',evaluation),bind=()=>bindProtocolFinalEvaluation({candidate:c,evaluation:legacy,protocol,trust,evaluatorKeyId:'evaluator',evaluatorPrivateKey:keys.evaluator,now});return {root,trust,keys,workflow,c,manifest,corpus,protocol,reservation,legacy,bind,sign};
}
it('signed companion is required before the old final receipt and human readiness; restart preserves exact bindings',async()=>{
 const f=await workflowFixture();await expect(f.workflow.attachEvaluation('legacy',f.legacy)).rejects.toThrow('evaluation_protocol_required');
 expect(await assessPromotion(f.c,f.legacy.payload.receipt,{now,verifyReceipt:async()=>true,humanApproved:async()=>true})).toEqual({ready:false,reason:'version_mismatch'});
 await f.workflow.attachEvaluationProtocol('protocol',f.protocol);const final=f.bind();await f.workflow.attachEvaluation('final',final);expect(await f.workflow.readiness(f.c.id)).toEqual({ready:false,reason:'human_release_required'});
 await f.workflow.approve('approval',f.sign('human','release_review',{candidateId:f.c.id,artifactDigest:f.c.artifactDigest,evaluationDigest:hash(canonical(final)),decision:'approve',approvedAt:now,expiresAt:now+500}));
 expect(await new ImprovementWorkflow({root:f.root,trust:f.trust,now:()=>now}).readiness(f.c.id)).toMatchObject({ready:true});
 const bytes=JSON.stringify(await f.workflow.listReviewQueue());expect(bytes).not.toMatch(/Fictional task|درخواست|minimumSuccessRate|minimumPairedSuccessGain|calibrationDigest/);
 expect(await new ImprovementWorkflow({root:f.root,trust:f.trust,now:()=>1000}).readiness(f.c.id)).toEqual({ready:false,reason:'failed'});
});
it('rejects author/optimizer attestations, changed protocol/base/corpus/judge/scoring/split/budget and signed private narratives',async()=>{
 const f=await workflowFixture();await expect(f.workflow.attachEvaluationProtocol('wrong-role',f.sign('author','evaluation_protocol',f.protocol.payload))).rejects.toThrow('untrusted');
 for(const field of ['protocolDigest','candidateRevision','baselineRevision','legacyDatasetDigest','candidateEvaluatorDigest','promotionPolicyDigest'] as const){await expect(f.workflow.attachEvaluationProtocol(randomUUID(),f.sign('evaluator','evaluation_protocol',{...f.protocol.payload,[field]:hash(field)}))).rejects.toThrow();}
 await expect(f.workflow.attachEvaluationProtocol('private',f.sign('evaluator','evaluation_protocol',{...f.protocol.payload,text:'PROTECTED_CANARY'}))).rejects.toThrow();
 const altered=structuredClone(f.manifest);altered.scoring.minimumSuccessRate=0;altered.digests.scoring=hash(canonical(altered.scoring));await expect(runEvaluation({manifest:altered,corpus:f.corpus,candidate:f.c,artifact,baseline,evaluatorServiceId:'evaluator',adapter:deterministicSyntheticAdapter,clock:()=>now})).rejects.toThrow('binding_mismatch');
 await f.workflow.attachEvaluationProtocol('protocol',f.protocol);await expect(f.workflow.attachEvaluationProtocol('protocol',f.sign('evaluator','evaluation_protocol',{...f.protocol.payload,testedAt:now+1}))).rejects.toThrow('idempotency_conflict');
 const wrongFinal={...f.bind(),payload:{...f.bind().payload,details:{...f.bind().payload.details,protocolReceiptDigest:hash('other')}}};await expect(f.workflow.attachEvaluation('tamper',f.sign('evaluator','protected_evaluation',wrongFinal.payload))).rejects.toThrow('evaluation_protocol_required');
});

it('frozen manifest commitment rejects changed digest components, split rules and budgets after candidate registration', async()=>{
 const f=await workflowFixture();
 for(const field of ['corpus','judge','scoring','runner','adapter','final'] as const){const payload=structuredClone(f.protocol.payload);payload.bindings[field]=hash(field);await expect(f.workflow.attachEvaluationProtocol(randomUUID(),f.sign('evaluator','evaluation_protocol',payload))).rejects.toThrow();}
 const changed=structuredClone(f.protocol.payload);changed.budget.maxCostMicrousd++;await expect(f.workflow.attachEvaluationProtocol(randomUUID(),f.sign('evaluator','evaluation_protocol',changed))).rejects.toThrow();
 const split=structuredClone(f.protocol.payload);split.protocolMetadata.splitDigest=hash('other-split');await expect(f.workflow.attachEvaluationProtocol(randomUUID(),f.sign('evaluator','evaluation_protocol',split))).rejects.toThrow();
 const undersupported=syntheticProtocolInputs();undersupported.manifest.statistics.minimumIndependentUnits=7;expect(()=>validateEvaluationInputs(undersupported.manifest,undersupported.corpus,now)).toThrow('independent_units_insufficient');
});
it('checks protocol expiry and clock regression after awaited adapters before signing any result',async()=>{
 const f=syntheticProtocolInputs();let clock=now;const expired={...deterministicSyntheticAdapter,async run(input:Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){clock=1000;return deterministicSyntheticAdapter.run(input,signal);}};
 await expect(runEvaluation({manifest:f.manifest,corpus:f.corpus,candidate:candidate(f.manifest),artifact,baseline,evaluatorServiceId:'evaluator',adapter:expired,clock:()=>clock})).rejects.toThrow('expired');
 clock=now;const backwards={...deterministicSyntheticAdapter,async run(input:Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){clock=now-1;return deterministicSyntheticAdapter.run(input,signal);}};
 await expect(runEvaluation({manifest:f.manifest,corpus:f.corpus,candidate:candidate(f.manifest),artifact,baseline,evaluatorServiceId:'evaluator',adapter:backwards,clock:()=>clock})).rejects.toThrow('expired');
});

it('pure promotion gate cannot use its legacy callback contract for protocol-bound candidates',async()=>{
 const f=await workflowFixture();const receipt={...f.legacy.payload.receipt,evaluationProtocolDigest:f.c.evaluationProtocolDigest};
 expect(await assessPromotion(f.c,receipt,{now,verifyReceipt:async()=>true,humanApproved:async()=>true})).toEqual({ready:false,reason:'untrusted_receipt'});
});
it('a failed protected protocol consumes the final corpus and cannot be used for legacy final readiness or another candidate',async()=>{
 const f=await workflowFixture();const failed=f.sign('evaluator','evaluation_protocol',{...f.protocol.payload,status:'failed' as const});
 await f.workflow.attachEvaluationProtocol('failed-protocol',failed);expect(await f.workflow.readiness(f.c.id)).toEqual({ready:false,reason:'failed'});
 await expect(f.workflow.attachEvaluation('legacy-final',f.legacy)).rejects.toThrow('evaluation_protocol_required');
 const other={...f.c,id:'second-candidate'};await f.workflow.registerCandidate('other-candidate',f.sign('author','candidate_artifact',{proposalId:'proposal',candidate:other,artifact}));
 await expect(f.workflow.reserveEvaluationProtocol('other-protocol',f.sign('evaluator','evaluation_protocol_reservation',protocolReservationRequest(other,f.manifest,hash(canonical(baseline)),'evaluator',now)))).rejects.toThrow('protocol_final_dataset_consumed');
});
it('unavailable or low judge scores cannot be hidden by correct actions and favorable cost',async()=>{
 const f=syntheticProtocolInputs();for(const score of [null,0]){const judge={...deterministicSyntheticAdapter,async run(input:Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){return {...await deterministicSyntheticAdapter.run(input,signal) as object,judgeScore:score};}};const result=await run(f.manifest,f.corpus,judge);expect(result.status).toBe(score===null?'incomplete':'failed');expect(result.candidate.qualityPerAssignedCase).toBe(0);}
});

it('durable reservation makes exact retry read-only and prevents another protected adapter run after a lost response',async()=>{
 const f=await workflowFixture();let calls=0;const adapter={...deterministicSyntheticAdapter,async run(input:Parameters<SyntheticEvaluationAdapter['run']>[0],signal:AbortSignal){calls++;return deterministicSyntheticAdapter.run(input,signal);}};
 const restarted=new ImprovementWorkflow({root:f.root,trust:f.trust,now:()=>now});
 await expect(evaluateReservedProtocol(restarted,'reserve-final',f.reservation,{manifest:f.manifest,corpus:f.corpus,candidate:f.c,artifact,baseline,evaluatorServiceId:'evaluator',adapter,clock:()=>now})).rejects.toThrow('protocol_attempt_already_reserved');expect(calls).toBe(0);
 await expect(restarted.reserveEvaluationProtocol('reserve-final',f.sign('evaluator','evaluation_protocol_reservation',{...f.reservation.payload,reservedAt:now+1}))).rejects.toThrow('idempotency_conflict');
});
