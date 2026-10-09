(function(){
'use strict';
var C=window.APP_CONFIG||{},S=C.SUPABASE_URL,K=C.SUPABASE_PUBLISHABLE_KEY;
function $(x){return document.getElementById(x);}
function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];});}
function session(){try{return JSON.parse(localStorage.getItem('vendor_order_session')||'null');}catch(e){return null;}}
async function req(path,opt,retry){
 opt=opt||{};var ss=session();if(retry!==false&&ss&&ss.expires_at&&Date.now()/1000>ss.expires_at-60)await refresh();
 ss=session();if(!ss||!ss.access_token)throw Error('請重新登入');
 var head=Object.assign({apikey:K,Authorization:'Bearer '+ss.access_token},opt.headers||{});
 var r=await fetch(S+path,Object.assign({},opt,{headers:head}));
 if(r.status===401&&retry!==false){await refresh();return req(path,opt,false);}
 return r;
}
var refreshing=null;
async function refresh(){
 if(refreshing)return refreshing;
 refreshing=(async function(){
  var ss=session();if(!ss||!ss.refresh_token)throw Error('登入已逾期，請重新登入');
  var r=await fetch(S+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:K,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:ss.refresh_token})});
  if(!r.ok)throw Error('登入已逾期，請重新登入');
  var d=await r.json();localStorage.setItem('vendor_order_session',JSON.stringify(d));return d;
 })();
 try{return await refreshing;}finally{refreshing=null;}
}
async function api(path,opt){
 var r=await req('/rest/v1/'+path,Object.assign({headers:{'Content-Type':'application/json'}},opt||{}));
 var t=await r.text();if(!r.ok){var m=t;try{m=JSON.parse(t).message||t;}catch(e){}throw Error(m||'請求失敗');}return t?JSON.parse(t):null;
}
function badge(s){return {new:'待處理',processing:'處理中',waiting_customer:'待客戶回覆',resolved:'已解決',closed:'已結案'}[s]||s;}
function time(t){return new Date(t).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});}
async function signedPhoto(path){
 var r=await req('/storage/v1/object/sign/ng-ticket-photos/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:300})});
 if(!r.ok)return '';var d=await r.json();return S+'/storage/v1'+d.signedURL;
}
async function upload(tid,msgId,file){
 if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>10*1024*1024)throw Error('僅接受 JPG、PNG、WebP，單張不超過 10MB');
 var extension=file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg';
 var path=tid+'/'+crypto.randomUUID()+'.'+extension;
 var r=await req('/storage/v1/object/ng-ticket-photos/'+path,{method:'POST',headers:{'Content-Type':file.type,'x-upsert':'false'},body:file});
 if(!r.ok)throw Error('圖片上傳失敗');
 await api('ng_photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket_id:tid,message_id:msgId||null,storage_path:path,filename:file.name})});
}
async function render(mode,container){
 var root=$(container);if(!root)return;root.innerHTML='<div class="catalog-empty">載入 NG 問題單…</div>';
 try{
  var tickets=await api('ng_tickets?select=*&order=created_at.desc&limit=150');
  var profile=mode==='customer'?await api('user_profiles?select=customer_id&user_id=eq.'+session().user.id):[];
  root.innerHTML='<div class="catalog-head"><h3>NG 商品問題單</h3><button class="btn ghost" id="ngReload">重新整理</button></div>'+
   (mode==='customer'?'<div class="card inner-card"><h3>提出商品問題</h3><div class="catalog-form-grid"><label>問題主旨<input id="ngSubject" placeholder="例如：手套破損"></label><label>商品貨號<input id="ngCode" placeholder="例如 9605"></label><label>訂單／採購單編號<input id="ngOrder" placeholder="選填"></label><label class="span2">問題說明<textarea id="ngDesc" rows="3" placeholder="請描述商品、數量及瑕疵情況"></textarea></label><label class="span2">照片（可多張，每張 10MB 以下）<input id="ngNewFiles" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></div><button class="btn primary" id="ngCreate">送出問題單</button><div id="ngCreateMsg" class="message"></div></div>':'<p class="muted">可查看所有客戶問題、回覆多次處理進度、更新案件狀態。</p>')+
   (tickets.map(function(t){return '<div class="catalog-myorder"><div class="catalog-head"><div><b>NG-'+String(t.ticket_number).padStart(6,'0')+'｜'+esc(t.subject)+'</b><div class="muted">'+esc(badge(t.status))+'｜'+esc(time(t.created_at))+'｜商品 '+esc(t.product_code||'—')+'｜'+esc(t.order_reference||'')+'</div></div><button class="btn secondary" data-ng-open="'+t.id+'">查看與回覆</button></div><div>'+esc(t.description)+'</div><div id="ngThread-'+t.id+'"></div></div>';}).join('')||'<div class="catalog-empty">尚無 NG 問題單。</div>');
  $('ngReload').onclick=function(){render(mode,container);};
  root.querySelectorAll('[data-ng-open]').forEach(function(b){b.onclick=function(){openThread(mode,b.dataset.ngOpen);};});
  if(mode==='customer')$('ngCreate').onclick=async function(){
   var btn=this,msg=$('ngCreateMsg'),sub=$('ngSubject').value.trim(),desc=$('ngDesc').value.trim();
   if(!sub||!desc){msg.textContent='請填寫主旨與問題說明';return;}
   btn.disabled=true;msg.textContent='正在送出…';
   try{
    var row=await api('ng_tickets',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({customer_id:profile[0].customer_id,subject:sub,description:desc,product_code:$('ngCode').value.trim()||null,order_reference:$('ngOrder').value.trim()||null})});
    var files=Array.from($('ngNewFiles').files||[]);var errors=[];
    for(var f of files){try{await upload(row[0].id,null,f);}catch(e){errors.push(f.name+': '+e.message);}}
    if(errors.length)alert('問題單已建立，但部分照片未上傳：\n'+errors.join('\n'));
    await render(mode,container);
   }catch(e){msg.textContent=e.message;btn.disabled=false;}
  };
 }catch(e){root.innerHTML='<div class="message error">讀取失敗：'+esc(e.message)+'</div>';}
}
async function openThread(mode,id){
 var el=$('ngThread-'+id);if(!el)return;if(el.dataset.open==='1'){el.innerHTML='';el.dataset.open='';return;}el.dataset.open='1';
 el.innerHTML='<p class="muted">載入留言與照片…</p>';
 try{
  var out=await Promise.all([api('ng_messages?select=*&ticket_id=eq.'+id+'&order=created_at.asc'),api('ng_photos?select=*&ticket_id=eq.'+id+'&order=created_at.asc'),api('ng_tickets?select=*&id=eq.'+id)]);
  var msgs=out[0],photos=out[1],ticket=out[2][0];
  var pictureMap={};await Promise.all(photos.map(async function(p){pictureMap[p.id]=await signedPhoto(p.storage_path);}));
  function imgs(messageId){return photos.filter(function(p){return p.message_id===messageId;}).map(function(p){var url=pictureMap[p.id];return url?'<a href="'+esc(url)+'" target="_blank" rel="noopener"><img src="'+esc(url)+'" alt="'+esc(p.filename)+'" style="height:90px;max-width:130px;object-fit:cover;border-radius:8px;margin:4px"></a>':'';}).join('');}
  el.innerHTML='<div class="catalog-block"><b>問題照片</b><div>'+imgs(null)+'</div>'+
   msgs.map(function(m){return '<div style="border-top:1px solid #ddd;padding:10px 0"><div class="muted">'+esc(time(m.created_at))+'｜'+(m.author_id===ticket.created_by?'客戶':'處理人員')+'</div><div style="white-space:pre-wrap">'+esc(m.body)+'</div>'+imgs(m.id)+'</div>';}).join('')+
   (ticket.status==='closed'?'<p>此問題單已結案。</p>':'<div><label>新增留言／處理進度<textarea id="ngReply-'+id+'" rows="3" style="width:100%"></textarea></label><label>附加照片<input type="file" id="ngReplyFiles-'+id+'" accept="image/jpeg,image/png,image/webp" multiple></label><button class="btn primary" data-ng-send>送出回覆</button></div>')+
   (mode==='admin'?'<label>處理狀態<select id="ngStatus-'+id+'">'+['new','processing','waiting_customer','resolved','closed'].map(function(s){return '<option value="'+s+'" '+(ticket.status===s?'selected':'')+'>'+badge(s)+'</option>';}).join('')+'</select></label><button class="btn secondary" data-ng-status>更新狀態</button>':'')+'</div>';
  var send=el.querySelector('[data-ng-send]');if(send)send.onclick=async function(){
   var body=$('ngReply-'+id).value.trim(),files=Array.from($('ngReplyFiles-'+id).files||[]);
   if(!body){alert('請先輸入留言');return;}send.disabled=true;
   try{var rows=await api('ng_messages',{method:'POST',headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({ticket_id:id,body})});
    for(var f of files)await upload(id,rows[0].id,f);
    el.dataset.open='';await openThread(mode,id);
   }catch(e){alert(e.message);send.disabled=false;}
  };
  var status=el.querySelector('[data-ng-status]');if(status)status.onclick=async function(){
   try{await api('ng_tickets?id=eq.'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('ngStatus-'+id).value,updated_at:new Date().toISOString()})});await render(mode,mode==='admin'?'catAdminNg':'catalogCustomerArea');}catch(e){alert(e.message);}
  };
 }catch(e){el.textContent='載入失敗：'+e.message;}
}
window.NGTickets={render:render};
})();