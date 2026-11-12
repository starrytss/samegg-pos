// 門市 POS 收銀系統的核心：金額計算、折扣、稅額、付款與找零、退貨、交班、報表與 CSV。
// 不碰 DOM 也不碰儲存空間，瀏覽器與 Node 測試共用同一份程式。金額一律用整數（元）。
(function(root){
 'use strict';

 const DEFAULT_METHODS=Object.freeze([
  {id:'cash',name:'現金',cash:true},
  {id:'card',name:'信用卡'},
  {id:'mobile',name:'電子支付'},
  {id:'transfer',name:'轉帳'}
 ]);
 const DEFAULT_SETTINGS=Object.freeze({
  storeName:'我的門市',storeAddress:'',storePhone:'',storeTaxId:'',receiptFooter:'謝謝光臨，歡迎再來',
  currency:'NT$',taxMode:'included',taxRate:5,
  earnPer:100,pointValue:1,
  receiptWidth:58,autoPrint:false,sound:true,blockOversell:false,lowStock:5,
  cashiers:['店長'],cashier:'店長',methods:DEFAULT_METHODS.map(m=>({...m})),demo:false
 });

 // ---------- 基本工具 ----------
 const STATUS=Object.freeze({paid:'已結帳',partial:'部分退貨',refunded:'已退貨'});
 const int=value=>{const n=Math.round(Number(value));return Number.isFinite(n)?n:0;};
 const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
 // 接受全形數字、千分位逗號與前後空白；不是非負整數就回傳 NaN。
 function parseAmount(text){
  const value=String(text??'').normalize('NFKC').replace(/[,\s$]/g,'').replace(/^NT/i,'');
  if(!/^\d+(\.\d+)?$/.test(value))return NaN;
  return Math.round(Number(value));
 }
 function formatMoney(amount,currency){
  const n=int(amount),text=Math.abs(n).toLocaleString('en-US');
  return (n<0?'-':'')+(currency??'NT$')+text;
 }
 const pad=(n,width=2)=>String(n).padStart(width,'0');
 // 以裝置的當地時間切日，報表與單號都用同一個日期。
 function dateKey(time){const d=new Date(time);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
 function formatTime(time){const d=new Date(time);return dateKey(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes());}
 function dayStart(key){const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d).getTime();}
 function addDays(key,days){const [y,m,d]=key.split('-').map(Number);return dateKey(new Date(y,m-1,d+days));}

 // 依權重把整數金額分給每一項，總和一定等於原金額（最大餘數法）。
 function allocate(total,weights){
  const sum=weights.reduce((a,b)=>a+b,0);
  if(!weights.length)return [];
  if(sum<=0)return weights.map((_,i)=>i===0?total:0);
  const exact=weights.map(w=>total*w/sum),shares=exact.map(Math.floor);
  let rest=total-shares.reduce((a,b)=>a+b,0);
  const order=exact.map((value,i)=>[value-shares[i],i]).sort((a,b)=>b[0]-a[0]||a[1]-b[1]);
  for(let k=0;rest>0;k++,rest--)shares[order[k%order.length][1]]++;
  return shares;
 }

 // ---------- 統一編號、載具與條碼 ----------
 // 營業人統一編號檢查：權數 1,2,1,2,1,2,4,1，各乘積的數字和加總能被 5 整除；第 7 碼是 7 時加 1 也算。
 function validTaxId(text){
  const id=String(text??'').normalize('NFKC').trim();
  if(!/^\d{8}$/.test(id))return false;
  const weights=[1,2,1,2,1,2,4,1];let sum=0;
  for(let i=0;i<8;i++){const p=Number(id[i])*weights[i];sum+=Math.floor(p/10)+p%10;}
  return sum%5===0||(id[6]==='7'&&(sum+1)%5===0);
 }
 // 手機條碼載具：斜線開頭加 7 碼（數字、大寫英文、+ - .）。
 function normalizeCarrier(text){return String(text??'').normalize('NFKC').trim().toUpperCase();}
 function validCarrier(text){return /^\/[0-9A-Z.+-]{7}$/.test(normalizeCarrier(text));}
 function ean13(base12){
  const digits=String(base12).padStart(12,'0').slice(0,12);let sum=0;
  for(let i=0;i<12;i++)sum+=Number(digits[i])*(i%2?3:1);
  return digits+String((10-sum%10)%10);
 }
 function normalizeCode(text){return String(text??'').normalize('NFKC').trim().toUpperCase();}

 // ---------- 購物車計算 ----------
 // 折扣：{type:'pct',value:10} 打九折（折 10%），{type:'amt',value:20} 折 20 元。
 function discountAmount(base,discount){
  if(!discount||!(discount.value>0)||base<=0)return 0;
  if(discount.type==='pct')return clamp(Math.round(base*Math.min(discount.value,100)/100),0,base);
  return clamp(int(discount.value),0,base);
 }
 function discountLabel(discount){
  if(!discount||!(discount.value>0))return '';
  if(discount.type==='pct'){
   const keep=100-Math.min(discount.value,100);
   // 台灣習慣講「幾折」：折 10% 是 9 折，折 15% 是 85 折。
   return (keep%10===0?String(keep/10):String(keep))+' 折';
  }
  return '折 '+int(discount.value)+' 元';
 }
 // 把「幾折」換成折扣百分比：9→折 10%，85→折 15%，8.5→折 15%，95→折 5%。不合理的輸入回傳 NaN。
 function foldToPct(text){
  const value=String(text??'').normalize('NFKC').trim().replace(/折$/,'');
  if(!/^\d{1,2}(\.\d)?$/.test(value))return NaN;
  const n=Number(value),keep=n<10?n*10:n;
  return keep>0&&keep<100?Math.round((100-keep)*10)/10:NaN;
 }
 function lineTotals(line){
  const qty=Math.max(0,int(line.qty)),gross=int(line.price)*qty,off=discountAmount(gross,line.discount);
  return {gross,off,net:gross-off};
 }
 function taxOf(base,settings){
  const rate=Math.max(0,Number(settings.taxRate)||0)/100;
  if(settings.taxMode==='added')return {tax:Math.round(base*rate),total:base+Math.round(base*rate)};
  if(settings.taxMode==='included')return {tax:Math.round(base-base/(1+rate)),total:base};
  return {tax:0,total:base};
 }
 // cart:{lines,discount,pointsUse}；member:{points}；回傳每行金額與整張單的合計。
 function computeCart(cart,settings,member){
  const lines=(cart.lines||[]).map(line=>({...line,...lineTotals(line)}));
  const subtotal=lines.reduce((sum,line)=>sum+line.net,0);
  const gross=lines.reduce((sum,line)=>sum+line.gross,0);
  const orderDiscount=discountAmount(subtotal,cart.discount);
  const afterDiscount=subtotal-orderDiscount;
  const pointValue=Math.max(1,int(settings.pointValue)||1);
  const maxPoints=member?Math.min(Math.max(0,int(member.points)),Math.floor(afterDiscount/pointValue)):0;
  const pointsUsed=clamp(int(cart.pointsUse),0,maxPoints),pointsValue=pointsUsed*pointValue;
  const {tax,total}=taxOf(afterDiscount-pointsValue,settings);
  const earnPer=int(settings.earnPer);
  return {
   lines,qty:lines.reduce((sum,line)=>sum+int(line.qty),0),gross,lineDiscount:gross-subtotal,subtotal,
   orderDiscount,maxPoints,pointsUsed,pointsValue,tax,total,
   pointsEarned:member&&earnPer>0?Math.floor(total/earnPer):0
  };
 }

 // ---------- 付款 ----------
 // 非現金付款不能超過應收金額，找零只從現金出。
 function settlePayments(total,payments){
  const list=(payments||[]).filter(p=>int(p.amount)>0).map(p=>({id:p.id,name:p.name,cash:!!p.cash,amount:int(p.amount)}));
  const paid=list.reduce((sum,p)=>sum+p.amount,0),cash=list.filter(p=>p.cash).reduce((sum,p)=>sum+p.amount,0),nonCash=paid-cash;
  if(total>0&&!list.length)return {ok:false,error:'請輸入收款金額',paid,due:total,change:0,payments:list};
  if(nonCash>total)return {ok:false,error:'非現金付款不能超過應收金額',paid,due:0,change:0,payments:list};
  if(paid<total)return {ok:false,error:'還差 '+(total-paid)+' 元',paid,due:total-paid,change:0,payments:list};
  return {ok:true,error:'',paid,due:0,change:paid-total,payments:list};
 }
 // 現金快速鍵：剛好、往上湊到 50／100／500／1000。
 function cashSuggestions(total){
  const set=new Set([total]);
  for(const step of [50,100,500,1000]){const up=Math.ceil(total/step)*step;if(up>total)set.add(up);else set.add(up+step);}
  return [...set].filter(n=>n>0).sort((a,b)=>a-b).slice(0,5);
 }

 // ---------- 單號與訂單 ----------
 // 每天從 0001 起跳，例如 20261111-0001。
 function nextOrderId(seq,time){
  const day=dateKey(time).replaceAll('-',''),n=seq&&seq.day===day?seq.n+1:1;
  return {id:day+'-'+pad(n,4),seq:{day,n}};
 }
 function buildOrder({id,time,cart,settings,member,payments,cashier,shiftId,buyerTaxId,carrier,note}){
  const totals=computeCart(cart,settings,member),settled=settlePayments(totals.total,payments);
  if(!totals.lines.length)throw Error('購物車是空的');
  if(!settled.ok)throw Error(settled.error);
  // 每一行實際收到的金額（已扣整單折扣與點數、含稅），退貨時照這個比例退。
  const shares=allocate(totals.total,totals.lines.map(line=>line.net));
  return {
   id,t:time,cashier:cashier||'',shiftId:shiftId||'',
   memberId:member?member.id:'',memberName:member?member.name:'',
   lines:totals.lines.map((line,i)=>({pid:line.pid||'',name:line.name,sku:line.sku||'',cat:line.cat||'',price:int(line.price),qty:int(line.qty),cost:int(line.cost),discount:line.off,discountLabel:discountLabel(line.discount),note:line.note||'',net:line.net,share:shares[i],returned:0,refunded:0})),
   gross:totals.gross,lineDiscount:totals.lineDiscount,subtotal:totals.subtotal,
   orderDiscount:totals.orderDiscount,orderDiscountLabel:discountLabel(cart.discount),
   pointsUsed:totals.pointsUsed,pointsValue:totals.pointsValue,pointsEarned:totals.pointsEarned,earnPer:int(settings.earnPer),
   taxMode:settings.taxMode,taxRate:Number(settings.taxRate)||0,tax:totals.tax,total:totals.total,
   payments:settled.payments,paid:settled.paid,change:settled.change,
   buyerTaxId:buyerTaxId||'',carrier:carrier||'',note:note||'',status:'paid',refunds:[]
  };
 }
 const refundedTotal=order=>(order.refunds||[]).reduce((sum,r)=>sum+r.amount,0);
 const orderNet=order=>order.total-refundedTotal(order);
 // 現金實收（扣掉找零）；交班時用來算抽屜應有現金。
 function cashReceived(order){
  const cash=order.payments.filter(p=>p.cash).reduce((sum,p)=>sum+p.amount,0);
  return cash-order.change;
 }
 // 每種付款方式的實收金額（找零從現金扣）。
 function paymentBreakdown(order){
  // 找零只扣一次，扣在第一筆現金上。
  const firstCash=order.payments.findIndex(p=>p.cash);
  return order.payments.map((p,i)=>({id:p.id,name:p.name,cash:!!p.cash,amount:p.amount-(i===firstCash?order.change:0)}));
 }

 // ---------- 退貨 ----------
 // picks:[{i:行號,qty:退幾個}]；回傳可退金額。最後一批退完時把餘額補齊，避免四捨五入差一元。
 function refundQuote(order,picks){
  const lines=[];let amount=0;
  for(const pick of picks||[]){
   const line=order.lines[pick.i];if(!line)continue;
   const left=line.qty-line.returned,qty=clamp(int(pick.qty),0,left);
   if(!qty)continue;
   const remain=line.share-line.refunded;
   const value=qty===left?remain:Math.min(remain,Math.round(line.share*qty/line.qty));
   lines.push({i:pick.i,pid:line.pid,name:line.name,qty,amount:value});amount+=value;
  }
  const full=lines.length>0&&order.lines.every((line,i)=>{
   const picked=lines.find(l=>l.i===i);return line.returned+(picked?picked.qty:0)>=line.qty;
  });
  return {lines,amount,qty:lines.reduce((sum,l)=>sum+l.qty,0),full};
 }
 // 回傳新的訂單，以及會員點數與累計消費要調整多少。
 function applyRefund(order,quote,meta={}){
  if(!quote.lines.length)throw Error('請選擇要退的品項');
  const lines=order.lines.map(line=>({...line}));
  for(const item of quote.lines){lines[item.i].returned+=item.qty;lines[item.i].refunded+=item.amount;}
  const tax=order.total>0?Math.round(quote.amount*order.tax/order.total):0;
  const refund={t:meta.time??Date.now(),amount:quote.amount,tax,lines:quote.lines.map(l=>({...l})),method:meta.method||{id:'cash',name:'現金',cash:true},cashier:meta.cashier||'',shiftId:meta.shiftId||'',restock:meta.restock!==false,reason:meta.reason||''};
  const refunds=[...(order.refunds||[]),refund],full=lines.every(line=>line.returned>=line.qty);
  const remaining=order.total-refunds.reduce((sum,r)=>sum+r.amount,0);
  // 重新計算這張單該得的點數；全部退完時把折抵的點數還給會員。
  const earnedNow=order.pointsEarnedNow??order.pointsEarned;
  const earnedAfter=full?0:(order.earnPer>0?Math.min(earnedNow,Math.floor(remaining/order.earnPer)):0);
  const pointsDelta=(earnedAfter-earnedNow)+(full&&!order.pointsReturned?order.pointsUsed:0);
  return {
   order:{...order,lines,refunds,status:full?'refunded':'partial',pointsEarnedNow:earnedAfter,pointsReturned:full||!!order.pointsReturned},
   refund,pointsDelta,spendDelta:-quote.amount
  };
 }

 // ---------- 交班 ----------
 function emptyMethodRow(method){return {id:method.id,name:method.name,cash:!!method.cash,sales:0,refunds:0,count:0};}
 function collect(orders,inOrder,inRefund){
  const methods=new Map(),result={orders:0,items:0,sales:0,tax:0,discount:0,refunds:0,refundCount:0,refundTax:0,cashSales:0,cashRefunds:0};
  const row=method=>{if(!methods.has(method.id))methods.set(method.id,emptyMethodRow(method));return methods.get(method.id);};
  for(const order of orders){
   if(inOrder(order)){
    result.orders++;result.sales+=order.total;result.tax+=order.tax;
    result.discount+=order.lineDiscount+order.orderDiscount+order.pointsValue;
    result.items+=order.lines.reduce((sum,line)=>sum+line.qty,0);
    result.cashSales+=cashReceived(order);
    for(const p of paymentBreakdown(order)){const r=row(p);r.sales+=p.amount;r.count++;}
   }
   for(const refund of order.refunds||[]){
    if(!inRefund(refund,order))continue;
    result.refunds+=refund.amount;result.refundCount++;result.refundTax+=refund.tax||0;
    if(refund.method.cash)result.cashRefunds+=refund.amount;
    row(refund.method).refunds+=refund.amount;
   }
  }
  result.net=result.sales-result.refunds;
  result.methods=[...methods.values()].map(m=>({...m,net:m.sales-m.refunds}));
  return result;
 }
 function shiftSummary(shift,orders){
  const base=collect(orders,order=>order.shiftId===shift.id,refund=>refund.shiftId===shift.id);
  const moves=shift.cashMoves||[];
  const cashIn=moves.filter(m=>m.type==='in').reduce((sum,m)=>sum+m.amount,0);
  const cashOut=moves.filter(m=>m.type==='out').reduce((sum,m)=>sum+m.amount,0);
  const expectedCash=int(shift.openingCash)+base.cashSales-base.cashRefunds+cashIn-cashOut;
  const counted=shift.countedCash==null?null:int(shift.countedCash);
  return {...base,openingCash:int(shift.openingCash),cashIn,cashOut,expectedCash,countedCash:counted,difference:counted==null?null:counted-expectedCash};
 }

 // ---------- 日結 ----------
 // 一整天的彙總：銷售算在結帳那天、退款算在退款那天；現金收支看那一天記的每一筆。
 // 開班零用金取當天第一班的金額（同一個抽屜交接給下一班，不重複計算）。
 function daySummary(orders,shifts,day){
  const start=dayStart(day),end=dayStart(addDays(day,1)),within=time=>time>=start&&time<end;
  const base=collect(orders,order=>within(order.t),refund=>within(refund.t));
  const dayShifts=(shifts||[]).filter(shift=>within(shift.openedAt)).sort((a,b)=>a.openedAt-b.openedAt);
  let cashIn=0,cashOut=0;
  for(const shift of shifts||[])for(const move of shift.cashMoves||[])if(within(move.t)){if(move.type==='in')cashIn+=move.amount;else cashOut+=move.amount;}
  const ids=orders.filter(order=>within(order.t)).map(order=>order.id).sort();
  const openingCash=dayShifts.length?int(dayShifts[0].openingCash):0;
  return {
   ...base,day,netTax:base.tax-base.refundTax,firstOrder:ids[0]||'',lastOrder:ids[ids.length-1]||'',
   openingCash,cashIn,cashOut,expectedCash:openingCash+base.cashSales-base.cashRefunds+cashIn-cashOut,
   shifts:dayShifts.map(shift=>{const s=shiftSummary(shift,orders);return {id:shift.id,cashier:shift.cashier,openedAt:shift.openedAt,closedAt:shift.closedAt||0,orders:s.orders,net:s.net,expectedCash:s.expectedCash,countedCash:s.countedCash,difference:s.difference};})
  };
 }
 // 日結報表的付款方式：照設定裡的順序列出每一種（沒收到錢的也列 0），名稱用現在設定的名稱；
 // 設定裡已經刪掉、但當天有用到的方式排在後面。
 function methodBreakdown(summary,methods){
  const found=summary.methods||[],pick=id=>found.find(m=>m.id===id);
  const rows=(methods||[]).map(m=>{const hit=pick(m.id);return {id:m.id,name:m.name,cash:!!m.cash,count:hit?hit.count:0,sales:hit?hit.sales:0,refunds:hit?hit.refunds:0,net:hit?hit.net:0};});
  for(const m of found)if(!rows.some(row=>row.id===m.id))rows.push({id:m.id,name:m.name,cash:!!m.cash,count:m.count,sales:m.sales,refunds:m.refunds,net:m.net});
  return rows;
 }
 function dayReportRows(record,methods){
  const s=record.summary,counted=record.countedCash;
  return [
   ['日結報表',record.day],['日結時間',record.closedAt?formatTime(record.closedAt):'尚未日結'],['經手人',record.cashier||''],[],
   ['付款方式','筆數','收款','退款','淨額'],...methodBreakdown(s,methods).map(m=>[m.name,m.count,m.sales,m.refunds,m.net]),['合計',s.orders,s.sales,s.refunds,s.net],[],
   ['訂單數',s.orders],['銷售件數',s.items],['折扣與點數折抵',s.discount],['銷售金額',s.sales],['退款',s.refunds],['淨銷售額',s.net],['營業稅',s.netTax],[],
   ['開班零用金',s.openingCash],['現金銷售',s.cashSales],['現金退款',s.cashRefunds],['現金存入',s.cashIn],['現金取出',s.cashOut],['應有現金',s.expectedCash],
   ['實點現金',counted??''],['差額',counted==null?'':counted-s.expectedCash],['備註',record.note||'']
  ];
 }
 // 日結之後又有結帳或退款，數字就和當時不同了。
 function dayChanged(saved,live){return !saved||saved.orders!==live.orders||saved.sales!==live.sales||saved.refunds!==live.refunds||saved.refundCount!==live.refundCount;}
 function closesToRows(closes){
  const rows=[['日期','日結時間','經手人','訂單數','銷售金額','退款','淨額','營業稅','現金應有','實點現金','差額','備註']];
  for(const c of closes){const s=c.summary;rows.push([c.day,formatTime(c.closedAt),c.cashier,s.orders,s.sales,s.refunds,s.net,s.netTax,s.expectedCash,c.countedCash??'',c.countedCash==null?'':c.countedCash-s.expectedCash,c.note||'']);}
  return rows;
 }

 // ---------- 報表 ----------
 // from、to 是 YYYY-MM-DD（含當天）。銷售算在結帳那天，退款算在退款那天。
 function report(orders,from,to){
  const start=dayStart(from),end=dayStart(addDays(to,1)),within=time=>time>=start&&time<end;
  const base=collect(orders,order=>within(order.t),refund=>within(refund.t));
  const products=new Map(),categories=new Map(),days=new Map(),hours=Array.from({length:24},(_,hour)=>({hour,sales:0,orders:0}));
  for(let key=from,guard=0;key<=to&&guard<400;key=addDays(key,1),guard++)days.set(key,{day:key,sales:0,refunds:0,orders:0});
  const productRow=line=>{const key=line.pid||'name:'+line.name;if(!products.has(key))products.set(key,{key,name:line.name,sku:line.sku,cat:line.cat,qty:0,amount:0,cost:0});return products.get(key);};
  const categoryRow=name=>{const key=name||'未分類';if(!categories.has(key))categories.set(key,{name:key,qty:0,amount:0});return categories.get(key);};
  let cost=0;
  for(const order of orders){
   if(within(order.t)){
    const day=days.get(dateKey(order.t));if(day){day.sales+=order.total;day.orders++;}
    const hour=hours[new Date(order.t).getHours()];hour.sales+=order.total;hour.orders++;
    for(const line of order.lines){
     const p=productRow(line);p.qty+=line.qty;p.amount+=line.share;p.cost+=line.cost*line.qty;
     const c=categoryRow(line.cat);c.qty+=line.qty;c.amount+=line.share;
     cost+=line.cost*line.qty;
    }
   }
   for(const refund of order.refunds||[]){
    if(!within(refund.t))continue;
    const day=days.get(dateKey(refund.t));if(day)day.refunds+=refund.amount;
    for(const item of refund.lines){
     const line=order.lines[item.i];if(!line)continue;
     const p=productRow(line);p.qty-=item.qty;p.amount-=item.amount;p.cost-=line.cost*item.qty;
     const c=categoryRow(line.cat);c.qty-=item.qty;c.amount-=item.amount;
     cost-=line.cost*item.qty;
    }
   }
  }
  const netTax=base.tax-base.refundTax;
  return {
   ...base,from,to,cost,netTax,
   // 毛利＝淨銷售額（不含稅）－銷貨成本。
   profit:base.net-netTax-cost,
   average:base.orders?Math.round(base.sales/base.orders):0,
   products:[...products.values()].sort((a,b)=>b.amount-a.amount||b.qty-a.qty),
   categories:[...categories.values()].sort((a,b)=>b.amount-a.amount),
   days:[...days.values()],hours
  };
 }

 // ---------- CSV ----------
 function csvCell(value){
  let text=String(value??'');
  // 開頭是 = + - @ 的儲存格在試算表會被當成公式，前面補一個單引號。
  if(/^[=+\-@\t\r]/.test(text)&&!/^-?\d+(\.\d+)?$/.test(text))text="'"+text;
  return /[",\n\r]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
 }
 function toCsv(rows){return '﻿'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';}
 function parseCsv(text){
  const source=String(text??'').replace(/^﻿/,''),rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<source.length;i++){
   const ch=source[i];
   if(quoted){
    if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else quoted=false;}
    else cell+=ch;
   }else if(ch==='"'&&cell==='')quoted=true;
   else if(ch===','||ch==='\t'){row.push(cell);cell='';}
   else if(ch==='\n'||ch==='\r'){
    if(ch==='\r'&&source[i+1]==='\n')i++;
    row.push(cell);cell='';if(row.some(value=>value.trim()!==''))rows.push(row);row=[];
   }else cell+=ch;
  }
  row.push(cell);if(row.some(value=>value.trim()!==''))rows.push(row);
  return rows;
 }
 const PRODUCT_COLUMNS=['名稱','條碼','分類','售價','成本','庫存','安全庫存','狀態'];
 function productsToRows(products,categories){
  const names=new Map(categories.map(c=>[c.id,c.name]));
  return [PRODUCT_COLUMNS,...products.map(p=>[p.name,p.sku||'',names.get(p.categoryId)||'',p.price,p.cost||0,p.track?p.stock:'',p.track?p.lowStock:'',p.active===false?'下架':'上架'])];
 }
 // 讀商品 CSV：第一列是欄位名稱，順序可以不同；回傳可匯入的資料與每一列的問題。
 function productsFromRows(rows){
  if(!rows.length)return {items:[],errors:['檔案是空的']};
  const header=rows[0].map(cell=>cell.trim()),at=name=>header.indexOf(name);
  const col={name:at('名稱'),sku:at('條碼'),category:at('分類'),price:at('售價'),cost:at('成本'),stock:at('庫存'),low:at('安全庫存'),status:at('狀態')};
  if(col.name<0||col.price<0)return {items:[],errors:['第一列需要有「名稱」和「售價」欄位']};
  const items=[],errors=[],seen=new Set();
  rows.slice(1).forEach((row,index)=>{
   const get=i=>i<0?'':String(row[i]??'').trim(),line=index+2,name=get(col.name),price=parseAmount(get(col.price));
   if(!name){errors.push('第 '+line+' 列沒有名稱');return;}
   if(Number.isNaN(price)){errors.push('第 '+line+' 列的售價不是數字');return;}
   const sku=normalizeCode(get(col.sku));
   if(sku&&seen.has(sku)){errors.push('第 '+line+' 列的條碼 '+sku+' 重複');return;}
   if(sku)seen.add(sku);
   const stockText=get(col.stock),stock=stockText===''?NaN:Number(stockText.replace(/,/g,'')),cost=parseAmount(get(col.cost)),low=parseAmount(get(col.low));
   items.push({name:name.slice(0,60),sku,category:get(col.category).slice(0,20),price,cost:Number.isNaN(cost)?0:cost,track:Number.isFinite(stock),stock:Number.isFinite(stock)?Math.round(stock):0,lowStock:Number.isNaN(low)?null:low,active:get(col.status)!=='下架'});
  });
  return {items,errors};
 }
 function ordersToRows(orders){
  const rows=[['單號','時間','收銀員','會員','品項數','小計','折扣','點數折抵','稅額','總計','付款方式','找零','已退款','狀態','統一編號','載具','備註']];
  for(const o of orders)rows.push([o.id,formatTime(o.t),o.cashier,o.memberName,o.lines.reduce((s,l)=>s+l.qty,0),o.gross,o.lineDiscount+o.orderDiscount,o.pointsValue,o.tax,o.total,o.payments.map(p=>p.name+' '+p.amount).join('／'),o.change,refundedTotal(o),STATUS[o.status]||o.status,o.buyerTaxId,o.carrier,o.note]);
  return rows;
 }
 function orderLinesToRows(orders){
  const rows=[['單號','時間','品名','條碼','分類','單價','數量','折扣','實收','已退數量','已退金額']];
  for(const o of orders)for(const l of o.lines)rows.push([o.id,formatTime(o.t),l.name,l.sku,l.cat,l.price,l.qty,l.price*l.qty-l.net,l.share,l.returned,l.refunded]);
  return rows;
 }

 // ---------- 搜尋 ----------
 function matchProduct(product,keyword){
  const key=String(keyword??'').normalize('NFKC').trim().toLowerCase();
  if(!key)return true;
  return product.name.toLowerCase().includes(key)||String(product.sku||'').toLowerCase().includes(key);
 }
 function findByCode(products,code){
  const key=normalizeCode(code);
  return key?products.find(p=>p.active!==false&&normalizeCode(p.sku)===key)||null:null;
 }
 const isLowStock=product=>!!product.track&&product.stock<=int(product.lowStock);

 const api={DEFAULT_SETTINGS,DEFAULT_METHODS,STATUS,PRODUCT_COLUMNS,int,clamp,parseAmount,formatMoney,dateKey,formatTime,dayStart,addDays,allocate,validTaxId,normalizeCarrier,validCarrier,ean13,normalizeCode,discountAmount,discountLabel,foldToPct,lineTotals,computeCart,settlePayments,cashSuggestions,nextOrderId,buildOrder,refundedTotal,orderNet,cashReceived,paymentBreakdown,refundQuote,applyRefund,shiftSummary,daySummary,methodBreakdown,dayReportRows,dayChanged,closesToRows,report,toCsv,parseCsv,productsToRows,productsFromRows,ordersToRows,orderLinesToRows,matchProduct,findByCode,isLowStock};
 if(typeof module==='object'&&module.exports)module.exports=api;
 else root.SamEggPos=api;
})(typeof globalThis!=='undefined'?globalThis:this);
