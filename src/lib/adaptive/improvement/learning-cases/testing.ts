/** Author-test fixture; synthetic roles, policies and data only. No runtime hook. */
import { generateKeyPairSync } from 'node:crypto';
import { attest, canonical, hash, type Authority, type MinimizedFinding, type TrustStore } from '../contracts';
import { ImprovementWorkflow } from '../workflow';
import { scenarios, type EvaluationCorpus } from '../evaluation/contracts';
import { syntheticProtocolInputs } from '../evaluation/synthetic';
import { fictionalUnits, type LearningCaseRecipe, type LearningCaseSidecar } from './contracts';
import { LEARNING_CASE_CATALOG_DIGEST, learningCaseId, materializeLearningCase } from './catalog';
export async function learningCaseFixture(root: string) {
  let now=500;
  const trust:TrustStore={}, keys:Record<string,string>={};
  for(const role of ['analyst','author','evaluator','human'] as Authority[]) { const pair=generateKeyPairSync('ed25519');
    trust[role]={role,publicKey:pair.publicKey.export({type:'spki',format:'pem'}).toString()}; keys[role]=pair.privateKey.export({type:'pkcs8',format:'pem'}).toString(); }
  const sign=<T>(role:Authority,purpose:string,payload:T)=>attest(role,keys[role],purpose,payload);
  const workflow=new ImprovementWorkflow({root,trust,now:()=>now});
  const finding:MinimizedFinding={schemaVersion:1,id:'fictional_finding',kind:'synthetic',problemCode:'audio_cancellation',sourceDigest:hash('fictional_source'),
    lineageIds:[hash('fictional_source_lineage')],sampleCount:18,failureCount:6,purpose:'product_improvement',reviewedAt:10,expiresAt:2000};
  const imported=sign('analyst','approved_finding',finding); await workflow.importFinding('fictional_import',imported); await workflow.migrateLearningCases('fictional_migrate');
  const corpus:EvaluationCorpus={schemaVersion:2,provenance:'synthetic_only',optimization:[],validation:[],final:[]};
  const recipes:LearningCaseRecipe[]=[], refs:LearningCaseSidecar['cases']=[];
  for (const [p,partition] of (['optimization','validation','final'] as const).entries()) for(const [i,scenario] of scenarios.entries()) {
    const recipe:LearningCaseRecipe={version:1,catalogDigest:LEARNING_CASE_CATALOG_DIGEST,findingId:finding.id,findingImportOperationId:'fictional_import',findingEnvelopeDigest:hash(canonical(imported)),scenario,
      locale:(['en','fa','mixed'] as const)[i%3],unit:fictionalUnits[p*6+i],occurredAt:100+p*100+i,reviewedAt:400,expiresAt:1500,retentionPolicyRef:'fictional_review_only',retainUntil:2500};
    recipes.push(recipe); const review=sign('human','learning_case_review',recipe); const id=await workflow.admitLearningCase(`fictional_case_${p}_${i}`,{finding:imported,review});
    const materialized=materializeLearningCase(recipe,finding); corpus[partition].push(materialized);
    refs.push({caseId:id,partition,ordinal:i,materializedDigest:hash(canonical(materialized)),caseRecordDigest:hash(canonical({finding:imported,review}))});
  }
  const sidecar=sign('evaluator','learning_case_corpus',{version:1 as const,catalogDigest:LEARNING_CASE_CATALOG_DIGEST,corpusDigest:hash(canonical(corpus)),cases:refs,
    reviewedAt:410,expiresAt:1200,retentionPolicyRef:'fictional_corpus_review_only',retainUntil:2600});
  const manifest=syntheticProtocolInputs().manifest; manifest.schemaVersion=2; manifest.learningCases={version:1,lineageDigest:hash(canonical(sidecar))};
  manifest.budget.maxWallTimeMs=60000; manifest.reviewedAt=420; manifest.expiresAt=1000; manifest.retention.retainUntil=2700;
  manifest.digests={...manifest.digests,corpus:hash(canonical(corpus)),optimization:hash(canonical(corpus.optimization)),validation:hash(canonical(corpus.validation)),final:hash(canonical(corpus.final))};
  const preparation={manifest,sidecar}; const handle=await workflow.prepareLearningCases(preparation);
  return {root,workflow,trust,keys,sign,finding,imported,recipes,corpus,sidecar,manifest,preparation,handle,caseId:learningCaseId(recipes[0],finding),setNow:(value:number)=>{now=value;},now:()=>now};
}
