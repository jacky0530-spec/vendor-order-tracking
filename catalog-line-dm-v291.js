(function(){
'use strict';
var CFG=window.APP_CONFIG||{},BASE=CFG.SUPABASE_URL,KEY=CFG.SUPABASE_PUBLISHABLE_KEY;
var ORIGIN='https://jacky0530-spec.github.io/vendor-order-tracking/';
var rootId='catAdminLinePush';
var model={products:[],groups:[],jobs:[],images:[],selected:new Set(),ready:false,groupPanelOpen:false,groupFilter:''};
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function session(){try{return JSON.parse(localStorage.getItem('vendor_order_session')||'null');}catch(e){return null;}}
async function api(path,options){
  var token=session()?.access_token;
  if(!token)throw new Error('登入已過期，請重新登入');
  var headers=Object.assign({'apikey':KEY,'authorization':'Bearer '+token,'Content-Type':'application/json'},options?.headers||{});
  var resp=await fetch(BASE+'/rest/v1/'+path,Object.assign({},options||{},{headers:headers}));
  var body=await resp.text();
  if(!resp.ok){var desc=body;try{var parsed=JSON.parse(body);desc=parsed.message||parsed.details||body;}catch(e){}throw new Error(desc||'HTTP '+resp.status);}
  return body?JSON.parse(body):null;
}
async function rpc(name,body){return api('rpc/'+name,{method:'POST',body:JSON.stringify(body)});}
// Read all catalog records, not only the first PostgREST page, so every sellable item is searchable.
async function apiPaged(path){
  var all=[],pageSize=500;
  for(var offset=0;offset<=50000;offset+=pageSize){
    var items=await api(path+'&limit='+pageSize+'&offset='+offset);
    if(!Array.isArray(items))throw new Error('商品分頁資料讀取失敗');
    all.push.apply(all,items);
    if(items.length<pageSize)return all;
  }
  throw new Error('商品清單過多，請聯繫管理員');
}
function fmt(d){return d?new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'—';}
function price(n){return 'NT$'+Number(n).toLocaleString('zh-TW',{maximumFractionDigits:2});}
function localTaipei(plusMinutes){
  var d=new Date(Date.now()+(plusMinutes||0)*60000);
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',
    day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');
}
function readyProduct(p,at){
  var when=at||Date.now();
  return p.active===true&&p.published===true&&p.archived_at==null&&p.visibility_mode==='all'&&
    (!p.sale_start_at||new Date(p.sale_start_at).getTime()<=when)&&
    (!p.sale_end_at||new Date(p.sale_end_at).getTime()>when);
}
function imgPath(pid){var arr=model.images.filter(function(x){return x.product_id===pid;});arr.sort(function(a,b){return a.sort_order-b.sort_order;});return arr[0]?.storage_path||'';}
function imgUrl(path){return BASE+'/storage/v1/object/public/catalog-images/'+path.split('/').map(encodeURIComponent).join('/');}
function getSelected(){return model.products.filter(function(p){return model.selected.has(p.id);});}
function setStatus(message,isError){var el=$('catLineStatus');if(!el)return;el.className='cat-line-status'+(isError?' error':'');el.textContent=message||'';}
async function reload(){
  var [products,groups,jobs,images]=await Promise.all([
    apiPaged('catalog_products?select=id,product_code,name,base_price,active,published,archived_at,visibility_mode,line_published_at,line_announced_at,sale_start_at,sale_end_at,updated_at&active=eq.true&published=eq.true&archived_at=is.null&visibility_mode=eq.all&order=updated_at.desc,id.desc'),
    apiPaged('catalog_line_groups?select=*&order=last_seen_at.desc,id.desc'),
    api('catalog_line_push_jobs?select=*&order=created_at.desc&limit=30'),
    apiPaged('catalog_product_images?select=product_id,storage_path,sort_order,id&order=sort_order.asc,id.asc')
  ]);
  model.products=products||[];model.groups=groups||[];model.jobs=jobs||[];model.images=images||[];
  var now=Date.now(),available=new Set(model.products.filter(function(p){return readyProduct(p,now);}).map(function(p){return p.id;}));
  model.selected=new Set([...model.selected].filter(function(id){return available.has(id);}));
}
function groupList(){
  var el=$('catLineGroups');if(!el)return;
  var total=model.groups.length;
  var enabled=model.groups.filter(function(g){return g.active&&g.connected;}).length;
  var disconnected=model.groups.filter(function(g){return !g.connected;}).length;
  var summary=$('catLineGroupCounts');
  if(summary)summary.textContent='共 '+total+' 群｜已啟用 '+enabled+' 群'+(disconnected?'｜已離開 '+disconnected+' 群':'');
  var keyword=(model.groupFilter||'').normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
  var list=model.groups.filter(function(g){
    return !keyword||(String(g.group_name||'')+' '+String(g.line_group_id||'')).normalize('NFKC')
      .toLocaleLowerCase('zh-TW').includes(keyword);
  }).sort(function(a,b){
    var x=(a.active&&a.connected?2:a.connected?1:0);
    var y=(b.active&&b.connected?2:b.connected?1:0);
    if(x!==y)return y-x;
    return new Date(b.last_seen_at||0).getTime()-new Date(a.last_seen_at||0).getTime();
  });
  var count=$('catLineGroupFilteredCount');
  if(count)count.textContent=keyword?'符合 '+list.length+' / '+total+' 群':'顯示 '+list.length+' 群（已啟用優先）';
  el.innerHTML=list.length?list.map(function(g){
    var status=!g.connected?'已離開':g.active?'已啟用':'已停用';
    return '<div class="cat-line-group cat-line-group-compact">'+
      '<div class="cat-line-group-detail"><strong title="'+esc(g.group_name)+'">'+esc(g.group_name)+'</strong>'+
      '<div class="muted">'+esc(status)+'｜尾碼 '+esc(g.line_group_id.slice(-6))+
      '｜最後訊息 '+esc(fmt(g.last_seen_at))+'</div></div>'+
      '<button type="button" class="btn '+(g.active?'ghost':'secondary')+
      '" data-line-group-toggle="'+esc(g.id)+'" '+(!g.connected?'disabled':'')+
      ' aria-label="'+esc((g.active?'停用':'啟用')+g.group_name+'推播')+'">'+
      (g.active?'停用推播':'啟用推播')+'</button></div>';
  }).join(''):(total===0?
    '<p class="muted cat-line-group-empty">尚未偵測到群組。請先建立「宜羿新品通知」LINE 官方帳號並啟用 Messaging API，邀請機器人加入私人群組，再傳送一則訊息觸發登錄。</p>':
    '<p class="muted cat-line-group-empty">找不到符合搜尋條件的群組。</p>');
  el.querySelectorAll('[data-line-group-toggle]').forEach(function(b){b.onclick=async function(){
    var g=model.groups.find(function(x){return x.id===b.dataset.lineGroupToggle;});
    if(!g)return;
    if(!confirm((g.active?'停用':'啟用')+'「'+g.group_name+'」新品 LINE 推播？'))return;
    b.disabled=true;
    try{
      await api('catalog_line_groups?id=eq.'+encodeURIComponent(g.id),{method:'PATCH',
        headers:{Prefer:'return=minimal'},
        body:JSON.stringify({active:!g.active,updated_at:new Date().toISOString()})});
      await reload();
      groupList();
      refreshGroupSelect();
      renderJobs();
      setStatus('已'+(!g.active?'啟用':'停用')+'「'+g.group_name+'」的推播');
    }catch(err){setStatus('群組變更失敗：'+err.message,true);}
    finally{if(b.isConnected)b.disabled=false;}
  };});
}
function setupGroupPanel(){
  var toggle=$('catLineGroupExpand'),panel=$('catLineGroupPanel'),search=$('catLineGroupSearch');
  if(!toggle||!panel||!search)return;
  function sync(){
    panel.classList.toggle('hidden',!model.groupPanelOpen);
    toggle.setAttribute('aria-expanded',model.groupPanelOpen?'true':'false');
    toggle.textContent=model.groupPanelOpen?'收合群組管理':'展開群組管理';
    search.value=model.groupFilter;
  }
  toggle.onclick=function(){
    model.groupPanelOpen=!model.groupPanelOpen;
    sync();
    if(model.groupPanelOpen&&model.groups.length>0)search.focus();
  };
  search.oninput=function(){
    model.groupFilter=search.value;
    groupList();
  };
  sync();
}
function refreshGroupSelect(){
  var el=$('catLineTarget');if(!el)return;
  var prev=el.value;
  var options=model.groups.filter(function(g){return g.active&&g.connected;});
  el.innerHTML='<option value="">請選擇已啟用的群組</option>'+
    options.map(function(g){return '<option value="'+esc(g.id)+'" '+(prev===g.id?'selected':'')+'>'+esc(g.group_name)+'</option>';}).join('');
}
function renderProducts(){
  var el=$('catLineProducts');if(!el)return;
  var all=model.products.filter(function(p){return readyProduct(p,Date.now());});
  var search=($('catLineSearch')?.value||'').normalize('NFKC').trim().toLocaleLowerCase('zh-TW');
  var list=all.filter(function(p){
    return !search||(String(p.product_code)+' '+p.name).normalize('NFKC').toLocaleLowerCase('zh-TW').includes(search);
  });
  var summary=$('catLineResultSummary');
  if(summary)summary.textContent='目前可販售 '+all.length+' 件｜搜尋符合 '+list.length+' 件';
  el.innerHTML=list.length?list.map(function(p){
    var img=imgPath(p.id);
    return '<label class="cat-line-item"><input type="checkbox" data-line-product="'+esc(p.id)+'" '+
      (model.selected.has(p.id)?'checked':'')+'><div class="cat-line-thumb">'+
      (img?'<img loading="lazy" alt="" src="'+esc(imgUrl(img))+'">':'<span>無照片</span>')+'</div>'+
      '<div class="cat-line-item-info"><strong>'+esc(p.product_code)+'｜'+esc(p.name)+'</strong>'+
      '<div>'+esc(price(p.base_price))+'｜目前可販售</div>'+
      (p.line_announced_at?'<div class="muted">過去已推播：'+esc(fmt(p.line_announced_at))+'（可再次選取）</div>':'')+
      (!img?'<div class="cat-line-warning">此商品尚無照片，無法合成 DM</div>':'')+
      '</div></label>';
  }).join(''):(all.length?
    '<p class="muted">找不到符合「'+esc(search)+'」的可販售商品，請換一組商品編號或名稱。</p>':
    '<p class="muted">目前沒有可公開販售的商品。請確認商品已上架、已啟用，且未結單、未設定為指定客戶專屬。</p>');
  el.querySelectorAll('[data-line-product]').forEach(function(input){input.onchange=function(){
    if(input.checked&&model.selected.size>=6){input.checked=false;setStatus('單張 DM 最多 6 件商品，請先取消其他商品',true);return;}
    if(input.checked)model.selected.add(input.dataset.lineProduct);
    else model.selected.delete(input.dataset.lineProduct);
    $('catLineSelectedCount').textContent='已選 '+model.selected.size+' 件（最多 6 件）';
    var preview=$('catLinePreviewWrap');if(preview)preview.classList.add('hidden');
  };});
  $('catLineSelectedCount').textContent='已選 '+model.selected.size+' 件（最多 6 件）';
  var clear=$('catLineClearSelected');if(clear)clear.disabled=model.selected.size===0;
}
function renderJobs(){
  var el=$('catLineJobHistory');if(!el)return;
  var names=new Map(model.groups.map(function(x){return [x.id,x.group_name];}));
  var stateName={pending:'待發送',processing:'發送中',sent:'已發送',failed:'失敗',cancelled:'已取消'};
  el.innerHTML=model.jobs.length?model.jobs.map(function(j){
    var codes=(j.product_snapshot||[]).map(function(p){return p.code;}).join('、');
    return '<div class="cat-line-job"><div><strong>'+esc(stateName[j.status]||j.status)+'｜'+
      esc(names.get(j.group_id)||'群組')+'</strong><div class="muted">排程：'+esc(fmt(j.scheduled_at))+
      '｜商品：'+esc(codes)+'</div>'+
      (j.error_message?'<div class="cat-line-warning">'+esc(j.error_message)+'</div>':'')+
      '</div>'+(j.status==='pending'?'<button class="btn ghost" type="button" data-line-cancel="'+esc(j.id)+'">取消</button>':'')+
      '</div>';
  }).join(''):'<p class="muted">目前沒有排程紀錄。</p>';
  el.querySelectorAll('[data-line-cancel]').forEach(function(btn){btn.onclick=async function(){
    if(!confirm('取消這筆尚未發送的 LINE 排程？'))return;
    btn.disabled=true;
    try{var success=await rpc('catalog_line_cancel_push',{p_job_id:btn.dataset.lineCancel});
      if(success!==true)throw new Error('排程可能已被執行，請重新整理');
      await reload();renderJobs();setStatus('已取消排程');
    }catch(err){setStatus('取消失敗：'+err.message,true);}finally{btn.disabled=false;}
  };});
}
function imageLoad(url){
  return new Promise(function(resolve,reject){
    var img=new Image();img.crossOrigin='anonymous';img.onload=function(){resolve(img);};
    img.onerror=function(){reject(new Error('商品圖片無法載入，請檢查圖片是否公開：'+url.split('/').pop()));};
    img.src=url;
  });
}
function rounded(ctx,x,y,w,h,r){
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function clipText(ctx,text,width,maxLines,lineHeight){
  // Wrap by Chinese character length rather than CSS layout; prevent overflow.
  var lines=[],current='';
  for(var i=0;i<text.length;i++){
    var next=current+text[i];
    if(ctx.measureText(next).width>width&&current){lines.push(current);current=text[i];}
    else current=next;
  }
  if(current)lines.push(current);
  return lines.slice(0,maxLines).map(function(v,i){
    return i===maxLines-1&&lines.length>maxLines?v.slice(0,Math.max(0,v.length-2))+'…':v;
  });
}
async function composeDM(products){
  if(!products.length||products.length>6)throw new Error('請選擇 1 至 6 件商品');
  var images=await Promise.all(products.map(function(p){
    var path=imgPath(p.id);
    if(!path)throw new Error('「'+p.product_code+'」尚未上傳商品照片');
    return imageLoad(imgUrl(path));
  }));
  var cols=products.length===1?1:2,rows=Math.ceil(products.length/cols);
  var width=1000,margin=40,gap=20,top=150,cardHeight=340,footer=130;
  var height=top+rows*cardHeight+(rows-1)*gap+footer;
  var canvas=$('catLineCanvas')||document.createElement('canvas');
  canvas.width=width;canvas.height=height;
  var ctx=canvas.getContext('2d');if(!ctx)throw new Error('瀏覽器不支援圖片合成');
  ctx.fillStyle='#f1f8f5';ctx.fillRect(0,0,width,height);
  ctx.fillStyle='#086454';ctx.fillRect(0,0,width,126);
  ctx.fillStyle='#fff';ctx.textAlign='left';
  ctx.font='bold 47px "Microsoft JhengHei","Noto Sans TC",sans-serif';
  ctx.fillText('宜羿批發商城｜新品上架',margin,78);
  ctx.font='23px "Microsoft JhengHei","Noto Sans TC",sans-serif';ctx.fillText('本週新商品・歡迎點擊商城查看完整規格',margin,112);
  var cardWidth=(width-margin*2-gap*(cols-1))/cols;
  products.forEach(function(p,i){
    var col=i%cols,row=Math.floor(i/cols),x=margin+col*(cardWidth+gap),y=top+row*(cardHeight+gap);
    ctx.fillStyle='#fff';rounded(ctx,x,y,cardWidth,cardHeight,16);ctx.fill();
    ctx.save();rounded(ctx,x+10,y+10,cardWidth-20,215,10);ctx.clip();
    var img=images[i],iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    var scale=Math.max((cardWidth-20)/iw,215/ih),dw=iw*scale,dh=ih*scale;
    ctx.drawImage(img,x+10+(cardWidth-20-dw)/2,y+10+(215-dh)/2,dw,dh);ctx.restore();
    ctx.fillStyle='#1f2937';ctx.font='bold 22px "Microsoft JhengHei","Noto Sans TC",sans-serif';
    var title=clipText(ctx,p.name,cardWidth-35,2,28);
    title.forEach(function(t,j){ctx.fillText(t,x+17,y+247+j*27);});
    ctx.fillStyle='#087f72';ctx.font='bold 27px sans-serif';
    ctx.fillText(price(p.base_price),x+17,y+323);
    ctx.textAlign='right';ctx.fillStyle='#667085';ctx.font='19px sans-serif';
    ctx.fillText(p.product_code,x+cardWidth-16,y+321);ctx.textAlign='left';
  });
  ctx.fillStyle='#06594d';ctx.font='bold 29px "Microsoft JhengHei","Noto Sans TC",sans-serif';
  ctx.fillText('查看商品詳情與下單 → 宜羿 B2B 批發商城',margin,height-76);
  ctx.fillStyle='#475467';ctx.font='19px sans-serif';ctx.fillText(ORIGIN,margin,height-39);
  return canvas;
}
async function toPng(canvas){
  var blob=await new Promise(function(resolve,reject){
    canvas.toBlob(function(b){b?resolve(b):reject(new Error('DM 圖片產生失敗'));},'image/png');
  });
  if(blob.size>5*1024*1024)throw new Error('合成圖超過 5MB，請減少商品或使用較小照片');
  return blob;
}
async function toPreviewJpg(original){
  var small=document.createElement('canvas');
  small.width=480;
  small.height=Math.round(original.height*480/original.width);
  var ctx=small.getContext('2d');if(!ctx)throw new Error('瀏覽器無法產生 LINE 預覽圖');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,small.width,small.height);
  ctx.drawImage(original,0,0,small.width,small.height);
  async function make(q){
    return new Promise(function(resolve,reject){
      small.toBlob(function(b){b?resolve(b):reject(new Error('LINE 預覽圖合成失敗'));},'image/jpeg',q);
    });
  }
  var blob=await make(.76);
  if(blob.size>=900000)blob=await make(.52);
  if(blob.size>=900000)throw new Error('LINE 預覽圖超出 1MB 限制');
  return blob;
}
async function preview(){
  var selected=getSelected(),canvas=await composeDM(selected);
  $('catLinePreviewWrap').classList.remove('hidden');
  var file=await toPng(canvas),thumb=await toPreviewJpg(canvas);
  setStatus('DM 預覽完成：'+selected.length+' 件商品，原圖 '+(file.size/1024/1024).toFixed(2)+' MB、LINE 縮圖 '+(thumb.size/1024).toFixed(0)+' KB。');
  return {canvas:canvas,blob:file,previewBlob:thumb};
}
async function schedule(){
  var products=getSelected(),group=$('catLineTarget').value,date=$('catLineSchedule').value,
      intro=$('catLineIntro').value.trim();
  if(!products.length)throw new Error('請先選擇要推播的商品');
  if(!group)throw new Error('請先選擇已啟用的 LINE 群組');
  if(!date)throw new Error('請選擇發送日期與時間');
  var scheduled=new Date(date+':00+08:00');
  if(isNaN(scheduled.getTime())||scheduled.getTime()<Date.now()+30000)
    throw new Error('發送時間至少需晚於現在 30 秒');
  if(scheduled.getTime()>Date.now()+90*86400000)throw new Error('最多只能排程未來 90 天');
  if(!products.every(function(p){return readyProduct(p,scheduled.getTime());}))
    throw new Error('選取商品有已結單、未上架或不公開的商品');
  if(!confirm('確定排程發送 '+products.length+' 件商品至 LINE 群組？\n時間：'+fmt(scheduled.toISOString())+
    '\n商品：'+products.map(function(x){return x.product_code;}).join('、')))return false;
  var result=await preview(),uuid=crypto.randomUUID(),owner=session()?.user?.id;
  if(!owner)throw new Error('登入資料已過期');
  var path=owner+'/'+uuid+'.png',previewPath=owner+'/'+uuid+'-preview.jpg';
  var resp=await fetch(BASE+'/storage/v1/object/catalog-line-dm/'+path,{
    method:'POST',
    headers:{apikey:KEY,authorization:'Bearer '+session().access_token,
      'Content-Type':'image/png','x-upsert':'false'},
    body:result.blob
  });
  if(!resp.ok)throw new Error('DM 上傳失敗：'+(await resp.text()).slice(0,250));
  var previewRes=await fetch(BASE+'/storage/v1/object/catalog-line-dm/'+previewPath,{
    method:'POST',headers:{apikey:KEY,authorization:'Bearer '+session().access_token,
      'Content-Type':'image/jpeg','x-upsert':'false'},body:result.previewBlob
  });
  if(!previewRes.ok)throw new Error('LINE 縮圖上傳失敗：'+(await previewRes.text()).slice(0,250));
  await rpc('catalog_line_schedule_push',{
    p_group_id:group,p_product_ids:products.map(function(p){return p.id;}),
    p_scheduled_at:scheduled.toISOString(),p_dm_storage_path:path,p_preview_storage_path:previewPath,
    p_intro:intro,p_mall_url:ORIGIN
  });
  await reload();renderJobs();setStatus('已建立排程：'+fmt(scheduled.toISOString())+'，到時間會由 LINE 機器人發送 DM 與商城網址。');
  return true;
}
async function render(){
  var root=$(rootId);if(!root)return;
  root.innerHTML='<div class="catalog-empty">正在載入 LINE 新品推播…</div>';
  try{
    await reload();
    root.innerHTML='<div class="catalog-block cat-line-manager">'+
      '<h3>LINE 商品推播</h3><p class="muted">可搜尋並勾選所有目前公開販售的商品（包括舊商品），最多 6 件合成一張 DM，指定時間發送至 LINE 群組。不需要先下架再上架；不符合販售條件的商品不會出現。</p>'+
      '<div class="cat-line-setup"><strong>首次啟用：建立「宜羿新品通知」LINE 機器人</strong>'+
      '<p>先至 <a href="https://manager.line.biz/" target="_blank" rel="noopener noreferrer">LINE 官方帳號管理中心</a> 建立帳號並啟用 Messaging API，再到 <a href="https://developers.line.biz/console/" target="_blank" rel="noopener noreferrer">LINE Developers</a> 設定 Webhook 及允許機器人加入私人群組。</p>'+
      '<div class="cat-line-webhook"><code id="catLineWebhookUrl">https://qibeuakrryqjaiwbcorg.supabase.co/functions/v1/catalog-line-webhook</code><button class="btn secondary" type="button" id="catLineCopyWebhook">複製 Webhook</button></div>'+
      '<p class="muted">新機器人的 Channel Secret、Access Token 應安全儲存於 Supabase Edge Function Secrets，不可貼在 GitHub 或商城前端。群組加入後才會出現在下方，並須手動啟用推播。</p></div>'+
      '<h4>1．私人 LINE 群組</h4>'+
      '<div class="cat-line-group-box">'+
      '<div class="cat-line-group-bar"><div class="cat-line-group-caption"><strong id="catLineGroupCounts">群組載入中…</strong>'+
      '<span class="muted">不展開也能在下方直接選擇發送群組</span></div>'+
      '<button type="button" class="btn secondary" id="catLineGroupExpand" aria-expanded="false" aria-controls="catLineGroupPanel">展開群組管理</button></div>'+
      '<div id="catLineGroupPanel" class="cat-line-group-panel hidden">'+
      '<div class="cat-line-group-filters"><input type="search" id="catLineGroupSearch" placeholder="搜尋 LINE 群組名稱或群組編號" aria-label="搜尋私人 LINE 群組" autocomplete="off">'+
      '<span class="muted" id="catLineGroupFilteredCount"></span></div>'+
      '<div id="catLineGroups" class="cat-line-group-scroll" role="region" aria-label="LINE 群組管理清單" tabindex="0"></div></div></div>'+
      '<h4>2．選擇已上架商品 <span id="catLineSelectedCount" class="muted"></span></h4>'+
      '<div class="cat-line-searchbar"><input type="search" id="catLineSearch" placeholder="搜尋商品編號或名稱，例如 2514" aria-label="搜尋目前可販售商品" autocomplete="off">'+
      '<button type="button" class="btn ghost" id="catLineClearSelected">清除已選</button></div>'+
      '<div class="muted cat-line-result-summary" id="catLineResultSummary"></div>'+
      '<div class="cat-line-products" id="catLineProducts"></div>'+
      '<h4>3．設定推播時間及文字</h4>'+
      '<div class="cat-line-form"><label>發送群組<select id="catLineTarget"></select></label>'+
      '<label>台灣時間（UTC+8）<input type="datetime-local" id="catLineSchedule"></label>'+
      '<label class="full">商品訊息說明<textarea id="catLineIntro" rows="3" maxlength="250">🆕 宜羿商城新品上架！點擊連結查看商品詳情並下單。</textarea></label>'+
      '<label class="full">商城連結（固定網址）<input value="'+esc(ORIGIN)+'" readonly></label></div>'+
      '<div class="cat-line-controls"><button type="button" class="btn secondary" id="catLinePreviewButton">預覽合成 DM</button>'+
      '<button type="button" class="btn primary" id="catLineScheduleButton">建立 LINE 發送排程</button>'+
      '<button type="button" class="btn ghost" id="catLineReload">重新整理</button></div>'+
      '<div id="catLineStatus" class="cat-line-status" role="status"></div>'+
      '<div id="catLinePreviewWrap" class="cat-line-preview hidden"><canvas id="catLineCanvas" aria-label="新品 DM 圖片預覽"></canvas></div>'+
      '<h4>4．發送紀錄（最近 30 筆）</h4><div id="catLineJobHistory"></div>'+
      '<p class="muted">排程到時間前可取消。LINE 官方帳號必須加入群組且具備有效 Messaging API 權杖；訊息包含一張 DM 圖片與一則可點擊商城網址的文字。</p></div>';
    $('catLineCopyWebhook').onclick=async function(){
      try{await navigator.clipboard.writeText($('catLineWebhookUrl').textContent);setStatus('Webhook 網址已複製');}
      catch(e){setStatus('自動複製失敗，請手動選取 Webhook 網址',true);}
    };
    $('catLineSchedule').value=localTaipei(15);
    setupGroupPanel();groupList();refreshGroupSelect();renderProducts();renderJobs();
    $('catLineSearch').addEventListener('input',renderProducts);
    $('catLineClearSelected').onclick=function(){
      model.selected.clear();
      $('catLinePreviewWrap').classList.add('hidden');
      renderProducts();
      setStatus('已清除商品選取');
    };
    $('catLinePreviewButton').onclick=async function(){
      this.disabled=true;try{await preview();}catch(err){setStatus('預覽失敗：'+err.message,true);}finally{this.disabled=false;}
    };
    $('catLineScheduleButton').onclick=async function(){
      this.disabled=true;try{await schedule();}catch(err){setStatus('建立排程失敗：'+err.message,true);}finally{this.disabled=false;}
    };
    $('catLineReload').onclick=function(){render().catch(function(err){setStatus(err.message,true);});};
  }catch(e){root.innerHTML='<div class="message error">LINE 推播管理載入失敗：'+esc(e.message)+'</div>';}
}
window.CatalogLineDM={render:render};
})();
