/** Fresh manager-only ER1 protective API. Never ensureMember or caller-selected account/path. */
import {z} from 'zod';
import {botIdOfToken,verifyBotInitData,type InitDataUser} from './auth';
import {boundedStudioRequest} from './http';
import {trustedStudioRequestOrigin} from './request-origin';
import {StudioRateLimiter,StudioRateLimitError} from './ratelimit';
import type {Studio} from './service';
import type {MemoryAccountSession} from './memory-account';
const small=4096,maxInit=16384,hex=z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const schemas={preview:z.object({}).strict(),challenge:z.object({action:z.literal('fresh-bootstrap'),previewDigest:hex}).strict(),confirm:z.object({action:z.literal('fresh-bootstrap'),previewDigest:hex,nonce:hex}).strict(),cancel:z.object({}).strict()};
const limiters=new WeakMap<Studio,StudioRateLimiter>();
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
/** Dedicated wrapper leaves every unrelated manager/client default unchanged. */
export function verifyMemoryAccountInitData(studio:Studio,initData:string,managerToken:string,now:number):InitDataUser|null {
  if(!managerToken||!Number.isSafeInteger(now)||now<0)return null;
  const authDate=Number(new URLSearchParams(initData).get('auth_date'));
  if(!Number.isSafeInteger(authDate)||authDate*1000>now+2000||now>=authDate*1000+300_000)return null;
  return verifyBotInitData(initData,{token:managerToken,botId:botIdOfToken(managerToken)},{key:studio.deps.initDataKey,requireSignature:true,maxAgeSeconds:300,nowSeconds:Math.floor(now/1000)}).user;
}
export async function handleMemoryAccountRequest(studio:Studio,request:Request,path:string[],managerToken:string|(()=>string)):Promise<Response> {
  try {
    const route=request.method==='GET'&&path.length===0?'status':request.method==='POST'&&path.length===1&&Object.hasOwn(schemas,path[0])?path[0] as keyof typeof schemas:undefined;
    if(!route)return json({error:'not_found'},404);
    if(new URL(request.url).search)return json({error:'invalid_request'},400);
    let limiter=studio.deps.rateLimiter??limiters.get(studio);if(!limiter){const local=new StudioRateLimiter();limiters.set(studio,local);limiter=local;}
    await limiter.consume('ingress','memory-account');
    const account=studio.deps.memoryAccount;if(!account)return json({error:'memory_account_unavailable'},503);
    const currentToken=()=>typeof managerToken==='function'?managerToken():managerToken;
    const initData=request.headers.get('x-telegram-init-data')??'';
    if(!initData||initData.length>maxInit||!currentToken())return json({error:'authentication_required'},401);
    const now=account.now(),user=verifyMemoryAccountInitData(studio,initData,currentToken(),now);
    if(!user)return json({error:'authentication_required'},401);
    await limiter.consume('api',user.id);
    if(request.method!=='GET'){
      const origin=trustedStudioRequestOrigin(request.url,studio.deps.webAppUrl);
      if(!origin)return json({error:'memory_account_unavailable'},503);
      if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'origin_denied'},403);
      if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'json_required'},415);
      await limiter.consume('mutation',user.id);
    }
    const session:MemoryAccountSession={ownerId:user.id,session:account.session(initData),deadline:Number(new URLSearchParams(initData).get('auth_date'))*1000+300_000,
      authenticate:(at)=>verifyMemoryAccountInitData(studio,initData,currentToken(),at)?.id===user.id,cancelled:()=>request.signal.aborted};
    if(route==='status')return json(account.status(session));
    let input:unknown;try{input=await (await boundedStudioRequest(request,small)).json();}catch{return json({error:'invalid_request'},400);}
    if(route==='preview'){schemas.preview.parse(input);return json(account.preview(session));}
    if(route==='cancel'){schemas.cancel.parse(input);return json(account.cancel(session));}
    if(route==='challenge'){const body=schemas.challenge.parse(input);return json(account.challenge(session,body.previewDigest));}
    const body=schemas.confirm.parse(input);return json(await account.confirm(session,body.nonce,body.previewDigest));
  }catch(error){
    if(StudioRateLimitError.is(error))return json({error:'rate_limited'},429);
    if(error instanceof z.ZodError)return json({error:'invalid_request'},400);
    return json({error:'memory_account_unavailable'},503);
  }
}
