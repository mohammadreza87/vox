import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rightsApi, type RightsRequestView } from './rights-client';
const auth=vi.hoisted(()=>({session:'signed-a'}));
vi.mock('./client',()=>({tg:()=>({initData:auth.session})}));
const requestId='00000000-0000-4000-8000-000000000001',eventId='00000000-0000-4000-8000-000000000002';
const row={requestId,revision:1,space:'work',kind:'erasure',state:'received'} as RightsRequestView;
const input={version:1 as const,eventId,expectedRequestRevision:1,space:'work' as const,memoryId:'private-note-id',expectedMemoryRevision:3,locale:'en' as const};
const plan=()=>({version:1 as const,requestId,space:'work' as const,eventId,memoryId:input.memoryId,memoryRevision:3,planHandle:'x'.repeat(40),expiresAt:Date.now()+60000});
const coverage={canonicalSelectedNote:'unknown',canonicalDependentNotes:'unknown',queuedDerivedUse:'unknown',noncanonicalDerivativeCopies:'unverified',noncanonicalDerivativeUse:'unverified',sharedCopies:'not_implemented',otherPrivateData:'outside_selected_scope',storageFileRemnants:'unverified',providers:'not_implemented',backups:'not_implemented',requestFulfillment:'not_established'};
const status={operationRef:'a'.repeat(64),technical:'unknown',recording:'recorded',observedAt:null,effectRevision:null,coverage};
const view=()=>({version:1,requestId,requestRevision:1,space:'work',available:true,operations:[{...status,coverage:{...coverage}}]});
beforeEach(()=>{auth.session='signed-a';});afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it('uses scoped no-store GET recovery without remembered browser handles, and only explicit plan/execute POST bodies',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json(view())).mockResolvedValueOnce(Response.json(plan())).mockResolvedValueOnce(Response.json({...view(),operationRef:status.operationRef,replayed:false}));vi.stubGlobal('fetch',fetcher);
 expect((await rightsApi.privateNoteErasure(row,auth.session)).operations[0].technical).toBe('unknown'); const planned=await rightsApi.privateNoteErasurePlan(row,input,auth.session);await rightsApi.privateNoteErasureExecute(row,planned,auth.session);
 expect(fetcher.mock.calls[0]).toEqual([`/api/studio/rights/requests/${requestId}/private-note-erasure?space=work`,expect.objectContaining({method:'GET',cache:'no-store',credentials:'same-origin'})]);expect(fetcher.mock.calls[0][1].body).toBeUndefined(); expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(input);expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({version:1,eventId,planHandle:planned.planHandle});expect(fetcher.mock.calls[2][0]).toContain('/execute?space=work');
});
it.each(['request','revision','space','duplicate','extra','false_proof'] as const)('rejects invalid %s GET status without further calls',async reason=>{
 const result=view();if(reason==='request')result.requestId=eventId;if(reason==='revision')result.requestRevision=2;if(reason==='space')result.space='personal';if(reason==='duplicate')result.operations.push(status);if(reason==='extra')Object.assign(result,{text:'PRIVATE_CANARY'});if(reason==='false_proof')Object.assign(result.operations[0],{effectRevision:2}); const fetcher=vi.fn().mockResolvedValue(Response.json(result));vi.stubGlobal('fetch',fetcher);await expect(rightsApi.privateNoteErasure(row,auth.session)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['eventId','memoryId','memoryRevision','space','requestId','expired','extra'] as const)('rejects a mismatched %s plan before execution',async field=>{
 const result=plan();if(field==='eventId')result.eventId=requestId;if(field==='memoryId')result.memoryId='wrong';if(field==='memoryRevision')result.memoryRevision=4;if(field==='space')Object.assign(result,{space:'personal'});if(field==='requestId')result.requestId=eventId;if(field==='expired')result.expiresAt=1;if(field==='extra')Object.assign(result,{text:'PRIVATE_CANARY'});const fetcher=vi.fn().mockResolvedValue(Response.json(result));vi.stubGlobal('fetch',fetcher);await expect(rightsApi.privateNoteErasurePlan(row,input,auth.session)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects stale scope/closed request before POST and rejects an unassociated mutation operation',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({...view(),operationRef:'b'.repeat(64),replayed:false}));vi.stubGlobal('fetch',fetcher);
 await expect(rightsApi.privateNoteErasurePlan(row,{...input,expectedRequestRevision:2},auth.session)).rejects.toThrow();await expect(rightsApi.privateNoteErasureExecute({...row,state:'closed_unfulfilled'},plan(),auth.session)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();await expect(rightsApi.privateNoteErasureExecute(row,plan(),auth.session)).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects an account change during JSON decoding and never repeats a destructive command',async()=>{
 let finish!: (value:unknown)=>void;const response={ok:true,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(resolve=>{finish=resolve;})};const fetcher=vi.fn().mockResolvedValue(response);vi.stubGlobal('fetch',fetcher);const pending=rightsApi.privateNoteErasureExecute(row,plan(),auth.session);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));auth.session='signed-b';finish({...view(),operationRef:status.operationRef,replayed:false});await expect(pending).rejects.toThrow();expect(fetcher).toHaveBeenCalledOnce();
});
it('expires an in-flight execute after 15 seconds without retry or optimistic receipt',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn((_url,init:RequestInit)=>new Promise((_resolve,reject)=>init.signal?.addEventListener('abort',()=>reject(Error('aborted')))));vi.stubGlobal('fetch',fetcher);const pending=rightsApi.privateNoteErasureExecute(row,plan(),auth.session),outcome=expect(pending).rejects.toThrow();await vi.advanceTimersByTimeAsync(15000);await outcome;expect(fetcher).toHaveBeenCalledOnce();
});
