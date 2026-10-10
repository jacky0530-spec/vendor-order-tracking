(function(){
'use strict';
var C=window.APP_CONFIG||{},SB=C.SUPABASE_URL,KEY=C.SUPABASE_PUBLISHABLE_KEY;
var state={orders:[],items:[],shipments:[],vendors:[]},loaded=false;
function $(id){return document.getElementById(id);}
function e(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function session(){try{return JSON.parse(localStorage.getItem('vendor_order_session')||'null');}catch(_){return null;}}
async function fetchApi(path,opt,retry){
 opt=opt||{};var s=session();if(!s?.access_token)throw Error('請登入管理員或小幫手帳號');
 var headers=Object.assign({apikey:KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},opt.headers||{});
 var r=await fetch(SB+'/rest/v1/'+path,Object.assign({},opt,{headers:headers}));
 if(r.status===401&&retry!==false&&s.refresh_token){
  var renew=await fetch(SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});
  if(!renew.ok)throw Error('登入已過期，請重新登入');
  localStorage.setItem('vendor_order_session',JSON.stringify(await renew.json()));return fetchApi(path,opt,false);
 }
 var t=await r.text();if(!r.ok){var msg=t;try{msg=JSON.parse(t).message||t;}catch(_){}throw Error(msg||'HTTP '+r.status);}return t?JSON.parse(t):[];
}
async function all(table,select,order){
 var result=[],limit=700,offset=0;
 for(var k=0;k<30;k++){
  var q=table+'?select='+select+(order?'&order='+order:'')+'&limit='+limit+'&offset='+offset;
  var rows=await fetchApi(q);result=result.concat(rows);if(rows.length<limit)return result;offset+=limit;
 }
 throw Error('資料量過大，請聯繫管理員分批匯出');
}
function asDate(v){return v?String(v).slice(0,10):'';}
function status(t){return ({vendor_unconfirmed:'待確認',vendor_confirmed:'已確認',preparing:'備貨中／部分出貨',shipped:'已出貨',completed:'已完成',cancelled:'已取消',out_of_stock:'缺貨',delayed:'延後'})[t]||t||'—';}
function sums(){
 var byItem={};state.shipments.forEach(function(x){byItem[x.order_item_id]=(byItem[x.order_item_id]||0)+Number(x.shipped_quantity||0);});return byItem;
}
function activeOrders(){
 var vendor=$('staffShipVendor')?.value||'',from=$('staffShipFrom')?.value||'',to=$('staffShipTo')?.value||'',search=($('staffShipSearch')?.value||'').trim().toLowerCase();
 var vendorById=Object.fromEntries(state.vendors.map(function(v){return [v.id,v];}));
 return state.orders.filter(function(o){return !o.deleted_at&&(!vendor||o.vendor_id===vendor)&&(!from||o.order_date>=from)&&(!to||o.order_date<=to)&&(!search||('ORD-'+String(o.tracking_id).padStart(6,'0')+' '+(o.buyer||'')+' '+(vendorById[o.vendor_id]?.name||'')).toLowerCase().includes(search));});
}
function rowsFor(orders){
 var ids=new Set(orders.map(function(x){return x.id;})),om=Object.fromEntries(orders.map(function(x){return [x.id,x];})),vm=Object.fromEntries(state.vendors.map(function(v){return [v.id,v];})),shipped=sums();
 return state.items.filter(function(i){return ids.has(i.order_id);}).map(function(i){
  var o=om[i.order_id],q=Number(i.quantity||0),done=shipped[i.id]||0;
  return {item:i,order:o,vendor:vm[o.vendor_id],quantity:q,shipped:done,remaining:Math.max(q-done,0)};
 });
}
function render(){
 var root=$('staffShipResults');if(!root||!loaded)return;
 var orders=activeOrders(),rows=rowsFor(orders),pending=$('staffShipPending')?.checked;
 if(pending)rows=rows.filter(function(x){return x.remaining>0&&!['cancelled','completed'].includes(x.order.status);});
 root.innerHTML='<p class="muted">符合篩選：'+orders.length+' 張訂單，共 '+rows.length+' 項；可輸入本次出貨數量並按「回填出貨」。Excel 匯出會以篩選條件產生，包含完整商品明細。</p>'+
 (rows.slice(0,300).map(function(x){
  var i=x.item,o=x.order,v=x.vendor||{};
  return '<div class="catalog-myorder" style="padding:12px;margin-bottom:10px"><div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between"><div><b>ORD-'+String(o.tracking_id).padStart(6,'0')+'</b>｜'+e(v.vendor_code||'')+' '+e(v.name||'')+'<div class="muted">'+e(o.buyer||'')+'｜'+e(asDate(o.order_date))+'｜'+e(status(o.status))+'</div><div>'+e(i.product_code||'')+' '+e(i.product_name||'')+'｜'+e(i.variant||'')+'</div><div><b>訂購 '+x.quantity+'｜已出 '+x.shipped+'｜剩餘 <span style="color:#b54708">'+x.remaining+'</span></b> '+e(i.quantity_unit||'')+'</div></div>'+
 (x.remaining>0&&!['cancelled','completed'].includes(o.status)?'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:end"><label>本次出貨數<input data-qty="'+i.id+'" type="number" min="0.01" max="'+x.remaining+'" step="any" value="'+x.remaining+'" style="width:100px"></label><label>出貨日<input data-date="'+i.id+'" type="date" value="'+new Date().toLocaleDateString('en-CA')+'" style="width:155px"></label><label>物流／貨運<input data-carrier="'+i.id+'" placeholder="選填" style="width:120px"></label><label>託運號碼<input data-tracking="'+i.id+'" placeholder="選填" style="width:145px"></label><label>備註<input data-note="'+i.id+'" placeholder="選填" style="width:145px"></label><button type="button" class="btn primary" data-staff-ship="'+i.id+'">回填出貨</button></div>':'<span class="muted">此項無待出貨數量或訂單已結束</span>')+'</div></div>';
 }).join('')||'<div class="catalog-empty">無符合條件的訂單商品。</div>')+
 (rows.length>300?'<p class="muted">畫面最多顯示前 300 項，請縮小篩選條件；匯出仍涵蓋全部符合資料。</p>':'');
 root.querySelectorAll('[data-staff-ship]').forEach(function(b){b.onclick=async function(){
  var id=b.dataset.staffShip,entry=rows.find(function(x){return x.item.id===id;});if(!entry)return;
  var val=function(n){return root.querySelector('[data-'+n+'="'+id+'"]').value.trim();},qty=Number(val('qty')),date=val('date');
  if(!qty||qty<=0||qty>entry.remaining||!date){alert('請確認出貨日及數量不得超過剩餘數量');return;}
  if(!confirm('確定回填 ORD-'+String(entry.order.tracking_id).padStart(6,'0')+' 本次出貨 '+qty+' '+(entry.item.quantity_unit||'')+'？'))return;
  b.disabled=true;
  try{await fetchApi('rpc/staff_record_shipment',{method:'POST',body:JSON.stringify({p_order_item_id:id,p_quantity:qty,p_ship_date:date,p_carrier:val('carrier')||null,p_tracking_no:val('tracking')||null,p_note:val('note')||null})});await load();alert('出貨紀錄已回填');}
  catch(err){alert('回填失敗：'+err.message);b.disabled=false;}
 };});
}
async function load(){
 var root=$('staffShipResults');if(root)root.textContent='讀取正式訂單與出貨紀錄中…';
 try{
  var data=await Promise.all([
   all('orders','id,tracking_id,order_date,buyer,vendor_id,status,deleted_at','tracking_id.desc'),
   all('order_items','id,order_id,product_code,product_name,variant,quantity,quantity_unit,sort_order','order_id.asc'),
   all('order_item_shipments','order_item_id,shipped_quantity,actual_ship_date,carrier,tracking_no,note','created_at.desc'),
   all('vendors','id,vendor_code,name','vendor_code.asc')
  ]);
  state={orders:data[0],items:data[1],shipments:data[2],vendors:data[3]};loaded=true;
  var v=$('staffShipVendor'),previous=v.value;
  v.innerHTML='<option value="">全部廠商</option>'+state.vendors.map(function(x){return '<option value="'+e(x.id)+'">'+e(x.vendor_code+' '+x.name)+'</option>';}).join('');
  v.value=previous;render();
 }catch(e){if(root)root.innerHTML='<p style="color:#b42318">'+e(e.message)+'</p>';}
}
function excel(name,data){
 if(typeof XLSX!=='undefined'){
  var book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(book,sheet,'明細');XLSX.writeFile(book,name+'.xlsx');return;
 }
 // If the Excel library cannot load, provide Excel-compatible CSV rather than silently failing.
 var csv='\uFEFF'+data.map(function(r){return r.map(function(c){return '"'+String(c==null?'':c).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');
 var url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name+'.csv';a.click();setTimeout(function(){URL.revokeObjectURL(url);},1500);
 alert('Excel 元件尚未載入，已改匯出可用 Excel 開啟的 CSV 檔。');
}
function exportOrders(){
 var rows=rowsFor(activeOrders()),data=[['ORD訂單編號','訂單日期','廠商編號','出貨廠商','訂購客戶','訂單狀態','商品編號','商品名稱','規格','訂購量','已出貨量','未出貨量','單位']];
 rows.forEach(function(x){data.push(['ORD-'+String(x.order.tracking_id).padStart(6,'0'),x.order.order_date,x.vendor?.vendor_code||'',x.vendor?.name||'',x.order.buyer||'',status(x.order.status),x.item.product_code||'',x.item.product_name||'',x.item.variant||'',x.quantity,x.shipped,x.remaining,x.item.quantity_unit||'']);});
 excel('訂單出貨追蹤_'+new Date().toISOString().slice(0,10),data);
}
function exportSummary(){
 var rows=rowsFor(activeOrders()),groups={};
 rows.forEach(function(x){var key=x.order.vendor_id,g=groups[key]||(groups[key]={v:x.vendor,orders:new Set(),qty:0,done:0,remaining:0});g.orders.add(x.order.id);g.qty+=x.quantity;g.done+=x.shipped;g.remaining+=x.remaining;});
 var data=[['廠商編號','廠商名稱','訂單數','訂購數量','已出貨數量','剩餘數量']];
 Object.values(groups).forEach(function(g){data.push([g.v?.vendor_code||'',g.v?.name||'',g.orders.size,g.qty,g.done,g.remaining]);});
 excel('廠商出貨彙總_'+new Date().toISOString().slice(0,10),data);
}
function init(){
 var nav=document.querySelector('#adminView .tabs');if(!nav||$('tab-staff-shipping'))return;
 var tab=document.createElement('button');tab.className='tab';tab.textContent='出貨回填／Excel';tab.dataset.tab='staff-shipping';nav.appendChild(tab);
 var pane=document.createElement('div');pane.id='tab-staff-shipping';pane.className='tab-panel hidden';
 pane.innerHTML='<div class="card section-card"><h2>廠商出貨管理（小幫手回填）</h2><p class="muted">廠商帳號已停用。先下載 Excel 訂單及廠商彙總，向廠商確認出貨後，由管理員或小幫手記錄實際出貨數量、日期與託運資訊。</p><div class="filters" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))"><label>廠商<select id="staffShipVendor"><option value="">全部廠商</option></select></label><label>訂單起日<input id="staffShipFrom" type="date"></label><label>訂單迄日<input id="staffShipTo" type="date"></label><label>搜尋<input id="staffShipSearch" placeholder="ORD 或訂貨人"></label></div><label style="display:flex;gap:8px;align-items:center"><input id="staffShipPending" type="checkbox" checked style="width:auto;min-height:0">只顯示待出貨商品</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button id="staffShipLoad" class="btn ghost">重新整理</button><button id="staffShipExportOrders" class="btn primary">匯出訂單 Excel</button><button id="staffShipExportSummary" class="btn secondary">匯出廠商彙總 Excel</button></div><div id="staffShipResults"></div></div>';
 document.querySelector('#adminView').appendChild(pane);
 tab.onclick=function(){document.querySelectorAll('#adminView .tab').forEach(function(x){x.classList.toggle('active',x===tab);});document.querySelectorAll('#adminView .tab-panel').forEach(function(x){x.classList.add('hidden');});pane.classList.remove('hidden');if(!loaded)load();else render();};
 nav.querySelectorAll('.tab').forEach(function(x){if(x!==tab)x.addEventListener('click',function(){pane.classList.add('hidden');});});
 ['staffShipVendor','staffShipFrom','staffShipTo','staffShipSearch','staffShipPending'].forEach(function(id){$(id).addEventListener(id==='staffShipSearch'?'input':'change',render);});
 $('staffShipLoad').onclick=load;$('staffShipExportOrders').onclick=exportOrders;$('staffShipExportSummary').onclick=exportSummary;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();