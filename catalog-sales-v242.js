(function(){
'use strict';
var C=window.APP_CONFIG||{},SB=C.SUPABASE_URL,KEY=C.SUPABASE_PUBLISHABLE_KEY;
function el(id){return document.getElementById(id);}
function safe(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function money(v){return '$'+Number(v||0).toLocaleString('zh-TW',{maximumFractionDigits:2});}
async function get(path){
 var s=JSON.parse(localStorage.getItem('vendor_order_session')||'null'),url=SB+'/rest/v1/'+path;
 if(!s||!s.access_token)throw Error('請先登入');
 var r=await fetch(url,{headers:{apikey:KEY,Authorization:'Bearer '+s.access_token}});
 if(r.status===401&&s.refresh_token){
  var t=await fetch(SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:s.refresh_token})});
  if(!t.ok)throw Error('登入已過期，請重新登入');
  s=await t.json();localStorage.setItem('vendor_order_session',JSON.stringify(s));
  r=await fetch(url,{headers:{apikey:KEY,Authorization:'Bearer '+s.access_token}});
 }
 if(!r.ok)throw Error('報表讀取失敗：'+(await r.text()).slice(0,300));
 return r.json();
}
function setup(){
 var root=el('catSalesReport');if(!root)return;
 var now=new Date(),month=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
 root.innerHTML='<h3>商城銷售報表</h3><p class="muted">僅統計已核准產生 ORD 的網站訂單，排除取消及刪除訂單；待審核 PUR 不列入。依訂單日期統計，非收款日期。</p><div class="catalog-toolbar" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end"><label>月份<input id="catReportMonth" type="month" value="'+month+'"></label><label>開始日期<input id="catReportFrom" type="date"></label><label>結束日期<input id="catReportTo" type="date"></label><label>客戶<select id="catReportCustomer"><option value="">全部客戶</option></select></label><button id="catReportRun" class="btn primary">查詢報表</button></div><div id="catReportResult" style="margin-top:15px"></div>';
 function monthDates(){var v=el('catReportMonth').value;if(!v)return;var a=v.split('-');el('catReportFrom').value=v+'-01';el('catReportTo').value=v+'-'+new Date(Number(a[0]),Number(a[1]),0).getDate();}
 el('catReportMonth').onchange=monthDates;monthDates();
 get('customers?select=id,customer_code,name&order=customer_code.asc').then(function(cs){el('catReportCustomer').innerHTML='<option value="">全部客戶</option>'+cs.map(function(c){return '<option value="'+safe(c.id)+'">'+safe(c.customer_code+' '+c.name)+'</option>';}).join('');}).catch(function(e){el('catReportResult').textContent=e.message;});
 el('catReportRun').onclick=run;run();
}
async function run(){
 var from=el('catReportFrom').value,to=el('catReportTo').value,cid=el('catReportCustomer').value,target=el('catReportResult');
 if(!from||!to||from>to){target.textContent='請選擇正確日期區間';return;}
 target.textContent='正在查詢銷售資料…';el('catReportRun').disabled=true;
 try{
  var orders=[],page=0,chunk=500;
  while(true){
   var path='orders?select=id,tracking_id,order_date,customer_id,status,order_total,buyer&order_source=eq.web&deleted_at=is.null&status=neq.cancelled&order_date=gte.'+from+'&order_date=lte.'+to+(cid?'&customer_id=eq.'+encodeURIComponent(cid):'')+'&order=order_date.asc,tracking_id.asc&limit='+chunk+'&offset='+(page*chunk);
   var part=await get(path);orders=orders.concat(part);if(part.length<chunk)break;if(++page>=20)throw Error('資料超過 10,000 張訂單，請縮小日期區間查詢');
  }
  if(!orders.length){target.innerHTML='<div class="catalog-empty">這個篩選區間沒有符合的已核准商城訂單。</div>';return;}
  var clients=await get('customers?select=id,customer_code,name');
  var cmap={};clients.forEach(function(c){cmap[c.id]=c.customer_code+' '+c.name;});
  var rows=[],subtotal=0,quantity=0;
  for(var i=0;i<orders.length;i+=70){
   var batch=orders.slice(i,i+70),ids=batch.map(function(o){return o.id;});
   var details=await get('order_items?select=order_id,product_code,product_name,variant,quantity,quantity_unit,unit_price,line_total&order_id=in.('+ids.join(',')+')&order=sort_order.asc');
   var byId={};details.forEach(function(d){(byId[d.order_id]||(byId[d.order_id]=[])).push(d);});
   batch.forEach(function(o){(byId[o.id]||[]).forEach(function(d){var amount=Number(d.line_total==null?Number(d.quantity||0)*Number(d.unit_price||0):d.line_total);subtotal+=amount;quantity+=Number(d.quantity||0);rows.push({o:o,d:d,amount:amount});});});
  }
  var total=orders.reduce(function(n,o){return n+Number(o.order_total||0);},0);
  target.innerHTML='<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:13px"><div><b>正式訂單</b><div>'+orders.length+' 筆</div></div><div><b>商品總數量</b><div>'+quantity+'</div></div><div><b>銷售總金額</b><div style="font-size:22px;font-weight:800;color:#087e77">'+money(total)+'</div></div></div>'+
   '<div style="overflow-x:auto"><table style="width:100%;min-width:820px;border-collapse:collapse;font-size:13px"><thead><tr style="background:#eff3f7"><th>日期</th><th>訂單編號</th><th>客戶</th><th>貨號</th><th>商品名稱／規格</th><th>數量</th><th>單價</th><th>小計</th></tr></thead><tbody>'+
   rows.map(function(x){return '<tr style="border-bottom:1px solid #e5e7eb"><td style="padding:9px 5px">'+safe(x.o.order_date)+'</td><td>'+safe('ORD-'+String(x.o.tracking_id).padStart(6,'0'))+'</td><td>'+safe(cmap[x.o.customer_id]||x.o.buyer||'—')+'</td><td>'+safe(x.d.product_code||'')+'</td><td>'+safe(x.d.product_name||'')+'<div class="muted">'+safe(x.d.variant||'')+'</div></td><td style="text-align:right">'+safe(x.d.quantity)+' '+safe(x.d.quantity_unit||'')+'</td><td style="text-align:right">'+money(x.d.unit_price)+'</td><td style="text-align:right;font-weight:700">'+money(x.amount)+'</td></tr>';}).join('')+
   '</tbody></table></div><div class="muted" style="text-align:right;margin-top:8px">明細小計合計 '+money(subtotal)+'｜訂單總金額 '+money(total)+'</div>';
 }catch(e){target.innerHTML='<div class="message error">'+safe(e.message)+'</div>';}
 finally{el('catReportRun').disabled=false;}
}
window.CatalogSalesReport={render:setup};
})();