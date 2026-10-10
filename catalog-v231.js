
(function(){
'use strict';

var CFG=window.APP_CONFIG||{}, SB=CFG.SUPABASE_URL, KEY=CFG.SUPABASE_PUBLISHABLE_KEY;
var state={profile:null,levels:[],vendors:[],customers:[],products:[],images:[],variants:[],adminReady:false,customerReady:false,currentProduct:null};
function $(id){return document.getElementById(id);}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return '$'+Number(v||0).toLocaleString('zh-TW',{minimumFractionDigits:0,maximumFractionDigits:2});}
function sess(){try{return JSON.parse(localStorage.getItem('vendor_order_session')||'null');}catch(e){return null;}}
async function authFetch(url,opt){
  opt=opt||{}; var s=sess();
  var headers=Object.assign({apikey:KEY,Authorization:'Bearer '+((s&&s.access_token)||'')},opt.headers||{});
  return fetch(url,Object.assign({},opt,{headers:headers}));
}
async function rest(path,opt){
  opt=opt||{}; var headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});
  var res=await authFetch(SB+'/rest/v1/'+path,Object.assign({},opt,{headers:headers}));
  var txt=await res.text(); if(!res.ok){var m=txt;try{var d=JSON.parse(txt);m=d.message||d.hint||d.details||txt;}catch(e){} throw new Error(m||('HTTP '+res.status));}
  return txt?JSON.parse(txt):null;
}
async function rpc(name,body){
  return rest('rpc/'+name,{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body||{})});
}
async function edge(body){
  var sv=sess();if(!sv||!sv.access_token)throw new Error('登入已過期');
  var res=await fetch(CFG.ADMIN_API_URL,{method:'POST',headers:{Authorization:'Bearer '+sv.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  var d=await res.json().catch(function(){return {};});if(!res.ok)throw new Error(d.error||d.message||('HTTP '+res.status));return d;
}
function enableCatalogImageZoom(root){
  if(!root)return;
  root.querySelectorAll('img[data-catalog-zoom]').forEach(function(img){
    img.style.cursor='zoom-in';img.title='點擊放大圖片';img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label','放大商品圖片');
    function open(){var old=document.getElementById('catalogZoomOverlay');if(old)old.remove();var layer=document.createElement('div');layer.id='catalogZoomOverlay';layer.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.87);display:flex;align-items:center;justify-content:center;padding:24px;cursor:zoom-out';layer.innerHTML='<button type="button" aria-label="關閉圖片" style="position:absolute;top:16px;right:20px;background:white;color:#17202e;border:0;border-radius:25px;width:42px;height:42px;font-size:25px;cursor:pointer">×</button><img alt="商品圖片放大檢視" style="max-width:95vw;max-height:88vh;object-fit:contain;cursor:default;border-radius:6px">';var large=layer.querySelector('img');large.src=img.currentSrc||img.src;function close(){layer.remove();document.removeEventListener('keydown',escapeKey);}function escapeKey(e){if(e.key==='Escape')close();}layer.addEventListener('click',function(e){if(e.target===layer||e.target.tagName==='BUTTON')close();});document.addEventListener('keydown',escapeKey);document.body.appendChild(layer);}
    img.addEventListener('click',open);img.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  });
}
function publicImage(path){return path?SB+'/storage/v1/object/public/catalog-images/'+path.split('/').map(encodeURIComponent).join('/'):'';}
async function loadProfile(){
  var s=sess(); if(!s||!s.user||!s.user.id)return null;
  var rows=await rest('user_profiles?select=*&user_id=eq.'+encodeURIComponent(s.user.id));
  state.profile=rows&&rows[0]||null; return state.profile;
}
function isManager(){return state.profile&&(state.profile.role==='admin'||state.profile.role==='employee');}
function isCustomer(){return state.profile&&state.profile.role==='customer'&&state.profile.customer_id;}
function saleState(p){
  var now=Date.now(), st=p.sale_start_at?new Date(p.sale_start_at).getTime():null, en=p.sale_end_at?new Date(p.sale_end_at).getTime():null;
  if(st&&now<st)return '尚未開賣'; if(en&&now>en)return '已結單'; return p.sale_mode==='in_stock'?'現貨':'預購';
}
function saleOpen(p){
  var s=saleState(p); return s!=='尚未開賣'&&s!=='已結單'&&p.active&&p.published;
}
function fmtDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'});}catch(e){return v;}}
function firstImage(pid){
  var a=state.images.filter(function(x){return x.product_id===pid;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);});
  return a[0]||null;
}
function getVariants(pid){return state.variants.filter(function(x){return x.product_id===pid&&x.active!==false;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);});}
function btn(text,cls,attrs){return '<button type="button" class="'+(cls||'btn ghost')+'" '+(attrs||'')+'>'+esc(text)+'</button>';}

async function loadCommonAdmin(){
  var rs=await Promise.all([
    rest('customer_levels?select=*&order=sort_order.asc'),
    rest('vendors?select=id,vendor_code,name,active&order=vendor_code.asc'),
    rest('customers?select=id,customer_code,name,active&order=customer_code.asc'),
    rest('catalog_products?select=*&order=created_at.desc'),
    rest('catalog_product_images?select=*&order=sort_order.asc,created_at.asc'),
    rest('catalog_variants?select=*&order=sort_order.asc')
  ]);
  state.levels=rs[0]||[];state.vendors=rs[1]||[];state.customers=rs[2]||[];state.products=rs[3]||[];state.images=rs[4]||[];state.variants=rs[5]||[];
}
async function loadStorefront(){
  var products=await rest('catalog_storefront?select=*&order=created_at.desc');
  state.products=products||[];
  var ids=state.products.map(function(x){return x.id;});
  if(!ids.length){state.images=[];state.variants=[];return;}
  var q='in.('+ids.join(',')+')';
  var rs=await Promise.all([
    rest('catalog_product_images?select=*&product_id='+encodeURIComponent(q)+'&order=sort_order.asc,created_at.asc'),
    rest('catalog_variants?select=*&product_id='+encodeURIComponent(q)+'&active=eq.true&order=sort_order.asc')
  ]);
  state.images=rs[0]||[];state.variants=rs[1]||[];
}

function ensureAdminTab(){
  if($('tab-catalog'))return;
  var nav=document.querySelector('#adminView .tabs'); if(!nav)return;
  var b=document.createElement('button');b.className='tab';b.dataset.tab='catalog';b.textContent='批發商城';nav.appendChild(b);
  var panel=document.createElement('div');panel.id='tab-catalog';panel.className='tab-panel hidden';
  panel.innerHTML='<div class="card section-card"><div class="catalog-head"><div><h2>批發商城</h2><p class="muted">商品指定出貨廠商；價格、權限與購物車以客戶為主。</p></div><button id="catNewProduct" class="btn primary" type="button">＋新增商品</button></div><div class="catalog-subnav"><button class="active" data-cat-admin="products">商品管理</button><button data-cat-admin="customers">客戶資料</button><button data-cat-admin="levels">客戶等級</button><button data-cat-admin="preview">客戶視角預覽</button><button data-cat-admin="requests">客戶採購單</button><button data-cat-admin="ng">NG 問題單</button><button data-cat-admin="sales">銷售報表</button></div><div id="catAdminProducts"></div><div id="catAdminCustomers" class="hidden"></div><div id="catAdminLevels" class="hidden"></div><div id="catAdminPreview" class="hidden"></div><div id="catAdminRequests" class="hidden"></div><div id="catAdminNg" class="hidden"></div><div id="catSalesReport" class="hidden"></div></div>';
  document.querySelector('#adminView').appendChild(panel);
  b.addEventListener('click',function(){
    document.querySelectorAll('#adminView .tab').forEach(function(x){x.classList.toggle('active',x===b);});
    document.querySelectorAll('#adminView .tab-panel').forEach(function(x){x.classList.add('hidden');}); panel.classList.remove('hidden');
    loadAdminCatalog().catch(showErr);
  });
  nav.querySelectorAll('.tab').forEach(function(x){if(x!==b)x.addEventListener('click',function(){panel.classList.add('hidden');});});
  panel.querySelectorAll('[data-cat-admin]').forEach(function(x){x.addEventListener('click',function(){
    panel.querySelectorAll('[data-cat-admin]').forEach(function(z){z.classList.remove('active');});x.classList.add('active');
    $('catAdminProducts').classList.toggle('hidden',x.dataset.catAdmin!=='products');
    $('catAdminCustomers').classList.toggle('hidden',x.dataset.catAdmin!=='customers');
    $('catAdminLevels').classList.toggle('hidden',x.dataset.catAdmin!=='levels');
    $('catAdminPreview').classList.toggle('hidden',x.dataset.catAdmin!=='preview');
    $('catAdminRequests').classList.toggle('hidden',x.dataset.catAdmin!=='requests');
    $('catAdminNg').classList.toggle('hidden',x.dataset.catAdmin!=='ng');
    $('catSalesReport').classList.toggle('hidden',x.dataset.catAdmin!=='sales');
    if(x.dataset.catAdmin==='sales'&&window.CatalogSalesReport)window.CatalogSalesReport.render();
    if(x.dataset.catAdmin==='ng'&&window.NGTickets)window.NGTickets.render('admin','catAdminNg');
    if(x.dataset.catAdmin==='requests')renderAdminPurchaseRequests().catch(showErr);
    if(x.dataset.catAdmin==='preview')renderAdminCustomerPreview().catch(showErr);
    if(x.dataset.catAdmin==='customers')renderCustomerAdmin();
    if(x.dataset.catAdmin==='levels')renderLevelAdmin();
  });});
  $('catNewProduct').addEventListener('click',function(){openProductEditor(null);});
}

var previewData={members:[],prices:[],levelPrices:[],access:[]};
async function renderAdminCustomerPreview(){
  if(!isManager())return;
  var el=$('catAdminPreview');if(!el)return;
  el.innerHTML='<div class="catalog-empty">正在載入客戶視角…</div>';
  var results=await Promise.all([
    rest('customer_level_members?select=customer_id,level_id'),
    rest('catalog_customer_prices?select=product_id,customer_id,price,min_order_qty'),
    rest('catalog_customer_level_prices?select=product_id,level_id,price,min_order_qty'),
    rest('catalog_customer_access?select=product_id,customer_id,level_id')
  ]);
  previewData={members:results[0]||[],prices:results[1]||[],levelPrices:results[2]||[],access:results[3]||[]};
  el.innerHTML='<div class="catalog-block"><h3>客戶視角預覽（唯讀）</h3><p class="muted">選擇客戶，模擬該客戶可見的已上架商品及專屬價格。預覽不會建立購物車或訂單。</p><div class="catalog-toolbar"><select id="catPreviewCustomer" aria-label="選擇預覽客戶">'+state.customers.filter(function(x){return x.active;}).map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.customer_code+' '+x.name)+'</option>';}).join('')+'</select><input id="catPreviewSearch" placeholder="搜尋商品編號或名稱"><select id="catPreviewMode"><option value="">全部商品</option><option value="in_stock">現貨</option><option value="preorder">預購</option></select></div><div id="catPreviewSummary" class="muted"></div><div id="catPreviewGrid" class="catalog-grid"></div></div>';
  $('catPreviewCustomer').onchange=paintAdminCustomerPreview;
  $('catPreviewSearch').oninput=paintAdminCustomerPreview;
  $('catPreviewMode').onchange=paintAdminCustomerPreview;
  paintAdminCustomerPreview();
}
function previewCustomerPrice(p,customerId,levelId){
  var direct=previewData.prices.find(function(x){return x.product_id===p.id&&x.customer_id===customerId;});
  var byLevel=previewData.levelPrices.find(function(x){return x.product_id===p.id&&x.level_id===levelId;});
  return {price:Number(direct?direct.price:byLevel?byLevel.price:p.base_price||0),
    minimum:Number(direct&&direct.min_order_qty!=null?direct.min_order_qty:byLevel&&byLevel.min_order_qty!=null?byLevel.min_order_qty:p.min_order_qty||1)};
}
function paintAdminCustomerPreview(){
  var grid=$('catPreviewGrid');if(!grid)return;
  var customerId=$('catPreviewCustomer').value;
  var customer=state.customers.find(function(x){return x.id===customerId;});
  if(!customer){grid.innerHTML='<div class="catalog-empty">尚無可預覽的客戶。</div>';return;}
  var member=previewData.members.find(function(x){return x.customer_id===customerId;});
  var levelId=member&&member.level_id,level=state.levels.find(function(x){return x.id===levelId;});
  var query=($('catPreviewSearch').value||'').trim().toLowerCase(),mode=$('catPreviewMode').value;
  var visible=state.products.filter(function(p){
    return p.active&&p.published&&(p.visibility_mode==='all'||previewData.access.some(function(a){return a.product_id===p.id&&(a.customer_id===customerId||(levelId&&a.level_id===levelId));}));
  }).filter(function(p){return (!query||(String(p.product_code)+' '+p.name).toLowerCase().includes(query))&&(!mode||p.sale_mode===mode);});
  $('catPreviewSummary').textContent='預覽：'+customer.customer_code+' '+customer.name+'｜'+(level?level.name:'未設定等級')+'｜可見商品 '+visible.length+' 筆';
  grid.innerHTML=visible.map(function(p){
    var im=firstImage(p.id),detail=previewCustomerPrice(p,customerId,levelId),s=saleState(p),open=saleOpen(p);
    return '<div class="catalog-card"><div class="catalog-card-img">'+(im?'<img src="'+esc(publicImage(im.storage_path))+'" alt="">':'<span class="muted">尚無圖片</span>')+'</div><div class="catalog-card-body"><div class="catalog-code">'+esc(p.product_code)+'</div><div class="catalog-name">'+esc(p.name)+'</div><div class="catalog-price">'+money(detail.price)+'</div><div class="catalog-meta"><span class="catalog-pill '+(s==='現貨'?'good':'warn')+'">'+esc(s)+'</span><span class="catalog-pill">最低 '+esc(detail.minimum)+' '+esc(p.order_unit)+'</span>'+(p.sale_end_at?'<span class="catalog-pill">結單 '+esc(fmtDate(p.sale_end_at))+'</span>':'')+'</div><div class="catalog-card-actions"><button type="button" class="btn secondary" data-preview-product="'+esc(p.id)+'">查看商品</button><button type="button" class="btn primary" disabled>'+(open?'預覽不可購買':'不可購買')+'</button></div></div></div>';
  }).join('')||'<div class="catalog-empty">這位客戶目前沒有可見的商品。</div>';
  grid.querySelectorAll('[data-preview-product]').forEach(function(b){b.onclick=function(){openAdminPreviewDetail(b.dataset.previewProduct,customerId,levelId);};});
}
function openAdminPreviewDetail(id,customerId,levelId){
  var p=state.products.find(function(x){return x.id===id;});if(!p)return;
  var old=$('catPreviewModal');if(old)old.remove();
  var d=document.createElement('div');d.id='catPreviewModal';d.className='catalog-modal';
  var imgs=state.images.filter(function(x){return x.product_id===id;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);});
  var variants=getVariants(id),v=previewCustomerPrice(p,customerId,levelId);
  d.innerHTML='<div class="catalog-modal-card"><div class="catalog-modal-head"><h2>'+esc(p.product_code+' '+p.name)+'｜客戶預覽</h2><button class="catalog-close" type="button" data-preview-close>×</button></div><div class="catalog-product-detail"><div><img id="catPreviewMainImage" class="catalog-main-image" src="'+esc(imgs[0]?publicImage(imgs[0].storage_path):'')+'" alt=""><div class="catalog-thumbs">'+imgs.map(function(im){return '<button type="button" data-preview-image="'+esc(im.id)+'"><img src="'+esc(publicImage(im.storage_path))+'" alt=""></button>';}).join('')+'</div></div><div><div class="catalog-price">'+money(v.price)+'</div><div class="catalog-meta"><span class="catalog-pill">'+esc(saleState(p))+'</span><span class="catalog-pill">最低 '+esc(v.minimum)+' '+esc(p.order_unit)+'</span>'+(p.pack_text?'<span class="catalog-pill">'+esc(p.pack_text)+'</span>':'')+'</div><p style="white-space:pre-wrap;line-height:1.7">'+esc(p.description||'')+'</p>'+(p.expected_ship_date?'<p><b>預計出貨：</b>'+esc(p.expected_ship_date)+'</p>':'')+(variants.length?'<label>款式<select id="catPreviewVariant">'+variants.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+(Number(x.price_delta)?'（'+money(v.price+Number(x.price_delta))+'）':'')+'</option>';}).join('')+'</select></label>':'')+'<p class="muted">僅供管理員／員工查看，無法加入購物車或送出訂單。</p></div></div></div>';
  document.body.appendChild(d);
  d.querySelector('[data-preview-close]').onclick=function(){d.remove();};
  d.querySelectorAll('[data-preview-image]').forEach(function(b){b.onclick=function(){var im=imgs.find(function(x){return x.id===b.dataset.previewImage;});if(im)$('catPreviewMainImage').src=publicImage(im.storage_path);};});
}

async function loadAdminCatalog(){
  await loadCommonAdmin(); renderAdminProducts(); state.adminReady=true;
}
function renderAdminProducts(){
  var el=$('catAdminProducts'); if(!el)return;
  var cards=state.products.map(function(p){
    var im=firstImage(p.id), n=state.images.filter(function(x){return x.product_id===p.id;}).length;
    return '<div class="catalog-card"><div class="catalog-card-img">'+(im?'<img src="'+esc(publicImage(im.storage_path))+'" alt="">':'<span class="muted">尚無圖片</span>')+'</div><div class="catalog-card-body"><div class="catalog-code">'+esc(p.product_code)+'</div><div class="catalog-name">'+esc(p.name)+'</div><div class="catalog-price">'+money(p.base_price)+'</div><div class="catalog-meta"><span class="catalog-pill '+(p.published?'good':'warn')+'">'+(p.published?'已上架':'草稿')+'</span><span class="catalog-pill">'+esc(p.sale_mode==='in_stock'?'現貨':'預購')+'</span><span class="catalog-pill">'+n+' 張圖</span><span class="catalog-pill">'+esc(p.visibility_mode==='all'?'全部客戶':'指定販售')+'</span></div><div class="catalog-card-actions">'+btn('編輯','btn secondary','data-cat-edit="'+p.id+'"')+'</div></div></div>';
  }).join('');
  el.innerHTML='<div class="catalog-toolbar"><input id="catAdminSearch" placeholder="搜尋商品編號、名稱"><select id="catAdminMode"><option value="">全部類型</option><option value="in_stock">現貨</option><option value="preorder">預購</option></select><select id="catAdminPub"><option value="">全部狀態</option><option value="1">已上架</option><option value="0">草稿</option></select></div><div id="catAdminGrid" class="catalog-grid">'+(cards||'<div class="catalog-empty">尚未建立商城商品。</div>')+'</div>';
  el.querySelectorAll('[data-cat-edit]').forEach(function(x){x.addEventListener('click',function(){openProductEditor(x.dataset.catEdit);});});
  function filter(){
    var q=($('catAdminSearch').value||'').toLowerCase(),m=$('catAdminMode').value,pub=$('catAdminPub').value;
    el.querySelectorAll('.catalog-card').forEach(function(card,i){
      var p=state.products[i],ok=(!q||((p.product_code+' '+p.name).toLowerCase().indexOf(q)>=0))&&(!m||p.sale_mode===m)&&(!pub||(pub==='1'?p.published:!p.published));
      card.style.display=ok?'':'none';
    });
  }
  $('catAdminSearch').addEventListener('input',filter);$('catAdminMode').addEventListener('change',filter);$('catAdminPub').addEventListener('change',filter);
}
async function renderCustomerAdmin(){
  var el=$('catAdminCustomers');if(!el)return;
  var rs=await Promise.all([
    rest('customer_level_members?select=*'),
    rest('customer_addresses?select=*&active=eq.true&order=is_default.desc,last_used_at.desc'),
    rest('user_profiles?select=user_id,customer_id,login_name,active,role&role=eq.customer')
  ]);
  var members=rs[0]||[],addresses=rs[1]||[],profiles=rs[2]||[],mmap={},pmap={};
  members.forEach(function(x){mmap[x.customer_id]=x.level_id;});profiles.forEach(function(x){pmap[x.customer_id]=x;});
  el.innerHTML='<div class="card inner-card" style="margin-bottom:14px"><h3>＋手動新增客戶</h3><p class="muted">管理員與小幫手可新增，客戶編號 Cxxxx 自動產生；新增後可直接建立登入帳號。</p><div class="catalog-form-grid"><label>客戶名稱（必填）<input id="catNewCustomerName" maxlength="100" placeholder="公司、商店或客戶名稱"></label><label>聯絡人<input id="catNewCustomerContact" placeholder="聯絡人姓名"></label><label>聯絡電話<input id="catNewCustomerPhone" placeholder="電話"></label><label>電子郵件<input id="catNewCustomerEmail" type="email" placeholder="選填"></label><label>收貨人<input id="catNewCustomerReceiver" placeholder="選填"></label><label class="span2">預設收貨地址<input id="catNewCustomerAddress" placeholder="選填；可日後從地址簿新增"></label><label class="span2">備註<input id="catNewCustomerNotes" placeholder="選填"></label></div><button id="catCreateCustomer" type="button" class="btn primary">新增客戶</button><div id="catCreateCustomerMsg" class="message" role="status"></div></div><div class="catalog-toolbar"><input id="catCustomerSearch" placeholder="搜尋客戶編號、名稱、收貨人、地址"><select id="catCustomerLevelFilter"><option value="">全部等級</option>'+state.levels.map(function(l){return '<option value="'+l.id+'">'+esc(l.name)+'</option>';}).join('')+'</select><button id="catCustomerRefresh" class="btn ghost">重新整理</button></div><div id="catCustomerRows"></div>';
  function paint(){
    var q=($('catCustomerSearch').value||'').toLowerCase(),lf=$('catCustomerLevelFilter').value;
    var list=state.customers.filter(function(c){
      var aa=addresses.filter(function(a){return a.customer_id===c.id;}),hay=(c.customer_code+' '+c.name+' '+aa.map(function(a){return (a.receiver_name||'')+' '+(a.phone||'')+' '+(a.address||'');}).join(' ')).toLowerCase();
      return (!q||hay.indexOf(q)>=0)&&(!lf||mmap[c.id]===lf);
    });
    $('catCustomerRows').innerHTML=list.map(function(c){
      var aa=addresses.filter(function(a){return a.customer_id===c.id;}),def=aa.find(function(a){return a.is_default;})||aa[0],pr=pmap[c.id];
      return '<div class="catalog-myorder"><div class="catalog-head"><div><b>'+esc(c.customer_code)+' '+esc(c.name)+'</b><div class="muted">'+aa.length+' 組收貨資料'+(def?'｜預設：'+esc(def.receiver_name||'')+' '+esc(def.address||''):'')+'</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><select data-customer-level="'+c.id+'">'+state.levels.map(function(l){return '<option value="'+l.id+'" '+(mmap[c.id]===l.id?'selected':'')+'>'+esc(l.name)+'</option>';}).join('')+'</select><button class="btn ghost" data-customer-addresses="'+c.id+'">地址簿</button><button class="btn secondary" data-customer-account="'+c.id+'">'+(pr?'重設帳號':'建立帳號')+'</button></div></div></div>';
    }).join('')||'<div class="catalog-empty">沒有符合的客戶。</div>';
    $('catCustomerRows').querySelectorAll('[data-customer-level]').forEach(function(x){x.onchange=async function(){await rest('customer_level_members?on_conflict=customer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_id:x.dataset.customerLevel,level_id:x.value,updated_at:new Date().toISOString()})});mmap[x.dataset.customerLevel]=x.value;};});
    $('catCustomerRows').querySelectorAll('[data-customer-addresses]').forEach(function(x){x.onclick=function(){openCustomerAddresses(x.dataset.customerAddresses,addresses);};});
    $('catCustomerRows').querySelectorAll('[data-customer-account]').forEach(function(x){x.onclick=async function(){x.disabled=true;try{var d=await edge({action:'customer_account',customer_id:x.dataset.customerAccount});alert('客戶帳號：'+d.username+'\n初始/重設密碼：'+d.password+'\n首次登入後請修改密碼。');await renderCustomerAdmin();}catch(e){alert('帳號處理失敗：'+e.message);}finally{x.disabled=false;}};});
  }
  $('catCreateCustomer').onclick=async function(){
    var b=this,m=$('catCreateCustomerMsg'),name=$('catNewCustomerName').value.trim();
    if(!name){m.textContent='請先填寫客戶名稱';return;}
    try{
      b.disabled=true;m.textContent='正在新增客戶…';
      var data=await edge({action:'customer_create',name:name,contact_name:$('catNewCustomerContact').value.trim(),phone:$('catNewCustomerPhone').value.trim(),email:$('catNewCustomerEmail').value.trim(),receiver_name:$('catNewCustomerReceiver').value.trim(),address:$('catNewCustomerAddress').value.trim(),notes:$('catNewCustomerNotes').value.trim()});
      await loadCommonAdmin();await renderCustomerAdmin();
      var notice=$('catCreateCustomerMsg');
      if(notice)notice.textContent='已建立 '+data.customer.customer_code+' '+data.customer.name+'。可從下方清單點選「建立帳號」。'+(data.warning?' 注意：'+data.warning:'');
    }catch(e){m.textContent='新增失敗：'+e.message;}
    finally{b.disabled=false;}
  };
  paint();$('catCustomerSearch').oninput=paint;$('catCustomerLevelFilter').onchange=paint;$('catCustomerRefresh').onclick=renderCustomerAdmin;
}
function openCustomerAddresses(customerId,addresses){
  var c=state.customers.find(function(x){return x.id===customerId;}),list=addresses.filter(function(a){return a.customer_id===customerId;});
  var old=$('catAddressAdminModal');if(old)old.remove();
  var d=document.createElement('div');d.id='catAddressAdminModal';d.className='catalog-modal';d.innerHTML='<div class="catalog-modal-card"><div class="catalog-modal-head"><h2>'+esc(c?c.customer_code+' '+c.name:'客戶地址簿')+'</h2><button class="catalog-close" data-close>×</button></div><div>'+list.map(function(a){return '<div class="catalog-myorder"><b>'+(a.is_default?'★ ':'')+esc(a.receiver_name||'未填收貨人')+'</b><div>'+esc(a.phone||'')+'</div><div>'+esc(a.address||'')+'</div><div class="muted">歷史訂單 '+esc(a.source_order_count||0)+' 筆</div></div>';}).join('')+'</div></div>';document.body.appendChild(d);d.querySelector('[data-close]').onclick=function(){d.remove();};
}
async function renderLevelAdmin(){
  var el=$('catAdminLevels'); if(!el)return;
  var members=await rest('customer_level_members?select=*');
  var mmap={};(members||[]).forEach(function(x){mmap[x.customer_id]=x.level_id;});
  el.innerHTML='<div class="catalog-head"><h3>客戶等級與最低結帳金額</h3><button id="catAddLevel" class="btn secondary">新增等級</button></div><div id="catLevelRows" class="catalog-level-admin"></div><div class="catalog-block"><h3>客戶等級分配</h3><div class="catalog-vendor-levels">'+state.customers.filter(function(v){return v.active;}).map(function(v){return '<div class="catalog-vendor-level-card"><b>'+esc(v.customer_code)+' '+esc(v.name)+'</b><select data-cat-clevel="'+v.id+'" style="width:100%;margin-top:7px">'+state.levels.map(function(l){return '<option value="'+l.id+'" '+(mmap[v.id]===l.id?'selected':'')+'>'+esc(l.name)+'</option>';}).join('')+'</select></div>';}).join('')+'</div></div>';
  function paintRows(){
    $('catLevelRows').innerHTML=state.levels.map(function(l){return '<div class="catalog-level-row" data-level-row="'+l.id+'"><label>代碼<input data-f="code" value="'+esc(l.code)+'"></label><label>名稱<input data-f="name" value="'+esc(l.name)+'"></label><label>最低結帳金額<input data-f="min_order_amount" type="number" min="0" value="'+esc(l.min_order_amount)+'"></label><button class="btn primary" data-save-level="'+l.id+'">儲存</button></div>';}).join('');
    $('catLevelRows').querySelectorAll('[data-save-level]').forEach(function(b){b.addEventListener('click',async function(){
      var row=b.closest('[data-level-row]'),id=b.dataset.saveLevel;
      await rest('customer_levels?id=eq.'+id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({code:row.querySelector('[data-f=code]').value.trim(),name:row.querySelector('[data-f=name]').value.trim(),min_order_amount:Number(row.querySelector('[data-f=min_order_amount]').value||0),updated_at:new Date().toISOString()})});
      b.textContent='已儲存';setTimeout(function(){b.textContent='儲存';},900);await loadCommonAdmin();
    });});
  }
  paintRows();
  $('catAddLevel').addEventListener('click',async function(){
    var code=prompt('等級代碼，例如 B');if(!code)return;var name=prompt('等級名稱，例如 B級')||code;
    await rest('customer_levels',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({code:code.trim().toUpperCase(),name:name.trim(),min_order_amount:0,sort_order:state.levels.length*10+40})});
    await loadCommonAdmin();renderLevelAdmin();
  });
  el.querySelectorAll('[data-cat-clevel]').forEach(function(x){x.addEventListener('change',async function(){
    await rest('customer_level_members?on_conflict=customer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_id:x.dataset.catClevel,level_id:x.value,updated_at:new Date().toISOString()})});
  });});
}
function ensureProductModal(){
  if($('catProductModal'))return;
  var d=document.createElement('div');d.id='catProductModal';d.className='catalog-modal hidden';
  d.innerHTML='<div class="catalog-modal-card"><div class="catalog-modal-head"><div><h2 id="catProductTitle">新增商品</h2><div class="muted">員工/管理員可刊登；圖片保留原始檔供廠商下載。</div></div><button class="catalog-close" data-cat-close>×</button></div><div id="catProductBody"></div><div id="catProductMsg" class="message"></div><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn ghost" data-cat-close>取消</button><button id="catSaveProduct" class="btn primary">儲存商品</button></div></div>';
  document.body.appendChild(d);d.querySelectorAll('[data-cat-close]').forEach(function(x){x.addEventListener('click',function(){d.classList.add('hidden');});});$('catSaveProduct').addEventListener('click',saveProduct);
}
async function openProductEditor(id){
  ensureProductModal();state.currentProduct=id?state.products.find(function(x){return x.id===id;}):null;
  var p=state.currentProduct||{sale_mode:'preorder',base_price:0,min_order_qty:1,order_unit:'件',visibility_mode:'all',published:false,active:true};
  var rs=id?await Promise.all([
    rest('catalog_customer_level_prices?select=*&product_id=eq.'+id),
    rest('catalog_customer_prices?select=*&product_id=eq.'+id),
    rest('catalog_customer_access?select=*&product_id=eq.'+id)
  ]):[[],[],[]];
  var lp=rs[0]||[],vp=rs[1]||[],ac=rs[2]||[];
  $('catProductTitle').textContent=id?'編輯商品 '+p.product_code:'新增商品';
  $('catProductBody').innerHTML='<div class="catalog-form-grid">'+
    '<label>商品編號<input id="catPCode" maxlength="30" value="'+esc(p.product_code||'')+'"></label>'+
    '<label class="span2">商品名稱<input id="catPName" value="'+esc(p.name||'')+'"></label>'+
    '<label>出貨方<select id="catPFulfill">'+state.vendors.filter(function(v){return v.active;}).map(function(v){return '<option value="'+v.id+'" '+((p.fulfillment_vendor_id||(!id?'ba4326fc-b7a4-4b87-a16c-316c0f121eec':null))===v.id?'selected':'')+'>'+esc(v.vendor_code+' '+v.name)+'</option>';}).join('')+'</select></label>'+
    '<label>販售模式<select id="catPMode"><option value="preorder" '+(p.sale_mode==='preorder'?'selected':'')+'>預購</option><option value="in_stock" '+(p.sale_mode==='in_stock'?'selected':'')+'>現貨</option></select></label>'+
    '<label>一般批發價<input id="catPBase" type="number" min="0" step="0.01" value="'+esc(p.base_price||0)+'"></label>'+
    '<label>最低訂購量<input id="catPMin" type="number" min="0.01" step="any" value="'+esc(p.min_order_qty||1)+'"></label>'+
    '<label>單位<input id="catPUnit" value="'+esc(p.order_unit||'件')+'"></label>'+
    '<label>包裝/箱入<input id="catPPack" value="'+esc(p.pack_text||'')+'" placeholder="例如 36罐/箱"></label>'+
    '<label>開賣時間<input id="catPStart" type="datetime-local" value="'+esc(toLocalInput(p.sale_start_at))+'"></label>'+
    '<label>結單時間<input id="catPEnd" type="datetime-local" value="'+esc(toLocalInput(p.sale_end_at))+'"></label>'+
    '<label>預計出貨日<input id="catPShip" type="date" value="'+esc(p.expected_ship_date||'')+'"></label>'+
    '<label>販售對象<select id="catPVisibility"><option value="all" '+(p.visibility_mode==='all'?'selected':'')+'>全部客戶</option><option value="restricted" '+(p.visibility_mode==='restricted'?'selected':'')+'>指定等級/客戶</option></select></label>'+
    '<label><input id="catPPublished" type="checkbox" '+(p.published?'checked':'')+' style="width:auto"> 立即上架</label>'+
    '<label><input id="catPActive" type="checkbox" '+(p.active!==false?'checked':'')+' style="width:auto"> 商品啟用</label>'+
    '<label class="full">商品文案<textarea id="catPDesc">'+esc(p.description||'')+'</textarea></label>'+
    '</div>'+
    '<div class="catalog-block"><h3>等級價格</h3><div class="catalog-level-prices">'+state.levels.map(function(l){var x=lp.find(function(z){return z.level_id===l.id;});return '<label>'+esc(l.name)+' 價<input data-cat-level-price="'+l.id+'" type="number" min="0" step="0.01" value="'+(x?esc(x.price):'')+'" placeholder="空白＝一般批發價"></label>';}).join('')+'</div></div>'+
    '<div class="catalog-block"><div class="catalog-head"><h3>客戶專屬價</h3><button id="catAddVendorPrice" class="btn secondary" type="button">＋新增</button></div><div id="catVendorPriceRows">'+vp.map(vendorPriceRow).join('')+'</div></div>'+
    '<div class="catalog-block"><h3>指定販售對象</h3><p class="muted">販售對象選「指定等級/客戶」時才生效。</p><b>等級</b><div class="catalog-checkbox-list">'+state.levels.map(function(l){return '<label><input type="checkbox" data-cat-access-level="'+l.id+'" '+(ac.some(function(a){return a.level_id===l.id;})?'checked':'')+'> '+esc(l.name)+'</label>';}).join('')+'</div><b style="display:block;margin-top:10px">個別客戶</b><div class="catalog-checkbox-list">'+state.customers.filter(function(v){return v.active;}).map(function(v){return '<label><input type="checkbox" data-cat-access-customer="'+v.id+'" '+(ac.some(function(a){return a.customer_id===v.id;})?'checked':'')+'> '+esc(v.customer_code+' '+v.name)+'</label>';}).join('')+'</div></div>'+
    '<div class="catalog-block"><h3>多層規格組合</h3><p class="muted">每行一層規格，例如：尺寸｜單人,雙人 或 顏色｜白色,灰色。最多三層，產生後可在下方逐筆修改規格編號、加價及最低量。</p><textarea id="catPDimensions" style="width:100%;min-height:85px" placeholder="尺寸｜單人,雙人\n顏色｜白色,灰色"></textarea><button id="catGenerateVariants" type="button" class="btn secondary">產生全部規格組合</button><div id="catDimensionMsg" class="muted"></div></div>'+ 
    '<div class="catalog-block"><h3>商品規格明細</h3><p class="muted">每行：規格編號｜規格名稱｜加價｜最低訂購量｜銷售狀態；多層規格名稱以「尺寸：單人／顏色：白色」保存。狀態請填 available（正常銷售）、out_of_stock（暫時缺貨）、discontinued（已停售）。已有規格可繼續修改，停售不影響歷史訂單。</p><textarea id="catPVariants" style="width:100%;min-height:110px">'+esc(variantsText(id))+'</textarea></div>'+
    '<div class="catalog-block"><h3>商品圖片（可多張）</h3><input id="catPImages" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple><div class="muted" style="margin:6px 0">每張上限 20MB；下載時保留原始上傳檔。</div><div id="catExistingImages" class="catalog-image-list">'+renderImageAdmin(id)+'</div></div>';
  $('catAddVendorPrice').addEventListener('click',function(){$('catVendorPriceRows').insertAdjacentHTML('beforeend',vendorPriceRow(null));bindVendorPriceRemove();});
  $('catGenerateVariants').onclick=function(){
    try{
      var lines=$('catPDimensions').value.split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean);
      if(!lines.length||lines.length>3)throw new Error('請輸入 1～3 層規格');
      var dimensions=lines.map(function(line){
        var cut=line.indexOf('｜');if(cut<0)cut=line.indexOf('|');
        if(cut<1)throw new Error('規格格式：尺寸｜單人,雙人');
        var title=line.slice(0,cut).trim(),vals=line.slice(cut+1).split(/[,，、]/).map(function(x){return x.trim();}).filter(Boolean);
        if(!vals.length||new Set(vals).size!==vals.length)throw new Error(title+' 選項為空或重複');
        return {name:title,values:vals};
      });
      if(new Set(dimensions.map(function(x){return x.name;})).size!==dimensions.length)throw new Error('規格層名稱不得重複');
      var combos=[[]];dimensions.forEach(function(d){var next=[];combos.forEach(function(c){d.values.forEach(function(v){next.push(c.concat([{name:d.name,value:v}]));});});combos=next;});
      if(combos.length>150)throw new Error('最多產生 150 組商品規格，請減少選項');
      var existing=parseVariants($('catPVariants').value);
      var existingNames=new Map(existing.map(function(x){return [x.name,x];}));
      var base=($('catPCode').value.trim()||'SKU').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,20);
      var rows=combos.map(function(c,i){var name=c.map(function(x){return x.name+'：'+x.value;}).join('／'),old=existingNames.get(name);return [old&&old.sku_code||base+'-'+String(i+1).padStart(3,'0'),name,old?old.price_delta:0,old&&old.min_order_qty!=null?old.min_order_qty:'',old&&old.sale_status?old.sale_status:'available'].join('｜');});
      var ta=$('catPVariants');if(ta.value.trim()&&!confirm('將以產生的組合取代下方商品規格明細；同名組合會保留原本加價與最低量。確定繼續？'))return;
      ta.value=rows.join('\n');$('catDimensionMsg').textContent='已產生 '+rows.length+' 組商品規格，請確認後按「儲存商品」';
    }catch(e){$('catDimensionMsg').textContent='無法產生：'+e.message;}
  };
  bindVendorPriceRemove();bindImageAdmin();
  $('catProductModal').classList.remove('hidden');
}
function toLocalInput(v){if(!v)return '';var d=new Date(v),off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16);}
function variantsText(id){return state.variants.filter(function(v){return v.product_id===id;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);}).map(function(v){return [v.sku_code||'',v.name||'',v.price_delta||0,v.min_order_qty||'',v.sale_status||(v.active===false?'discontinued':'available')].join('｜');}).join('\n');}
function vendorPriceRow(x){
  x=x||{};return '<div class="catalog-vendor-price-row"><label class="wide">客戶<select data-vp-customer>'+state.customers.filter(function(v){return v.active;}).map(function(v){return '<option value="'+v.id+'" '+(x.customer_id===v.id?'selected':'')+'>'+esc(v.customer_code+' '+v.name)+'</option>';}).join('')+'</select></label><label>專屬價<input data-vp-price type="number" min="0" step="0.01" value="'+(x.price!=null?esc(x.price):'')+'"></label><label>最低量<input data-vp-min type="number" min="0" step="any" value="'+(x.min_order_qty!=null?esc(x.min_order_qty):'')+'"></label><button type="button" class="btn ghost" data-vp-remove>移除</button></div>';
}
function bindVendorPriceRemove(){$('catVendorPriceRows').querySelectorAll('[data-vp-remove]').forEach(function(b){b.onclick=function(){b.closest('.catalog-vendor-price-row').remove();};});}
function renderImageAdmin(id){
  if(!id)return '';return state.images.filter(function(x){return x.product_id===id;}).map(function(im){return '<div class="catalog-image-item" data-img="'+im.id+'"><img src="'+esc(publicImage(im.storage_path))+'"><div title="'+esc(im.original_filename)+'" style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(im.original_filename)+'</div><div class="catalog-image-actions"><button class="btn ghost" data-img-dl="'+im.id+'">原圖</button><button class="btn ghost" data-img-del="'+im.id+'">刪除</button></div></div>';}).join('');
}
function bindImageAdmin(){
  $('catExistingImages').querySelectorAll('[data-img-dl]').forEach(function(b){b.onclick=function(){var im=state.images.find(function(x){return x.id===b.dataset.imgDl;});if(im)downloadImage(im);};});
  $('catExistingImages').querySelectorAll('[data-img-del]').forEach(function(b){b.onclick=async function(){var im=state.images.find(function(x){return x.id===b.dataset.imgDel;});if(!im||!confirm('刪除這張圖片？'))return;await deleteImage(im);state.images=state.images.filter(function(x){return x.id!==im.id;});b.closest('.catalog-image-item').remove();};});
}
async function deleteImage(im){
  var path=im.storage_path.split('/').map(encodeURIComponent).join('/');
  var res=await authFetch(SB+'/storage/v1/object/catalog-images/'+path,{method:'DELETE'});
  if(!res.ok&&res.status!==404){var t=await res.text();throw new Error(t||'圖片刪除失敗');}
  await rest('catalog_product_images?id=eq.'+im.id,{method:'DELETE'});
}
function parseVariants(txt){
  return String(txt||'').split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean).map(function(line,i){
    var a=line.split(/[｜|]/).map(function(x){return x.trim();});
    if(a.length===1)return {sku_code:null,name:a[0],price_delta:0,min_order_qty:null,sort_order:i+1,sale_status:'available',active:true};
    var status=a[4]||'available';if(!['available','out_of_stock','discontinued'].includes(status))throw new Error('規格 '+(a[1]||a[0])+' 的銷售狀態不正確');return {sku_code:a[0]||null,name:a[1]||a[0],price_delta:Number(a[2]||0),min_order_qty:a[3]?Number(a[3]):null,sort_order:i+1,sale_status:status,active:status==='available'};
  });
}
async function saveProduct(){
  var msg=$('catProductMsg'),save=$('catSaveProduct');save.disabled=true;save.textContent='儲存中…';msg.textContent='';
  try{
    var payload={product_code:$('catPCode').value.trim(),name:$('catPName').value.trim(),description:$('catPDesc').value.trim()||null,fulfillment_vendor_id:$('catPFulfill').value,sale_mode:$('catPMode').value,base_price:Number($('catPBase').value||0),min_order_qty:Number($('catPMin').value||1),order_unit:$('catPUnit').value.trim()||'件',pack_text:$('catPPack').value.trim()||null,sale_start_at:$('catPStart').value?new Date($('catPStart').value).toISOString():null,sale_end_at:$('catPEnd').value?new Date($('catPEnd').value).toISOString():null,expected_ship_date:$('catPShip').value||null,visibility_mode:$('catPVisibility').value,published:$('catPPublished').checked,active:$('catPActive').checked,updated_at:new Date().toISOString()};
    if(!payload.product_code||!payload.name)throw new Error('商品編號與商品名稱必填');
    var pid;
    if(state.currentProduct){
      await rest('catalog_products?id=eq.'+state.currentProduct.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)});pid=state.currentProduct.id;
    }else{
      payload.created_by=sess().user.id;var rr=await rest('catalog_products',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});pid=rr[0].id;
    }
    // 保留已被採購單、訂單或購物車引用的規格 ID；不得整批刪除再新增。
    var desired=parseVariants($('catPVariants').value);
    var existing=state.currentProduct?await rest('catalog_variants?select=*&product_id=eq.'+pid):[];
    var used=new Set(),toInsert=[];
    for(var vi=0;vi<desired.length;vi++){
      var v=desired[vi];
      var match=existing.find(function(e){return !used.has(e.id)&&v.sku_code&&e.sku_code===v.sku_code;})||
        existing.find(function(e){return !used.has(e.id)&&e.name===v.name;});
      if(match){
        used.add(match.id);
        await rest('catalog_variants?id=eq.'+match.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(v)});
      }else toInsert.push(Object.assign({product_id:pid},v));
    }
    if(toInsert.length)await rest('catalog_variants',{method:'POST',body:JSON.stringify(toInsert)});
    for(var ex of existing){
      if(!used.has(ex.id)&&ex.sale_status!=='discontinued')
        await rest('catalog_variants?id=eq.'+ex.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({sale_status:'discontinued',active:false})});
    }
    await Promise.all([
      rest('catalog_customer_level_prices?product_id=eq.'+pid,{method:'DELETE'}),
      rest('catalog_customer_prices?product_id=eq.'+pid,{method:'DELETE'}),
      rest('catalog_customer_access?product_id=eq.'+pid,{method:'DELETE'})
    ]);

    var lps=[];document.querySelectorAll('[data-cat-level-price]').forEach(function(inp){if(inp.value!=='')lps.push({product_id:pid,level_id:inp.dataset.catLevelPrice,price:Number(inp.value)});});if(lps.length)await rest('catalog_customer_level_prices',{method:'POST',body:JSON.stringify(lps)});
    var vps=[];document.querySelectorAll('#catVendorPriceRows .catalog-vendor-price-row').forEach(function(r){var p=r.querySelector('[data-vp-price]').value;if(p!=='')vps.push({product_id:pid,customer_id:r.querySelector('[data-vp-customer]').value,price:Number(p),min_order_qty:r.querySelector('[data-vp-min]').value?Number(r.querySelector('[data-vp-min]').value):null});});if(vps.length)await rest('catalog_customer_prices',{method:'POST',body:JSON.stringify(vps)});
    if(payload.visibility_mode==='restricted'){
      var acc=[];document.querySelectorAll('[data-cat-access-level]:checked').forEach(function(x){acc.push({product_id:pid,level_id:x.dataset.catAccessLevel});});document.querySelectorAll('[data-cat-access-customer]:checked').forEach(function(x){acc.push({product_id:pid,customer_id:x.dataset.catAccessCustomer});});if(acc.length)await rest('catalog_customer_access',{method:'POST',body:JSON.stringify(acc)});
    }
    var files=Array.from($('catPImages').files||[]);for(var i=0;i<files.length;i++)await uploadImage(pid,files[i],i);
    msg.textContent='儲存完成';msg.className='message success';await loadCommonAdmin();renderAdminProducts();setTimeout(function(){$('catProductModal').classList.add('hidden');},500);
  }catch(e){msg.textContent='儲存失敗：'+e.message;msg.className='message error';}
  finally{save.disabled=false;save.textContent='儲存商品';}
}
async function uploadImage(pid,file,idx){
  if(file.size>20*1024*1024)throw new Error(file.name+' 超過 20MB');
  var safe=file.name.replace(/[^A-Za-z0-9._-]+/g,'_'),path=pid+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safe;
  var res=await authFetch(SB+'/storage/v1/object/catalog-images/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});
  if(!res.ok)throw new Error(file.name+' 上傳失敗：'+await res.text());
  await rest('catalog_product_images',{method:'POST',body:JSON.stringify({product_id:pid,storage_path:path,original_filename:file.name,mime_type:file.type||null,file_size_bytes:file.size,sort_order:(state.images.filter(function(x){return x.product_id===pid;}).length+idx+1),created_by:sess().user.id})});
}

function ensureCustomerUI(){
  if($('catalogCustomerNav'))return;
  var view=$('customerView'),card=view&&view.querySelector('.card.section-card');if(!card)return;
  var nav=document.createElement('div');nav.id='catalogCustomerNav';nav.className='catalog-vendor-nav';nav.innerHTML='<button class="active" data-cat-ctab="store">批發賣場</button><button data-cat-ctab="cart">購物車 <span id="catCartCount"></span></button><button data-cat-ctab="purchases">我的採購</button><button data-cat-ctab="addresses">收貨資料</button><button data-cat-ctab="password">修改密碼</button><button data-cat-ctab="ng">NG 商品反應</button>';
  card.insertBefore(nav,card.firstChild);
  var wrap=document.createElement('div');wrap.id='catalogCustomerArea';card.appendChild(wrap);
  nav.querySelectorAll('[data-cat-ctab]').forEach(function(b){b.addEventListener('click',function(){switchCustomerTab(b.dataset.catCtab,b);});});
  switchCustomerTab('store',nav.querySelector('[data-cat-ctab=store]'));
}
async function switchCustomerTab(tab,b){
  document.querySelectorAll('#catalogCustomerNav button').forEach(function(x){x.classList.toggle('active',x===b);});
  if(tab==='store')await renderStore();if(tab==='cart')await renderCart();if(tab==='purchases')await renderPurchases();if(tab==='addresses')await renderCustomerAddresses();if(tab==='password')renderCustomerPassword();if(tab==='ng'&&window.NGTickets)window.NGTickets.render('customer','catalogCustomerArea');
}
async function renderStore(){
  var area=$('catalogCustomerArea');area.innerHTML='<div class="catalog-empty">載入商品中…</div>';await loadStorefront();
  area.innerHTML='<div class="catalog-store-wrap"><div class="catalog-store-toolbar"><input id="catStoreSearch" placeholder="搜尋商品編號、名稱"><select id="catStoreMode"><option value="">全部</option><option value="in_stock">現貨</option><option value="preorder">預購</option></select><button id="catRefreshStore" class="btn ghost">重新整理</button></div><div id="catStoreGrid" class="catalog-grid"></div></div>';paintStore();
  $('catStoreSearch').addEventListener('input',paintStore);$('catStoreMode').addEventListener('change',paintStore);$('catRefreshStore').addEventListener('click',renderStore);
}
function paintStore(){
  var grid=$('catStoreGrid');if(!grid)return;var q=($('catStoreSearch').value||'').toLowerCase(),mode=$('catStoreMode').value;
  var list=state.products.filter(function(p){return (!q||(p.product_code+' '+p.name).toLowerCase().indexOf(q)>=0)&&(!mode||p.sale_mode===mode);});
  grid.innerHTML=list.map(function(p){var im=firstImage(p.id),s=saleState(p),open=saleOpen(p);return '<div class="catalog-card" data-store-product="'+p.id+'"><div class="catalog-card-img">'+(im?'<img src="'+esc(publicImage(im.storage_path))+'">':'<span class="muted">尚無圖片</span>')+'</div><div class="catalog-card-body"><div class="catalog-code">'+esc(p.product_code)+'</div><div class="catalog-name">'+esc(p.name)+'</div><div class="catalog-price">'+money(p.effective_price)+'</div><div class="catalog-meta"><span class="catalog-pill '+(s==='現貨'?'good':'warn')+'">'+esc(s)+'</span><span class="catalog-pill">最低 '+esc(p.effective_min_order_qty)+' '+esc(p.order_unit)+'</span>'+(p.sale_end_at?'<span class="catalog-pill">結單 '+esc(fmtDate(p.sale_end_at))+'</span>':'')+'</div><div class="catalog-card-actions"><button class="btn secondary" data-store-view="'+p.id+'">查看商品</button><button class="btn primary" data-store-quick="'+p.id+'" '+(open?'':'disabled')+'>加入購物車</button></div></div></div>';}).join('')||'<div class="catalog-empty">目前沒有可購買商品。</div>';
  grid.querySelectorAll('[data-store-view]').forEach(function(b){b.onclick=function(){openStoreDetail(b.dataset.storeView);};});
  grid.querySelectorAll('[data-store-quick]').forEach(function(b){b.onclick=function(){openStoreDetail(b.dataset.storeQuick,true);};});
}
function ensureStoreModal(){
  if($('catStoreModal'))return;var d=document.createElement('div');d.id='catStoreModal';d.className='catalog-modal hidden';d.innerHTML='<div class="catalog-modal-card"><div class="catalog-modal-head"><h2 id="catStoreTitle">商品</h2><button class="catalog-close" data-store-close>×</button></div><div id="catStoreDetail"></div></div>';document.body.appendChild(d);d.querySelector('[data-store-close]').onclick=function(){d.classList.add('hidden');};
}
function openStoreDetail(id,focusQty){
  ensureStoreModal();var p=state.products.find(function(x){return x.id===id;});if(!p)return;var imgs=state.images.filter(function(x){return x.product_id===id;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);}),vars=getVariants(id),main=imgs[0];
  $('catStoreTitle').textContent=p.product_code+' '+p.name;
  $('catStoreDetail').innerHTML='<div class="catalog-product-detail"><div><img id="catMainImg" class="catalog-main-image" src="'+esc(main?publicImage(main.storage_path):'')+'">'+(imgs.length?'<div class="catalog-thumbs">'+imgs.map(function(im){return '<button data-thumb="'+im.id+'"><img src="'+esc(publicImage(im.storage_path))+'"></button>';}).join('')+'</div><div class="catalog-download-row"><button id="catDownloadCurrent" class="btn ghost">下載目前原圖</button><button id="catDownloadAll" class="btn secondary">下載全部原圖 ('+imgs.length+')</button></div>':'<div class="catalog-empty">尚無商品圖片</div>')+'</div><div><div class="catalog-price">'+money(p.effective_price)+'</div><div class="catalog-meta"><span class="catalog-pill">'+esc(saleState(p))+'</span><span class="catalog-pill">最低 '+esc(p.effective_min_order_qty)+' '+esc(p.order_unit)+'</span>'+(p.pack_text?'<span class="catalog-pill">'+esc(p.pack_text)+'</span>':'')+'</div><p style="white-space:pre-wrap;line-height:1.7">'+esc(p.description||'')+'</p>'+(p.expected_ship_date?'<p><b>預計出貨：</b>'+esc(p.expected_ship_date)+'</p>':'')+(vars.length?'<label>款式<select id="catBuyVariant" style="width:100%;margin-top:5px">'+vars.map(function(v){return '<option value="'+v.id+'" data-delta="'+v.price_delta+'" data-min="'+(v.min_order_qty||'')+'">'+esc(v.name)+(Number(v.price_delta)?'（'+(Number(v.price_delta)>0?'+':'')+money(v.price_delta)+'）':'')+'</option>';}).join('')+'</select></label>':'')+'<label style="display:block;margin-top:10px">數量<input id="catBuyQty" type="number" min="'+esc(p.effective_min_order_qty)+'" step="any" value="'+esc(p.effective_min_order_qty)+'" style="width:100%;margin-top:5px"></label><button id="catAddCart" class="btn primary wide" style="margin-top:12px" '+(saleOpen(p)?'':'disabled')+'>加入購物車</button><div id="catStoreMsg" class="message"></div></div></div>';
  var selected=main;
  document.querySelectorAll('[data-thumb]').forEach(function(b){b.onclick=function(){selected=imgs.find(function(x){return x.id===b.dataset.thumb;});$('catMainImg').src=publicImage(selected.storage_path);};});
  if($('catDownloadCurrent'))$('catDownloadCurrent').onclick=function(){if(selected)downloadImage(selected);};
  if($('catDownloadAll'))$('catDownloadAll').onclick=async function(){for(var i=0;i<imgs.length;i++){await downloadImage(imgs[i]);await new Promise(function(r){setTimeout(r,250);});}};
  if($('catBuyVariant'))$('catBuyVariant').onchange=function(){var op=this.selectedOptions[0],mn=Number(op.dataset.min||p.effective_min_order_qty);$('catBuyQty').min=mn;if(Number($('catBuyQty').value)<mn)$('catBuyQty').value=mn;};
  $('catAddCart').onclick=async function(){var m=$('catStoreMsg');try{this.disabled=true;await rpc('catalog_add_to_cart',{p_product_id:p.id,p_variant_id:$('catBuyVariant')?$('catBuyVariant').value:null,p_quantity:Number($('catBuyQty').value)});m.textContent='已加入購物車';m.className='message success';await updateCartCount();}catch(e){m.textContent=e.message;m.className='message error';}finally{this.disabled=false;}};
  $('catStoreModal').classList.remove('hidden');if(focusQty)setTimeout(function(){$('catBuyQty').focus();},100);
}
async function downloadImage(im){
  try{
    var res=await fetch(publicImage(im.storage_path));if(!res.ok)throw new Error('下載失敗');var blob=await res.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=im.original_filename||'image';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(u);},2000);
  }catch(e){window.open(publicImage(im.storage_path),'_blank');}
}
async function updateCartCount(){
  if(!isCustomer()||!$('catCartCount'))return;try{var rows=await rpc('catalog_get_cart',{});$('catCartCount').textContent=rows&&rows.length?'('+rows.length+')':'';}catch(e){}
}
async function renderCart(){
  var area=$('catalogCustomerArea');area.innerHTML='<div class="catalog-empty">載入購物車…</div>';
  var rows=await rpc('catalog_get_cart',{}),addresses=await rest('customer_addresses?select=*&customer_id=eq.'+state.profile.customer_id+'&active=eq.true&order=is_default.desc,last_used_at.desc'),total=(rows||[]).reduce(function(t,x){return t+Number(x.line_total||0);},0);
  var lev=await loadMyLevel(),min=lev?Number(lev.min_order_amount||0):0;
  area.innerHTML='<div class="card inner-card"><h2>購物車</h2><div class="catalog-cart-list">'+((rows||[]).map(function(x){return '<div class="catalog-cart-row">'+(x.image_path?'<img data-catalog-zoom src="'+esc(publicImage(x.image_path))+'" alt="'+esc(x.product_name)+'">':'<div style="width:64px;height:64px;border-radius:8px;background:#f2f4f7;color:#87919c;display:grid;place-items:center;font-size:12px">無圖</div>')+'<div><b>'+esc(x.product_code)+' '+esc(x.product_name)+'</b><div class="muted">'+esc(x.variant_name||'')+'</div></div><div class="qty">'+esc(x.quantity)+' '+esc(x.order_unit)+'</div><div class="price">'+money(x.unit_price)+'/單位｜小計 '+money(x.line_total)+'</div><button class="btn ghost" data-cart-del="'+x.cart_item_id+'">移除</button></div>';}).join('')||'<div class="catalog-empty">購物車是空的。</div>')+'</div><div class="catalog-cart-total">合計 '+money(total)+'</div>'+(min>0?'<div class="muted" style="text-align:right">此客戶等級最低結帳金額 '+money(min)+(total<min?'，尚差 '+money(min-total):'，已達門檻')+'</div>':'')+((rows||[]).length?'<div class="catalog-block"><h3>收貨資料</h3><label>選擇地址<select id="catCheckoutAddressId" style="width:100%;margin-top:5px"><option value="">＋本次新增收貨資料</option>'+addresses.map(function(a){return '<option value="'+a.id+'" '+(a.is_default?'selected':'')+'>'+esc((a.is_default?'★ ':'')+(a.receiver_name||'')+'｜'+(a.phone||'')+'｜'+(a.address||''))+'</option>';}).join('')+'</select></label><div id="catCheckoutNew" class="catalog-checkout-grid"><label>收貨人<input id="catCheckoutReceiver"></label><label>電話<input id="catCheckoutPhone"></label><label class="full">地址<input id="catCheckoutAddress"></label></div><label class="full">備註<textarea id="catCheckoutNote" style="width:100%"></textarea></label><button id="catCheckoutBtn" class="btn primary wide" style="margin-top:10px" '+(total<min?'disabled':'')+'>送出採購單（待審核）</button><div id="catCheckoutMsg" class="message"></div></div>':'')+'</div>';
  enableCatalogImageZoom(area);
  area.querySelectorAll('[data-cart-del]').forEach(function(b){b.onclick=async function(){await rpc('catalog_remove_cart_item',{p_item_id:b.dataset.cartDel});renderCart();updateCartCount();};});
  if($('catCheckoutAddressId')){function toggleNew(){$('catCheckoutNew').classList.toggle('hidden',!!$('catCheckoutAddressId').value);}$('catCheckoutAddressId').onchange=toggleNew;toggleNew();}
  if($('catCheckoutBtn'))$('catCheckoutBtn').onclick=async function(){var m=$('catCheckoutMsg');try{this.disabled=true;var aid=$('catCheckoutAddressId').value||null,r=$('catCheckoutReceiver')?$('catCheckoutReceiver').value.trim():null,ph=$('catCheckoutPhone')?$('catCheckoutPhone').value.trim():null,ad=$('catCheckoutAddress')?$('catCheckoutAddress').value.trim():null,note=$('catCheckoutNote').value.trim();if(!aid&&(!r||!ph||!ad))throw new Error('新增收貨資料請完整填寫收貨人、電話與地址');var out=await rpc('catalog_submit_purchase',{p_customer_address_id:aid,p_receiver:aid?null:r,p_phone:aid?null:ph,p_address:aid?null:ad,p_note:note||null});m.textContent='採購單 '+out.request_no+' 已送出，等待管理員確認。';m.className='message success';await updateCartCount();setTimeout(renderPurchases,800);}catch(e){m.textContent='結帳失敗：'+e.message;m.className='message error';this.disabled=false;}};
}
async function loadMyLevel(){
  try{var m=await rest('customer_level_members?select=level_id&customer_id=eq.'+state.profile.customer_id);if(!m.length)return null;var l=await rest('customer_levels?select=*&id=eq.'+m[0].level_id);return l[0]||null;}catch(e){return null;}
}
async function renderAdminPurchaseRequests(){
  var el=$('catAdminRequests');if(!el||!isManager())return;
  el.innerHTML='<div class="catalog-empty">正在載入待審核採購單…</div>';
  var rs=await Promise.all([
    rest('customer_purchase_requests?select=*&order=created_at.desc&limit=200'),
    rest('customer_purchase_request_items?select=*&order=sort_order.asc')
  ]);
  var requests=rs[0]||[],items=rs[1]||[];
  el.innerHTML='<div class="catalog-head"><h3>客戶採購單審核</h3><button class="btn ghost" id="catRequestReload">重新整理</button></div><p class="muted">核准後才正式建立 ORD 並通知指定出貨廠商；退回則不建立訂單。</p>'+
    (requests.map(function(r){
      var its=items.filter(function(x){return x.request_id===r.id;});
      var status=r.status==='pending'?'待確認':r.status==='approved'?'已轉正式訂單':'已退回';
      var quantity=its.reduce(function(n,i){return n+Number(i.quantity||0);},0);
      var detail='<div style="overflow-x:auto;margin:12px 0"><table style="width:100%;border-collapse:collapse;min-width:710px;font-size:14px"><thead><tr style="background:#f1f5f9;text-align:left"><th style="padding:10px 8px">商品編號</th><th style="padding:10px 8px">商品名稱</th><th style="padding:10px 8px">規格／顏色</th><th style="padding:10px 8px;text-align:right">數量</th><th style="padding:10px 8px;text-align:right">單價</th><th style="padding:10px 8px;text-align:right">小計</th></tr></thead><tbody>'+
        its.map(function(i){return '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:10px 8px;white-space:nowrap"><b>'+esc(i.product_code)+'</b></td><td style="padding:10px 8px">'+esc(i.product_name)+'</td><td style="padding:10px 8px">'+esc(i.variant_name||'—')+'</td><td style="padding:10px 8px;text-align:right;white-space:nowrap"><b style="font-size:17px">'+esc(i.quantity)+'</b> '+esc(i.order_unit||'')+'</td><td style="padding:10px 8px;text-align:right;white-space:nowrap">'+money(i.unit_price)+'</td><td style="padding:10px 8px;text-align:right;white-space:nowrap"><b>'+money(i.line_total)+'</b></td></tr>';}).join('')+
        '</tbody></table></div>';
      return '<div class="catalog-myorder" style="padding:16px"><div class="catalog-head"><div><b style="font-size:18px">PUR-'+String(r.request_no).padStart(6,'0')+'</b> <span class="catalog-pill">'+esc(status)+'</span><div style="font-weight:700;margin-top:4px">'+esc(r.buyer)+'</div></div><div style="text-align:right"><div class="muted">採購總金額</div><b style="font-size:22px">'+money(r.total)+'</b></div></div>'+
      '<div class="muted">送出：'+esc(fmtDate(r.created_at))+'</div><div style="margin-top:5px"><b>收貨資料：</b>'+esc(r.receiver)+'｜'+esc(r.receiver_phone||'')+'｜'+esc(r.receiver_address||'')+'</div>'+
      detail+'<div style="display:flex;justify-content:flex-end;gap:18px;align-items:center;font-weight:700">品項 '+its.length+' 筆｜總數量 '+quantity+'｜合計 <span style="font-size:20px">'+money(r.total)+'</span></div>'+
      (r.note?'<div class="muted" style="margin-top:9px">客戶備註：'+esc(r.note)+'</div>':'')+
      (r.status==='pending'?'<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn primary" data-purchase-approve="'+r.id+'">確認無誤，轉正式訂單</button><button class="btn ghost" data-purchase-reject="'+r.id+'">退回採購單</button></div>':'<div class="muted" style="margin-top:10px">'+(r.status==='approved'?'正式訂單：'+esc((r.order_numbers||[]).join('、')):'退回原因：'+esc(r.review_note||'—'))+'</div>')+'</div>';
    }).join('')||'<div class="catalog-empty">沒有客戶採購單。</div>');
  $('catRequestReload').onclick=renderAdminPurchaseRequests;
  el.querySelectorAll('[data-purchase-approve],[data-purchase-reject]').forEach(function(b){b.onclick=async function(){
    var approval=!!b.dataset.purchaseApprove,id=b.dataset.purchaseApprove||b.dataset.purchaseReject;
    if(!confirm(approval?'確認後將建立正式 ORD 並交由廠商出貨，確定？':'確定退回這份採購單？'))return;
    var note=approval?null:prompt('請輸入退回原因');if(!approval&&note===null)return;
    b.disabled=true;
    try{await rpc('catalog_review_purchase',{p_request_id:id,p_approve:approval,p_note:note||null});await renderAdminPurchaseRequests();}
    catch(e){alert('審核失敗：'+e.message);b.disabled=false;}
  };});
}

async function renderPurchases(){
  var area=$('catalogCustomerArea');area.innerHTML='<div class="catalog-empty">正在載入採購紀錄…</div>';
  var result=await Promise.all([
    rest('customer_purchase_requests?select=*&customer_id=eq.'+state.profile.customer_id+'&order=created_at.desc&limit=100'),
    rest('orders?select=id,tracking_id,order_date,status,order_total,expected_deadline,created_at,receiver,receiver_address&customer_id=eq.'+state.profile.customer_id+'&order=created_at.desc&limit=100')
  ]);
  var purchases=result[0]||[],orders=result[1]||[];
  function summary(type,id,number,status,date,total,receiver,extra){
    return '<details class="catalog-myorder" data-detail-type="'+type+'" data-detail-id="'+esc(id)+'" style="margin-bottom:9px"><summary style="cursor:pointer;list-style:none;padding:5px 0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><b>'+esc(number)+'</b> <span class="catalog-pill">'+esc(status)+'</span><div class="muted">'+esc(date)+'｜收貨：'+esc(receiver||'—')+'</div><b>'+money(total)+'</b></div><span style="font-size:13px;color:#087e77">查看明細 ▾</span></div></summary><div class="catalog-purchase-detail" style="border-top:1px solid #ddd;margin-top:9px;padding-top:10px">'+(extra||'')+'<div class="muted">展開後載入商品明細…</div></div></details>';
  }
  var html=purchases.map(function(p){
    return summary('PUR',p.id,'PUR-'+String(p.request_no).padStart(6,'0'),p.status==='pending'?'等待確認':p.status==='approved'?'已確認':'已退回',fmtDate(p.created_at),p.total,p.receiver,p.status==='rejected'?'<div class="muted">退回原因：'+esc(p.review_note||'—')+'</div>':'');
  }).join('')+orders.map(function(o){
    var status=({vendor_unconfirmed:'訂單處理中',vendor_confirmed:'訂單已確認',new:'訂單處理中',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'暫時缺貨',delayed:'出貨延後'})[o.status]||'訂單處理中';
    return summary('ORD',o.id,'ORD-'+String(o.tracking_id).padStart(6,'0'),status,'下單 '+o.order_date+'｜預計 '+(o.expected_deadline||'—'),o.order_total,o.receiver);
  }).join('');
  area.innerHTML='<div class="card inner-card"><h2>我的採購</h2><p class="muted">點選採購單或訂單，即可展開商品、規格、數量與金額。</p>'+(html||'<div class="catalog-empty">尚無採購紀錄。</div>')+'</div>';
  area.querySelectorAll('details[data-detail-id]').forEach(function(d){
    d.addEventListener('toggle',async function(){
      if(!d.open||d.dataset.loaded==='1'||d.dataset.loading==='1')return;
      d.dataset.loading='1';var target=d.querySelector('.catalog-purchase-detail');
      try{
        var kind=d.dataset.detailType,table=kind==='PUR'?'customer_purchase_request_items':'order_items',col=kind==='PUR'?'request_id':'order_id';
        var lines=await rest(table+'?select=*&'+col+'=eq.'+encodeURIComponent(d.dataset.detailId)+'&order=sort_order.asc');
        var total=0,quant=0;
        var productIds=[...new Set((lines||[]).map(function(x){return kind==='PUR'?x.product_id:x.catalog_product_id;}).filter(Boolean))];
        var imageRows=productIds.length?await rest('catalog_product_images?select=product_id,storage_path,sort_order,created_at&product_id=in.('+productIds.map(encodeURIComponent).join(',')+')&order=sort_order.asc,created_at.asc'):[];
        var imageByProduct={};(imageRows||[]).forEach(function(im){if(!imageByProduct[im.product_id])imageByProduct[im.product_id]=im.storage_path;});
        var trs=(lines||[]).map(function(x){
          var code=x.product_code||'',name=x.product_name||'',variant=kind==='PUR'?x.variant_name:x.variant;
          var qty=Number(x.quantity||0),unit=kind==='PUR'?x.order_unit:x.quantity_unit;
          var price=Number(x.unit_price||0),subtotal=x.line_total!=null?Number(x.line_total):price*qty;
          total+=subtotal;quant+=qty;
          var imagePath=imageByProduct[kind==='PUR'?x.product_id:x.catalog_product_id];var thumb=imagePath?'<img data-catalog-zoom src="'+esc(publicImage(imagePath))+'" alt="'+esc(name)+'" loading="lazy" style="width:58px;height:58px;object-fit:cover;border-radius:7px;display:block">':'<span style="display:grid;place-items:center;width:58px;height:58px;background:#f2f4f7;color:#8b95a1;border-radius:7px;font-size:12px">無圖</span>';
          return '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:8px">'+thumb+'</td><td style="padding:8px">'+esc(code)+'</td><td style="padding:8px">'+esc(name)+'</td><td style="padding:8px">'+esc(variant||'—')+'</td><td style="padding:8px;text-align:right;white-space:nowrap"><b>'+esc(qty)+'</b> '+esc(unit||'')+'</td><td style="padding:8px;text-align:right">'+money(price)+'</td><td style="padding:8px;text-align:right"><b>'+money(subtotal)+'</b></td></tr>';
        }).join('');
        target.innerHTML='<div style="overflow-x:auto"><table style="width:100%;min-width:600px;border-collapse:collapse;font-size:13px"><thead><tr style="background:#f1f5f9"><th>圖片</th><th>貨號</th><th>商品名稱</th><th>規格／顏色</th><th>數量</th><th>單價</th><th>小計</th></tr></thead><tbody>'+trs+'</tbody></table></div><div style="text-align:right;font-weight:700;margin-top:10px">共 '+(lines||[]).length+' 項｜總數量 '+quant+'｜商品小計 '+money(total)+'</div>';
        if(!lines||!lines.length)target.innerHTML='<div class="muted">這筆紀錄目前沒有商品明細。</div>';
        enableCatalogImageZoom(target);
        d.dataset.loaded='1';
      }catch(e){target.innerHTML='<div class="message error">明細載入失敗：'+esc(e.message)+'，請收合後再展開重試。</div>';}
      finally{d.dataset.loading='';}
    });
  });
}
async function renderCustomerAddresses(){
  var area=$('catalogCustomerArea'),rows=await rest('customer_addresses?select=*&customer_id=eq.'+state.profile.customer_id+'&active=eq.true&order=is_default.desc,last_used_at.desc');
  area.innerHTML='<div class="card inner-card"><div class="catalog-head"><h2>收貨資料</h2><button id="catAddAddress" class="btn primary">＋新增收貨資料</button></div><div id="catAddressList">'+rows.map(function(a){return '<div class="catalog-myorder"><div class="catalog-head"><div><b>'+(a.is_default?'★ ':'')+esc(a.receiver_name||'未填收貨人')+'</b><div>'+esc(a.phone||'')+'</div><div>'+esc(a.address||'')+'</div></div><div style="display:flex;gap:6px"><button class="btn ghost" data-address-edit="'+a.id+'">修改</button><button class="btn secondary" data-address-default="'+a.id+'" '+(a.is_default?'disabled':'')+'>設預設</button></div></div></div>';}).join('')+'</div></div>';
  $('catAddAddress').onclick=function(){editCustomerAddress(null);};area.querySelectorAll('[data-address-edit]').forEach(function(b){b.onclick=function(){editCustomerAddress(rows.find(function(a){return a.id===b.dataset.addressEdit;}));};});area.querySelectorAll('[data-address-default]').forEach(function(b){b.onclick=async function(){await rest('customer_addresses?customer_id=eq.'+state.profile.customer_id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_default:false})});await rest('customer_addresses?id=eq.'+b.dataset.addressDefault,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({is_default:true,updated_at:new Date().toISOString()})});renderCustomerAddresses();};});
}
function editCustomerAddress(a){
  var recv=prompt('收貨人',a&&a.receiver_name||'');if(recv===null)return;var phone=prompt('電話',a&&a.phone||'');if(phone===null)return;var addr=prompt('地址',a&&a.address||'');if(addr===null)return;
  (async function(){var body={customer_id:state.profile.customer_id,label:recv||'收貨資料',receiver_name:recv.trim()||null,phone:phone.trim()||null,address:addr.trim()||null,updated_at:new Date().toISOString()};if(a)await rest('customer_addresses?id=eq.'+a.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});else await rest('customer_addresses',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});renderCustomerAddresses();})().catch(showErr);
}
function renderCustomerPassword(){
  var area=$('catalogCustomerArea');area.innerHTML='<div class="card inner-card" style="max-width:520px"><h2>修改密碼</h2><label>新密碼<input id="catCustomerPwd1" type="password" placeholder="至少 8 碼"></label><label>再次輸入<input id="catCustomerPwd2" type="password"></label><button id="catCustomerPwdBtn" class="btn primary" style="margin-top:10px">儲存新密碼</button><div id="catCustomerPwdMsg" class="message"></div></div>';$('catCustomerPwdBtn').onclick=async function(){var m=$('catCustomerPwdMsg'),p1=$('catCustomerPwd1').value,p2=$('catCustomerPwd2').value;if(p1.length<8){m.textContent='密碼至少 8 碼';m.className='message error';return;}if(p1!==p2){m.textContent='兩次密碼不一致';m.className='message error';return;}try{this.disabled=true;await edge({action:'change_password',password:p1});m.textContent='密碼已修改';m.className='message success';}catch(e){m.textContent=e.message;m.className='message error';}finally{this.disabled=false;}};
}
function showErr(e){console.error(e);alert('商城功能發生錯誤：'+e.message);}
async function activate(){
  try{
    await loadProfile();if(!state.profile)return;
    if(isManager()){ensureAdminTab();}
    if(isCustomer()){ensureCustomerUI();updateCartCount();}
  }catch(e){console.warn('catalog init',e);}
}
function observeLoginViews(){
  ['adminView','customerView'].forEach(function(id){var el=$(id);if(!el)return;new MutationObserver(function(ms){ms.forEach(function(m){if(m.attributeName==='class'&&!el.classList.contains('hidden'))activate();});}).observe(el,{attributes:true,attributeFilter:['class']});});
}
document.addEventListener('DOMContentLoaded',function(){activate();observeLoginViews();});
})();
