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
 const S={settings:{...P.DEFAULT_SETTINGS},stores:[],suppliers:[],categories:[],products:[],members:[],held:[],shifts:[],closes:[],promos:[],seq:null,orders:[],moves:[]};
 const KV=['settings','stores','suppliers','categories','products','members','held','shifts','closes','promos','seq'];
 const ui={promoQ:'',view:'sale',cat:'all',q:'',orders:{range:'today',q:''},products:{q:'',cat:'all'},stock:{filter:'all',q:'',store:'',cat:'all',brand:'all',supplier:'all'},scope:'store',members:{q:''},reports:{range:'today',from:today(),to:today()},close:{day:today()},giftMode:false,setTab:'store'};
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
   ['礦泉水 600ml',0,20,9,48,'清泉'],['無糖綠茶',0,25,13,36,'山茶園'],['鮮奶茶',0,35,19,24,'山茶園'],['美式咖啡',0,45,18,30,'蛋蛋咖啡'],['拿鐵咖啡',0,60,27,30,'蛋蛋咖啡'],['柳橙汁',0,40,22,4,'果園'],
   ['海鹽洋芋片',1,35,20,20,'脆脆'],['巧克力餅乾',1,45,26,18,'脆脆'],['綜合堅果',1,89,55,12,'好果仁'],['水果軟糖',1,30,16,25,'好果仁'],['蘇打餅',1,39,22,3,'脆脆'],
   ['菠蘿麵包',2,35,15,10,'蛋蛋烘焙'],['奶油可頌',2,45,20,8,'蛋蛋烘焙'],['鮮奶吐司',2,65,34,6,'蛋蛋烘焙'],['肉鬆麵包',2,40,18,0,'蛋蛋烘焙'],
   ['抽取式衛生紙',3,29,18,40,'柔柔'],['濕紙巾',3,39,22,22,'柔柔'],['洗手乳',3,99,58,9,'淨淨'],['3 號電池 4 入',3,129,80,14,'電力'],
   ['原子筆',4,15,6,60,'書寫'],['筆記本 A5',4,49,25,16,'書寫'],['便利貼',4,35,17,20,'書寫']
  ];
  // 示範兩家門市：台中門市的庫存大約是台北的一半。廠商依分類分配（名稱都是示範用）。
  S.stores=[{id:'main',name:'台北門市',address:'',phone:''},{id:'tc',name:'台中門市',address:'',phone:''}];
  S.suppliers=['晨光飲品','好味食品','麥香烘焙坊','日日生活用品'].map((name,i)=>({id:uid()+'s'+i,name,phone:'',note:'示範廠商'}));
  const vendor=[0,1,2,3,3];
  S.categories=cats;
  S.products=rows.map(([name,cat,price,cost,stock,brand],i)=>({id:uid()+i,name,sku:P.ean13('20000000'+String(i+1).padStart(4,'0')),categoryId:cats[cat].id,brand,supplierId:S.suppliers[vendor[cat]].id,price,cost,track:true,stocks:{main:stock,tc:Math.floor(stock/2)},lowStock:5,active:true}));
  S.products.push({id:uid()+'bag',name:'購物袋',sku:P.ean13('200000009001'),categoryId:cats[3].id,brand:'',supplierId:S.suppliers[3].id,price:2,cost:1,track:false,stocks:{},lowStock:0,active:true});
  S.members=[
   {id:uid()+'m',name:'王小明',code:'M0001',phone:'0912345678',points:120,total:0,visits:0,note:'示範會員',createdAt:Date.now()},
   {id:uid()+'g',name:'陳美玲',code:'M0002',phone:'0933222111',points:860,total:23800,visits:41,note:'示範會員（金卡）',createdAt:Date.now()}
  ];
  const pid=name=>S.products.find(p=>p.name===name)?.id;
  S.promos=[
   {id:uid()+'p1',type:'bogo',name:'美式咖啡買一送一',active:true,from:'',to:'',dayFrom:'',dayTo:'',productIds:[pid('美式咖啡')]},
   {id:uid()+'p2',type:'sale',name:'晚間麵包 8 折',active:true,from:'',to:'',dayFrom:'18:00',dayTo:'22:00',productIds:['菠蘿麵包','奶油可頌','鮮奶吐司'].map(pid),mode:'pct',value:20},
   {id:uid()+'p3',type:'bundle',name:'下午茶組合',active:true,from:'',to:'',dayFrom:'',dayTo:'',items:[{pid:pid('美式咖啡'),qty:1},{pid:pid('巧克力餅乾'),qty:1}],price:75}
  ];
  S.settings={...P.DEFAULT_SETTINGS,methods:P.DEFAULT_METHODS.map(m=>({...m})),cashiers:['店長'],demo:true};
  S.held=[];S.shifts=[];S.closes=[];S.seq=null;S.orders=[];S.moves=[];
 }
 // 舊資料沒有門市：用設定裡的門市名稱建立第一家門市，原本的庫存都歸到這家。回傳有沒有改到資料。
 function normalize(){
  let changed=false;
  if(!Array.isArray(S.stores))S.stores=[];
  if(!Array.isArray(S.suppliers))S.suppliers=[];
  if(!S.stores.length){S.stores=[{id:'main',name:S.settings.storeName||'我的門市',address:S.settings.storeAddress||'',phone:S.settings.storePhone||''}];changed=true;}
  if(P.migrateStocks(S.products,S.stores[0].id))changed=true;
  // 舊版只有收銀員名單：轉成員工（第一位是店長），權限補上預設值。
  const staff=P.cleanStaff(S.settings.staff,S.settings.cashiers);
  if(JSON.stringify(staff)!==JSON.stringify(S.settings.staff)){S.settings.staff=staff;changed=true;}
  const names=staff.map(p=>p.name);if(JSON.stringify(names)!==JSON.stringify(S.settings.cashiers)){S.settings.cashiers=names;changed=true;}
  S.settings.cashierPerms=P.cleanPerms(S.settings.cashierPerms);
  return changed;
 }
 async function boot(){
  try{
   await store.open();
   if(!(await readAll())){seedDemo();await commit(kvOps(...KV));}
   if(normalize())await save('settings','stores','suppliers','products');
   // 只做一次：之後在「設定」自己改成「行動支付」的不會再被改回來。
   if(!S.settings.methodNamesV2){const mobile=S.settings.methods.find(m=>m.id==='mobile'&&m.name==='行動支付');if(mobile)mobile.name='電子支付';S.settings.methodNamesV2=true;await save('settings');}
   navigator.storage?.persist?.().catch(()=>{});
  }catch{
   memoryOnly=true;store.db=null;seedDemo();normalize();
  }
  loadCart();
  channel?.addEventListener('message',async()=>{
   // 另一個分頁改了資料：重新讀取，保留這個分頁正在結的帳。
   if(!store.db)return;
   try{await readAll();normalize();if(cart.memberId&&!member())cart.memberId='';if(!dialog.open)render();updateBar();}catch{}
  });
  // 這個分頁選過的門市；沒選過時先用上次選的門市，桌面版或多門市再請收銀員確認。
  const chosen=remembered('sessionStorage');
  storeId=storeOf(chosen)?chosen:remembered('localStorage');
  try{who=sessionStorage.getItem(WHO_KEY)||'';}catch{}
  app.dataset.ready='true';
  render();updateBar();setInterval(updateBar,30000);
  if((!storeOf(chosen)&&(desktop||multiStore()))||(S.settings.permsOn&&!staffOf(who)))openLogin(false);
  // 閒置自動鎖定：一段時間沒有點畫面或按鍵，就回到登入畫面。結帳中不鎖。
  let lastActive=Date.now();
  for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{lastActive=Date.now();},{capture:true,passive:true});
  setInterval(()=>{const minutes=Number(S.settings.lockAfter)||0;if(!minutes||pay||login.required||Date.now()-lastActive<minutes*60000)return;lastActive=Date.now();openLogin(false);toast('閒置太久，已自動鎖定');},15000);
 }

 // ---------- 小工具 ----------
 const member=()=>S.members.find(m=>m.id===cart.memberId)||null;
 const product=id=>S.products.find(p=>p.id===id)||null;
 const catName=id=>S.categories.find(c=>c.id===id)?.name||'';
 const supplierName=id=>S.suppliers.find(s=>s.id===id)?.name||'';
 // 例如「台北門市 30・台中門市 15」
 const stockText=p=>S.stores.map(s=>s.name+' '+P.stockAt(p,s.id)).join('・');
 // 這個分頁（或這次開啟的桌面版）在哪一家門市收銀；記在 sessionStorage，關掉重開要再選一次。
 const STORE_KEY='samegg-pos-store';
 let storeId='';
 const remembered=area=>{try{return window[area].getItem(STORE_KEY)||'';}catch{return '';}};
 const storeOf=id=>S.stores.find(s=>s.id===id)||null;
 const cur=()=>storeOf(storeId)?storeId:(S.stores[0]?.id||'main');
 const curStore=()=>storeOf(cur())||{id:'main',name:S.settings.storeName,address:'',phone:''};
 const storeName=id=>storeOf(id)?.name||'';
 const multiStore=()=>S.stores.length>1;
 // 檔名只用英數字（瀏覽器會把中文檔名改成 download）：第 1 家門市是 store1；門市名稱寫在檔案內容裡。
 const fileTag=id=>multiStore()?(id==='all'?'all-stores':'store'+(S.stores.findIndex(s=>s.id===id)+1))+'-':'';
 // 沒有門市欄位的舊紀錄算第一家門市。
 const sid=record=>record&&storeOf(record.storeId)?record.storeId:(record&&record.storeId)||S.stores[0]?.id||'main';
 const here=record=>sid(record)===cur();
 const qtyHere=p=>P.stockAt(p,cur());
 function chooseStore(id){storeId=id;for(const area of ['sessionStorage','localStorage'])try{window[area].setItem(STORE_KEY,id);}catch{}}
 // 目前登入的收銀員（每個分頁各自記；沒登入過就用設定裡上次的收銀員）。
 const WHO_KEY='samegg-pos-cashier';
 let who='';
 const staffList=()=>S.settings.staff||[];
 const staffOf=name=>staffList().find(p=>p.name===name)||null;
 const whoName=()=>staffOf(who)?who:(staffOf(S.settings.cashier)?S.settings.cashier:staffList()[0]?.name||S.settings.cashier);
 function chooseWho(name){who=name;try{sessionStorage.setItem(WHO_KEY,name);}catch{}}
 const allowed=perm=>P.can(staffOf(whoName()),perm,S.settings);
 const PERM_LABEL=Object.fromEntries(P.PERMS);
 // 沒有權限時請店長輸入 PIN，授權這一次。
 let authRun=null;
 function guard(perm,run){if(allowed(perm))return run();openAuth(perm,run);}
 function openAuth(perm,run){
  const managers=staffList().filter(p=>p.role==='manager'&&p.pin);
  authRun=run;
  openDialog({title:'需要店長授權',form:'auth',body:`<p class="pos-confirm">${h(whoName())} 沒有「${h(PERM_LABEL[perm]||perm)}」的權限，請店長輸入 PIN 授權這一次。</p><div class="pos-row">${field('店長','<select name="manager">'+managers.map(p=>`<option>${h(p.name)}</option>`).join('')+'</select>')}${field('PIN','<input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off" autofocus>')}</div>${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">授權</button>'});
 }
 function saveAuth(form){
  const boss=staffOf(form.elements.manager.value);
  if(!boss||boss.role!=='manager'||!P.checkPin(boss,form.elements.pin.value.normalize('NFKC').trim())){form.elements.pin.value='';form.elements.pin.focus();return formError(form,'PIN 不正確');}
  const run=authRun;authRun=null;closeDialog();run?.();
  return true;
 }
 const VIEW_PERM={products:'products',promos:'products',stock:'stock',reports:'reports',close:'close',settings:'settings'};
 function toggleGift(){ui.giftMode=!ui.giftMode;toast(ui.giftMode?'贈品模式：點選的商品會以 0 元加入':'已結束贈品模式');renderSale();}
 const scoped=list=>ui.scope==='all'&&multiStore()?list:list.filter(here);
 const heldHere=()=>S.held.filter(here);
 const dayOf=day=>P.daySummary(S.orders.filter(here),S.shifts.filter(here),day);
 const currentShift=()=>S.shifts.find(s=>!s.closedAt&&here(s))||null;
 const totals=()=>P.computeCart(cart,S.settings,member(),S.promos,Date.now());
 // 現在可以賣的禮包（活動進行中，而且裡面的商品都還在）。
 const activeBundles=()=>P.activePromos(S.promos,Date.now()).bundles.map(promo=>({promo,line:P.bundleLine(promo,S.products)})).filter(b=>b.line);
 // 每個商品要扣多少庫存：禮包拆成裡面的商品，贈品照樣扣。
 function stockNeeds(lines){
  const need=new Map(),add=(pid,qty)=>{if(pid)need.set(pid,(need.get(pid)||0)+qty);};
  for(const line of lines){if(line.bundle)for(const item of line.bundle.items)add(item.pid,item.qty*line.qty);else add(line.pid,line.qty);}
  return need;
 }
 const levelOf=m=>P.levelOf(m,S.settings.levels);
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
 function addMove(ops,p,type,delta,note,ref,at=cur()){
  const move={id:uid(),t:Date.now(),pid:p.id,name:p.name,type,qty:delta,after:P.stockAt(p,at),storeId:at,storeName:storeName(at),note:note||'',ref:ref||''};
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
 // 訂單與報表可以只看這家門市，或看全部門市（只有一家門市時不顯示）。
 const scopeChips=()=>multiStore()?`<div class="pos-chips" role="group" aria-label="門市範圍">${[['store',curStore().name],['all','全部門市']].map(([id,label])=>`<button type="button" class="pos-chip" data-act="scope" data-id="${id}" aria-pressed="${ui.scope===id}">${h(label)}</button>`).join('')}</div>`:'';
 const RANGES=[['today','今天'],['yesterday','昨天'],['7d','近 7 天'],['month','本月'],['lastmonth','上月'],['all','全部']];
 const rangeChips=(current,act)=>'<div class="pos-chips" role="group" aria-label="日期範圍">'+RANGES.map(([id,label])=>`<button type="button" class="pos-chip" data-act="${act}" data-range="${id}" aria-pressed="${current===id}">${label}</button>`).join('')+'</div>';
 const empty=text=>`<p class="pos-empty">${h(text)}</p>`;
 // 線條圖示（24×24，跟著文字顏色）。
 const ICONS={
  cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  mobile:'<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  transfer:'<path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/>',
  wallet:'<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3h-4a2 2 0 0 0 0 4h4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/>',
  cart:'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  tag:'<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/>',
  trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C9.5 3 12 8 12 8s2.5-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  store:'<path d="M3 9 4.5 4h15L21 9M3 9h18v1.5a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 12.5V20h14v-7.5M10 20v-4.5h4V20"/>',
  swap:'<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  percent:'<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'
 };
 const icon=(name,cls='pos-ico')=>`<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]||ICONS.wallet}</svg>`;
 const methodIcon=m=>icon(m.cash?'cash':({card:'card',mobile:'mobile',transfer:'transfer'}[m.id]||'wallet'));
 // 每個分類一個顏色（8 色輪流），沒有分類的商品用中性色。
 const tone=categoryId=>{if(categoryId==='bundles')return 'tone-gift';const at=S.categories.findIndex(c=>c.id===categoryId);return at<0?'tone-n':'tone-'+(at%8);};
 const initial=name=>(Array.from(String(name||'').trim())[0]||'?').toUpperCase();
 const statusTag=order=>`<span class="pos-tag pos-tag-${order.status}">${P.STATUS[order.status]||''}</span>`;

 // ---------- 對話框 ----------
 function openDialog({title,body,footer='',form='',size='',closable=true}){
  dialog.className='pos-dialog'+(size?' pos-dialog-'+size:'');
  const carry=toastBox.parentElement===dialog;
  dialog.innerHTML=`<form class="pos-dialog-form" data-form="${form}" novalidate><header class="pos-dialog-head"><h2>${h(title)}</h2>${closable?'<button type="button" class="pos-icon" data-act="close-dialog" aria-label="關閉">✕</button>':''}</header><div class="pos-dialog-body">${body}</div>${footer?`<footer class="pos-dialog-foot">${footer}</footer>`:''}</form>`;
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

 // ---------- 登入：選門市與收銀員 ----------
 // 桌面版每次打開、或有兩家以上門市時，先選在哪一家門市收銀。這是選擇，不是密碼登入。
 const login={store:'',cashier:'',required:false};
 function openLogin(closable){
  login.store=cur();login.cashier=whoName();login.required=!closable;
  const shiftOf=id=>S.shifts.find(s=>!s.closedAt&&sid(s)===id);
  openDialog({title:'登入收銀台',form:'login',size:'login',closable,body:`<p class="pos-hint">選好門市和收銀員就可以開始。收銀、庫存、交班與日結都會記在這家門市。</p>
<h3 class="pos-login-label">門市</h3><div class="pos-login-stores" role="group" aria-label="門市">${S.stores.map(st=>{const open=shiftOf(st.id);return `<button type="button" class="pos-login-store" data-act="login-store" data-id="${h(st.id)}" aria-pressed="${st.id===login.store}">${icon('store')}<b>${h(st.name)}</b><small>${h(st.address)||'未填地址'}</small><small class="pos-login-shift" data-open="${!!open}">${open?'營業中・'+h(open.cashier):'尚未開班'}</small></button>`;}).join('')}</div>
<h3 class="pos-login-label">收銀員</h3><div class="pos-chips pos-login-cashiers" role="group" aria-label="收銀員">${staffList().map(p=>`<button type="button" class="pos-chip" data-act="login-cashier" data-id="${h(p.name)}" aria-pressed="${p.name===login.cashier}">${h(p.name)}${p.role==='manager'?'<small>店長</small>':''}</button>`).join('')}</div>
<div class="pos-login-pin"${needPin(login.cashier)?'':' hidden'}>${field('PIN','<input name="pin" type="password" inputmode="numeric" maxlength="6" autocomplete="off">','這位員工設了 PIN，請輸入 4 到 6 位數字')}</div>${errorBox}
<p class="pos-hint">門市和員工名單在「設定」修改。資料只存在這台${desktop?'電腦':'裝置'}，不同裝置之間不會同步。</p>`,
   footer:`${closable?'<button type="button" data-act="close-dialog">取消</button>':''}<button type="submit" class="pos-primary pos-login-go">開始收銀</button>`});
  $('.pos-login-store[aria-pressed=true]',dialog)?.focus();
 }
 const needPin=name=>!!(S.settings.permsOn&&staffOf(name)?.pin);
 function pickLogin(kind,el){
  login[kind]=el.dataset.id;
  for(const b of $$(`[data-act=login-${kind}]`,dialog))b.setAttribute('aria-pressed',b===el);
  if(kind==='cashier'){const box=$('.pos-login-pin',dialog);box.hidden=!needPin(login.cashier);if(!box.hidden)$('input',box).focus();}
 }
 function saveLogin(form){
  const st=storeOf(login.store)||curStore(),person=staffOf(login.cashier)||staffList()[0];
  if(needPin(person.name)&&!P.checkPin(person,(form.elements.pin?.value||'').normalize('NFKC').trim())){form.elements.pin.value='';form.elements.pin.focus();return formError(form,'PIN 不正確');}
  chooseStore(st.id);chooseWho(person.name);login.required=false;
  if(S.settings.cashier!==person.name){S.settings.cashier=person.name;save('settings');}
  // 換人之後，沒有權限的頁面回到收銀畫面。
  if(VIEW_PERM[ui.view]&&!allowed(VIEW_PERM[ui.view]))ui.view='sale';
  closeDialog();toast(`${st.name}・${person.name}，開始收銀`);render();updateBar();
  return true;
 }
 // 第一次登入不能按 Esc 跳過。
 dialog.addEventListener('cancel',event=>{if(login.required)event.preventDefault();});

 // ---------- 上方工作列 ----------
 const VIEWS=[['sale','收銀'],['orders','訂單'],['products','商品'],['stock','庫存'],['members','會員'],['promos','優惠'],['shift','交班'],['close','日結'],['reports','報表'],['settings','設定']];
 function updateBar(){
  for(const tab of $$('.pos-tab',app)){const on=tab.dataset.view===ui.view;tab.setAttribute('aria-selected',on);tab.tabIndex=on?0:-1;}
  const shift=currentShift(),chip=$('#pos-shift-chip'),now=new Date();
  chip.textContent=shift?'營業中・'+shift.cashier:'尚未開班';chip.dataset.open=!!shift;
  $('#pos-clock').textContent=P.formatTime(now).slice(5);
  const label=$('#pos-store');label.innerHTML=icon('store')+'<span>'+h(curStore().name)+'</span>'+(S.settings.permsOn?'<small class="pos-store-who">'+h(whoName())+'</small>':'');label.title=multiStore()?'切換門市或收銀員':'切換收銀員';
 }
 function show(name){
  const go=()=>{ui.view=name;render();updateBar();view.scrollTop=0;};
  if(VIEW_PERM[name]&&name!==ui.view)return guard(VIEW_PERM[name],go);
  go();
 }
 function render(){
  ({sale:renderSale,orders:renderOrders,products:renderProducts,stock:renderStock,members:renderMembers,promos:renderPromos,shift:renderShift,close:renderClose,reports:renderReports,settings:renderSettings})[ui.view]();
  view.dataset.view=ui.view;app.dataset.tiles=S.settings.tileSize||'md';
 }

 // ---------- 收銀 ----------
 function renderSale(){
  const cats=[['all','全部'],...S.categories.map(c=>[c.id,c.name]),...(activeBundles().length?[['bundles','禮包']]:[])];
  view.innerHTML=`<div class="pos-sale">
<section class="pos-catalog" aria-label="商品">
${memoryOnly?'<p class="pos-banner pos-banner-warn">這個瀏覽器目前無法儲存資料（可能是私密瀏覽模式），重新整理後資料會消失。</p>':''}
${backupBanner()}${S.settings.demo?'<p class="pos-banner">現在是示範商品，可以直接試結帳。準備正式使用時，到「設定」清除示範資料，再建立自己的商品。</p>':''}
${ui.giftMode?`<div class="pos-banner pos-banner-gift"><p><b>贈品模式</b>：點選的商品會以 0 元加入，照樣扣庫存。</p><button type="button" class="pos-soft" data-act="gift-mode">結束贈品模式</button></div>`:''}
<div class="pos-search"><label class="pos-search-field">${icon('search')}<input id="pos-search" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="搜尋品名，或掃描條碼後按 Enter" aria-label="搜尋商品或輸入條碼" value="${h(ui.q)}"></label><button type="button" class="pos-soft" data-act="custom-item">${icon('plus')}<span>自訂金額</span></button></div>
<div class="pos-chips pos-cats" id="pos-cats" role="group" aria-label="商品分類">${cats.map(([id,name])=>`<button type="button" class="pos-chip pos-cat ${id==='all'?'tone-all':tone(id)}" data-act="cat" data-id="${h(id)}" aria-pressed="${ui.cat===id}">${h(name)}</button>`).join('')}</div>
<div class="pos-grid" id="pos-grid"></div>
</section>
<section class="pos-cart" id="pos-cart" aria-label="購物車"></section>
</div>
<div class="pos-mobile-bar" id="pos-mobile-bar"></div>`;
  renderGrid();renderCart();
 }
 function backupBanner(){
  const days=S.settings.demo?0:P.backupDue(S.settings,S.orders[0]?.t||0,Date.now());
  return days?`<div class="pos-banner pos-banner-warn pos-banner-action"><p>已經 ${days} 天沒有備份了。資料只存在這台${desktop?'電腦':'裝置'}，建議現在下載備份檔。</p><button type="button" class="pos-soft" data-act="backup">下載備份檔</button></div>`:'';
 }
 function renderGrid(){
  const grid=$('#pos-grid');if(!grid)return;
  const time=Date.now(),list=ui.cat==='bundles'?[]:S.products.filter(p=>p.active!==false&&!(S.settings.hideOut&&p.track&&qtyHere(p)<=0)&&(ui.cat==='all'||p.categoryId===ui.cat)&&P.matchProduct(p,ui.q));
  const bundles=ui.cat==='all'||ui.cat==='bundles'?activeBundles().filter(b=>P.matchProduct({name:b.line.name,sku:''},ui.q)):[];
  if(!list.length&&!bundles.length){grid.innerHTML=empty(S.products.length?'找不到符合的商品':'還沒有商品，到「商品」頁新增第一個商品');return;}
  grid.innerHTML=list.slice(0,150).map(p=>{
   const q=qtyHere(p),out=p.track&&q<=0,low=!out&&P.isLowStock(p,q),promo=P.promoFor(p.id,S.promos,time);
   const stock=p.track?`<small class="pos-item-stock">${out?'缺貨':'剩 '+q}</small>`:'';
   let price=`<b>${money(p.price)}</b>`;
   if(promo&&promo.promo.type==='sale'){
    const v=promo.promo.value,unit=promo.promo.mode==='price'?Math.min(p.price,Math.max(0,Math.round(Number(v)||0))):p.price-Math.round(p.price*Math.min(100,Math.max(0,Number(v)||0))/100);
    if(unit<p.price)price=`<b>${money(unit)}</b><s>${money(p.price)}</s>`;
   }
   return `<button type="button" class="pos-item ${tone(p.categoryId)}${out?' is-out':low?' is-low':''}${promo?' has-promo':''}" data-act="add" data-id="${h(p.id)}"><span class="pos-item-top"><span class="pos-item-badge" aria-hidden="true">${h(initial(p.name))}</span>${promo?`<small class="pos-item-promo">${h(promo.label)}</small>`:stock}</span><span class="pos-item-name">${h(p.name)}</span><span class="pos-item-meta">${price}${promo?stock:''}</span></button>`;
  }).join('')+bundles.map(b=>`<button type="button" class="pos-item tone-gift is-bundle" data-act="add-bundle" data-id="${h(b.promo.id)}"><span class="pos-item-top"><span class="pos-item-badge" aria-hidden="true">禮</span><small class="pos-item-promo">禮包</small></span><span class="pos-item-name">${h(b.line.name)}</span><span class="pos-item-sub">${h(b.line.bundle.items.map(i=>i.name+'×'+i.qty).join('、'))}</span><span class="pos-item-meta"><b>${money(b.line.price)}</b>${b.line.bundle.value>b.line.price?`<s>${money(b.line.bundle.value)}</s>`:''}</span></button>`).join('')+(list.length>150?`<p class="pos-more">還有 ${list.length-150} 項，請用搜尋或分類縮小範圍</p>`:'');
 }
 function renderCart(){
  const box=$('#pos-cart');if(!box)return;
  const t=totals(),m=member(),taxLabel=S.settings.taxMode==='included'?`內含營業稅 ${S.settings.taxRate}%`:S.settings.taxMode==='added'?`營業稅 ${S.settings.taxRate}%`:'';
  box.innerHTML=`<div class="pos-cart-head"><h2>購物車${t.qty?`<span class="pos-cart-count">${t.qty}</span>`:''}</h2><div class="pos-cart-tools">${m?'':`<button type="button" class="pos-soft pos-scan-member" data-act="pick-member">${icon('user')}<span>掃會員</span></button>`}<button type="button" class="pos-soft" data-act="held">${icon('inbox')}<span>取單</span>${heldHere().length?`<b class="pos-count">${heldHere().length}</b>`:''}</button></div></div>
${m?memberCard(m,t.level):''}
${t.lines.length?`<ol class="pos-lines">${t.lines.map((line,i)=>`<li class="pos-line"><button type="button" class="pos-line-main" data-act="edit-line" data-i="${i}" aria-label="修改 ${h(line.name)}"><span class="pos-line-name">${h(line.name)}</span><span class="pos-line-sub">${money(line.price)}${line.discount?` <em>${h(P.discountLabel(line.discount))}</em>`:''}${line.note?` ・${h(line.note)}`:''}</span>${line.bundle?`<span class="pos-line-items">${h(line.bundle.items.map(x=>x.name+'×'+x.qty*line.qty).join('、'))}</span>`:''}${line.promoLabel?`<span class="pos-line-tag is-promo">${h(line.promoLabel)}</span>`:''}${line.gift?`<span class="pos-line-tag is-gift">贈品・${h(line.giftReason||'贈品')}</span>`:''}</button><div class="pos-qty"><button type="button" data-act="qty" data-i="${i}" data-d="-1" aria-label="${h(line.name)} 減一">−</button><output aria-label="數量">${line.qty}</output><button type="button" data-act="qty" data-i="${i}" data-d="1" aria-label="${h(line.name)} 加一">＋</button></div><span class="pos-line-total">${money(line.net)}</span></li>`).join('')}</ol>`:`<div class="pos-cart-empty">${icon('cart','pos-cart-empty-icon')}<p>點選左邊的商品<br>或直接掃描條碼</p></div>`}
<dl class="pos-totals">
${t.lineDiscount?`<div><dt>商品原價</dt><dd>${money(t.gross)}</dd></div><div class="pos-promo-row"><dt>優惠與折扣</dt><dd>−${money(t.lineDiscount)}</dd></div>`:''}
<div><dt>小計<small>${t.qty} 件</small></dt><dd>${money(t.subtotal)}</dd></div>
${t.orderDiscount?`<div><dt>整單折扣<small>${h(P.discountLabel(cart.discount))}</small></dt><dd>−${money(t.orderDiscount)}</dd></div>`:''}
${t.levelDiscount?`<div class="pos-promo-row"><dt>${h(t.level.name)}<small>${h(P.discountLabel({type:'pct',value:t.level.pct}))}</small></dt><dd>−${money(t.levelDiscount)}</dd></div>`:''}
${t.giftQty?`<div class="pos-tax"><dt>贈品 ${t.giftQty} 件</dt><dd>價值 ${money(t.giftValue)}</dd></div>`:''}
${m&&(t.maxPoints>0||t.pointsUsed>0)?`<div><dt>點數折抵<button type="button" class="pos-link" data-act="points">${t.pointsUsed?`已用 ${t.pointsUsed} 點`:`可用 ${t.maxPoints} 點`}</button></dt><dd>${t.pointsValue?'−'+money(t.pointsValue):money(0)}</dd></div>`:''}
${taxLabel?`<div class="pos-tax"><dt>${taxLabel}</dt><dd>${money(t.tax)}</dd></div>`:''}
<div class="pos-total"><dt>應收</dt><dd>${money(t.total)}</dd></div>
</dl>
<div class="pos-cart-actions"><button type="button" class="pos-soft" data-act="clear-cart" ${t.lines.length?'':'disabled'}>${icon('trash')}<span>清空</span></button><button type="button" class="pos-soft" data-act="hold" ${t.lines.length?'':'disabled'}>${icon('pause')}<span>掛單</span></button><button type="button" class="pos-soft" data-act="order-discount" ${t.lines.length?'':'disabled'}>${icon('tag')}<span>折扣</span></button><button type="button" class="pos-soft pos-gift-toggle" data-act="gift-mode" aria-pressed="${ui.giftMode}">${icon('gift')}<span>贈品</span></button><button type="button" class="pos-primary pos-pay" id="pos-pay" data-act="pay" ${t.lines.length?'':'disabled'}>結帳<b>${money(t.total)}</b></button></div>`;
  const bar=$('#pos-mobile-bar');
  if(bar)bar.innerHTML=t.lines.length?`<span>${t.qty} 件・<b>${money(t.total)}</b></span><button type="button" class="pos-primary" data-act="to-cart">看購物車</button>`:'';
 }
 // 購物車上方的會員卡：等級、點數、累計消費、離下一級還差多少。
 function memberCard(m,level){
  return `<div class="pos-member-card${level?' lv-'+Math.min(level.rank,3):''}"><span class="pos-member-avatar" aria-hidden="true">${h(initial(m.name))}</span><div class="pos-member-info"><b>${h(m.name)}${level?`<span class="pos-level">${h(level.name)}</span>`:''}</b><small>${m.points} 點・累計 ${money(m.total||0)}${m.code?'・'+h(m.code):''}</small>${level&&level.next?`<small class="pos-member-next">再消費 ${money(level.toNext)} 升級${h(level.next.name)}</small>`:''}${level&&level.pct?`<small class="pos-member-next">本單享 ${h(P.discountLabel({type:'pct',value:level.pct}))}</small>`:''}</div><button type="button" class="pos-icon" data-act="pick-member" aria-label="更換會員">${icon('user')}</button><button type="button" class="pos-icon" data-act="clear-member" aria-label="取消會員">✕</button></div>`;
 }
 function attachMember(m){
  cart.memberId=m.id;cart.pointsUse=0;saveCart();renderCart();beep(true);
  const level=levelOf(m);
  toast(`會員 ${m.name}${level?'・'+level.name:''}・${m.points} 點`);
 }
 function addBundle(id){
  const b=activeBundles().find(x=>x.promo.id===id);
  if(!b){toast('這個禮包現在沒有供應','warn');renderGrid();return;}
  const need=stockNeeds([...cart.lines,b.line]);
  for(const item of b.line.bundle.items){
   const p=product(item.pid);
   if(p?.track&&need.get(p.id)>qtyHere(p)){
    if(S.settings.blockOversell){beep(false);toast(`「${p.name}」庫存不足，禮包無法再加`,'error');return;}
    toast(`提醒：「${p.name}」庫存只剩 ${qtyHere(p)}`,'warn');break;
   }
  }
  const gift=ui.giftMode;
  const line=cart.lines.find(l=>l.bundle&&l.bundle.id===b.line.bundle.id&&!l.discount&&!l.note&&!!l.gift===gift);
  if(line)line.qty++;else cart.lines.push({...b.line,...(gift?{gift:true,giftReason:'門市送禮'}:{})});
  beep(true);saveCart();renderCart();
 }
 function addProduct(p){
  const inCart=stockNeeds(cart.lines).get(p.id)||0,gift=ui.giftMode;
  if(p.track&&inCart+1>qtyHere(p)){
   if(S.settings.blockOversell){beep(false);toast(`「${p.name}」庫存不足，無法再加`,'error');return;}
   toast(`提醒：「${p.name}」庫存只剩 ${qtyHere(p)}`,'warn');
  }
  const line=cart.lines.find(l=>l.pid===p.id&&!l.discount&&!l.note&&l.price===p.price&&!l.bundle&&!!l.gift===gift);
  if(line)line.qty++;else cart.lines.push({pid:p.id,name:p.name,sku:p.sku||'',cat:catName(p.categoryId),price:p.price,cost:p.cost||0,qty:1,discount:null,note:'',...(gift?{gift:true,giftReason:'門市送禮'}:{})});
  beep(true);saveCart();renderCart();
  // 買一送一：提醒收銀員現在送了幾件，單數時還可以再送一件。
  const deal=!gift&&totals().bogo.find(b=>b.pid===p.id);
  if(deal)toast(deal.odd?`「${p.name}」買一送一：再拿 1 件就免費`:`「${p.name}」買一送一：已送 ${deal.free} 件`);
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
 function openPay(skipReminder){
  const t=totals();if(!t.lines.length)return;
  if(!skipReminder&&S.settings.promoReminder!==false&&t.bogo.length)return openPromoReminder();
  pay={rows:[{id:'cash',amount:''}],active:0,print:!!S.settings.autoPrint};
  renderPay();
 }
 // 結帳前的優惠提醒：列出這張單的買一送一，單數時可以一鍵再加一件免費的。
 function openPromoReminder(){
  const t=totals();
  if(!t.bogo.length)return openPay(true);
  openDialog({title:'優惠提醒',body:`<p class="pos-confirm">這張單有買一送一，請和客人確認：</p><div class="pos-reminders">${t.bogo.map(b=>`<div class="pos-reminder${b.odd?' is-odd':''}"><span class="pos-reminder-icon" aria-hidden="true">${icon('gift')}</span><div class="pos-reminder-text"><b>${h(b.name)}</b><span>${h(b.promoName)}・目前 ${b.qty} 件${b.free?`，已送 ${b.free} 件`:''}</span>${b.odd?'<em>再拿 1 件就能多送 1 件</em>':''}</div>${b.odd?`<button type="button" class="pos-primary" data-act="bogo-add" data-pid="${h(b.pid)}">${icon('plus')}<span>加 1 件免費</span></button>`:''}</div>`).join('')}</div>`,
   footer:'<button type="button" data-act="close-dialog">回購物車</button><button type="button" class="pos-primary" data-act="pay-continue" autofocus>繼續結帳</button>'});
 }
 function payRows(){return pay.rows.map(row=>{const m=methodById(row.id);return {id:m.id,name:m.name,cash:!!m.cash,amount:row.amount===''?0:P.parseAmount(row.amount)};});}
 function paySettle(){
  const t=totals(),rows=payRows();
  // 只有一筆現金而且沒填金額，視為收剛好。
  if(rows.length===1&&pay.rows[0].amount==='')rows[0].amount=t.total;
  if(rows.some(r=>Number.isNaN(r.amount)))return {ok:false,error:'金額請填數字',paid:0,due:t.total,change:0,payments:[]};
  return P.settlePayments(t.total,rows);
 }
 // 應收 0 元（全部是贈品）：不顯示付款方式、快速鍵和數字鍵盤，直接完成出貨。
 function renderFreePay(t){
  openDialog({title:'結帳',form:'pay',body:`<div class="pos-pay-free"><span class="pos-pay-free-icon">${icon('gift')}</span><div><span class="pos-pay-free-label">應收</span><b>${money(0)}</b><p>${t.giftQty?`${t.giftQty} 件贈品，價值 ${money(t.giftValue)}。`:'這張單的金額是 0 元。'}不用收款，按「完成出貨」就會記錄訂單並扣庫存。</p></div></div>
<input type="hidden" name="taxId" value=""><input type="hidden" name="carrier" value="">${field('訂單備註（選填）','<input name="note" maxlength="60" autocomplete="off" placeholder="例如 送給哪位客人、哪個活動">')}
<label class="pos-check"><input type="checkbox" name="print" ${pay.print?'checked':''}>完成後列印交易明細</label>${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary" autofocus>完成出貨（0 元）</button>'});
 }
 function renderPay(){
  const t=totals(),keep=dialog.open?{taxId:$('[name=taxId]',dialog)?.value||'',carrier:$('[name=carrier]',dialog)?.value||'',note:$('[name=note]',dialog)?.value||''}:{taxId:'',carrier:'',note:''};
  if(t.total===0)return renderFreePay(t);
  const cashRow=pay.rows.findIndex(r=>methodById(r.id).cash);
  openDialog({title:'結帳',form:'pay',size:'wide',body:`<div class="pos-pay-layout"><div class="pos-pay-main">
<p class="pos-pay-total"><span>應收</span><b>${money(t.total)}</b></p>
<div class="pos-pay-rows">${pay.rows.map((row,i)=>`<div class="pos-pay-row${pay.active===i?' is-active':''}"><div class="pos-method-pick" role="radiogroup" aria-label="付款方式${pay.rows.length>1?' '+(i+1):''}">${S.settings.methods.filter(m=>!m.off||m.id===row.id).map(m=>`<button type="button" class="pos-method" role="radio" aria-checked="${m.id===row.id}" data-act="pay-method" data-i="${i}" data-id="${h(m.id)}">${methodIcon(m)}<span>${h(m.name)}</span></button>`).join('')}</div><input name="amount-${i}" data-input="pay-amount" data-i="${i}" inputmode="numeric" autocomplete="off" value="${h(row.amount)}" placeholder="${pay.rows.length===1?t.total:'金額'}" aria-label="收款金額 ${i+1}"${i===pay.active?' autofocus':''}>${pay.rows.length>1?`<button type="button" class="pos-icon" data-act="pay-remove" data-i="${i}" aria-label="移除這筆付款">✕</button>`:''}</div>`).join('')}</div>
<button type="button" class="pos-link" data-act="pay-add">＋ 分開付款（再加一種付款方式）</button>
${cashRow>=0&&S.settings.quickCash!==false?`<div class="pos-chips pos-quick" aria-label="現金快速鍵">${P.cashSuggestions(t.total).map((amount,i)=>`<button type="button" class="pos-chip" data-act="pay-quick" data-amount="${amount}">${i===0&&amount===t.total?'剛好 ':''}${money(amount)}</button>`).join('')}</div>`:''}
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
  if(totals().total===0){box.dataset.state='ok';box.innerHTML=`<span>0 元銷貨，不用收款</span><b>${money(0)}</b>`;return;}
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
   for(const [pid,need] of stockNeeds(t.lines)){const p=product(pid);if(p?.track&&need>qtyHere(p))return formError(form,`「${p.name}」庫存只剩 ${qtyHere(p)}，請調整數量`);}
  }
  const time=Date.now(),next=P.nextOrderId(S.seq,time),m=member(),shift=currentShift();
  let order;
  try{order=P.buildOrder({id:next.id,time,cart,settings:S.settings,member:m,payments:s.payments,cashier:shift?.cashier||whoName(),shiftId:shift?.id||'',buyerTaxId:taxId,carrier,note:form.elements.note.value.trim(),promos:S.promos});}
  catch(error){return formError(form,error.message);}
  Object.assign(order,{storeId:cur(),storeName:curStore().name});
  const ops=[['orders','put',order]];
  S.seq=next.seq;S.orders.push(order);
  for(const line of order.lines){
   const parts=line.bundle?line.bundle.items.map(x=>({pid:x.pid,qty:x.qty*line.qty,note:'禮包：'+line.name})):[{pid:line.pid,qty:line.qty,note:line.gift?'贈品：'+line.giftReason:''}];
   for(const part of parts){const p=product(part.pid);if(p?.track){P.addStock(p,cur(),-part.qty);addMove(ops,p,line.gift?'gift':'sale',-part.qty,part.note,order.id);}}
  }
  if(m){m.points=Math.max(0,m.points-order.pointsUsed+order.pointsEarned);m.total=(m.total||0)+order.total;m.visits=(m.visits||0)+1;m.lastAt=time;order.memberPoints=m.points;}
  ops.push(...kvOps('seq','products','members'));
  commit(ops);
  const wantPrint=form.elements.print.checked;
  resetCart();pay=null;
  openDialog({title:'結帳完成',body:`<div class="pos-done"><p class="pos-done-label">${order.total===0?'0 元銷貨完成':order.change?'找零':'已收款'}</p><p class="pos-done-amount">${money(order.change||order.total)}</p><p class="pos-done-meta">單號 ${h(order.id)}・${order.payments.map(p=>h(p.name)+' '+money(p.amount)).join('、')}${order.pointsEarned?`・獲得 ${order.pointsEarned} 點`:''}</p></div>`,
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
 // 明細上方印的是那一家門市的名稱、地址、電話；統一編號是公司的，各門市共用。
 function receiptHead(title,at=cur()){
  const s=S.settings,st=storeOf(at)||curStore();
  return `<h1>${h(st.name)}</h1>${st.address?`<p>${h(st.address)}</p>`:''}${st.phone?`<p>電話 ${h(st.phone)}</p>`:''}${s.storeTaxId?`<p>統一編號 ${h(s.storeTaxId)}</p>`:''}<h2>${h(title)}</h2>`;
 }
 const receiptRow=(label,value,cls='')=>`<p class="r-row ${cls}"><span>${label}</span><span>${value}</span></p>`;
 function receiptHtml(order){
  const refunded=P.refundedTotal(order);
  return `<article class="pos-receipt">${receiptHead('交易明細',sid(order))}${S.settings.receiptHeader?`<p class="r-center">${h(S.settings.receiptHeader)}</p>`:''}
${receiptRow('單號',h(order.id))}${receiptRow('時間',P.formatTime(order.t))}${order.cashier?receiptRow('收銀員',h(order.cashier)):''}${order.memberName?receiptRow('會員',h(order.memberName)+(order.memberLevel?'（'+h(order.memberLevel)+'）':'')):''}
<hr>${order.lines.map(line=>`<p class="r-name">${h(line.name)}${line.note?`（${h(line.note)}）`:''}</p>${S.settings.receiptShowSku&&line.sku?`<p class="r-small">${h(line.sku)}</p>`:''}${line.bundle?`<p class="r-small">${h(line.bundle.items.map(x=>x.name+'×'+x.qty*line.qty).join('、'))}</p>`:''}${line.gift?receiptRow(`${money(line.price)} × ${line.qty}`,'贈品 '+money(0))+`<p class="r-small">${h(line.giftReason||'贈品')}</p>`:receiptRow(`${money(line.price)} × ${line.qty}`,money(line.price*line.qty))+(line.promoOff?receiptRow(h(line.promoLabel||'優惠'),'−'+money(line.promoOff)):'')+(line.discount?receiptRow(h(line.discountLabel||'折扣'),'−'+money(line.discount)):'')}`).join('')}<hr>
${receiptRow('小計',money(order.subtotal))}${order.orderDiscount?receiptRow('整單折扣 '+h(order.orderDiscountLabel),'−'+money(order.orderDiscount)):''}${order.levelDiscount?receiptRow(h(order.memberLevel)+' '+h(P.discountLabel({type:'pct',value:order.levelPct})),'−'+money(order.levelDiscount)):''}${order.pointsValue?receiptRow(`點數折抵 ${order.pointsUsed} 點`,'−'+money(order.pointsValue)):''}${order.taxMode==='added'?receiptRow(`營業稅 ${order.taxRate}%`,money(order.tax)):''}
${receiptRow('總計',money(order.total),'r-total')}${order.taxMode==='included'?receiptRow(`內含營業稅 ${order.taxRate}%`,money(order.tax)):''}
<hr>${order.payments.map(p=>receiptRow(h(p.name),money(p.amount))).join('')}${order.change?receiptRow('找零',money(order.change)):''}
${refunded?'<hr>'+order.refunds.map(r=>receiptRow('退款 '+P.formatTime(r.t).slice(5),'−'+money(r.amount))).join('')+receiptRow('退款後金額',money(order.total-refunded),'r-total'):''}
${order.buyerTaxId||order.carrier||order.note||order.pointsEarned?'<hr>':''}${order.buyerTaxId?receiptRow('買受人統編',h(order.buyerTaxId)):''}${order.carrier?receiptRow('載具',h(order.carrier)):''}${order.pointsEarned?receiptRow('本次獲得點數',order.pointsEarned+' 點'):''}${S.settings.receiptShowPoints!==false&&order.memberPoints!=null?receiptRow('會員點數餘額',order.memberPoints+' 點'):''}${order.note?`<p>備註：${h(order.note)}</p>`:''}
<hr><p class="r-center">${h(S.settings.receiptFooter)}</p><p class="r-center r-small">本明細不是統一發票</p></article>`;
 }
 function printOrder(order){printHtml(receiptHtml(order));}
 function shiftReportHtml(shift){
  const s=P.shiftSummary(shift,S.orders);
  return `<article class="pos-receipt">${receiptHead(shift.closedAt?'交班結帳表':'班別小結',sid(shift))}
${receiptRow('收銀員',h(shift.cashier))}${receiptRow('開班',P.formatTime(shift.openedAt))}${shift.closedAt?receiptRow('交班',P.formatTime(shift.closedAt)):receiptRow('列印時間',P.formatTime(Date.now()))}
<hr>${receiptRow('訂單數',s.orders+' 筆')}${receiptRow('銷售件數',s.items+' 件')}${receiptRow('銷售金額',money(s.sales))}${receiptRow('退款',`−${money(s.refunds)}（${s.refundCount} 筆）`)}${receiptRow('淨額',money(s.net),'r-total')}
<hr>${s.methods.map(m=>receiptRow(h(m.name),money(m.net))).join('')||'<p>沒有收款紀錄</p>'}
<hr>${receiptRow('開班零用金',money(s.openingCash))}${receiptRow('現金銷售',money(s.cashSales))}${receiptRow('現金退款','−'+money(s.cashRefunds))}${receiptRow('現金存入',money(s.cashIn))}${receiptRow('現金取出','−'+money(s.cashOut))}${receiptRow('抽屜應有現金',money(s.expectedCash),'r-total')}
${s.countedCash==null?'':receiptRow('實點現金',money(s.countedCash))+receiptRow('差額',(s.difference>0?'+':'')+money(s.difference))}${shift.note?`<p>備註：${h(shift.note)}</p>`:''}</article>`;
 }

 // ---------- 訂單 ----------
 function ordersInRange(){
  const [from,to]=rangeDates(ui.orders.range),start=P.dayStart(from),end=P.dayStart(P.addDays(to,1)),key=ui.orders.q.normalize('NFKC').trim().toLowerCase();
  return scoped(S.orders).filter(o=>o.t>=start&&o.t<end&&(!key||o.id.includes(key)||o.memberName.toLowerCase().includes(key)||o.buyerTaxId.includes(key)||o.lines.some(l=>l.name.toLowerCase().includes(key)))).reverse();
 }
 function renderOrders(){
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>訂單紀錄</h2><div class="pos-page-tools"><button type="button" data-act="export-orders">匯出訂單 CSV</button><button type="button" data-act="export-lines">匯出明細 CSV</button></div></div>
<div class="pos-filters">${scopeChips()}${rangeChips(ui.orders.range,'orders-range')}<input type="search" id="pos-orders-q" data-input="orders-q" autocomplete="off" placeholder="搜尋單號、品名、會員或統編" aria-label="搜尋訂單" value="${h(ui.orders.q)}"></div><div id="pos-list"></div></div>`;
  renderOrderList();
 }
 function renderOrderList(){
  const list=ordersInRange(),box=$('#pos-list');if(!box)return;
  const sum=list.reduce((total,o)=>total+P.orderNet(o),0);
  box.innerHTML=list.length?`<p class="pos-summary">${list.length} 筆訂單・退款後合計 <b>${money(sum)}</b></p><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>單號</th><th>時間</th><th class="num">件數</th><th class="num">金額</th><th>付款</th><th>會員</th>${ui.scope==='all'&&multiStore()?'<th>門市</th>':''}<th>狀態</th></tr></thead><tbody>${list.slice(0,300).map(o=>`<tr><td><button type="button" class="pos-link" data-act="order" data-id="${h(o.id)}">${h(o.id)}</button></td><td>${P.formatTime(o.t).slice(5)}</td><td class="num">${o.lines.reduce((n,l)=>n+l.qty,0)}</td><td class="num">${money(o.total)}</td><td>${o.payments.map(p=>h(p.name)).join('、')}</td><td>${h(o.memberName)||'—'}</td>${ui.scope==='all'&&multiStore()?`<td>${h(storeName(sid(o))||o.storeName)}</td>`:''}<td>${statusTag(o)}</td></tr>`).join('')}</tbody></table></div>${list.length>300?'<p class="pos-more">只顯示最新 300 筆，請縮小日期範圍或匯出 CSV 查看全部</p>':''}`:empty('這段期間沒有訂單');
 }
 function openOrder(id){
  const o=S.orders.find(order=>order.id===id);if(!o)return;
  const refunded=P.refundedTotal(o);
  openDialog({title:'訂單 '+o.id,size:'wide',body:`<div class="pos-meta"><span>${P.formatTime(o.t)}</span>${o.cashier?`<span>收銀員 ${h(o.cashier)}</span>`:''}${o.memberName?`<span>會員 ${h(o.memberName)}${o.memberLevel?'（'+h(o.memberLevel)+'）':''}</span>`:''}${o.buyerTaxId?`<span>統編 ${h(o.buyerTaxId)}</span>`:''}${o.carrier?`<span>載具 ${h(o.carrier)}</span>`:''}${statusTag(o)}</div>${o.note?`<p class="pos-note">備註：${h(o.note)}</p>`:''}
<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>品名</th><th class="num">單價</th><th class="num">數量</th><th class="num">金額</th><th class="num">已退</th></tr></thead><tbody>${o.lines.map(l=>`<tr><td>${h(l.name)}${l.discountLabel?` <em class="pos-em">${h(l.discountLabel)}</em>`:''}${l.promoLabel?` <span class="pos-line-tag is-promo">${h(l.promoLabel)}</span>`:''}${l.gift?` <span class="pos-line-tag is-gift">贈品・${h(l.giftReason||'贈品')}</span>`:''}${l.bundle?`<small>${h(l.bundle.items.map(x=>x.name+'×'+x.qty*l.qty).join('、'))}</small>`:''}${l.note?`<small>${h(l.note)}</small>`:''}</td><td class="num">${money(l.price)}</td><td class="num">${l.qty}</td><td class="num">${money(l.net)}</td><td class="num">${l.returned||'—'}</td></tr>`).join('')}</tbody></table></div>
<dl class="pos-totals pos-totals-plain"><div><dt>小計</dt><dd>${money(o.subtotal)}</dd></div>${o.orderDiscount?`<div><dt>整單折扣 ${h(o.orderDiscountLabel)}</dt><dd>−${money(o.orderDiscount)}</dd></div>`:''}${o.levelDiscount?`<div><dt>${h(o.memberLevel)} ${h(P.discountLabel({type:'pct',value:o.levelPct}))}</dt><dd>−${money(o.levelDiscount)}</dd></div>`:''}${o.pointsValue?`<div><dt>點數折抵 ${o.pointsUsed} 點</dt><dd>−${money(o.pointsValue)}</dd></div>`:''}${o.taxMode!=='none'?`<div><dt>${o.taxMode==='included'?'內含':''}營業稅 ${o.taxRate}%</dt><dd>${money(o.tax)}</dd></div>`:''}<div class="pos-total"><dt>總計</dt><dd>${money(o.total)}</dd></div>${o.payments.map(p=>`<div><dt>${h(p.name)}</dt><dd>${money(p.amount)}</dd></div>`).join('')}${o.change?`<div><dt>找零</dt><dd>${money(o.change)}</dd></div>`:''}${o.refunds.map(r=>`<div class="pos-refund-row"><dt>退款<small>${P.formatTime(r.t).slice(5)}・${h(r.method.name)}${r.reason?'・'+h(r.reason):''}</small></dt><dd>−${money(r.amount)}</dd></div>`).join('')}${refunded?`<div class="pos-total"><dt>退款後金額</dt><dd>${money(o.total-refunded)}</dd></div>`:''}</dl>`,
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
  const result=P.applyRefund(o,quote,{time:Date.now(),method:{id:method.id,name:method.name,cash:!!method.cash},cashier:shift?.cashier||whoName(),shiftId:shift?.id||'',restock,reason:form.elements.reason.value.trim()});
  const ops=[['orders','put',result.order]];
  S.orders[S.orders.indexOf(o)]=result.order;
  if(restock)for(const item of quote.lines){
   const line=o.lines[item.i],parts=line?.bundle?line.bundle.items.map(x=>({pid:x.pid,qty:x.qty*item.qty})):[{pid:item.pid,qty:item.qty}];
   for(const part of parts){const p=product(part.pid);if(p?.track){P.addStock(p,sid(o),part.qty);addMove(ops,p,'refund',part.qty,line?.bundle?'禮包：'+line.name:'',o.id,sid(o));}}
  }
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
  box.innerHTML=list.length?`<p class="pos-summary">${list.length} 項商品</p><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>品名</th><th>條碼</th><th>分類</th><th>品牌</th><th>廠商</th><th class="num">售價</th><th class="num">成本</th><th class="num">${multiStore()?h(curStore().name)+'庫存':'庫存'}</th><th>狀態</th></tr></thead><tbody>${list.map(p=>`<tr><td><button type="button" class="pos-link" data-act="product-edit" data-id="${h(p.id)}">${h(p.name)}</button></td><td class="mono">${h(p.sku)||'—'}</td><td>${h(catName(p.categoryId))||'—'}</td><td>${h(p.brand)||'—'}</td><td>${h(supplierName(p.supplierId))||'—'}</td><td class="num">${money(p.price)}</td><td class="num">${money(p.cost||0)}</td><td class="num">${p.track?qtyHere(p):'不計'}</td><td>${p.active===false?'<span class="pos-tag pos-tag-off">下架</span>':'<span class="pos-tag pos-tag-paid">上架</span>'}</td></tr>`).join('')}</tbody></table></div>`:empty(S.products.length?'找不到符合的商品':'還沒有商品，按「新增商品」開始建立');
 }
 function openProduct(id){
  const p=id?product(id):null;
  openDialog({title:p?'編輯商品':'新增商品',form:'product',body:`<input type="hidden" name="id" value="${h(p?.id||'')}">
${field('品名','<input name="name" maxlength="60" required autocomplete="off" value="'+h(p?.name||'')+'"'+(p?'':' autofocus')+'>')}
<div class="pos-row">${field('條碼／貨號','<input name="sku" maxlength="32" autocomplete="off" autocapitalize="characters" value="'+h(p?.sku||'')+'">','掃描槍掃到這組號碼就會加入購物車')}${field('分類','<select name="category"><option value="">未分類</option>'+S.categories.map(c=>`<option value="${h(c.id)}"${p?.categoryId===c.id?' selected':''}>${h(c.name)}</option>`).join('')+'</select>')}</div>
<div class="pos-row">${field('品牌','<input name="brand" maxlength="30" autocomplete="off" list="pos-brand-list" value="'+h(p?.brand||'')+'"><datalist id="pos-brand-list">'+P.brandsOf(S.products).map(b=>`<option value="${h(b)}">`).join('')+'</datalist>','可以留空')}${field('進貨廠商','<select name="supplier"><option value="">未指定</option>'+S.suppliers.map(s=>`<option value="${h(s.id)}"${p?.supplierId===s.id?' selected':''}>${h(s.name)}</option>`).join('')+'</select>','廠商在「庫存」頁的「廠商管理」新增')}</div>
<div class="pos-row">${field('售價','<input name="price" inputmode="numeric" required autocomplete="off" value="'+h(p?p.price:'')+'">')}${field('成本','<input name="cost" inputmode="numeric" autocomplete="off" value="'+h(p?p.cost||0:'')+'">','用來計算毛利，可不填')}</div>
<label class="pos-check"><input type="checkbox" name="track" ${!p||p.track?'checked':''}>管理庫存數量</label>
<div class="pos-row">${p?field(multiStore()?h(curStore().name)+'庫存':'目前庫存','<input value="'+(p.track?qtyHere(p):'不計')+'" disabled>',(multiStore()&&p.track?h(stockText(p))+'。':'')+'要增減庫存，請到「庫存」頁進貨、盤點或調撥'):field(multiStore()?h(curStore().name)+'期初庫存':'期初庫存','<input name="stock" inputmode="numeric" autocomplete="off" value="0">',multiStore()?'其他門市從 0 開始':'')}${field('安全庫存','<input name="lowStock" inputmode="numeric" autocomplete="off" value="'+h(p?p.lowStock:S.settings.lowStock)+'">','低於等於這個數量會提醒')}</div>
<label class="pos-check"><input type="checkbox" name="active" ${!p||p.active!==false?'checked':''}>上架（顯示在收銀畫面）</label>${errorBox}`,
   footer:`${p?`<button type="button" class="pos-danger pos-left" data-act="product-delete" data-id="${h(p.id)}">刪除</button>`:''}<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>`});
 }
 function saveProduct(form){
  const e=form.elements,id=e.id.value,name=e.name.value.trim(),sku=P.normalizeCode(e.sku.value),price=P.parseAmount(e.price.value),cost=e.cost.value.trim()===''?0:P.parseAmount(e.cost.value),low=e.lowStock.value.trim()===''?0:P.parseAmount(e.lowStock.value),brand=e.brand.value.normalize('NFKC').trim().slice(0,30);
  if(!name)return formError(form,'請填品名');
  if(Number.isNaN(price))return formError(form,'售價請填數字');
  if(Number.isNaN(cost)||Number.isNaN(low))return formError(form,'成本和安全庫存請填數字');
  if(sku&&S.products.some(p=>p.id!==id&&P.normalizeCode(p.sku)===sku))return formError(form,'這個條碼已經有其他商品在用');
  const ops=[];
  if(id){
   Object.assign(product(id),{name,sku,categoryId:e.category.value,brand,supplierId:e.supplier.value,price,cost,track:e.track.checked,lowStock:low,active:e.active.checked});
  }else{
   const stock=e.stock.value.trim()===''?0:P.parseAmount(e.stock.value);
   if(Number.isNaN(stock))return formError(form,'期初庫存請填數字');
   const p={id:uid(),name,sku,categoryId:e.category.value,brand,supplierId:e.supplier.value,price,cost,track:e.track.checked,stocks:{[cur()]:e.track.checked?stock:0},lowStock:low,active:e.active.checked};
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
  openDialog({title:'匯入商品',body:`<p class="pos-confirm">讀到 ${parsed.items.length} 項商品：新增 ${parsed.items.length-updates} 項、更新 ${updates} 項（有條碼用條碼比對，沒有條碼用品名）。</p>${parsed.errors.length?`<div class="pos-banner pos-banner-warn"><p>有 ${parsed.errors.length} 列無法匯入：</p><ul>${parsed.errors.slice(0,8).map(e=>`<li>${h(e)}</li>`).join('')}</ul>${parsed.errors.length>8?'<p>……其餘略</p>':''}</div>`:''}<p class="pos-hint">欄位：${P.PRODUCT_COLUMNS.join('、')}。有填「庫存」的商品會直接把${multiStore()?h(curStore().name)+'的':''}庫存改成檔案裡的數量；「廠商」沒建立過的會自動新增。</p>`,
   footer:`<button type="button" data-act="close-dialog">取消</button>${parsed.items.length?'<button type="button" class="pos-primary" data-act="import-apply" autofocus>匯入</button>':''}`});
 }
 function applyImport(){
  const ops=[];
  for(const item of pendingImport||[]){
   let cat=item.category?S.categories.find(c=>c.name===item.category):null;
   if(item.category&&!cat){cat={id:uid(),name:item.category};S.categories.push(cat);}
   let p=S.products.find(x=>item.sku?P.normalizeCode(x.sku)===item.sku:x.name===item.name);
   if(!p){p={id:uid(),name:item.name,sku:item.sku,categoryId:'',brand:'',supplierId:'',price:0,cost:0,track:false,stocks:{},lowStock:S.settings.lowStock,active:true};S.products.push(p);}
   const before=p.track?qtyHere(p):0;
   if(item.brand)p.brand=item.brand;
   if(item.supplier){let s=S.suppliers.find(x=>x.name===item.supplier);if(!s){s={id:uid(),name:item.supplier,phone:'',note:''};S.suppliers.push(s);}p.supplierId=s.id;}
   Object.assign(p,{name:item.name,sku:item.sku||p.sku,categoryId:cat?cat.id:(item.category?'':p.categoryId),price:item.price,cost:item.cost,active:item.active});
   if(item.lowStock!=null)p.lowStock=item.lowStock;
   if(item.track){p.track=true;P.addStock(p,cur(),item.stock-qtyHere(p));if(item.stock!==before)addMove(ops,p,'adjust',item.stock-before,'CSV 匯入');}
  }
  const count=pendingImport?.length||0;pendingImport=null;
  ops.push(...kvOps('products','categories','suppliers'));commit(ops);closeDialog();toast(`已匯入 ${count} 項商品`);render();
 }

 // ---------- 庫存 ----------
 const MOVE_LABEL={sale:'銷售',gift:'贈品',refund:'退貨',in:'進貨',adjust:'盤點調整',transfer:'調撥'};
 // 庫存頁看哪一家門市：預設是目前收銀的門市；有兩家以上可以選「全部門市」。
 const stockScope=()=>ui.stock.store==='all'&&multiStore()?'all':(storeOf(ui.stock.store)?ui.stock.store:cur());
 const stockQty=(p,scope)=>scope==='all'?P.totalStock(p,S.stores.map(s=>s.id)):P.stockAt(p,scope);
 const stockFilter=(level='',q='')=>({categoryId:ui.stock.cat,brand:ui.stock.brand,supplierId:ui.stock.supplier,q,level,storeId:stockScope(),storeIds:S.stores.map(s=>s.id)});
 const options=(list,value,all,none)=>`<option value="all">${all}</option>${list.map(([id,label])=>`<option value="${h(id)}"${value===id?' selected':''}>${h(label)}</option>`).join('')}${none?`<option value="none"${value==='none'?' selected':''}>${none}</option>`:''}`;
 const qtyCell=(p,q)=>q<=0?`<span class="pos-tag pos-tag-refunded">${q}</span>`:P.isLowStock(p,q)?`<span class="pos-tag pos-tag-partial">${q}</span>`:q;
 function renderStock(){
  const scope=stockScope(),f=ui.stock,list=P.filterStock(S.products,stockFilter()),qty=p=>stockQty(p,scope);
  const low=list.filter(p=>qty(p)>0&&P.isLowStock(p,qty(p))).length,out=list.filter(p=>qty(p)<=0).length,value=list.reduce((sum,p)=>sum+Math.max(0,qty(p))*(p.cost||0),0);
  const moves=S.moves.filter(m=>scope==='all'||sid(m)===scope),filtered=f.cat!=='all'||f.brand!=='all'||f.supplier!=='all';
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>庫存${multiStore()?`<small class="pos-head-note">${scope==='all'?'全部門市':h(storeName(scope))}</small>`:''}</h2><div class="pos-page-tools">${multiStore()?`<button type="button" data-act="stock-transfer">${icon('swap')}<span>門市調撥</span></button>`:''}<button type="button" data-act="suppliers">廠商管理</button><button type="button" data-act="export-stock">匯出庫存 CSV</button><button type="button" data-act="export-moves">匯出異動 CSV</button></div></div>
<div class="pos-filters pos-stock-filters">${multiStore()?`<label class="pos-select"><span>門市倉庫</span><select data-change="stock-store">${S.stores.map(s=>`<option value="${h(s.id)}"${scope===s.id?' selected':''}>${h(s.name)}</option>`).join('')}<option value="all"${scope==='all'?' selected':''}>全部門市</option></select></label>`:''}<label class="pos-select"><span>類別</span><select data-change="stock-cat">${options(S.categories.map(c=>[c.id,c.name]),f.cat,'全部類別','未分類')}</select></label><label class="pos-select"><span>品牌</span><select data-change="stock-brand">${options(P.brandsOf(S.products).map(b=>[b,b]),f.brand,'全部品牌','未填品牌')}</select></label><label class="pos-select"><span>進貨廠商</span><select data-change="stock-supplier">${options(S.suppliers.map(s=>[s.id,s.name]),f.supplier,'全部廠商','未指定廠商')}</select></label></div>
<div class="pos-tiles"><div class="pos-tile"><span>${filtered?'符合篩選的商品':'管理中的商品'}</span><b>${list.length}</b></div><div class="pos-tile"><span>低於安全庫存</span><b>${low}</b></div><div class="pos-tile"><span>缺貨</span><b>${out}</b></div><div class="pos-tile"><span>庫存成本</span><b>${money(value)}</b></div></div>
<div class="pos-filters"><div class="pos-chips" role="group" aria-label="庫存篩選">${[['all','全部'],['low','低庫存'],['out','缺貨']].map(([id,label])=>`<button type="button" class="pos-chip" data-act="stock-filter" data-id="${id}" aria-pressed="${f.filter===id}">${label}</button>`).join('')}</div><input type="search" data-input="stock-q" autocomplete="off" placeholder="搜尋品名或條碼" aria-label="搜尋庫存" value="${h(f.q)}"></div><div id="pos-list"></div>
<h3 class="pos-subhead">最近的庫存異動</h3>${moves.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>時間</th>${multiStore()?'<th>門市</th>':''}<th>品名</th><th>類型</th><th class="num">數量</th><th class="num">結存</th><th>備註</th></tr></thead><tbody>${moves.slice(-60).reverse().map(m=>`<tr><td>${P.formatTime(m.t).slice(5)}</td>${multiStore()?`<td>${h(storeName(sid(m))||m.storeName)}</td>`:''}<td>${h(m.name)}</td><td>${MOVE_LABEL[m.type]||h(m.type)}</td><td class="num">${m.qty>0?'+':''}${m.qty}</td><td class="num">${m.after}</td><td>${h(m.note||m.ref)}</td></tr>`).join('')}</tbody></table></div>`:empty('還沒有庫存異動')}</div>`;
  renderStockList();
 }
 function renderStockList(){
  const box=$('#pos-list');if(!box)return;
  const f=ui.stock,scope=stockScope(),all=scope==='all',list=P.filterStock(S.products,stockFilter(f.filter==='all'?'':f.filter,f.q));
  const head=all?S.stores.map(s=>`<th class="num">${h(s.name)}</th>`).join('')+'<th class="num">合計</th>':'<th class="num">庫存</th>';
  const cells=p=>all?S.stores.map(s=>`<td class="num">${qtyCell(p,P.stockAt(p,s.id))}</td>`).join('')+`<td class="num"><b>${qtyCell(p,stockQty(p,'all'))}</b></td>`:`<td class="num">${qtyCell(p,P.stockAt(p,scope))}</td>`;
  box.innerHTML=list.length?`<p class="pos-summary">${list.length} 項商品</p><div class="pos-table-wrap"><table class="pos-table pos-stock-table"><thead><tr><th>品名</th><th>品牌</th><th>類別</th><th>進貨廠商</th>${head}<th class="num">安全庫存</th><th>操作</th></tr></thead><tbody>${list.map(p=>`<tr><td>${h(p.name)}<small class="mono">${h(p.sku)}</small></td><td>${h(p.brand)||'—'}</td><td>${h(catName(p.categoryId))||'—'}</td><td>${h(supplierName(p.supplierId))||'—'}</td>${cells(p)}<td class="num">${p.lowStock}</td><td class="pos-actions"><button type="button" data-act="stock-in" data-id="${h(p.id)}">進貨</button><button type="button" data-act="stock-count" data-id="${h(p.id)}">盤點</button>${multiStore()?`<button type="button" data-act="stock-transfer" data-id="${h(p.id)}">調撥</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty(f.filter==='all'&&!f.q&&f.cat==='all'&&f.brand==='all'&&f.supplier==='all'?'沒有管理庫存的商品':'沒有符合的商品');
 }
 const storeSelect=(name,value,label)=>field(label,`<select name="${name}" data-change="stock-dialog-store">${S.stores.map(s=>`<option value="${h(s.id)}"${value===s.id?' selected':''}>${h(s.name)}</option>`).join('')}</select>`);
 function openStock(id,mode){
  const p=product(id);if(!p)return;
  const scope=stockScope(),at=scope==='all'?cur():scope,q=P.stockAt(p,at);
  openDialog({title:(mode==='in'?'進貨：':'盤點：')+p.name,form:'stock',body:`<input type="hidden" name="id" value="${h(p.id)}"><input type="hidden" name="mode" value="${mode}">${multiStore()?`<p class="pos-hint">目前庫存：${h(stockText(p))}</p>`:''}
<div class="pos-row">${multiStore()?storeSelect('store',at,mode==='in'?'進到哪一家門市':'盤點哪一家門市'):'<input type="hidden" name="store" value="'+h(at)+'">'}${mode==='in'?field('進貨廠商','<select name="supplier"><option value="">未指定</option>'+S.suppliers.map(s=>`<option value="${h(s.id)}"${p.supplierId===s.id?' selected':''}>${h(s.name)}</option>`).join('')+'</select>'):''}</div>
<p class="pos-hint pos-stock-now">${multiStore()?h(storeName(at))+' ':''}目前庫存 ${q}</p>
${mode==='in'?`<div class="pos-row">${field('進貨數量','<input name="qty" inputmode="numeric" autocomplete="off" required autofocus>')}${field('進貨單價（選填）','<input name="cost" inputmode="numeric" autocomplete="off" placeholder="'+(p.cost||0)+'">','有填會更新商品成本')}</div>`:field('實際盤點數量','<input name="qty" inputmode="numeric" autocomplete="off" required autofocus value="'+q+'">')}
${field('備註（選填）','<input name="note" maxlength="40" autocomplete="off">')}${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>'});
 }
 function saveStock(form){
  const e=form.elements,p=product(e.id.value),qty=P.parseAmount(e.qty.value),at=storeOf(e.store.value)?e.store.value:cur();if(!p)return false;
  if(Number.isNaN(qty))return formError(form,'數量請填 0 以上的整數');
  const ops=[];
  if(e.mode.value==='in'){
   if(qty<=0)return formError(form,'進貨數量要大於 0');
   const cost=e.cost.value.trim();if(cost){const c=P.parseAmount(cost);if(Number.isNaN(c))return formError(form,'進貨單價請填數字');p.cost=c;}
   const vendor=supplierName(e.supplier.value);if(vendor&&!p.supplierId)p.supplierId=e.supplier.value;
   P.addStock(p,at,qty);addMove(ops,p,'in',qty,[vendor&&'廠商 '+vendor,e.note.value.trim()].filter(Boolean).join('・'),'',at);
  }else{
   const delta=qty-P.stockAt(p,at);P.addStock(p,at,delta);addMove(ops,p,'adjust',delta,e.note.value.trim(),'',at);
  }
  ops.push(...kvOps('products'));commit(ops);closeDialog();toast(multiStore()?storeName(at)+'庫存已更新':'庫存已更新');render();
  return true;
 }
 // 門市調撥：從一家門市搬貨到另一家，兩邊各記一筆異動。
 function openTransfer(id){
  const tracked=S.products.filter(p=>p.track).sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));if(!tracked.length)return toast('沒有管理庫存的商品','warn');
  const p=product(id)||tracked[0],scope=stockScope(),from=scope==='all'?cur():scope,to=S.stores.find(s=>s.id!==from)?.id||from;
  openDialog({title:'門市調撥',form:'transfer',body:`${field('商品','<select name="id" data-change="transfer-product">'+tracked.map(x=>`<option value="${h(x.id)}"${x.id===p.id?' selected':''}>${h(x.name)}</option>`).join('')+'</select>')}
<p class="pos-hint pos-stock-now">目前庫存：${h(stockText(p))}</p>
<div class="pos-row">${storeSelect('from',from,'從（調出）')}${storeSelect('to',to,'到（調入）')}</div>
<div class="pos-row">${field('調撥數量','<input name="qty" inputmode="numeric" autocomplete="off" required autofocus>')}${field('備註（選填）','<input name="note" maxlength="40" autocomplete="off">')}</div>${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">確認調撥</button>'});
 }
 function saveTransfer(form){
  const e=form.elements,p=product(e.id.value),qty=P.parseAmount(e.qty.value),from=e.from.value,to=e.to.value,note=e.note.value.trim();if(!p)return false;
  if(Number.isNaN(qty))return formError(form,'調撥數量請填整數');
  if(!storeOf(from)||!storeOf(to))return formError(form,'請選擇門市');
  try{P.transferStock(p,from,to,qty);}catch(error){return formError(form,error.message);}
  const ops=[];
  addMove(ops,p,'transfer',-qty,['調撥到 '+storeName(to),note].filter(Boolean).join('・'),'',from);
  addMove(ops,p,'transfer',qty,['從 '+storeName(from)+' 調入',note].filter(Boolean).join('・'),'',to);
  ops.push(...kvOps('products'));commit(ops);closeDialog();toast(`已從${storeName(from)}調 ${qty} 個「${p.name}」到${storeName(to)}`);render();
  return true;
 }
 function openSuppliers(){
  openDialog({title:'廠商管理',form:'suppliers',body:`<div class="pos-cat-list">${S.suppliers.map((s,i)=>`<div class="pos-cat-row pos-supplier-row"><input name="sup-name-${i}" maxlength="30" autocomplete="off" value="${h(s.name)}" aria-label="廠商名稱"><input name="sup-phone-${i}" maxlength="20" autocomplete="off" value="${h(s.phone)}" placeholder="電話（選填）" aria-label="廠商電話"><label class="pos-check"><input type="checkbox" name="sup-del-${i}">刪除</label></div>`).join('')||'<p class="pos-hint">還沒有廠商</p>'}</div><div class="pos-row">${field('新增廠商','<input name="new" maxlength="30" autocomplete="off" placeholder="例如 晨光飲品">')}${field('電話（選填）','<input name="newPhone" maxlength="20" autocomplete="off">')}</div><p class="pos-hint">商品的進貨廠商在「商品」頁編輯商品時選擇。刪除廠商後，原本的商品會變成未指定廠商。</p>${errorBox}`,
   footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>'});
 }
 function saveSuppliers(form){
  const e=form.elements,next=[];
  S.suppliers.forEach((s,i)=>{
   if(e['sup-del-'+i].checked){for(const p of S.products)if(p.supplierId===s.id)p.supplierId='';if(ui.stock.supplier===s.id)ui.stock.supplier='all';return;}
   next.push({...s,name:e['sup-name-'+i].value.trim(),phone:e['sup-phone-'+i].value.trim()});
  });
  if(next.some(s=>!s.name))return formError(form,'廠商名稱不能空白');
  const added=e.new.value.trim();if(added)next.push({id:uid(),name:added,phone:e.newPhone.value.trim(),note:''});
  if(new Set(next.map(s=>s.name)).size!==next.length)return formError(form,'廠商名稱不能重複');
  S.suppliers=next;save('suppliers','products');closeDialog();toast('廠商已更新');render();
  return true;
 }

 // ---------- 會員 ----------
 const matchMember=(m,q)=>{const key=q.normalize('NFKC').trim().toLowerCase();return !key||m.name.toLowerCase().includes(key)||String(m.phone||'').includes(key)||String(m.code||'').toLowerCase().includes(key);};
 function renderMembers(){
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>會員</h2><div class="pos-page-tools"><button type="button" class="pos-primary" data-act="member-new">＋ 新增會員</button><button type="button" data-act="export-members">匯出 CSV</button></div></div>
<div class="pos-filters"><input type="search" data-input="members-q" autocomplete="off" placeholder="搜尋姓名、電話或卡號" aria-label="搜尋會員" value="${h(ui.members.q)}"></div><div id="pos-list"></div>
<p class="pos-hint">集點規則：${S.settings.earnPer>0?`每消費 ${money(S.settings.earnPer)} 得 1 點，1 點可折 ${money(S.settings.pointValue)}`:'目前沒有開啟集點'}。會員等級：${P.cleanLevels(S.settings.levels).map(l=>`${h(l.name)}（累計 ${money(l.min)} 起${l.pct?'，'+h(P.discountLabel({type:'pct',value:l.pct})):''}）`).join('、')||'沒有設定'}。可在「設定」調整。</p></div>`;
  renderMemberList();
 }
 function renderMemberList(){
  const box=$('#pos-list');if(!box)return;
  const list=S.members.filter(m=>matchMember(m,ui.members.q));
  box.innerHTML=list.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>姓名</th><th>等級</th><th>卡號</th><th>電話</th><th class="num">點數</th><th class="num">累計消費</th><th class="num">來店</th><th>操作</th></tr></thead><tbody>${list.map(m=>`<tr><td><button type="button" class="pos-link" data-act="member-edit" data-id="${h(m.id)}">${h(m.name)}</button></td><td>${(l=>l?`<span class="pos-level">${h(l.name)}</span>`:'—')(levelOf(m))}</td><td class="mono">${h(m.code)||'—'}</td><td class="mono">${h(m.phone)||'—'}</td><td class="num">${m.points}</td><td class="num">${money(m.total||0)}</td><td class="num">${m.visits||0}</td><td class="pos-actions"><button type="button" data-act="member-history" data-id="${h(m.id)}">消費紀錄</button></td></tr>`).join('')}</tbody></table></div>`:empty(S.members.length?'找不到符合的會員':'還沒有會員');
 }
 function openMember(id,fromCart=false){
  const m=id?S.members.find(x=>x.id===id):null;
  openDialog({title:m?'編輯會員':'新增會員',form:'member',body:`<input type="hidden" name="id" value="${h(m?.id||'')}"><input type="hidden" name="pick" value="${fromCart?'1':''}">
<div class="pos-row">${field('姓名','<input name="name" maxlength="30" required autocomplete="off" value="'+h(m?.name||'')+'"'+(m?'':' autofocus')+'>')}${field('電話','<input name="phone" inputmode="tel" maxlength="20" autocomplete="off" value="'+h(m?.phone||'')+'">')}</div>
${field('會員卡號','<input name="code" maxlength="20" autocomplete="off" autocapitalize="characters" value="'+h(m?(m.code||''):nextMemberCode())+'">','用掃描槍掃這個號碼就能帶出會員；可以改成實體會員卡上的號碼')}
<div class="pos-row">${field('點數','<input name="points" inputmode="numeric" autocomplete="off" value="'+(m?m.points:0)+'">','可直接修改來補點或扣點')}${field('備註','<input name="note" maxlength="60" autocomplete="off" value="'+h(m?.note||'')+'">')}</div>${errorBox}`,
   footer:`${m?`<button type="button" class="pos-danger pos-left" data-act="member-delete" data-id="${h(m.id)}">刪除</button>`:''}<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>`});
 }
 function nextMemberCode(){
  for(let n=S.members.length+1;;n++){const code='M'+String(n).padStart(4,'0');if(!S.members.some(m=>P.normalizeCode(m.code)===code))return code;}
 }
 function saveMember(form){
  const e=form.elements,id=e.id.value,name=e.name.value.trim(),phone=e.phone.value.normalize('NFKC').replace(/[\s-]/g,''),points=P.parseAmount(e.points.value),code=P.normalizeCode(e.code.value);
  if(!name)return formError(form,'請填姓名');
  if(Number.isNaN(points))return formError(form,'點數請填 0 以上的整數');
  if(phone&&S.members.some(m=>m.id!==id&&m.phone===phone))return formError(form,'這個電話已經有會員在用');
  if(code&&S.members.some(m=>m.id!==id&&P.normalizeCode(m.code)===code))return formError(form,'這個會員卡號已經有人在用');
  if(code&&P.findByCode(S.products,code))return formError(form,'這個號碼和商品條碼重複，請換一個');
  let m=S.members.find(x=>x.id===id);
  if(m)Object.assign(m,{name,phone,code,points,note:e.note.value.trim()});
  else{m={id:uid(),name,phone,code,points,total:0,visits:0,note:e.note.value.trim(),createdAt:Date.now()};S.members.push(m);}
  save('members');
  if(e.pick.value){cart.memberId=m.id;cart.pointsUse=0;saveCart();}
  closeDialog();toast('會員已儲存');render();
  return true;
 }
 function openMemberHistory(id){
  const m=S.members.find(x=>x.id===id);if(!m)return;
  const list=S.orders.filter(o=>o.memberId===id).reverse();
  openDialog({title:m.name+' 的消費紀錄',size:'wide',body:`<div class="pos-meta">${(l=>l?`<span class="pos-level">${h(l.name)}</span>`:'')(levelOf(m))}${m.code?`<span>卡號 ${h(m.code)}</span>`:''}<span>點數 ${m.points}</span><span>累計消費 ${money(m.total||0)}</span><span>來店 ${m.visits||0} 次</span></div>${list.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>單號</th><th>時間</th><th class="num">金額</th><th class="num">得點</th><th>狀態</th></tr></thead><tbody>${list.slice(0,100).map(o=>`<tr><td><button type="button" class="pos-link" data-act="order" data-id="${h(o.id)}">${h(o.id)}</button></td><td>${P.formatTime(o.t)}</td><td class="num">${money(P.orderNet(o))}</td><td class="num">${o.pointsEarnedNow??o.pointsEarned}</td><td>${statusTag(o)}</td></tr>`).join('')}</tbody></table></div>`:empty('還沒有消費紀錄')}`,footer:'<button type="button" class="pos-primary" data-act="close-dialog">關閉</button>'});
 }
 function openPickMember(){
  openDialog({title:'會員',body:`<label class="pos-search-field pos-member-scan">${icon('search')}<input type="search" id="pos-pick-q" data-input="pick-q" enterkeyhint="search" autocomplete="off" autocapitalize="characters" placeholder="掃描會員卡，或輸入卡號、電話、姓名" aria-label="掃描或搜尋會員" autofocus></label><div id="pos-pick-list" class="pos-pick-list"></div>`,footer:'<button type="button" data-act="close-dialog">取消</button><button type="button" class="pos-primary" data-act="member-new-pick">＋ 新增會員</button>'});
  renderPickList('');
 }
 function renderPickList(q){
  const box=$('#pos-pick-list');if(!box)return;
  const list=S.members.filter(m=>matchMember(m,q)).slice(0,30);
  box.innerHTML=list.length?list.map(m=>{const level=levelOf(m);return `<button type="button" class="pos-pick pos-pick-member" data-act="member-pick" data-id="${h(m.id)}"><span class="pos-member-avatar" aria-hidden="true">${h(initial(m.name))}</span><span class="pos-pick-text"><b>${h(m.name)}${level?`<span class="pos-level">${h(level.name)}</span>`:''}</b><span>${m.code?h(m.code)+'・':''}${h(m.phone)||'沒有電話'}・${m.points} 點</span></span></button>`;}).join(''):empty('找不到會員，可以按右下角新增');
 }

 // ---------- 優惠活動 ----------
 const PROMO_TYPES=[['bogo','買一送一'],['sale','限時折扣'],['bundle','禮包組合']];
 const promoTypeName=type=>(PROMO_TYPES.find(t=>t[0]===type)||['',''])[1];
 const foldOf=pct=>{const keep=100-pct;return keep%10===0?String(keep/10):String(keep);};
 function promoSummary(p){
  const name=id=>product(id)?.name||'（已刪除的商品）';
  const what=p.type==='bundle'?(p.items||[]).map(i=>name(i.pid)+' ×'+i.qty).join('、')+'・禮包價 '+money(p.price)
   :(p.productIds||[]).map(name).join('、')+(p.type==='sale'?'・'+(p.mode==='price'?'特價 '+money(p.value):foldOf(Number(p.value)||0)+' 折'):'');
  const dates=p.from||p.to?`${p.from?p.from.replace('T',' '):'即日起'} ～ ${p.to?p.to.replace('T',' '):'不限'}`:'不限日期';
  return {what,when:dates+(p.dayFrom&&p.dayTo?`・每天 ${p.dayFrom}–${p.dayTo}`:'')};
 }
 function renderPromos(){
  const time=Date.now();
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>優惠活動</h2><div class="pos-page-tools">${PROMO_TYPES.map(([type,label],i)=>`<button type="button"${i===0?' class="pos-primary"':''} data-act="promo-new" data-type="${type}">＋ ${label}</button>`).join('')}</div></div>
<p class="pos-hint">買一送一：同一商品每 2 件送 1 件，結帳時會跳出提醒。限時折扣：在設定的日期與時段內自動打折或特價。禮包組合：幾樣商品組成一個禮包，用禮包價賣，結帳時從每樣商品扣庫存。同一商品同時有買一送一和限時折扣時，只套用買一送一。</p>
${S.promos.length?`<div class="pos-promo-list">${S.promos.map(p=>{const state=P.promoState(p,time),s=promoSummary(p);return `<article class="pos-promo pos-promo-${h(p.type)}"><div class="pos-promo-head"><span class="pos-promo-type">${icon(p.type==='bundle'?'gift':p.type==='bogo'?'plus':'percent')}${h(promoTypeName(p.type))}</span><span class="pos-tag pos-promo-state is-${state}">${h(P.PROMO_STATE[state])}</span></div><h3>${h(p.name||'未命名的活動')}</h3><p class="pos-promo-what">${h(s.what)}</p><p class="pos-promo-when">${h(s.when)}</p><div class="pos-promo-actions"><button type="button" class="pos-soft" data-act="promo-edit" data-id="${h(p.id)}">編輯</button><button type="button" class="pos-soft" data-act="promo-toggle" data-id="${h(p.id)}">${p.active===false?'啟用':'停用'}</button></div></article>`;}).join('')}</div>`:empty('還沒有優惠活動，按右上角新增')}</div>`;
 }
 function openPromo(id,type){
  const p=id?S.promos.find(x=>x.id===id):{id:'',type,name:'',active:true,from:'',to:'',dayFrom:'',dayTo:'',productIds:[],items:[],mode:'pct',value:10,price:''};
  if(!p)return;
  ui.promoQ='';
  const picked=new Set(p.productIds||[]),qty=new Map((p.items||[]).map(i=>[i.pid,i.qty]));
  const rows=S.products.map(x=>p.type==='bundle'
   ?`<div class="pos-pick-row" data-name="${h(x.name.toLowerCase())}"><span class="pos-pick-row-name"><b>${h(x.name)}</b><small>${money(x.price)}</small></span><div class="pos-qty"><button type="button" data-act="promo-qty" data-d="-1" aria-label="${h(x.name)} 減一">−</button><input class="pos-promo-qty" name="qty-${h(x.id)}" data-price="${x.price}" data-input="promo-bundle" inputmode="numeric" value="${qty.get(x.id)||0}" aria-label="${h(x.name)} 數量"><button type="button" data-act="promo-qty" data-d="1" aria-label="${h(x.name)} 加一">＋</button></div></div>`
   :`<label class="pos-pick-row" data-name="${h(x.name.toLowerCase())}"><span class="pos-pick-row-name"><b>${h(x.name)}</b><small>${money(x.price)}・${h(catName(x.categoryId)||'未分類')}</small></span><input type="checkbox" name="pid" value="${h(x.id)}"${picked.has(x.id)?' checked':''}></label>`).join('');
  const typeFields=p.type==='sale'
   ?`<div class="pos-row">${field('折扣方式','<select name="mode"><option value="pct"'+(p.mode!=='price'?' selected':'')+'>打折（幾折）</option><option value="price"'+(p.mode==='price'?' selected':'')+'>特價（固定價格）</option></select>')}${field('折數或特價','<input name="value" inputmode="decimal" autocomplete="off" value="'+h(p.mode==='price'?p.value:foldOf(Number(p.value)||0))+'">','打折填 8 是 8 折、85 是 85 折；特價填價格')}</div>`
   :p.type==='bundle'?`<div class="pos-row">${field('禮包價','<input name="price" inputmode="numeric" autocomplete="off" value="'+h(p.price)+'">')}<p class="pos-bundle-sum" id="pos-bundle-sum"></p></div>`:'';
  openDialog({title:(id?'編輯':'新增')+promoTypeName(p.type),form:'promo',size:'wide',body:`<input type="hidden" name="id" value="${h(p.id)}"><input type="hidden" name="type" value="${h(p.type)}">
${field('活動名稱','<input name="name" maxlength="30" autocomplete="off" value="'+h(p.name)+'" placeholder="'+(p.type==='bundle'?'例如 中秋送禮組':p.type==='bogo'?'例如 咖啡買一送一':'例如 晚間麵包 8 折')+'"'+(id?'':' autofocus')+'>')}
${typeFields}
<fieldset class="pos-fieldset"><legend>${p.type==='bundle'?'禮包內容（填每樣商品的數量）':'參加的商品'}</legend><input type="search" data-input="promo-q" autocomplete="off" placeholder="搜尋商品" aria-label="搜尋商品"><div class="pos-pick-rows">${rows||'<p class="pos-hint">還沒有商品</p>'}</div></fieldset>
<fieldset class="pos-fieldset"><legend>活動期間（都可以留空）</legend><div class="pos-row">${field('開始','<input type="datetime-local" name="from" value="'+h(p.from)+'">')}${field('結束','<input type="datetime-local" name="to" value="'+h(p.to)+'">')}</div><div class="pos-row">${field('每天從','<input type="time" name="dayFrom" value="'+h(p.dayFrom)+'">')}${field('每天到','<input type="time" name="dayTo" value="'+h(p.dayTo)+'">','例如下午茶 14:00 到 17:00；可以跨午夜')}</div></fieldset>
<label class="pos-check"><input type="checkbox" name="active" ${p.active!==false?'checked':''}>啟用這個活動</label>${errorBox}`,
   footer:`${id?`<button type="button" class="pos-danger pos-left" data-act="promo-delete" data-id="${h(id)}">刪除</button>`:''}<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">儲存</button>`});
  updateBundleSum();
 }
 function updateBundleSum(){
  const box=$('#pos-bundle-sum');if(!box)return;
  let value=0,count=0;
  for(const input of $$('.pos-promo-qty',dialog)){const q=P.parseAmount(input.value)||0;value+=q*Number(input.dataset.price);count+=q;}
  box.textContent=count?`共 ${count} 件，原價合計 ${money(value)}`:'還沒有選商品';
 }
 function savePromo(form){
  const e=form.elements,type=e.type.value,id=e.id.value,base={type,name:e.name.value.trim(),active:e.active.checked,from:e.from.value,to:e.to.value,dayFrom:e.dayFrom.value,dayTo:e.dayTo.value};
  if(base.from&&base.to&&P.parseLocal(base.from,false)>P.parseLocal(base.to,true))return formError(form,'結束時間要在開始時間之後');
  if(!!base.dayFrom!==!!base.dayTo)return formError(form,'每天的時段請填開始和結束，或兩個都留空');
  let promo;
  if(type==='bundle'){
   const items=S.products.map(x=>({pid:x.id,qty:P.parseAmount(e['qty-'+x.id]?.value||'0')})).filter(i=>i.qty>0);
   if(items.some(i=>Number.isNaN(i.qty)))return formError(form,'數量請填整數');
   if(!items.length)return formError(form,'請至少放一樣商品到禮包裡');
   const price=P.parseAmount(e.price.value);
   if(Number.isNaN(price))return formError(form,'請填禮包價');
   promo={...base,name:base.name||'禮包',items,price};
  }else{
   const productIds=$$('input[name=pid]:checked',form).map(input=>input.value);
   if(!productIds.length)return formError(form,'請至少選一樣商品');
   promo={...base,productIds};
   if(type==='sale'){
    const mode=e.mode.value,value=mode==='price'?P.parseAmount(e.value.value):P.foldToPct(e.value.value);
    if(Number.isNaN(value))return formError(form,mode==='price'?'特價請填數字':'折數請填 1 到 99，例如 8 或 85');
    Object.assign(promo,{mode,value,name:base.name||(mode==='price'?'特價 '+money(value):'限時 '+foldOf(value)+' 折')});
   }else promo.name=base.name||'買一送一';
  }
  const at=S.promos.findIndex(x=>x.id===id);
  if(at>=0)S.promos[at]={...S.promos[at],...promo};else S.promos.push({id:uid(),...promo});
  save('promos');closeDialog();toast('優惠活動已儲存');render();
  return true;
 }

 // ---------- 交班 ----------
 function renderShift(){
  const shift=currentShift(),past=S.shifts.filter(s=>s.closedAt&&here(s)).slice(-20).reverse();
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
   body=`<section class="pos-card pos-card-narrow"><h3>開班</h3><p class="pos-hint">開班後，這一班的銷售、退款與現金收支會分開統計，交班時可以對帳。沒有開班也能結帳，只是不會算進任何一班。</p><form data-form="shift-open" novalidate><div class="pos-row">${field('收銀員','<select name="cashier">'+S.settings.cashiers.map(c=>`<option${c===whoName()?' selected':''}>${h(c)}</option>`).join('')+'</select>')}${field('開班零用金','<input name="opening" inputmode="numeric" autocomplete="off" value="0">','抽屜裡準備找零的現金')}</div>${errorBox}<div class="pos-form-actions"><button type="submit" class="pos-primary">開班</button></div></form></section>`;
  }
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>交班${multiStore()?`<small class="pos-head-note">${h(curStore().name)}</small>`:''}</h2></div>${body}
<h3 class="pos-subhead">過去的班別</h3>${past.length?`<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>開班</th><th>交班</th><th>收銀員</th><th class="num">淨額</th><th class="num">應有現金</th><th class="num">實點</th><th class="num">差額</th><th>操作</th></tr></thead><tbody>${past.map(sh=>{const s=sh.summary||P.shiftSummary(sh,S.orders);return `<tr><td>${P.formatTime(sh.openedAt).slice(5)}</td><td>${P.formatTime(sh.closedAt).slice(5)}</td><td>${h(sh.cashier)}</td><td class="num">${money(s.net)}</td><td class="num">${money(s.expectedCash)}</td><td class="num">${money(s.countedCash)}</td><td class="num">${s.difference?`<span class="pos-tag pos-tag-partial">${s.difference>0?'+':''}${money(s.difference)}</span>`:money(0)}</td><td class="pos-actions"><button type="button" data-act="print-shift" data-id="${h(sh.id)}">列印</button></td></tr>`;}).join('')}</tbody></table></div>`:empty('還沒有交班紀錄')}</div>`;
 }

 // ---------- 日結 ----------
 const closeOf=day=>S.closes.find(c=>c.day===day&&here(c))||null;
 const signed=amount=>(amount>0?'+':amount<0?'−':'')+money(Math.abs(amount));
 function renderClose(){
  const day=ui.close.day,d=dayOf(day),done=closeOf(day),open=currentShift(),changed=done&&P.dayChanged(done.summary,d);
  const past=S.closes.filter(here).sort((a,b)=>b.day.localeCompare(a.day)).slice(0,31);
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>日結${multiStore()?`<small class="pos-head-note">${h(curStore().name)}</small>`:''}</h2><div class="pos-page-tools"><button type="button" class="pos-primary" data-act="close-report" data-day="${day}">查看這一天的報表</button><button type="button" data-act="export-close-day" data-day="${day}">下載這一天的報表</button><button type="button" data-act="print-close" data-day="${day}">列印</button><button type="button" data-act="export-closes" ${S.closes.length?'':'disabled'}>匯出全部日結紀錄</button></div></div>
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
  const done=closeOf(day),live=dayOf(day),fresh=!done||P.dayChanged(done.summary,live);
  return {day,closedAt:done?.closedAt||0,cashier:done?.cashier||'',countedCash:done?done.countedCash:null,note:done?.note||'',summary:done&&!fresh?done.summary:live,done:!!done,stale:!!done&&fresh};
 }
 function openDayReport(day){
  const r=closeRecord(day),d=r.summary,rows=P.methodBreakdown(d,S.settings.methods),max=Math.max(1,...rows.map(m=>Math.abs(m.net)));
  const diff=r.countedCash==null?null:r.countedCash-d.expectedCash;
  openDialog({title:'日結報表 '+day,size:'wide',body:`<div class="pos-meta"><span>${h(curStore().name)}</span>${r.done?`<span>日結時間 ${P.formatTime(r.closedAt)}</span><span>經手人 ${h(r.cashier)}</span>`:'<span class="pos-tag pos-tag-partial">尚未日結</span>'}${d.firstOrder?`<span>單號 ${h(d.firstOrder.slice(9))}–${h(d.lastOrder.slice(9))}</span>`:''}</div>
${r.stale?'<p class="pos-banner pos-banner-warn">這一天日結之後又有結帳或退款，這裡顯示的是最新數字。</p>':''}
<div class="pos-tiles"><div class="pos-tile pos-tile-strong"><span>今日淨銷售額</span><b>${money(d.net)}</b></div><div class="pos-tile"><span>訂單數</span><b>${d.orders}</b></div><div class="pos-tile"><span>退款</span><b>${money(d.refunds)}</b></div><div class="pos-tile"><span>營業稅</span><b>${money(d.netTax)}</b></div>${d.giftQty?`<div class="pos-tile"><span>贈品</span><b>${d.giftQty} 件</b><small>成本 ${money(d.giftCost)}</small></div>`:''}</div>
<section class="pos-card"><h3>各付款方式今日金額</h3><div class="pos-bars pos-methods">${rows.map(m=>`<div class="pos-bar-row"><span>${h(m.name)}<small>${m.count} 筆${m.refunds?`・已扣退款 ${money(m.refunds)}`:''}</small></span><div class="pos-bar-track"><i style="width:${Math.max(0,m.net)/max*100}%"></i></div><b>${money(m.net)}</b></div>`).join('')}<div class="pos-bar-row pos-bar-total"><span>合計</span><span></span><b>${money(d.net)}</b></div></div></section>
<section class="pos-card"><h3>現金對帳</h3><dl class="pos-totals pos-totals-plain"><div><dt>開班零用金</dt><dd>${money(d.openingCash)}</dd></div><div><dt>現金銷售</dt><dd>${money(d.cashSales)}</dd></div><div><dt>現金退款</dt><dd>−${money(d.cashRefunds)}</dd></div><div><dt>現金存入／取出</dt><dd>${money(d.cashIn)}／−${money(d.cashOut)}</dd></div><div class="pos-total"><dt>應有現金</dt><dd>${money(d.expectedCash)}</dd></div>${diff==null?'<div><dt>實點現金</dt><dd>沒有點現金</dd></div>':`<div><dt>實點現金</dt><dd>${money(r.countedCash)}</dd></div><div><dt>差額</dt><dd>${diff===0?'金額相符':signed(diff)}</dd></div>`}</dl>${r.note?`<p class="pos-note">備註：${h(r.note)}</p>`:''}</section>`,
   footer:`<button type="button" data-act="export-close-day" data-day="${day}">下載 CSV</button><button type="button" data-act="print-close" data-day="${day}">列印報表</button><button type="button" class="pos-primary" data-act="close-dialog" autofocus>關閉</button>`});
 }
 function dayCloseHtml(day){
  const r=closeRecord(day),d=r.summary,counted=r.countedCash,done=r.done?r:null;
  return `<article class="pos-receipt">${receiptHead(done?'日結表':'日結表（尚未日結）')}
${receiptRow('營業日',day)}${done?receiptRow('日結時間',P.formatTime(done.closedAt))+receiptRow('經手人',h(done.cashier)):receiptRow('列印時間',P.formatTime(Date.now()))}${d.firstOrder?receiptRow('單號',h(d.firstOrder.slice(9))+'–'+h(d.lastOrder.slice(9))):''}
<hr>${receiptRow('訂單數',d.orders+' 筆')}${receiptRow('銷售件數',d.items+' 件')}${receiptRow('折扣與點數',money(d.discount))}${receiptRow('銷售金額',money(d.sales))}${receiptRow('退款',`−${money(d.refunds)}（${d.refundCount} 筆）`)}${receiptRow('淨銷售額',money(d.net),'r-total')}${receiptRow('營業稅',money(d.netTax))}${d.giftQty?receiptRow('贈品',d.giftQty+' 件・成本 '+money(d.giftCost)):''}
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
  const [from,to]=rangeDates(ui.reports.range,ui.reports),r=P.report(scoped(S.orders),from,to),single=from===to;
  const chartRows=single?r.hours:r.days,hasSales=r.orders>0||r.refunds>0;
  const maxMethod=Math.max(1,...r.methods.map(m=>Math.abs(m.net)));
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>報表</h2><div class="pos-page-tools"><button type="button" data-act="export-report">匯出商品銷售 CSV</button></div></div>
<div class="pos-filters">${scopeChips()}${rangeChips(ui.reports.range,'reports-range')}<div class="pos-dates"><input type="date" aria-label="開始日期" data-change="reports-from" value="${from}" max="${today()}"><span>到</span><input type="date" aria-label="結束日期" data-change="reports-to" value="${to}" max="${today()}"></div></div>
<div class="pos-tiles"><div class="pos-tile pos-tile-strong"><span>淨銷售額</span><b>${money(r.net)}</b></div><div class="pos-tile"><span>訂單數</span><b>${r.orders}</b></div><div class="pos-tile"><span>客單價</span><b>${money(r.average)}</b></div><div class="pos-tile"><span>毛利</span><b>${money(r.profit)}</b></div><div class="pos-tile"><span>退款</span><b>${money(r.refunds)}</b></div><div class="pos-tile"><span>營業稅</span><b>${money(r.netTax)}</b></div>${r.giftQty?`<div class="pos-tile"><span>贈品</span><b>${r.giftQty} 件</b><small>成本 ${money(r.giftCost)}</small></div>`:''}</div>
${hasSales?`<section class="pos-card"><h3>${single?'各時段銷售金額':'每日銷售金額'}</h3>${barChart(chartRows,single?row=>row.hour+'時':row=>row.day.slice(5).replace('-','/'),single?row=>`${row.hour}:00–${row.hour}:59　${money(row.sales)}　${row.orders} 筆`:row=>`${row.day}　${money(row.sales)}　${row.orders} 筆`)}
${single?'':`<details class="pos-more-fields"><summary>用表格看每日數字</summary><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>日期</th><th class="num">訂單</th><th class="num">銷售</th><th class="num">退款</th></tr></thead><tbody>${r.days.map(d=>`<tr><td>${d.day}</td><td class="num">${d.orders}</td><td class="num">${money(d.sales)}</td><td class="num">${money(d.refunds)}</td></tr>`).join('')}</tbody></table></div></details>`}</section>
<div class="pos-columns"><section class="pos-card"><h3>收款方式</h3><div class="pos-bars">${r.methods.map(m=>`<div class="pos-bar-row"><span>${h(m.name)}</span><div class="pos-bar-track"><i style="width:${Math.max(0,m.net)/maxMethod*100}%"></i></div><b>${money(m.net)}</b></div>`).join('')}</div></section>
<section class="pos-card"><h3>分類銷售</h3><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>分類</th><th class="num">數量</th><th class="num">金額</th></tr></thead><tbody>${r.categories.map(c=>`<tr><td>${h(c.name)}</td><td class="num">${c.qty}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}</tbody></table></div></section></div>
<section class="pos-card"><h3>商品銷售排行</h3><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th class="num">#</th><th>品名</th><th>分類</th><th class="num">數量</th><th class="num">金額</th><th class="num">成本</th></tr></thead><tbody>${r.products.slice(0,50).map((p,i)=>`<tr><td class="num">${i+1}</td><td>${h(p.name)}</td><td>${h(p.cat)||'—'}</td><td class="num">${p.qty}</td><td class="num">${money(p.amount)}</td><td class="num">${money(p.cost)}</td></tr>`).join('')}</tbody></table></div></section>`:empty('這段期間沒有銷售紀錄')}
<p class="pos-hint">銷售算在結帳當天，退款算在退款當天。毛利＝淨銷售額（不含營業稅）－商品成本，沒有填成本的商品會以 0 計算。</p></div>`;
 }

 // ---------- 設定 ----------
 const SET_TABS=[['store','門市'],['checkout','收銀'],['payments','付款方式'],['staff','員工與權限'],['receipt','明細列印'],['tax','金額與稅'],['members','會員'],['stock','庫存'],['look','外觀'],['data','資料備份'],['about','關於']];
 const check=(name,label,on,hint='')=>`<label class="pos-check"><input type="checkbox" name="${name}" ${on?'checked':''}><span>${label}${hint?`<small>${hint}</small>`:''}</span></label>`;
 const options2=(list,value)=>list.map(([id,label])=>`<option value="${h(id)}"${String(value)===String(id)?' selected':''}>${h(label)}</option>`).join('');
 const settingsForm=(tab,title,hint,body,extra='')=>`<form class="pos-card pos-settings" data-form="settings" novalidate><input type="hidden" name="tab" value="${tab}"><h3>${title}</h3>${hint?`<p class="pos-hint">${hint}</p>`:''}${body}${errorBox}<div class="pos-form-actions">${extra}<button type="submit" class="pos-primary">儲存</button></div></form>`;
 const roleOptions=role=>options2([['manager','店長'],['cashier','收銀員']],role);
 const SETTINGS={
  store:()=>settingsForm('store','門市資料','每家門市的庫存、交班和日結分開記錄；名稱、地址、電話會印在那家門市的交易明細上方。有兩家以上門市時，打開收銀系統會先選門市。',
   `<div class="pos-store-rows">${S.stores.map((st,i)=>`<div class="pos-store-row"><div class="pos-row">${field('門市名稱'+(st.id===cur()?'<em class="pos-tag pos-tag-paid">目前</em>':''),'<input name="store-name-'+i+'" maxlength="30" autocomplete="off" value="'+h(st.name)+'">')}${field('電話','<input name="store-phone-'+i+'" maxlength="20" autocomplete="off" value="'+h(st.phone)+'">')}</div><div class="pos-row">${field('地址','<input name="store-address-'+i+'" maxlength="60" autocomplete="off" value="'+h(st.address)+'">')}${S.stores.length>1&&st.id!==cur()?'<label class="pos-check"><input type="checkbox" name="store-del-'+i+'">刪除這家門市</label>':''}</div></div>`).join('')}</div>${field('新增門市','<input name="store-new" maxlength="30" autocomplete="off" placeholder="例如 台中門市">','新門市的庫存從 0 開始，可以到「庫存」進貨，或從其他門市調撥。刪除門市會一併刪掉那家門市的庫存數量；訂單、交班與日結紀錄會保留。')}${field('公司統一編號','<input name="storeTaxId" inputmode="numeric" maxlength="8" autocomplete="off" value="'+h(S.settings.storeTaxId)+'">','各門市共用，會印在明細上')}`),
  checkout:()=>{const s=S.settings;return settingsForm('checkout','收銀','收銀畫面與結帳時的小設定。',
   `${check('sound','提示音',s.sound,'加入商品時嗶一聲，錯誤時低音提醒')}${check('quickCash','現金快速鍵',s.quickCash!==false,'結帳時顯示「剛好」、100、500、1000 等按鈕')}${check('promoReminder','買一送一提醒',s.promoReminder!==false,'這張單有買一送一時，結帳前先跳出提醒')}<div class="pos-row">${field('閒置自動鎖定','<select name="lockAfter">'+options2([[0,'不自動鎖定'],[5,'5 分鐘'],[10,'10 分鐘'],[15,'15 分鐘'],[30,'30 分鐘'],[60,'1 小時']],s.lockAfter||0)+'</select>','一段時間沒有操作就回到登入畫面，重新選收銀員；有設 PIN 的要輸入 PIN')}</div>`);},
  payments:()=>settingsForm('payments','付款方式','現金是唯一可以找零的方式。停用的方式不會出現在結帳畫面，但舊訂單和報表照樣看得到。這裡只是記錄客人用什麼付，不會連接刷卡機或支付平台。',
   `<div class="pos-method-rows">${S.settings.methods.map((m,i,list)=>`<div class="pos-method-row${m.off?' is-off':''}"><span class="pos-method-icon">${methodIcon(m)}</span><input name="m-name-${i}" maxlength="20" autocomplete="off" value="${h(m.name)}" aria-label="付款方式名稱">${m.cash?'<span class="pos-tag pos-tag-paid">可以找零</span>':`<label class="pos-check"><input type="checkbox" name="m-on-${i}" ${m.off?'':'checked'}>啟用</label>`}<span class="pos-method-move"><button type="button" class="pos-icon" data-act="method-move" data-i="${i}" data-d="-1" aria-label="${h(m.name)} 往前移" ${i?'':'disabled'}>↑</button><button type="button" class="pos-icon" data-act="method-move" data-i="${i}" data-d="1" aria-label="${h(m.name)} 往後移" ${i<list.length-1?'':'disabled'}>↓</button></span>${m.cash?'':`<label class="pos-check"><input type="checkbox" name="m-del-${i}">刪除</label>`}</div>`).join('')}</div>${field('新增付款方式','<input name="m-new" maxlength="20" autocomplete="off" placeholder="例如 LINE Pay、街口支付、禮券">')}`),
  staff:()=>{const s=S.settings,perms=P.cleanPerms(s.cashierPerms);return settingsForm('staff','員工與權限','店長什麼都能做。開啟權限控管後，收銀員只能做下面勾選的事，其他要店長輸入 PIN 授權；打開收銀系統時也要先登入。',
   `${check('permsOn','開啟權限控管',s.permsOn,'至少要有一位店長設定 PIN')}<div class="pos-staff-rows">${staffList().map((p,i,list)=>`<div class="pos-staff-row">${field('名稱','<input name="st-name-'+i+'" maxlength="20" autocomplete="off" value="'+h(p.name)+'">')}${field('角色','<select name="st-role-'+i+'">'+roleOptions(p.role)+'</select>')}${field(p.pin?'PIN（留空不變）':'PIN（選填）','<input name="st-pin-'+i+'" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="'+(p.pin?'已設定':'4–6 位數字')+'">')}<div class="pos-staff-checks">${p.pin?`<label class="pos-check"><input type="checkbox" name="st-nopin-${i}">清除 PIN</label>`:''}${list.length>1?`<label class="pos-check"><input type="checkbox" name="st-del-${i}">刪除</label>`:''}</div></div>`).join('')}</div>
<div class="pos-staff-row pos-staff-new">${field('新增員工','<input name="st-new" maxlength="20" autocomplete="off" placeholder="例如 小美">')}${field('角色','<select name="st-new-role">'+roleOptions('cashier')+'</select>')}${field('PIN','<input name="st-new-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="選填">')}</div>
<h4 class="pos-set-sub">收銀員可以做的事</h4><div class="pos-perm-grid">${P.PERMS.map(([key,label])=>check('perm-'+key,label,perms[key])).join('')}</div>
<p class="pos-hint">PIN 只存在這台${desktop?'電腦':'裝置'}，而且只存雜湊值。它是用來避免誤按或隨手操作，不是銀行等級的保護；忘記 PIN 時，請其他店長在這裡清除再重設。</p>`);},
  receipt:()=>{const s=S.settings;return settingsForm('receipt','明細列印','列印的是交易明細，不是統一發票。改完先按「儲存」，再按「列印測試明細」看看效果。',
   `<div class="pos-row">${field('明細紙寬','<select name="receiptWidth">'+options2([[58,'58 mm 熱感紙'],[80,'80 mm 熱感紙'],[210,'A4／一般印表機']],s.receiptWidth)+'</select>')}</div>${field('門市資料下方多印一行（選填）','<input name="receiptHeader" maxlength="60" autocomplete="off" value="'+h(s.receiptHeader)+'" placeholder="例如 營業時間 08:00–22:00">','可以放營業時間、LINE 官方帳號或退換貨說明')}${field('明細結尾文字','<input name="receiptFooter" maxlength="40" autocomplete="off" value="'+h(s.receiptFooter)+'">')}
${check('autoPrint','結帳後預設列印',s.autoPrint,'結帳畫面的「列印交易明細」預設打勾')}${check('receiptShowPoints','印出會員點數餘額',s.receiptShowPoints!==false)}${check('receiptShowSku','每個商品下方印出條碼',s.receiptShowSku)}`,'<button type="button" data-act="test-print">列印測試明細</button>');},
  tax:()=>{const s=S.settings;return settingsForm('tax','金額與稅','金額一律以整數元計算。',
   `<div class="pos-row">${field('幣別符號','<input name="currency" maxlength="4" autocomplete="off" value="'+h(s.currency)+'">')}${field('營業稅','<select name="taxMode">'+options2([['included','售價已含稅'],['added','結帳時外加'],['none','不計稅']],s.taxMode)+'</select>')}${field('稅率 %','<input name="taxRate" inputmode="decimal" autocomplete="off" value="'+h(s.taxRate)+'">')}</div>`);},
  members:()=>{const s=S.settings;return settingsForm('members','會員','集點規則與會員等級。等級依累計消費自動升級；折扣是結帳時整張單再打的折扣，填 0 表示只顯示等級、不打折。名稱留空的列不使用。',
   `<div class="pos-row">${field('每消費多少元得 1 點','<input name="earnPer" inputmode="numeric" autocomplete="off" value="'+h(s.earnPer)+'">','填 0 表示不集點')}${field('1 點可折多少元','<input name="pointValue" inputmode="numeric" autocomplete="off" value="'+h(s.pointValue)+'">')}</div><h4 class="pos-set-sub">會員等級</h4><div class="pos-level-rows">${[0,1,2,3,4].map(i=>{const l=P.cleanLevels(s.levels)[i]||{name:'',min:'',pct:''};return `<div class="pos-row pos-level-row">${field('等級名稱','<input name="level-name-'+i+'" maxlength="12" autocomplete="off" value="'+h(l.name)+'" placeholder="例如 銀卡會員">')}${field('累計消費滿','<input name="level-min-'+i+'" inputmode="numeric" autocomplete="off" value="'+h(l.min)+'">')}${field('整單折扣 %','<input name="level-pct-'+i+'" inputmode="decimal" autocomplete="off" value="'+h(l.pct)+'">','5 是 95 折')}</div>`;}).join('')}</div>`);},
  stock:()=>{const s=S.settings;return settingsForm('stock','庫存','',
   `<div class="pos-row">${field('新商品的安全庫存','<input name="lowStock" inputmode="numeric" autocomplete="off" value="'+h(s.lowStock)+'">','低於等於這個數量會標示低庫存')}</div>${check('blockOversell','庫存不足時不能結帳',s.blockOversell,'關掉時只會提醒，還是可以賣')}${check('hideOut','缺貨商品不顯示在收銀畫面',s.hideOut,'用搜尋或掃條碼也找不到，補貨後自動出現')}`);},
  look:()=>`<section class="pos-card"><h3>外觀</h3><h4 class="pos-set-sub">顏色</h4><div class="pos-chips" role="group" aria-label="顏色">${[['light','淺色'],['dark','深色']].map(([id,label])=>`<button type="button" class="pos-chip" data-act="theme" data-theme="${id}" aria-pressed="${document.documentElement.classList.contains('dark')===(id==='dark')}">${label}</button>`).join('')}</div><h4 class="pos-set-sub">收銀畫面的商品格</h4><div class="pos-chips" role="group" aria-label="商品格大小">${[['sm','小（一次看比較多）'],['md','標準'],['lg','大（好點）']].map(([id,label])=>`<button type="button" class="pos-chip" data-act="tile-size" data-id="${id}" aria-pressed="${(S.settings.tileSize||'md')===id}">${label}</button>`).join('')}</div><p class="pos-hint">外觀只影響這台裝置的畫面，點了馬上套用。</p></section>`,
  data:()=>{const s=S.settings;return `<section class="pos-card"><h3>資料備份與還原</h3><p class="pos-hint">${desktop?'所有資料只存在這台電腦的這個程式裡，和瀏覽器無關。重灌或換電腦前，請先下載備份檔。':'所有資料只存在這台裝置的這個瀏覽器，清除瀏覽資料或換裝置就看不到了。建議定期下載備份檔。'}目前有 ${S.products.length} 項商品、${S.orders.length} 筆訂單、${S.members.length} 位會員。</p><p class="pos-hint">上次備份：${s.lastBackupAt?P.formatTime(s.lastBackupAt):'還沒有備份過'}</p><div class="pos-row">${field('提醒備份','<select data-change="backup-remind">'+options2([[0,'不提醒'],[3,'超過 3 天沒備份'],[7,'超過 7 天沒備份'],[14,'超過 14 天沒備份'],[30,'超過 30 天沒備份']],s.backupRemind)+'</select>','在收銀畫面上方提醒')}</div><div class="pos-form-actions pos-form-actions-left"><button type="button" class="pos-primary" data-act="backup">下載備份檔</button><button type="button" data-act="restore">從備份檔還原</button><input type="file" id="pos-restore-file" accept=".json,application/json" hidden></div></section>
<section class="pos-card pos-card-danger"><h3>清除資料</h3><p class="pos-hint">清除後無法復原，請先下載備份檔。</p><div class="pos-form-actions pos-form-actions-left">${s.demo?'<button type="button" class="pos-danger" data-act="clear-demo">清除示範資料</button>':''}<button type="button" class="pos-danger" data-act="wipe">清除全部資料</button></div></section>`;},
  about:()=>{const version=(navigator.userAgent.match(/SamEggPOS\/([\d.]+)/)||[])[1];return `<section class="pos-card"><h3>關於</h3><dl class="pos-about"><div><dt>版本</dt><dd>${desktop?'Windows 版 '+h(version||''):document.documentElement.classList.contains('pos-app-mode')?'安裝版（App）':'網頁版（試用）'}</dd></div><div><dt>資料存在</dt><dd>${desktop?'這台電腦的 %APPDATA%\\SamEgg POS':'這台裝置的這個瀏覽器'}，不會上傳，也不會和其他裝置同步</dd></div><div><dt>目前資料</dt><dd>${S.stores.length} 家門市、${S.products.length} 項商品、${S.orders.length} 筆訂單、${S.members.length} 位會員、${staffList().length} 位員工</dd></div><div><dt>快捷鍵</dt><dd>F2 搜尋商品、F4 結帳、Esc 關閉對話框${desktop?'、F11 全螢幕':''}</dd></div><div><dt>掃描槍</dt><dd>USB 或藍牙掃描槍在收銀畫面直接掃；掃到會員卡號會帶出會員</dd></div></dl><p class="pos-hint">列印的是交易明細，不是統一發票，也沒有連接財政部電子發票平台。付款方式只是記錄，不會連接刷卡機或支付服務。</p></section>`;}
 };
 function renderSettings(){
  const tab=SETTINGS[ui.setTab]?ui.setTab:'store';
  view.innerHTML=`<div class="pos-page"><div class="pos-page-head"><h2>設定</h2></div><div class="pos-set-layout"><nav class="pos-set-nav" aria-label="設定分類">${SET_TABS.map(([id,name])=>`<button type="button" class="pos-set-tab" data-act="set-tab" data-id="${id}"${id===tab?' aria-current="page"':''}>${name}</button>`).join('')}</nav><div class="pos-set-body" id="pos-set-body">${SETTINGS[tab]()}</div></div></div>`;
 }
 // 付款方式：先把畫面上改到一半的名稱、啟用狀態收進來，再調整順序。
 function readMethods(form){
  return S.settings.methods.map((m,i)=>{const name=form.elements['m-name-'+i]?.value.trim();return {...m,name:name||m.name,...(m.cash?{}:{off:!form.elements['m-on-'+i]?.checked})};});
 }
 const SAVERS={
  store(e,s){
   const taxId=e.storeTaxId.value.normalize('NFKC').trim();
   if(taxId&&!P.validTaxId(taxId))throw Error('公司統一編號格式不正確');
   const stores=[],dropped=[];
   S.stores.forEach((st,i)=>{if(e['store-del-'+i]?.checked&&st.id!==cur()){dropped.push(st.id);return;}stores.push({...st,name:e['store-name-'+i].value.trim().slice(0,30),phone:e['store-phone-'+i].value.trim(),address:e['store-address-'+i].value.trim()});});
   if(stores.some(st=>!st.name))throw Error('門市名稱不能空白');
   const added=e['store-new'].value.trim().slice(0,30);if(added)stores.push({id:uid(),name:added,address:'',phone:''});
   if(new Set(stores.map(st=>st.name)).size!==stores.length)throw Error('門市名稱不能重複');
   S.stores=stores;
   for(const p of S.products)if(p.stocks&&dropped.some(id=>id in p.stocks)){p.stocks={...p.stocks};for(const id of dropped)delete p.stocks[id];}
   if(dropped.includes(ui.stock.store))ui.stock.store='';
   Object.assign(s,{storeTaxId:taxId,storeName:S.stores[0].name,storePhone:S.stores[0].phone,storeAddress:S.stores[0].address});
   return ['stores','products'];
  },
  checkout(e,s){Object.assign(s,{sound:e.sound.checked,quickCash:e.quickCash.checked,promoReminder:e.promoReminder.checked,lockAfter:Number(e.lockAfter.value)||0});return [];},
  payments(e,s){
   const list=readMethods(e.tab.form).filter((m,i)=>m.cash||!e['m-del-'+i]?.checked);
   const added=e['m-new'].value.trim().slice(0,20);if(added)list.push({id:'m:'+uid(),name:added});
   if(new Set(list.map(m=>m.name)).size!==list.length)throw Error('付款方式名稱不能重複');
   s.methods=list;return [];
  },
  staff(e,s){
   const list=[];
   staffList().forEach((p,i)=>{
    if(e['st-del-'+i]?.checked)return;
    const name=e['st-name-'+i].value.trim().slice(0,20),pin=e['st-pin-'+i].value.normalize('NFKC').trim();
    if(!name)throw Error('員工名稱不能空白');
    if(pin&&!P.validPin(pin))throw Error(`「${name}」的 PIN 要 4 到 6 位數字`);
    list.push({name,role:e['st-role-'+i].value,pin:pin?P.hashPin(pin):(e['st-nopin-'+i]?.checked?'':p.pin)});
   });
   const name=e['st-new'].value.trim().slice(0,20),pin=e['st-new-pin'].value.normalize('NFKC').trim();
   if(name){if(pin&&!P.validPin(pin))throw Error(`「${name}」的 PIN 要 4 到 6 位數字`);list.push({name,role:e['st-new-role'].value,pin:pin?P.hashPin(pin):''});}
   if(!list.length)throw Error('至少要有一位員工');
   if(new Set(list.map(p=>p.name)).size!==list.length)throw Error('員工名稱不能重複');
   if(!list.some(p=>p.role==='manager'))throw Error('至少要有一位店長');
   const permsOn=e.permsOn.checked;
   if(permsOn){const problem=P.permsProblem(list);if(problem)throw Error(problem);}
   const staff=P.cleanStaff(list);
   Object.assign(s,{staff,cashiers:staff.map(p=>p.name),permsOn,cashierPerms:Object.fromEntries(P.PERMS.map(([key])=>[key,e['perm-'+key].checked]))});
   if(!s.cashiers.includes(s.cashier))s.cashier=s.cashiers[0];
   if(who&&!staffOf(who))chooseWho(s.cashier);
   return [];
  },
  receipt(e,s){Object.assign(s,{receiptWidth:Number(e.receiptWidth.value),receiptHeader:e.receiptHeader.value.trim(),receiptFooter:e.receiptFooter.value.trim(),autoPrint:e.autoPrint.checked,receiptShowPoints:e.receiptShowPoints.checked,receiptShowSku:e.receiptShowSku.checked});return [];},
  tax(e,s,num){const taxRate=num('taxRate','稅率');if(taxRate>100)throw Error('稅率不能超過 100');Object.assign(s,{currency:e.currency.value.trim(),taxMode:e.taxMode.value,taxRate});return [];},
  members(e,s,num){
   const earnPer=Math.round(num('earnPer','集點金額')),pointValue=Math.round(num('pointValue','點數價值',1)),levels=[];
   for(let i=0;i<5;i++){
    const name=e['level-name-'+i].value.trim();if(!name)continue;
    const min=P.parseAmount(e['level-min-'+i].value||'0'),pct=Number((e['level-pct-'+i].value||'0').normalize('NFKC'));
    if(Number.isNaN(min))throw Error('「'+name+'」的累計消費請填數字');
    if(!Number.isFinite(pct)||pct<0||pct>100)throw Error('「'+name+'」的折扣請填 0 到 100');
    levels.push({name,min,pct});
   }
   if(new Set(levels.map(l=>l.name)).size!==levels.length)throw Error('會員等級名稱不能重複');
   Object.assign(s,{earnPer,pointValue,levels:P.cleanLevels(levels)});return [];
  },
  stock(e,s,num){Object.assign(s,{lowStock:Math.round(num('lowStock','安全庫存')),blockOversell:e.blockOversell.checked,hideOut:e.hideOut.checked});return [];}
 };
 function saveSettings(form){
  const e=form.elements,s=S.settings,tab=e.tab.value,num=(name,label,min=0)=>{const n=Number(e[name].value.normalize('NFKC').trim());if(!Number.isFinite(n)||n<min)throw Error(label+'請填 '+min+' 以上的數字');return n;};
  let keys;
  try{keys=SAVERS[tab](e,s,num);}catch(error){return formError(form,error.message);}
  save('settings',...keys);toast('設定已儲存');render();updateBar();
  return true;
 }
 function backup(){
  const data={app:'samegg-pos',version:1,exportedAt:new Date().toISOString(),kv:Object.fromEntries(KV.map(key=>[key,S[key]])),orders:S.orders,moves:S.moves};
  download('pos-backup-'+today()+'.json',JSON.stringify(data),'application/json');toast('備份檔已下載，請妥善保存');
  S.settings.lastBackupAt=Date.now();save('settings');if(ui.view==='sale'||ui.view==='settings')render();
 }
 async function restore(text){
  let data;try{data=JSON.parse(text);}catch{return toast('這不是有效的備份檔','error');}
  if(data?.app!=='samegg-pos'||!data.kv||!Array.isArray(data.orders)||!Array.isArray(data.kv.products))return toast('這不是門市 POS 的備份檔','error');
  for(const key of KV)S[key]=data.kv[key]??(key==='seq'?null:Array.isArray(S[key])?[]:S[key]);
  S.settings={...P.DEFAULT_SETTINGS,...S.settings};
  normalize();
  S.orders=data.orders.filter(o=>o&&o.id&&Array.isArray(o.lines)).sort((a,b)=>a.t-b.t);S.moves=(Array.isArray(data.moves)?data.moves:[]).filter(m=>m&&m.id);
  await commit([['orders','clear'],['moves','clear'],...S.orders.map(o=>['orders','put',o]),...S.moves.map(m=>['moves','put',m]),...kvOps(...KV)]);
  resetCart();closeDialog();toast('已從備份檔還原');show('sale');
 }
 async function wipe(demoOnly){
  if(demoOnly){S.products=[];S.categories=[];S.members=[];S.suppliers=[];S.settings.demo=false;}
  else{S.products=[];S.categories=[];S.members=[];S.suppliers=[];S.stores=[];S.settings={...P.DEFAULT_SETTINGS,methods:P.DEFAULT_METHODS.map(m=>({...m})),cashiers:['店長']};}
  normalize();
  S.held=[];S.shifts=[];S.closes=[];S.promos=[];S.seq=null;S.orders=[];S.moves=[];
  await commit([['orders','clear'],['moves','clear'],...kvOps(...KV)]);
  resetCart();closeDialog();toast(demoOnly?'示範資料已清除，可以開始建立自己的商品':'全部資料已清除');show(demoOnly?'products':'sale');
 }

 // ---------- 事件 ----------
 const actions={
  'close-dialog':()=>closeDialog(),
  view:el=>show(el.dataset.view),
  cat:el=>{ui.cat=el.dataset.id;for(const chip of $$('#pos-cats .pos-chip'))chip.setAttribute('aria-pressed',chip.dataset.id===ui.cat);renderGrid();},
  add:el=>{const p=product(el.dataset.id);if(p)addProduct(p);},
  'add-bundle':el=>addBundle(el.dataset.id),
  'gift-mode':()=>ui.giftMode?toggleGift():guard('gift',toggleGift),
  'gift-reason':el=>{const form=el.closest('form');form.elements.giftReason.value=el.dataset.reason;form.elements.gift.checked=true;},
  'pay-continue':()=>openPay(true),
  'bogo-add':el=>{const p=product(el.dataset.pid);if(p){const was=ui.giftMode;ui.giftMode=false;addProduct(p);ui.giftMode=was;}openPromoReminder();},
  qty:el=>{const line=cart.lines[el.dataset.i];if(!line)return;line.qty+=Number(el.dataset.d);if(line.qty<=0)cart.lines.splice(el.dataset.i,1);saveCart();renderCart();},
  'to-cart':()=>$('#pos-cart')?.scrollIntoView({behavior:'smooth',block:'start'}),
  'clear-cart':()=>confirmDialog('清空購物車','確定要把購物車裡的商品全部移除嗎？','clear-cart-yes','清空',true),
  'clear-cart-yes':()=>{resetCart();closeDialog();renderCart();},
  'custom-item':()=>openDialog({title:'自訂金額品項',form:'custom',body:`${field('品名','<input name="name" maxlength="40" autocomplete="off" value="自訂品項">')}<div class="pos-row">${field('單價','<input name="price" inputmode="numeric" autocomplete="off" required autofocus>')}${field('數量','<input name="qty" inputmode="numeric" autocomplete="off" value="1">')}</div><p class="pos-hint">沒有建檔的商品可以先用這個方式結帳，不會扣庫存。</p>${errorBox}`,footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">加入購物車</button>'}),
  'edit-line':el=>{
   const i=Number(el.dataset.i),line=cart.lines[i];if(!line)return;
   openDialog({title:line.name,form:'line',body:`<input type="hidden" name="i" value="${i}"><div class="pos-row">${field('數量','<input name="qty" inputmode="numeric" autocomplete="off" value="'+line.qty+'" autofocus>')}${field('單價','<input name="price" inputmode="numeric" autocomplete="off" value="'+line.price+'">','只改這一次，不會改商品售價')}</div>${discountFields(line.discount)}<fieldset class="pos-fieldset"><legend>贈品（0 元銷貨）</legend><label class="pos-check"><input type="checkbox" name="gift" data-change="line-gift" ${line.gift?'checked':''}>這一行當作贈品：金額 0 元，照樣扣庫存</label><p class="pos-line-free" hidden></p>${field('原因','<input name="giftReason" maxlength="20" autocomplete="off" value="'+h(line.giftReason||'')+'" placeholder="例如 門市送禮">')}<div class="pos-chips">${['門市送禮','公關品','試吃','客訴補償'].map(r=>`<button type="button" class="pos-chip" data-act="gift-reason" data-reason="${r}">${r}</button>`).join('')}</div></fieldset>${field('備註（選填）','<input name="note" maxlength="30" autocomplete="off" value="'+h(line.note)+'">')}${errorBox}`,
    footer:`<button type="button" class="pos-danger pos-left" data-act="line-remove" data-i="${i}">移除</button><button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">套用</button>`});
   changes['line-gift']($('[name=gift]',dialog));
  },
  'line-remove':el=>{cart.lines.splice(Number(el.dataset.i),1);saveCart();closeDialog();renderCart();},
  fold:el=>{const form=el.closest('form');form.elements.fold.value=el.dataset.fold;form.elements.off.value='';for(const chip of $$('[data-act=fold]',form))chip.setAttribute('aria-pressed',chip===el);},
  'order-discount':()=>guard('discount',()=>actions['order-discount-open']()),
  'order-discount-open':()=>openDialog({title:'整單折扣',form:'order-discount',body:discountFields(cart.discount)+errorBox,footer:'<button type="button" data-act="close-dialog">取消</button><button type="submit" class="pos-primary">套用</button>'}),
  points:()=>{
   const t=totals(),m=member();if(!m)return;
   openDialog({title:'點數折抵',form:'points',body:`<p class="pos-hint">${h(m.name)} 有 ${m.points} 點，這張單最多可用 ${t.maxPoints} 點（1 點折 ${money(S.settings.pointValue)}）。</p>${field('使用點數','<input name="points" inputmode="numeric" autocomplete="off" value="'+(t.pointsUsed||t.maxPoints)+'" autofocus>')}${errorBox}`,footer:'<button type="button" data-act="points-none">不使用</button><button type="submit" class="pos-primary">套用</button>'});
  },
  'points-none':()=>{cart.pointsUse=0;saveCart();closeDialog();renderCart();},
  'pick-member':()=>openPickMember(),
  'member-pick':el=>{const m=S.members.find(x=>x.id===el.dataset.id);closeDialog();if(m)attachMember(m);},
  'clear-member':()=>{cart.memberId='';cart.pointsUse=0;saveCart();renderCart();},
  'member-new-pick':()=>openMember('',true),
  hold:()=>{
   if(!cart.lines.length)return;
   const t=totals();
   S.held.push({id:uid(),t:Date.now(),storeId:cur(),cart,qty:t.qty,total:t.total,label:member()?.name||''});save('held');resetCart();renderCart();toast('已掛單，按「取單」可以叫回來');
  },
  held:()=>openDialog({title:'取單',body:heldHere().length?`<div class="pos-pick-list">${heldHere().map(item=>`<div class="pos-held"><button type="button" class="pos-pick" data-act="held-take" data-id="${h(item.id)}"><b>${P.formatTime(item.t).slice(11)} 掛單${item.label?'・'+h(item.label):''}</b><span>${item.qty} 件・${money(item.total)}・${h(item.cart.lines.slice(0,3).map(l=>l.name).join('、'))}${item.cart.lines.length>3?'……':''}</span></button><button type="button" class="pos-icon" data-act="held-drop" data-id="${h(item.id)}" aria-label="刪除這筆掛單">✕</button></div>`).join('')}</div>`:empty('目前沒有掛單'),footer:'<button type="button" class="pos-primary" data-act="close-dialog">關閉</button>'}),
  'held-take':el=>{
   if(cart.lines.length)return toast('購物車還有商品，請先結帳或掛單','warn');
   const index=S.held.findIndex(item=>item.id===el.dataset.id);if(index<0)return;
   const saved=S.held.splice(index,1)[0].cart;cart={lines:saved.lines,discount:saved.discount||null,pointsUse:saved.pointsUse||0,memberId:S.members.some(m=>m.id===saved.memberId)?saved.memberId:''};
   save('held');saveCart();closeDialog();renderCart();
  },
  'held-drop':el=>{S.held=S.held.filter(item=>item.id!==el.dataset.id);save('held');actions.held();renderCart();},
  pay:()=>openPay(),
  // 付款方式一鍵切換；分開付款時，同一種方式只會出現在一列。
  'pay-method':el=>{
   const i=Number(el.dataset.i),row=pay.rows[i];if(!row||row.id===el.dataset.id)return;
   const other=pay.rows.findIndex((r,k)=>k!==i&&r.id===el.dataset.id);
   if(other>=0)pay.rows[other].id=row.id;
   row.id=el.dataset.id;pay.active=i;renderPay();
  },
  'pay-add':()=>{
   const s=paySettle(),used=new Set(pay.rows.map(r=>r.id)),next=S.settings.methods.find(m=>!used.has(m.id)&&!m.off)||S.settings.methods[0];
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
  refund:el=>guard('refund',()=>openRefund(el.dataset.id)),
  'refund-all':el=>{for(const input of $$('[data-input=refund-qty]',el.closest('form')))input.value=input.max;updateRefund(el.closest('form'));},
  'orders-range':el=>{ui.orders.range=el.dataset.range;renderOrders();},
  'export-orders':()=>guard('reports',()=>downloadCsv('pos-orders-'+today()+'.csv',P.ordersToRows(ordersInRange().reverse()))),
  'export-lines':()=>guard('reports',()=>downloadCsv('pos-order-lines-'+today()+'.csv',P.orderLinesToRows(ordersInRange().reverse()))),
  'product-new':()=>openProduct(''),
  'product-edit':el=>openProduct(el.dataset.id),
  'product-delete':el=>{const p=product(el.dataset.id);if(p)confirmDialog('刪除商品',`確定刪除「${p.name}」嗎？已經結帳的訂單會保留原本的品名與金額。`,'product-delete-yes','刪除',true);dialog.dataset.target=el.dataset.id;},
  'product-delete-yes':()=>{const id=dialog.dataset.target;S.products=S.products.filter(p=>p.id!==id);cart.lines=cart.lines.filter(l=>l.pid!==id);saveCart();save('products');closeDialog();toast('商品已刪除');render();},
  categories:()=>openCategories(),
  'import-products':()=>$('#pos-import-file').click(),
  'import-apply':()=>applyImport(),
  'export-products':()=>downloadCsv('pos-products-'+today()+'.csv',P.productsToRows(S.products,S.categories,S.suppliers,cur())),
  'stock-filter':el=>{ui.stock.filter=el.dataset.id;for(const chip of $$('[data-act=stock-filter]'))chip.setAttribute('aria-pressed',chip===el);renderStockList();},
  'stock-in':el=>openStock(el.dataset.id,'in'),
  'stock-count':el=>openStock(el.dataset.id,'count'),
  'stock-transfer':el=>openTransfer(el.dataset.id||''),
  'set-tab':el=>{ui.setTab=el.dataset.id;renderSettings();$('#pos-set-body')?.scrollIntoView?.({block:'nearest'});},
  'method-move':el=>{const form=el.closest('form'),list=readMethods(form),i=Number(el.dataset.i),j=i+Number(el.dataset.d);if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];S.settings.methods=list;save('settings');renderSettings();$(`[data-act=method-move][data-i="${j}"][data-d="${el.dataset.d}"]`)?.focus();},
  'tile-size':el=>{S.settings.tileSize=el.dataset.id;save('settings');for(const chip of $$('[data-act=tile-size]'))chip.setAttribute('aria-pressed',chip===el);app.dataset.tiles=el.dataset.id;},
  'test-print':()=>{
   const sample={lines:[{pid:'',name:'測試商品',sku:'4710000000001',cat:'',price:50,cost:0,qty:2,discount:null,note:''}],discount:null,pointsUse:0,memberId:''};
   const total=P.computeCart(sample,S.settings,null,[],Date.now()).total;
   const o=P.buildOrder({id:'TEST',time:Date.now(),cart:sample,settings:S.settings,member:null,payments:[{id:'cash',name:'現金',cash:true,amount:total}],cashier:whoName(),shiftId:'',buyerTaxId:'',carrier:'',note:'這是測試列印，不是真的訂單',promos:[]});
   Object.assign(o,{storeId:cur(),storeName:curStore().name});printOrder(o);
  },
  suppliers:()=>openSuppliers(),
  scope:el=>{ui.scope=el.dataset.id;render();},
  'switch-store':()=>openLogin(true),
  'login-store':el=>pickLogin('store',el),
  'login-cashier':el=>pickLogin('cashier',el),
  'export-stock':()=>{
   const scope=stockScope(),all=scope==='all',list=P.filterStock(S.products,stockFilter(ui.stock.filter==='all'?'':ui.stock.filter,ui.stock.q));
   downloadCsv(`pos-stock-${fileTag(scope)}${today()}.csv`,[['品名','條碼','品牌','類別','進貨廠商',...(all?[...S.stores.map(s=>s.name),'合計']:[multiStore()?storeName(scope)+'庫存':'庫存']),'安全庫存','成本','庫存成本'],...list.map(p=>{const q=stockQty(p,scope);return [p.name,p.sku,p.brand||'',catName(p.categoryId),supplierName(p.supplierId),...(all?S.stores.map(s=>P.stockAt(p,s.id)):[]),q,p.lowStock,p.cost||0,Math.max(0,q)*(p.cost||0)];})]);
  },
  'export-moves':()=>downloadCsv('pos-stock-moves-'+today()+'.csv',[['時間','門市','品名','類型','數量','結存','備註','單號'],...S.moves.map(m=>[P.formatTime(m.t),storeName(sid(m))||m.storeName||'',m.name,MOVE_LABEL[m.type]||m.type,m.qty,m.after,m.note,m.ref])]),
  'promo-new':el=>openPromo('',el.dataset.type),
  'promo-edit':el=>openPromo(el.dataset.id),
  'promo-toggle':el=>{const p=S.promos.find(x=>x.id===el.dataset.id);if(!p)return;p.active=p.active===false;save('promos');toast(p.active?'活動已啟用':'活動已停用');render();},
  'promo-delete':el=>{const p=S.promos.find(x=>x.id===el.dataset.id);if(p)confirmDialog('刪除優惠活動',`確定刪除「${p.name||'未命名的活動'}」嗎？已經結帳的訂單不受影響。`,'promo-delete-yes','刪除',true);dialog.dataset.target=el.dataset.id;},
  'promo-delete-yes':()=>{const id=dialog.dataset.target;S.promos=S.promos.filter(p=>p.id!==id);save('promos');closeDialog();toast('優惠活動已刪除');render();},
  'promo-qty':el=>{const input=el.parentElement.querySelector('input');input.value=Math.max(0,Math.min(99,(P.parseAmount(input.value)||0)+Number(el.dataset.d)));updateBundleSum();},
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
  'export-close-day':el=>{const rows=P.dayReportRows(closeRecord(el.dataset.day),S.settings.methods);rows.splice(1,0,['門市',curStore().name]);downloadCsv('pos-day-report-'+fileTag(cur())+el.dataset.day+'.csv',rows);},
  'export-closes':()=>downloadCsv('pos-day-closes-'+fileTag(cur())+today()+'.csv',P.closesToRows(S.closes.filter(here).sort((x,y)=>x.day.localeCompare(y.day)))),
  'print-shift':el=>{const shift=S.shifts.find(s=>s.id===el.dataset.id);if(shift)printHtml(shiftReportHtml(shift));},
  'reports-range':el=>{ui.reports.range=el.dataset.range;renderReports();},
  'export-report':()=>{const [from,to]=rangeDates(ui.reports.range,ui.reports),r=P.report(scoped(S.orders),from,to);downloadCsv(`pos-report-${fileTag(ui.scope==='all'?'all':cur())}${from}_${to}.csv`,[['品名','條碼','分類','數量','金額','成本'],...r.products.map(p=>[p.name,p.sku,p.cat,p.qty,p.amount,p.cost])]);},
  theme:el=>{
   const dark=el.dataset.theme==='dark';document.documentElement.classList.toggle('dark',dark);
   try{localStorage.setItem('samtss-theme',dark?'dark':'light');}catch{}
   const toggle=document.getElementById('site-theme-toggle');if(toggle)toggle.setAttribute('aria-pressed',dark);
   for(const chip of $$('[data-act=theme]'))chip.setAttribute('aria-pressed',chip===el);
  },
  backup:()=>backup(),
  restore:()=>$('#pos-restore-file').click(),
  'clear-demo':()=>confirmDialog('清除示範資料','會刪除示範商品、分類、會員、廠商，以及目前所有訂單、庫存異動與交班紀錄；門市與設定會保留，門市名稱可以在「設定」修改。確定要清除嗎？','clear-demo-yes','清除示範資料',true),
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
   const gift=form.elements.gift.checked,next={qty,price,discount:gift?null:d.discount,note:form.elements.note.value.trim(),gift,giftReason:gift?(form.elements.giftReason.value.trim()||'贈品'):''};
   const apply=()=>{Object.assign(line,next);saveCart();closeDialog();renderCart();};
   // 改價、打折要「折扣與改價」權限；改成贈品要「贈品」權限。
   const perm=gift?(line.gift?'':'gift'):(price!==line.price||JSON.stringify(d.discount||null)!==JSON.stringify(line.discount||null)?'discount':'');
   if(perm)return guard(perm,apply);
   apply();
  },
  'order-discount':form=>{const d=readDiscount(form);if(d.error)return formError(form,d.error);cart.discount=d.discount;saveCart();closeDialog();renderCart();},
  points:form=>{const n=P.parseAmount(form.elements.points.value);if(Number.isNaN(n))return formError(form,'點數請填 0 以上的整數');cart.pointsUse=Math.min(n,totals().maxPoints);saveCart();closeDialog();renderCart();},
  pay:checkout,refund:doRefund,promo:savePromo,product:saveProduct,categories:saveCategories,stock:saveStock,transfer:saveTransfer,suppliers:saveSuppliers,login:saveLogin,auth:saveAuth,member:saveMember,settings:saveSettings,
  'shift-open':form=>{
   const opening=P.parseAmount(form.elements.opening.value||'0');if(Number.isNaN(opening))return formError(form,'零用金請填數字');
   S.settings.cashier=form.elements.cashier.value;S.shifts.push({id:uid(),storeId:cur(),openedAt:Date.now(),closedAt:0,cashier:S.settings.cashier,openingCash:opening,cashMoves:[],countedCash:null,note:''});
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
   const summary=dayOf(day),record={day,storeId:cur(),storeName:curStore().name,closedAt:Date.now(),cashier:currentShift()?.cashier||whoName(),countedCash:counted,note:form.elements.note.value.trim(),summary};
   S.closes=[...S.closes.filter(c=>!(c.day===day&&here(c))),record];
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
  'promo-q':el=>{const key=el.value.normalize('NFKC').trim().toLowerCase();for(const row of $$('.pos-pick-row',dialog))row.hidden=!!key&&!row.dataset.name.includes(key);},
  'promo-bundle':()=>updateBundleSum(),
  'close-counted':el=>{
   const box=$('#pos-close-diff');if(!box)return;
   const expected=dayOf(ui.close.day).expectedCash,counted=el.value.trim()===''?NaN:P.parseAmount(el.value);
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
  'products-cat':el=>{ui.products.cat=el.value;renderProductList();},
  'line-gift':el=>{
   const form=el.form,on=el.checked,box=$('.pos-line-free',form),qty=P.parseAmount(form.elements.qty.value)||1,price=P.parseAmount(form.elements.price.value)||0;
   form.elements.price.disabled=on;const discount=$('.pos-fieldset',form);if(discount)discount.disabled=on;
   box.hidden=!on;box.innerHTML=on?`這一行改成 <b>${money(0)}</b>（原價 ${money(qty*price)}），應收會扣掉這一行。`:'';
  },
  'backup-remind':el=>{S.settings.backupRemind=Number(el.value)||0;save('settings');toast('已更新備份提醒');},
  'stock-store':el=>{ui.stock.store=el.value;renderStock();},
  'stock-cat':el=>{ui.stock.cat=el.value;renderStock();},
  'stock-brand':el=>{ui.stock.brand=el.value;renderStock();},
  'stock-supplier':el=>{ui.stock.supplier=el.value;renderStock();},
  'stock-dialog-store':el=>{const form=el.form,p=product(form.elements.id.value),box=$('.pos-stock-now',form);if(!p||!box)return;if(form.dataset.form==='transfer'){box.textContent='目前庫存：'+stockText(p);return;}const q=P.stockAt(p,el.value);box.textContent=storeName(el.value)+' 目前庫存 '+q;if(form.elements.mode.value==='count')form.elements.qty.value=q;},
  'transfer-product':el=>{const p=product(el.value),box=$('.pos-stock-now',el.form);if(p&&box)box.textContent='目前庫存：'+stockText(p);},
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
   const byCode=P.findByCode(S.products,text);
   // 掃到的是會員卡號或手機號碼，就直接帶出會員。
   const found=!byCode&&P.findMember(S.members,text);
   if(found){attachMember(found);el.value='';ui.q='';renderGrid();return;}
   const list=byCode?[byCode]:S.products.filter(p=>p.active!==false&&P.matchProduct(p,text));
   if(list.length===1){addProduct(list[0]);el.value='';ui.q='';renderGrid();}
   else{beep(false);toast(list.length?'有多個符合的商品，請直接點選':'找不到「'+text+'」，可以用「自訂金額」結帳',list.length?'warn':'error');el.select();}
  }
  if(el.id==='pos-pick-q'&&event.key==='Enter'){
   event.preventDefault();
   const text=el.value.trim(),exact=P.findMember(S.members,text),list=S.members.filter(m=>matchMember(m,text));
   const m=exact||(list.length===1?list[0]:null);
   if(m){closeDialog();attachMember(m);}else{beep(false);toast(list.length?'有多位符合的會員，請直接點選':'找不到這位會員，可以按「新增會員」','warn');el.select();}
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
