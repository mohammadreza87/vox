import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { PrivacyScreen } from './screens/Privacy';
import { correctionFixture, CORRECTION_NOW } from '@/lib/adaptive/__tests__/memory-correction-fixtures';
import { handleAdaptiveRequest } from '@/lib/adaptive/persistence/http';
import { signInitData } from '@/lib/studio/auth';
import { api } from '../_lib/client';
// The unrelated biometric panel is unavailable in this fixture. Note UI, typed
// client, authentication, HTTP handler and canonical FILE writes are all real.
vi.mock('./VoiceRecognitionPanel', () => ({ VoiceRecognitionPanel: () => null }));
vi.mock('./ProductPausePanel', () => ({ ProductPausePanel: () => null }));
vi.mock('../_lib/product-pause-client', () => ({ useProductPause: () => ({ coveredBlocked: false, status: null }) }));
const nav = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('./StudioApp', () => ({ useNav: () => nav.current }));
/** App-level locale and space, as StudioApp provides them. */
function Hub(props: { onCorrectionPendingChange?: (token: string, pending: boolean) => boolean }) {
  const [locale, setLocale] = useState<'en' | 'fa'>('en'), [space, setSpace] = useState<'work' | 'personal'>('work');
  nav.current = { locale, dir: locale === 'fa' ? 'rtl' : 'ltr', setLocale, space, setSpace, snack: vi.fn(), toast: vi.fn(), push: vi.fn(), back: vi.fn(), tier: 'full',
    me: { org: 'HOOR', member: { telegramId: 123, name: 'Synthetic', role: 'member' } } };
  return <PrivacyScreen {...props} />;
}
const openNote = async () => { fireEvent.click(screen.getAllByRole('button').find(b => b.closest('.vx-you-note'))!); return screen.findByRole('article'); };
const fixtures: Awaited<ReturnType<typeof correctionFixture>>[]=[];
type ResponseLedger = Array<{ key: string; response: Promise<Response> }>;
async function completed(responses: ResponseLedger, key: string, status: number) {
  const matching = responses.filter(entry => entry.key === key);
  expect(matching).toHaveLength(1);
  await act(async () => { expect((await matching[0].response).status).toBe(status); });
}
afterEach(async()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();Reflect.deleteProperty(window,'Telegram');await Promise.all(fixtures.splice(0).map(f=>f.close()));});
it.each(['en','fa'] as const)('connects %s Create/Edit/Review/Save to real signed HTTP and FILE rows, retaining claim labels',async locale=>{
  const f=await correctionFixture(); fixtures.push(f); vi.spyOn(Date,'now').mockReturnValue(CORRECTION_NOW);
  await f.service.withAccountDocument(123,d=>{d.memories[0].origin='user_reviewed_claim';});
  const token='123:synthetic-correction'; (window as unknown as {Telegram:unknown}).Telegram={WebApp:{initData:signInitData({id:123,first_name:'Synthetic'},token)}};
  vi.spyOn(api,'agents').mockResolvedValue({agents:[]} as Awaited<ReturnType<typeof api.agents>>);
  const requests:Array<{method:string;path:string;body:unknown}>=[];
  const responses: ResponseLedger = [];
  vi.stubGlobal('fetch',(url:string,init:RequestInit)=>{
    const target=new URL(url,'https://vox.synthetic'),headers=new Headers(init.headers);headers.set('origin',target.origin);
    requests.push({method:init.method!,path:target.pathname,body:init.body?JSON.parse(String(init.body)):null});
    const response = handleAdaptiveRequest(f.studio,f.service,new Request(target,{...init,headers}),target.pathname.replace('/api/studio/adaptive','').split('/').filter(Boolean),token);
    responses.push({ key: `${init.method} ${target.pathname}${target.search}`, response });
    return response;
  });
  render(<Hub/>); await completed(responses, 'GET /api/studio/adaptive?space=work&locale=en', 200);
  if(locale==='fa') {
    fireEvent.click(screen.getByRole('button',{name:/^Language/}));fireEvent.click(await screen.findByRole('radio',{name:'فارسی'}));
    await completed(responses, 'GET /api/studio/adaptive?space=work&locale=fa', 200);
  }
  await openNote(); expect(screen.getByRole('button',{name:locale==='fa'?'ویرایش یادداشت':'Edit note'})).toBeInTheDocument();
  const fa=locale==='fa',claim=fa?'ادعای بررسی‌شدهٔ شما؛ به‌طور مستقل تأیید نشده است.':'User-reviewed claim; not independently verified.';
  expect(screen.getByText(claim)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:fa?'ویرایش یادداشت':'Edit note'}));
  fireEvent.change(screen.getByRole('textbox',{name:fa?'یادداشت اصلاح‌شده':'Corrected note'}),{target:{value:'Corrected private claim'}});
  fireEvent.click(screen.getByRole('button',{name:fa?'بررسی اصلاح':'Review correction'}));
  expect(requests.filter(r=>r.method==='PUT')).toHaveLength(0);
  // Await the real mutation, including FILE fsync/rename, before asserting its UI outcome.
  // A generic DOM polling deadline is not a completion barrier for filesystem I/O.
  fireEvent.click(screen.getByRole('button',{name:fa?'ذخیرهٔ اصلاح':'Save correction'}));
  await completed(responses, `PUT /api/studio/adaptive/memories/${f.note.id}?locale=${locale}`, 200);
  expect(screen.queryByRole('button',{name:fa?'ذخیرهٔ اصلاح':'Save correction'})).not.toBeInTheDocument();
  expect(screen.getByText(claim)).toBeInTheDocument();
  const row=(await f.service.read(123,'work')).memories[0]; expect(row).toMatchObject({id:f.note.id,text:'Corrected private claim',revision:2,origin:'user_reviewed_claim',expiresAt:f.note.expiresAt,createdAt:f.note.createdAt});
  expect(requests.filter(r=>r.method==='PUT')).toEqual([{method:'PUT',path:`/api/studio/adaptive/memories/${f.note.id}`,body:{space:'work',text:'Corrected private claim',expectedRevision:1,eventId:expect.any(String)}}]);
  const label=fa?'وکس چه چیزی را به خاطر بسپارد؟':'What should Vox remember?';
  // Use the existing Create form independently of the correction review.
  const createArea=screen.getByRole('textbox',{name:label});
  expect(createArea).toBeDefined(); fireEvent.change(createArea,{target:{value:'A new ordinary note'}});
  const saveButton=screen.getByRole('button',{name:fa?'ذخیرهٔ حافظهٔ خصوصی':'Save private memory'});
  expect(saveButton,label).toBeDefined();
  fireEvent.click(saveButton!);
  await completed(responses, 'POST /api/studio/adaptive/memories', 201);
  expect((await f.service.read(123,'work')).memories).toHaveLength(2);
  fireEvent.click(screen.getByRole('tab',{name:fa?'شخصی':'Personal',exact:true}));
  await completed(responses, `GET /api/studio/adaptive?space=personal&locale=${locale}`, 200);
  expect(screen.queryByText('Corrected private claim')).not.toBeInTheDocument();
  expect((await f.service.read(123,'personal')).memories).toEqual([]);
  const doc=await f.service.withAccountDocument(123,d=>d);expect(doc.permissions.every(p=>p.state!=='granted')).toBe(true);
});
it('keeps a real signed FILE-queued Save scoped and visible until its authoritative response',async()=>{
  const {mkdir,readFile,rmdir}=await import('node:fs/promises'),{join}=await import('node:path'),{accountIdFor}=await import('@/lib/adaptive/persistence/repository'),{createHash}=await import('node:crypto');
  const f=await correctionFixture();fixtures.push(f);vi.spyOn(Date,'now').mockReturnValue(CORRECTION_NOW);
  const token='123:synthetic-correction';(window as unknown as {Telegram:unknown}).Telegram={WebApp:{initData:signInitData({id:123,first_name:'Synthetic'},token)}};
  vi.spyOn(api,'agents').mockResolvedValue({agents:[]} as Awaited<ReturnType<typeof api.agents>>);
  const puts:Array<{signal:AbortSignal|undefined;body:unknown}>=[];
  const responses: ResponseLedger = [];
  vi.stubGlobal('fetch',(url:string,init:RequestInit)=>{
    const target=new URL(url,'https://vox.synthetic'),headers=new Headers(init.headers);headers.set('origin',target.origin);
    if(init.method==='PUT')puts.push({signal:init.signal as AbortSignal,body:JSON.parse(String(init.body))});
    const response = handleAdaptiveRequest(f.studio,f.service,new Request(target,{...init,headers}),target.pathname.replace('/api/studio/adaptive','').split('/').filter(Boolean),token);
    responses.push({ key: `${init.method} ${target.pathname}${target.search}`, response });
    return response;
  });
  const pending=vi.fn(()=>true);render(<Hub onCorrectionPendingChange={pending}/>);
  await completed(responses, 'GET /api/studio/adaptive?space=work&locale=en', 200);
  await openNote(); fireEvent.click(screen.getByRole('button',{name:'Edit note'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Corrected note'}),{target:{value:'Scoped FILE correction'}});fireEvent.click(screen.getByRole('button',{name:'Review correction'}));
  const file=join(f.directory,'adaptive',`${createHash('sha256').update(accountIdFor(123)).digest('hex')}.json`),lock=`${file}.lock`;await mkdir(lock);let held=true;
  try{
    fireEvent.click(screen.getByRole('button',{name:'Save correction'}));expect(puts).toHaveLength(1);
    expect(screen.getByText('Saving in Work…')).toBeVisible();expect(screen.getByRole('tab',{name:'Personal',exact:true})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancel',exact:true})).toBeDisabled();
    fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));fireEvent.click(screen.getByRole('tab',{name:'Personal',exact:true}));
    expect(puts[0].signal?.aborted).toBe(false);expect(JSON.parse(await readFile(file,'utf8')).memories[0].text).toBe(f.note.text);
    await rmdir(lock); held=false;
    await completed(responses, `PUT /api/studio/adaptive/memories/${f.note.id}?locale=en`, 200);
    expect(within(screen.getByRole('article')).getByText('Scoped FILE correction')).toBeVisible();expect(pending).toHaveBeenLastCalledWith(expect.any(String),false);
    const saved=JSON.parse(await readFile(file,'utf8')).memories[0];expect(saved).toMatchObject({id:f.note.id,text:'Scoped FILE correction',revision:2,expiresAt:f.note.expiresAt,createdAt:f.note.createdAt});expect(puts).toHaveLength(1);expect(puts[0].signal?.aborted).toBe(false);
    expect(screen.getByRole('tab',{name:'Personal',exact:true})).toBeEnabled();fireEvent.click(screen.getByRole('tab',{name:'Personal',exact:true}));
    await completed(responses, 'GET /api/studio/adaptive?space=personal&locale=en', 200);
    expect(screen.queryByText('Scoped FILE correction')).not.toBeInTheDocument();expect((await f.service.read(123,'personal')).memories).toEqual([]);
  }finally{if(held)await rmdir(lock);}
});
