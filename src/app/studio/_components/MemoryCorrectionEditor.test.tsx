import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MEMORY_CORRECTION_SAVE_TIMEOUT_MS, MemoryCorrectionEditor } from './MemoryCorrectionEditor';
import type { AdaptiveSnapshot } from '../_lib/adaptive-client';
const mocks = vi.hoisted(() => ({ correct: vi.fn(), authority: vi.fn(), report: vi.fn() }));
vi.mock('../_lib/learning-client', () => ({ learningApi: { correctionAuthority: mocks.authority, correction: mocks.report } }));
vi.mock('../_lib/adaptive-client', () => ({ adaptiveApi: mocks }));
const future = Date.now() + 86400_000;
const note = { id: 'note', text: 'Original claim', revision: 1, createdAt: 1, expiresAt: future, origin: 'user_reviewed_claim' as const };
const snapshot = { schemaVersion:1,revision:2,space:'work',scope:'private_account_profile',identity:{ accountId:'synthetic',personId:'synthetic',bindingId:'binding',bindingExpiresAt:future,confirmed:true,verification:'account_confirmation' },purposes:[],memories:[note],agents:[],explicitMemoryAvailable:true,memoryCorrectionAvailable:true } as AdaptiveSnapshot;
const props = () => ({ note, snapshot, locale:'en' as 'en'|'fa',disabled:false,onSaved:vi.fn(),onRefresh:vi.fn() });
beforeEach(() => { vi.resetAllMocks(); }); afterEach(() => { cleanup(); vi.useRealTimers(); });
function review(fa=false) { fireEvent.click(screen.getByRole('button',{name:fa?'ویرایش یادداشت':'Edit note'})); fireEvent.change(screen.getByRole('textbox'),{target:{value:'  Corrected explicit claim  '}}); fireEvent.click(screen.getByRole('button',{name:fa?'بررسی اصلاح':'Review correction'})); }
it.each(['en','fa'] as const)('requires exact review then one explicit Save in %s, without optimistic replacement', async locale => {
  const p=props(); p.locale=locale; let release!:(v:AdaptiveSnapshot)=>void; mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));
  render(<MemoryCorrectionEditor {...p}/>); review(locale==='fa'); expect(mocks.correct).not.toHaveBeenCalled();
  expect(screen.getByText('Original claim')).toBeVisible(); expect(screen.getByText('Corrected explicit claim')).toBeVisible();
  expect(screen.getByRole('heading',{name:locale==='fa'?'پیش از اصلاح':'Before'})).toHaveFocus();
  const save=screen.getByRole('button',{name:locale==='fa'?'ذخیرهٔ اصلاح':'Save correction'}); fireEvent.click(save); fireEvent.click(save);
  expect(mocks.correct).toHaveBeenCalledTimes(1); expect(mocks.correct).toHaveBeenCalledWith('note',{space:'work',text:'Corrected explicit claim',expectedRevision:1,eventId:expect.any(String)},expect.any(AbortSignal),locale);
  expect(p.onSaved).not.toHaveBeenCalled(); await act(async()=>release({...snapshot,revision:3,memories:[{...note,text:'Corrected explicit claim',revision:2}]}));
  expect(p.onSaved).toHaveBeenCalledOnce();
});
it('cancel discards review, and failed Save asks for refresh without retrying or claiming success', async()=>{
  const p=props(); mocks.correct.mockRejectedValue(new Error('RAW_INTERNAL_ERROR')); render(<MemoryCorrectionEditor {...p}/>); review();
  fireEvent.click(screen.getByRole('button',{name:'Cancel'})); expect(mocks.correct).not.toHaveBeenCalled(); review(); fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
  await screen.findByRole('alert'); expect(screen.queryByText('RAW_INTERNAL_ERROR')).not.toBeInTheDocument(); expect(p.onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Save correction'})).toBeDisabled(); fireEvent.click(screen.getByRole('button',{name:'Refresh notes'})); expect(p.onRefresh).toHaveBeenCalledOnce(); expect(mocks.correct).toHaveBeenCalledOnce();
});
it.each(['space','locale','binding','confirmed','unsupported','revision','unmount','expiry'] as const)('aborts pending Save on %s and ignores an adapter that resolves late', async change=>{
  const p=props(); let release!:(v:AdaptiveSnapshot)=>void; mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));
  const view=render(<MemoryCorrectionEditor {...p}/>); review(); fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
  const signal=mocks.correct.mock.calls[0][2] as AbortSignal;
  if(change==='space') view.rerender(<MemoryCorrectionEditor {...p} snapshot={{...snapshot,space:'personal'}}/>);
  if(change==='locale') view.rerender(<MemoryCorrectionEditor {...p} locale="fa"/>);
  if(change==='binding') view.rerender(<MemoryCorrectionEditor {...p} snapshot={{...snapshot,identity:{...snapshot.identity,confirmed:false,bindingId:undefined}}}/>);
  if(change==='confirmed') view.rerender(<MemoryCorrectionEditor {...p} snapshot={{...snapshot,identity:{...snapshot.identity,confirmed:false}}}/>);
  if(change==='unsupported') view.rerender(<MemoryCorrectionEditor {...p} snapshot={{...snapshot,memoryCorrectionAvailable:false}}/>);
  if(change==='revision') view.rerender(<MemoryCorrectionEditor {...p} note={{...note,revision:2,text:'Newer note'}}/>);
  if(change==='unmount') view.unmount(); if(change==='cancel') fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  if(change==='expiry') { vi.useFakeTimers(); view.rerender(<MemoryCorrectionEditor {...p} note={{...note,expiresAt:Date.now()+5}}/>); await act(async()=>{ await vi.advanceTimersByTimeAsync(6); }); vi.useRealTimers(); }
  expect(signal.aborted).toBe(true); await act(async()=>release({...snapshot,memories:[{...note,text:'STALE_RESPONSE_CANARY'}]}));
  expect(p.onSaved).not.toHaveBeenCalled(); expect(screen.queryByText('STALE_RESPONSE_CANARY')).not.toBeInTheDocument();
});
it('hides editing for derived, unsupported or unconfirmed rows',()=>{
  const p=props(),view=render(<MemoryCorrectionEditor {...p} note={{...note,sourceRefs:[{id:'source',revision:1}]}}/>); expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<MemoryCorrectionEditor {...p} snapshot={{...snapshot,memoryCorrectionAvailable:false}}/>); expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<MemoryCorrectionEditor {...p} snapshot={{...snapshot,identity:{...snapshot.identity,confirmed:false}}}/>); expect(screen.queryByRole('button')).toBeNull();
});

it.each(['en','fa'] as const)('keeps dispatched %s Save visible, disables Cancel, owns one event, and releases after confirmation', async locale=>{
  const p={...props(),locale,onPendingChange:vi.fn(()=>true),onUnconfirmed:vi.fn()}; let release!:(v:AdaptiveSnapshot)=>void;
  mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));render(<MemoryCorrectionEditor {...p}/>);review(locale==='fa');
  fireEvent.click(screen.getByRole('button',{name:locale==='fa'?'ذخیرهٔ اصلاح':'Save correction'}));
  const first=mocks.correct.mock.calls[0],signal=first[2] as AbortSignal,token=first[1].eventId;
  expect(screen.getByRole('status')).toHaveAttribute('aria-live','polite');
  expect(screen.getByText(locale==='fa'?'در حال ذخیره در فضای کاری…':'Saving in Work…')).toBeVisible();
  const cancel=screen.getByRole('button',{name:locale==='fa'?'انصراف':'Cancel'});expect(cancel).toBeDisabled();fireEvent.click(cancel);
  expect(signal.aborted).toBe(false);expect(mocks.correct).toHaveBeenCalledOnce();expect(p.onPendingChange).toHaveBeenCalledExactlyOnceWith(token,true);
  const result={...snapshot,revision:3};await act(async()=>release(result));expect(p.onSaved).toHaveBeenCalledExactlyOnceWith(result);
  expect(p.onPendingChange).toHaveBeenLastCalledWith(token,false);expect(p.onUnconfirmed).not.toHaveBeenCalled();
});
it('bounds an abort-ignoring Save, reports scoped unknown, and ignores its late success without retry',async()=>{
  vi.useFakeTimers();const p={...props(),onPendingChange:vi.fn(()=>true),onUnconfirmed:vi.fn()};let release!:(v:AdaptiveSnapshot)=>void;
  mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));render(<MemoryCorrectionEditor {...p}/>);review();fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
  const token=mocks.correct.mock.calls[0][1].eventId,signal=mocks.correct.mock.calls[0][2] as AbortSignal;
  await act(async()=>{await vi.advanceTimersByTimeAsync(MEMORY_CORRECTION_SAVE_TIMEOUT_MS);});
  expect(signal.aborted).toBe(true);expect(screen.getByRole('alert')).toHaveTextContent('may have been saved in Work');
  expect(p.onPendingChange).toHaveBeenLastCalledWith(token,false);expect(p.onUnconfirmed).toHaveBeenCalledExactlyOnceWith('work');
  expect(screen.getByRole('button',{name:'Save correction'})).toBeDisabled();expect(mocks.correct).toHaveBeenCalledOnce();
  await act(async()=>release({...snapshot,revision:3}));expect(p.onSaved).not.toHaveBeenCalled();expect(p.onPendingChange).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button',{name:'Refresh notes'}));expect(p.onRefresh).toHaveBeenCalledOnce();
});
it('old forced-unmount completion cannot release a later command owner',async()=>{
  const p={...props(),onPendingChange:vi.fn(()=>true),onUnconfirmed:vi.fn()};let release!:(v:AdaptiveSnapshot)=>void;
  mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));const view=render(<MemoryCorrectionEditor {...p}/>);review();fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
  view.unmount();expect(p.onUnconfirmed).toHaveBeenCalledExactlyOnceWith('work');expect(p.onPendingChange).toHaveBeenCalledTimes(2);
  await act(async()=>release(snapshot));expect(p.onPendingChange).toHaveBeenCalledTimes(2);expect(p.onSaved).not.toHaveBeenCalled();
});
it.each(['Cancel','Back to edit'])('guards same-batch Save then %s before the pending render',async action=>{
  let release!:(v:AdaptiveSnapshot)=>void;mocks.correct.mockImplementation(()=>new Promise(r=>{release=r;}));const p=props();render(<MemoryCorrectionEditor {...p}/>);review();
  const save=screen.getByRole('button',{name:'Save correction'}),competing=screen.getByRole('button',{name:action});
  act(()=>{fireEvent.click(save);fireEvent.click(competing);});
  expect(mocks.correct).toHaveBeenCalledOnce();expect((mocks.correct.mock.calls[0][2] as AbortSignal).aborted).toBe(false);expect(screen.getByText('Saving in Work…')).toBeVisible();
  await act(async()=>release(snapshot));expect(p.onSaved).toHaveBeenCalledOnce();
});
it.each(['note','binding','capability'] as const)('clears sensitive pending review and releases navigation on actual %s clock expiry',async expiry=>{
  vi.useFakeTimers();const deadline=Date.now()+5000,p={...props(),onPendingChange:vi.fn(()=>true),onUnconfirmed:vi.fn()};
  const expiredNote=expiry==='note'?{...note,expiresAt:deadline}:note;
  const authority={...snapshot,identity:{...snapshot.identity,...(expiry==='binding'?{bindingExpiresAt:deadline}:{})},...(expiry==='capability'?{explicitMemoryValidUntil:deadline}:{})};
  mocks.correct.mockImplementation(()=>new Promise(()=>undefined));render(<MemoryCorrectionEditor {...p} note={expiredNote} snapshot={authority}/>);review();fireEvent.click(screen.getByRole('button',{name:'Save correction'}));
  const token=mocks.correct.mock.calls[0][1].eventId;await act(async()=>{await vi.advanceTimersByTimeAsync(5001);});
  expect((mocks.correct.mock.calls[0][2] as AbortSignal).aborted).toBe(true);expect(screen.queryByText('Corrected explicit claim')).not.toBeInTheDocument();expect(screen.queryByRole('region',{name:'Correct private note'})).not.toBeInTheDocument();
  expect(p.onPendingChange).toHaveBeenLastCalledWith(token,false);expect(p.onUnconfirmed).toHaveBeenCalledExactlyOnceWith('work');expect(p.onSaved).not.toHaveBeenCalled();
});

it.each(['saved', 'unconfirmed'] as const)('reports only fixed unverified correction %s metadata without delaying Save', async outcome => {
  const p = props(); p.snapshot = { ...snapshot, purposes: [{ purpose: 'optional.product_analytics', state: 'granted', available: true, revision: 1, notice: {} }] } as AdaptiveSnapshot;
  mocks.authority.mockResolvedValue({ policyReceipt: 'a'.repeat(64) }); mocks.report.mockResolvedValue({ recorded: true });
  if (outcome === 'saved') mocks.correct.mockResolvedValue({ ...snapshot, revision: 3 }); else mocks.correct.mockRejectedValue(new Error('PRIVATE_FAILURE_CANARY'));
  render(<MemoryCorrectionEditor {...p} />); review(); fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  await act(async () => { await Promise.resolve(); });
  const command = mocks.correct.mock.calls[0][1];
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith({ version: 1, eventId: command.eventId, space: 'work', policyReceipt: 'a'.repeat(64), outcome: outcome === 'saved' ? 'correction_client_saved' : 'correction_client_unconfirmed' });
  expect(JSON.stringify(mocks.report.mock.calls)).not.toMatch(/Original claim|Corrected explicit|PRIVATE_FAILURE|note/);
});
it('never waits for diagnostics and drops a delayed receipt after unmount', async () => {
  const p = props(); p.snapshot = { ...snapshot, purposes: [{ purpose: 'optional.product_analytics', state: 'granted', available: true, revision: 1, notice: {} }] } as AdaptiveSnapshot;
  let release!: (value: { policyReceipt: string }) => void; mocks.authority.mockReturnValue(new Promise(resolve => { release = resolve; }));
  mocks.correct.mockResolvedValue({ ...snapshot, revision: 3 });
  const view = render(<MemoryCorrectionEditor {...p} />); review(); fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
  await act(async () => { await Promise.resolve(); }); expect(p.onSaved).toHaveBeenCalledOnce();
  view.unmount(); await act(async () => release({ policyReceipt: 'a'.repeat(64) })); expect(mocks.report).not.toHaveBeenCalled();
});
