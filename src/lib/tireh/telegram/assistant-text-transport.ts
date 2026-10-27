/** ATI1's single-attempt transport. Never uses the retrying Telegram client. */
import { types } from 'node:util';
import type { PreparedAssistantText, ResponseProjection, TransportEvidence } from '../delivery/assistant-text-protocol';

export type AssistantTextTransportResult =
  | {kind:'response'; evidence:TransportEvidence; response:ResponseProjection}
  | {kind:'unknown'; reason:'transport_error'|'invalid_response'};
export interface AssistantTextSendInput {
  token:string;
  prepared:PreparedAssistantText;
  authorizeNow:()=>boolean;
  ownerSignal?:AbortSignal;
  ownerActive?:()=>void;
}
const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!;
const RESPONSE_BYTES = 65536;

export class AssistantTextTransport {
  constructor(private readonly fetchFn:typeof fetch = fetch, private readonly now:()=>number = Date.now) {}

  async send(input:AssistantTextSendInput):Promise<AssistantTextTransportResult> {
    // All options/bytes exist before the final callback. Prepared is internal
    // server data; the ARC final fence revalidates its complete HMAC integrity.
    const {prepared,token,authorizeNow}=input, s=prepared.initialState;
    const tokenMatch=/^([1-9]\d*):[A-Za-z0-9_-]{20,}(?![\s\S])/.exec(token);
    if(!tokenMatch||Number(tokenMatch[1])!==s.binding.botId||!types.isUint8Array(prepared.bodyBytes)||types.isProxy(prepared.bodyBytes))return {kind:'unknown',reason:'invalid_response'};
    const length=byteLength.call(prepared.bodyBytes) as number;
    if(length>32768)return {kind:'unknown',reason:'invalid_response'};
    const body=new Uint8Array(length);Uint8Array.prototype.set.call(body,prepared.bodyBytes);
    const url=`https://api.telegram.org/bot${token}/sendMessage`;
    const controller=new AbortController(), start=this.now(), remaining=Math.min(20000,s.expiresAt-start);
    if(!Number.isSafeInteger(start)||remaining<=0)return {kind:'unknown',reason:'transport_error'};
    const ownerAbort=()=>controller.abort();
    if(input.ownerSignal?.aborted)controller.abort();
    else input.ownerSignal?.addEventListener('abort',ownerAbort,{once:true});
    const options:RequestInit={method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'};
    let timeoutReject:()=>void=()=>undefined;
    const timeout=new Promise<never>((_resolve,reject)=>{timeoutReject=()=>reject(new Error('timeout'));});
    const timer=setTimeout(()=>{controller.abort();timeoutReject();},remaining);
    try {
      // No await, payload transformation or callback follows this fence before
      // fetch. The gateway checks its own deadline after the nested ARC reads.
      if(authorizeNow()!==true||controller.signal.aborted||this.now()-start>=remaining)return {kind:'unknown',reason:'transport_error'};
      input.ownerActive?.();
      const response=await Promise.race([this.fetchFn(url,options),timeout]);
      if(controller.signal.aborted||this.now()-start>=remaining)return {kind:'unknown',reason:'transport_error'};
      const reader=response.body?.getReader();
      if(!reader)return {kind:'unknown',reason:'invalid_response'};
      const chunks:Uint8Array[]=[];let total=0;
      try {
        for(;;){
          const chunk=await Promise.race([reader.read(),timeout]);
          if(controller.signal.aborted||this.now()-start>=remaining){controller.abort();return {kind:'unknown',reason:'transport_error'};}
          if(chunk.done)break;
          if(!types.isUint8Array(chunk.value)||total+chunk.value.byteLength>RESPONSE_BYTES){controller.abort();return {kind:'unknown',reason:'invalid_response'};}
          total+=chunk.value.byteLength;chunks.push(chunk.value);
        }
      } finally {
        // Cancellation may itself be non-cooperative; never await it past the
        // hard deadline. Promise.race has handlers on every pending read.
        void reader.cancel().catch(()=>undefined);
        try{reader.releaseLock();}catch{/* Pending uncooperative read. */}
      }
      const bytes=new Uint8Array(total);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let parsed:unknown;
      try {parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
      catch {return {kind:'unknown',reason:'invalid_response'};}
      if(controller.signal.aborted||this.now()-start>=remaining)return {kind:'unknown',reason:'transport_error'};
      return {kind:'response',evidence:{method:'sendMessage',botId:s.binding.botId,credentialBindingId:s.binding.credentialBindingId,
        endpointBindingId:s.binding.endpointBindingId,attemptId:s.attemptId,effectKey:s.effectKey,dispatchedBodyHmac:s.evidence.bodyHmac,observedAt:this.now()},
      response:{httpStatus:response.status,body:parsed}};
    } catch {return {kind:'unknown',reason:'transport_error'};}
    finally {clearTimeout(timer);input.ownerSignal?.removeEventListener('abort',ownerAbort);}
  }
}
