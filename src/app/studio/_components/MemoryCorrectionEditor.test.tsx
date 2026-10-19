import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryCorrectionEditor } from './MemoryCorrectionEditor';
import type { AdaptiveSnapshot } from '../_lib/adaptive-client';
const mocks = vi.hoisted(() => ({ correct: vi.fn() }));
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
it.each(['space','locale','binding','confirmed','unsupported','revision','unmount','cancel','expiry'] as const)('aborts pending Save on %s and ignores an adapter that resolves late', async change=>{
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
