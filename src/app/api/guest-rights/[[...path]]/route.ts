import { guestRightsRuntime } from '@/lib/studio/guest-rights-runtime';
import { handleGuestRightsRequest } from '@/lib/studio/guest-rights-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function handle(request:Request,{params}:{params:Promise<{path?:string[]}>}){
  try{return await handleGuestRightsRequest(guestRightsRuntime(),request,(await params).path??[],process.env.VOXX_BOT_TOKEN??'',process.env.STUDIO_WEBAPP_URL);}
  catch{return Response.json({error:'guest_unavailable'},{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
}
export const GET=handle;
export const POST=handle;
