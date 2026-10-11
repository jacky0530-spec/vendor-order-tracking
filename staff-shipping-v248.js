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
 var orders=activeOrders(),rows=rowsFor(orders);
 if($('staffShipPending')?.checked)rows=rows.filter(function(x){return x.remaining>0&&!['cancelled','completed'].includes(x.order.status);});
 root.innerHTML='<p class="muted">符合篩選：'+orders.length+' 張訂單、'+rows.length+' 項商品。請匯出 Excel 填寫出貨狀況後，再匯入回填。</p><div style="overflow-x:auto"><table style="min-width:760px;width:100%"><thead><tr><th>訂單</th><th>廠商</th><th>商品</th><th>規格</th><th>訂購</th><th>已出</th><th>剩餘</th></tr></thead><tbody>'+rows.slice(0,300).map(function(x){return '<tr><td>ORD-'+String(x.order.tracking_id).padStart(6,'0')+'</td><td>'+e(x.vendor?.vendor_code||'')+' '+e(x.vendor?.name||'')+'</td><td>'+e(x.item.product_code||'')+' '+e(x.item.product_name||'')+'</td><td>'+e(x.item.variant||'')+'</td><td>'+x.quantity+'</td><td>'+x.shipped+'</td><td><b>'+x.remaining+'</b></td></tr>';}).join('')+'</tbody></table></div>';
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
var shipColumns=['ORD訂單編號','訂單日期','廠商編號','出貨廠商','訂單狀態','商品編號','商品名稱','規格','訂購量','已出貨量','未出貨量','單位','本次出貨數量(填寫)','實際出貨日(YYYY-MM-DD)','物流／貨運(選填)','託運號碼(選填)','備註(選填)'];
function exportOrders(){
 if(!loaded){alert('請先讀取資料');return;}
 var rows=rowsFor(activeOrders());if($('staffShipPending').checked)rows=rows.filter(function(x){return x.remaining>0&&!['cancelled','completed'].includes(x.order.status);});
 var data=[shipColumns];rows.forEach(function(x){data.push(['ORD-'+String(x.order.tracking_id).padStart(6,'0'),x.order.order_date,x.vendor?.vendor_code||'',x.vendor?.name||'',status(x.order.status),x.item.product_code||'',x.item.product_name||'',x.item.variant||'',x.quantity,x.shipped,x.remaining,x.item.quantity_unit||'','','','','','',x.item.id]);});
 if(typeof XLSX==='undefined'){alert('出貨回填需要 Excel 元件，請確認網路連線後重新整理');return;}
 var book=XLSX.utils.book_new();
 var visible=data.map(function(row){return row.slice(0,17);});
 var meta=[['列號','系統明細ID']];
 for(var i=1;i<data.length;i++)meta.push([i+1,data[i][17]]);
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(visible),'出貨回填');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(meta),'_internal_rows');
 book.Workbook.Sheets[1].Hidden=1;
 XLSX.writeFile(book,'出貨回填_'+new Date().toISOString().slice(0,10)+'.xlsx');
}
async function importShipmentWorkbook(file){
 if(!file)return;var result=$('staffShipImportResult');result.textContent='正在驗證 Excel…';
 try{
  if(typeof XLSX==='undefined')throw Error('Excel 元件未載入，請檢查網路後重新整理');
  var wb=XLSX.read(await file.arrayBuffer(),{type:'array'}),lines=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,raw:false,defval:''});
  if(!wb.Sheets._internal_rows)throw Error('此 Excel 缺少系統對應資料，請重新匯出最新版本');
  var metaRows=XLSX.utils.sheet_to_json(wb.Sheets._internal_rows,{header:1,raw:false,defval:''});
  var internalIds=new Map(metaRows.slice(1).map(function(row){return [Number(row[0]),String(row[1]||'').trim()];}));
  if(!lines.length||shipColumns.some(function(h,i){return String(lines[0][i]).trim()!==h;}))throw Error('格式不符，請使用本系統匯出的 Excel');
  var known=new Map(rowsFor(state.orders).map(function(x){return [x.item.id,x];})),seen=new Set(),work=[],issues=[];
  for(var i=1;i<lines.length;i++){
   var row=lines[i],input=String(row[12]||'').trim();if(!input)continue;
   var id=internalIds.get(i+1)||'',item=known.get(id),qty=Number(input),date=String(row[13]||'').trim(),label='第 '+(i+1)+' 列';
   if(!item){issues.push(label+'：商品明細 ID 無效');continue;}
   if(seen.has(id)){issues.push(label+'：同一商品重複填報');continue;}seen.add(id);
   if(String(row[0]||'').trim()!=='ORD-'+String(item.order.tracking_id).padStart(6,'0')||String(row[5]||'').trim()!==String(item.item.product_code||'')){issues.push(label+'：訂單或貨號不一致');continue;}
   if(!Number.isFinite(qty)||qty<=0||qty>item.remaining){issues.push(label+'：數量必須大於零且不能超過剩餘 '+item.remaining);continue;}
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))){issues.push(label+'：出貨日請填 YYYY-MM-DD');continue;}
   if(item.order.deleted_at||['cancelled','completed'].includes(item.order.status)){issues.push(label+'：訂單已結束');continue;}
   work.push({id:id,qty:qty,date:date,carrier:String(row[14]||'').trim(),tracking:String(row[15]||'').trim(),note:String(row[16]||'').trim(),order:item.order.tracking_id});
  }
  if(issues.length){result.textContent='檢查發現 '+issues.length+' 筆錯誤，未寫入資料：\n'+issues.join('\n');return;}
  if(!work.length){result.textContent='沒有填寫本次出貨數量的資料，未執行回填';return;}
  var quantity=work.reduce(function(t,x){return t+x.qty;},0);
  if(!confirm('確認將 Excel 中 '+work.length+' 項、共 '+quantity+' 件出貨資料回填正式系統？請勿重複匯入相同資料。')){result.textContent='已取消匯入';return;}
  var ok=0,fail=[];
  for(var w of work){try{await fetchApi('rpc/staff_record_shipment',{method:'POST',body:JSON.stringify({p_order_item_id:w.id,p_quantity:w.qty,p_ship_date:w.date,p_carrier:w.carrier||null,p_tracking_no:w.tracking||null,p_note:w.note||null})});ok++;}catch(err){fail.push('ORD-'+String(w.order).padStart(6,'0')+': '+err.message);}}
  await load();result.textContent='匯入成功 '+ok+' 項'+(fail.length?'；失敗 '+fail.length+' 項：'+fail.join('；'):'');
 }catch(err){result.textContent='匯入失敗：'+err.message;}
 finally{$('staffShipImport').value='';}
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
 pane.innerHTML='<div class="card section-card"><h2>廠商出貨管理（小幫手回填）</h2><p class="muted">廠商帳號已停用。匯出 Excel 後於檔案填寫本次出貨數量、出貨日、物流、託運號碼、備註，再上傳匯入；不提供訂購客戶資料。</p><div class="filters" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))"><label>廠商<select id="staffShipVendor"><option value="">全部廠商</option></select></label><label>訂單起日<input id="staffShipFrom" type="date"></label><label>訂單迄日<input id="staffShipTo" type="date"></label><label>搜尋<input id="staffShipSearch" placeholder="ORD 或訂貨人"></label></div><label style="display:flex;gap:8px;align-items:center"><input id="staffShipPending" type="checkbox" checked style="width:auto;min-height:0">只顯示待出貨商品</label><div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button id="staffShipLoad" class="btn ghost">重新整理</button><button id="staffShipExportOrders" class="btn primary">匯出訂單 Excel</button><button id="staffShipExportSummary" class="btn secondary">匯出廠商彙總 Excel</button></div><label style="display:block;margin:12px 0">匯入已填寫的出貨 Excel <input id="staffShipImport" type="file" accept=".xlsx,.xls"></label><div id="staffShipImportResult" class="message" role="status" style="white-space:pre-wrap"></div><div id="staffShipResults"></div></div>';
 document.querySelector('#adminView').appendChild(pane);
 tab.onclick=function(){document.querySelectorAll('#adminView .tab').forEach(function(x){x.classList.toggle('active',x===tab);});document.querySelectorAll('#adminView .tab-panel').forEach(function(x){x.classList.add('hidden');});pane.classList.remove('hidden');if(!loaded)load();else render();};
 nav.querySelectorAll('.tab').forEach(function(x){if(x!==tab)x.addEventListener('click',function(){pane.classList.add('hidden');});});
 ['staffShipVendor','staffShipFrom','staffShipTo','staffShipSearch','staffShipPending'].forEach(function(id){$(id).addEventListener(id==='staffShipSearch'?'input':'change',render);});
 $('staffShipImport').onchange=function(){importShipmentWorkbook(this.files[0]);};
 $('staffShipLoad').onclick=load;$('staffShipExportOrders').onclick=exportOrders;$('staffShipExportSummary').onclick=exportSummary;
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();