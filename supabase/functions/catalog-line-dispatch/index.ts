// Private cron runner for wholesale catalog LINE DM announcements.
// Authentication: Vault-generated X-Cron-Key verified by service-role-only SQL RPC.
// Never expose SUPABASE_SERVICE_ROLE_KEY or LINE_CHANNEL_ACCESS_TOKEN to browsers.
const BASE=Deno.env.get('SUPABASE_URL')||'';
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const LINE_TOKEN=Deno.env.get('LINE_CATALOG_CHANNEL_ACCESS_TOKEN')||'';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
async function db(path:string,option:RequestInit={}):Promise<any>{
  const headers:Record<string,string>={
    apikey:SERVICE,authorization:'Bearer '+SERVICE,
    'content-type':'application/json',...option.headers as Record<string,string>
  };
  const res=await fetch(BASE+'/rest/v1/'+path,{...option,headers});
  const raw=await res.text();
  if(!res.ok)throw new Error('Database HTTP '+res.status+' '+raw.slice(0,320));
  return raw?JSON.parse(raw):null;
}
async function updateJob(id:string,payload:Record<string,unknown>,filters=''){
  return await db('catalog_line_push_jobs?id=eq.'+encodeURIComponent(id)+filters,{
    method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...payload,updated_at:new Date().toISOString()})
  });
}
function assetUrl(path:string){
  return BASE+'/storage/v1/object/public/catalog-line-dm/'+
    path.split('/').map(encodeURIComponent).join('/');
}
function isAvailable(p:any){
  const now=Date.now();
  return p&&p.active===true&&p.published===true&&p.archived_at==null&&
    p.visibility_mode==='all'&&
    (!p.sale_start_at||Date.parse(p.sale_start_at)<=now)&&
    (!p.sale_end_at||Date.parse(p.sale_end_at)>now);
}
function productStillSame(product:any,snapshot:any){
  return isAvailable(product)&&String(product.product_code)===String(snapshot.code)&&
    String(product.name)===String(snapshot.name)&&
    Number(product.base_price)===Number(snapshot.price);
}
async function runJob(job:any){
  // Atomic claim: exactly one concurrent runner can move pending -> processing.
  const claim=await updateJob(job.id,{status:'processing',started_at:new Date().toISOString()},'&status=eq.pending');
  if(!Array.isArray(claim)||!claim.length)return {id:job.id,skip:'already_claimed'};
  try{
    const groups=await db('catalog_line_groups?select=*&id=eq.'+encodeURIComponent(job.group_id));
    const g=groups?.[0];
    if(!g?.active||!g?.connected)throw new Error('LINE 群組未啟用或已離開');
    if(!Array.isArray(job.product_ids)||job.product_ids.length<1||job.product_ids.length>6)throw new Error('商品數量無效');
    if(!Array.isArray(job.product_snapshot)||job.product_snapshot.length!==job.product_ids.length)throw new Error('商品快照無效');
    const ids=job.product_ids.join(',');
    const products=await db('catalog_products?select=id,product_code,name,base_price,active,published,archived_at,visibility_mode,sale_start_at,sale_end_at&id=in.('+ids+')');
    const byId=new Map((products||[]).map((p:any)=>[p.id,p]));
    for(const snap of job.product_snapshot){
      if(!job.product_ids.includes(snap.id)||!productStillSame(byId.get(snap.id),snap))
        throw new Error('商品資料已變動、已下架或已結單，排程已停止，請重新建立 DM');
    }
    const img=assetUrl(String(job.dm_storage_path));
    const preview=assetUrl(String(job.preview_storage_path));
    const [probe,previewProbe]=await Promise.all([fetch(img,{method:'HEAD'}),fetch(preview,{method:'HEAD'})]);
    if(!probe.ok||!previewProbe.ok)throw new Error('DM 或 LINE 預覽圖片無法公開讀取');
    if(Number(previewProbe.headers.get('content-length')||0)>1000000)
      throw new Error('LINE 預覽圖片超過 1MB，請重新建立排程');
    const intro=String(job.intro||'新品上架，歡迎查看商城！').slice(0,250);
    const lines=job.product_snapshot.map((p:any)=>
      '・'+String(p.code)+'｜'+String(p.name).slice(0,48));
    const message='🆕【宜羿商城・新品上架】\n'+intro+
      '\n\n'+lines.join('\n')+'\n\n🛒 點擊商城查看與訂購：\n'+String(job.mall_url);
    if(message.length>4900)throw new Error('推播文字超出長度限制');
    const send=await fetch('https://api.line.me/v2/bot/message/push',{
      method:'POST',
      headers:{authorization:'Bearer '+LINE_TOKEN,'content-type':'application/json',
        'X-Line-Retry-Key':String(job.id)},
      body:JSON.stringify({to:g.line_group_id,messages:[
        {type:'image',originalContentUrl:img,previewImageUrl:preview},
        {type:'text',text:message}
      ]})
    });
    const payload=await send.text();
    if(!send.ok)throw new Error('LINE 發送失敗 HTTP '+send.status+': '+payload.slice(0,350));
    await updateJob(job.id,{status:'sent',sent_at:new Date().toISOString(),
      error_message:null,line_response:{http_status:send.status,request_id:send.headers.get('x-line-request-id')}});
    // This timestamp is only a summary indicator; group-specific history is in jobs.
    for(const id of job.product_ids){
      await db('catalog_products?id=eq.'+encodeURIComponent(id),{
        method:'PATCH',headers:{Prefer:'return=minimal'},
        body:JSON.stringify({line_announced_at:new Date().toISOString()})
      });
    }
    return {id:job.id,status:'sent'};
  }catch(e){
    const message=String(e instanceof Error?e.message:e).slice(0,500);
    try{await updateJob(job.id,{status:'failed',error_message:message});}
    catch(dbErr){console.error('Failed to persist LINE job failure',String(dbErr));}
    return {id:job.id,status:'failed',reason:message};
  }
}
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return response({ok:false,error:'method_not_allowed'},405);
  if(!BASE||!SERVICE)return response({ok:false,error:'server_config_missing'},503);
  try{
    const secret=req.headers.get('x-cron-key')||'';
    if(!secret)return response({ok:false,error:'unauthorized'},401);
    const verified=await db('rpc/catalog_line_verify_cron',{
      method:'POST',body:JSON.stringify({p_token:secret})
    });
    if(verified!==true)return response({ok:false,error:'unauthorized'},401);
    if(!LINE_TOKEN)return response({ok:true,configured:false,processed:0,message:'宜羿新品通知官方帳號尚未連接；未發送任何 LINE 訊息'});
    const due=await db('catalog_line_push_jobs?select=*&status=eq.pending&scheduled_at=lte.'+
      encodeURIComponent(new Date().toISOString())+'&order=scheduled_at.asc&limit=8');
    const results=[];
    for(const job of due||[])results.push(await runJob(job));
    return response({ok:true,processed:results.length,results});
  }catch(e){
    console.error('Catalog LINE runner',String(e));
    return response({ok:false,error:'runner_failed'},500);
  }
});
