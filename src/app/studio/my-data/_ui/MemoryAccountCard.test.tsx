/** Independent protective UI: exact route dispatch, never inferred response queues. */
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {MemoryAccountCard} from './MemoryAccountCard';
const API='/api/studio/memory-account',SIGNED='ER1_SYNTHETIC_MANAGER_SESSION';
const preview={version:1,action:'fresh-bootstrap',scope:'original-file-canonical-memory-account',agents:'all-canonical-agent-rows',spaces:['work','personal'],expected:{kind:'missing'},previewDigest:'a'.repeat(64)};
const fresh={state:'fresh-confirmed',ready:false,reason:'source-time-and-core-eligibility-not-qualified'};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}});
let calls:Array<{url:string;init:RequestInit}>,bridge:{initData:string},dispatch:(url:string,init:RequestInit)=>Promise<Response>;
beforeEach(()=>{calls=[];bridge={initData:SIGNED};(window as unknown as {Telegram:unknown}).Telegram={WebApp:bridge};
 dispatch=async(url)=>url===API?json({state:'setup-required',ready:false}):url===API+'/preview'?json(preview):url===API+'/challenge'?json({nonce:'b'.repeat(64),expiresAt:Date.now()+120000,preview}):url===API+'/confirm'?json(fresh):url===API+'/cancel'?json({cancelled:true}):Promise.reject(Error('unexpected route'));
 vi.stubGlobal('fetch',async(url:string,init:RequestInit)=>{calls.push({url,init});return dispatch(url,init);});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();delete(window as {Telegram?:unknown}).Telegram;});
async function begin(){fireEvent.click(await screen.findByRole('button',{name:'Set up a fresh conversation'}));await screen.findByRole('button',{name:'Start fresh'});}
describe('ER1 separate fresh-memory setup card',()=>{
 it('stays hidden on unavailable initial status and sends no mutation',async()=>{
  dispatch=async()=>json({error:'unavailable'},503);const {container}=render(<MemoryAccountCard signed={SIGNED} lang="en"/>);await waitFor(()=>expect(calls).toHaveLength(1));await act(async()=>{});expect(container).toBeEmptyDOMElement();expect(calls.every(x=>x.init.method==='GET')).toBe(true);
 });
 it('two explicit actions carry authenticated closed DTO and never erase/enroll/connect',async()=>{
  render(<MemoryAccountCard signed={SIGNED} lang="en"/>);await begin();
  expect(screen.getByText(/does not erase chats or other saved data/)).toBeInTheDocument();expect(screen.getByText(/does not turn them on/)).toBeInTheDocument();
  expect(calls.map(x=>x.url)).toEqual([API,API+'/preview',API+'/challenge']);fireEvent.click(screen.getByRole('button',{name:'Start fresh'}));await screen.findByText('Fresh start confirmed.');
  expect(screen.getByText(/does not enable replies/)).toBeInTheDocument();expect(calls.map(x=>x.url)).toEqual([API,API+'/preview',API+'/challenge',API+'/confirm']);
  expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({action:'fresh-bootstrap',previewDigest:preview.previewDigest,nonce:'b'.repeat(64)});
  for(const c of calls){expect(c.init.cache).toBe('no-store');expect(c.init.credentials).toBe('same-origin');expect((c.init.headers as Record<string,string>)['X-Telegram-Init-Data']).toBe(SIGNED);}
 });
 it('lost confirm response never retries; separate status read reconciles success',async()=>{
  let committed=false;const prior=dispatch;dispatch=async(url,init)=>{if(url===API+'/confirm'){committed=true;throw Error('QA_LOST_RESPONSE');}return committed&&url===API?json(fresh):prior(url,init);};
  render(<MemoryAccountCard signed={SIGNED} lang="en"/>);await begin();fireEvent.click(screen.getByRole('button',{name:'Start fresh'}));await screen.findByRole('alert');expect(calls.filter(x=>x.url===API+'/confirm')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Check current status'}));await screen.findByText('Fresh start confirmed.');expect(calls.filter(x=>x.url===API+'/confirm')).toHaveLength(1);
 });
 it('cancel discards nonce and only cancels then reads current status',async()=>{
  render(<MemoryAccountCard signed={SIGNED} lang="en"/>);await begin();fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await screen.findByRole('button',{name:'Set up a fresh conversation'});
  expect(calls.map(x=>x.url)).toEqual([API,API+'/preview',API+'/challenge',API+'/cancel',API]);expect(calls.filter(x=>x.url===API+'/confirm')).toEqual([]);
 });
 it.each(['legacy-current','erasing'] as const)('%s account never offers destructive replacement',async state=>{
  dispatch=async()=>json({state,ready:false});render(<MemoryAccountCard signed={SIGNED} lang="en"/>);await screen.findByRole('region',{name:'Saved memory'});expect(screen.queryByRole('button')).not.toBeInTheDocument();expect(calls).toHaveLength(1);
 });
 it('session change clears confirmation without posting old nonce',async()=>{
  render(<MemoryAccountCard signed={SIGNED} lang="en"/>);await begin();bridge.initData='ER1_ROTATED_SESSION';fireEvent.click(screen.getByRole('button',{name:'Start fresh'}));await screen.findByText('Open My data again from Vox to continue.');expect(calls.filter(x=>x.url===API+'/confirm')).toEqual([]);
 });
 it('malformed preview cannot progress to a challenge',async()=>{
  const prior=dispatch;dispatch=async(url,init)=>url===API+'/preview'?json({...preview,payload:'QA_CANARY'}):prior(url,init);render(<MemoryAccountCard signed={SIGNED} lang="en"/>);fireEvent.click(await screen.findByRole('button',{name:'Set up a fresh conversation'}));await screen.findByRole('alert');expect(calls.map(x=>x.url)).toEqual([API,API+'/preview']);
 });
 it('expired confirmation drops nonce and requires a new explicit setup',async()=>{
  const prior=dispatch;dispatch=async(url,init)=>url===API+'/challenge'?json({nonce:'b'.repeat(64),expiresAt:Date.now()-1,preview}):prior(url,init);render(<MemoryAccountCard signed={SIGNED} lang="en"/>);fireEvent.click(await screen.findByRole('button',{name:'Set up a fresh conversation'}));await screen.findByText('This confirmation expired. Start again when you are ready.');expect(screen.queryByRole('button',{name:'Start fresh'})).not.toBeInTheDocument();expect(calls.filter(x=>x.url===API+'/confirm')).toEqual([]);
 });
 it('Persian scope and confirmation retain the same private closed DTO',async()=>{
  render(<MemoryAccountCard signed={SIGNED} lang="fa"/>);fireEvent.click(await screen.findByRole('button',{name:'راه‌اندازی گفتگوی تازه'}));await screen.findByRole('button',{name:'شروع تازه'});expect(screen.getByText(/گفتگوها و دیگر داده‌های ذخیره‌شده پاک نمی‌شوند/)).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'شروع تازه'}));await screen.findByText('شروع تازه تأیید شد.');expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({action:'fresh-bootstrap',previewDigest:preview.previewDigest,nonce:'b'.repeat(64)});
 });
});
