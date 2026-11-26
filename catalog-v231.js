
(function(){
'use strict';

var CFG=window.APP_CONFIG||{}, SB=CFG.SUPABASE_URL, KEY=CFG.SUPABASE_PUBLISHABLE_KEY;
var state={profile:null,levels:[],vendors:[],customers:[],products:[],images:[],variants:[],adminReady:false,customerReady:false,currentProduct:null};
var pendingProductImages=[],pendingImageSequence=0;

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
  var txt=await res.text(); if(!res.ok){if(res.status===401||/JWT expired|invalid jwt|token.*expired/i.test(txt))throw new Error('登入已逾期，請重新登入後再操作。');var m=txt;try{var d=JSON.parse(txt);m=d.message||d.hint||d.details||txt;}catch(e){} throw new Error(m||('HTTP '+res.status));}
  return txt?JSON.parse(txt):null;
}
async function restAll(path){
 var out=[],offset=0,chunk=800,rows;
 do{
  rows=await rest(path,{headers:{Range:offset+'-'+(offset+chunk-1)}});
  if(!Array.isArray(rows))throw new Error('分頁讀取資料失敗');
  out.push.apply(out,rows);offset+=rows.length;
 }while(rows.length===chunk);
 return out;
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
    rest('customers?select=id,customer_code,name,contact_name,phone,active,import_account_code,import_short_name,import_category&order=customer_code.asc'),
    rest('catalog_products?select=*&order=created_at.desc'),
    rest('catalog_product_images?select=*&order=sort_order.asc,created_at.asc'),
    rest('catalog_variants?select=*&order=sort_order.asc')
  ]);
  state.levels=rs[0]||[];state.vendors=rs[1]||[];state.customers=rs[2]||[];state.products=rs[3]||[];state.images=rs[4]||[];state.variants=rs[5]||[];
}
async function loadStorefront(){
  var products=await rest('catalog_storefront?select=*&active=eq.true&published=eq.true&order=created_at.desc');
  // Defense in depth: deleted, disabled and unpublished items must never appear in customer storefront.
  state.products=(products||[]).filter(function(p){return p.active===true&&p.published===true&&p.archived_at==null;});
  var ids=state.products.map(function(x){return x.id;});
  if(!ids.length){state.images=[];state.variants=[];return;}
  var q='in.('+ids.join(',')+')';
  var rs=await Promise.all([
    rest('catalog_product_images?select=*&product_id='+encodeURIComponent(q)+'&order=sort_order.asc,created_at.asc'),
    rest('catalog_variants?select=*&product_id='+encodeURIComponent(q)+'&active=eq.true&order=sort_order.asc')
  ]);
  state.images=rs[0]||[];state.variants=rs[1]||[];
  try{var stats=await rpc('catalog_store_sales_stats',{});var map=new Map((stats||[]).map(function(x){return [x.product_id,x];}));state.products.forEach(function(p){var t=map.get(p.id);p.ordered_quantity=t?Number(t.ordered_quantity||0):0;p.max_sales_quantity=t&&t.max_sales_quantity!=null?Number(t.max_sales_quantity):null;});}catch(e){console.warn('商品銷售量讀取失敗',e);}
}

function ensureAdminTab(){
  if($('tab-catalog'))return;
  var nav=document.querySelector('#adminView .tabs'); if(!nav)return;
  var b=document.createElement('button');b.className='tab';b.dataset.tab='catalog';b.textContent='批發商城';nav.appendChild(b);
  var panel=document.createElement('div');panel.id='tab-catalog';panel.className='tab-panel hidden';
  panel.innerHTML='<div class="card section-card"><div class="catalog-head"><div><h2>批發商城</h2><p class="muted">商品指定出貨廠商；價格、權限與購物車以客戶為主。</p></div><button id="catNewProduct" class="btn primary" type="button">＋新增商品</button></div><div class="catalog-subnav"><button class="active" data-cat-admin="products">商品管理</button><button data-cat-admin="customers">客戶資料</button><button data-cat-admin="levels">客戶等級</button><button data-cat-admin="preview">客戶視角預覽</button><button data-cat-admin="requests">客戶採購單</button><button data-cat-admin="ng">待處理問題單</button><button data-cat-admin="sales">銷售報表</button></div><div id="catAdminProducts"></div><div id="catAdminCustomers" class="hidden"></div><div id="catAdminLevels" class="hidden"></div><div id="catAdminPreview" class="hidden"></div><div id="catAdminRequests" class="hidden"></div><div id="catAdminNg" class="hidden"></div><div id="catSalesReport" class="hidden"></div></div>';
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
  var previousSelected=$('catPreviewCustomer')?$('catPreviewCustomer').value:null;
  el.innerHTML='<div class="catalog-empty">正在載入客戶視角…</div>';
  var results=await Promise.all([
    rest('customer_level_members?select=customer_id,level_id'),
    rest('catalog_customer_prices?select=product_id,customer_id,price,min_order_qty'),
    rest('catalog_customer_level_prices?select=product_id,level_id,price,min_order_qty'),
    rest('catalog_customer_access?select=product_id,customer_id,level_id')
  ]);
  previewData={members:results[0]||[],prices:results[1]||[],levelPrices:results[2]||[],access:results[3]||[]};
  var customers=state.customers.filter(function(c){return c.active;});
  var selected=customers.find(function(c){return c.id===previousSelected;})||customers[0]||null;
  function displayCustomer(c){return c.customer_code+' '+c.name;}
  function normalizeCustomer(v){return String(v||'').toLocaleLowerCase('zh-Hant').replace(/[\s　]+/g,'');}
  el.innerHTML='<div class="catalog-block"><h3>客戶視角預覽（唯讀）</h3>'+
    '<p class="muted">輸入客戶編號、名稱或簡稱查詢，選取後預覽該客戶可見的已上架商品及專屬價格。預覽不會建立購物車或訂單。</p>'+
    '<div class="catalog-toolbar">'+
      '<div class="cat-preview-customer-picker" id="catPreviewCustomerPicker">'+
        '<input type="search" id="catPreviewCustomerQuery" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="catPreviewCustomerMatches" aria-label="搜尋預覽客戶編號、名稱或簡稱" placeholder="搜尋客戶編號／姓名／簡稱" autocomplete="off" value="'+esc(selected?displayCustomer(selected):'')+'">'+
        '<input type="hidden" id="catPreviewCustomer" value="'+esc(selected?selected.id:'')+'">'+
        '<div id="catPreviewCustomerMatches" class="cat-preview-customer-results" role="listbox" hidden></div>'+
      '</div>'+
      '<input id="catPreviewSearch" placeholder="搜尋商品編號或名稱">'+
      '<select id="catPreviewMode"><option value="">全部商品</option><option value="in_stock">現貨</option><option value="preorder">預購</option></select>'+
    '</div><div id="catPreviewSummary" class="muted"></div><div id="catPreviewGrid" class="catalog-grid"></div></div>';
  var picker=$('catPreviewCustomerPicker'),input=$('catPreviewCustomerQuery'),list=$('catPreviewCustomerMatches');
  var matches=[];
  function closeMatches(){
    list.hidden=true;
    input.setAttribute('aria-expanded','false');
  }
  function chooseCustomer(id){
    var c=customers.find(function(x){return x.id===id;});if(!c)return;
    $('catPreviewCustomer').value=c.id;
    input.value=displayCustomer(c);
    closeMatches();
    paintAdminCustomerPreview();
  }
  function showMatches(){
    var q=normalizeCustomer(input.value);
    matches=customers.filter(function(c){
      return !q||normalizeCustomer([c.customer_code,c.name,c.import_short_name,c.contact_name,c.phone].join(' ')).includes(q);
    });
    var shown=matches.slice(0,45);
    list.innerHTML=shown.map(function(c){
      return '<button type="button" class="cat-preview-customer-option" role="option" aria-selected="'+(c.id===$('catPreviewCustomer').value?'true':'false')+'" data-preview-customer-id="'+esc(c.id)+'">'+
        '<strong>'+esc(c.customer_code)+'｜'+esc(c.name)+'</strong>'+
        (c.import_short_name||c.contact_name?'<span>'+esc(c.import_short_name||c.contact_name)+'</span>':'')+
        '</button>';
    }).join('')||'<div class="cat-preview-customer-hint">找不到符合的客戶，請更換關鍵字。</div>';
    if(matches.length>shown.length)list.insertAdjacentHTML('beforeend','<div class="cat-preview-customer-hint">找到 '+matches.length+' 位客戶，請輸入更多關鍵字縮小範圍。</div>');
    list.hidden=false;
    input.setAttribute('aria-expanded','true');
    list.querySelectorAll('[data-preview-customer-id]').forEach(function(b){
      b.onclick=function(){chooseCustomer(b.dataset.previewCustomerId);};
    });
  }
  input.onfocus=function(){input.select();showMatches();};
  input.oninput=showMatches;
  input.onkeydown=function(e){
    if(e.key==='ArrowDown'){
      var first=list.querySelector('[data-preview-customer-id]');
      if(first){e.preventDefault();first.focus();}
    }else if(e.key==='Enter'){
      if(!list.hidden&&matches.length){e.preventDefault();chooseCustomer(matches[0].id);}
    }else if(e.key==='Escape'){
      closeMatches();
      var current=customers.find(function(c){return c.id===$('catPreviewCustomer').value;});
      input.value=current?displayCustomer(current):'';
    }
  };
  list.onkeydown=function(e){
    var buttons=[].slice.call(list.querySelectorAll('[data-preview-customer-id]'));
    var i=buttons.indexOf(document.activeElement);
    if(e.key==='ArrowDown'&&i>=0){e.preventDefault();buttons[Math.min(i+1,buttons.length-1)].focus();}
    else if(e.key==='ArrowUp'&&i>=0){e.preventDefault();if(i===0)input.focus();else buttons[i-1].focus();}
    else if(e.key==='Escape'){e.preventDefault();closeMatches();input.focus();}
  };
  picker.addEventListener('focusout',function(e){if(!picker.contains(e.relatedTarget))closeMatches();});
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
    return '<div class="catalog-card"><div class="catalog-card-img">'+(im?'<img src="'+esc(publicImage(im.storage_path))+'" alt="">':'<span class="muted">尚無圖片</span>')+'</div><div class="catalog-card-body"><div class="catalog-code">'+esc(p.product_code)+'</div><div class="catalog-name">'+esc(p.name)+'</div><div class="catalog-price">'+money(detail.price)+'</div><div class="catalog-meta"><span class="catalog-pill '+(s==='現貨'?'good':'warn')+'">'+esc(s)+'</span><span class="catalog-pill">最低 '+esc(detail.minimum)+' '+esc(p.order_unit)+'</span><span class="catalog-pill">全站累計訂購 '+Number(p.ordered_quantity||0)+' '+esc(p.order_unit)+'</span>'+(p.max_sales_quantity!=null?'<span class="catalog-pill">總量上限 '+Number(p.max_sales_quantity)+' '+esc(p.order_unit)+'</span>':'')+(p.sale_end_at?'<span class="catalog-pill">結單 '+esc(fmtDate(p.sale_end_at))+'</span>':'')+'</div><div class="catalog-card-actions"><button type="button" class="btn secondary" data-preview-product="'+esc(p.id)+'">查看商品</button><button type="button" class="btn primary" disabled>'+(open?'預覽不可購買':'不可購買')+'</button></div></div></div>';
  }).join('')||'<div class="catalog-empty">這位客戶目前沒有可見的商品。</div>';
  grid.querySelectorAll('[data-preview-product]').forEach(function(b){b.onclick=function(){openAdminPreviewDetail(b.dataset.previewProduct,customerId,levelId);};});
}
function openAdminPreviewDetail(id,customerId,levelId){
  var p=state.products.find(function(x){return x.id===id;});if(!p)return;
  var old=$('catPreviewModal');if(old)old.remove();
  var d=document.createElement('div');d.id='catPreviewModal';d.className='catalog-modal';
  var imgs=state.images.filter(function(x){return x.product_id===id;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);});
  var variants=getVariants(id),v=previewCustomerPrice(p,customerId,levelId);
  d.innerHTML='<div class="catalog-modal-card"><div class="catalog-modal-head"><h2>'+esc(p.product_code+' '+p.name)+'｜客戶預覽</h2><button class="catalog-close" type="button" data-preview-close>×</button></div><div class="catalog-product-detail"><div><img id="catPreviewMainImage" class="catalog-main-image" src="'+esc(imgs[0]?publicImage(imgs[0].storage_path):'')+'" alt=""><div class="catalog-thumbs">'+imgs.map(function(im){return '<button type="button" data-preview-image="'+esc(im.id)+'"><img src="'+esc(publicImage(im.storage_path))+'" alt=""></button>';}).join('')+'</div></div><div><div class="catalog-price">'+money(v.price)+'</div><div class="catalog-meta"><span class="catalog-pill">'+esc(saleState(p))+'</span><span class="catalog-pill">最低 '+esc(v.minimum)+' '+esc(p.order_unit)+'</span>'+(p.pack_text?'<span class="catalog-pill">'+esc(p.pack_text)+'</span>':'')+'</div><div class="catalog-copy-bar"><button type="button" id="catCopyDescription" class="btn secondary">一鍵複製文案</button><span class="muted" id="catCopyFeedback" role="status"></span></div><p class="catalog-product-copy" style="white-space:pre-wrap;line-height:1.7">'+esc(p.description||'')+'</p>'+(p.expected_ship_date?'<p><b>預計出貨：</b>'+esc(p.expected_ship_date)+'</p>':'')+(variants.length?'<label>款式<select id="catPreviewVariant">'+variants.map(function(x){return '<option value="'+esc(x.id)+'">'+esc(x.name)+(Number(x.price_delta)?'（'+money(v.price+Number(x.price_delta))+'）':'')+'</option>';}).join('')+'</select></label>':'')+'<p class="muted">僅供管理員／員工查看，無法加入購物車或送出訂單。</p></div></div></div>';
  document.body.appendChild(d);
  d.querySelector('[data-preview-close]').onclick=function(){d.remove();};
  d.querySelectorAll('[data-preview-image]').forEach(function(b){b.onclick=function(){var im=imgs.find(function(x){return x.id===b.dataset.previewImage;});if(im)$('catPreviewMainImage').src=publicImage(im.storage_path);};});
}

async function loadAdminCatalog(){
  await loadCommonAdmin(); renderAdminProducts(); state.adminReady=true;
}
function renderAdminProducts(view){
  var el=$('catAdminProducts');if(!el||!isManager())return;
  view=view==='archived'?'archived':'active';
  var archiveCount=state.products.filter(function(p){return !!p.archived_at;}).length;
  var cards=state.products.map(function(p){
    var im=firstImage(p.id),n=state.images.filter(function(x){return x.product_id===p.id;}).length;
    var archived=!!p.archived_at,currentlyForSale=saleOpen(p),quickPublish=!currentlyForSale;
    var quickLabel=currentlyForSale?'下架商品':p.published?'重新上架':'立即上架';
    return '<div class="catalog-card" data-cat-product-id="'+esc(p.id)+'"><div class="catalog-card-img">'+
      (im?'<img src="'+esc(publicImage(im.storage_path))+'" alt="">':'<span class="muted">尚無圖片</span>')+
      '</div><div class="catalog-card-body"><div class="catalog-code">'+esc(p.product_code)+'</div>'+
      '<div class="catalog-name">'+esc(p.name)+'</div><div class="catalog-price">'+money(p.base_price)+'</div>'+
      '<div class="catalog-meta"><span class="catalog-pill '+(!archived&&p.published?'good':'warn')+'">'+
      (archived?'已刪除（可還原）':p.published&&p.active?(saleState(p)==='已結單'?'已結單':saleState(p)==='尚未開賣'?'預約開賣':'已上架'):p.active?'草稿':'已停用')+'</span>'+
      '<span class="catalog-pill">'+esc(p.sale_mode==='in_stock'?'現貨':'預購')+'</span>'+
      '<span class="catalog-pill">'+n+' 張圖</span><span class="catalog-pill">'+
      esc(p.visibility_mode==='all'?'全部客戶':'指定販售')+'</span></div>'+
      (archived?'<div class="muted" style="font-size:12px">刪除時間：'+esc(fmtDate(p.archived_at))+'</div>':'')+
      (archived?'':'<div class="cat-quick-publish-row"><button type="button" class="btn '+(quickPublish?'primary cat-publish-on':'ghost cat-publish-off')+
         '" data-cat-quick-publish="'+esc(p.id)+'" data-cat-publish-target="'+(quickPublish?'1':'0')+
         '" aria-label="'+esc(p.product_code+' '+(quickPublish?'上架':'下架'))+'">'+
         quickLabel+'</button></div>')+
      '<div class="catalog-card-actions">'+(archived?
        btn('還原為草稿','btn secondary','data-cat-restore="'+esc(p.id)+'"'):
        btn('編輯','btn secondary','data-cat-edit="'+esc(p.id)+'"')+
        btn('刪除','btn ghost','data-cat-delete="'+esc(p.id)+'" style="color:#b42318;border-color:#fda29b"'))+
      '</div></div></div>';
  }).join('');
  el.innerHTML='<div class="catalog-toolbar"><input id="catAdminSearch" placeholder="搜尋商品編號、名稱">'+
    '<select id="catAdminMode"><option value="">全部類型</option><option value="in_stock">現貨</option><option value="preorder">預購</option></select>'+
    '<select id="catAdminPub"><option value="">全部狀態</option><option value="1">已上架</option><option value="0">草稿／停用</option></select>'+
    '<select id="catAdminArchived" aria-label="商品清單範圍"><option value="active" '+(view==='active'?'selected':'')+'>一般商品</option>'+
    '<option value="archived" '+(view==='archived'?'selected':'')+'>已刪除（'+archiveCount+'）</option></select></div>'+
    '<p class="muted" style="font-size:12px;margin:4px 0 10px">刪除商品會立即下架、從一般商品清單隱藏；歷史訂單、採購單、規格與圖片保留，日後可還原為未上架草稿。</p>'+
    '<div id="catAdminGrid" class="catalog-grid">'+(cards||'<div class="catalog-empty">尚未建立商城商品。</div>')+'</div>';
  function filter(){
    var q=($('catAdminSearch').value||'').trim().toLowerCase(),m=$('catAdminMode').value,
        pub=$('catAdminPub').value,mode=$('catAdminArchived').value,visible=0;
    el.querySelectorAll('[data-cat-product-id]').forEach(function(card,i){
      var p=state.products[i];
      var ok=(mode==='archived'?!!p.archived_at:!p.archived_at)&&
        (!q||(String(p.product_code+' '+p.name).toLowerCase().includes(q)))&&
        (!m||p.sale_mode===m)&&
        (!pub||(pub==='1'?p.published:!p.published));
      card.style.display=ok?'':'none';if(ok)visible++;
    });
    var empty=$('catProductFilteredEmpty');
    if(!visible&&!empty){empty=document.createElement('div');empty.id='catProductFilteredEmpty';empty.className='catalog-empty';$('catAdminGrid').appendChild(empty);}
    if(empty){empty.textContent=mode==='archived'?'沒有符合條件的已刪除商品。':'沒有符合條件的商品。';empty.style.display=visible?'none':'';}
  }
  ['catAdminSearch','catAdminMode','catAdminPub','catAdminArchived'].forEach(function(id){
    $(id).addEventListener(id==='catAdminSearch'?'input':'change',filter);
  });
  el.querySelectorAll('[data-cat-edit]').forEach(function(b){
    b.onclick=function(){openProductEditor(b.dataset.catEdit);};
  });
  async function changeArchive(id,restore){
    var p=state.products.find(function(x){return x.id===id;});if(!p)return;
    if(!restore&&!confirm('確定刪除「'+p.product_code+' '+p.name+'」？\n\n商品會立即從商城下架並從一般清單隱藏；歷史訂單、採購單、規格與圖片皆會保留，可從「已刪除」還原。'))return;
    var b=el.querySelector('[data-cat-'+(restore?'restore':'delete')+'="'+id+'"]');
    if(b){b.disabled=true;b.textContent='處理中…';}
    try{
      await rpc('catalog_archive_product',{p_product_id:id,p_restore:restore});
      await loadCommonAdmin();
      renderAdminProducts(restore?'archived':view);
    }catch(e){
      alert((restore?'還原':'刪除')+'失敗：'+e.message);
      if(b){b.disabled=false;b.textContent=restore?'還原為草稿':'刪除';}
    }
  }
  // Card-level one-click publish/unpublish, separate from full product editing.
  el.querySelectorAll('[data-cat-quick-publish]').forEach(function(b){
    b.onclick=async function(){
      if(b.disabled)return;
      var id=b.dataset.catQuickPublish,
          publish=b.dataset.catPublishTarget==='1',
          product=state.products.find(function(x){return x.id===id;});
      if(!product||product.archived_at){alert('商品已刪除或不存在，請重新整理。');return;}
      var controls=[].slice.call(b.closest('.catalog-card').querySelectorAll('button'));
      controls.forEach(function(x){x.disabled=true;});
      var before=b.textContent;b.textContent=publish?'上架中…':'下架中…';
      try{
        var answer=await rpc('catalog_quick_set_publication',{
          p_product_id:id,p_publish:publish,p_override_schedule:false
        });
        if(answer&&answer.ok===false&&answer.reason==='schedule_conflict'){
          var st=product.sale_start_at&&new Date(product.sale_start_at).getTime()>Date.now();
          var en=product.sale_end_at&&new Date(product.sale_end_at).getTime()<=Date.now();
          var why=(st?'原訂開賣時間在未來，將改為現在開賣。\n':'')+
            (en?'原訂結單時間已過，將清除結單時間。\n':'');
          if(!confirm('「'+product.product_code+' '+product.name+'」目前有時間排程：\n'+
            why+'\n確定立即上架嗎？'))return;
          answer=await rpc('catalog_quick_set_publication',{
            p_product_id:id,p_publish:true,p_override_schedule:true
          });
        }
        if(!answer||answer.ok!==true)throw new Error(answer&&answer.message||'上架狀態更新失敗');
        var saved={
          search:$('catAdminSearch')?.value||'',
          mode:$('catAdminMode')?.value||'',
          publication:$('catAdminPub')?.value||'',
          archive:$('catAdminArchived')?.value||'active'
        };
        await loadCommonAdmin();
        renderAdminProducts(saved.archive);
        $('catAdminSearch').value=saved.search;
        $('catAdminMode').value=saved.mode;
        $('catAdminPub').value=saved.publication;
        $('catAdminSearch').dispatchEvent(new Event('input',{bubbles:true}));
      }catch(e){
        alert((publish?'立即上架':'下架')+'失敗：'+e.message);
      }finally{
        if(b.isConnected){b.textContent=before;controls.forEach(function(x){x.disabled=false;});}
      }
    };
  });
  el.querySelectorAll('[data-cat-delete]').forEach(function(b){
    b.onclick=function(){changeArchive(b.dataset.catDelete,false);};
  });
  el.querySelectorAll('[data-cat-restore]').forEach(function(b){
    b.onclick=function(){changeArchive(b.dataset.catRestore,true);};
  });
  filter();
}
async function renderCustomerAdmin(){
  var el=$('catAdminCustomers');if(!el)return;
  var rs=await Promise.all([
    rest('customer_level_members?select=*'),
    restAll('customer_addresses?select=*&active=eq.true&order=is_default.desc,last_used_at.desc,id.asc'),
    rest('user_profiles?select=user_id,customer_id,login_name,active,role&role=eq.customer')
  ]);
  var members=rs[0]||[],addresses=rs[1]||[],profiles=rs[2]||[],mmap={},pmap={};
  members.forEach(function(x){mmap[x.customer_id]=x.level_id;});profiles.forEach(function(x){pmap[x.customer_id]=x;});
  el.innerHTML='<div class="card inner-card" style="margin-bottom:14px"><h3>Excel 客戶名單匯入</h3><p class="muted">僅匯入「廠商訂單追蹤／B2B 商城」Supabase；依 Excel 的帳款歸屬建立／更新主客戶與寄貨選項；匯入後會自動重新比對尚未關聯的 LINE ORD。已存在的客戶編號會更新，不重複建立；C0047 測試客戶保留。</p><input type="file" accept=".xlsx,.xls" id="catImportCustomerExcel"><button id="catImportCustomerBtn" class="btn primary" type="button" style="margin-left:8px">核對並正式匯入</button><div id="catImportCustomerMsg" class="message" role="status"></div></div><div class="card inner-card" style="margin-bottom:14px" id="catCustomerLinkReview"><h3>LINE 訂單與客戶關聯</h3><div class="muted">正在取得關聯統計…</div></div><div class="card inner-card" style="margin-bottom:14px"><h3>＋手動新增客戶</h3><p class="muted">管理員與小幫手可新增，客戶編號 Cxxxx 自動產生；新增後可直接建立登入帳號。</p><div class="catalog-form-grid"><label>客戶名稱（必填）<input id="catNewCustomerName" maxlength="100" placeholder="公司、商店或客戶名稱"></label><label>聯絡人<input id="catNewCustomerContact" placeholder="聯絡人姓名"></label><label>聯絡電話<input id="catNewCustomerPhone" placeholder="電話"></label><label>電子郵件<input id="catNewCustomerEmail" type="email" placeholder="選填"></label><label>收貨人<input id="catNewCustomerReceiver" placeholder="選填"></label><label class="span2">預設收貨地址<input id="catNewCustomerAddress" placeholder="選填；可日後從地址簿新增"></label><label class="span2">備註<input id="catNewCustomerNotes" placeholder="選填"></label></div><button id="catCreateCustomer" type="button" class="btn primary">新增客戶</button><div id="catCreateCustomerMsg" class="message" role="status"></div></div><div class="catalog-toolbar"><input id="catCustomerSearch" placeholder="搜尋客戶編號、名稱、收貨人、地址"><select id="catCustomerLevelFilter"><option value="">全部等級</option>'+state.levels.map(function(l){return '<option value="'+l.id+'">'+esc(l.name)+'</option>';}).join('')+'</select><label style="display:flex;align-items:center;gap:7px;white-space:nowrap"><input type="checkbox" id="catCustomerShowArchived" style="width:auto;min-height:0">顯示封存客戶</label><button id="catCustomerRefresh" class="btn ghost">重新整理</button></div><div id="catCustomerRows"></div>';
  function paint(){
    var q=($('catCustomerSearch').value||'').toLowerCase(),lf=$('catCustomerLevelFilter').value,showArchived=$('catCustomerShowArchived').checked;
    var list=state.customers.filter(function(c){
      var aa=addresses.filter(function(a){return a.customer_id===c.id;}),hay=(c.customer_code+' '+c.name+' '+(c.import_short_name||'')+' '+aa.map(function(a){return (a.import_ship_code||'')+' '+(a.import_short_name||'')+' '+(a.receiver_name||'')+' '+(a.phone||'')+' '+(a.address||'');}).join(' ')).toLowerCase();
      return (c.active||showArchived)&&(!q||hay.indexOf(q)>=0)&&(!lf||mmap[c.id]===lf);
    });
    $('catCustomerRows').innerHTML=list.map(function(c){
      var aa=addresses.filter(function(a){return a.customer_id===c.id;}),def=aa.find(function(a){return a.is_default;})||aa[0],pr=pmap[c.id];
      return '<div class="catalog-myorder"><div class="catalog-head"><div><b>'+esc(c.customer_code)+' '+esc(c.name)+'</b><div class="muted">'+aa.length+' 組寄貨選項'+(c.active?'':'｜已封存')+(def?'｜預設：'+esc(def.receiver_name||'')+' '+esc(def.address||''):'')+'</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><select data-customer-level="'+c.id+'">'+state.levels.map(function(l){return '<option value="'+l.id+'" '+(mmap[c.id]===l.id?'selected':'')+'>'+esc(l.name)+'</option>';}).join('')+'</select><button class="btn ghost" data-customer-addresses="'+c.id+'">地址簿</button><button class="btn secondary" data-customer-account="'+c.id+'">'+(pr?'重設帳號':'建立帳號')+'</button></div></div></div>';
    }).join('')||'<div class="catalog-empty">沒有符合的客戶。</div>';
    $('catCustomerRows').querySelectorAll('[data-customer-level]').forEach(function(x){x.onchange=async function(){await rest('customer_level_members?on_conflict=customer_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({customer_id:x.dataset.customerLevel,level_id:x.value,updated_at:new Date().toISOString()})});mmap[x.dataset.customerLevel]=x.value;};});
    $('catCustomerRows').querySelectorAll('[data-customer-addresses]').forEach(function(x){x.onclick=function(){openCustomerAddresses(x.dataset.customerAddresses,addresses,async function(){addresses=await restAll('customer_addresses?select=*&active=eq.true&order=is_default.desc,last_used_at.desc,id.asc');paint();return addresses;});};});
    $('catCustomerRows').querySelectorAll('[data-customer-account]').forEach(function(x){x.onclick=async function(){x.disabled=true;try{var d=await edge({action:'customer_account',customer_id:x.dataset.customerAccount});alert('客戶帳號：'+d.username+'\n初始/重設密碼：'+d.password+'\n首次登入後請修改密碼。');await renderCustomerAdmin();}catch(e){alert('帳號處理失敗：'+e.message);}finally{x.disabled=false;}};});
  }
    $('catCustomerShowArchived').onchange=paint;
  $('catImportCustomerBtn').onclick=async function(){
    var btn=this,msg=$('catImportCustomerMsg'),file=$('catImportCustomerExcel').files[0];
    if(!file){msg.textContent='請先選擇本次匯入的 Excel 檔案';return;}
    if(typeof XLSX==='undefined'){msg.textContent='Excel 元件尚未載入，請重新整理後操作';return;}
    try{
      btn.disabled=true;msg.textContent='正在驗證 Excel …';
      var wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),parsed=[],required=['帳款歸屬','客戶編號','客戶全稱','客戶簡稱','類別名稱','送貨地址','聯絡電話一'];
      wb.SheetNames.forEach(function(n){
        var lines=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:false,defval:''});
        if(!lines.length)return;
        var headers=lines[0].map(function(v){return String(v||'').trim();});
        var indexes=required.map(function(k){return headers.indexOf(k);});
        if(indexes.some(function(i){return i<0;}))return;
        lines.slice(1).forEach(function(row){
          if(row.every(function(c){return !String(c||'').trim();}))return;
          var vals=indexes.map(function(i){return String(row[i]??'').trim();});
          parsed.push({account_code:vals[0],ship_code:vals[1],ship_name:vals[2],short_name:vals[3],category:vals[4],address:vals[5],phone:vals[6]});
        });
      });
      // Excel 原始編號可能具有多層寄貨子代號（例：C209-03-01），不可只限制單層。
      var validCustomerCode=/^C[0-9]+(?:-[0-9]+)*$/;
      var badRow=parsed.findIndex(function(x){return !validCustomerCode.test(x.account_code)||!validCustomerCode.test(x.ship_code)||!x.ship_name;});
      if(badRow>=0){
        var bad=parsed[badRow];
        throw new Error('Excel 第 '+(badRow+2)+' 筆資料錯誤：帳款歸屬 '+(bad.account_code||'(空白)')+'、客戶編號 '+(bad.ship_code||'(空白)')+'、收件人 '+(bad.ship_name||'(空白)')+'。編號應以 C 開頭、後接數字，可有多層 -數字 寄貨子代號。');
      }
      var duplicated=new Set(),repeated=parsed.find(function(x){if(duplicated.has(x.ship_code))return true;duplicated.add(x.ship_code);return false;});
      if(repeated)throw new Error('Excel 寄貨編號重複：'+repeated.ship_code+'，請修正後再匯入。');
      var mastersSet=new Set(parsed.filter(function(x){return x.ship_code===x.account_code;}).map(function(x){return x.account_code;}));
      var orphan=parsed.find(function(x){return !mastersSet.has(x.account_code);});
      if(orphan)throw new Error('寄貨編號 '+orphan.ship_code+' 找不到帳款歸屬主客戶 '+orphan.account_code+'，請檢查 Excel。');
      var masters=parsed.filter(function(x){return x.account_code===x.ship_code;}).length;
      if(parsed.length===0||masters===0)throw new Error('沒有找到可匯入的主客戶與寄貨資料，請確認 Excel 欄位標題與內容');
      if(!confirm('確認建立／更新 '+masters+' 組主客戶與 '+parsed.length+' 筆寄貨選項？同編號資料將依 Excel 更新；不刪除其他客戶或歷史訂單，完成後將自動重新比對尚未關聯的 LINE ORD。')){msg.textContent='已取消匯入';return;}
      msg.textContent='正在寫入 Supabase，請不要關閉頁面…';
      var outcome=await rpc('catalog_import_customer_excel',{p_rows:parsed});
      msg.textContent='已處理主客戶 '+outcome.masters+' 組（新增 '+outcome.new_masters+'）、寄貨選項 '+outcome.shipping_options+' 筆（新增 '+outcome.new_shipping_options+'）；LINE 訂單新增關聯 '+(outcome.relink?.linked||0)+' 張，仍待確認 '+(outcome.relink?.pending_review||0)+' 張。';
      msg.className='message success';
      await loadCommonAdmin();await renderCustomerAdmin();alert('Excel 已匯入並重新比對 LINE ORD，請查看「LINE 訂單與客戶關聯」統計。');
    }catch(err){msg.textContent='匯入失敗：'+err.message;msg.className='message error';}
    finally{btn.disabled=false;}
  };
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

  async function paintOrderLinkReview(search){
  var host=$('catCustomerLinkReview');
  if(!host)return;
  host.innerHTML='<h3>LINE 訂單與客戶關聯</h3><div class="muted">正在讀取待關聯訂單…</div>';
  try{
    var data=await rpc('catalog_customer_link_review',{p_limit:35,p_search:search||null});
    var sharedShipping=await rpc('catalog_get_shared_customer_addresses',{});
    if(!host.isConnected)return;
    var reasons={
      no_verified_match:'尚未找到可核實的客戶',
      shipping_ambiguous:'寄貨資料符合多位客戶',
      buyer_receiver_conflict:'訂購人與寄貨歸屬衝突',
      buyer_ambiguous:'訂購人名稱有重複',
      buyer_code_unknown:'訂貨方的 C 編號未建檔，請核對主客戶或寄貨編號',
      receiver_code_unknown:'收貨方的 C 編號未建檔，請核對寄貨選項',
      explicit_code_conflict:'訂貨方與收貨方的 C 編號歸屬不同主客戶',
      explicit_buyer_code_conflict:'訂貨方 C 編號對應了不同帳款歸屬',
      explicit_receiver_code_conflict:'收貨方 C 編號對應了不同帳款歸屬',
      explicit_code_unresolved:'LINE 客戶編號無法確認',
      未檢查:'尚未檢查'
    };
    var rows=data.results||[];
    host.innerHTML=
      '<div class="catalog-head"><h3>LINE 訂單與客戶關聯</h3><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" id="catLinkExport" class="btn ghost">匯出未關聯客戶 Excel</button><button type="button" id="catLinkRefresh" class="btn ghost">重新比對未關聯 ORD</button></div></div>'+
      '<p class="muted">已關聯 <b>'+Number(data.linked||0)+'</b>／'+Number(data.line_orders||0)+' 張有效 LINE 訂單，仍有 <b style="color:#b42318">'+Number(data.unlinked||0)+'</b> 張待確認。LINE 訂貨方／收貨方若包含 C 編號，系統會優先依客戶與寄貨編號比對；編號不存在或歸屬衝突時請人工確認。</p>'+
      '<div class="catalog-toolbar"><input id="catLinkSearch" aria-label="搜尋未關聯訂單" placeholder="搜尋 ORD 編號、訂購人或收件人" value="'+esc(search||'')+'"><button id="catLinkSearchBtn" class="btn ghost" type="button">搜尋待確認訂單</button></div>'+
      '<div class="cat-link-order-list">'+
        (rows.map(function(o){
          return '<div class="cat-link-order-row">'+
            '<div><b>'+esc(o.order_no)+'</b>｜'+esc(o.buyer||'（未填訂購人）')+' → '+esc(o.receiver||'（未填收件人）')+
            '<div class="muted" style="font-size:12px">'+esc(reasons[o.reason]||o.reason||'待確認')+'</div></div>'+
            '<button type="button" class="btn small ghost" data-cat-pick-unlinked="'+esc(o.order_id)+'">查看資訊／指定客戶</button></div>';
        }).join('')||'<div class="catalog-empty">沒有符合的待確認訂單。</div>')+
      '</div>'+
      '<div id="catLinkManual" class="catalog-block hidden cat-link-manual">'+
        '<h4 id="catLinkManualTitle"></h4>'+
        '<div id="catLinkOrderDetail" class="cat-link-order-detail" aria-live="polite"></div>'+
        '<div class="cat-link-select-grid">'+
          '<div class="cat-link-customer-search">'+
            '<label for="catLinkCustomerQuery">搜尋帳款主客戶（編號／名稱／簡稱）</label>'+
            '<input type="search" id="catLinkCustomerQuery" autocomplete="off" placeholder="例如 C107、麥麥、莊敬" aria-controls="catLinkCustomerMatches">'+
            '<div id="catLinkCustomerMatches" class="cat-link-customer-results" aria-live="polite">輸入客戶編號、名稱或簡稱即可搜尋。</div>'+
            '<div id="catLinkChosenCustomer" class="cat-link-chosen" aria-live="polite">尚未選擇帳款主客戶</div>'+
          '</div>'+
          '<div>'+
            '<label for="catLinkAddressQuery">搜尋寄貨選項（非必要）</label>'+
            '<input type="search" id="catLinkAddressQuery" autocomplete="off" placeholder="姓名、寄貨編號、電話或地址" disabled>'+
            '<label for="catLinkAddressSelect">選擇收件資料</label>'+
            '<select id="catLinkAddressSelect" disabled><option value="">請先選擇主客戶</option></select>'+
            '<div id="catLinkAddressCount" class="muted" style="font-size:12px"></div>'+
          '</div>'+
        '</div>'+
        '<div class="cat-link-actions"><button id="catLinkManualSave" type="button" class="btn primary" disabled>建立關聯（直接儲存）</button>'+
        '<button id="catLinkManualCancel" type="button" class="btn ghost">取消</button></div>'+
        '<div id="catLinkManualMsg" role="status" class="message"></div>'+
      '</div>';

    $('catLinkSearchBtn').onclick=function(){paintOrderLinkReview($('catLinkSearch').value.trim());};
    $('catLinkSearch').onkeydown=function(e){if(e.key==='Enter')paintOrderLinkReview(this.value.trim());};
    $('catLinkExport').onclick=async function(){
      var btn=this;btn.disabled=true;var label=btn.textContent;btn.textContent='正在匯出…';
      try{
        if(!window.XLSX)throw new Error('Excel 匯出元件尚未載入，請重新整理網頁。');
        var all=await restAll('orders?select=tracking_id,order_date,buyer,receiver,receiver_phone,receiver_address,customer_link_review_reason,customer_link_checked_at&order_source=eq.line&customer_id=is.null&deleted_at=is.null&order=tracking_id.desc');
        function code(v){var m=String(v||'').trim().toUpperCase().match(/^([A-Z][0-9]+(?:-[0-9]+)*)(?=$|[\\s｜:：、,，/／（(]|[\\u4e00-\\u9fff])/);return m?m[1]:'';}
        function name(v){return String(v||'').trim().replace(/^[A-Za-z][0-9]+(?:-[0-9]+)*(?=$|[\\s｜:：、,，/／（(]|[\\u4e00-\\u9fff])[\\s｜:：、,，/／（(]*/,'').trim();}
        var headers=['訂單編號','訂單日期','訂購方編號','訂購方名稱','收貨方編號','收件人名稱','收件電話','完整收件地址','未關聯原因','原始訂購方','原始收貨方','人工指定帳款客戶編號','人工指定寄貨編號','備註'];
        var aoa=[headers].concat(all.map(function(o){return [
          'ORD-'+String(o.tracking_id).padStart(6,'0'),o.order_date||'',code(o.buyer),name(o.buyer),
          code(o.receiver),name(o.receiver),o.receiver_phone||'',o.receiver_address||'',
          reasons[o.customer_link_review_reason]||o.customer_link_review_reason||'尚未檢查',
          o.buyer||'',o.receiver||'','','',''
        ];}));
        var wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols']=[{wch:17},{wch:14},{wch:17},{wch:23},{wch:17},{wch:24},{wch:17},{wch:36},{wch:29},{wch:26},{wch:26},{wch:22},{wch:20},{wch:28}];
        ws['!autofilter']={ref:'A1:N'+Math.max(1,aoa.length)};
        XLSX.utils.book_append_sheet(wb,ws,'未關聯LINE訂單');
        XLSX.writeFile(wb,'LINE未關聯客戶訂單_'+new Date().toLocaleDateString('en-CA')+'.xlsx');
      }catch(err){alert('匯出失敗：'+err.message);}finally{btn.disabled=false;btn.textContent=label;}
    };
    $('catLinkRefresh').onclick=async function(){
      this.disabled=true;
      try{
        var outcome=await rpc('catalog_relink_order_customers',{});
        alert('重新比對完成：新增關聯 '+outcome.linked+' 張、待確認 '+outcome.pending_review+' 張。');
        await paintOrderLinkReview(search);
      }catch(err){alert('重新比對失敗：'+err.message);this.disabled=false;}
    };

    var selectedOrderId=null,selectedCustomerId=null,detailReady=false,detailRequestId=0;
    var customers=state.customers.filter(function(c){return c.active;}).slice().sort(function(a,b){
      return String(a.customer_code||'').localeCompare(String(b.customer_code||''),'zh-Hant',{numeric:true});
    });
    function normalized(t){return String(t||'').toLowerCase().replace(/\s+/g,'');}
    function updateSaveButton(){$('catLinkManualSave').disabled=!detailReady||!selectedOrderId||!selectedCustomerId;}
    function renderCustomerMatches(){
      var target=$('catLinkCustomerMatches'),q=normalized($('catLinkCustomerQuery').value.trim());
      if(selectedCustomerId){target.innerHTML='';target.classList.add('hidden');return;}
      target.classList.remove('hidden');
      if(!q){target.innerHTML='<div class="muted">輸入主客戶編號、名稱或簡稱搜尋。</div>';return;}
      var matches=customers.filter(function(c){
        return normalized(c.customer_code+' '+c.name+' '+(c.import_short_name||'')+' '+(c.contact_name||'')+' '+(c.phone||'')).includes(q);
      });
      var shown=matches.slice(0,35);
      target.innerHTML=(shown.map(function(c){
        var count=addresses.filter(function(a){
          return a.active && (a.customer_id===c.id||sharedShipping.some(function(sh){return sh.customer_id===c.id&&sh.address_id===a.id;}));
        }).length;
        return '<button type="button" class="cat-link-customer-result" data-cat-select-customer="'+esc(c.id)+'">'+
          '<b>'+esc(c.customer_code)+'｜'+esc(c.name)+'</b>'+
          '<span>'+esc(c.import_short_name||c.contact_name||'')+'　寄貨選項 '+count+' 筆</span></button>';
      }).join('')||'<div class="muted">查無符合的主客戶，請換關鍵字。</div>')+
        (matches.length>35?'<div class="muted">共 '+matches.length+' 位，請輸入更多字縮小範圍。</div>':'');
      target.querySelectorAll('[data-cat-select-customer]').forEach(function(b){b.onclick=function(){chooseCustomer(b.dataset.catSelectCustomer);};});
    }
    function renderAddressOptions(){
      var inp=$('catLinkAddressQuery'),pick=$('catLinkAddressSelect'),summary=$('catLinkAddressCount');
      if(!selectedCustomerId){inp.disabled=true;pick.disabled=true;pick.innerHTML='<option value="">請先選擇主客戶</option>';summary.textContent='';return;}
      inp.disabled=false;pick.disabled=false;
      var all=addresses.filter(function(a){
        return a.active && (a.customer_id===selectedCustomerId || sharedShipping.some(function(sh){
          return sh.customer_id===selectedCustomerId&&sh.address_id===a.id;
        }));
      });
      var q=normalized(inp.value);
      var shown=all.filter(function(a){
        return !q||normalized((a.import_ship_code||'')+' '+(a.receiver_name||'')+' '+(a.import_short_name||'')+' '+(a.phone||'')+' '+(a.address||'')).includes(q);
      });
      pick.innerHTML='<option value="">不指定寄貨選項（僅關聯主客戶）</option>'+shown.map(function(a){
        return '<option value="'+esc(a.id)+'">'+esc((a.customer_id!==selectedCustomerId?'【授權寄貨】':'')+
          (a.import_ship_code||'地址')+'｜'+(a.receiver_name||'未填收件人')+'｜'+(a.phone||'無電話')+'｜'+(a.address||'無地址'))+'</option>';
      }).join('');
      var sharedCount=all.filter(function(a){return a.customer_id!==selectedCustomerId;}).length;
      summary.textContent='顯示 '+shown.length+'／'+all.length+' 個寄貨選項'+
        (sharedCount?'（含 '+sharedCount+' 個已授權跨主客戶寄貨）':'')+'。請核對收件人及地址後再選擇。';
    }
    function chooseCustomer(customerId){
      var c=customers.find(function(v){return v.id===customerId;});
      if(!c)return;
      selectedCustomerId=c.id;
      $('catLinkCustomerQuery').value=c.customer_code+'｜'+c.name;
      $('catLinkChosenCustomer').innerHTML='<b>已選擇帳款主客戶：'+esc(c.customer_code)+'｜'+esc(c.name)+'</b>'+
        '<button type="button" id="catLinkChangeCustomer" class="btn small ghost">變更</button>';
      $('catLinkChangeCustomer').onclick=function(){
        selectedCustomerId=null;$('catLinkCustomerQuery').value='';$('catLinkChosenCustomer').textContent='尚未選擇帳款主客戶';
        $('catLinkAddressQuery').value='';renderAddressOptions();renderCustomerMatches();updateSaveButton();$('catLinkCustomerQuery').focus();
      };
      $('catLinkAddressQuery').value='';renderAddressOptions();renderCustomerMatches();updateSaveButton();
    }
    $('catLinkCustomerQuery').oninput=function(){
      selectedCustomerId=null;$('catLinkChosenCustomer').textContent='尚未選擇帳款主客戶';
      $('catLinkAddressQuery').value='';renderAddressOptions();renderCustomerMatches();updateSaveButton();
    };
    $('catLinkCustomerQuery').onkeydown=function(e){
      if(e.key==='Enter'){
        var first=$('catLinkCustomerMatches').querySelector('[data-cat-select-customer]');
        if(first){e.preventDefault();first.click();}
      }
    };
    $('catLinkAddressQuery').oninput=renderAddressOptions;

    function renderOrderDetail(d){
      var items=d.items||[];
      var html='<div class="cat-link-order-facts">'+
        '<div><b>訂單日期</b><span>'+esc(d.order_date||'—')+'</span></div>'+
        '<div><b>出貨廠商</b><span>'+esc([d.vendor_code,d.vendor_name].filter(Boolean).join('｜')||d.source_shipper_text||'—')+'</span></div>'+
        '<div><b>訂購人</b><span>'+esc(d.buyer||'未提供')+'</span></div>'+
        '<div><b>收件人</b><span>'+esc(d.receiver||'未提供')+'</span></div>'+
        '<div><b>收件電話</b><span>'+esc(d.receiver_phone||'未提供')+'</span></div>'+
        '<div><b>訂單狀態</b><span>'+esc(d.status||'—')+'</span></div>'+
        '<div class="cat-link-full"><b>完整收貨地址</b><span>'+esc(d.receiver_address||'未提供')+'</span></div>'+
        '<div class="cat-link-full"><b>預計交期</b><span>'+esc(d.expected_deadline||'—')+'</span></div>'+
      '</div>'+
      '<div class="cat-link-items-wrap"><table><thead><tr>'+
        '<th>商品編號／名稱</th><th>規格</th><th>訂購量</th><th>已出貨</th></tr></thead><tbody>'+
        (items.map(function(x){return '<tr><td>'+esc(x.product_code||'')+' '+esc(x.product_name||'')+'</td>'+
          '<td>'+esc(x.variant||'—')+'</td><td>'+esc(x.quantity??0)+' '+esc(x.unit||'')+'</td>'+
          '<td>'+esc(x.shipped??0)+'</td></tr>';}).join('')||'<tr><td colspan="4">此訂單沒有商品明細</td></tr>')+
      '</tbody></table></div>'+
      (d.original_message?'<details class="cat-link-original"><summary>查看原始 LINE 訂單文字</summary><pre>'+esc(d.original_message)+'</pre></details>':'');
      $('catLinkOrderDetail').innerHTML=html;
    }
    function getLineCode(value){
      var match=String(value||'').trim().toUpperCase().match(/^([A-Z][0-9]+(?:-[0-9]+)*)(?=$|[\s｜:：、,，/／（(]|[\u4e00-\u9fff])/);
      return match?match[1]:null;
    }
    function suggestAccountAndAddress(order){
      var buyerCode=getLineCode(order.buyer),receiverCode=getLineCode(order.receiver);
      var c=customers.find(function(x){return x.customer_code===buyerCode;});
      if(!c)return;
      chooseCustomer(c.id);
      if(!receiverCode)return;
      var available=addresses.filter(function(a){
        return a.active&&a.import_ship_code===receiverCode &&
          (a.customer_id===c.id||sharedShipping.some(function(sh){
            return sh.customer_id===c.id&&sh.address_id===a.id;
          }));
      });
      if(available.length!==1)return;
      $('catLinkAddressQuery').value=receiverCode;
      renderAddressOptions();
      $('catLinkAddressSelect').value=available[0].id;
      $('catLinkAddressCount').textContent+=' 已依 LINE 收件編號自動帶入；按「建立關聯」即可直接儲存。';
    }
    host.querySelectorAll('[data-cat-pick-unlinked]').forEach(function(b){
      b.onclick=async function(){
        var id=b.dataset.catPickUnlinked,item=rows.find(function(x){return x.order_id===id;});
        selectedOrderId=id;selectedCustomerId=null;detailReady=false;detailRequestId++;
        var token=detailRequestId;
        $('catLinkManual').classList.remove('hidden');
        $('catLinkManualTitle').textContent=(item?.order_no||'ORD')+'｜'+(item?.buyer||'')+' → '+(item?.receiver||'');
        $('catLinkOrderDetail').innerHTML='<div class="muted">正在載入完整訂單與商品明細…</div>';
        $('catLinkCustomerQuery').value='';$('catLinkChosenCustomer').textContent='尚未選擇帳款主客戶';
        $('catLinkAddressQuery').value='';renderAddressOptions();renderCustomerMatches();updateSaveButton();
        $('catLinkManualMsg').textContent='';
        $('catLinkManual').scrollIntoView({behavior:'smooth',block:'nearest'});
        try{
          var detail=await rpc('catalog_customer_link_order_detail',{p_order_id:id});
          if(selectedOrderId!==id||token!==detailRequestId)return;
          renderOrderDetail(detail);detailReady=true;suggestAccountAndAddress(detail);updateSaveButton();
        }catch(err){
          if(token!==detailRequestId)return;
          $('catLinkOrderDetail').innerHTML='<div class="message error">訂單資訊讀取失敗：'+esc(err.message)+'</div>';
          detailReady=false;updateSaveButton();
        }
      };
    });
    $('catLinkManualCancel').onclick=function(){
      detailRequestId++;selectedOrderId=null;selectedCustomerId=null;detailReady=false;
      $('catLinkManual').classList.add('hidden');
    };
    $('catLinkManualSave').onclick=async function(){
      if(!selectedOrderId||!selectedCustomerId||!detailReady){
        $('catLinkManualMsg').textContent='請先查看訂單內容並搜尋選擇主客戶。';return;
      }
      var cid=selectedCustomerId,c=customers.find(function(x){return x.id===cid;});
      var addressId=$('catLinkAddressSelect').value||null;
      var chosenAddress=addresses.find(function(a){return a.id===addressId;});
      var orderLabel=$('catLinkManualTitle').textContent;
      this.disabled=true;
      try{
        var out=await rpc('catalog_set_order_customer',{
          p_order_id:selectedOrderId,p_customer_id:cid,p_address_id:addressId
        });
        await paintOrderLinkReview(search);
        var panel=$('catCustomerLinkReview');
        var heading=panel&&panel.querySelector('.catalog-head');
        if(heading){
          var notice=document.createElement('div');
          notice.className='message success';
          notice.setAttribute('role','status');
          notice.textContent='已建立 '+out.order_no+' → '+out.customer_code+' 的客戶關聯，可繼續處理下一張訂單。';
          heading.insertAdjacentElement('afterend',notice);
        }
      }catch(err){$('catLinkManualMsg').textContent='指定失敗：'+err.message;updateSaveButton();}
    };
  }catch(err){
    host.innerHTML='<h3>LINE 訂單與客戶關聯</h3><div class="message error">讀取失敗：'+esc(err.message)+'</div>';
  }
}
    paint();$('catCustomerSearch').oninput=paint;$('catCustomerLevelFilter').onchange=paint;$('catCustomerRefresh').onclick=renderCustomerAdmin;
  paintOrderLinkReview('');
}
function openCustomerAddresses(customerId,addresses,onSaved){
  var customer=state.customers.find(function(x){return x.id===customerId;});
  if(!customer){alert('找不到客戶資料，請重新整理');return;}
  var old=$('catAddressAdminModal');if(old)old.remove();
  var modal=document.createElement('div');
  modal.id='catAddressAdminModal';
  modal.className='catalog-modal';
  modal.innerHTML='<div class="catalog-modal-card cat-address-manager">'+
    '<div class="catalog-modal-head"><h2>'+esc(customer.customer_code+'｜'+customer.name)+'｜收件資料</h2>'+
    '<button type="button" class="catalog-close" data-close aria-label="關閉">×</button></div>'+
    '<p class="muted">所有寄貨選項歸屬此帳款主客戶。新增收件人時自動分配寄貨編號；編輯既有資料時保留原編號，不修改歷史 ORD 收件快照。</p>'+
    '<div class="cat-address-toolbar"><b id="catAddrCount"></b><button type="button" class="btn primary" id="catAddrAdd">＋新增收件資料</button></div>'+
    '<div id="catAddrNotice" class="message" role="status"></div>'+
    '<div id="catAddrEditor" class="cat-address-edit hidden">'+
    '<h3 id="catAddrEditorTitle">新增收件資料</h3>'+
    '<form id="catAddrForm" class="cat-address-form">'+
    '<label>收件人姓名 <span class="cat-address-required">＊</span><input name="receiver_name" maxlength="150" required placeholder="姓名或收件單位"></label>'+
    '<label>寄貨簡稱<input name="short_name" maxlength="150" placeholder="方便搜尋，可選填"></label>'+
    '<label>收件電話 <span class="cat-address-required">＊</span><input name="phone" type="tel" maxlength="80" required placeholder="手機或市話，保留前面的 0"></label>'+
    '<label>類別／分類<input name="category" maxlength="100" placeholder="可選填"></label>'+
    '<label class="cat-address-wide">完整收件地址 <span class="cat-address-required">＊</span><textarea name="address" maxlength="1000" rows="3" required placeholder="縣市、鄉鎮區、街路門牌及收件時間備註"></textarea></label>'+
    '<label class="cat-address-check"><input type="checkbox" name="is_default" value="1"> 設為此客戶的預設收件資料</label>'+
    '<div class="cat-address-wide cat-address-actions"><button type="submit" class="btn primary" id="catAddrSave">儲存收件資料</button><button type="button" class="btn ghost" id="catAddrCancel">取消</button></div>'+
    '</form></div>'+
    '<div id="catAddrRows" class="cat-address-list"></div></div>';
  document.body.appendChild(modal);
  var editingId=null, saving=false;
  function list(){
    return addresses.filter(function(a){return a.customer_id===customerId&&a.active!==false;})
      .sort(function(a,b){return Number(!!b.is_default)-Number(!!a.is_default)||
        String(a.import_ship_code||'').localeCompare(String(b.import_ship_code||''),'zh-Hant',{numeric:true});});
  }
  function renderList(){
    var rows=list();
    modal.querySelector('#catAddrCount').textContent='目前 '+rows.length+' 組收件／寄貨選項';
    modal.querySelector('#catAddrRows').innerHTML=rows.map(function(a){
      return '<div class="catalog-myorder cat-address-entry">'+
        '<div class="cat-address-entry-info"><b>'+ (a.is_default?'★ 預設｜':'')+
        esc((a.import_ship_code||'自訂寄貨')+'｜'+(a.receiver_name||'未填收件人'))+'</b>'+
        (a.import_short_name?'<div>簡稱：'+esc(a.import_short_name)+'</div>':'')+
        (a.import_category?'<div>分類：'+esc(a.import_category)+'</div>':'')+
        '<div>電話：'+esc(a.phone||'未提供')+'</div>'+
        '<div>完整地址：'+esc(a.address||'未提供')+'</div>'+
        '<div class="muted">歷史訂單 '+esc(a.source_order_count||0)+' 筆</div></div>'+
        '<button type="button" class="btn ghost" data-edit-recipient="'+esc(a.id)+'">編輯資料</button></div>';
    }).join('')||'<div class="catalog-empty">尚未建立收件資料，請按「新增收件資料」。</div>';
    modal.querySelectorAll('[data-edit-recipient]').forEach(function(b){
      b.onclick=function(){openEditor(b.dataset.editRecipient);};
    });
  }
  function openEditor(addressId){
    var existing=addressId?list().find(function(a){return a.id===addressId;}):null;
    if(addressId&&!existing){alert('找不到指定收件資料，請重新整理');return;}
    editingId=existing?existing.id:null;
    var form=modal.querySelector('#catAddrForm');
    form.reset();
    form.elements.namedItem('receiver_name').value=existing?.receiver_name||'';
    form.elements.namedItem('short_name').value=existing?.import_short_name||'';
    form.elements.namedItem('phone').value=existing?.phone||'';
    form.elements.namedItem('category').value=existing?.import_category||'';
    form.elements.namedItem('address').value=existing?.address||'';
    form.elements.namedItem('is_default').checked=existing?!!existing.is_default:!list().some(function(a){return a.is_default;});
    modal.querySelector('#catAddrEditorTitle').textContent=existing?
      '編輯｜'+(existing.import_ship_code||'收件資料')+'｜'+(existing.receiver_name||''):
      '新增收件資料｜自動產生 '+customer.customer_code+' 子編號';
    modal.querySelector('#catAddrEditor').classList.remove('hidden');
    modal.querySelector('#catAddrNotice').textContent='';
    modal.querySelector('#catAddrEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
    form.elements.namedItem('receiver_name').focus({preventScroll:true});
  }
  modal.querySelector('#catAddrAdd').onclick=function(){openEditor(null);};
  modal.querySelector('#catAddrCancel').onclick=function(){modal.querySelector('#catAddrEditor').classList.add('hidden');editingId=null;};
  modal.querySelector('[data-close]').onclick=function(){modal.remove();};
  modal.querySelector('#catAddrForm').onsubmit=async function(e){
    e.preventDefault();if(saving)return;
    var form=this;
    var name=String(form.elements.namedItem('receiver_name').value||'').trim();
    var phone=String(form.elements.namedItem('phone').value||'').trim();
    var address=String(form.elements.namedItem('address').value||'').trim();
    if(!name||!phone||!address){modal.querySelector('#catAddrNotice').textContent='請填寫收件人、電話及完整地址。';return;}
    var btn=modal.querySelector('#catAddrSave');
    saving=true;btn.disabled=true;modal.querySelector('#catAddrNotice').textContent='正在儲存收件資料…';
    try{
      var out=await rpc('catalog_staff_save_customer_address',{
        p_customer_id:customerId,p_address_id:editingId,
        p_receiver_name:name,p_phone:phone,p_address:address,
        p_short_name:String(form.elements.namedItem('short_name').value||'').trim(),
        p_category:String(form.elements.namedItem('category').value||'').trim(),
        p_is_default:form.elements.namedItem('is_default').checked
      });
      if(typeof onSaved==='function')addresses=await onSaved();
      else addresses=await restAll('customer_addresses?select=*&active=eq.true&order=is_default.desc,last_used_at.desc,id.asc');
      renderList();
      editingId=null;
      modal.querySelector('#catAddrEditor').classList.add('hidden');
      modal.querySelector('#catAddrNotice').textContent=
        '已儲存 '+(out.ship_code||'收件資料')+'（'+(out.action==='create'?'新增':'修改')+'）。';
      modal.querySelector('#catAddrNotice').className='message success';
    }catch(err){
      modal.querySelector('#catAddrNotice').textContent='儲存失敗：'+err.message;
      modal.querySelector('#catAddrNotice').className='message error';
    }finally{saving=false;btn.disabled=false;}
  };
  renderList();
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
  document.body.appendChild(d);d.querySelectorAll('[data-cat-close]').forEach(function(x){x.addEventListener('click',function(){if($('catSaveProduct').disabled)return;resetPendingProductImages();d.classList.add('hidden');});});$('catSaveProduct').addEventListener('click',saveProduct);document.addEventListener('paste',handleProductImagePaste);
}

// V2.87: Make product-editor amounts replaceable with one tap, including iPad Safari.
// Keep numeric validation explicit because inputmode alone does not validate text fields.
function normalizeProductNumberText(value){
  var raw=String(value==null?'':value).trim()
    .replace(/[０-９]/g,function(c){return String(c.charCodeAt(0)-65296);})
    .replace(/[．。]/g,'.').replace(/[－−]/g,'-').replace(/，/g,',');
  if(/^[+-]?\d{1,3}(,\d{3})+(?:\.\d+)?$/.test(raw))raw=raw.replace(/,/g,'');
  return raw;
}
function validateProductNumericInput(input){
  var raw=normalizeProductNumberText(input.value);
  if(raw==='')return null; // Empty tier prices, limits and minimum overrides retain their existing meaning.
  var label=(input.closest('label')?.firstChild?.textContent||input.getAttribute('aria-label')||'數字欄位').trim();
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw))
    throw new Error('「'+label+'」請輸入有效數字，例如 60 或 24.5');
  var number=Number(raw),min=input.dataset.catNumericMin,max=input.dataset.catNumericMax;
  if(!Number.isFinite(number))throw new Error('「'+label+'」數值無效');
  if(min!==undefined&&min!==''&&number<Number(min))
    throw new Error('「'+label+'」不可小於 '+min);
  if(max!==undefined&&max!==''&&number>Number(max))
    throw new Error('「'+label+'」不可大於 '+max);
  if(input.dataset.catNumericStep==='0.01'&&
     Math.abs(number*100-Math.round(number*100))>1e-7)
    throw new Error('「'+label+'」最多可輸入小數兩位');
  return {raw:raw,number:number};
}
function setupProductNumericInputs(scope){
  if(!scope)return;
  scope.querySelectorAll('input[type="number"],input[data-cat-numeric="1"]').forEach(function(input){
    if(input.dataset.catNumeric==='1')return;
    input.dataset.catNumeric='1';
    input.dataset.catNumericMin=input.getAttribute('min')||'';
    input.dataset.catNumericMax=input.getAttribute('max')||'';
    input.dataset.catNumericStep=input.getAttribute('step')||'any';
    // type=text supports select() on desktop and Safari; inputmode opens the mobile decimal pad.
    input.type='text';input.inputMode='decimal';input.autocomplete='off';
    input.spellcheck=false;input.enterKeyHint='done';
    input.classList.add('cat-direct-numeric');
    var firstPointer=false;
    input.addEventListener('focus',function(){
      firstPointer=true;input.select();
    });
    input.addEventListener('pointerup',function(e){
      if(firstPointer){e.preventDefault();input.select();firstPointer=false;}
    });
    input.addEventListener('keydown',function(){firstPointer=false;});
    input.addEventListener('blur',function(){
      firstPointer=false;
      try{
        var parsed=validateProductNumericInput(input);
        if(parsed!==null)input.value=parsed.raw;
        input.removeAttribute('aria-invalid');input.removeAttribute('title');
      }catch(err){input.setAttribute('aria-invalid','true');input.title=err.message;}
    });
    input.addEventListener('input',function(){input.removeAttribute('aria-invalid');input.removeAttribute('title');});
  });
}
function validateProductNumericInputs(scope){
  if(!scope)return;
  scope.querySelectorAll('input[data-cat-numeric="1"]').forEach(function(input){
    try{
      var parsed=validateProductNumericInput(input);
      if(parsed!==null)input.value=parsed.raw;
      input.removeAttribute('aria-invalid');
    }catch(err){input.setAttribute('aria-invalid','true');input.focus();throw err;}
  });
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
    '<label>商品專區<select id="catPClearance"><option value="normal" '+(!p.is_clearance?'selected':'')+'>一般商品</option><option value="clearance" '+(p.is_clearance?'selected':'')+'>出清優惠專區</option></select></label>'+ 
    '<label>販售模式<select id="catPMode"><option value="preorder" '+(p.sale_mode==='preorder'?'selected':'')+'>預購</option><option value="in_stock" '+(p.sale_mode==='in_stock'?'selected':'')+'>現貨</option></select></label>'+
    '<label>一般批發價 <span class="muted cat-number-hint">（點一下直接覆蓋）</span><input id="catPBase" type="number" min="0" step="0.01" value="'+esc(p.base_price||0)+'"></label>'+
    '<label>銷售總量上限（空白＝不限）<input id="catPMaxSales" type="number" min="1" step="any" value="'+esc(p.max_sales_quantity==null?'':p.max_sales_quantity)+'" placeholder="不限量"></label>'+ 
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
    '<div class="catalog-block"><h3>快速建立商品規格</h3><p class="muted">每行一個規格，不用輸入直線分隔符號。可以寫「A、黑色」、「B - 灰色」或直接寫「黑色」、「灰色」。每行自動新增一列；多層組合才使用「尺寸 - M、L」等格式（最多三層）。</p><textarea id="catPDimensions" style="width:100%;min-height:100px" placeholder="A、黑色\nB - 灰色"></textarea><button id="catGenerateVariants" type="button" class="btn secondary">依輸入行數自動新增規格</button><div id="catDimensionMsg" class="muted" role="status" aria-live="polite"></div></div>'+ 
    '<div class="catalog-block"><h3>商品規格明細</h3><p class="muted">直接逐列編輯規格，或按「新增規格」。停售或缺貨不會刪除歷史訂單。</p><div id="catVariantRows"></div><button type="button" id="catAddVariant" class="btn secondary" style="margin-top:9px">＋新增規格</button><textarea id="catPVariants" style="display:none">'+esc(variantsText(id))+'</textarea></div>'+
    '<div class="catalog-block"><h3>商品圖片（可多張）</h3>'+
    '<input id="catPImages" type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" multiple hidden>'+
    '<div id="catImageDropZone" class="cat-image-dropzone" role="button" tabindex="0" aria-label="拖入或選擇商品圖片">'+
    '<div class="cat-image-dropzone-title">📷 將照片拖曳到這裡</div>'+
    '<div class="cat-image-dropzone-help">支援從電腦資料夾、電腦版 LINE 群組拖曳；也可複製圖片後在此按 Ctrl+V 貼上。</div>'+
    '<button type="button" class="btn secondary" id="catImageChooseFiles">選擇照片（可多張）</button></div>'+
    '<div id="catPendingImageStatus" class="muted cat-image-status" role="status">尚未加入新照片。</div>'+
    '<div id="catPendingImageGrid" class="catalog-image-list cat-pending-image-grid"></div>'+
    '<p class="muted cat-image-hint">支援 JPG、PNG、WEBP、GIF；每張上限 20MB。拖入後先顯示預覽，按「儲存商品」才正式上傳。若 LINE 不允許直接拖出圖片，可在 LINE 複製圖片後貼上，或先儲存到電腦再拖入。</p>'+
    '<div id="catExistingImages" class="catalog-image-list">'+renderImageAdmin(id)+'</div></div>';
  $('catAddVendorPrice').addEventListener('click',function(){$('catVendorPriceRows').insertAdjacentHTML('beforeend',vendorPriceRow(null));bindVendorPriceRemove();setupProductNumericInputs($('catVendorPriceRows'));});
  $('catGenerateVariants').onclick=function(){
    var notice=$('catDimensionMsg');
    try{
      var result=parseQuickVariantInput($('catPDimensions').value,$('catPCode').value.trim());
      var existing=parseVariants($('catPVariants').value);
      var used=new Set();
      var rows=result.variants.map(function(v){
        var match=existing.find(function(e){return !used.has(e)&&e.sku_code===v.sku_code;})||
          existing.find(function(e){return !used.has(e)&&e.name===v.name;});
        if(match)used.add(match);
        var sku=match&&match.sku_code||v.sku_code;
        return [sku,v.name,match?match.price_delta:0,
          match&&match.min_order_qty!=null?match.min_order_qty:'',
          match&&match.sale_status?match.sale_status:'available'].join('｜');
      });
      var ta=$('catPVariants');
      if(ta.value.trim()&&!confirm('將以下方新產生的 '+rows.length+' 列規格取代目前明細；相同編號或名稱的規格會保留既有價格及狀態。確定繼續？'))return;
      ta.value=rows.join('\n');
      renderVariantRows();
      notice.textContent='已自動新增 '+rows.length+' 列'+(result.mode==='layers'?'多層組合':'規格')+'，請確認下方明細後按「儲存商品」。';
      notice.className='message success';
    }catch(e){
      notice.textContent='無法產生：'+e.message;
      notice.className='message error';
    }
  };
  renderVariantRows();
  $('catAddVariant').onclick=function(){syncVariantRows();$('catPVariants').value+=($('catPVariants').value?'\n':'')+'｜新規格｜0｜1｜available';renderVariantRows();};
  setupProductNumericInputs($('catProductBody'));
  bindVendorPriceRemove();bindImageAdmin();
  resetPendingProductImages();bindProductImageInput();
  $('catProductModal').classList.remove('hidden');
}
function toLocalInput(v){if(!v)return '';var d=new Date(v),off=d.getTimezoneOffset();return new Date(d.getTime()-off*60000).toISOString().slice(0,16);}
function variantsText(id){return state.variants.filter(function(v){return v.product_id===id;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);}).map(function(v){return [v.sku_code||'',v.name||'',v.price_delta||0,v.min_order_qty||'',v.sale_status||(v.active===false?'discontinued':'available')].join('｜');}).join('\n');}
function vendorPriceRow(x){
  x=x||{};return '<div class="catalog-vendor-price-row"><label class="wide">客戶<select data-vp-customer>'+state.customers.filter(function(v){return v.active;}).map(function(v){return '<option value="'+v.id+'" '+(x.customer_id===v.id?'selected':'')+'>'+esc(v.customer_code+' '+v.name)+'</option>';}).join('')+'</select></label><label>專屬價<input data-vp-price type="number" min="0" step="0.01" value="'+(x.price!=null?esc(x.price):'')+'"></label><label>最低量<input data-vp-min type="number" min="0" step="any" value="'+(x.min_order_qty!=null?esc(x.min_order_qty):'')+'"></label><button type="button" class="btn ghost" data-vp-remove>移除</button></div>';
}
function bindVendorPriceRemove(){$('catVendorPriceRows').querySelectorAll('[data-vp-remove]').forEach(function(b){b.onclick=function(){b.closest('.catalog-vendor-price-row').remove();};});}
function resetPendingProductImages(){
  pendingProductImages.forEach(function(x){URL.revokeObjectURL(x.url);});
  pendingProductImages=[];
}
function renderPendingProductImages(message){
  var grid=$('catPendingImageGrid'),label=$('catPendingImageStatus');if(!grid||!label)return;
  grid.innerHTML=pendingProductImages.map(function(x){
    return '<div class="catalog-image-item cat-pending-image-item" data-pending-image="'+esc(x.id)+'">'+
      '<img src="'+esc(x.url)+'" alt="'+esc(x.file.name)+'">'+
      '<div class="cat-image-filename" title="'+esc(x.file.name)+'">'+esc(x.file.name)+'</div>'+
      '<div class="catalog-image-actions"><span class="cat-image-queued">待上傳</span>'+
      '<button type="button" class="btn ghost" data-remove-pending="'+esc(x.id)+'">移除</button></div></div>';
  }).join('');
  label.textContent=message||(pendingProductImages.length?
    '已選擇 '+pendingProductImages.length+' 張照片，按「儲存商品」才會上傳。':
    '尚未加入新照片。');
  grid.querySelectorAll('[data-remove-pending]').forEach(function(b){b.onclick=function(){
    var index=pendingProductImages.findIndex(function(x){return x.id===b.dataset.removePending;});
    if(index>=0){URL.revokeObjectURL(pendingProductImages[index].url);pendingProductImages.splice(index,1);renderPendingProductImages();}
  };});
}
function validProductImage(file){
  if(!file||!file.size)throw new Error('有一張圖片是空檔案。');
  if(file.size>20*1024*1024)throw new Error((file.name||'圖片')+' 超過 20MB，未加入。');
  var mime=String(file.type||'').toLowerCase();
  var nameOk=/\.(jpe?g|png|webp|gif)$/i.test(file.name||'');
  var mimeOk=/^image\/(jpeg|png|webp|gif)$/.test(mime);
  if((mime&&mime!=='application/octet-stream'&&!mimeOk)||(!mimeOk&&!nameOk))
    throw new Error((file.name||'檔案')+' 不是支援的圖片格式（JPG、PNG、WEBP、GIF）。');
}
function addPendingProductImages(files,source){
  var added=0,errors=[];
  Array.from(files||[]).forEach(function(file){
    try{
      validProductImage(file);
      var mime=String(file.type||'').toLowerCase();
      if(!/^image\/(jpeg|png|webp|gif)$/.test(mime)){
        var extension=(file.name||'').match(/\.(jpe?g|png|webp|gif)$/i);
        var ext=extension[1].toLowerCase();
        var inferred=(ext==='jpg'||ext==='jpeg')?'image/jpeg':'image/'+ext;
        file=new File([file],file.name,{type:inferred,lastModified:file.lastModified||Date.now()});
      }
      if(!/\.(jpe?g|png|webp|gif)$/i.test(file.name||'')){
        var suffix={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}[file.type];
        file=new File([file],'LINE_照片_'+Date.now()+'_'+(pendingImageSequence+1)+'.'+suffix,{type:file.type});
      }
      if(pendingProductImages.length>=80)throw new Error('單次最多保留 80 張待上傳照片。');
      if(pendingProductImages.some(function(x){
        return x.file.name===file.name&&x.file.size===file.size&&x.file.lastModified===file.lastModified;
      }))return;
      pendingProductImages.push({id:String(++pendingImageSequence),file:file,url:URL.createObjectURL(file)});
      added++;
    }catch(err){errors.push(err.message);}
  });
  var msg=errors.length?errors.join('；'):null;
  if(added)msg='已從'+(source||'檔案')+'加入 '+added+' 張，待上傳共 '+pendingProductImages.length+' 張。'+(msg?' '+msg:'');
  renderPendingProductImages(msg);
}
async function productImageFromDragHtml(dt){
  var html='',raw='';
  try{
    html=dt.getData('text/html')||'';
    var uriText=dt.getData('text/uri-list')||'';
    var urls=uriText.split(/\r?\n/).map(function(x){return x.trim();}).filter(function(x){return x&&!x.startsWith('#');});
    if(urls.length)raw=urls[0];
  }catch(e){}
  if(html){
    var doc=new DOMParser().parseFromString(html,'text/html'),image=doc.querySelector('img[src]');
    if(image)raw=image.getAttribute('src')||raw;
  }
  if(!raw)return null;
  if(raw.startsWith('//'))raw=location.protocol+raw;
  var url;try{url=new URL(raw,location.href);}catch(e){return null;}
  if(!['https:','http:','blob:','data:'].includes(url.protocol))
    throw new Error('LINE 未提供可讀取的圖片檔案；請在 LINE 對圖片按右鍵複製，再到此處 Ctrl+V 貼上。');
  if(url.protocol==='data:'&&raw.length>28*1024*1024)throw new Error('拖入的圖片超過 20MB 上限。');
  var response;
  try{response=await fetch(url.href,{mode:'cors',credentials:'omit'});}catch(e){
    throw new Error('LINE 圖片來源不允許網頁直接讀取；請複製圖片再按 Ctrl+V 貼上，或先存到電腦。');
  }
  if(!response.ok)throw new Error('圖片連結無法讀取，請改用複製貼上或儲存後拖入。');
  var mime=(response.headers.get('Content-Type')||'').split(';')[0].toLowerCase();
  if(!/^image\/(jpeg|png|webp|gif)$/.test(mime))throw new Error('拖入的連結不是可上傳的圖片。請複製圖片本身後貼上。');
  var sizeHeader=Number(response.headers.get('Content-Length')||0);
  if(sizeHeader>20*1024*1024)throw new Error('拖入的圖片超過 20MB 上限。');
  var blob=await response.blob();
  if(!blob.size||blob.size>20*1024*1024)throw new Error('圖片為空或超過 20MB。');
  var ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'}[mime];
  return new File([blob],'LINE_圖片_'+Date.now()+'.'+ext,{type:mime});
}
function bindProductImageInput(){
  var picker=$('catPImages'),zone=$('catImageDropZone'),choose=$('catImageChooseFiles'),modal=$('catProductModal');
  if(!picker||!zone||!modal)return;
  picker.onchange=function(){addPendingProductImages(picker.files,'選擇的檔案');picker.value='';};
  choose.onclick=function(e){e.stopPropagation();picker.click();};
  zone.onclick=function(e){if(!e.target.closest('button'))picker.click();};
  zone.onkeydown=function(e){if((e.key==='Enter'||e.key===' ')&&e.target===zone){e.preventDefault();picker.click();}};
  zone.ondragover=function(e){e.preventDefault();e.dataTransfer.dropEffect='copy';zone.classList.add('is-dragging');};
  zone.ondragleave=function(e){if(!zone.contains(e.relatedTarget))zone.classList.remove('is-dragging');};
  zone.ondrop=async function(e){
    e.preventDefault();e.stopPropagation();zone.classList.remove('is-dragging');
    var files=Array.from(e.dataTransfer.files||[]);
    if(!files.length)files=Array.from(e.dataTransfer.items||[]).filter(function(x){return x.kind==='file';}).map(function(x){return x.getAsFile();}).filter(Boolean);
    if(files.length){addPendingProductImages(files,'拖曳');return;}
    try{
      renderPendingProductImages('正在讀取拖入的圖片…');
      var image=await productImageFromDragHtml(e.dataTransfer);
      if(image)addPendingProductImages([image],'LINE 圖片');
      else renderPendingProductImages('沒有取得圖片檔案。請在 LINE 複製圖片，再在這裡按 Ctrl+V；或先將圖片存到電腦。');
    }catch(err){renderPendingProductImages(err.message);}
  };
}
function handleProductImagePaste(e){
  var modal=$('catProductModal');
  if(!modal||modal.classList.contains('hidden')||!e.clipboardData)return;
  var files=Array.from(e.clipboardData.files||[]);
  if(!files.length)files=Array.from(e.clipboardData.items||[]).filter(function(x){
    return x.kind==='file'&&/^image\//.test(x.type);
  }).map(function(x){return x.getAsFile();}).filter(Boolean);
  if(!files.length)return;
  e.preventDefault();
  addPendingProductImages(files,'貼上');
}
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
function catalogVariantRow(v){
 v=v||{};
 var status=v.sale_status||'available';
 return '<div class="cat-variant-row" style="display:grid;grid-template-columns:minmax(100px,1fr) minmax(180px,2fr) 90px 95px 145px auto;gap:8px;align-items:end;padding:10px 0;border-bottom:1px solid #e5e7eb">'+
 '<label>規格編號<input data-vfield="sku_code" placeholder="例如 G0071-M" value="'+esc(v.sku_code||'')+'"></label>'+
 '<label>規格名稱<input data-vfield="name" placeholder="例如 M號／藍色" value="'+esc(v.name||'')+'"></label>'+
 '<label>加價<input data-vfield="price_delta" type="number" step="0.01" value="'+esc(v.price_delta||0)+'"></label>'+
 '<label>最低量<input data-vfield="min_order_qty" type="number" min="0" step="any" value="'+esc(v.min_order_qty||'')+'"></label>'+
 '<label>銷售狀態<select data-vfield="sale_status">'+
 [['available','正常銷售'],['out_of_stock','暫時缺貨'],['discontinued','已停售']].map(function(x){return '<option value="'+x[0]+'" '+(status===x[0]?'selected':'')+'>'+x[1]+'</option>';}).join('')+
 '</select></label><button type="button" class="btn ghost" data-v-remove>移除</button></div>';
}
function syncVariantRows(){
 var rows=[...document.querySelectorAll('#catVariantRows .cat-variant-row')];
 var lines=rows.map(function(row){
  var val=function(k){return row.querySelector('[data-vfield="'+k+'"]').value.trim();};
  var fields=['sku_code','name','price_delta','min_order_qty','sale_status'].map(val);
  if(!fields[1])return '';
  if(fields.some(function(f){return f.includes('｜')||f.includes('|')||f.includes('\\n');}))throw Error('規格欄位不能包含分隔符號｜');
  return fields.join('｜');
 }).filter(Boolean);
 $('catPVariants').value=lines.join('\n');
}
function renderVariantRows(){
 var box=$('catVariantRows');if(!box)return;
 var rows=parseVariants($('catPVariants').value);
 box.innerHTML=rows.map(catalogVariantRow).join('')||'<p class="muted">尚未建立規格，可點「＋新增規格」。</p>';
 setupProductNumericInputs(box);
 box.querySelectorAll('input,select').forEach(function(x){x.onchange=syncVariantRows;x.oninput=function(){try{syncVariantRows();}catch(e){}};});
 box.querySelectorAll('[data-v-remove]').forEach(function(x){x.onclick=function(){
  var row=x.closest('.cat-variant-row'),name=row.querySelector('[data-vfield="name"]').value;
  if(!confirm('移除「'+name+'」？若已有訂單，儲存時會改成停售並保留歷史資料。'))return;
  row.remove();syncVariantRows();
 };});
}
function parseQuickVariantInput(raw,productCode){
  var lines=String(raw||'').split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean);
  if(!lines.length)throw new Error('請先輸入規格，每行一項，例如：A 黑色、B 灰色（分兩行）。');
  if(lines.length>150)throw new Error('最多一次產生 150 列規格。');
  var base=String(productCode||'SKU').replace(/[^A-Za-z0-9_-]/g,'').slice(0,20)||'SKU';
  function clean(v){return String(v||'').trim().replace(/[｜|]/g,'／').replace(/[\r\n]/g,' ');}
  function layer(line){
    var m=line.match(/^(.+?)\s*(?:[｜|:：=]|[-－–—]|[ \t]+)\s*(.+)$/);
    if(!m)return null;
    var options=m[2].split(/[,，、]/).map(clean).filter(Boolean);
    if(options.length<2)return null;
    if(new Set(options).size!==options.length)throw new Error('規格「'+m[1]+'」的選項有重複。');
    return {name:clean(m[1]),values:options};
  }
  var layers=lines.map(layer),allLayers=layers.every(function(x){return x!==null;});
  if(allLayers){
    if(layers.length>3)throw new Error('多層規格最多三層；若要每行一個規格，請改成 A 黑色、B 灰色的格式。');
    if(new Set(layers.map(function(x){return x.name;})).size!==layers.length)throw new Error('多層規格名稱不得重複。');
    var combos=[[]];
    layers.forEach(function(d){
      var next=[];
      combos.forEach(function(c){d.values.forEach(function(v){next.push(c.concat([{name:d.name,value:v}]));});});
      combos=next;
      if(combos.length>150)throw new Error('最多一次產生 150 組規格，請減少選項。');
    });
    return {mode:'layers',variants:combos.map(function(parts,i){return {
      sku_code:base+'-'+String(i+1).padStart(3,'0'),
      name:parts.map(function(x){return x.name+'：'+x.value;}).join('／')
    };})};
  }
  var rows=lines.map(function(line,i){
    // Nonempty line = one variant; short optional prefix: A 黑色 / A-黑色 / A、黑色.
    var m=line.match(/^([A-Za-z][A-Za-z0-9_]{0,11}|\d{1,4})\s*(?:[、,，:：\-－–—]|\s+)\s*(.+)$/);
    var code=m?m[1]:null;
    var name=clean(m?m[2]:line);
    if(!name)throw new Error('第 '+(i+1)+' 行缺少規格名稱。');
    return {sku_code:base+'-'+(code||String(i+1).padStart(3,'0')),name:name};
  });
  var seen=new Set();
  rows.forEach(function(x){var c=x.sku_code.toUpperCase();if(seen.has(c))throw new Error('規格編號「'+x.sku_code+'」重複，請修改前面的代碼。');seen.add(c);});
  return {mode:'rows',variants:rows};
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
    if(state.currentProduct&&state.currentProduct.archived_at)throw new Error('此商品已刪除，請先從「已刪除」清單還原。');
    validateProductNumericInputs($('catProductBody'));
    syncVariantRows();
    var payload={product_code:$('catPCode').value.trim(),name:$('catPName').value.trim(),description:$('catPDesc').value.trim()||null,fulfillment_vendor_id:$('catPFulfill').value,sale_mode:$('catPMode').value,is_clearance:$('catPClearance').value==='clearance',base_price:Number($('catPBase').value||0),min_order_qty:Number($('catPMin').value||1),max_sales_quantity:$('catPMaxSales').value.trim()===''?null:Number($('catPMaxSales').value),order_unit:$('catPUnit').value.trim()||'件',pack_text:$('catPPack').value.trim()||null,sale_start_at:$('catPStart').value?new Date($('catPStart').value).toISOString():null,sale_end_at:$('catPEnd').value?new Date($('catPEnd').value).toISOString():null,expected_ship_date:$('catPShip').value||null,visibility_mode:$('catPVisibility').value,published:$('catPPublished').checked,active:$('catPActive').checked,updated_at:new Date().toISOString()};
    if(payload.max_sales_quantity!==null&&(!Number.isFinite(payload.max_sales_quantity)||payload.max_sales_quantity<=0))throw new Error('銷售總量上限必須大於零');
    if(!payload.product_code||!payload.name)throw new Error('商品編號與商品名稱必填');
    // 停售／缺貨前提示既有待審 PUR 與未出貨 ORD，未完成訂單不自動取消。
    if(state.currentProduct){
      var oldVariants=await rest('catalog_variants?select=id,sku_code,name,sale_status&product_id=eq.'+state.currentProduct.id);
      var edited=parseVariants($('catPVariants').value),warnings=[];
      for(var ov of oldVariants){
        var same=edited.find(function(v){return v.sku_code&&ov.sku_code&&v.sku_code===ov.sku_code;})||
          edited.find(function(v){return v.name===ov.name;});
        var nextStatus=same?same.sale_status:'discontinued';
        if(nextStatus==='available'||ov.sale_status===nextStatus)continue;
        var impact=await rpc('catalog_variant_open_work',{p_variant_id:ov.id});
        if(impact.open_order_count||impact.pending_purchase_count)warnings.push(
          ov.name+'：未完成 ORD '+impact.open_order_count+' 筆（尚未出貨 '+impact.unshipped_quantity+'），待審 PUR '+impact.pending_purchase_count+' 筆（'+impact.pending_purchase_quantity+' 件）');
      }
      if(warnings.length&&!confirm('下列規格暫停／停售後，既有訂單不會取消：\n\n'+warnings.join('\n')+'\n\n確定繼續儲存？'))return;
    }
    var pid;
    if(state.currentProduct){
      await rest('catalog_products?id=eq.'+state.currentProduct.id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(payload)});pid=state.currentProduct.id;
    }else{
      payload.created_by=sess().user.id;var rr=await rest('catalog_products',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)});pid=rr[0].id;
      // Keep the created product ID if a later image upload fails, so retry does not create a duplicate product.
      state.currentProduct=Object.assign({id:pid},payload);
    }
    // 保留已被採購單、訂單或購物車引用的規格 ID；不得整批刪除再新增。
    var desired=parseVariants($('catPVariants').value);
    var existing=await rest('catalog_variants?select=*&product_id=eq.'+pid);
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
    var imageIndex=0;
    while(pendingProductImages.length){
      var pending=pendingProductImages[0];
      await uploadImage(pid,pending.file,imageIndex++);
      URL.revokeObjectURL(pending.url);
      pendingProductImages.shift();
      renderPendingProductImages();
    }
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
  var nav=document.createElement('div');nav.id='catalogCustomerNav';nav.className='catalog-vendor-nav';nav.innerHTML='<button class="active" data-cat-ctab="store">批發賣場</button><button data-cat-ctab="cart">購物車 <span id="catCartCount"></span></button><button data-cat-ctab="purchases">我的採購</button><button data-cat-ctab="addresses">收貨資料</button><button data-cat-ctab="password">修改密碼</button>';
  var topbar=document.querySelector('header.topbar');
  if(topbar)topbar.appendChild(nav);else card.insertBefore(nav,card.firstChild);
  var wrap=document.createElement('div');wrap.id='catalogCustomerArea';card.appendChild(wrap);
  nav.querySelectorAll('[data-cat-ctab]').forEach(function(b){b.addEventListener('click',function(){switchCustomerTab(b.dataset.catCtab,b);});});
  switchCustomerTab('store',nav.querySelector('[data-cat-ctab=store]'));
}
async function switchCustomerTab(tab,b){
  document.querySelectorAll('#catalogCustomerNav button').forEach(function(x){x.classList.toggle('active',x===b);});
  if(tab==='store')await renderStore();if(tab==='cart')await renderCart();if(tab==='purchases')await renderPurchases();if(tab==='addresses')await renderCustomerAddresses();if(tab==='password')renderCustomerPassword();
}
async function renderStore(){
  var area=$('catalogCustomerArea');area.innerHTML='<div class="catalog-empty">載入商品中…</div>';await loadStorefront();
  area.innerHTML='<div class="catalog-store-wrap"><div class="catalog-section-switch"><button class="active" type="button" data-cat-section="all">全部商品</button><button type="button" data-cat-section="clearance">出清優惠專區</button></div><div class="catalog-store-toolbar"><input id="catStoreSearch" placeholder="搜尋商品編號、名稱"><select id="catStoreMode"><option value="">全部</option><option value="in_stock">現貨</option><option value="preorder">預購</option></select><select id="catStoreSort" aria-label="商品排序"><option value="new">最新上架優先</option><option value="popular">訂購數量由多到少</option><option value="old">上架時間由舊到新</option></select><button id="catRefreshStore" class="btn ghost">重新整理</button></div><div id="catStoreGrid" class="catalog-grid"></div></div>';paintStore();window.dispatchEvent(new CustomEvent('catalog-store-ready'));
  area.dataset.catalogSection='all';area.querySelectorAll('[data-cat-section]').forEach(function(b){b.addEventListener('click',function(){area.dataset.catalogSection=b.dataset.catSection;area.querySelectorAll('[data-cat-section]').forEach(function(x){x.classList.toggle('active',x===b);});paintStore();});});
  $('catStoreSearch').addEventListener('input',paintStore);$('catStoreMode').addEventListener('change',paintStore);$('catStoreSort').addEventListener('change',paintStore);$('catRefreshStore').addEventListener('click',renderStore);
}
function paintStore(){
  var grid=$('catStoreGrid');if(!grid)return;var q=($('catStoreSearch').value||'').toLowerCase(),mode=$('catStoreMode').value;
  var clearanceOnly=$('catalogCustomerArea')?.dataset.catalogSection==='clearance';
  var list=state.products.filter(function(p){return p.active===true&&p.published===true&&p.archived_at==null&&(!clearanceOnly||p.is_clearance)&&(!q||(p.product_code+' '+p.name).toLowerCase().indexOf(q)>=0)&&(!mode||p.sale_mode===mode);});
  var sort=$('catStoreSort')?.value||'new';list.sort(function(a,b){var bd=Date.parse(b.created_at||0)||0,ad=Date.parse(a.created_at||0)||0;return sort==='popular'?(Number(b.ordered_quantity||0)-Number(a.ordered_quantity||0))||(bd-ad):sort==='old'?ad-bd:bd-ad;});
  grid.innerHTML=list.map(function(p){var im=firstImage(p.id),s=saleState(p),open=saleOpen(p);return '<div class="catalog-card" data-store-product="'+p.id+'"><div class="catalog-card-img">'+(im?'<img src="'+esc(publicImage(im.storage_path))+'">':'<span class="muted">尚無圖片</span>')+'</div><div class="catalog-card-body"><div class="catalog-code">'+esc(p.product_code)+'</div><div class="catalog-name">'+esc(p.name)+'</div>'+(p.is_clearance?'<span class="catalog-pill catalog-clearance-pill">出清優惠</span>':'')+'<div class="catalog-price">'+money(p.effective_price)+'</div><div class="catalog-meta"><span class="catalog-pill '+(s==='現貨'?'good':'warn')+'">'+esc(s)+'</span><span class="catalog-pill">最低 '+esc(p.effective_min_order_qty)+' '+esc(p.order_unit)+'</span><span class="catalog-pill">全站累計訂購 '+Number(p.ordered_quantity||0)+' '+esc(p.order_unit)+'</span>'+(p.max_sales_quantity!=null?'<span class="catalog-pill">上限 '+Number(p.max_sales_quantity)+' '+esc(p.order_unit)+'</span>':'')+(p.sale_end_at?'<span class="catalog-pill">結單 '+esc(fmtDate(p.sale_end_at))+'</span>':'')+'</div><div class="catalog-card-actions"><button class="btn secondary" data-store-view="'+p.id+'">查看商品</button><button class="btn primary" data-store-quick="'+p.id+'" '+(open?'':'disabled')+'>加入購物車</button></div></div></div>';}).join('')||'<div class="catalog-empty">目前沒有可購買商品。</div>';
  grid.querySelectorAll('.catalog-card-img').forEach(function(el){el.setAttribute('role','button');el.tabIndex=0;el.title='查看商品規格與訂購';el.onclick=function(){openStoreDetail(el.closest('[data-store-product]').dataset.storeProduct);};el.onkeydown=function(ev){if(ev.key==='Enter'){ev.preventDefault();el.click();}};});
  grid.querySelectorAll('[data-store-view]').forEach(function(b){b.onclick=function(){openStoreDetail(b.dataset.storeView);};});
  grid.querySelectorAll('[data-store-quick]').forEach(function(b){b.onclick=function(){openStoreDetail(b.dataset.storeQuick,true);};});
}
function ensureStoreModal(){
  if($('catStoreModal'))return;var d=document.createElement('div');d.id='catStoreModal';d.className='catalog-modal hidden';d.innerHTML='<div class="catalog-modal-card"><div class="catalog-modal-head"><h2 id="catStoreTitle">商品</h2><button class="catalog-close" data-store-close>×</button></div><div id="catStoreDetail"></div></div>';document.body.appendChild(d);d.querySelector('[data-store-close]').onclick=function(){d.classList.add('hidden');};
}
function openStoreDetail(id,focusQty){
  ensureStoreModal();var p=state.products.find(function(x){return x.id===id&&x.active===true&&x.published===true&&x.archived_at==null;});if(!p)return;var imgs=state.images.filter(function(x){return x.product_id===id;}).sort(function(a,b){return (a.sort_order||0)-(b.sort_order||0);}),vars=getVariants(id),main=imgs[0];
  $('catStoreTitle').textContent=p.product_code+' '+p.name;
  $('catStoreDetail').innerHTML='<div class="catalog-product-detail"><div class="catalog-sticky-gallery"><img id="catMainImg" class="catalog-main-image" src="'+esc(main?publicImage(main.storage_path):'')+'">'+(imgs.length?'<div class="catalog-thumbs">'+imgs.map(function(im){return '<button data-thumb="'+im.id+'"><img src="'+esc(publicImage(im.storage_path))+'"></button>';}).join('')+'</div><div class="catalog-download-row"><button id="catDownloadCurrent" class="btn ghost">下載目前原圖</button><button id="catDownloadAll" class="btn secondary">下載全部原圖 ('+imgs.length+')</button></div>':'<div class="catalog-empty">尚無商品圖片</div>')+'</div><div><div class="catalog-price">'+money(p.effective_price)+'</div><div class="catalog-meta"><span class="catalog-pill">'+esc(saleState(p))+'</span><span class="catalog-pill">最低 '+esc(p.effective_min_order_qty)+' '+esc(p.order_unit)+'</span><span class="catalog-pill">全站累計訂購 '+Number(p.ordered_quantity||0)+' '+esc(p.order_unit)+'</span>'+(p.max_sales_quantity!=null?'<span class="catalog-pill">銷售上限 '+Number(p.max_sales_quantity)+' '+esc(p.order_unit)+'</span>':'')+(p.pack_text?'<span class="catalog-pill">'+esc(p.pack_text)+'</span>':'')+'</div><div class="catalog-copy-bar"><button type="button" id="catCopyDescription" class="btn secondary">複製商品文案</button><span class="muted" id="catCopyFeedback" role="status"></span></div><p class="catalog-product-copy" style="white-space:pre-wrap;line-height:1.7">'+esc(p.description||'')+'</p>'+(p.expected_ship_date?'<p><b>預計出貨：</b>'+esc(p.expected_ship_date)+'</p>':'')+(vars.length?'<label>款式<select id="catBuyVariant" style="width:100%;margin-top:5px">'+vars.map(function(v){return '<option value="'+v.id+'" data-delta="'+v.price_delta+'" data-min="'+(v.min_order_qty||'')+'">'+esc(v.name)+(Number(v.price_delta)?'（'+(Number(v.price_delta)>0?'+':'')+money(v.price_delta)+'）':'')+'</option>';}).join('')+'</select></label>':'')+'<label style="display:block;margin-top:10px">數量<input id="catBuyQty" type="number" min="'+esc(p.effective_min_order_qty)+'" step="any" value="'+esc(p.effective_min_order_qty)+'" style="width:100%;margin-top:5px"></label><button id="catAddCart" class="btn primary wide" style="margin-top:12px" '+(saleOpen(p)?'':'disabled')+'>加入購物車</button><div id="catStoreMsg" class="message"></div></div></div>';
  var copyBtn=$('catCopyDescription');
  if(copyBtn)copyBtn.onclick=async function(){
    var content=String(p.description||'').trim(),msg=$('catCopyFeedback');
    if(!content){msg.textContent='商品尚未填寫文案';return;}
    try{
      if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(content);}
      else{
        var t=document.createElement('textarea');t.value=content;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.focus();t.select();
        var ok=document.execCommand('copy');t.remove();if(!ok)throw Error('複製失敗');
      }
      msg.textContent='已複製文案';copyBtn.textContent='✓ 已複製';
      setTimeout(function(){if(copyBtn.isConnected)copyBtn.textContent='一鍵複製文案';},1800);
    }catch(err){msg.textContent='複製失敗，請選取文案後複製';}
  };
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
  area.innerHTML='<div class="card inner-card"><h2>購物車</h2><p class="muted">① 核對商品與數量　→　② 選擇收貨資料　→　③ 送出待審核採購單</p><div class="catalog-cart-list">'+((rows||[]).map(function(x){return '<div class="catalog-cart-row">'+(x.image_path?'<img data-catalog-zoom src="'+esc(publicImage(x.image_path))+'" alt="'+esc(x.product_name)+'">':'<div style="width:64px;height:64px;border-radius:8px;background:#f2f4f7;color:#87919c;display:grid;place-items:center;font-size:12px">無圖</div>')+'<div><b>'+esc(x.product_code)+' '+esc(x.product_name)+'</b><div class="muted">'+esc(x.variant_name||'')+'</div></div><div class="qty">'+esc(x.quantity)+' '+esc(x.order_unit)+'</div><div class="price">'+money(x.unit_price)+'/單位｜小計 '+money(x.line_total)+'</div><button class="btn ghost" data-cart-del="'+x.cart_item_id+'">移除</button></div>';}).join('')||'<div class="catalog-empty">購物車是空的。</div>')+'</div><div class="catalog-cart-total">合計 '+money(total)+'</div>'+(min>0?'<div class="muted" style="text-align:right">此客戶等級最低結帳金額 '+money(min)+(total<min?'，尚差 '+money(min-total):'，已達門檻')+'</div>':'')+((rows||[]).length?'<div class="catalog-block"><h3>收貨資料</h3><label>選擇地址<select id="catCheckoutAddressId" style="width:100%;margin-top:5px"><option value="">＋本次新增收貨資料</option>'+addresses.map(function(a){return '<option value="'+a.id+'" '+(a.is_default?'selected':'')+'>'+esc((a.is_default?'★ ':'')+(a.receiver_name||'')+'｜'+(a.phone||'')+'｜'+(a.address||''))+'</option>';}).join('')+'</select></label><div id="catCheckoutNew" class="catalog-checkout-grid"><label>收貨人<input id="catCheckoutReceiver"></label><label>電話<input id="catCheckoutPhone"></label><label class="full">地址<input id="catCheckoutAddress"></label></div><label class="full">備註<textarea id="catCheckoutNote" style="width:100%"></textarea></label><button id="catCheckoutBtn" class="btn primary wide" style="margin-top:10px" '+(total<min?'disabled':'')+'>送出採購單（待審核）</button><div id="catCheckoutMsg" class="message"></div></div>':'')+'</div>';
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
  var vid=[...new Set(items.filter(function(i){return i.variant_id;}).map(function(i){return i.variant_id;}))];
  var variantStatuses=vid.length?await rest('catalog_variants?select=id,name,sale_status&id=in.('+vid.map(encodeURIComponent).join(',')+')'):[];
  var statusById={};variantStatuses.forEach(function(v){statusById[v.id]=v.sale_status;});
  var previousCustomer=el.dataset.purchaseCustomer||'',previousHide=el.dataset.purchaseHideApproved!=='0';
  var customers=[...new Map(requests.map(function(r){return [r.customer_id,{id:r.customer_id,name:r.buyer||'未命名客戶'}];})).values()].sort(function(a,b){return a.name.localeCompare(b.name,'zh-Hant');});
  el.innerHTML='<div class="catalog-head"><h3>客戶採購單審核</h3><button class="btn ghost" id="catRequestReload">重新整理</button></div><p class="muted">待確認採購單可逐筆調整數量或刪除商品，系統會重新計算小計及總額；核准後才建立 ORD。</p>'+
    '<div class="catalog-purchase-filters" style="grid-template-columns:minmax(180px,1fr) auto;align-items:center"><label style="margin:0">篩選客戶<select id="catRequestCustomerFilter" style="margin-top:5px"><option value="">全部客戶</option>'+customers.map(function(c){return '<option value="'+esc(c.id)+'" '+(previousCustomer===c.id?'selected':'')+'>'+esc(c.name)+'</option>';}).join('')+'</select></label><label style="display:flex;gap:8px;align-items:center;margin:0;white-space:nowrap"><input id="catRequestHideApproved" type="checkbox" style="width:auto;min-height:auto" '+(previousHide?'checked':'')+'>隱藏已成立訂單的採購單</label></div><div id="catRequestCount" class="muted" style="margin-bottom:10px"></div>'+
    (requests.map(function(r){
      var its=items.filter(function(x){return x.request_id===r.id;});
      var status=r.status==='pending'?'待確認':r.status==='approved'?'已轉正式訂單':'已退回';
      var quantity=its.reduce(function(n,i){return n+Number(i.quantity||0);},0);
      var held=its.filter(function(i){return i.variant_id&&statusById[i.variant_id]&&statusById[i.variant_id]!=='available';});
      var detail='<div style="overflow-x:auto;margin:12px 0"><table style="width:100%;border-collapse:collapse;min-width:710px;font-size:14px"><thead><tr style="background:#f1f5f9;text-align:left"><th style="padding:10px 8px">商品編號</th><th style="padding:10px 8px">商品名稱</th><th style="padding:10px 8px">規格／顏色</th><th style="padding:10px 8px;text-align:right">數量</th><th style="padding:10px 8px;text-align:right">單價</th><th style="padding:10px 8px;text-align:right">小計</th>'+(r.status==='pending'?'<th>修改明細</th>':'')+'</tr></thead><tbody>'+
        its.map(function(i){return '<tr style="border-bottom:1px solid #e2e8f0"><td style="padding:10px 8px;white-space:nowrap"><b>'+esc(i.product_code)+'</b></td><td style="padding:10px 8px">'+esc(i.product_name)+'</td><td style="padding:10px 8px">'+esc(i.variant_name||'—')+'</td><td style="padding:10px 8px;text-align:right;white-space:nowrap">'+(r.status==='pending'?'<input type="number" min="0.01" step="any" value="'+esc(i.quantity)+'" aria-label="訂購數量" data-purchase-qty="'+i.id+'" style="width:85px;min-height:36px;padding:5px">':'<b style="font-size:17px">'+esc(i.quantity)+'</b>')+' '+esc(i.order_unit||'')+'</td><td style="padding:10px 8px;text-align:right;white-space:nowrap">'+money(i.unit_price)+'</td><td style="padding:10px 8px;text-align:right;white-space:nowrap"><b>'+money(i.line_total)+'</b></td>'+(r.status==='pending'?'<td style="white-space:nowrap"><button type="button" class="btn small secondary" data-purchase-save-item="'+i.id+'">儲存</button> <button type="button" class="btn small danger-outline" data-purchase-delete-item="'+i.id+'">刪除</button></td>':'')+'</tr>';}).join('')+
        '</tbody></table></div>';
      return '<div class="catalog-myorder" data-review-customer="'+esc(r.customer_id||'')+'" data-review-status="'+esc(r.status)+'" style="padding:16px"><div class="catalog-head"><div><b style="font-size:18px">PUR-'+String(r.request_no).padStart(6,'0')+'</b> <span class="catalog-pill">'+esc(status)+'</span><div style="font-weight:700;margin-top:4px">'+esc(r.buyer)+'</div></div><div style="text-align:right"><div class="muted">採購總金額</div><b style="font-size:22px">'+money(r.total)+'</b></div></div>'+
      '<div class="muted">送出：'+esc(fmtDate(r.created_at))+'</div><div style="margin-top:5px"><b>收貨資料：</b>'+esc(r.receiver)+'｜'+esc(r.receiver_phone||'')+'｜'+esc(r.receiver_address||'')+'</div>'+
      detail+(held.length?'<div style="padding:10px;margin-bottom:9px;background:#fffaeb;border:1px solid #fedf89;border-radius:8px;color:#92400e"><b>提醒：此採購單包含 '+held.length+' 項已暫停或停售規格</b><div>'+held.map(function(i){return esc(i.product_code+' '+(i.variant_name||''))+'（'+(statusById[i.variant_id]==='discontinued'?'已停售':'暫時缺貨')+'）';}).join('、')+'</div>請確認是否仍可供貨，再決定核准或退回。</div>':'')+'<div style="display:flex;justify-content:flex-end;gap:18px;align-items:center;font-weight:700">品項 '+its.length+' 筆｜總數量 '+quantity+'｜合計 <span style="font-size:20px">'+money(r.total)+'</span></div>'+
      (r.note?'<div class="muted" style="margin-top:9px">客戶備註：'+esc(r.note)+'</div>':'')+
      (r.status==='pending'?'<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap"><button class="btn primary" data-purchase-approve="'+r.id+'">確認無誤，轉正式訂單</button><button class="btn ghost" data-purchase-reject="'+r.id+'">退回採購單</button></div>':'<div class="muted" style="margin-top:10px">'+(r.status==='approved'?'<strong style="color:#c5221f;font-size:16px;font-weight:900">正式訂單：'+esc((r.order_numbers||[]).join('、'))+'</strong>':'退回原因：'+esc(r.review_note||'—'))+'</div>')+'</div>';
    }).join('')||'<div class="catalog-empty">沒有客戶採購單。</div>');
  $('catRequestReload').onclick=renderAdminPurchaseRequests;
  function filterReviewRequests(){
    var selected=$('catRequestCustomerFilter').value,hide=$('catRequestHideApproved').checked,visible=0;
    el.dataset.purchaseCustomer=selected;el.dataset.purchaseHideApproved=hide?'1':'0';
    el.querySelectorAll('[data-review-customer]').forEach(function(card){
      var show=(!selected||card.dataset.reviewCustomer===selected)&&(!hide||card.dataset.reviewStatus!=='approved');
      card.hidden=!show;if(show)visible++;
    });
    $('catRequestCount').textContent='目前顯示 '+visible+' / '+requests.length+' 筆採購單';
  }
  $('catRequestCustomerFilter').onchange=filterReviewRequests;
  $('catRequestHideApproved').onchange=filterReviewRequests;
  filterReviewRequests();
  el.querySelectorAll('[data-purchase-save-item],[data-purchase-delete-item]').forEach(function(btn){btn.onclick=async function(){
    var id=btn.dataset.purchaseSaveItem||btn.dataset.purchaseDeleteItem,del=!!btn.dataset.purchaseDeleteItem;
    var inp=el.querySelector('[data-purchase-qty="'+id+'"]'),qty=Number(inp?.value);
    if(del){if(!confirm('確定刪除此商品明細？其他明細會保留。'))return;}
    else if(!Number.isFinite(qty)||qty<=0){alert('數量必須大於零；如不需要此品項請按刪除。');return;}
    btn.disabled=true;
    try{await rpc('catalog_adjust_pending_item',{p_item_id:id,p_quantity:del?null:qty,p_delete:del});await renderAdminPurchaseRequests();}
    catch(err){alert('修改採購明細失敗：'+err.message);btn.disabled=false;}
  };});
  el.querySelectorAll('[data-purchase-approve],[data-purchase-reject]').forEach(function(b){b.onclick=async function(){
    var approval=!!b.dataset.purchaseApprove,id=b.dataset.purchaseApprove||b.dataset.purchaseReject;
    if(!confirm(approval?'確認後將建立正式 ORD 並交由廠商出貨，確定？':'確定退回這份採購單？'))return;
    var note=approval?null:prompt('請輸入退回原因');if(!approval&&note===null)return;
    b.disabled=true;
    try{await rpc('catalog_review_purchase',{p_request_id:id,p_approve:approval,p_note:note||null});await renderAdminPurchaseRequests();}
    catch(e){alert('審核失敗：'+e.message);b.disabled=false;}
  };});
}


async function openCustomerPurchaseEditor(requestId){
  if(!isCustomer())return;
  var old=$('catPurchaseEditModal');if(old)old.remove();
  var result=await Promise.all([
    rest('customer_purchase_requests?select=*&id=eq.'+encodeURIComponent(requestId)+'&customer_id=eq.'+encodeURIComponent(state.profile.customer_id)),
    rest('customer_purchase_request_items?select=*&request_id=eq.'+encodeURIComponent(requestId)+'&order=sort_order.asc'),
    rest('customer_addresses?select=id,receiver_name,phone,address,is_default,active&customer_id=eq.'+encodeURIComponent(state.profile.customer_id)+'&active=eq.true&order=is_default.desc'),
    restAll('catalog_storefront?select=id,product_code,name,order_unit,active,published,sale_start_at,sale_end_at,effective_price&order=product_code.asc'),
    restAll('catalog_variants?select=id,product_id,name,price_delta,active,sale_status,sort_order&order=sort_order.asc')
  ]);
  var req=result[0]&&result[0][0],original=result[1]||[],addresses=result[2]||[],
      now=Date.now(),products=(result[3]||[]).filter(function(p){
        return p.active&&p.published&&(!p.sale_start_at||new Date(p.sale_start_at).getTime()<=now)&&
        (!p.sale_end_at||new Date(p.sale_end_at).getTime()>=now);
      }),variants=result[4]||[];
  if(!req)throw new Error('找不到您的採購單');
  if(req.status!=='pending')throw new Error('採購單已審核或退回，無法修改');
  var rows=original.map(function(x){return {
    id:x.id,product_id:x.product_id,variant_id:x.variant_id||null,
    name:x.product_code+' '+x.product_name,variant_name:x.variant_name||'',
    quantity:Number(x.quantity),unit_price:Number(x.unit_price),original_variant_id:x.variant_id||null,
    order_unit:x.order_unit||''
  };});
  var modal=document.createElement('div');modal.className='catalog-modal';modal.id='catPurchaseEditModal';
  modal.innerHTML='<div class="catalog-modal-card cat-purchase-edit-modal">'+
    '<div class="catalog-modal-head"><div><h2>修改待審核採購單 PUR-'+String(req.request_no).padStart(6,'0')+'</h2>'+
    '<p class="muted" style="margin:4px 0">只有待審核採購單可以修改；管理員確認後，商品與收件資料立即鎖定。</p></div>'+
    '<button type="button" class="catalog-close" id="catPurchaseEditClose" aria-label="關閉修改視窗">×</button></div>'+
    '<div class="catalog-block"><h3>商品明細</h3><div id="catPurchaseEditRows"></div>'+
    '<button type="button" class="btn secondary" id="catPurchaseEditAdd">＋新增商品</button>'+
    '<div class="cat-purchase-edit-total" id="catPurchaseEditTotal"></div></div>'+
    '<div class="catalog-block"><h3>收貨資料與備註</h3><label>收貨資料<select id="catPurchaseEditAddress" style="width:100%;margin-top:5px">'+
    '<option value="">本次自行填寫收貨資料</option>'+
    addresses.map(function(a){return '<option value="'+esc(a.id)+'" '+(req.customer_address_id===a.id?'selected':'')+'>'+
      esc((a.is_default?'★ ':'')+(a.receiver_name||'')+'｜'+(a.phone||'')+'｜'+(a.address||''))+'</option>';}).join('')+
    '</select></label><div class="catalog-checkout-grid" id="catPurchaseEditShipping">'+
    '<label>收貨人<input id="catPurchaseEditReceiver" maxlength="150" value="'+esc(req.receiver||'')+'"></label>'+
    '<label>收件電話<input id="catPurchaseEditPhone" maxlength="80" value="'+esc(req.receiver_phone||'')+'"></label>'+
    '<label class="full">完整地址<input id="catPurchaseEditShipAddress" maxlength="1000" value="'+esc(req.receiver_address||'')+'"></label></div>'+
    '<label>備註<textarea id="catPurchaseEditNote" maxlength="2000" style="width:100%;min-height:75px">'+esc(req.note||'')+'</textarea></label></div>'+
    '<div id="catPurchaseEditMessage" class="message" role="status"></div>'+
    '<div class="cat-purchase-edit-actions"><button type="button" class="btn ghost" id="catPurchaseEditCancel">取消</button>'+
    '<button type="button" class="btn primary" id="catPurchaseEditSave">儲存修改（保持待審核）</button></div></div>';
  document.body.appendChild(modal);
  var holder=$('catPurchaseEditRows'),status=$('catPurchaseEditMessage'),saving=false;
  function productOf(l){return products.find(function(p){return p.id===l.product_id;});}
  function lineVariants(l){
    var options=variants.filter(function(v){return v.product_id===l.product_id&&
      (v.active&&v.sale_status==='available'||l.id&&v.id===l.original_variant_id);});
    if(l.id&&l.original_variant_id&&!options.some(function(v){return v.id===l.original_variant_id;})){
      options.unshift({id:l.original_variant_id,product_id:l.product_id,
        name:l.variant_name||'原訂購規格',sale_status:'discontinued',active:false,price_delta:0});
    }
    return options;
  }
  function estimate(l){
    var prod=productOf(l),v=variants.find(function(x){return x.id===l.variant_id;});
    if(l.id&&l.variant_id===l.original_variant_id)return l.unit_price*l.quantity;
    return prod?(Number(prod.effective_price||0)+Number(v&&v.price_delta||0))*l.quantity:0;
  }
  function renderRows(){
    holder.innerHTML=rows.map(function(l,i){
      var prod=productOf(l),options=lineVariants(l),hasVariants=options.some(function(v){return v.active&&v.sale_status==='available';});
      var productsOptions=l.id?'<strong>'+esc(l.name)+'</strong>'+
        (!prod?'<div class="muted">此商品目前未上架，僅能減少原有數量或移除。</div>':''):
        '<label>商品<select data-pedit-field="product_id" data-pedit-index="'+i+'">'+
        products.map(function(p){return '<option value="'+esc(p.id)+'" '+(p.id===l.product_id?'selected':'')+'>'+
          esc(p.product_code+' '+p.name)+'</option>';}).join('')+'</select></label>';
      var variantOptions='<label>規格<select data-pedit-field="variant_id" data-pedit-index="'+i+'" '+
        (!prod&&l.id?'disabled':'')+'><option value="">無規格'+(hasVariants?'（請選擇規格）':'')+'</option>'+
        options.map(function(v){return '<option value="'+esc(v.id)+'" '+(l.variant_id===v.id?'selected':'')+'>'+
          esc(v.name+(v.sale_status!=='available'?'（已停售）':''))+'</option>';}).join('')+
        '</select></label>';
      return '<div class="cat-purchase-edit-row">'+
        '<div class="cat-purchase-edit-name">'+productsOptions+'</div>'+variantOptions+
        '<label>數量<input data-pedit-field="quantity" data-pedit-index="'+i+'" type="number" min="0.01" step="any" value="'+esc(l.quantity)+'"></label>'+
        '<span class="cat-purchase-edit-subtotal" data-pedit-subtotal="'+i+'">'+money(estimate(l))+'</span>'+
        '<button type="button" class="btn ghost" data-pedit-remove="'+i+'">移除</button></div>';
    }).join('')||'<div class="catalog-empty">尚無商品。請按「新增商品」。</div>';
    updateEstimate();
  }
  function updateEstimate(){
    $('catPurchaseEditTotal').textContent='預估商品總額：'+money(rows.reduce(function(t,l){return t+estimate(l);},0))+
      '（儲存時由系統正式核算價格與限購數量）';
    holder.querySelectorAll('[data-pedit-subtotal]').forEach(function(el){
      el.textContent=money(estimate(rows[Number(el.dataset.peditSubtotal)]));
    });
  }
  function toggleAddress(){
    var a=addresses.find(function(x){return x.id===$('catPurchaseEditAddress').value;});
    var fields=[['catPurchaseEditReceiver','receiver_name'],['catPurchaseEditPhone','phone'],['catPurchaseEditShipAddress','address']];
    fields.forEach(function(k){
      $(k[0]).readOnly=!!a;
      if(a)$(k[0]).value=a[k[1]]||'';
    });
  }
  $('catPurchaseEditAddress').onchange=toggleAddress;toggleAddress();
  function close(){if(!saving)modal.remove();}
  $('catPurchaseEditClose').onclick=close;$('catPurchaseEditCancel').onclick=close;
  $('catPurchaseEditAdd').onclick=function(){
    if(!products.length){status.textContent='目前沒有可新增的上架商品';return;}
    var p=products[0],vs=variants.filter(function(v){return v.product_id===p.id&&v.active&&v.sale_status==='available';});
    rows.push({id:null,product_id:p.id,variant_id:vs.length===1?vs[0].id:null,
      quantity:1,unit_price:Number(p.effective_price||0),order_unit:p.order_unit||'',name:p.product_code+' '+p.name});
    renderRows();holder.lastElementChild?.scrollIntoView({block:'nearest'});
  };
  holder.oninput=function(e){
    var i=Number(e.target.dataset.peditIndex);if(!Number.isInteger(i)||!rows[i])return;
    if(e.target.dataset.peditField==='quantity'){
      rows[i].quantity=Number(e.target.value);
      updateEstimate();
    }
  };
  holder.onchange=function(e){
    var i=Number(e.target.dataset.peditIndex);if(!Number.isInteger(i)||!rows[i])return;
    var field=e.target.dataset.peditField;
    if(field==='product_id'){
      rows[i].product_id=e.target.value;
      var vs=variants.filter(function(v){return v.product_id===e.target.value&&v.active&&v.sale_status==='available';});
      rows[i].variant_id=vs.length===1?vs[0].id:null;
      renderRows();
    }else if(field==='variant_id'){rows[i].variant_id=e.target.value||null;updateEstimate();}
  };
  holder.onclick=function(e){
    var btn=e.target.closest('[data-pedit-remove]');if(!btn)return;
    rows.splice(Number(btn.dataset.peditRemove),1);renderRows();
  };
  renderRows();
  $('catPurchaseEditSave').onclick=async function(){
    if(saving)return;
    if(!rows.length){status.textContent='至少保留一筆商品；如需取消整筆請聯繫管理員。';status.className='message error';return;}
    if(rows.some(function(x){return !Number.isFinite(x.quantity)||x.quantity<=0})){
      status.textContent='所有商品數量必須大於零。';status.className='message error';return;
    }
    if(rows.some(function(x){
      return !x.variant_id&&variants.some(function(v){
        return v.product_id===x.product_id&&v.active&&v.sale_status==='available';
      })&&(!x.id||x.variant_id!==x.original_variant_id);
    })){
      status.textContent='有商品尚未選擇規格，請先選取。';status.className='message error';return;
    }
    var addressId=$('catPurchaseEditAddress').value||null,
        recv=$('catPurchaseEditReceiver').value.trim(),phone=$('catPurchaseEditPhone').value.trim(),
        address=$('catPurchaseEditShipAddress').value.trim();
    if(!recv||!phone||!address){status.textContent='請完整填寫收貨人、電話及地址。';status.className='message error';return;}
    var b=this;saving=true;b.disabled=true;status.textContent='正在儲存修改，請勿重複送出…';status.className='message';
    try{
      var out=await rpc('catalog_customer_update_pending_purchase',{
        p_request_id:req.id,
        p_lines:rows.map(function(x){return {id:x.id||null,product_id:x.product_id,variant_id:x.variant_id||null,quantity:x.quantity};}),
        p_customer_address_id:addressId,
        p_receiver:addressId?null:recv,p_phone:addressId?null:phone,p_address:addressId?null:address,
        p_note:$('catPurchaseEditNote').value.trim()||null
      });
      modal.remove();
      await renderPurchases();
    }catch(err){status.textContent='修改失敗：'+err.message;status.className='message error';saving=false;b.disabled=false;}
  };
}
async function renderPurchases(){
  var area=$('catalogCustomerArea');area.innerHTML='<div class="catalog-empty">正在載入採購紀錄…</div>';
  var result=await Promise.all([
    rest('customer_purchase_requests?select=*&customer_id=eq.'+state.profile.customer_id+'&order=created_at.desc&limit=100'),
    rest('orders?select=id,tracking_id,order_date,status,order_total,expected_deadline,created_at,receiver,receiver_address&customer_id=eq.'+state.profile.customer_id+'&order=created_at.desc&limit=100')
  ]);
  var purchases=result[0]||[],orders=result[1]||[];
  function summary(type,id,number,status,date,total,receiver,extra){
    return '<details class="catalog-myorder" data-detail-type="'+type+'" data-detail-id="'+esc(id)+'" style="margin-bottom:9px"><summary style="cursor:pointer;list-style:none;padding:5px 0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><b>'+esc(number)+'</b> <span class="catalog-pill">'+esc(status)+'</span><div class="muted">'+esc(date)+'｜收貨：'+esc(receiver||'—')+'</div><b>'+money(total)+'</b></div><span style="font-size:13px;color:#087e77">查看明細 ▾</span></div></summary>'+(extra||'')+'<div class="catalog-purchase-detail" style="border-top:1px solid #ddd;margin-top:9px;padding-top:10px"><div class="muted">展開後載入商品明細…</div></div></details>';
  }
  var html=purchases.map(function(p){
    return summary('PUR',p.id,'PUR-'+String(p.request_no).padStart(6,'0'),p.status==='pending'?'等待確認':p.status==='approved'?'已確認':'已退回',fmtDate(p.created_at),p.total,p.receiver,p.status==='rejected'?'<div class="muted">退回原因：'+esc(p.review_note||'—')+'</div>':p.status==='pending'?'<div style="margin-top:12px"><button type="button" class="btn secondary" data-customer-edit-purchase="'+esc(p.id)+'">修改訂購單（尚未審核）</button></div>':'');
  }).join('')+orders.map(function(o){
    var status=({vendor_unconfirmed:'訂單處理中',vendor_confirmed:'訂單已確認',new:'訂單處理中',preparing:'備貨中',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'暫時缺貨',delayed:'出貨延後'})[o.status]||'訂單處理中';
    return summary('ORD',o.id,'ORD-'+String(o.tracking_id).padStart(6,'0'),status,'下單 '+o.order_date+'｜預計 '+(o.expected_deadline||'—'),o.order_total,o.receiver);
  }).join('');
  area.innerHTML='<div class="card inner-card"><h2>我的採購</h2><p class="muted">可按狀態、編號或收貨人查詢；點訂單展開商品、規格、數量與金額。</p><div class="catalog-purchase-filters"><input id="catPurchaseSearch" placeholder="搜尋 PUR／ORD 編號或收貨人" aria-label="搜尋採購單"><select id="catPurchaseStatus" aria-label="篩選採購狀態"><option value="">全部狀態</option><option value="pending">待確認</option><option value="approved">已確認／正式訂單</option><option value="rejected">已退回</option></select><button type="button" class="btn ghost" id="catPurchaseExpand">全部展開</button></div><div id="catPurchaseCounter" class="muted"></div>'+(html||'<div class="catalog-empty">尚無採購紀錄。</div>')+'</div>';
  area.onclick=function(e){
    var edit=e.target.closest('[data-customer-edit-purchase]');if(!edit)return;
    e.preventDefault();e.stopPropagation();
    edit.disabled=true;
    openCustomerPurchaseEditor(edit.dataset.customerEditPurchase).catch(function(err){alert('無法開啟採購單修改：'+err.message);edit.disabled=false;});
  };
  area.querySelectorAll('details[data-detail-id]').forEach(function(d){
    var token=(d.querySelector('summary')?.textContent||'').toLowerCase();
    d.dataset.searchText=token;
    d.dataset.stage=d.dataset.detailType==='PUR'?(purchases.find(function(x){return x.id===d.dataset.detailId;})?.status||''): 'approved';
  });
  function filterPurchases(){
    var q=($('catPurchaseSearch').value||'').trim().toLowerCase(),stage=$('catPurchaseStatus').value,count=0;
    area.querySelectorAll('details[data-detail-id]').forEach(function(d){
      var yes=(!q||d.dataset.searchText.includes(q))&&(!stage||d.dataset.stage===stage);
      d.hidden=!yes;if(yes)count++;
    });
    $('catPurchaseCounter').textContent='符合條件 '+count+' 筆採購紀錄';
  }
  $('catPurchaseSearch').addEventListener('input',filterPurchases);
  $('catPurchaseStatus').addEventListener('change',filterPurchases);
  $('catPurchaseExpand').onclick=function(){
    var ds=[...area.querySelectorAll('details[data-detail-id]:not([hidden])')],open=ds.some(function(d){return !d.open;});
    ds.forEach(function(d){d.open=open;});this.textContent=open?'全部收合':'全部展開';
  };
  filterPurchases();
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
function showErr(e){console.error(e);var msg=String(e&&e.message||e);if(/JWT expired|invalid jwt|token.*expired|登入已過期|登入已逾期/i.test(msg)){alert('登入已逾期，請重新登入後再操作。');return;}alert('商城功能發生錯誤：'+msg);}
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
