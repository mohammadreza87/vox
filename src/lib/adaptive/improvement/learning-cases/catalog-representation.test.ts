import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import * as contracts from '../contracts';
import * as evaluation from '../evaluation/contracts';
import * as recipes from './contracts';
import * as catalog from './catalog';
it('canonical catalog identity and output survive TypeScript and minified JS representations',async()=>{
  const source=await readFile('src/lib/adaptive/improvement/learning-cases/catalog.ts','utf8');
  const plain=transpileModule(source,{compilerOptions:{module:ModuleKind.CommonJS,target:ScriptTarget.ES2022}}).outputText;
  const minified=execFileSync(process.execPath,['-e',"const fs=require('node:fs');process.stdout.write(require('esbuild').transformSync(fs.readFileSync(0,'utf8'),{loader:'ts',format:'cjs',minify:true,target:'es2022'}).code)"],{input:source,encoding:'utf8'});
  const finding={schemaVersion:1 as const,id:'fictional',kind:'synthetic' as const,problemCode:'audio_cancellation' as const,sourceDigest:contracts.hash('source'),lineageIds:[contracts.hash('lineage')],sampleCount:1,failureCount:1,purpose:'product_improvement' as const,reviewedAt:1,expiresAt:1000};
  const recipe={version:1 as const,catalogDigest:catalog.LEARNING_CASE_CATALOG_DIGEST,findingId:'fictional',findingImportOperationId:'fictional_import',findingEnvelopeDigest:contracts.hash('fictional_envelope'),scenario:'cancellation' as const,locale:'fa' as const,unit:'fictional_000',occurredAt:10,reviewedAt:20,expiresAt:900,retentionPolicyRef:'fictional_policy',retainUntil:1100};
  const imports:Record<string,unknown>={'../contracts':contracts,'../evaluation/contracts':evaluation,'./contracts':recipes};
  for(const code of [plain,minified]) {
    const sandboxModule={exports:{}};runInNewContext(code,{module:sandboxModule,exports:sandboxModule.exports,require:(name:string)=>{if(!imports[name])throw Error('unexpected_import');return imports[name];}});
    const transformed=sandboxModule.exports as typeof catalog;
    expect(transformed.LEARNING_CASE_CATALOG_DIGEST).toBe(catalog.LEARNING_CASE_CATALOG_DIGEST);
    expect(transformed.learningCaseId(recipe,finding)).toBe(catalog.learningCaseId(recipe,finding));
    expect(transformed.materializeLearningCase(recipe,finding)).toEqual(catalog.materializeLearningCase(recipe,finding));
  }
});
