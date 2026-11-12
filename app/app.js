// 門市 POS 收銀系統的畫面與資料儲存。計算規則都在 pos-core.js；這裡負責畫面、IndexedDB 與列印。
// 所有資料只存在這個瀏覽器（IndexedDB：samegg-pos-v1），不會上傳。
(function(){
 'use strict';
 const P=window.SamEggPos,app=document.getElementById('pos-app');
 if(!P||!app)return;
 const $=(selector,scope=document)=>scope.querySelector(selector),$$=(selector,scope=document)=>[...scope.querySelectorAll(selector)];
 const view=$('#pos-view'),dialog=$('#pos-dialog'),toastBox=$('#pos-toast');
 const h=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
 const money=amount=>P.formatMoney(amount,S.settings.currency);
 const today=()=>P.dateKey(Date.now());
 const desktop=/\bSamEggPOS\//.test(navigator.userAgent);

 // ---------- 資料 ----------
 const S={settings:{...P.DEFAULT_SETTINGS},categories:[],products:[],members:[],held:[],shifts:[],closes:[],seq:null,orders:[],moves:[]};
 const KV=['settings','categories','products','members','held','shifts','closes','seq'];
 const ui={view:'sale',cat:'all',q:'',orders:{range:'today',q:''},products:{q:'',cat:'all'},stock:{filter:'all',q:''},members:{q:''},reports:{range:'today',from:today(),to:today()},close:{day:today()}};
 let cart={lines:[],discount:null,pointsUse:0,memberId:''},pay=null,memoryOnly=false;

 const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const store={
  db:null,
  async open(){
   const req=indexedDB.open('samegg-pos-v1',1);
   req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('kv');db.createObjectStore('orders',{keyPath:'id'});db.createObjectStore('moves',{keyPath:'id'});};
   this.db=await request(req);
  },
  all(name){return request(this.db.transaction(name).objectStore(name).getAll());},
  async kv(){
   const s=this.db.transaction('kv').objectStore('kv'),[keys,values]=await Promise.all([request(s.getAllKeys()),request(s.getAll())]);
   return Object.fromEntries(keys.map((key,i)=>[key,values[i]]));
  },
  // ops：['kv','put',值,鍵]、['orders','put',值]、['moves','clear']……同一批寫入要嘛全部成功、要嘛全部不寫。
  write(ops){
   if(!this.db)return Promise.resolve();
   return new Promise((resolve,reject)=>{
    const tx=this.db.transaction([...new Set(ops.map(op=>op[0]))],'readwrite');
    for(const [name,op,a,b] of ops){const s=tx.objectStore(name);if(op==='put'){if(b===undefined)s.put(a);else s.put(a,b);}else if(op==='delete')s.delete(a);else s.clear();}
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
   });
  }
 };
 let channel=null;try{channel=new BroadcastChannel('samegg-pos-v1');}catch{}
 const kvOps=(...keys)=>keys.map(key=>['kv','put',S[key],key]);
 function commit(ops){
  return store.write(ops).then(()=>channel?.postMessage('changed')).catch(()=>toast('資料沒有存進這個瀏覽器，請確認儲存空間後再試一次','error'));
 }
 const save=(...keys)=>commit(kvOps(...keys));
 function saveCart(){try{sessionStorage.setItem('samegg-pos-cart',JSON.stringify(cart));}catch{}}
 function loadCart(){
  try{const saved=JSON.parse(sessionStorage.getItem('samegg-pos-cart'));if(saved&&Array.isArray(saved.lines))cart={lines:saved.lines,discount:saved.discount||null,pointsUse:saved.pointsUse||0,memberId:saved.memberId||''};}catch{}
  if(cart.memberId&&!member())cart.memberId='';
 }
 async function readAll(){
  const kv=await store.kv();
  for(const key of KV)if(kv[key]!==undefined)S[key]=kv[key];
  S.settings={...P.DEFAULT_SETTINGS,...S.settings};
  if(!Array.isArray(S.settings.methods)||!S.settings.methods.some(m=>m.cash))S.settings.methods=P.DEFAULT_METHODS.map(m=>({...m}));
  S.orders=(await store.all('orders')).sort((a,b)=>a.t-b.t);
  S.moves=(await store.all('moves')).sort((a,b)=>a.t-b.t);
  return kv.settings!==undefined;
 }
 function seedDemo(){
  const cats=['飲料','零食點心','麵包烘焙','生活用品','文具'].map(name=>({id:uid(),name}));
  const rows=[
   ['礦泉水 600ml',0,20,9,48],['無糖綠茶',0,25,13,36],['鮮奶茶',0,35,19,24],['美式咖啡',0,45,18,30],['拿鐵咖啡',0,60,27,30],['柳橙汁',0,40,22,4],
   ['海鹽洋芋片',1,35,20,20],['巧克力餅乾',1,45,26,18],['綜合堅果',1,89,55,12],['水果軟糖',1,30,16,25],['蘇打餅',1,39,22,3],
   ['菠蘿麵包',2,35,15,10],['奶油可頌',2,45,20,8],['鮮奶吐司',2,65,34,6],['肉鬆麵包',2,40,18,0],
   ['抽取式衛生紙',3,29,18,40],['濕紙巾',3,39,22,22],['洗手乳',3,99,58,9],['3 號電池 4 入',3,129,80,14],
   ['原子筆',4,15,6,60],['筆記本 A5',4,49,25,16],['便利貼',4,35,17,20]
  ];
  S.categories=cats;
  S.products=rows.map(([name,cat,price,cost,stock],i)=>({id:uid()+i,name,sku:P.ean13('20000000'+String(i+1).padStart(4,'0')),categoryId:cats[cat].id,price,cost,track:true,stock,lowStock:5,active:true}));
  S.products.push({id:uid()+'bag',name:'購物袋',sku:P.ean13('200000009001'),categoryId:cats[3].id,price:2,cost:1,track:false,stock:0,lowStock:0,active:true});
  S.members=[{id:uid()+'m',name:'王小明',phone:'0912345678',points:120,total:0,visits:0,note:'示範會員',createdAt:Date.now()}];
  S.settings={...P.DEFAULT_SETTINGS,methods:P.DEFAULT_METHODS.map(m=>({...m})),cashiers:['店長'],demo:true};
  S.held=[];S.shifts=[];S.closes=[];S.seq=null;S.orders=[];S.moves=[];
 }
 async function boot(){
  try{
   await store.open();
   if(!(await readAll())){seedDemo();await commit(kvOps(...KV));}
   // 舊版預設叫「行動支付」，現在統一叫「電子支付」；自己改過名稱的不動。
   const mobile=S.settings.methods.find(m=>m.id==='mobile'&&m.name==='行動支付');
   if(mobile){mobile.name='電子支付';await save('settings');}
   navigator.storage?.persist?.().catch(()=>{});
  }catch{
   memoryOnly=true;store.db=null;seedDemo();
  }
  loadCart();
  channel?.addEventListener('message',async()=>{
   // 另一個分頁改了資料：重新讀取，保留這個分頁正在結的帳。
   if(!store.db)return;
   try{await readAll();if(cart.memberId&&!member())cart.memberId='';if(!dialog.open)render();updateBar();}catch{}
  });
  app.dataset.ready='true';
  render();updateBar();setInterval(updateBar,30000);
 }

 // ---------- 小工具 ----------
 const member=()=>S.members.find(m=>m.id===cart.memberId)||null;
 const product=id=>S.products.find(p=>p.id===id)||null;
 const catName=id=>S.categories.find(c=>c.id===id)?.name||'';
 const currentShift=()=>S.shifts.find(s=>!s.closedAt)||null;
 const totals=()=>P.computeCart(cart,S.settings,member());
 const methodById=id=>S.settings.methods.find(m=>m.id===id)||S.settings.methods[0];
 let toastTimer=0;
 function toast(message,kind='info'){
  // 對話框開著時把訊息放進對話框，才不會被背景遮住。
  (dialog.open?dialog:app).append(toastBox);
  toastBox.textContent=message;toastBox.dataset.kind=kind;toastBox.classList.add('is-on');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastBox.classList.remove('is-on'),kind==='error'?5200:2600);
 }
 let audio=null;
 function beep(ok){
  if(!S.settings.sound)return;
  try{
   audio=audio||new (window.AudioContext||window.webkitAudioContext)();
   const osc=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
   osc.frequency.value=ok?1320:220;osc.type=ok?'sine':'square';
   gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12,now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+(ok?.09:.28));
   osc.connect(gain).connect(audio.destination);osc.start(now);osc.stop(now+(ok?.1:.3));
  }catch{}
 }
 function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
 }
 const downloadCsv=(name,rows)=>download(name,P.toCsv(rows),'text/csv;charset=utf-8');
 function addMove(ops,p,type,delta,note,ref){
  const move={id:uid(),t:Date.now(),pid:p.id,name:p.name,type,qty:delta,after:p.stock,note:note||'',ref:ref||''};
  S.moves.push(move);ops.push(['moves','put',move]);
 }
 function rangeDates(range,custom){
  const t=today();
  if(range==='yesterday'){const y=P.addDays(t,-1);return [y,y];}
  if(range==='7d')return [P.addDays(t,-6),t];
  if(range==='month')return [t.slice(0,8)+'01',t];
  if(range==='lastmonth'){const end=P.addDays(t.slice(0,8)+'01',-1);return [end.slice(0,8)+'01',end];}
  if(range==='all')return [S.orders.length?P.dateKey(S.orders[0].t):t,t];
  if(range==='custom'&&custom){const from=custom.from||t,to=custom.to||t;return from<=to?[from,to]:[to,from];}
  return [t,t];
 }
 const RANGES=[['today','今天'],['yesterday','昨天'],['7d','近 7 天'],['month','本月'],['lastmonth','上月'],['all','全部']];
 const rangeChips=(current,act)=>'<div class="pos-chips" role="group" aria-label="日期範圍">'+RANGES.map(([id,label])=>`<button type="button" class="pos-chip" data-act="${act}" data-range="${id}" aria-pressed="${current===id}">${label}</button>`).join('')+'</div>';
 const empty=text=>`<p class="pos-empty">${h(text)}</p>`;
 const statusTag=order=>`<span class="pos-tag pos-tag-${order.status}">${P.STATUS[order.status]||''}</span>`;

 // ---------- 對話框 ----------
 function openDialog({title,body,footer='',form='',size=''}){
  dialog.className='pos-dialog'+(size?' pos-dialog-'+size:'');
  const carry=toastBox.parentElement===dialog;
  dialog.innerHTML=`<form class="pos-dialog-form" data-form="${form}" novalidate><header class="pos-dialog-head"><h2>${h(title)}</h2><button type="button" class="pos-icon" data-act="close-dialog" aria-label="關閉">✕</button></header><div class="pos-dialog-body">${body}</div>${footer?`<footer class="pos-dialog-foot">${footer}</footer>`:''}</form>`;
  if(!dialog.open)dialog.showModal();
  if(carry||toastBox.classList.contains('is-on'))dialog.append(toastBox);
  const first=$('[autofocus]',dialog);if(first){first.focus();first.select?.();}
 }
 function closeDialog(){app.append(toastBox);if(dialog.open)dialog.close();dialog.innerHTML='';pay=null;}
 dialog.addEventListener('close',()=>{
  if(dialog.open)return; // 關掉之後馬上又開了新的對話框
  app.append(toastBox);dialog.innerHTML='';pay=null;
  // 用鍵盤或掃描槍的裝置，關掉對話框後回到搜尋框；觸控裝置不搶焦點，免得跳出螢幕鍵盤。
  if(ui.view==='sale'&&matchMedia('(hover:hover) and (pointer:fine)').matches)$('#pos-search')?.focus({preventScroll:true});
 });
 function confirmDialog(title,message,act,label='確定',danger=false){
  openDialog({title,body:`<p class="pos-confirm">${h(message)}</p>`,footer:`<button type="button" data-act="close-dialog">取消</button><button type="button" class="${danger?'pos-danger':'pos-primary'}" data-act="${act}" autofocus>${h(label)}</button>`});
 }
 const formError=(form,message)=>{const box=$('.pos-form-error',form);if(box){box.textContent=message;box.hidden=!message;}if(message)beep(false);return false;};
 const field=(label,control,hint='')=>`<label class="pos-field"><span>${label}</span>${control}${hint?`<small>${hint}</small>`:''}</label>`;
 const errorBox='<p class="pos-form-error" role="alert" hidden></p>';

 // ---------- 上方工作列 ----------
 const VIEWS=[['sale','收銀'],['orders','訂單'],['products','商品'],['stock','庫存'],['members','會員'],['shift','交班'],['close','日結'],['reports','報表'],['settings','設定']];
 function updateBar(){
  for(const tab of $$('.pos-tab',app)){const on=tab.dataset.view===ui.view;tab.setAttribute('aria-selected',on);tab.tabIndex=on?0:-1;}
  const shift=currentShift(),chip=$('#pos-shift-chip'),now=new Date();
  chip.textContent=shift?'營業中・'+shift.cashier:'尚未開班';chip.dataset.open=!!shift;
  $('#pos-clock').textContent=P.formatTime(now).slice(5);
  $('#pos-store').textContent=S.settings.storeName;
 }
 function show(name){ui.view=name;render();updateBar();view.scrollTop=0;}
 function render(){
  ({sale:renderSale,orders:renderOrders,products:renderProducts,stock:renderStock,members:renderMembers,shift:renderShift,close:renderClose,reports:renderReports,settings:renderSettings})[ui.view]();
  view.dataset.view=ui.view;
 }

 // ---------- 收銀 ----------
 function renderSale(){
  const cats=[['all','全部'],...S.categories.map(c=>[c.id,c.name])];
  view.innerHTML=`<div class="pos-sale">
<section class="pos-catalog" aria-label="商品">
${memoryOnly?'<p class="pos-banner pos-banner-warn">這個瀏覽器目前無法儲存資料（可能是私密瀏覽模式），重新整理後資料會消失。</p>':''}
${S.settings.demo?'<p class="pos-banner">現在是示範商品，可以直接試結帳。準備正式使用時，到「設定」清除示範資料，再建立自己的商品。</p>':''}
<div class="pos-search"><input id="pos-search" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="搜尋品名，或掃描條碼後按 Enter" aria-label="搜尋商品或輸入條碼" value="${h(ui.q)}"><button type="button" data-act="custom-item">＋ 自訂金額</button></div>
<div class="pos-chips" id="pos-cats" role="group" aria-label="商品分類">${cats.map(([id,name])=>`<button type="button" class="pos-chip" data-act="cat" data-id="${h(id)}" aria-pressed="${ui.cat===id}">${h(name)}</button>`).join('')}</div>
<div class="pos-grid" id="pos-grid"></div>
</section>
<section class="pos-cart" id="pos-cart" aria-label="購物車"></section>
</div>
<div class="pos-mobile-bar" id="pos-mobile-bar"></div>`;
  renderGrid();renderCart();
 }
 function renderGrid(){
  const grid=$('#pos-grid');if(!grid)return;
  const list=S.products.filter(p=>p.active!==false&&(ui.cat==='all'||p.categoryId===ui.cat)&&P.matchProduct(p,ui.q));
  if(!list.length){grid.innerHTML=empty(S.products.length?'找不到符合的商品':'還沒有商品，到「商品」頁新增第一個商品');return;}
  grid.innerHTML=list.slice(0,150).map(p=>{
   const out=p.track&&p.stock<=0,low=!out&&P.isLowStock(p);
   return `<button type="button" class="pos-item${out?' is-out':low?' is-low':''}" data-act="add" data-id="${h(p.id)}"><span class="pos-item-name">${h(p.name)}</span><span class="pos-item-meta"><b>${money(p.price)}</b>${p.track?`<small>${out?'缺貨':'剩 '+p.stock}</small>`:''}</span></button>`;
  }).join('')+(list.length>150?`<p class="pos-more">還有 ${list.length-150} 項，請用搜尋或分類縮小範圍</p>`:'');
 }
 function renderCart(){
  const box=$('#pos-cart');if(!box)return;
  const t=totals(),m=member(),taxLabel=S.settings.taxMode==='included'?`內含營業稅 ${S.settings.taxRate}%`:S.settings.taxMode==='added'?`營業稅 ${S.settings.taxRate}%`:'';
  box.innerHTML=`<div class="pos-cart-head"><h2>購物車</h2><div class="pos-cart-tools">${m?`<span class="pos-member-chip"><button type="button" data-act="pick-member" title="更換會員">${h(m.name)}・${m.points} 點</button><button type="button" class="pos-icon" data-act="clear-member" aria-label="取消會員">✕</button></span>`:'<button type="button" data-act="pick-member">＋ 會員</button>'}<button type="button" data-act="held">取單${S.held.length?`<b class="pos-count">${S.held.length}</b>`:''}</button></div></div>
${t.lines.length?`<ol class="pos-lines">${t.lines.map((line,i)=>`<li class="pos-line"><button type="button" class="pos-line-main" data-act="edit-line" data-i="${i}" aria-label="修改 ${h(line.name)}"><span class="pos-line-name">${h(line.name)}</span><span class="pos-line-sub">${money(line.price)}${line.discount?` <em>${h(P.discountLabel(line.discount))}</em>`:''}${line.note?` ・${h(line.note)}`:''}</span></button><div class="pos-qty"><button type="button" data-act="qty" data-i="${i}" data-d="-1" aria-label="${h(line.name)} 減一">−</button><output aria-label="數量">${line.qty}</output><button type="button" data-act="qty" data-i="${i}" data-d="1" aria-label="${h(line.name)} 加一">＋</button></div><span class="pos-line-total">${money(line.net)}</span></li>`).join('')}</ol>`:empty('點選商品或掃描條碼，把商品加進來')}
<dl class="pos-totals">
<div><dt>小計<small>${t.qty} 件</small></dt><dd>${money(t.subtotal)}</dd></div>
${t.orderDiscount?`<div><dt>整單折扣<small>${h(P.discountLabel(cart.discount))}</small></dt><dd>−${money(t.orderDiscount)}</dd></div>`:''}
${m&&(t.maxPoints>0||t.pointsUsed>0)?`<div><dt>點數折抵<button type="button" class="pos-link" data-act="points">${t.pointsUsed?`已用 ${t.pointsUsed} 點`:`可用 ${t.maxPoints} 點`}</button></dt><dd>${t.pointsValue?'−'+money(t.pointsValue):money(0)}</dd></div>`:''}
${taxLabel?`<div class="pos-tax"><dt>${taxLabel}</dt><dd>${money(t.tax)}</dd></div>`:''}
<div class="pos-total"><dt>應收</dt><dd>${money(t.total)}</dd></div>
</dl>
<div class="pos-cart-actions"><button type="button" data-act="clear-cart" ${t.lines.length?'':'disabled'}>清空</button><button type="button" data-act="hold" ${t.lines.length?'':'disabled'}>掛單</button><button type="button" data-act="order-discount" ${t.lines.length?'':'disabled'}>折扣</button><button type="button" class="pos-primary pos-pay" id="pos-pay" data-act="pay" ${t.lines.length?'':'disabled'}>結帳<b>${money(t.total)}</b></button></div>`;
  const bar=$('#pos-mobile-bar');
  if(bar)bar.innerHTML=t.lines.length?`<span>${t.qty} 件・<b>${money(t.total)}</b></span><button type="button" class="pos-primary" data-act="to-cart">看購物車</button>`:'';
 }
 function addProduct(p){
  const inCart=cart.lines.filter(l=>l.pid===p.id).reduce((sum,l)=>sum+l.qty,0);
  if(p.track&&inCart+1>p.stock){
   if(S.settings.blockOversell){beep(false);toast(`「${p.name}」庫存不足，無法再加`,'error');return;}
   toast(`提醒：「${p.name}」庫存只剩 ${p.stock}`,'warn');
  }
  const line=cart.lines.find(l=>l.pid===p.id&&!l.discount&&!l.note&&l.price===p.price);
  if(line)line.qty++;else cart.lines.push({pid:p.id,name:p.name,sku:p.sku||'',cat:catName(p.categoryId),price:p.price,cost:p.cost||0,qty:1,discount:null,note:''});
  beep(true);saveCart();renderCart();
 }
 function resetCart(){cart={lines:[],discount:null,pointsUse:0,memberId:''};saveCart();}
 // 折扣設定共用的表單內容：快速折數、自訂折數或折抵金額。
 function discountFields(discount){
  const type=discount?.type||'none',value=discount?.value||'';
  const fold=type==='pct'?String((100-value)%10===0?(100-value)/10:100-value):'';
  return `<fieldset class="pos-fieldset"><legend>折扣</legend><div class="pos-chips">${[['',0,'不折扣'],['95',5,'95 折'],['9',10,'9 折'],['85',15,'85 折'],['8',20,'8 折'],['7',30,'7 折'],['5',50,'5 折']].map(([f,pct,label])=>`<button type="button" class="pos-chip" data-act="fold" data-fold="${f}" aria-pressed="${pct===0?type==='none':type==='pct'&&value===pct}">${label}</button>`).join('')}</div>
<div class="pos-row">${field('自訂折數','<input name="fold" inputmode="decimal" autocomplete="off" placeholder="例如 88" value="'+h(fold)+'">','9 是九折、85 是八五折')}${field('或折抵金額','<input name="off" inputmode="numeric" autocomplete="off" placeholder="例如 20" value="'+(type==='amt'?h(value):'')+'">','直接減多少元')}</div></fieldset>`;
 }
 function readDiscount(form){
  const fold=form.elements.fold.value.trim(),off=form.elements.off.value.trim();
  if(fold&&off)return {error:'折數和折抵金額請擇一填寫'};
  if(fold){const pct=P.foldToPct(fold);if(Number.isNaN(pct))return {error:'折數請填 1 到 99，例如 9 或 85'};return {discount:{type:'pct',value:pct}};}
  if(off){const amount=P.parseAmount(off);if(Number.isNaN(amount))return {error:'折抵金額請填數字'};return {discount:amount>0?{type:'amt',value:amount}:null};}
  return {discount:null};
 }

 // ---------- 結帳 ----------
 function openPay(){
  const t=totals();if(!t.lines.length)return;
  pay={rows:[{id:'cash',amount:''}],active:0,print:!!S.settings.autoPrint};
  renderPay();
 }
 function payRows(){return pay.rows.map(row=>{const m=methodById(row.id);return {id:m.id,name:m.name,cash:!!m.cash,amount:row.amount===''?0:P.parseAmount(row.amount)};});}
 function paySettle(){
  const t=totals(),rows=payRows();
  // 只有一筆現金而且沒填金額，視為收剛好。
  if(rows.length===1&&pay.rows[0].amount==='')rows[0].amount=t.total;
  if(rows.some(r=>Number.isNaN(r.amount)))return {ok:false,error:'金額請填數字',paid:0,due:t.total,change:0,payments:[]};
  return P.settlePayments(t.total,rows);
 }
 function renderPay(){
  const t=totals(),keep=dialog.open?{taxId:$('[name=taxId]',dialog)?.value||'',carrier:$('[name=carrier]',dialog)?.value||'',note:$('[name=note]',dialog)?.value||''}:{taxId:'',carrier:'',note:''};
  const cashRow=pay.rows.findIndex(r=>methodById(r.id).cash);
  openDialog({title:'結帳',form:'pay',size:'wide',body:`<div class="pos-pay-layout"><div class="pos-pay-main">
<p class="pos-pay-total"><span>應收</span><b>${money(t.total)}</b></p>
<div class="pos-pay-rows">${pay.rows.map((row,i)=>`<div class="pos-pay-row${pay.active===i?' is-active':''}"><select name="method-${i}" data-change="pay-method" data-i="${i}" aria-label="付款方式 ${i+1}">${S.settings.methods.map(m=>`<option value="${h(m.id)}"${m.id===row.id?' selected':''}>${h(m.name)}</option>`).join('')}</select><input name="amount-${i}" data-input="pay-amount" data-i="${i}" inputmode="numeric" autocomplete="off" value="${h(row.amount)}" placeholder="${pay.rows.length===1?t.total:'金額'}" aria-label="收款金額 ${i+1}"${i===pay.active?' autofocus':''}>${pay.rows.length>1?`<button type="button" class="pos-icon" data-act="pay-remove" data-i="${i}" aria-label="移除這筆付款">✕</button>`:''}</div>`).join('')}</div>
<button type="button" class="pos-link" data-act="pay-add">＋ 分開付款（再加一種付款方式）</button>
${cashRow>=0?`<div class="pos-chips pos-quick" aria-label="現金快速鍵">${P.cashSuggestions(t.total).map((amount,i)=>`<button type="button" class="pos-chip" data-act="pay-quick" data-amount="${amount}">${i===0&&amount===t.total?'剛好 ':''}${money(amount)}</button>`).join('')}</div>`:''}
<div class="pos-pay-status" id="pos-pay-status" role="status"></div>
<div class="pos-row">${field('統一編號（選填）','<input name="taxId" inputmode="numeric" maxlength="8" autocomplete="off" value="'+h(keep.taxId)+'">','8 碼，會檢查格式')}${field('手機條碼載具（選填）','<input name="carrier" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="/ABC1234" value="'+h(keep.carrier)+'">','斜線開頭共 8 碼')}</div>${field('訂單備註（選填）','<input name="note" maxlength="60" autocomplete="off" value="'+h(keep.note)+'">')}
<label class="pos-check"><input type="checkbox" name="print" ${pay.print?'checked':''}>結帳後列印交易明細</label>${errorBox}
</div>
<div class="pos-keypad" aria-label="數字鍵盤">${['7','8','9','4','5','6','1','2','3','0','00','⌫'].map(key=>`<button type="button" data-act="pay-key" data-key="${key}"${key==='⌫'?' aria-label="刪除一位"':''}>${key}</button>`).join('')}<button type="button" class="pos-keypad-clear" data-act="pay-key" data-key="C">清除</button></div></div>`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">完成結帳</button>'});
  updatePayStatus();
 }
 function updatePayStatus(){
  const box=$('#pos-pay-status');if(!box||!pay)return;
  const s=paySettle(),cash=payRows().some(r=>r.cash);
  box.dataset.state=s.ok?'ok':'due';
  box.innerHTML=s.ok?(cash?`<span>找零</span><b>${money(s.change)}</b>`:`<span>收款金額</span><b>${money(s.paid)}</b>`):`<span>${h(s.error)}</span>`;
 }
 function checkout(form){
  const t=totals(),s=paySettle();
  if(!s.ok)return formError(form,s.error);
  const taxId=form.elements.taxId.value.normalize('NFKC').trim(),carrier=P.normalizeCarrier(form.elements.carrier.value);
  if(taxId&&!P.validTaxId(taxId)){form.elements.taxId.focus();return formError(form,'統一編號格式不正確，請再確認 8 碼數字');}
  if(carrier&&!P.validCarrier(carrier)){form.elements.carrier.focus();return formError(form,'載具格式不正確，手機條碼是「/」加 7 碼');}
  if(S.settings.blockOversell){
   for(const line of t.lines){const p=product(line.pid);if(p?.track){const need=t.lines.filter(l=>l.pid===p.id).reduce((sum,l)=>sum+l.qty,0);if(need>p.stock)return formError(form,`「${p.name}」庫存只剩 ${p.stock}，請調整數量`);}}
  }
  const time=Date.now(),next=P.nextOrderId(S.seq,time),m=member(),shift=currentShift();
  let order;
  try{order=P.buildOrder({id:next.id,time,cart,settings:S.settings,member:m,payments:s.payments,cashier:shift?.cashier||S.settings.cashier,shiftId:shift?.id||'',buyerTaxId:taxId,carrier,note:form.elements.note.value.trim()});}
  catch(error){return formError(form,error.message);}
  const ops=[['orders','put',order]];
  S.seq=next.seq;S.orders.push(order);
  for(const line of order.lines){const p=product(line.pid);if(p?.track){p.stock-=line.qty;addMove(ops,p,'sale',-line.qty,'',order.id);}}
  if(m){m.points=Math.max(0,m.points-order.pointsUsed+order.pointsEarned);m.total=(m.total||0)+order.total;m.visits=(m.visits||0)+1;m.lastAt=time;}
  ops.push(...kvOps('seq','products','members'));
  commit(ops);
  const wantPrint=form.elements.print.checked;
  resetCart();pay=null;
  openDialog({title:'結帳完成',body:`<div class="pos-done"><p class="pos-done-label">${order.change?'找零':'已收款'}</p><p class="pos-done-amount">${money(order.change||order.total)}</p><p class="pos-done-meta">單號 ${h(order.id)}・${order.payments.map(p=>h(p.name)+' '+money(p.amount)).join('、')}${order.pointsEarned?`・獲得 ${order.pointsEarned} 點`:''}</p></div>`,
   footer:`<button type="button" data-act="print-order" data-id="${h(order.id)}">列印明細</button><button type="button" class="pos-primary" data-act="close-dialog" autofocus>下一位顧客</button>`});
  beep(true);render();
  if(wantPrint)printOrder(order);
  return true;
 }

 // ---------- 列印 ----------
 function printHtml(html){
  let box=$('#pos-print');
  if(!box){box=document.createElement('div');box.id='pos-print';document.body.append(box);}
  box.innerHTML=html;box.dataset.width=S.settings.receiptWidth;
  document.documentElement.classList.add('pos-printing');
  setTimeout(()=>window.print(),50);
 }
 window.addEventListener('afterprint',()=>document.documentElement.classList.remove('pos-printing'));
 function receiptHead(title){
  const s=S.settings;
  return `<h1>${h(s.storeName)}</h1>${s.storeAddress?`<p>${h(s.storeAddress)}</p>`:''}${s.storePhone?`<p>電話 ${h(s.storePhone)}</p>`:''}${s.storeTaxId?`<p>統一編號 ${h(s.storeTaxId)}</p>`:''}<h2>${h(title)}</h2>`;
 }
 const receiptRow=(label,value,cls='')=>`<p class="r-row ${cls}"><span>${label}</span><span>${value}</span></p>`;
 function receiptHtml(order){
  const refunded=P.refundedTotal(order);
  return `<article class="pos-receipt">${receiptHead('交易明細')}
${receiptRow('單號',h(order.id))}${receiptRow('時間',P.formatTime(order.t))}${order.cashier?receiptRow('收銀員',h(order.cashier)):''}${order.memberName?receiptRow('會員',h(order.memberName)):''}
<hr>${order.lines.map(line=>`<p class="r-name">${h(line.name)}${line.note?`（${h(line.note)}）`:''}</p>${receiptRow(`${money(line.price)} × ${line.qty}${line.discountLabel?' '+h(line.discountLabel):''}`,money(line.net))}`).join('')}<hr>
${receiptRow('小計',money(order.subtotal))}${order.orderDiscount?receiptRow('整單折扣 '+h(order.orderDiscountLabel),'−'+money(order.orderDiscount)):''}${order.pointsValue?receiptRow(`點數折抵 ${order.pointsUsed} 點`,'−'+money(order.pointsValue)):''}${order.taxMode==='added'?receiptRow(`營業稅 ${order.taxRate}%`,money(order.tax)):''}
${receiptRow('總計',money(order.total),'r-total')}${order.taxMode==='included'?receiptRow(`內含營業稅 ${order.taxRate}%`,money(order.tax)):''}
<hr>${order.payments.map(p=>receiptRow(h(p.name),money(p.amount))).join('')}${order.change?receiptRow('找零',money(order.change)):''}
${refunded?'<hr>'+order.refunds.map(r=>receiptRow('退款 '+P.formatTime(r.t).slice(5),'−'+money(r.amount))).join('')+receiptRow('退款後金額',money(order.total-refunded),'r-total'):''}
${order.buyerTaxId||order.carrier||order.note||order.pointsEarned?'<hr>':''}${order.buyerTaxId?receiptRow('買受人統編',h(order.buyerTaxId)):''}${order.carrier?receiptRow('載具',h(order.carrier)):''}${order.pointsEarned?receiptRow('本次獲得點數',order.pointsEarned+' 點'):''}${order.note?`<p>備註：${h(order.note)}</p>`:''}
<hr><p class="r-center">${h(S.settings.receiptFooter)}</p><p class="r-center r-small">本明細不是統一發票</p></article>`;
 }
 function printOrder(order){printHtml(receiptHtml(order));}
 function shiftReportHtml(shift){
  const s=P.shiftSummary(shift,S.orders);
  return `<article class="pos-receipt">${receiptHead(shift.closedAt?'交班結帳表':'班別小結')}
${receiptRow('收銀員',h(shift.cashier))}${receiptRow('開班',P.formatTime(shift.openedAt))}${shift.closedAt?receiptRow('交班',P.formatTime(shift.closedAt)):receiptRow('列印時間',P.formatTime(Date.now()))}
<hr>${receiptRow('訂單數',s.orders+' 筆')}${receiptRow('銷售件數',s.items+' 件')}${receiptRow('銷售金額',money(s.sales))}${receiptRow('退款',`−${money(s.refunds)}（${s.refundCount} 筆）`)}${receiptRow('淨額',money(s.net),'r-total')}
<hr>${s.methods.map(m=>receiptRow(h(m.name),money(m.net))).join('')||'<p>沒有收款紀錄</p>'}
<hr>${receiptRow('開班零用金',money(s.openingCash))}${receiptRow('現金銷售',money(s.cashSales))}${receiptRow('現金退款','−'+money(s.cashRefunds))}${receiptRow('現金存入',money(s.cashIn))}${receiptRow('現金取出','−'+money(s.cashOut))}${receiptRow('抽屜應有現金',money(s.expectedCash),'r-total')}
${s.countedCash==null?'':receiptRow('實點現金',money(s.countedCash))+receiptRow('差額',(s.difference>0?'+':'')+money(s.difference))}${shift.note?`<p>備註：${h(shift.note)}</p>`:''}</article>`;
 }

 // ---------- 訂單 ----------
 function ordersInRange(){
  const [from,to]=rangeDates(ui.orders.range),start=P.dayStart(from),end=P.dayStart(P.addDays(to,1)),key=ui.orders.q.normalize('NFKC').trim().toLowerCase();
  return S.orders.filter(o=>o.t>=start&&o.t<end&&(!key||o.id.includes(key)||o.memberName.toLowerCase().includes(key)||o.buyerTaxId.includes(key)||o.lines.some(l=>l.name.toLowerCase().includes(key)))).reverse();
 }
 function renderOrders(){
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>訂單紀錄</h2><div class="pos-page-tools"><button type="button" data-act="export-orders">匯出訂單 CSV</button><button type="button" data-act="export-lines">匯出明細 CSV</button></div></div>
<div class="pos-filters">${rangeChips(ui.orders.range,'orders-range')}<input type="search" id="pos-orders-q" data-input="orders-q" autocomplete="off" placeholder="搜尋單號、品名、會員或統編" aria-label="搜尋訂單" value="${h(ui.orders.q)}"></div><div id="pos-list"></div></div>`;
  renderOrderList();
 }
 function renderOrderList(){
  const list=ordersInRange(),box=$('#pos-list');if(!box)return;
  const sum=list.reduce((total,o)=>total+P.orderNet(o),0);
  box.innerHTML=list.length?`<p class="pos-summary">${list.length} 筆訂單・退款後合計 <b>${money(sum)}</b></p><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>單號</th><th>時間</th><th class="num">件數</th><th class="num">金額</th><th>付款</th><th>會員</th><th>狀態</th></tr></thead><tbody>${list.slice(0,300).map(o=>`<tr><td><button type="button" class="pos-link" data-act="order" data-id="${h(o.id)}">${h(o.id)}</button></td><td>${P.formatTime(o.t).slice(5)}</td><td class="num">${o.lines.reduce((n,l)=>n+l.qty,0)}</td><td class="num">${money(o.total)}</td><td>${o.payments.map(p=>h(p.name)).join('、')}</td><td>${h(o.memberName)||'—'}</td><td>${statusTag(o)}</td></tr>`).join('')}</tbody></table></div>${list.length>300?'<p class="pos-more">只顯示最新 300 筆，請縮小日期範圍或匯出 CSV 查看全部</p>':''}`:empty('這段期間沒有訂單');
 }
 function openOrder(id){
  const o=S.orders.find(order=>order.id===id);if(!o)return;
  const refunded=P.refundedTotal(o);
  openDialog({title:'訂單 '+o.id,size:'wide',body:`<div class="pos-meta"><span>${P.formatTime(o.t)}</span>${o.cashier?`<span>收銀員 ${h(o.cashier)}</span>`:''}${o.memberName?`<span>會員 ${h(o.memberName)}</span>`:''}${o.buyerTaxId?`<span>統編 ${h(o.buyerTaxId)}</span>`:''}${o.carrier?`<span>載具 ${h(o.carrier)}</span>`:''}${statusTag(o)}</div>${o.note?`<p class="pos-note">備註：${h(o.note)}</p>`:''}
<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>品名</th><th class="num">單價</th><th class="num">數量</th><th class="num">金額</th><th class="num">已退</th></tr></thead><tbody>${o.lines.map(l=>`<tr><td>${h(l.name)}${l.discountLabel?` <em class="pos-em">${h(l.discountLabel)}</em>`:''}${l.note?`<small>${h(l.note)}</small>`:''}</td><td class="num">${money(l.price)}</td><td class="num">${l.qty}</td><td class="num">${money(l.net)}</td><td class="num">${l.returned||'—'}</td></tr>`).join('')}</tbody></table></div>
<dl class="pos-totals pos-totals-plain"><div><dt>小計</dt><dd>${money(o.subtotal)}</dd></div>${o.orderDiscount?`<div><dt>整單折扣 ${h(o.orderDiscountLabel)}</dt><dd>−${money(o.orderDiscount)}</dd></div>`:''}${o.pointsValue?`<div><dt>點數折抵 ${o.pointsUsed} 點</dt><dd>−${money(o.pointsValue)}</dd></div>`:''}${o.taxMode!=='none'?`<div><dt>${o.taxMode==='included'?'內含':''}營業稅 ${o.taxRate}%</dt><dd>${money(o.tax)}</dd></div>`:''}<div class="pos-total"><dt>總計</dt><dd>${money(o.total)}</dd></div>${o.payments.map(p=>`<div><dt>${h(p.name)}</dt><dd>${money(p.amount)}</dd></div>`).join('')}${o.change?`<div><dt>找零</dt><dd>${money(o.change)}</dd></div>`:''}${o.refunds.map(r=>`<div class="pos-refund-row"><dt>退款<small>${P.formatTime(r.t).slice(5)}・${h(r.method.name)}${r.reason?'・'+h(r.reason):''}</small></dt><dd>−${money(r.amount)}</dd></div>`).join('')}${refunded?`<div class="pos-total"><dt>退款後金額</dt><dd>${money(o.total-refunded)}</dd></div>`:''}</dl>`,
   footer:`<button type="button" data-act="print-order" data-id="${h(o.id)}">列印明細</button>${o.status!=='refunded'?`<button type="button" class="pos-danger" data-act="refund" data-id="${h(o.id)}">退貨／退款</button>`:''}<button type="button" class="pos-primary" data-act="close-dialog">關閉</button>`});
 }
 function openRefund(id){
  const o=S.orders.find(order=>order.id===id);if(!o)return;
  const methods=[...new Map([...o.payments.map(p=>[p.id,p]),...S.settings.methods.map(m=>[m.id,m])]).values()];
  openDialog({title:'退貨／退款 '+o.id,form:'refund',size:'wide',body:`<input type="hidden" name="id" value="${h(o.id)}"><p class="pos-hint">填入每個品項要退的數量；退款金額依這張單實際收到的金額按比例計算。</p>
<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>品名</th><th class="num">可退</th><th class="num">退幾個</th></tr></thead><tbody>${o.lines.map((l,i)=>{const left=l.qty-l.returned;return `<tr><td>${h(l.name)}</td><td class="num">${left}</td><td class="num">${left?`<input class="pos-qty-input" name="qty-${i}" data-input="refund-qty" type="number" inputmode="numeric" min="0" max="${left}" value="0" aria-label="${h(l.name)} 退貨數量">`:'—'}</td></tr>`;}).join('')}</tbody></table></div>
<button type="button" class="pos-link" data-act="refund-all">全部退</button>
<div class="pos-row">${field('退款方式','<select name="method">'+methods.map(m=>`<option value="${h(m.id)}">${h(m.name)}</option>`).join('')+'</select>')}${field('原因（選填）','<input name="reason" maxlength="40" autocomplete="off">')}</div>
<label class="pos-check"><input type="checkbox" name="restock" checked>把退回的商品加回庫存</label>
<p class="pos-pay-status" id="pos-refund-status" data-state="due"><span>退款金額</span><b>${money(0)}</b></p>${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-danger">確定退款</button>'});
 }
 function refundPicks(form,order){return order.lines.map((_,i)=>({i,qty:Number(form.elements['qty-'+i]?.value)||0}));}
 function doRefund(form){
  const o=S.orders.find(order=>order.id===form.elements.id.value);if(!o)return false;
  const quote=P.refundQuote(o,refundPicks(form,o));
  if(!quote.lines.length)return formError(form,'請先填要退的數量');
  const method=[...o.payments,...S.settings.methods].find(m=>m.id===form.elements.method.value)||S.settings.methods[0],shift=currentShift(),restock=form.elements.restock.checked;
  const result=P.applyRefund(o,quote,{time:Date.now(),method:{id:method.id,name:method.name,cash:!!method.cash},cashier:shift?.cashier||S.settings.cashier,shiftId:shift?.id||'',restock,reason:form.elements.reason.value.trim()});
  const ops=[['orders','put',result.order]];
  S.orders[S.orders.indexOf(o)]=result.order;
  if(restock)for(const item of quote.lines){const p=product(item.pid);if(p?.track){p.stock+=item.qty;addMove(ops,p,'refund',item.qty,'',o.id);}}
  const m=S.members.find(x=>x.id===o.memberId);
  if(m){m.points=Math.max(0,m.points+result.pointsDelta);m.total=Math.max(0,(m.total||0)+result.spendDelta);}
  ops.push(...kvOps('products','members'));commit(ops);
  toast(`已退款 ${money(quote.amount)}（${method.name}）`);
  render();openOrder(o.id);
  return true;
 }

 // ---------- 商品 ----------
 function renderProducts(){
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>商品管理</h2><div class="pos-page-tools"><button type="button" class="pos-primary" data-act="product-new">＋ 新增商品</button><button type="button" data-act="categories">分類管理</button><button type="button" data-act="import-products">匯入 CSV</button><button type="button" data-act="export-products">匯出 CSV</button><input type="file" id="pos-import-file" accept=".csv,text/csv" hidden></div></div>
<div class="pos-filters"><select data-change="products-cat" aria-label="分類"><option value="all">全部分類</option>${S.categories.map(c=>`<option value="${h(c.id)}"${ui.products.cat===c.id?' selected':''}>${h(c.name)}</option>`).join('')}<option value="none"${ui.products.cat==='none'?' selected':''}>未分類</option></select><input type="search" data-input="products-q" autocomplete="off" placeholder="搜尋品名或條碼" aria-label="搜尋商品" value="${h(ui.products.q)}"></div><div id="pos-list"></div></div>`;
  renderProductList();
 }
 function renderProductList(){
  const box=$('#pos-list');if(!box)return;
  const f=ui.products,list=S.products.filter(p=>(f.cat==='all'||(f.cat==='none'?!catName(p.categoryId):p.categoryId===f.cat))&&P.matchProduct(p,f.q));
  box.innerHTML=list.length?`<p class="pos-summary">${list.length} 項商品</p><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>品名</th><th>條碼</th><th>分類</th><th class="num">售價</th><th class="num">成本</th><th class="num">庫存</th><th>狀態</th></tr></thead><tbody>${list.map(p=>`<tr><td><button type="button" class="pos-link" data-act="product-edit" data-id="${h(p.id)}">${h(p.name)}</button></td><td class="mono">${h(p.sku)||'—'}</td><td>${h(catName(p.categoryId))||'—'}</td><td class="num">${money(p.price)}</td><td class="num">${money(p.cost||0)}</td><td class="num">${p.track?p.stock:'不計'}</td><td>${p.active===false?'<span class="pos-tag pos-tag-off">下架</span>':'<span class="pos-tag pos-tag-paid">上架</span>'}</td></tr>`).join('')}</tbody></table></div>`:empty(S.products.length?'找不到符合的商品':'還沒有商品，按「新增商品」開始建立');
 }
 function openProduct(id){
  const p=id?product(id):null;
  openDialog({title:p?'編輯商品':'新增商品',form:'product',body:`<input type="hidden" name="id" value="${h(p?.id||'')}">
${field('品名','<input name="name" maxlength="60" required autocomplete="off" value="'+h(p?.name||'')+'"'+(p?'':' autofocus')+'>')}
<div class="pos-row">${field('條碼／貨號','<input name="sku" maxlength="32" autocomplete="off" autocapitalize="characters" value="'+h(p?.sku||'')+'">','掃描槍掃到這組號碼就會加入購物車')}${field('分類','<select name="category"><option value="">未分類</option>'+S.categories.map(c=>`<option value="${h(c.id)}"${p?.categoryId===c.id?' selected':''}>${h(c.name)}</option>`).join('')+'</select>')}</div>
<div class="pos-row">${field('售價','<input name="price" inputmode="numeric" required autocomplete="off" value="'+h(p?p.price:'')+'">')}${field('成本','<input name="cost" inputmode="numeric" autocomplete="off" value="'+h(p?p.cost||0:'')+'">','用來計算毛利，可不填')}</div>
<label class="pos-check"><input type="checkbox" name="track" ${!p||p.track?'checked':''}>管理庫存數量</label>
<div class="pos-row">${p?field('目前庫存','<input value="'+(p.track?p.stock:'不計')+'" disabled>','要增減庫存，請到「庫存」頁進貨或盤點'):field('期初庫存','<input name="stock" inputmode="numeric" autocomplete="off" value="0">')}${field('安全庫存','<input name="lowStock" inputmode="numeric" autocomplete="off" value="'+h(p?p.lowStock:S.settings.lowStock)+'">','低於等於這個數量會提醒')}</div>
<label class="pos-check"><input type="checkbox" name="active" ${!p||p.active!==false?'checked':''}>上架（顯示在收銀畫面）</label>${errorBox}`,
   footer:`${p?`<button type="button" class="pos-danger pos-left" data-act="product-delete" data-id="${h(p.id)}">刪除</button>`:''}<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>`});
 }
 function saveProduct(form){
  const e=form.elements,id=e.id.value,name=e.name.value.trim(),sku=P.normalizeCode(e.sku.value),price=P.parseAmount(e.price.value),cost=e.cost.value.trim()===''?0:P.parseAmount(e.cost.value),low=e.lowStock.value.trim()===''?0:P.parseAmount(e.lowStock.value);
  if(!name)return formError(form,'請填品名');
  if(Number.isNaN(price))return formError(form,'售價請填數字');
  if(Number.isNaN(cost)||Number.isNaN(low))return formError(form,'成本和安全庫存請填數字');
  if(sku&&S.products.some(p=>p.id!==id&&P.normalizeCode(p.sku)===sku))return formError(form,'這個條碼已經有其他商品在用');
  const ops=[];
  if(id){
   Object.assign(product(id),{name,sku,categoryId:e.category.value,price,cost,track:e.track.checked,lowStock:low,active:e.active.checked});
  }else{
   const stock=e.stock.value.trim()===''?0:P.parseAmount(e.stock.value);
   if(Number.isNaN(stock))return formError(form,'期初庫存請填數字');
   const p={id:uid(),name,sku,categoryId:e.category.value,price,cost,track:e.track.checked,stock:e.track.checked?stock:0,lowStock:low,active:e.active.checked};
   S.products.push(p);if(p.track&&stock>0)addMove(ops,p,'in',stock,'期初庫存');
  }
  ops.push(...kvOps('products'));commit(ops);closeDialog();toast('商品已儲存');render();
  return true;
 }
 function openCategories(){
  openDialog({title:'分類管理',form:'categories',body:`<div class="pos-cat-list">${S.categories.map(c=>`<div class="pos-cat-row"><input name="cat-${h(c.id)}" maxlength="20" autocomplete="off" value="${h(c.name)}" aria-label="分類名稱"><label class="pos-check"><input type="checkbox" name="del-${h(c.id)}">刪除</label></div>`).join('')||'<p class="pos-hint">還沒有分類</p>'}</div>${field('新增分類','<input name="new" maxlength="20" autocomplete="off" placeholder="例如 冷藏食品">','刪除分類後，原本的商品會變成未分類')}${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>'});
 }
 function saveCategories(form){
  const next=[];
  for(const c of S.categories){
   if(form.elements['del-'+c.id].checked){for(const p of S.products)if(p.categoryId===c.id)p.categoryId='';if(ui.cat===c.id)ui.cat='all';if(ui.products.cat===c.id)ui.products.cat='all';continue;}
   const name=form.elements['cat-'+c.id].value.trim();if(!name)return formError(form,'分類名稱不能空白');
   next.push({...c,name});
  }
  const added=form.elements.new.value.trim();if(added)next.push({id:uid(),name:added});
  if(new Set(next.map(c=>c.name)).size!==next.length)return formError(form,'分類名稱不能重複');
  S.categories=next;save('categories','products');closeDialog();toast('分類已更新');render();
  return true;
 }
 let pendingImport=null;
 function previewImport(text){
  const parsed=P.productsFromRows(P.parseCsv(text));
  const match=item=>S.products.find(p=>item.sku?P.normalizeCode(p.sku)===item.sku:p.name===item.name);
  const updates=parsed.items.filter(match).length;
  pendingImport=parsed.items;
  openDialog({title:'匯入商品',body:`<p class="pos-confirm">讀到 ${parsed.items.length} 項商品：新增 ${parsed.items.length-updates} 項、更新 ${updates} 項（有條碼用條碼比對，沒有條碼用品名）。</p>${parsed.errors.length?`<div class="pos-banner pos-banner-warn"><p>有 ${parsed.errors.length} 列無法匯入：</p><ul>${parsed.errors.slice(0,8).map(e=>`<li>${h(e)}</li>`).join('')}</ul>${parsed.errors.length>8?'<p>……其餘略</p>':''}</div>`:''}<p class="pos-hint">欄位：${P.PRODUCT_COLUMNS.join('、')}。有填「庫存」的商品會直接把庫存改成檔案裡的數量。</p>`,
   footer:`<button type="button" data-act="close-dialog">取消</button>${parsed.items.length?'<button type="button" class="pos-primary" data-act="import-apply" autofocus>匯入</button>':''}`});
 }
 function applyImport(){
  const ops=[];
  for(const item of pendingImport||[]){
   let cat=item.category?S.categories.find(c=>c.name===item.category):null;
   if(item.category&&!cat){cat={id:uid(),name:item.category};S.categories.push(cat);}
   let p=S.products.find(x=>item.sku?P.normalizeCode(x.sku)===item.sku:x.name===item.name);
   if(!p){p={id:uid(),name:item.name,sku:item.sku,categoryId:'',price:0,cost:0,track:false,stock:0,lowStock:S.settings.lowStock,active:true};S.products.push(p);}
   const before=p.track?p.stock:0;
   Object.assign(p,{name:item.name,sku:item.sku||p.sku,categoryId:cat?cat.id:(item.category?'':p.categoryId),price:item.price,cost:item.cost,active:item.active});
   if(item.lowStock!=null)p.lowStock=item.lowStock;
   if(item.track){p.track=true;p.stock=item.stock;if(item.stock!==before)addMove(ops,p,'adjust',item.stock-before,'CSV 匯入');}
  }
  const count=pendingImport?.length||0;pendingImport=null;
  ops.push(...kvOps('products','categories'));commit(ops);closeDialog();toast(`已匯入 ${count} 項商品`);render();
 }

 // ---------- 庫存 ----------
 const MOVE_LABEL={sale:'銷售',refund:'退貨',in:'進貨',adjust:'盤點調整'};
 function renderStock(){
  const tracked=S.products.filter(p=>p.track),low=tracked.filter(p=>p.stock>0&&P.isLowStock(p)).length,out=tracked.filter(p=>p.stock<=0).length;
  const value=tracked.reduce((sum,p)=>sum+Math.max(0,p.stock)*(p.cost||0),0);
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>庫存</h2><div class="pos-page-tools"><button type="button" data-act="export-stock">匯出庫存 CSV</button><button type="button" data-act="export-moves">匯出異動 CSV</button></div></div>
<div class="pos-tiles"><div class="pos-tile"><span>管理中的商品</span><b>${tracked.length}</b></div><div class="pos-tile"><span>低於安全庫存</span><b>${low}</b></div><div class="pos-tile"><span>缺貨</span><b>${out}</b></div><div class="pos-tile"><span>庫存成本</span><b>${money(value)}</b></div></div>
<div class="pos-filters"><div class="pos-chips" role="group" aria-label="庫存篩選">${[['all','全部'],['low','低庫存'],['out','缺貨']].map(([id,label])=>`<button type="button" class="pos-chip" data-act="stock-filter" data-id="${id}" aria-pressed="${ui.stock.filter===id}">${label}</button>`).join('')}</div><input type="search" data-input="stock-q" autocomplete="off" placeholder="搜尋品名或條碼" aria-label="搜尋庫存" value="${h(ui.stock.q)}"></div><div id="pos-list"></div>
<h3 class="pos-subhead">最近的庫存異動</h3>${S.moves.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>時間</th><th>品名</th><th>類型</th><th class="num">數量</th><th class="num">結存</th><th>備註</th></tr></thead><tbody>${S.moves.slice(-60).reverse().map(m=>`<tr><td>${P.formatTime(m.t).slice(5)}</td><td>${h(m.name)}</td><td>${MOVE_LABEL[m.type]||h(m.type)}</td><td class="num">${m.qty>0?'+':''}${m.qty}</td><td class="num">${m.after}</td><td>${h(m.note||m.ref)}</td></tr>`).join('')}</tbody></table></div>`:empty('還沒有庫存異動')}</div>`;
  renderStockList();
 }
 function renderStockList(){
  const box=$('#pos-list');if(!box)return;
  const f=ui.stock,list=S.products.filter(p=>p.track&&P.matchProduct(p,f.q)&&(f.filter==='all'||(f.filter==='out'?p.stock<=0:p.stock>0&&P.isLowStock(p))));
  box.innerHTML=list.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>品名</th><th>分類</th><th class="num">庫存</th><th class="num">安全庫存</th><th>操作</th></tr></thead><tbody>${list.map(p=>`<tr><td>${h(p.name)}<small class="mono">${h(p.sku)}</small></td><td>${h(catName(p.categoryId))||'—'}</td><td class="num">${p.stock<=0?`<span class="pos-tag pos-tag-refunded">${p.stock}</span>`:P.isLowStock(p)?`<span class="pos-tag pos-tag-partial">${p.stock}</span>`:p.stock}</td><td class="num">${p.lowStock}</td><td class="pos-actions"><button type="button" data-act="stock-in" data-id="${h(p.id)}">進貨</button><button type="button" data-act="stock-count" data-id="${h(p.id)}">盤點</button></td></tr>`).join('')}</tbody></table></div>`:empty(f.filter==='all'&&!f.q?'沒有管理庫存的商品':'沒有符合的商品');
 }
 function openStock(id,mode){
  const p=product(id);if(!p)return;
  openDialog({title:(mode==='in'?'進貨：':'盤點：')+p.name,form:'stock',body:`<input type="hidden" name="id" value="${h(p.id)}"><input type="hidden" name="mode" value="${mode}"><p class="pos-hint">目前庫存 ${p.stock}</p>
${mode==='in'?`<div class="pos-row">${field('進貨數量','<input name="qty" inputmode="numeric" autocomplete="off" required autofocus>')}${field('進貨單價（選填）','<input name="cost" inputmode="numeric" autocomplete="off" placeholder="'+(p.cost||0)+'">','有填會更新商品成本')}</div>`:field('實際盤點數量','<input name="qty" inputmode="numeric" autocomplete="off" required autofocus value="'+p.stock+'">')}
${field('備註（選填）','<input name="note" maxlength="40" autocomplete="off">')}${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>'});
 }
 function saveStock(form){
  const e=form.elements,p=product(e.id.value),qty=P.parseAmount(e.qty.value);if(!p)return false;
  if(Number.isNaN(qty))return formError(form,'數量請填 0 以上的整數');
  const ops=[];
  if(e.mode.value==='in'){
   if(qty<=0)return formError(form,'進貨數量要大於 0');
   const cost=e.cost.value.trim();if(cost){const c=P.parseAmount(cost);if(Number.isNaN(c))return formError(form,'進貨單價請填數字');p.cost=c;}
   p.stock+=qty;addMove(ops,p,'in',qty,e.note.value.trim());
  }else{
   const delta=qty-p.stock;p.stock=qty;addMove(ops,p,'adjust',delta,e.note.value.trim());
  }
  ops.push(...kvOps('products'));commit(ops);closeDialog();toast('庫存已更新');render();
  return true;
 }

 // ---------- 會員 ----------
 const matchMember=(m,q)=>{const key=q.normalize('NFKC').trim().toLowerCase();return !key||m.name.toLowerCase().includes(key)||String(m.phone||'').includes(key);};
 function renderMembers(){
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>會員</h2><div class="pos-page-tools"><button type="button" class="pos-primary" data-act="member-new">＋ 新增會員</button><button type="button" data-act="export-members">匯出 CSV</button></div></div>
<div class="pos-filters"><input type="search" data-input="members-q" autocomplete="off" placeholder="搜尋姓名或電話" aria-label="搜尋會員" value="${h(ui.members.q)}"></div><div id="pos-list"></div>
<p class="pos-hint">集點規則：${S.settings.earnPer>0?`每消費 ${money(S.settings.earnPer)} 得 1 點，1 點可折 ${money(S.settings.pointValue)}`:'目前沒有開啟集點'}。可在「設定」調整。</p></div>`;
  renderMemberList();
 }
 function renderMemberList(){
  const box=$('#pos-list');if(!box)return;
  const list=S.members.filter(m=>matchMember(m,ui.members.q));
  box.innerHTML=list.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>姓名</th><th>電話</th><th class="num">點數</th><th class="num">累計消費</th><th class="num">來店</th><th>操作</th></tr></thead><tbody>${list.map(m=>`<tr><td><button type="button" class="pos-link" data-act="member-edit" data-id="${h(m.id)}">${h(m.name)}</button></td><td class="mono">${h(m.phone)||'—'}</td><td class="num">${m.points}</td><td class="num">${money(m.total||0)}</td><td class="num">${m.visits||0}</td><td class="pos-actions"><button type="button" data-act="member-history" data-id="${h(m.id)}">消費紀錄</button></td></tr>`).join('')}</tbody></table></div>`:empty(S.members.length?'找不到符合的會員':'還沒有會員');
 }
 function openMember(id,fromCart=false){
  const m=id?S.members.find(x=>x.id===id):null;
  openDialog({title:m?'編輯會員':'新增會員',form:'member',body:`<input type="hidden" name="id" value="${h(m?.id||'')}"><input type="hidden" name="pick" value="${fromCart?'1':''}">
<div class="pos-row">${field('姓名','<input name="name" maxlength="30" required autocomplete="off" value="'+h(m?.name||'')+'"'+(m?'':' autofocus')+'>')}${field('電話','<input name="phone" inputmode="tel" maxlength="20" autocomplete="off" value="'+h(m?.phone||'')+'">')}</div>
<div class="pos-row">${field('點數','<input name="points" inputmode="numeric" autocomplete="off" value="'+(m?m.points:0)+'">','可直接修改來補點或扣點')}${field('備註','<input name="note" maxlength="60" autocomplete="off" value="'+h(m?.note||'')+'">')}</div>${errorBox}`,
   footer:`${m?`<button type="button" class="pos-danger pos-left" data-act="member-delete" data-id="${h(m.id)}">刪除</button>`:''}<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>`});
 }
 function saveMember(form){
  const e=form.elements,id=e.id.value,name=e.name.value.trim(),phone=e.phone.value.normalize('NFKC').replace(/[\s-]/g,''),points=P.parseAmount(e.points.value);
  if(!name)return formError(form,'請填姓名');
  if(Number.isNaN(points))return formError(form,'點數請填 0 以上的整數');
  if(phone&&S.members.some(m=>m.id!==id&&m.phone===phone))return formError(form,'這個電話已經有會員在用');
  let m=S.members.find(x=>x.id===id);
  if(m)Object.assign(m,{name,phone,points,note:e.note.value.trim()});
  else{m={id:uid(),name,phone,points,total:0,visits:0,note:e.note.value.trim(),createdAt:Date.now()};S.members.push(m);}
  save('members');
  if(e.pick.value){cart.memberId=m.id;cart.pointsUse=0;saveCart();}
  closeDialog();toast('會員已儲存');render();
  return true;
 }
 function openMemberHistory(id){
  const m=S.members.find(x=>x.id===id);if(!m)return;
  const list=S.orders.filter(o=>o.memberId===id).reverse();
  openDialog({title:m.name+' 的消費紀錄',size:'wide',body:`<div class="pos-meta"><span>點數 ${m.points}</span><span>累計消費 ${money(m.total||0)}</span><span>來店 ${m.visits||0} 次</span></div>${list.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>單號</th><th>時間</th><th class="num">金額</th><th class="num">得點</th><th>狀態</th></tr></thead><tbody>${list.slice(0,100).map(o=>`<tr><td><button type="button" class="pos-link" data-act="order" data-id="${h(o.id)}">${h(o.id)}</button></td><td>${P.formatTime(o.t)}</td><td class="num">${money(P.orderNet(o))}</td><td class="num">${o.pointsEarnedNow??o.pointsEarned}</td><td>${statusTag(o)}</td></tr>`).join('')}</tbody></table></div>`:empty('還沒有消費紀錄')}`,footer:'<button type="button" class="pos-primary" data-act="close-dialog">關閉</button>'});
 }
 function openPickMember(){
  openDialog({title:'選擇會員',body:`<input type="search" id="pos-pick-q" data-input="pick-q" autocomplete="off" placeholder="輸入姓名或電話" aria-label="搜尋會員" autofocus><div id="pos-pick-list" class="pos-pick-list"></div>`,footer:'<button type="button" data-act="close-dialog">取消</button><button type="button" class="pos-primary" data-act="member-new-pick">＋ 新增會員</button>'});
  renderPickList('');
 }
 function renderPickList(q){
  const box=$('#pos-pick-list');if(!box)return;
  const list=S.members.filter(m=>matchMember(m,q)).slice(0,30);
  box.innerHTML=list.length?list.map(m=>`<button type="button" class="pos-pick" data-act="member-pick" data-id="${h(m.id)}"><b>${h(m.name)}</b><span>${h(m.phone)||'沒有電話'}・${m.points} 點</span></button>`).join(''):empty('找不到會員，可以按右下角新增');
 }

 // ---------- 交班 ----------
 function renderShift(){
  const shift=currentShift(),past=S.shifts.filter(s=>s.closedAt).slice(-20).reverse();
  let body;
  if(shift){
   const s=P.shiftSummary(shift,S.orders);
   body=`<div class="pos-tiles"><div class="pos-tile"><span>訂單數</span><b>${s.orders}</b></div><div class="pos-tile"><span>銷售金額</span><b>${money(s.sales)}</b></div><div class="pos-tile"><span>退款</span><b>${money(s.refunds)}</b></div><div class="pos-tile pos-tile-strong"><span>抽屜應有現金</span><b>${money(s.expectedCash)}</b></div></div>
<p class="pos-hint">${h(shift.cashier)} 於 ${P.formatTime(shift.openedAt)} 開班，零用金 ${money(s.openingCash)}。</p>
<div class="pos-columns"><section class="pos-card"><h3>收款方式</h3>${s.methods.length?`<dl class="pos-totals pos-totals-plain">${s.methods.map(m=>`<div><dt>${h(m.name)}${m.refunds?`<small>已扣退款 ${money(m.refunds)}</small>`:''}</dt><dd>${money(m.net)}</dd></div>`).join('')}</dl>`:empty('這一班還沒有收款')}
<h3>現金收支</h3><form class="pos-inline-form" data-form="cash-move" novalidate><select name="type" aria-label="類型"><option value="out">取出</option><option value="in">存入</option></select><input name="amount" inputmode="numeric" autocomplete="off" placeholder="金額" aria-label="金額"><input name="note" maxlength="40" autocomplete="off" placeholder="用途，例如買文具" aria-label="用途"><button type="submit">記一筆</button>${errorBox}</form>
${(shift.cashMoves||[]).length?`<ul class="pos-moves">${shift.cashMoves.slice().reverse().map(m=>`<li><span>${P.formatTime(m.t).slice(11)}・${m.type==='in'?'存入':'取出'}${m.note?'・'+h(m.note):''}</span><b>${m.type==='in'?'+':'−'}${money(m.amount)}</b></li>`).join('')}</ul>`:''}</section>
<section class="pos-card"><h3>交班結帳</h3><form data-form="shift-close" novalidate>${field('實際點到的現金','<input name="counted" inputmode="numeric" autocomplete="off" data-input="shift-counted" placeholder="點完後輸入金額">','把抽屜的現金點一次，填在這裡')}<p class="pos-pay-status" id="pos-shift-diff" data-state="due"><span>應有 ${money(s.expectedCash)}</span></p>${field('備註（選填）','<input name="note" maxlength="60" autocomplete="off">')}${errorBox}<div class="pos-form-actions"><button type="button" data-act="print-shift" data-id="${h(shift.id)}">列印小結</button><button type="submit" class="pos-primary">交班結帳</button></div></form></section></div>`;
  }else{
   body=`<section class="pos-card pos-card-narrow"><h3>開班</h3><p class="pos-hint">開班後，這一班的銷售、退款與現金收支會分開統計，交班時可以對帳。沒有開班也能結帳，只是不會算進任何一班。</p><form data-form="shift-open" novalidate><div class="pos-row">${field('收銀員','<select name="cashier">'+S.settings.cashiers.map(c=>`<option${c===S.settings.cashier?' selected':''}>${h(c)}</option>`).join('')+'</select>')}${field('開班零用金','<input name="opening" inputmode="numeric" autocomplete="off" value="0">','抽屜裡準備找零的現金')}</div>${errorBox}<div class="pos-form-actions"><button type="submit" class="pos-primary">開班</button></div></form></section>`;
  }
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>交班</h2></div>${body}
<h3 class="pos-subhead">過去的班別</h3>${past.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>開班</th><th>交班</th><th>收銀員</th><th class="num">淨額</th><th class="num">應有現金</th><th class="num">實點</th><th class="num">差額</th><th>操作</th></tr></thead><tbody>${past.map(sh=>{const s=sh.summary||P.shiftSummary(sh,S.orders);return `<tr><td>${P.formatTime(sh.openedAt).slice(5)}</td><td>${P.formatTime(sh.closedAt).slice(5)}</td><td>${h(sh.cashier)}</td><td class="num">${money(s.net)}</td><td class="num">${money(s.expectedCash)}</td><td class="num">${money(s.countedCash)}</td><td class="num">${s.difference?`<span class="pos-tag pos-tag-partial">${s.difference>0?'+':''}${money(s.difference)}</span>`:money(0)}</td><td class="pos-actions"><button type="button" data-act="print-shift" data-id="${h(sh.id)}">列印</button></td></tr>`;}).join('')}</tbody></table></div>`:empty('還沒有交班紀錄')}</div>`;
 }

 // ---------- 日結 ----------
 const closeOf=day=>S.closes.find(c=>c.day===day)||null;
 const signed=amount=>(amount>0?'+':amount<0?'−':'')+money(Math.abs(amount));
 function renderClose(){
  const day=ui.close.day,d=P.daySummary(S.orders,S.shifts,day),done=closeOf(day),open=currentShift(),changed=done&&P.dayChanged(done.summary,d);
  const past=S.closes.slice().sort((a,b)=>b.day.localeCompare(a.day)).slice(0,31);
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>日結</h2><div class="pos-page-tools"><button type="button" class="pos-primary" data-act="close-report" data-day="${day}">查看這一天的報表</button><button type="button" data-act="export-close-day" data-day="${day}">下載這一天的報表</button><button type="button" data-act="print-close" data-day="${day}">列印</button><button type="button" data-act="export-closes" ${S.closes.length?'':'disabled'}>匯出全部日結紀錄</button></div></div>
<div class="pos-filters"><div class="pos-dates"><button type="button" data-act="close-shift" data-d="-1" aria-label="前一天">‹ 前一天</button><input type="date" aria-label="要查看的日期" data-change="close-day" value="${day}" max="${today()}"><button type="button" data-act="close-shift" data-d="1" ${day>=today()?'disabled':''} aria-label="後一天">後一天 ›</button></div>${done?`<span class="pos-tag pos-tag-paid">已日結 ${P.formatTime(done.closedAt).slice(5)}</span>`:'<span class="pos-tag pos-tag-partial">尚未日結</span>'}</div>
${open?`<p class="pos-banner pos-banner-warn">${h(open.cashier)} 的班還沒交班。建議先到「交班」結完這一班，再做日結，現金才對得起來。</p>`:''}
${changed?'<p class="pos-banner pos-banner-warn">這一天日結之後又有結帳或退款，下面是最新的數字。確認後可以再按一次「重新日結」更新紀錄。</p>':''}
<div class="pos-tiles"><div class="pos-tile pos-tile-strong"><span>淨銷售額</span><b>${money(d.net)}</b></div><div class="pos-tile"><span>訂單數</span><b>${d.orders}</b></div><div class="pos-tile"><span>銷售件數</span><b>${d.items}</b></div><div class="pos-tile"><span>退款</span><b>${money(d.refunds)}</b></div><div class="pos-tile"><span>折扣與點數折抵</span><b>${money(d.discount)}</b></div><div class="pos-tile"><span>營業稅</span><b>${money(d.netTax)}</b></div></div>
${d.firstOrder?`<p class="pos-hint">單號 ${h(d.firstOrder)} 到 ${h(d.lastOrder)}。銷售算在結帳當天，退款算在退款當天。</p>`:''}
<div class="pos-columns"><section class="pos-card"><h3>各付款方式</h3>${d.orders||d.refundCount?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>方式</th><th class="num">筆數</th><th class="num">收款</th><th class="num">退款</th><th class="num">淨額</th></tr></thead><tbody>${P.methodBreakdown(d,S.settings.methods).map(m=>`<tr><td>${h(m.name)}</td><td class="num">${m.count}</td><td class="num">${money(m.sales)}</td><td class="num">${money(m.refunds)}</td><td class="num">${money(m.net)}</td></tr>`).join('')}<tr class="pos-row-total"><td>合計</td><td class="num"></td><td class="num">${money(d.sales)}</td><td class="num">${money(d.refunds)}</td><td class="num">${money(d.net)}</td></tr></tbody></table></div>`:empty('這一天沒有收款')}
<h3>班別</h3>${d.shifts.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>收銀員</th><th>時間</th><th class="num">訂單</th><th class="num">淨額</th><th class="num">現金差額</th></tr></thead><tbody>${d.shifts.map(s=>`<tr><td>${h(s.cashier)}</td><td>${P.formatTime(s.openedAt).slice(11)}–${s.closedAt?P.formatTime(s.closedAt).slice(11):'未交班'}</td><td class="num">${s.orders}</td><td class="num">${money(s.net)}</td><td class="num">${s.difference==null?'—':s.difference?`<span class="pos-tag pos-tag-partial">${signed(s.difference)}</span>`:money(0)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="pos-hint">這一天沒有開班紀錄，現金以全部訂單計算。</p>'}</section>
<section class="pos-card"><h3>現金</h3><dl class="pos-totals pos-totals-plain"><div><dt>開班零用金<small>當天第一班</small></dt><dd>${money(d.openingCash)}</dd></div><div><dt>現金銷售</dt><dd>${money(d.cashSales)}</dd></div><div><dt>現金退款</dt><dd>−${money(d.cashRefunds)}</dd></div><div><dt>現金存入</dt><dd>${money(d.cashIn)}</dd></div><div><dt>現金取出</dt><dd>−${money(d.cashOut)}</dd></div><div class="pos-total"><dt>應有現金</dt><dd>${money(d.expectedCash)}</dd></div></dl>
<form data-form="day-close" novalidate>${field('實際點到的現金（選填）','<input name="counted" inputmode="numeric" autocomplete="off" data-input="close-counted" placeholder="點完後輸入金額" value="'+(done&&done.countedCash!=null?done.countedCash:'')+'">','打烊後把現金點一次；不點現金可以留空')}<p class="pos-pay-status" id="pos-close-diff" data-state="due"><span>應有 ${money(d.expectedCash)}</span></p>${field('備註（選填）','<input name="note" maxlength="60" autocomplete="off" value="'+h(done?.note||'')+'">')}${errorBox}<div class="pos-form-actions"><button type="submit" class="pos-primary">${done?'重新日結並出報表':'完成日結並出報表'}</button></div></form></section></div>
<h3 class="pos-subhead">日結紀錄</h3>${past.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>日期</th><th>日結時間</th><th>經手人</th><th class="num">訂單</th><th class="num">淨額</th><th class="num">應有現金</th><th class="num">實點</th><th class="num">差額</th><th>操作</th></tr></thead><tbody>${past.map(c=>{const diff=c.countedCash==null?null:c.countedCash-c.summary.expectedCash;return `<tr><td><button type="button" class="pos-link" data-act="close-open" data-day="${c.day}">${c.day}</button></td><td>${P.formatTime(c.closedAt).slice(5)}</td><td>${h(c.cashier)}</td><td class="num">${c.summary.orders}</td><td class="num">${money(c.summary.net)}</td><td class="num">${money(c.summary.expectedCash)}</td><td class="num">${c.countedCash==null?'—':money(c.countedCash)}</td><td class="num">${diff==null?'—':diff?`<span class="pos-tag pos-tag-partial">${signed(diff)}</span>`:money(0)}</td><td class="pos-actions"><button type="button" data-act="close-report" data-day="${c.day}">報表</button><button type="button" data-act="export-close-day" data-day="${c.day}">下載</button><button type="button" data-act="print-close" data-day="${c.day}">列印</button></td></tr>`;}).join('')}</tbody></table></div>`:empty('還沒有日結紀錄')}</div>`;
  const input=$('[data-input=close-counted]');if(input?.value)inputs['close-counted'](input);
 }
 // 日結報表：按下「完成日結」就跳出來，最上面是各付款方式今天收了多少。
 function closeRecord(day){
  const done=closeOf(day),live=P.daySummary(S.orders,S.shifts,day),fresh=!done||P.dayChanged(done.summary,live);
  return {day,closedAt:done?.closedAt||0,cashier:done?.cashier||'',countedCash:done?done.countedCash:null,note:done?.note||'',summary:done&&!fresh?done.summary:live,done:!!done,stale:!!done&&fresh};
 }
 function openDayReport(day){
  const r=closeRecord(day),d=r.summary,rows=P.methodBreakdown(d,S.settings.methods),max=Math.max(1,...rows.map(m=>Math.abs(m.net)));
  const diff=r.countedCash==null?null:r.countedCash-d.expectedCash;
  openDialog({title:'日結報表 '+day,size:'wide',body:`<div class="pos-meta"><span>${h(S.settings.storeName)}</span>${r.done?`<span>日結時間 ${P.formatTime(r.closedAt)}</span><span>經手人 ${h(r.cashier)}</span>`:'<span class="pos-tag pos-tag-partial">尚未日結</span>'}${d.firstOrder?`<span>單號 ${h(d.firstOrder.slice(9))}–${h(d.lastOrder.slice(9))}</span>`:''}</div>
${r.stale?'<p class="pos-banner pos-banner-warn">這一天日結之後又有結帳或退款，這裡顯示的是最新數字。</p>':''}
<div class="pos-tiles"><div class="pos-tile pos-tile-strong"><span>今日淨銷售額</span><b>${money(d.net)}</b></div><div class="pos-tile"><span>訂單數</span><b>${d.orders}</b></div><div class="pos-tile"><span>退款</span><b>${money(d.refunds)}</b></div><div class="pos-tile"><span>營業稅</span><b>${money(d.netTax)}</b></div></div>
<section class="pos-card"><h3>各付款方式今日金額</h3><div class="pos-bars pos-methods">${rows.map(m=>`<div class="pos-bar-row"><span>${h(m.name)}<small>${m.count} 筆${m.refunds?`・已扣退款 ${money(m.refunds)}`:''}</small></span><div class="pos-bar-track"><i style="width:${Math.max(0,m.net)/max*100}%"></i></div><b>${money(m.net)}</b></div>`).join('')}<div class="pos-bar-row pos-bar-total"><span>合計</span><span></span><b>${money(d.net)}</b></div></div></section>
<section class="pos-card"><h3>現金對帳</h3><dl class="pos-totals pos-totals-plain"><div><dt>開班零用金</dt><dd>${money(d.openingCash)}</dd></div><div><dt>現金銷售</dt><dd>${money(d.cashSales)}</dd></div><div><dt>現金退款</dt><dd>−${money(d.cashRefunds)}</dd></div><div><dt>現金存入／取出</dt><dd>${money(d.cashIn)}／−${money(d.cashOut)}</dd></div><div class="pos-total"><dt>應有現金</dt><dd>${money(d.expectedCash)}</dd></div>${diff==null?'<div><dt>實點現金</dt><dd>沒有點現金</dd></div>':`<div><dt>實點現金</dt><dd>${money(r.countedCash)}</dd></div><div><dt>差額</dt><dd>${diff===0?'金額相符':signed(diff)}</dd></div>`}</dl>${r.note?`<p class="pos-note">備註：${h(r.note)}</p>`:''}</section>`,
   footer:`<button type="button" data-act="export-close-day" data-day="${day}">下載 CSV</button><button type="button" data-act="print-close" data-day="${day}">列印報表</button><button type="button" class="pos-primary" data-act="close-dialog" autofocus>關閉</button>`});
 }
 function dayCloseHtml(day){
  const r=closeRecord(day),d=r.summary,counted=r.countedCash,done=r.done?r:null;
  return `<article class="pos-receipt">${receiptHead(done?'日結表':'日結表（尚未日結）')}
${receiptRow('營業日',day)}${done?receiptRow('日結時間',P.formatTime(done.closedAt))+receiptRow('經手人',h(done.cashier)):receiptRow('列印時間',P.formatTime(Date.now()))}${d.firstOrder?receiptRow('單號',h(d.firstOrder.slice(9))+'–'+h(d.lastOrder.slice(9))):''}
<hr>${receiptRow('訂單數',d.orders+' 筆')}${receiptRow('銷售件數',d.items+' 件')}${receiptRow('折扣與點數',money(d.discount))}${receiptRow('銷售金額',money(d.sales))}${receiptRow('退款',`−${money(d.refunds)}（${d.refundCount} 筆）`)}${receiptRow('淨銷售額',money(d.net),'r-total')}${receiptRow('營業稅',money(d.netTax))}
<hr><p class="r-name">各付款方式</p>${P.methodBreakdown(d,S.settings.methods).map(m=>receiptRow(h(m.name)+' '+m.count+' 筆',money(m.net))).join('')}${receiptRow('合計',money(d.net),'r-total')}
<hr>${receiptRow('開班零用金',money(d.openingCash))}${receiptRow('現金銷售',money(d.cashSales))}${receiptRow('現金退款','−'+money(d.cashRefunds))}${receiptRow('現金存入',money(d.cashIn))}${receiptRow('現金取出','−'+money(d.cashOut))}${receiptRow('應有現金',money(d.expectedCash),'r-total')}
${counted==null?'':receiptRow('實點現金',money(counted))+receiptRow('差額',signed(counted-d.expectedCash))}
${d.shifts.length?'<hr>'+d.shifts.map(s=>receiptRow(h(s.cashier)+' '+P.formatTime(s.openedAt).slice(11)+'–'+(s.closedAt?P.formatTime(s.closedAt).slice(11):'未交班'),money(s.net))).join(''):''}${done?.note?`<p>備註：${h(done.note)}</p>`:''}</article>`;
 }

 // ---------- 報表 ----------
 function barChart(rows,labelOf,tipOf){
  // 以目前版面寬度當畫布寬，1 單位就是 1px，文字在手機上也不會被縮小。
  const W=Math.round(Math.min(1320,Math.max(280,view.clientWidth-70))),H=220,left=56,right=8,top=12,bottom=30,max=Math.max(1,...rows.map(r=>r.sales));
  const pow=10**Math.floor(Math.log10(max)),step=[1,2,5,10].map(m=>m*pow).find(s=>max/s<=4)||pow*10,topValue=Math.ceil(max/step)*step;
  const plotW=W-left-right,plotH=H-top-bottom,slot=plotW/rows.length,bw=Math.min(24,Math.max(3,slot-2)),y=v=>top+plotH-plotH*v/topValue;
  const every=Math.ceil(rows.length/Math.max(4,Math.floor(plotW/56)));
  let grid='',bars='';
  for(let v=0;v<=topValue;v+=step)grid+=`<line x1="${left}" x2="${W-right}" y1="${y(v)}" y2="${y(v)}" class="${v?'grid':'axis'}"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${v.toLocaleString('en-US')}</text>`;
  rows.forEach((row,i)=>{
   const x=left+slot*i+(slot-bw)/2,yy=y(row.sales),hh=top+plotH-yy,r=Math.min(4,bw/2,hh);
   bars+=`<g class="bar" tabindex="0" data-tip="${h(tipOf(row))}"><rect class="hit" x="${left+slot*i}" y="${top}" width="${slot}" height="${plotH}"/>${hh>0?`<path d="M${x} ${top+plotH}V${yy+r}a${r} ${r} 0 0 1 ${r} ${-r}h${bw-2*r}a${r} ${r} 0 0 1 ${r} ${r}V${top+plotH}Z"/>`:''}</g>`;
   if(i%every===0)bars+=`<text x="${left+slot*i+slot/2}" y="${H-10}" text-anchor="middle">${h(labelOf(row))}</text>`;
  });
  return `<svg class="pos-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="銷售金額長條圖，詳細數字見下方表格">${grid}${bars}</svg><div class="pos-tip" id="pos-tip" hidden></div>`;
 }
 function renderReports(){
  const [from,to]=rangeDates(ui.reports.range,ui.reports),r=P.report(S.orders,from,to),single=from===to;
  const chartRows=single?r.hours:r.days,hasSales=r.orders>0||r.refunds>0;
  const maxMethod=Math.max(1,...r.methods.map(m=>Math.abs(m.net)));
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>報表</h2><div class="pos-page-tools"><button type="button" data-act="export-report">匯出商品銷售 CSV</button></div></div>
<div class="pos-filters">${rangeChips(ui.reports.range,'reports-range')}<div class="pos-dates"><input type="date" aria-label="開始日期" data-change="reports-from" value="${from}" max="${today()}"><span>到</span><input type="date" aria-label="結束日期" data-change="reports-to" value="${to}" max="${today()}"></div></div>
<div class="pos-tiles"><div class="pos-tile pos-tile-strong"><span>淨銷售額</span><b>${money(r.net)}</b></div><div class="pos-tile"><span>訂單數</span><b>${r.orders}</b></div><div class="pos-tile"><span>客單價</span><b>${money(r.average)}</b></div><div class="pos-tile"><span>毛利</span><b>${money(r.profit)}</b></div><div class="pos-tile"><span>退款</span><b>${money(r.refunds)}</b></div><div class="pos-tile"><span>營業稅</span><b>${money(r.netTax)}</b></div></div>
${hasSales?`<section class="pos-card"><h3>${single?'各時段銷售金額':'每日銷售金額'}</h3>${barChart(chartRows,single?row=>row.hour+'時':row=>row.day.slice(5).replace('-','/'),single?row=>`${row.hour}:00–${row.hour}:59　${money(row.sales)}　${row.orders} 筆`:row=>`${row.day}　${money(row.sales)}　${row.orders} 筆`)}
${single?'':`<details class="pos-more-fields"><summary>用表格看每日數字</summary><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>日期</th><th class="num">訂單</th><th class="num">銷售</th><th class="num">退款</th></tr></thead><tbody>${r.days.map(d=>`<tr><td>${d.day}</td><td class="num">${d.orders}</td><td class="num">${money(d.sales)}</td><td class="num">${money(d.refunds)}</td></tr>`).join('')}</tbody></table></div></details>`}</section>
<div class="pos-columns"><section class="pos-card"><h3>收款方式</h3><div class="pos-bars">${r.methods.map(m=>`<div class="pos-bar-row"><span>${h(m.name)}</span><div class="pos-bar-track"><i style="width:${Math.max(0,m.net)/maxMethod*100}%"></i></div><b>${money(m.net)}</b></div>`).join('')}</div></section>
<section class="pos-card"><h3>分類銷售</h3><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>分類</th><th class="num">數量</th><th class="num">金額</th></tr></thead><tbody>${r.categories.map(c=>`<tr><td>${h(c.name)}</td><td class="num">${c.qty}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}</tbody></table></div></section></div>
<section class="pos-card"><h3>商品銷售排行</h3><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th class="num">#</th><th>品名</th><th>分類</th><th class="num">數量</th><th class="num">金額</th><th class="num">成本</th></tr></thead><tbody>${r.products.slice(0,50).map((p,i)=>`<tr><td class="num">${i+1}</td><td>${h(p.name)}</td><td>${h(p.cat)||'—'}</td><td class="num">${p.qty}</td><td class="num">${money(p.amount)}</td><td class="num">${money(p.cost)}</td></tr>`).join('')}</tbody></table></div></section>`:empty('這段期間沒有銷售紀錄')}
<p class="pos-hint">銷售算在結帳當天，退款算在退款當天。毛利＝淨銷售額（不含營業稅）－商品成本，沒有填成本的商品會以 0 計算。</p></div>`;
 }

 // ---------- 設定 ----------
 function renderSettings(){
  const s=S.settings;
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>設定</h2></div>
<form class="pos-settings" data-form="settings" novalidate>
<section class="pos-card"><h3>門市資料</h3><p class="pos-hint">會印在交易明細上方。</p><div class="pos-row">${field('門市名稱','<input name="storeName" maxlength="30" autocomplete="off" value="'+h(s.storeName)+'">')}${field('電話','<input name="storePhone" maxlength="20" autocomplete="off" value="'+h(s.storePhone)+'">')}</div><div class="pos-row">${field('地址','<input name="storeAddress" maxlength="60" autocomplete="off" value="'+h(s.storeAddress)+'">')}${field('統一編號','<input name="storeTaxId" inputmode="numeric" maxlength="8" autocomplete="off" value="'+h(s.storeTaxId)+'">')}</div>${field('明細結尾文字','<input name="receiptFooter" maxlength="40" autocomplete="off" value="'+h(s.receiptFooter)+'">')}</section>
<section class="pos-card"><h3>金額與稅</h3><div class="pos-row">${field('幣別符號','<input name="currency" maxlength="4" autocomplete="off" value="'+h(s.currency)+'">')}${field('營業稅','<select name="taxMode"><option value="included"'+(s.taxMode==='included'?' selected':'')+'>售價已含稅</option><option value="added"'+(s.taxMode==='added'?' selected':'')+'>結帳時外加</option><option value="none"'+(s.taxMode==='none'?' selected':'')+'>不計稅</option></select>')}${field('稅率 %','<input name="taxRate" inputmode="decimal" autocomplete="off" value="'+h(s.taxRate)+'">')}</div></section>
<section class="pos-card"><h3>會員集點</h3><div class="pos-row">${field('每消費多少元得 1 點','<input name="earnPer" inputmode="numeric" autocomplete="off" value="'+h(s.earnPer)+'">','填 0 表示不集點')}${field('1 點可折多少元','<input name="pointValue" inputmode="numeric" autocomplete="off" value="'+h(s.pointValue)+'">')}</div></section>
<section class="pos-card"><h3>收銀與列印</h3><div class="pos-row">${field('收銀員名單','<textarea name="cashiers" rows="3" autocomplete="off">'+h(s.cashiers.join('\n'))+'</textarea>','每行一位，開班時選擇')}${field('現金以外的付款方式','<textarea name="methods" rows="3" autocomplete="off">'+h(s.methods.filter(m=>!m.cash).map(m=>m.name).join('\n'))+'</textarea>','每行一種；這裡只記錄收款方式，不會連接刷卡機或支付平台')}</div>
<div class="pos-row">${field('明細紙寬','<select name="receiptWidth"><option value="58"'+(s.receiptWidth==58?' selected':'')+'>58 mm 熱感紙</option><option value="80"'+(s.receiptWidth==80?' selected':'')+'>80 mm 熱感紙</option><option value="210"'+(s.receiptWidth==210?' selected':'')+'>A4／一般印表機</option></select>')}${field('新商品的安全庫存','<input name="lowStock" inputmode="numeric" autocomplete="off" value="'+h(s.lowStock)+'">')}</div>
<label class="pos-check"><input type="checkbox" name="autoPrint" ${s.autoPrint?'checked':''}>結帳後預設列印交易明細</label><label class="pos-check"><input type="checkbox" name="sound" ${s.sound?'checked':''}>加入商品與錯誤時發出提示音</label><label class="pos-check"><input type="checkbox" name="blockOversell" ${s.blockOversell?'checked':''}>庫存不足時不能結帳</label></section>
${errorBox}<div class="pos-form-actions"><button type="submit" class="pos-primary">儲存設定</button></div></form>
<section class="pos-card"><h3>外觀</h3><div class="pos-chips" role="group" aria-label="外觀">${[['light','淺色'],['dark','深色']].map(([id,label])=>`<button type="button" class="pos-chip" data-act="theme" data-theme="${id}" aria-pressed="${document.documentElement.classList.contains('dark')===(id==='dark')}">${label}</button>`).join('')}</div></section>
<section class="pos-card"><h3>資料備份與還原</h3><p class="pos-hint">${desktop?'所有資料只存在這台電腦的這個程式裡，和瀏覽器無關。重灌或換電腦前，請先下載備份檔。':'所有資料只存在這台裝置的這個瀏覽器，清除瀏覽資料或換裝置就看不到了。建議定期下載備份檔。'}目前有 ${S.products.length} 項商品、${S.orders.length} 筆訂單、${S.members.length} 位會員。</p><div class="pos-form-actions pos-form-actions-left"><button type="button" data-act="backup">下載備份檔</button><button type="button" data-act="restore">從備份檔還原</button><input type="file" id="pos-restore-file" accept=".json,application/json" hidden>${s.demo?'<button type="button" class="pos-danger" data-act="clear-demo">清除示範資料</button>':''}<button type="button" class="pos-danger" data-act="wipe">清除全部資料</button></div></section></div>`;
 }
 function saveSettings(form){
  const e=form.elements,s=S.settings,num=(name,label,min=0)=>{const n=Number(e[name].value.normalize('NFKC').trim());if(!Number.isFinite(n)||n<min)throw Error(label+'請填 '+min+' 以上的數字');return n;};
  try{
   const taxId=e.storeTaxId.value.normalize('NFKC').trim();
   if(taxId&&!P.validTaxId(taxId))throw Error('門市統一編號格式不正確');
   const cashiers=[...new Set(e.cashiers.value.split(/\n/).map(x=>x.trim().slice(0,20)).filter(Boolean))];
   if(!cashiers.length)throw Error('至少要有一位收銀員');
   const names=[...new Set(e.methods.value.split(/\n/).map(x=>x.trim().slice(0,20)).filter(Boolean))].filter(name=>name!=='現金');
   const methods=[{id:'cash',name:'現金',cash:true},...names.map(name=>({id:s.methods.find(m=>m.name===name&&!m.cash)?.id||P.DEFAULT_METHODS.find(m=>m.name===name)?.id||'m:'+name,name}))];
   const taxRate=num('taxRate','稅率'),earnPer=Math.round(num('earnPer','集點金額')),pointValue=Math.round(num('pointValue','點數價值',1)),lowStock=Math.round(num('lowStock','安全庫存'));
   if(taxRate>100)throw Error('稅率不能超過 100');
   Object.assign(s,{storeName:e.storeName.value.trim()||'我的門市',storePhone:e.storePhone.value.trim(),storeAddress:e.storeAddress.value.trim(),storeTaxId:taxId,receiptFooter:e.receiptFooter.value.trim(),currency:e.currency.value.trim(),taxMode:e.taxMode.value,taxRate,earnPer,pointValue,lowStock,receiptWidth:Number(e.receiptWidth.value),autoPrint:e.autoPrint.checked,sound:e.sound.checked,blockOversell:e.blockOversell.checked,cashiers,methods});
   if(!cashiers.includes(s.cashier))s.cashier=cashiers[0];
  }catch(error){return formError(form,error.message);}
  save('settings');toast('設定已儲存');render();updateBar();
  return true;
 }
 function backup(){
  const data={app:'samegg-pos',version:1,exportedAt:new Date().toISOString(),kv:Object.fromEntries(KV.map(key=>[key,S[key]])),orders:S.orders,moves:S.moves};
  download('pos-backup-'+today()+'.json',JSON.stringify(data),'application/json');toast('備份檔已下載，請妥善保存');
 }
 async function restore(text){
  let data;try{data=JSON.parse(text);}catch{return toast('這不是有效的備份檔','error');}
  if(data?.app!=='samegg-pos'||!data.kv||!Array.isArray(data.orders)||!Array.isArray(data.kv.products))return toast('這不是門市 POS 的備份檔','error');
  for(const key of KV)S[key]=data.kv[key]??(key==='seq'?null:Array.isArray(S[key])?[]:S[key]);
  S.settings={...P.DEFAULT_SETTINGS,...S.settings};
  S.orders=data.orders.filter(o=>o&&o.id&&Array.isArray(o.lines)).sort((a,b)=>a.t-b.t);S.moves=(Array.isArray(data.moves)?data.moves:[]).filter(m=>m&&m.id);
  await commit([['orders','clear'],['moves','clear'],...S.orders.map(o=>['orders','put',o]),...S.moves.map(m=>['moves','put',m]),...kvOps(...KV)]);
  resetCart();closeDialog();toast('已從備份檔還原');show('sale');
 }
 async function wipe(demoOnly){
  if(demoOnly){S.products=[];S.categories=[];S.members=[];S.settings.demo=false;}
  else{S.products=[];S.categories=[];S.members=[];S.settings={...P.DEFAULT_SETTINGS,methods:P.DEFAULT_METHODS.map(m=>({...m})),cashiers:['店長']};}
  S.held=[];S.shifts=[];S.closes=[];S.seq=null;S.orders=[];S.moves=[];
  await commit([['orders','clear'],['moves','clear'],...kvOps(...KV)]);
  resetCart();closeDialog();toast(demoOnly?'示範資料已清除，可以開始建立自己的商品':'全部資料已清除');show(demoOnly?'products':'sale');
 }

 // ---------- 事件 ----------
 const actions={
  'close-dialog':()=>closeDialog(),
  view:el=>show(el.dataset.view),
  cat:el=>{ui.cat=el.dataset.id;for(const chip of $$('#pos-cats .pos-chip'))chip.setAttribute('aria-pressed',chip.dataset.id===ui.cat);renderGrid();},
  add:el=>{const p=product(el.dataset.id);if(p)addProduct(p);},
  qty:el=>{const line=cart.lines[el.dataset.i];if(!line)return;line.qty+=Number(el.dataset.d);if(line.qty<=0)cart.lines.splice(el.dataset.i,1);saveCart();renderCart();},
  'to-cart':()=>$('#pos-cart')?.scrollIntoView({behavior:'smooth',block:'start'}),
  'clear-cart':()=>confirmDialog('清空購物車','確定要把購物車裡的商品全部移除嗎？','clear-cart-yes','清空',true),
  'clear-cart-yes':()=>{resetCart();closeDialog();renderCart();},
  'custom-item':()=>openDialog({title:'自訂金額品項',form:'custom',body:`${field('品名','<input name="name" maxlength="40" autocomplete="off" value="自訂品項">')}<div class="pos-row">${field('單價','<input name="price" inputmode="numeric" autocomplete="off" required autofocus>')}${field('數量','<input name="qty" inputmode="numeric" autocomplete="off" value="1">')}</div><p class="pos-hint">沒有建檔的商品可以先用這個方式結帳，不會扣庫存。</p>${errorBox}`,footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">加入購物車</button>'}),
  'edit-line':el=>{
   const i=Number(el.dataset.i),line=cart.lines[i];if(!line)return;
   openDialog({title:line.name,form:'line',body:`<input type="hidden" name="i" value="${i}"><div class="pos-row">${field('數量','<input name="qty" inputmode="numeric" autocomplete="off" value="'+line.qty+'" autofocus>')}${field('單價','<input name="price" inputmode="numeric" autocomplete="off" value="'+line.price+'">','只改這一次，不會改商品售價')}</div>${discountFields(line.discount)}${field('備註（選填）','<input name="note" maxlength="30" autocomplete="off" value="'+h(line.note)+'">')}${errorBox}`,
    footer:`<button type="button" class="pos-danger pos-left" data-act="line-remove" data-i="${i}">移除</button><button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">套用</button>`});
  },
  'line-remove':el=>{cart.lines.splice(Number(el.dataset.i),1);saveCart();closeDialog();renderCart();},
  fold:el=>{const form=el.closest('form');form.elements.fold.value=el.dataset.fold;form.elements.off.value='';for(const chip of $$('[data-act=fold]',form))chip.setAttribute('aria-pressed',chip===el);},
  'order-discount':()=>openDialog({title:'整單折扣',form:'order-discount',body:discountFields(cart.discount)+errorBox,footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">套用</button>'}),
  points:()=>{
   const t=totals(),m=member();if(!m)return;
   openDialog({title:'點數折抵',form:'points',body:`<p class="pos-hint">${h(m.name)} 有 ${m.points} 點，這張單最多可用 ${t.maxPoints} 點（1 點折 ${money(S.settings.pointValue)}）。</p>${field('使用點數','<input name="points" inputmode="numeric" autocomplete="off" value="'+(t.pointsUsed||t.maxPoints)+'" autofocus>')}${errorBox}`,footer:'<button type="button" data-act="points-none">不使用</button><button type="submit" class="pos-primary">套用</button>'});
  },
  'points-none':()=>{cart.pointsUse=0;saveCart();closeDialog();renderCart();},
  'pick-member':()=>openPickMember(),
  'member-pick':el=>{cart.memberId=el.dataset.id;cart.pointsUse=0;saveCart();closeDialog();renderCart();},
  'clear-member':()=>{cart.memberId='';cart.pointsUse=0;saveCart();renderCart();},
  'member-new-pick':()=>openMember('',true),
  hold:()=>{
   if(!cart.lines.length)return;
   const t=totals();
   S.held.push({id:uid(),t:Date.now(),cart,qty:t.qty,total:t.total,label:member()?.name||''});save('held');resetCart();renderCart();toast('已掛單，按「取單」可以叫回來');
  },
  held:()=>openDialog({title:'取單',body:S.held.length?`<div class="pos-pick-list">${S.held.map(item=>`<div class="pos-held"><button type="button" class="pos-pick" data-act="held-take" data-id="${h(item.id)}"><b>${P.formatTime(item.t).slice(11)} 掛單${item.label?'・'+h(item.label):''}</b><span>${item.qty} 件・${money(item.total)}・${h(item.cart.lines.slice(0,3).map(l=>l.name).join('、'))}${item.cart.lines.length>3?'……':''}</span></button><button type="button" class="pos-icon" data-act="held-drop" data-id="${h(item.id)}" aria-label="刪除這筆掛單">✕</button></div>`).join('')}</div>`:empty('目前沒有掛單'),footer:'<button type="button" class="pos-primary" data-act="close-dialog">關閉</button>'}),
  'held-take':el=>{
   if(cart.lines.length)return toast('購物車還有商品，請先結帳或掛單','warn');
   const index=S.held.findIndex(item=>item.id===el.dataset.id);if(index<0)return;
   const saved=S.held.splice(index,1)[0].cart;cart={lines:saved.lines,discount:saved.discount||null,pointsUse:saved.pointsUse||0,memberId:S.members.some(m=>m.id===saved.memberId)?saved.memberId:''};
   save('held');saveCart();closeDialog();renderCart();
  },
  'held-drop':el=>{S.held=S.held.filter(item=>item.id!==el.dataset.id);save('held');actions.held();renderCart();},
  pay:()=>openPay(),
  'pay-add':()=>{
   const s=paySettle(),used=new Set(pay.rows.map(r=>r.id)),next=S.settings.methods.find(m=>!used.has(m.id))||S.settings.methods[0];
   pay.rows.push({id:next.id,amount:s.due>0&&pay.rows[0].amount!==''?String(s.due):''});pay.active=pay.rows.length-1;renderPay();
  },
  'pay-remove':el=>{pay.rows.splice(Number(el.dataset.i),1);pay.active=0;renderPay();},
  'pay-quick':el=>{const i=pay.rows.findIndex(r=>methodById(r.id).cash);if(i<0)return;pay.rows[i].amount=el.dataset.amount;pay.active=i;const input=$(`[name=amount-${i}]`,dialog);input.value=el.dataset.amount;updatePayStatus();},
  'pay-key':el=>{
   const row=pay.rows[pay.active],key=el.dataset.key;if(!row)return;
   row.amount=key==='C'?'':key==='⌫'?row.amount.slice(0,-1):(row.amount+key).replace(/^0+(?=\d)/,'').slice(0,9);
   const input=$(`[name=amount-${pay.active}]`,dialog);if(input)input.value=row.amount;updatePayStatus();
  },
  'print-order':el=>{const o=S.orders.find(order=>order.id===el.dataset.id);if(o)printOrder(o);},
  order:el=>openOrder(el.dataset.id),
  refund:el=>openRefund(el.dataset.id),
  'refund-all':el=>{for(const input of $$('[data-input=refund-qty]',el.closest('form')))input.value=input.max;updateRefund(el.closest('form'));},
  'orders-range':el=>{ui.orders.range=el.dataset.range;renderOrders();},
  'export-orders':()=>downloadCsv('pos-orders-'+today()+'.csv',P.ordersToRows(ordersInRange().reverse())),
  'export-lines':()=>downloadCsv('pos-order-lines-'+today()+'.csv',P.orderLinesToRows(ordersInRange().reverse())),
  'product-new':()=>openProduct(''),
  'product-edit':el=>openProduct(el.dataset.id),
  'product-delete':el=>{const p=product(el.dataset.id);if(p)confirmDialog('刪除商品',`確定刪除「${p.name}」嗎？已經結帳的訂單會保留原本的品名與金額。`,'product-delete-yes','刪除',true);dialog.dataset.target=el.dataset.id;},
  'product-delete-yes':()=>{const id=dialog.dataset.target;S.products=S.products.filter(p=>p.id!==id);cart.lines=cart.lines.filter(l=>l.pid!==id);saveCart();save('products');closeDialog();toast('商品已刪除');render();},
  categories:()=>openCategories(),
  'import-products':()=>$('#pos-import-file').click(),
  'import-apply':()=>applyImport(),
  'export-products':()=>downloadCsv('pos-products-'+today()+'.csv',P.productsToRows(S.products,S.categories)),
  'stock-filter':el=>{ui.stock.filter=el.dataset.id;for(const chip of $$('[data-act=stock-filter]'))chip.setAttribute('aria-pressed',chip===el);renderStockList();},
  'stock-in':el=>openStock(el.dataset.id,'in'),
  'stock-count':el=>openStock(el.dataset.id,'count'),
  'export-stock':()=>downloadCsv('pos-stock-'+today()+'.csv',[['品名','條碼','分類','庫存','安全庫存','成本','庫存成本'],...S.products.filter(p=>p.track).map(p=>[p.name,p.sku,catName(p.categoryId),p.stock,p.lowStock,p.cost||0,Math.max(0,p.stock)*(p.cost||0)])]),
  'export-moves':()=>downloadCsv('pos-stock-moves-'+today()+'.csv',[['時間','品名','類型','數量','結存','備註','單號'],...S.moves.map(m=>[P.formatTime(m.t),m.name,MOVE_LABEL[m.type]||m.type,m.qty,m.after,m.note,m.ref])]),
  'member-new':()=>openMember(''),
  'member-edit':el=>openMember(el.dataset.id),
  'member-history':el=>openMemberHistory(el.dataset.id),
  'member-delete':el=>{const m=S.members.find(x=>x.id===el.dataset.id);if(m)confirmDialog('刪除會員',`確定刪除會員「${m.name}」嗎？點數會一併消失，訂單紀錄會保留。`,'member-delete-yes','刪除',true);dialog.dataset.target=el.dataset.id;},
  'member-delete-yes':()=>{const id=dialog.dataset.target;S.members=S.members.filter(m=>m.id!==id);if(cart.memberId===id){cart.memberId='';cart.pointsUse=0;saveCart();}save('members');closeDialog();toast('會員已刪除');render();},
  'export-members':()=>downloadCsv('pos-members-'+today()+'.csv',[['姓名','電話','點數','累計消費','來店次數','備註'],...S.members.map(m=>[m.name,m.phone,m.points,m.total||0,m.visits||0,m.note])]),
  'close-shift':el=>{const next=P.addDays(ui.close.day,Number(el.dataset.d));if(next<=today()){ui.close.day=next;renderClose();}},
  'close-open':el=>{ui.close.day=el.dataset.day;renderClose();view.scrollTop=0;},
  'print-close':el=>printHtml(dayCloseHtml(el.dataset.day)),
  'close-report':el=>openDayReport(el.dataset.day),
  'export-close-day':el=>downloadCsv('pos-day-report-'+el.dataset.day+'.csv',P.dayReportRows(closeRecord(el.dataset.day),S.settings.methods)),
  'export-closes':()=>downloadCsv('pos-day-closes-'+today()+'.csv',P.closesToRows(S.closes.slice().sort((x,y)=>x.day.localeCompare(y.day)))),
  'print-shift':el=>{const shift=S.shifts.find(s=>s.id===el.dataset.id);if(shift)printHtml(shiftReportHtml(shift));},
  'reports-range':el=>{ui.reports.range=el.dataset.range;renderReports();},
  'export-report':()=>{const [from,to]=rangeDates(ui.reports.range,ui.reports),r=P.report(S.orders,from,to);downloadCsv(`pos-report-${from}_${to}.csv`,[['品名','條碼','分類','數量','金額','成本'],...r.products.map(p=>[p.name,p.sku,p.cat,p.qty,p.amount,p.cost])]);},
  theme:el=>{
   const dark=el.dataset.theme==='dark';document.documentElement.classList.toggle('dark',dark);
   try{localStorage.setItem('samtss-theme',dark?'dark':'light');}catch{}
   const toggle=document.getElementById('site-theme-toggle');if(toggle)toggle.setAttribute('aria-pressed',dark);
   for(const chip of $$('[data-act=theme]'))chip.setAttribute('aria-pressed',chip===el);
  },
  backup:()=>backup(),
  restore:()=>$('#pos-restore-file').click(),
  'clear-demo':()=>confirmDialog('清除示範資料','會刪除示範商品、分類、會員，以及目前所有訂單、庫存異動與交班紀錄；門市設定會保留。確定要清除嗎？','clear-demo-yes','清除示範資料',true),
  'clear-demo-yes':()=>wipe(true),
  wipe:()=>confirmDialog('清除全部資料','會刪除這個瀏覽器裡的所有商品、訂單、會員、交班紀錄與設定，而且無法復原。建議先下載備份檔。確定要清除嗎？','wipe-yes','全部清除',true),
  'wipe-yes':()=>wipe(false),
  max:()=>toggleMax()
 };
 const forms={
  custom:form=>{
   const price=P.parseAmount(form.elements.price.value),qty=P.parseAmount(form.elements.qty.value||'1');
   if(Number.isNaN(price))return formError(form,'單價請填數字');
   if(Number.isNaN(qty)||qty<1)return formError(form,'數量請填 1 以上的整數');
   cart.lines.push({pid:'',name:form.elements.name.value.trim()||'自訂品項',sku:'',cat:'',price,cost:0,qty,discount:null,note:''});saveCart();closeDialog();renderCart();beep(true);
  },
  line:form=>{
   const line=cart.lines[Number(form.elements.i.value)],qty=P.parseAmount(form.elements.qty.value),price=P.parseAmount(form.elements.price.value),d=readDiscount(form);if(!line)return;
   if(Number.isNaN(qty)||qty<1)return formError(form,'數量請填 1 以上的整數');
   if(Number.isNaN(price))return formError(form,'單價請填數字');
   if(d.error)return formError(form,d.error);
   Object.assign(line,{qty,price,discount:d.discount,note:form.elements.note.value.trim()});saveCart();closeDialog();renderCart();
  },
  'order-discount':form=>{const d=readDiscount(form);if(d.error)return formError(form,d.error);cart.discount=d.discount;saveCart();closeDialog();renderCart();},
  points:form=>{const n=P.parseAmount(form.elements.points.value);if(Number.isNaN(n))return formError(form,'點數請填 0 以上的整數');cart.pointsUse=Math.min(n,totals().maxPoints);saveCart();closeDialog();renderCart();},
  pay:checkout,refund:doRefund,product:saveProduct,categories:saveCategories,stock:saveStock,member:saveMember,settings:saveSettings,
  'shift-open':form=>{
   const opening=P.parseAmount(form.elements.opening.value||'0');if(Number.isNaN(opening))return formError(form,'零用金請填數字');
   S.settings.cashier=form.elements.cashier.value;S.shifts.push({id:uid(),openedAt:Date.now(),closedAt:0,cashier:S.settings.cashier,openingCash:opening,cashMoves:[],countedCash:null,note:''});
   save('shifts','settings');toast('已開班');render();updateBar();
  },
  'cash-move':form=>{
   const shift=currentShift(),amount=P.parseAmount(form.elements.amount.value);if(!shift)return;
   if(Number.isNaN(amount)||amount<=0)return formError(form,'金額請填大於 0 的數字');
   shift.cashMoves.push({t:Date.now(),type:form.elements.type.value,amount,note:form.elements.note.value.trim()});save('shifts');render();
  },
  'day-close':form=>{
   const text=form.elements.counted.value.trim(),counted=text===''?null:P.parseAmount(text),day=ui.close.day;
   if(counted!==null&&Number.isNaN(counted))return formError(form,'實點現金請填數字，不點現金可以留空');
   const summary=P.daySummary(S.orders,S.shifts,day),record={day,closedAt:Date.now(),cashier:currentShift()?.cashier||S.settings.cashier,countedCash:counted,note:form.elements.note.value.trim(),summary};
   S.closes=[...S.closes.filter(c=>c.day!==day),record];
   save('closes');render();openDayReport(day);
  },
  'shift-close':form=>{
   const shift=currentShift(),counted=P.parseAmount(form.elements.counted.value);if(!shift)return;
   if(Number.isNaN(counted))return formError(form,'請填實際點到的現金');
   shift.countedCash=counted;shift.note=form.elements.note.value.trim();shift.closedAt=Date.now();shift.summary=P.shiftSummary(shift,S.orders);
   save('shifts');toast('已交班，可以在下方「過去的班別」列印結帳表');render();updateBar();
  }
 };
 function updateRefund(form){
  const o=S.orders.find(order=>order.id===form.elements.id.value),box=$('#pos-refund-status',form);if(!o||!box)return;
  const quote=P.refundQuote(o,refundPicks(form,o));
  box.dataset.state=quote.amount?'ok':'due';box.innerHTML=`<span>退款金額${quote.qty?`（${quote.qty} 件）`:''}</span><b>${money(quote.amount)}</b>`;
 }
 const inputs={
  'pay-amount':el=>{const i=Number(el.dataset.i);pay.rows[i].amount=el.value.normalize('NFKC').replace(/[^\d]/g,'').slice(0,9);if(el.value!==pay.rows[i].amount)el.value=pay.rows[i].amount;updatePayStatus();},
  'refund-qty':el=>updateRefund(el.closest('form')),
  'orders-q':el=>{ui.orders.q=el.value;renderOrderList();},
  'products-q':el=>{ui.products.q=el.value;renderProductList();},
  'stock-q':el=>{ui.stock.q=el.value;renderStockList();},
  'members-q':el=>{ui.members.q=el.value;renderMemberList();},
  'pick-q':el=>renderPickList(el.value),
  'close-counted':el=>{
   const box=$('#pos-close-diff');if(!box)return;
   const expected=P.daySummary(S.orders,S.shifts,ui.close.day).expectedCash,counted=el.value.trim()===''?NaN:P.parseAmount(el.value);
   if(Number.isNaN(counted)){box.dataset.state='due';box.innerHTML=`<span>應有 ${money(expected)}</span>`;return;}
   const diff=counted-expected;box.dataset.state=diff===0?'ok':'due';box.innerHTML=`<span>${diff===0?'金額相符':diff>0?'多出':'短少'}</span><b>${diff===0?money(counted):money(Math.abs(diff))}</b>`;
  },
  'shift-counted':el=>{
   const shift=currentShift(),box=$('#pos-shift-diff');if(!shift||!box)return;
   const s=P.shiftSummary(shift,S.orders),counted=P.parseAmount(el.value);
   if(Number.isNaN(counted)){box.dataset.state='due';box.innerHTML=`<span>應有 ${money(s.expectedCash)}</span>`;return;}
   const diff=counted-s.expectedCash;box.dataset.state=diff===0?'ok':'due';box.innerHTML=`<span>${diff===0?'金額相符':diff>0?'多出':'短少'}</span><b>${diff===0?money(counted):money(Math.abs(diff))}</b>`;
  }
 };
 const changes={
  'pay-method':el=>{pay.rows[Number(el.dataset.i)].id=el.value;pay.active=Number(el.dataset.i);renderPay();},
  'products-cat':el=>{ui.products.cat=el.value;renderProductList();},
  'close-day':el=>{ui.close.day=el.value&&el.value<=today()?el.value:today();renderClose();},
  'reports-from':el=>{const [,to]=rangeDates(ui.reports.range,ui.reports);ui.reports={range:'custom',from:el.value||today(),to};renderReports();},
  'reports-to':el=>{const [from]=rangeDates(ui.reports.range,ui.reports);ui.reports={range:'custom',from,to:el.value||today()};renderReports();}
 };
 app.addEventListener('click',event=>{
  const el=event.target.closest('[data-act]');if(!el||el.disabled||!app.contains(el))return;
  actions[el.dataset.act]?.(el,event);
 });
 app.addEventListener('submit',event=>{event.preventDefault();forms[event.target.dataset.form]?.(event.target);});
 app.addEventListener('input',event=>{
  const el=event.target;
  if(el.id==='pos-search'){ui.q=el.value;renderGrid();return;}
  inputs[el.dataset.input]?.(el);
 });
 app.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='pos-import-file'||el.id==='pos-restore-file'){
   const file=el.files[0];el.value='';if(!file)return;
   if(file.size>30*1024*1024)return toast('檔案太大了','error');
   file.text().then(text=>el.id==='pos-import-file'?previewImport(text):confirmRestore(text)).catch(()=>toast('讀不到這個檔案','error'));
   return;
  }
  changes[el.dataset.change]?.(el);
 });
 let pendingRestore='';
 function confirmRestore(text){pendingRestore=text;confirmDialog('從備份檔還原','還原會用備份檔的內容取代目前這個瀏覽器裡的所有 POS 資料。確定要還原嗎？','restore-yes','還原',true);}
 actions['restore-yes']=()=>{const text=pendingRestore;pendingRestore='';restore(text);};
 app.addEventListener('focusin',event=>{const el=event.target;if(pay&&el.dataset?.input==='pay-amount'){pay.active=Number(el.dataset.i);for(const row of $$('.pos-pay-row',dialog))row.classList.toggle('is-active',row.contains(el));}});
 // 收銀畫面按 Enter：條碼完全相符就直接加入；只剩一個搜尋結果也直接加入。
 app.addEventListener('keydown',event=>{
  const el=event.target;
  if(el.id==='pos-search'&&event.key==='Enter'){
   event.preventDefault();
   const text=el.value.trim();if(!text)return;
   const byCode=P.findByCode(S.products,text),list=byCode?[byCode]:S.products.filter(p=>p.active!==false&&P.matchProduct(p,text));
   if(list.length===1){addProduct(list[0]);el.value='';ui.q='';renderGrid();}
   else{beep(false);toast(list.length?'有多個符合的商品，請直接點選':'找不到「'+text+'」，可以用「自訂金額」結帳',list.length?'warn':'error');el.select();}
  }
  if(event.target.classList?.contains('pos-tab')&&['ArrowLeft','ArrowRight'].includes(event.key)){
   const tabs=$$('.pos-tab',app),next=tabs[(tabs.indexOf(event.target)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];
   next.focus();show(next.dataset.view);event.preventDefault();
  }
 });
 // 快捷鍵與掃描槍：F2 找商品、F4 結帳；沒有對著輸入框時打字，會自動送進搜尋框。
 document.addEventListener('keydown',event=>{
  if(ui.view!=='sale'||dialog.open||event.ctrlKey||event.metaKey||event.altKey)return;
  if(event.key==='F2'){event.preventDefault();$('#pos-search')?.focus();return;}
  if(event.key==='F4'){event.preventDefault();openPay();return;}
  const target=event.target,typing=target instanceof HTMLElement&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if(!typing&&event.key.length===1&&/[0-9A-Za-z]/.test(event.key)&&(target===document.body||app.contains(target))&&!(target instanceof HTMLButtonElement&&event.key===' '))$('#pos-search')?.focus();
 });
 // 圖表提示：滑鼠移過或鍵盤聚焦長條時顯示數字。
 function showTip(bar){
  const tip=$('#pos-tip');if(!tip)return;
  if(!bar){tip.hidden=true;return;}
  const chart=bar.closest('svg').getBoundingClientRect(),hit=bar.querySelector('.hit').getBoundingClientRect(),card=tip.parentElement.getBoundingClientRect();
  tip.textContent=bar.dataset.tip;tip.hidden=false;
  const x=Math.min(Math.max(hit.left+hit.width/2-card.left,tip.offsetWidth/2+4),card.width-tip.offsetWidth/2-4);
  tip.style.left=x+'px';tip.style.top=(chart.top-card.top)+'px';
 }
 app.addEventListener('pointermove',event=>{if(event.target.closest?.('.pos-chart'))showTip(event.target.closest('.bar'));});
 app.addEventListener('pointerleave',event=>{if(event.target.classList?.contains('pos-chart'))showTip(null);},true);
 app.addEventListener('focusin',event=>{if(event.target.classList?.contains('bar'))showTip(event.target);});
 app.addEventListener('focusout',event=>{if(event.target.classList?.contains('bar'))showTip(null);});

 // ---------- 全螢幕 ----------
 function setMax(on){
  document.documentElement.classList.toggle('pos-max',on);
  const button=$('#pos-max');button.setAttribute('aria-pressed',on);button.textContent=on?'離開全螢幕':'全螢幕';
 }
 function toggleMax(){
  const on=!document.documentElement.classList.contains('pos-max');setMax(on);
  try{if(on)document.documentElement.requestFullscreen?.().catch(()=>{});else if(document.fullscreenElement)document.exitFullscreen?.();}catch{}
 }
 let resizeTimer=0;
 window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(ui.view==='reports'&&!dialog.open)renderReports();},200);});
 document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.documentElement.classList.contains('pos-max'))setMax(false);});

 // ---------- 安裝成 App 與離線使用 ----------
 // 從主畫面或桌面圖示開啟時，直接用整個視窗當收銀畫面，不顯示網站的導覽列。
 // Windows 桌面版（獨立 exe）用自己的視窗載入同一份程式，靠 User-Agent 裡的 SamEggPOS 辨識。
 const appMode=desktop||matchMedia('(display-mode: standalone)').matches||matchMedia('(display-mode: window-controls-overlay)').matches||navigator.standalone===true;
 if(appMode)document.documentElement.classList.add('pos-max','pos-app-mode');
 if(desktop)document.documentElement.classList.add('pos-desktop');
 const installButton=$('#pos-install'),installStatus=$('#pos-install-status');
 let installEvent=null;
 const installNote=text=>{if(installStatus)installStatus.textContent=text;};
 if(appMode)installNote('你現在就是用安裝好的 App 開啟。');
 window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();installEvent=event;
  if(installButton)installButton.hidden=false;
  installNote('這個瀏覽器可以直接安裝，按上面的按鈕就好。');
 });
 installButton?.addEventListener('click',async()=>{
  if(!installEvent)return;
  const prompt=installEvent;installEvent=null;installButton.hidden=true;
  try{prompt.prompt();const choice=await prompt.userChoice;installNote(choice.outcome==='accepted'?'安裝完成，之後從主畫面或桌面的圖示開啟。':'已取消安裝，想裝的時候重新整理這一頁再按一次。');}catch{installNote('安裝沒有完成，請照下面的步驟從瀏覽器選單安裝。');}
 });
 window.addEventListener('appinstalled',()=>{if(installButton)installButton.hidden=true;installNote('安裝完成，之後從主畫面或桌面的圖示開啟。');});
 if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol)&&!desktop){
  navigator.serviceWorker.register('/tools/pos/sw.js',{scope:'/tools/pos/'}).catch(()=>{});
  // 把這次已經載入的樣式、程式與字型交給離線快取，下次沒有網路也開得起來。
  const share=()=>navigator.serviceWorker.ready.then(registration=>{
   const urls=[...new Set(performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>name.startsWith(location.origin+'/')))];
   registration.active?.postMessage({type:'cache',urls});
  }).catch(()=>{});
  if(document.readyState==='complete')setTimeout(share,1500);else window.addEventListener('load',()=>setTimeout(share,1500));
 }

 boot();
})();
