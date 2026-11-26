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
async function durationOf(file){
 return new Promise(function(resolve,reject){
  var url=URL.createObjectURL(file),video=document.createElement('video'),done=false;
  function finish(error,value){if(done)return;done=true;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);if(error)reject(error);else resolve(value);}
  video.preload='metadata';
  video.onloadedmetadata=function(){var d=video.duration;if(!Number.isFinite(d)||d<=0)finish(Error('無法確認影片長度，請使用 MP4 或 WebM'));else finish(null,d);};
  video.onerror=function(){finish(Error('影片無法讀取，請轉成 MP4 再試'));};
  video.src=url;
 });
}
async function validateMedia(file){
 var images=['image/jpeg','image/png','image/webp'],videos=['video/mp4','video/webm','video/quicktime'];
 if(images.includes(file.type)){if(file.size>10*1024*1024)throw Error('照片每張不得超過 10MB');return {seconds:null,ext:file.type==='image/png'?'png':file.type==='image/webp'?'webp':'jpg'};}
 if(!videos.includes(file.type))throw Error('僅支援 JPG、PNG、WebP 圖片及 MP4、MOV、WebM 影片');
 if(file.size>50*1024*1024)throw Error('影片檔案不得超過 50MB');
 var d=await durationOf(file);
 if(d>30)throw Error('影片長度不得超過 30 秒（目前 '+Math.ceil(d)+' 秒）');
 return {seconds:d,ext:file.type==='video/mp4'?'mp4':file.type==='video/quicktime'?'mov':'webm'};
}
async function upload(tid,msgId,file,validated){
 var media=validated||await validateMedia(file);
 var path=tid+'/'+crypto.randomUUID()+'.'+media.ext;
 var r=await req('/storage/v1/object/ng-ticket-photos/'+path,{method:'POST',headers:{'Content-Type':file.type,'x-upsert':'false'},body:file});
 if(!r.ok){var info=await r.text();throw Error('附件上傳失敗：'+info);}
 await api('ng_photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket_id:tid,message_id:msgId||null,storage_path:path,filename:file.name,mime_type:file.type,video_duration_seconds:media.seconds})});
}

var issueStatuses=[
  ['new','尚未處理'],['processing','處理中'],['waiting_vendor','等待廠商'],
  ['waiting_customer','等待客人'],['resolved','已解決'],['closed','已結案']
];
var issueCategories=['NG回報','訂單貨況','缺貨回報','其他'];
function statusLabel(s){var hit=issueStatuses.find(function(x){return x[0]===s;});return hit?hit[1]:s;}
function today(){var d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function displayDate(d){return d?String(d).slice(0,10):'—';}
function toastError(e){alert('待處理問題單：'+(e&&e.message||e));}
function managerOnly(mode){return mode==='admin';}

async function render(mode,container){
 var root=$(container);if(!root)return;
 if(!managerOnly(mode)){root.innerHTML='<p class="catalog-empty">本功能已改為管理者內部維護。</p>';return;}
 root.innerHTML='<div class="catalog-empty">正在載入待處理問題單…</div>';
 try{
   var parts=await Promise.all([
     api('ng_tickets?select=*&order=created_at.desc&limit=500'),
     api('customers?select=id,customer_code,name&order=customer_code.asc')
   ]);
   var tickets=parts[0]||[],customers=parts[1]||[];
   var byCustomer=new Map(customers.map(function(c){return [c.id,c];}));
   var total=tickets.length,completed=tickets.filter(function(t){return t.is_completed;}).length;
   root.innerHTML='<div class="catalog-head"><div><h3>待處理問題單</h3>'+
     '<p class="muted">依照「團購待處理件」表單整理：登記日期、主要人、次要人、問題類型、案件狀態、問題內容、備註與完成狀態。僅管理者／員工可新增和維護。</p></div>'+
     '<div class="issue-toolbar-buttons"><button class="btn primary" id="issueAdd" type="button">＋新增問題單</button>'+
     '<button class="btn ghost" id="issueReload" type="button">重新整理</button></div></div>'+
     '<div class="issue-summary">共 '+total+' 筆｜未完成 '+(total-completed)+' 筆｜已完成 '+completed+' 筆</div>'+
     '<div class="issue-filters"><input type="search" id="issueSearch" placeholder="搜尋主要人、次要人、問題內容、類型、單號">'+
     '<select id="issueStatusFilter"><option value="">全部案件狀態</option>'+issueStatuses.map(function(x){return '<option value="'+x[0]+'">'+x[1]+'</option>';}).join('')+'</select>'+
     '<select id="issueCompleteFilter"><option value="active">只顯示未完成</option><option value="all">全部案件</option><option value="done">已完成</option></select></div>'+
     '<div id="issueRows">'+(tickets.map(function(t){
       var c=byCustomer.get(t.customer_id);
       var main=t.primary_person||c&&c.name||'未填主要人';
       var label=t.is_completed?'已完成｜'+statusLabel(t.status):statusLabel(t.status);
       var search=['PN-'+String(t.ticket_number).padStart(6,'0'),t.primary_person,t.secondary_person,
         t.issue_type,t.description,t.subject,t.product_code,t.order_reference,c&&c.customer_code,c&&c.name,t.internal_notes].join(' ').toLowerCase();
       return '<article class="issue-list-card" data-issue-search="'+esc(search)+'" data-issue-status="'+esc(t.status)+'" data-issue-complete="'+(t.is_completed?'1':'0')+'">'+
         '<div class="issue-card-top"><div><strong>PN-'+String(t.ticket_number).padStart(6,'0')+'｜'+esc(main)+'</strong>'+
         '<div class="muted">'+esc(displayDate(t.case_date||t.created_at))+'｜'+esc(t.issue_type||'未分類')+
         '｜次要人：'+esc(t.secondary_person||'—')+'</div></div>'+
         '<div class="issue-badge '+(t.is_completed?'is-done':'')+'">'+esc(label)+'</div></div>'+
         '<div class="issue-description">'+esc(t.description||t.subject)+'</div>'+
         (t.internal_notes?'<div class="issue-note">備註：'+esc(t.internal_notes)+'</div>':'')+
         '<div class="issue-card-bottom"><span class="muted">'+(t.product_code?'貨號 '+esc(t.product_code)+'｜':'')+
         (t.order_reference?'訂單 '+esc(t.order_reference):'')+'</span>'+
         '<button type="button" class="btn secondary" data-issue-edit="'+esc(t.id)+'">查看／修改</button></div></article>';
     }).join('')||'<div class="catalog-empty">目前沒有問題單，請點「＋新增問題單」。</div>')+
     '</div><div id="issueFilterCount" class="muted"></div>';
   function filter(){
     var q=($('issueSearch').value||'').toLowerCase().trim(),status=$('issueStatusFilter').value,
         complete=$('issueCompleteFilter').value,n=0;
     root.querySelectorAll('.issue-list-card').forEach(function(el){
       var show=(!q||el.dataset.issueSearch.includes(q))&&(!status||el.dataset.issueStatus===status)&&
         (complete==='all'||(complete==='done'?el.dataset.issueComplete==='1':el.dataset.issueComplete!=='1'));
       el.hidden=!show;if(show)n++;
     });
     $('issueFilterCount').textContent='符合條件 '+n+' 筆';
   }
   ['issueSearch','issueStatusFilter','issueCompleteFilter'].forEach(function(id){
     $(id).addEventListener(id==='issueSearch'?'input':'change',filter);
   });
   $('issueAdd').onclick=function(){openIssueEditor(null,customers,container).catch(toastError);};
   $('issueReload').onclick=function(){render('admin',container);};
   root.querySelectorAll('[data-issue-edit]').forEach(function(b){b.onclick=function(){
     var ticket=tickets.find(function(t){return t.id===b.dataset.issueEdit;});
     if(ticket)openIssueEditor(ticket,customers,container).catch(toastError);
   };});
   filter();
 }catch(e){root.innerHTML='<div class="message error">讀取待處理問題單失敗：'+esc(e.message)+'</div>';}
}
async function openIssueEditor(current,customers,container){
 var existing=$('issueEditor');if(existing)existing.remove();
 var attachments=[],messages=[];
 if(current){
   var all=await Promise.all([
     api('ng_photos?select=*&ticket_id=eq.'+encodeURIComponent(current.id)+'&deleted_at=is.null&order=created_at.asc'),
     api('ng_messages?select=*&ticket_id=eq.'+encodeURIComponent(current.id)+'&order=created_at.asc')
   ]);
   attachments=all[0]||[];messages=all[1]||[];
 }
 var files=[],busy=false,currentTicket=current||null;
 var overlay=document.createElement('div');overlay.id='issueEditor';overlay.className='catalog-modal';
 overlay.innerHTML='<div class="catalog-modal-card issue-modal-card">'+
   '<div class="catalog-modal-head"><div><h2 id="issueModalTitle">'+(current?'修改待處理問題單 PN-'+String(current.ticket_number).padStart(6,'0'):'新增待處理問題單')+'</h2>'+
   '<p class="muted">本表單僅管理者及員工可使用；照片／影片可拖曳或貼上，儲存後上傳。</p></div>'+
   '<button class="catalog-close" id="issueClose" type="button" aria-label="關閉">×</button></div>'+
   '<div class="issue-form-grid">'+
   '<label>登記日期<input id="issueCaseDate" type="date" value="'+esc(current&&current.case_date||today())+'"></label>'+
   '<label>目前案件狀態<select id="issueStatus">'+issueStatuses.map(function(x){return '<option value="'+x[0]+'" '+((current&&current.status||'new')===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label>'+
   '<label>主要人 <span class="muted">（客戶／聯絡窗口）</span><input id="issuePrimary" maxlength="150" value="'+esc(current&&current.primary_person||'')+'" placeholder="例如 治品-台南倉"></label>'+
   '<label>次要人 <span class="muted">（協辦／供應商）</span><input id="issueSecondary" maxlength="150" value="'+esc(current&&current.secondary_person||'')+'" placeholder="例如 宜羿、360、SC"></label>'+
   '<label>問題類型<input id="issueType" list="issueTypeSuggestions" maxlength="100" value="'+esc(current&&current.issue_type||'NG回報')+'" placeholder="NG回報、訂單貨況、缺貨回報"><datalist id="issueTypeSuggestions">'+issueCategories.map(function(x){return '<option value="'+esc(x)+'"></option>';}).join('')+'</datalist></label>'+
   '<label>關聯客戶 <span class="muted">（選填）</span><select id="issueCustomer"><option value="">不綁定客戶主檔</option>'+
   customers.map(function(c){return '<option value="'+esc(c.id)+'" '+((current&&current.customer_id)===c.id?'selected':'')+'>'+esc(c.customer_code+' '+c.name)+'</option>';}).join('')+'</select></label>'+
   '<label>商品貨號 <span class="muted">（選填）</span><input id="issueProduct" maxlength="120" value="'+esc(current&&current.product_code||'')+'"></label>'+
   '<label>訂單／採購單編號 <span class="muted">（選填）</span><input id="issueOrder" maxlength="150" value="'+esc(current&&current.order_reference||'')+'"></label>'+
   '<label class="span2">問題主旨／摘要<input id="issueSubject" maxlength="180" value="'+esc(current&&current.subject||'')+'" placeholder="簡述要追蹤的事項"></label>'+
   '<label class="span2">問題內容<textarea id="issueDesc" rows="5" maxlength="10000" placeholder="問題內容、商品名稱、數量或缺貨情況">'+esc(current&&current.description||'')+'</textarea></label>'+
   '<label class="span2">備註／處理說明<textarea id="issueNotes" rows="4" maxlength="10000" placeholder="廠商回覆、預計處理方式、補寄或扣款情況">'+esc(current&&current.internal_notes||'')+'</textarea></label>'+
   '<label class="issue-finish-check"><input type="checkbox" id="issueCompleted" '+(current&&current.is_completed?'checked':'')+'> 此案件已完成</label>'+
   '</div>'+
   '<div class="catalog-block"><h3>照片／影片附件</h3>'+
   '<input id="issuePickFiles" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" multiple hidden>'+
   '<div class="issue-dropzone" id="issueDrop" tabindex="0" role="button">'+
   '<strong>將照片或影片拖曳到這裡</strong><span>可拖入多檔，或在視窗貼上複製的圖片（Ctrl+V）</span>'+
   '<button type="button" class="btn secondary" id="issueChooseFiles">選擇照片／影片</button></div>'+
   '<p class="muted">圖片 JPG／PNG／WEBP，每張 10MB 內；影片 MP4／MOV／WebM，每段 30 秒內且 50MB 以下。若 LINE 無法直接拖入，請先存檔或複製圖片再貼上。</p>'+
   '<div id="issuePending" class="issue-media-grid"></div>'+
   '<div id="issueCurrentMedia" class="issue-media-grid"></div></div>'+
   (current?'<div class="catalog-block"><h3>歷史處理進度</h3><div id="issueHistory">'+
      (messages.map(function(m){return '<div class="issue-history-item"><span class="muted">'+esc(time(m.created_at))+'</span><div>'+esc(m.body||'')+'</div></div>';}).join('')||'<p class="muted">尚無處理進度。</p>')+
      '</div><label>新增處理紀錄<textarea id="issueProgress" rows="3" placeholder="選填，儲存時一併記錄" style="width:100%"></textarea></label></div>':'')+
   '<div id="issueEditorMsg" class="message" role="status"></div>'+
   '<div class="issue-actions"><button type="button" id="issueCancel" class="btn ghost">取消</button>'+
   '<button type="button" id="issueSave" class="btn primary">儲存問題單</button></div></div>';
 document.body.appendChild(overlay);
 var picker=$('issuePickFiles'),drop=$('issueDrop'),queue=$('issuePending'),saved=$('issueCurrentMedia'),notice=$('issueEditorMsg');
 function release(){files.forEach(function(x){URL.revokeObjectURL(x.url);});files=[];}
 function close(){if(busy)return;document.removeEventListener('paste',paste);release();overlay.remove();}
 $('issueClose').onclick=close;$('issueCancel').onclick=close;
 function refreshPending(){
   queue.innerHTML=files.map(function(x,i){
     return '<div class="issue-media-item">'+(x.file.type.indexOf('video/')===0?
       '<video controls playsinline preload="metadata" src="'+esc(x.url)+'"></video>':
       '<img alt="'+esc(x.file.name)+'" src="'+esc(x.url)+'">')+
       '<div title="'+esc(x.file.name)+'" class="issue-media-name">'+esc(x.file.name)+'</div>'+
       '<button class="btn ghost" type="button" data-issue-remove="'+i+'">移除</button></div>';
   }).join('');
   queue.querySelectorAll('[data-issue-remove]').forEach(function(b){b.onclick=function(){
     var item=files.splice(Number(b.dataset.issueRemove),1)[0];
     if(item)URL.revokeObjectURL(item.url);refreshPending();
   };});
 }
 function addFiles(list){
   var errs=[],added=0;
   Array.from(list||[]).forEach(function(file){
     if(!file)return;
     if(!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime|webm))$/.test(file.type)){
       errs.push(file.name+': 不支援此格式');return;
     }
     if(file.size>(file.type.indexOf('video/')===0?50:10)*1024*1024){
       errs.push(file.name+': 檔案超過容量上限');return;
     }
     if(files.length>=30){errs.push('一次最多選 30 個檔案');return;}
     if(files.some(function(x){return x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified;}))return;
     files.push({file:file,url:URL.createObjectURL(file)});added++;
   });
   refreshPending();
   notice.className=errs.length?'message error':'message';
   notice.textContent=(added?'已加入 '+added+' 個待上傳檔案。':'')+(errs.length?errs.join('；'):'');
 }
 picker.onchange=function(){addFiles(picker.files);picker.value='';};
 $('issueChooseFiles').onclick=function(e){e.stopPropagation();picker.click();};
 drop.onclick=function(e){if(!e.target.closest('button'))picker.click();};
 drop.onkeydown=function(e){if(e.target===drop&&(e.key==='Enter'||e.key===' ')){e.preventDefault();picker.click();}};
 drop.ondragover=function(e){e.preventDefault();e.dataTransfer.dropEffect='copy';drop.classList.add('dragging');};
 drop.ondragleave=function(e){if(!drop.contains(e.relatedTarget))drop.classList.remove('dragging');};
 drop.ondrop=function(e){e.preventDefault();drop.classList.remove('dragging');var fs=Array.from(e.dataTransfer.files||[]);if(fs.length)addFiles(fs);else{notice.className='message error';notice.textContent='來源未提供可讀取的圖片／影片檔案。請先下載到電腦，或在 LINE 複製圖片再貼上。';}};
 function paste(e){
   if(!overlay.isConnected||!e.clipboardData)return;
   var media=Array.from(e.clipboardData.files||[]).filter(function(f){return /^image\//.test(f.type)||/^video\//.test(f.type);});
   if(!media.length)return;
   e.preventDefault();
   media=media.map(function(f){
     if(f.name&&/\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(f.name))return f;
     var ext=f.type==='image/png'?'png':f.type==='image/webp'?'webp':'jpg';
     return new File([f],'LINE_貼上_'+Date.now()+'.'+ext,{type:f.type});
   });
   addFiles(media);
 }
 document.addEventListener('paste',paste);
 async function drawExisting(){
   if(!attachments.length){saved.innerHTML=currentTicket?'<p class="muted">尚未上傳附件。</p>':'';return;}
   saved.innerHTML='<p class="muted">正在載入已儲存附件…</p>';
   var html=await Promise.all(attachments.map(async function(p){
     var url=await signedPhoto(p.storage_path);
     return '<div class="issue-media-item">'+
       (url?(String(p.mime_type||'').indexOf('video/')===0?
         '<video controls playsinline preload="metadata" src="'+esc(url)+'"></video>':
         '<a target="_blank" rel="noopener noreferrer" href="'+esc(url)+'"><img src="'+esc(url)+'" alt="'+esc(p.filename)+'"></a>'):
         '<div class="catalog-empty">附件暫時無法預覽</div>')+
       '<div class="issue-media-name" title="'+esc(p.filename)+'">'+esc(p.filename)+'</div>'+
       '<button type="button" class="btn ghost" data-issue-hide-media="'+esc(p.id)+'">移除附件</button></div>';
   }));
   saved.innerHTML=html.join('');
   saved.querySelectorAll('[data-issue-hide-media]').forEach(function(b){b.onclick=async function(){
     if(!confirm('從此問題單隱藏附件？原始檔案保留，以免影響歷史紀錄。'))return;
     b.disabled=true;
     try{
       await api('ng_photos?id=eq.'+encodeURIComponent(b.dataset.issueHideMedia),
         {method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({deleted_at:new Date().toISOString()})});
       attachments=attachments.filter(function(x){return x.id!==b.dataset.issueHideMedia;});
       drawExisting();
     }catch(err){alert('移除附件失敗：'+err.message);b.disabled=false;}
   };});
 }
 drawExisting().catch(function(e){saved.textContent='附件讀取失敗：'+e.message;});
 $('issueSave').onclick=async function(){
   if(busy)return;
   var primary=$('issuePrimary').value.trim(),description=$('issueDesc').value.trim(),
       issueType=$('issueType').value.trim(),date=$('issueCaseDate').value;
   if(!primary||!description||!issueType||!date){
     notice.className='message error';notice.textContent='請填寫登記日期、主要人、問題類型及問題內容。';return;
   }
   var completed=$('issueCompleted').checked;
   var values={
     case_date:date,status:$('issueStatus').value,primary_person:primary,
     secondary_person:$('issueSecondary').value.trim()||null,
     issue_type:issueType,customer_id:$('issueCustomer').value||null,
     product_code:$('issueProduct').value.trim()||null,
     order_reference:$('issueOrder').value.trim()||null,
     subject:$('issueSubject').value.trim()||description.slice(0,80),
     description:description,internal_notes:$('issueNotes').value.trim()||null,
     is_completed:completed,completed_at:completed?(currentTicket&&currentTicket.completed_at||new Date().toISOString()):null,
     updated_at:new Date().toISOString()
   };
   busy=true;$('issueSave').disabled=true;$('issueCancel').disabled=true;
   notice.textContent='正在儲存問題單與附件…';notice.className='message';
   var errors=[];
   try{
     // Validate all files before changing the issue record.
     var validated=[];
     for(var o of files)validated.push(await validateMedia(o.file));
     if(currentTicket){
       await api('ng_tickets?id=eq.'+encodeURIComponent(currentTicket.id),
         {method:'PATCH',headers:{'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(values)});
     }else{
       var inserted=await api('ng_tickets',{method:'POST',
          headers:{'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(values)});
       currentTicket=inserted[0];
       $('issueModalTitle').textContent='修改待處理問題單 PN-'+String(currentTicket.ticket_number).padStart(6,'0');
     }
     for(var i=0;i<files.length;){
       var media=files[i];
       try{
         await upload(currentTicket.id,null,media.file,validated[i]);
         URL.revokeObjectURL(media.url);
         files.splice(i,1);validated.splice(i,1);
       }catch(err){errors.push(media.file.name+'：'+err.message);i++;}
     }
     var progress=$('issueProgress')&&$('issueProgress').value.trim();
     if(progress){
       await api('ng_messages',{method:'POST',
         body:JSON.stringify({ticket_id:currentTicket.id,body:progress})});
       $('issueProgress').value='';
     }
     await render('admin',container);
     if(!errors.length){closeAfterSave();return;}
     refreshPending();
     notice.className='message error';
     notice.textContent='問題單已儲存，但以下附件上傳失敗，可再按儲存重試：'+errors.join('；');
   }catch(err){
     notice.className='message error';notice.textContent='儲存失敗：'+err.message;
   }finally{
     busy=false;$('issueSave').disabled=false;$('issueCancel').disabled=false;
   }
 };
 function closeAfterSave(){document.removeEventListener('paste',paste);release();overlay.remove();}
}
window.NGTickets={render:render};
})();
