import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdaptiveRepository, accountIdFor } from './repository';
import { AdaptiveService } from './service';
import { FileAdaptiveStorage } from './storage';
import { adaptiveOptionsFromManifest } from './config';
import { MessageMemoryService } from '../message-memory/service';
import { ReviewedMemoryService } from '../reviewed-memory/service';
import { migrateAdaptiveStorage } from './indexed/migration';
import { rollbackAdaptiveStorage } from './indexed/rollback';
import { openManagedAdaptiveStorage } from './indexed/managed-storage';
const roots:string[] = [], stores:{close():void}[] = [];
afterEach(() => { for(const s of stores.splice(0))s.close(); for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true}); });
const now = 1_800_000_000_000, account = accountIdFor(123);
async function fixture() {
  const dir = mkdtempSync(join(realpathSync(tmpdir()),'vox-independent-transition-')); roots.push(dir); const root=join(dir,'adaptive');
  const repository=new AdaptiveRepository(new FileAdaptiveStorage(root));
  const options=adaptiveOptionsFromManifest(JSON.stringify({schemaVersion:1,configurationVersion:'synthetic',enabledCapabilities:['core_text'],
    accounts:[{accountId:account,jurisdictionKeys:['SYNTHETIC'],allowDeclaredAdult:true}], approvals:[{schemaVersion:1,id:'core',revision:1,createdAt:now,updatedAt:now,jurisdiction:'SYNTHETIC',capability:'core_text',state:'approved',configurationVersion:'synthetic',effectiveAt:now,reviewExpiresAt:now+1_000_000,owner:'synthetic',approvalReference:'synthetic'}]}));
  const create=(repo:AdaptiveRepository)=>new AdaptiveService(repo,{...options,now:()=>now}); const adaptive=create(repository);
  await adaptive.confirm(123,{confirm:true,adultConfirmed:true});
  await repository.transaction(account,now,d=>{d.agentGrants=[{agentId:'agent',space:'work',allowed:true,revision:1,updatedAt:now}];d.memories=[{id:'source',revision:1,space:'work',status:'active',text:'Synthetic source.',createdAt:now,updatedAt:now,expiresAt:now+100_000,revocationEpoch:0},{id:'source2',revision:1,space:'work',status:'active',text:'Synthetic second source.',createdAt:now,updatedAt:now,expiresAt:now+100_000,revocationEpoch:0}];});
  return {root,repository,adaptive,create,open:(format:'sqlite-v1'|'file-v2')=>{const s=openManagedAdaptiveStorage(root,{format,now:()=>now});stores.push(s);return s;}};
}
const llm={identity:'synthetic-model',committedExportFence:true as const,complete:async()=>'{"claims":["Synthetic claim."]}'};
const options={llm,secret:'synthetic-at-least-thirty-two-characters',now:()=>now,agentAuthority:async()=> 'studio-authority',agentAuthorityNow:()=> 'studio-authority'};

it.each(['message', 'summary'] as const)('invalidates retained %s previews through actual SQLite and current FILE rollback transitions', async kind => {
  const f = await fixture(); let adaptive = f.adaptive;
  let currentStore: { close(): void } | undefined;
  const scope = { space: 'work' as const, agentId: 'agent', locale: 'en' as const };
  for (const format of ['sqlite-v1', 'file-v2', 'sqlite-v1'] as const) {
    const message = new MessageMemoryService(adaptive, options), summary = new ReviewedMemoryService(adaptive, { ...options, llm: { ...llm, complete: async () => 'Synthetic summary.' } });
    const preview = kind === 'message' ? await message.preview(123, { ...scope, text: 'Synthetic claim.' }) : await summary.preview(123, { ...scope, sourceRefs: [{ id: 'source', revision: 1 }, { id: 'source2', revision: 1 }] });
    const before = await adaptive.withAccountDocument(123, d => JSON.stringify(d));
    currentStore?.close();
    if (format === 'sqlite-v1') await migrateAdaptiveStorage(f.root, { quiesced: true, now: () => now });
    else await rollbackAdaptiveStorage(f.root, { quiesced: true, now: () => now });
    const next = f.open(format); currentStore = next; adaptive = f.create(new AdaptiveRepository(next));
    if ('claims' in preview) {
      const value = { space: scope.space, agentId: scope.agentId, claims: preview.claims, sourceTextHash: preview.sourceTextHash, receipt: preview.receipt };
      const service = new MessageMemoryService(adaptive, options);
      expect(() => service.revalidateNow(123, value)).toThrow('message_memory_changed');
      await expect(service.accept(123, value)).rejects.toThrow('message_memory_changed');
      expect((await service.preview(123, { ...scope, text: 'Synthetic claim.' })).claims).toEqual(['Synthetic claim.']);
    } else {
      const value = { space: scope.space, agentId: scope.agentId, text: preview.text, receipt: preview.receipt };
      const service = new ReviewedMemoryService(adaptive, { ...options, llm: { ...llm, complete: async () => 'Synthetic summary.' } });
      expect(() => service.revalidateNow(123, value)).toThrow('reviewed_memory_changed');
      await expect(service.accept(123, value)).rejects.toThrow('reviewed_memory_changed');
      expect((await service.preview(123, { ...scope, sourceRefs: [{ id: 'source', revision: 1 }, { id: 'source2', revision: 1 }] })).text).toBe('Synthetic summary.');
    }
    expect(await adaptive.withAccountDocument(123, d => JSON.stringify(d))).toBe(before);
  }
});
