// Dedicated LINE Official Account webhook for YiYi wholesale new-product announcements.
// Deliberately isolated from the existing LINE order-import bot.
// LINE Developers webhook endpoint: https://qibeuakrryqjaiwbcorg.supabase.co/functions/v1/catalog-line-webhook
// Env: LINE_CATALOG_CHANNEL_SECRET, LINE_CATALOG_CHANNEL_ACCESS_TOKEN.
// All group IDs are taken from LINE-signed events, never from client-provided payloads.
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const encoder=new TextEncoder();
function json(data:unknown,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store'
  }});
}
async function validSignature(body:string,signature:string,secret:string){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(body)));
  const expected=btoa(String.fromCharCode(...digest));
  if(expected.length!==signature.length)return false;
  let diff=0;
  for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^signature.charCodeAt(i);
  return diff===0;
}
async function table(path:string,options:RequestInit={}):Promise<any>{
  const headers:Record<string,string>={
    apikey:SERVICE,authorization:'Bearer '+SERVICE,
    'content-type':'application/json',...((options.headers||{}) as Record<string,string>)
  };
  const res=await fetch(BASE+'/rest/v1/'+path,{...options,headers});
  const raw=await res.text();
  if(!res.ok)throw new Error('Database request failed HTTP '+res.status+': '+raw.slice(0,240));
  return raw?JSON.parse(raw):null;
}
function enc(x:string){return encodeURIComponent(x);}
async function groupName(id:string,token:string){
  try{
    const resp=await fetch('https://api.line.me/v2/bot/group/'+enc(id)+'/summary',{
      headers:{authorization:'Bearer '+token}
    });
    if(resp.ok){
      const data=await resp.json();
      const name=String(data?.groupName||'').trim();
      if(name)return name.slice(0,120);
    }
  }catch(err){console.warn('LINE group name unavailable',String(err));}
  return 'LINE 群組 '+id.slice(-6);
}
async function onGroup(event:any,token:string){
  if(event?.source?.type!=='group')return false;
  const id=String(event?.source?.groupId||'');
  if(!/^C[0-9a-fA-F]{32}$/.test(id))return false;
  const now=new Date().toISOString();
  const query='catalog_line_groups?line_group_id=eq.'+enc(id);
  if(event.type==='leave'){
    await table(query,{method:'PATCH',headers:{Prefer:'return=minimal'},
      body:JSON.stringify({connected:false,active:false,updated_at:now,last_seen_at:now})});
    return true;
  }
  if(event.type!=='join'&&event.type!=='message')return false;
  const current=await table(query+'&select=id,group_name,connected,active&limit=1');
  if(Array.isArray(current)&&current.length){
    const update:Record<string,unknown>={connected:true,last_seen_at:now,updated_at:now};
    if(event.type==='join')update.group_name=await groupName(id,token);
    // Preserve opt-in: an existing disabled group must never be auto-enabled.
    await table(query,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(update)});
  }else{
    const name=event.type==='join'?await groupName(id,token):'LINE 群組 '+id.slice(-6);
    await table('catalog_line_groups',{
      method:'POST',headers:{Prefer:'return=minimal'},
      body:JSON.stringify({line_group_id:id,group_name:name,
        connected:true,active:false,joined_at:now,last_seen_at:now,updated_at:now})
    });
  }
  return true;
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  const secret=Deno.env.get('LINE_CATALOG_CHANNEL_SECRET')||'';
  const token=Deno.env.get('LINE_CATALOG_CHANNEL_ACCESS_TOKEN')||'';
  if(!BASE||!SERVICE||!secret||!token)return json({ok:false,error:'catalog_line_channel_not_configured'},503);
  const raw=await req.text();
  if(raw.length>512000)return json({ok:false,error:'payload_too_large'},413);
  const sig=req.headers.get('x-line-signature')||'';
  if(!sig||!(await validSignature(raw,sig,secret)))return json({ok:false,error:'invalid_line_signature'},401);
  let payload:any;
  try{payload=JSON.parse(raw)}catch{return json({ok:false,error:'invalid_json'},400)}
  const events=Array.isArray(payload?.events)?payload.events:[];
  if(events.length>50)return json({ok:false,error:'too_many_events'},413);
  let handled=0;
  try{
    for(const event of events)if(await onGroup(event,token))handled++;
    return json({ok:true,accepted:true,group_events:handled});
  }catch(err){
    console.error('Catalog LINE webhook error',String(err));
    return json({ok:false,error:'group_registration_failed'},503);
  }
});
