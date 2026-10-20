import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RightsLocalUsePanel} from './RightsLocalUsePanel';
import type {LocalUseView,RightsRequestView} from '../_lib/rights-client';
import {localUseNotice} from '@/lib/adaptive/rights-intake/local-use-notice';
const mocks=vi.hoisted(()=>({session:'account-a',localUse:vi.fn(),localUsePlan:vi.fn(),localUseAction:vi.fn()}));
vi.mock('../_lib/client',()=>({tg:()=>({initData:mocks.session})}));
vi.mock('../_lib/rights-client',()=>({rightsApi:mocks}));
const row={version:1,requestId:'00000000-0000-4000-8000-000000000001',space:'work',kind:'restriction',revision:1,state:'received'} as RightsRequestView;
const view=(current:'active'|'released'|'not_applied'='not_applied',purpose:'optional.personalization'|'optional.product_analytics'='optional.personalization'):LocalUseView=>({version:1,status:{version:1,scope:{space:'work',purpose},technical:{current,reconciliation:current==='not_applied'?'none':'recorded'},effectiveBlocked:current==='active',observedAt:1800000000000,useEpoch:current==='not_applied'?0:1,reason:null,...(current==='not_applied'?{}:{selectedEffectId:'00000000-0000-4000-8000-000000000002'})},availableActions:current==='not_applied'?['apply']:current==='active'?['release']:['apply']});
beforeEach(()=>{vi.resetAllMocks();mocks.session='account-a';mocks.localUse.mockResolvedValue(view());mocks.localUsePlan.mockResolvedValue({version:1,scope:view().status.scope,action:'apply',planHandle:'opaque-plan',expiresAt:1800000030000});mocks.localUseAction.mockResolvedValue({...view('active'),replayed:false});});afterEach(cleanup);
it('uses one explicit click, one metadata plan and one action; no operator approval, polling or local storage',async()=>{
 const storage=vi.spyOn(Storage.prototype,'setItem');render(<RightsLocalUsePanel row={row} locale="en" session="account-a"/>);
 const apply=await screen.findByRole('button',{name:'Apply local restriction'});fireEvent.click(apply);fireEvent.click(apply);
 await screen.findByText('Local restriction active.');expect(mocks.localUsePlan).toHaveBeenCalledTimes(1);expect(mocks.localUseAction).toHaveBeenCalledTimes(1);
 expect(mocks.localUseAction.mock.calls[0][2]).toEqual({version:1,eventId:expect.any(String),action:'apply',planHandle:'opaque-plan'});expect(mocks.localUse).toHaveBeenCalledTimes(1);expect(storage).not.toHaveBeenCalled();storage.mockRestore();
 expect(screen.queryByText(/approve hold|completed successfully|all processing/i)).toBeNull();expect(screen.getByRole('button',{name:'End this restriction'})).toBeEnabled();
});
it('keeps lost mutation unknown and permits only a manual read before another action',async()=>{
 mocks.localUseAction.mockRejectedValue(Error('PRIVATE ERROR'));render(<RightsLocalUsePanel row={row} locale="en" session="account-a"/>);fireEvent.click(await screen.findByRole('button',{name:'Apply local restriction'}));
 await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Apply local restriction'})).toBeNull();expect(screen.getAllByText(/Last confirmed/).length).toBeGreaterThan(0);expect(screen.queryByText('PRIVATE ERROR')).toBeNull();
 mocks.localUse.mockResolvedValue(view('active'));fireEvent.click(screen.getByRole('button',{name:'Refresh status'}));await screen.findByText('Local restriction active.');expect(mocks.localUseAction).toHaveBeenCalledTimes(1);expect(mocks.localUse).toHaveBeenCalledTimes(2);
});
it('renders purpose-specific Persian scope, released-with-another-hold and dedicated release semantics',async()=>{
 mocks.localUse.mockImplementation(async(_id,scope)=>({...view('released',scope.purpose),status:{...view('released',scope.purpose).status,effectiveBlocked:true},availableActions:[]}));
 const {container}=render(<RightsLocalUsePanel row={row} locale="fa" session="account-a"/>);await screen.findByText(localUseNotice.fa.otherHold);
 fireEvent.change(screen.getByRole('combobox',{name:localUseNotice.fa.purpose}),{target:{value:'optional.product_analytics'}});
 await screen.findByText(localUseNotice.fa.analyticsScope);expect(screen.queryByText(localUseNotice.fa.personalizationScope)).toBeNull();expect(container.querySelector('section')).toHaveAttribute('dir','rtl');expect(mocks.localUseAction).not.toHaveBeenCalled();
});
it('drops late plan results after external space/account changes before action dispatch',async()=>{
 let finish!:(v:unknown)=>void;mocks.localUsePlan.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const ui=render(<RightsLocalUsePanel row={row} locale="en" session="account-a"/>);
 fireEvent.click(await screen.findByRole('button',{name:'Apply local restriction'}));mocks.session='account-b';mocks.localUse.mockResolvedValue({...view(),status:{...view().status,scope:{space:'personal',purpose:'optional.personalization'}}});
 ui.rerender(<RightsLocalUsePanel row={{...row,space:'personal'}} locale="en" session="account-b"/>);await screen.findByText(/Local use restriction · Personal/);
 await act(async()=>finish({planHandle:'stale'}));expect(mocks.localUseAction).not.toHaveBeenCalled();expect(mocks.localUsePlan.mock.calls[0].at(-1).aborted).toBe(true);
});
it('retains active state with recording failure while new actions are disabled',async()=>{
 const current=view('active');current.availableActions=[];current.status.technical.reconciliation='failed';current.status.reason='policy_unavailable';mocks.localUse.mockResolvedValue(current);
 render(<RightsLocalUsePanel row={row} locale="en" session="account-a"/>);await screen.findByText('Local restriction active.');expect(screen.getByText(localUseNotice.en.recordingFailed)).toBeInTheDocument();expect(screen.getByText(localUseNotice.en.disabled)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'End this restriction'})).toBeNull();
});
it('keeps all server-rendered stateful controls disabled before hydration',()=>{
 const html=renderToString(<RightsLocalUsePanel row={row} locale="fa" session="account-a"/>),element=document.createElement('div');element.innerHTML=html;
 for(const control of element.querySelectorAll('select,input,button'))expect(control).toHaveAttribute('disabled');
 expect(within(element).queryByRole('button',{name:localUseNotice.fa.apply})).toBeNull();expect(mocks.localUse).not.toHaveBeenCalled();
});
