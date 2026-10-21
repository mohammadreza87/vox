import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrivacyScreen } from './Privacy';
import type { AdaptiveSnapshot } from '../../_lib/adaptive-client';
const mocks=vi.hoisted(()=>({session:'a',read:vi.fn(),agents:vi.fn(),rightsRead:vi.fn(),privateNoteErasure:vi.fn(),privateNoteErasurePlan:vi.fn(),privateNoteErasureExecute:vi.fn(),save:vi.fn(),remove:vi.fn(),nav:null as unknown}));
vi.mock('../../_lib/client',async importOriginal=>({...await importOriginal<typeof import('../../_lib/client')>(),tg:()=>({initData:mocks.session}),api:{agents:mocks.agents}}));
vi.mock('../../_lib/adaptive-client',()=>({adaptiveApi:mocks}));
vi.mock('../../_lib/rights-client',()=>({rightsApi:{read:mocks.rightsRead,privateNoteErasure:mocks.privateNoteErasure,privateNoteErasurePlan:mocks.privateNoteErasurePlan,privateNoteErasureExecute:mocks.privateNoteErasureExecute}}));
vi.mock('../StudioApp',()=>({useNav:()=>mocks.nav}));
vi.mock('./settings/useInboxBadge',()=>({useInboxBadge:()=>0}));
vi.mock('../Cloud',()=>({Cloud:()=>null,AgentFace:()=>null}));
vi.mock('../ProductPausePanel',()=>({ProductPausePanel:()=>null}));
vi.mock('../GuestRightsOperationsPanel',()=>({GuestRightsOperationsPanel:()=>null}));
vi.mock('../VoiceRecognitionPanel',()=>({VoiceRecognitionPanel:()=>null}));
vi.mock('../ReviewedMemoryPanel',()=>({ReviewedMemoryPanel:()=>null}));
vi.mock('../../_lib/product-pause-client',()=>({useProductPause:()=>({coveredBlocked:false,status:null})}));
const requestId='00000000-0000-4000-8000-000000000001';
const row={version:1,requestId,revision:1,space:'work',kind:'erasure',state:'received',createdAt:1,updatedAt:1,deadline:{state:'reviewed_policy_unavailable',dueAt:null}};
const snapshot:AdaptiveSnapshot={schemaVersion:1,revision:2,space:'work',scope:'private_account_profile',identity:{accountId:'telegram-account:1',personId:'synthetic',bindingId:'binding',bindingRevision:1,confirmed:true,verification:'account_confirmation',adultDeclared:true},explicitMemoryAvailable:true,memories:[{id:'secret-id',revision:1,text:'SYNTHETIC PRIVATE NOTE',createdAt:1,expiresAt:2_000_000_000_000}],purposes:[],agents:[]};
const view={version:1,requestId,requestRevision:1,space:'work',available:true,operations:[]};
beforeEach(()=>{for(const value of Object.values(mocks))if(typeof value==='function')value.mockReset();mocks.session='a';mocks.read.mockResolvedValue(snapshot);mocks.agents.mockResolvedValue({agents:[]});mocks.rightsRead.mockResolvedValue({available:true,policyStatus:'available',supportedKinds:['erasure'],intakePolicy:{revision:1},requests:[row],supportContact:'info@joyixir.com'});mocks.privateNoteErasure.mockResolvedValue(view);mocks.privateNoteErasurePlan.mockImplementation(async(_row,input)=>({version:1,requestId,space:'work',eventId:input.eventId,memoryId:input.memoryId,memoryRevision:input.expectedMemoryRevision,expiresAt:Date.now()+60000,planHandle:'x'.repeat(40)}));});
afterEach(cleanup);
function Harness(props: Parameters<typeof PrivacyScreen>[0]){const [space,setSpace]=useState<'work'|'personal'>('work');mocks.nav={locale:'en',dir:'ltr',space,setSpace,setLocale:vi.fn(),tier:'reduced',snack:vi.fn(),push:vi.fn(),me:{org:'Fixture team',member:{name:'Alice',role:'member'}}};return <PrivacyScreen {...props}/>;}
async function dispatch(){
 // Establish that the canary is actually rendered before asserting its removal.
 // Opening the rights row alone does not establish that the private snapshot is ready.
 expect(await screen.findByText(snapshot.memories[0].text)).toBeVisible();
 const openRights=await screen.findByRole('button',{name:/Request a copy or deletion/});
 await act(async()=>{fireEvent.click(openRights);});
 const erase=await screen.findByRole('button',{name:'Delete this private note'});
 expect(erase).toBeEnabled();
 fireEvent.click(erase);
 fireEvent.click(screen.getByRole('radio'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review deletion'}));});
 fireEvent.click(await screen.findByRole('button',{name:'Delete note'}));
}
it('clears every Privacy note preview on dispatch and locks competing mutation/scope controls',async()=>{
 let finish!:(value:unknown)=>void;mocks.privateNoteErasureExecute.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const pending=vi.fn(()=>true);render(<Harness onCorrectionPendingChange={pending}/>);await dispatch();expect(screen.queryByText(snapshot.memories[0].text)).toBeNull();expect(screen.getByRole('tab',{name:'Personal',exact:true})).toBeDisabled();expect(screen.getByRole('button',{name:/^Language/})).toBeDisabled();expect(screen.getByRole('button',{name:'Save private memory'})).toBeDisabled();expect(screen.getByRole('button',{name:'Submit request'})).toBeDisabled();expect(screen.getByRole('button',{name:'Refresh request status'})).toBeDisabled();expect(pending.mock.calls[0][1]).toBe(true);expect(mocks.remove).not.toHaveBeenCalled();
 await act(async()=>finish({...view,replayed:false,operationRef:'a'.repeat(64)}));expect(screen.getByRole('tab',{name:'Personal',exact:true})).toBeEnabled();expect(pending.mock.calls.at(-1)?.[1]).toBe(false);expect(mocks.privateNoteErasureExecute).toHaveBeenCalledOnce();expect(mocks.read).toHaveBeenCalledOnce();
});
it('discards pending private previews on actual account change and loads the new account without replay',async()=>{
 mocks.privateNoteErasureExecute.mockImplementation(()=>new Promise(()=>undefined));const ui=render(<Harness/>);await dispatch();mocks.session='b';mocks.read.mockResolvedValue({...snapshot,identity:{...snapshot.identity,accountId:'telegram-account:2'},memories:[]});mocks.rightsRead.mockResolvedValue({available:false,policyStatus:'unavailable',supportedKinds:[],requests:[],supportContact:'info@joyixir.com'});ui.rerender(<Harness/>);await waitFor(()=>expect(mocks.read).toHaveBeenCalledTimes(2));expect(screen.queryByText(snapshot.memories[0].text)).toBeNull();expect(mocks.privateNoteErasureExecute).toHaveBeenCalledOnce();expect(mocks.privateNoteErasureExecute.mock.calls[0].at(-1).aborted).toBe(true);
});
it('updates an already open rights sheet when the initial private profile finishes loading',async()=>{
 let finishProfile!:(value:AdaptiveSnapshot)=>void;
 mocks.read.mockReturnValue(new Promise<AdaptiveSnapshot>(resolve=>{finishProfile=resolve;}));
 render(<Harness/>);
 fireEvent.click(await screen.findByRole('button',{name:/Request a copy or deletion/}));
 await screen.findByRole('heading',{name:'Delete this private note'});
 expect(screen.queryByRole('button',{name:'Delete this private note'})).toBeNull();
 await act(async()=>finishProfile(snapshot));
 expect(await screen.findByRole('button',{name:'Delete this private note'})).toBeEnabled();
 expect(screen.getByText(snapshot.memories[0].text)).toBeVisible();
 expect(mocks.privateNoteErasureExecute).not.toHaveBeenCalled();
});
