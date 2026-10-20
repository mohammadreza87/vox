import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, hash, attest, proposalSchema } from '../contracts';
import { assessPromotion, improvementCandidateSchema } from '../index';
import { ImprovementWorkflow } from '../workflow';
import { evaluationProtocolDigest } from '../evaluation/manifest';
import { learningCaseFixture } from './testing';
import { materializeLearningCase, learningCaseId } from './catalog';
import type { PreparedLearningCases } from './contracts';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true});});
async function fixture(){const root=await fs.mkdtemp(join(tmpdir(),'vox-lc1-author-'));roots.push(root);return learningCaseFixture(root);}
it('explicit migration preserves original history, has incompatible real v1 digest, strict current restart and no read writes',async()=>{
  const s=await fixture(), names=await fs.readdir(join(s.root,'audit'));
  const first=JSON.parse(await fs.readFile(join(s.root,'audit',names[0]),'utf8'));
  const second=JSON.parse(await fs.readFile(join(s.root,'audit',names[1]),'utf8'));
  const {digest,...body}=second;
  expect(first.schemaVersion).toBeUndefined(); expect(second.schemaVersion).toBe(2);
  expect(hash(canonical(body))).not.toBe(digest); expect(hash(canonical({domain:'vox.improvement.audit.v2',body}))).toBe(digest);
  expect(second.state.generation).toBe(1); expect(second.state.operations.fictional_import).toBe(first.state.operations.fictional_import);
  const other=new ImprovementWorkflow({root:s.root,trust:s.trust,now:s.now});
  expect((await other.report()).auditEvents).toBe(names.length);
  await other.report(); expect(await fs.readdir(join(s.root,'audit'))).toEqual(names);
});
it('materialization is closed, deterministic and does not persist case bodies',async()=>{
  const s=await fixture(); const recipe=s.recipes[0];
  expect(materializeLearningCase(recipe,s.finding)).toEqual(s.corpus.optimization[0]);
  expect(learningCaseId({...recipe,reviewedAt:401},s.finding)).toBe(s.caseId);
  expect(()=>materializeLearningCase({...recipe,text:'PRIVATE_CANARY'} as never,s.finding)).toThrow();
  expect(()=>materializeLearningCase({...recipe,unit:hash('private_identity')} as never,s.finding)).toThrow();
  const history=(await Promise.all((await fs.readdir(join(s.root,'audit'))).map(n=>fs.readFile(join(s.root,'audit',n),'utf8')))).join('');
  expect(history).not.toContain('Synthetic routing exercise.'); expect(history).not.toContain('تمرین ساختگی');
  expect(history).not.toContain('"text":'); expect(history).not.toContain('"expected":');
});
it('rejects unknown fields, wrong signer, substituted original envelope and nonoriginal operation',async()=>{
  const s=await fixture();const recipe={...s.recipes[0],unit:'fictional_100'};
  await expect(s.workflow.admitLearningCase('wrongrole',{finding:s.imported,review:s.sign('author','learning_case_review',recipe)})).rejects.toThrow();
  const replacement=attest('analyst',s.keys.analyst,'approved_finding',s.finding);
  // Ed25519 is deterministic: a truly equivalent exact envelope is identical.
  expect(replacement).toEqual(s.imported);
  const changedPurpose={...s.imported,purpose:'other'};
  await expect(s.workflow.admitLearningCase('badsource',{finding:changedPurpose,review:s.sign('human','learning_case_review',recipe)})).rejects.toThrow();
  await expect(s.workflow.admitLearningCase('badop',{finding:s.imported,review:s.sign('human','learning_case_review',{...recipe,findingImportOperationId:'fictional_migrate'})})).rejects.toThrow();
  await expect(s.workflow.admitLearningCase('raw',{finding:s.imported,review:s.sign('human','learning_case_review',{...recipe,input:'PRIVATE_CANARY'})})).rejects.toThrow();
});
it('only genuine current-head capabilities dispatch and adapter access requires reservation',async()=>{
  const s=await fixture(), binding={protocolDigest:evaluationProtocolDigest(s.manifest),lineageDigest:s.manifest.learningCases!.lineageDigest};
  let calls=0;
  await expect(s.workflow.withLearningCaseAuthority({} as PreparedLearningCases,binding,'optimization',()=>++calls)).rejects.toThrow('authority_stale');
  await expect(s.workflow.withLearningCaseAuthority(s.handle,binding,'adapter',()=>++calls)).rejects.toThrow('reservation_required');
  expect(calls).toBe(0);
  expect(await s.workflow.withLearningCaseAuthority(s.handle,binding,'optimization',view=>{expect(view.corpus).toEqual(s.corpus);return ++calls;})).toBe(1);
  const other=new ImprovementWorkflow({root:s.root,trust:s.trust,now:s.now});
  await expect(other.withLearningCaseAuthority(s.handle,binding,'optimization',()=>++calls)).rejects.toThrow('authority_stale');
});
it('same-writer source revocation invalidates prepared and persisted corpus without pruning',async()=>{
  const s=await fixture(), binding={protocolDigest:evaluationProtocolDigest(s.manifest),lineageDigest:s.manifest.learningCases!.lineageDigest};
  const other=new ImprovementWorkflow({root:s.root,trust:s.trust,now:s.now});
  await other.revokeLineage('revoke',s.sign('human','revoke_lineage',{lineageId:s.finding.lineageIds[0]}));
  await expect(s.workflow.withLearningCaseAuthority(s.handle,binding,'optimization',()=>1)).rejects.toThrow();
  await expect(s.workflow.prepareLearningCases(s.preparation)).rejects.toThrow('finding_ineligible');
  const state=JSON.parse(await fs.readFile(join(s.root,'audit',(await fs.readdir(join(s.root,'audit'))).at(-1)!),'utf8')).state;
  expect(Object.keys(state.learningCases)).toHaveLength(18); expect(state.revokedLineages).toContain(s.finding.lineageIds[0]);
});
it('stable case withdrawal denies whole frozen corpus and cannot be readmitted by operation/review changes',async()=>{
  const s=await fixture();await s.workflow.withdrawLearningCase('withdraw',s.sign('human','withdraw_learning_case',{caseId:s.caseId,reviewedAt:500}));
  await expect(s.workflow.prepareLearningCases(s.preparation)).rejects.toThrow('ineligible');
  await expect(s.workflow.admitLearningCase('newreview',{finding:s.imported,review:s.sign('human','learning_case_review',{...s.recipes[0],reviewedAt:450})})).rejects.toThrow('exists_or_withdrawn');
});
it('trust change and exact expiry/clock rollback fail closed across restart',async()=>{
  const s=await fixture(), changed=new ImprovementWorkflow({root:s.root,trust:{...s.trust,analyst:{...s.trust.analyst,publicKey:s.trust.analyst.publicKey+'\n'}},now:s.now});
  await expect(changed.prepareLearningCases(s.preparation)).rejects.toThrow('trust_changed');
  s.setNow(1000); await expect(s.workflow.prepareLearningCases(s.preparation)).rejects.toThrow('evaluation_protocol_expired');
  s.setNow(500); await expect(new ImprovementWorkflow({root:s.root,trust:s.trust,now:s.now}).prepareLearningCases(s.preparation)).rejects.toThrow('clock_invalid');
});
it('rejects malformed snapshots, unknown versions, v1 tails and missing mandatory maps',async()=>{
  const s=await fixture(), dir=join(s.root,'audit'), name=(await fs.readdir(dir)).at(-1)!, path=join(dir,name), original=await fs.readFile(path,'utf8');
  for(const mutate of [(x:Record<string,unknown>)=>{delete (x.state as Record<string,unknown>).learningCases;},(x:Record<string,unknown>)=>{x.schemaVersion=3;},(x:Record<string,unknown>)=>{x.extra='private';}]) {
    const event=JSON.parse(original);mutate(event);const body={...event};delete body.digest;event.digest=hash(canonical({domain:'vox.improvement.audit.v2',body}));await fs.writeFile(path,canonical(event));
    await expect(s.workflow.report()).rejects.toThrow(); await fs.writeFile(path,original);
  }
  const last=JSON.parse(original);const body={sequence:last.sequence+1,previous:last.digest,action:'legacy_tail',operationId:'legacy_tail',at:500,state:{}};
  await fs.writeFile(join(dir,`${String(body.sequence).padStart(10,'0')}.json`),canonical({...body,digest:hash(canonical(body))}));await expect(s.workflow.report()).rejects.toThrow('audit_corrupt');
});
it('latches valid expiry observed after durable append before dispatch, across restart',async()=>{
  const s=await fixture(), original=fs.link.bind(fs); let advance=true,calls=0;
  const spy=vi.spyOn(fs,'link').mockImplementation(async(source,target)=>{await original(source,target);if(advance){advance=false;s.setNow(1000);}});
  try {
    const binding={protocolDigest:evaluationProtocolDigest(s.manifest),lineageDigest:s.manifest.learningCases!.lineageDigest};
    await expect(s.workflow.withLearningCaseAuthority(s.handle,binding,'optimization',()=>++calls)).rejects.toThrow('expired');
    expect(calls).toBe(0);
  } finally {spy.mockRestore();}
  const last=JSON.parse(await fs.readFile(join(s.root,'audit',(await fs.readdir(join(s.root,'audit'))).at(-1)!),'utf8'));
  expect(last.action).toBe('learning_cases_clock_observed'); expect(last.state.observedAt).toBe(1000);
  s.setNow(600);await expect(new ImprovementWorkflow({root:s.root,trust:s.trust,now:s.now}).prepareLearningCases(s.preparation)).rejects.toThrow('clock_invalid');
});
it('rejects asynchronous handoff before invoking its body and never holds writer during pending work',async()=>{
  const s=await fixture(), binding={protocolDigest:evaluationProtocolDigest(s.manifest),lineageDigest:s.manifest.learningCases!.lineageDigest};let calls=0;
  await expect(s.workflow.withLearningCaseAuthority(s.handle,binding,'optimization',async()=>{await Promise.resolve();calls++;})).rejects.toThrow('async_handoff_forbidden');
  await Promise.resolve();expect(calls).toBe(0);
  let complete!:()=>void;const pending=new Promise<void>(resolve=>{complete=resolve;});
  const result=await s.workflow.withLearningCaseAuthority(s.handle,binding,'optimization',()=>({pending}));
  expect(result.pending).toBe(pending); await expect(fs.stat(join(s.root,'writer.lock'))).rejects.toMatchObject({code:'ENOENT'});complete();await result.pending;
});
it('sidecar commits exact reviewed source/expiry metadata, not just matching materialized bodies',async()=>{
  const s=await fixture(), sidecar=structuredClone(s.sidecar.payload);sidecar.cases[0].caseRecordDigest=hash('replacement_review_with_same_body');
  const substituted=s.sign('evaluator','learning_case_corpus',sidecar), manifest=structuredClone(s.manifest);manifest.learningCases!.lineageDigest=hash(canonical(substituted));
  await expect(s.workflow.prepareLearningCases({manifest,sidecar:substituted})).rejects.toThrow('corpus_ineligible');
});
it('stripped LC1 declarations cannot fall into the enrolled source legacy proposal or pure promotion path',async()=>{
  const s=await fixture(), proposal={id:'stripped_proposal',findingId:s.finding.id,kind:'routing_change' as const,hypothesis:'cancelled_turn_should_stop' as const,
    expectedOutcome:'zero_post_cancel_work' as const,baselineRevision:s.finding.sourceDigest,baselineArtifactDigest:hash('fictional_baseline'),createdAt:500,budget:{maxCandidates:1,maxCases:6}};
  await expect(s.workflow.proposeRouting('stripped',proposal)).rejects.toThrow('authority_required');
  expect(proposalSchema.safeParse({...proposal,schemaVersion:2}).success).toBe(false);
  const candidate={schemaVersion:2 as const,learningCases:s.manifest.learningCases,id:'fictional_candidate',authorServiceId:'author',baselineRevision:s.finding.sourceDigest,
    candidateRevision:hash('candidate'),artifactDigest:hash('candidate'),problemCode:'audio_cancellation' as const,evidenceIds:[s.finding.id],evidenceKind:'synthetic' as const,
    changedPaths:['src/features/call/cancellation-routing.ts'],evaluatorVersion:hash('evaluator'),datasetVersion:hash('final'),promotionPolicyVersion:hash('policy'),
    evaluationProtocolDigest:evaluationProtocolDigest(s.manifest),rollbackRevision:s.finding.sourceDigest,createdAt:500};
  expect(improvementCandidateSchema.safeParse(candidate).success).toBe(true);
  expect(improvementCandidateSchema.safeParse({...candidate,learningCases:undefined}).success).toBe(false);
  expect(improvementCandidateSchema.safeParse({...candidate,schemaVersion:1}).success).toBe(false);
  expect(await assessPromotion(candidate,undefined,{now:500,verifyReceipt:async()=>true,humanApproved:async()=>true})).toEqual({ready:false,reason:'untrusted_receipt'});
});
