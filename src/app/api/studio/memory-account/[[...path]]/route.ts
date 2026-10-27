import {getStudio} from '@/lib/studio/runtime';
import {handleMemoryAccountRequest} from '@/lib/studio/memory-account-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{return await handleMemoryAccountRequest(await getStudio(),request,(await params).path??[],()=>process.env.VOXX_BOT_TOKEN??'');}
  catch{return Response.json({error:'memory_account_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
export const GET=handle;
export const POST=handle;
