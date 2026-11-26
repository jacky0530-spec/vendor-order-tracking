const encoder=new TextEncoder();
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});

async function verifySignature(body:string,signature:string,secret:string){
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signed=new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(body)));
  const expected=btoa(String.fromCharCode(...signed));
  if(expected.length!==signature.length)return false;
  let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^signature.charCodeAt(i);
  return diff===0;
}

function normalize(value=""){return value.normalize("NFKC").replace(/\r/g,"").replace(/[：﹕]/g,":").trim()}
function splitOrderBlocks(raw:string){
  const lines=normalize(raw).split("\n"),blocks:string[]=[];let cur:string[]=[];
  for(const line of lines){if(!line.trim()&&!cur.length)continue;cur.push(line);if(/^\s*運費\s*:/u.test(line)){const b=cur.join("\n").trim();if(b)blocks.push(b);cur=[]}}
  const tail=cur.join("\n").trim();if(tail)blocks.push(tail);return blocks;
}

async function replyLine(replyToken:string,text:string){
  const token=Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")??"";
  if(!replyToken||!token||!text)return;
  const r=await fetch("https://api.line.me/v2/bot/message/reply",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({replyToken,messages:[{type:"text",text:text.slice(0,4900)}]})});
  if(!r.ok)console.error("LINE reply failed",r.status,await r.text());
}

function resultText(results:any[]){
  const lines:string[]=[];
  for(const x of results){
    if(x?.status==="created"){
      lines.push(`✅ 已建立 ${x.order_no??"訂單"}${x.vendor?`\n廠商：${x.vendor}`:""}${x.deadline?`\n最晚交期：${x.deadline}`:""}`);
    }else if(x?.status==="duplicate"&&x?.reason==="semantic_duplicate"){
      lines.push(`⚠️ 重複訂單，未再次建立${x.order_no?`\n原訂單：${x.order_no}`:""}${x.vendor?`\n廠商：${x.vendor}`:""}`);
    }else if(x?.status==="needs_review"&&x?.reason==="missing_items"){
      lines.push("⚠️ 訂單未建立：未辨識到商品編號，請查看管理者 LINE 異常。");
    }else if(x?.status==="error"){
      lines.push("⚠️ 訂單處理失敗，請查看管理者 LINE 異常。");
    }
  }
  return lines.join("\n\n");
}

function apiHeaders(serviceRole:string,extra:Record<string,string>={}){
  return {apikey:serviceRole,authorization:`Bearer ${serviceRole}`,"content-type":"application/json",...extra};
}

async function apiJson(base:string,serviceRole:string,path:string,options:RequestInit={}){
  const r=await fetch(`${base}/rest/v1/${path}`,{...options,headers:{...apiHeaders(serviceRole),...((options.headers as Record<string,string>)||{})}});
  const t=await r.text();
  if(!r.ok)throw new Error(`REST ${r.status}: ${t.slice(0,400)}`);
  return t?JSON.parse(t):null;
}

async function processUnsend(event:any,base:string,serviceRole:string){
  const messageId=String(event?.unsend?.messageId??"").trim();
  if(!messageId)return {messageId:"",matched:0,recycled:0,protected:0};
  const filter=encodeURIComponent(`(line_message_id.eq.${messageId},line_message_id.like.${messageId}:*)`);
  const lineEvents=await apiJson(base,serviceRole,`line_events?select=id,line_message_id,created_order_id,parsed_payload,parse_status,parse_error&or=${filter}`);
  if(!Array.isArray(lineEvents)||!lineEvents.length){
    console.log("LINE unsend: no matching line_event",messageId);
    return {messageId,matched:0,recycled:0,protected:0};
  }

  const orderIds=[...new Set(lineEvents.map((x:any)=>x.created_order_id).filter(Boolean))];
  const shippedOrders=new Set<string>();
  if(orderIds.length){
    const ids=orderIds.join(",");
    const shipments=await apiJson(base,serviceRole,`order_item_shipments?select=order_id&order_id=in.(${ids})`);
    for(const s of shipments||[])if(s?.order_id)shippedOrders.add(String(s.order_id));
  }

  let recycled=0,protectedCount=0;
  const now=new Date().toISOString();
  for(const le of lineEvents){
    const orderId=le.created_order_id?String(le.created_order_id):"";
    let action="history_only";
    if(orderId){
      if(shippedOrders.has(orderId)){
        protectedCount++;
        action="kept_shipping_exists";
      }else{
        await apiJson(base,serviceRole,`orders?id=eq.${encodeURIComponent(orderId)}&deleted_at=is.null`,{
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({deleted_at:now,deleted_by:null,deleted_reason:"LINE 訊息已收回，自動移至回收桶"})
        });
        recycled++;
        action="moved_to_recycle_bin";
      }
    }
    const payload={...(le.parsed_payload||{}),line_unsent:true,line_unsent_at:now,line_unsend_action:action,line_unsend_message_id:messageId};
    const note=action==="moved_to_recycle_bin"?"LINE訊息已收回：訂單已自動移至回收桶":action==="kept_shipping_exists"?"LINE訊息已收回：已有出貨紀錄，訂單保留":"LINE訊息已收回：未建立訂單";
    await apiJson(base,serviceRole,`line_events?id=eq.${encodeURIComponent(le.id)}`,{
      method:"PATCH",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({parsed_payload:payload,parse_error:note})
    });
  }
  console.log("LINE unsend processed",{messageId,matched:lineEvents.length,recycled,protected:protectedCount});
  return {messageId,matched:lineEvents.length,recycled,protected:protectedCount};
}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const secret=Deno.env.get("LINE_CHANNEL_SECRET")??"";
  if(!secret)return json({ok:false,error:"line_secret_missing"},503);
  const raw=await req.text();
  const sig=req.headers.get("x-line-signature")??"";
  if(!sig||!(await verifySignature(raw,sig,secret)))return json({ok:false,error:"invalid_signature"},401);
  let payload:any;try{payload=JSON.parse(raw)}catch{return json({ok:false,error:"invalid_json"},400)}
  const events=Array.isArray(payload?.events)?payload.events:[];
  if(events.length===0){console.log("LINE verify OK");return json({ok:true,verify:true});}

  const base=Deno.env.get("SUPABASE_URL")??"";
  const serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
  if(!base||!serviceRole){console.error("Worker dispatch config missing",{hasUrl:Boolean(base),hasServiceRole:Boolean(serviceRole)});return json({ok:true,accepted:true,worker_dispatched:false});}

  const unsendEvents=events.filter((e:any)=>e?.type==="unsend");
  const messageEvents=events.filter((e:any)=>e?.type==="message"&&e?.message?.type==="text");

  const task=(async()=>{
    try{
      // Register verified group events; new groups remain disabled until approved by a manager.
      // Existing LINE order processing remains unchanged.
      for(const event of events){
        const groupId=String(event?.source?.type==='group'?event?.source?.groupId??'':'');
        if(!/^C[0-9a-fA-F]{32}$/.test(groupId))continue;
        try{
          if(event.type==='leave'){
            await apiJson(base,serviceRole,'catalog_line_groups?line_group_id=eq.'+encodeURIComponent(groupId),{
              method:'PATCH',headers:{Prefer:'return=minimal'},
              body:JSON.stringify({connected:false,active:false,updated_at:new Date().toISOString()})
            });
            continue;
          }
          const existing=await apiJson(base,serviceRole,
            'catalog_line_groups?select=id,group_name&line_group_id=eq.'+encodeURIComponent(groupId));
          const found=Array.isArray(existing)&&existing.length>0;
          let groupName='LINE 群組 '+groupId.slice(-6);
          if(event.type==='join'){
            const lineToken=Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')||'';
            if(lineToken){
              try{
                const summary=await fetch('https://api.line.me/v2/bot/group/'+encodeURIComponent(groupId)+'/summary',{
                  headers:{authorization:'Bearer '+lineToken}
                });
                if(summary.ok){
                  const info=await summary.json();
                  groupName=String(info.groupName||groupName).slice(0,120);
                }
              }catch(e){console.warn('LINE group summary unavailable',String(e));}
            }
          }
          if(found){
            const patch:any={connected:true,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()};
            if(event.type==='join'&&groupName)patch.group_name=groupName;
            await apiJson(base,serviceRole,'catalog_line_groups?line_group_id=eq.'+encodeURIComponent(groupId),{
              method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)
            });
          }else{
            await apiJson(base,serviceRole,'catalog_line_groups',{
              method:'POST',headers:{Prefer:'return=minimal'},
              body:JSON.stringify({line_group_id:groupId,group_name:groupName,connected:true,active:false})
            });
          }
        }catch(e){console.error('Catalog LINE group event failed',String(e));}
      }
      for(const event of unsendEvents){
        try{await processUnsend(event,base,serviceRole)}catch(e){console.error("LINE unsend failed",String(e));}
      }

      if(!messageEvents.length)return;
      const workerPayload={...payload,events:messageEvents};
      const r=await fetch(`${base}/functions/v1/line-worker`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${serviceRole}`},body:JSON.stringify(workerPayload)});
      const t=await r.text();console.log("line-worker dispatch",r.status,t.slice(0,1200));
      if(!r.ok)return;
      let worker:any;try{worker=JSON.parse(t)}catch{return;}
      const all=Array.isArray(worker?.results)?worker.results:[];
      let cursor=0;
      for(const event of messageEvents){
        const count=Math.max(1,splitOrderBlocks(String(event.message.text??"")).length);
        const own=all.slice(cursor,cursor+count);cursor+=count;
        const text=resultText(own);
        if(text)await replyLine(String(event.replyToken??""),text);
      }
    }catch(e){console.error("line webhook background task failed",String(e));}
  })();
  (globalThis as any).EdgeRuntime.waitUntil(task);
  return json({ok:true,accepted:true});
});