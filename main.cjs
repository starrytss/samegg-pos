// 山姆蛋 POS 收銀：Windows 桌面版的外殼。
// 收銀系統本身在 app/ 資料夾裡，整個包在程式內，不需要網路，也不會連到任何網站。
// 資料存在這個程式自己的資料夾（%APPDATA%\SamEgg POS），和瀏覽器的資料互不相干。
'use strict';
const {app,BrowserWindow,Menu,protocol,shell,dialog}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {resolveAsset,START}=require('./resolve.cjs');

const ROOT=path.join(__dirname,'app');
const SMOKE=process.argv.includes('--smoke-test');
// 自動檢查用的模式：資料寫到暫存資料夾，不碰使用者真正的資料。
if(SMOKE)app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'samegg-pos-smoke-')));

protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);

// 同一台電腦只開一個視窗，避免兩個視窗同時寫同一份資料。
if(!SMOKE&&!app.requestSingleInstanceLock()){app.quit();}
else{
 let win=null;
 app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});

 function createWindow(){
  win=new BrowserWindow({
   width:1366,height:860,minWidth:960,minHeight:640,show:!SMOKE,
   title:'山姆蛋 POS 收銀',backgroundColor:'#FFFAF0',autoHideMenuBar:false,
   icon:path.join(__dirname,'build','icon.png'),
   webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,spellcheck:false,devTools:!app.isPackaged||SMOKE}
  });
  // 收銀系統靠這段字樣知道自己在桌面版裡（整個視窗當收銀畫面、不註冊離線快取）。
  win.webContents.setUserAgent(win.webContents.getUserAgent()+' SamEggPOS/'+app.getVersion());
  // 只允許在 app://pos/ 裡面走；外部連結交給預設瀏覽器，其餘一律擋下。
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
  win.webContents.on('will-navigate',(event,url)=>{if(!resolveAsset(ROOT,url))event.preventDefault();});
  win.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win.on('page-title-updated',event=>event.preventDefault());
  win.on('closed',()=>{win=null;});
  win.loadURL(START);
  if(SMOKE)smokeTest(win);
 }

 function buildMenu(){
  Menu.setApplicationMenu(Menu.buildFromTemplate([
   {label:'檔案',submenu:[
    {label:'開啟資料存放的資料夾',click:()=>shell.openPath(app.getPath('userData'))},
    {type:'separator'},
    {label:'結束',role:'quit'}
   ]},
   {label:'檢視',submenu:[
    {label:'全螢幕',role:'togglefullscreen',accelerator:'F11'},
    {label:'重新載入',role:'reload'},
    {type:'separator'},
    {label:'放大',role:'zoomIn'},{label:'縮小',role:'zoomOut'},{label:'原始大小',role:'resetZoom'}
   ]},
   {label:'說明',submenu:[
    {label:'關於',click:()=>dialog.showMessageBox(win,{type:'info',title:'關於',message:'山姆蛋 POS 收銀',detail:'版本 '+app.getVersion()+'\n\n商品、訂單、會員與設定都只存在這台電腦，不會上傳。\n請定期到「設定」下載備份檔。\n\n列印的是交易明細，不是統一發票；付款方式只是記錄，不會連接刷卡機或支付服務。',buttons:['確定']})}
   ]}
  ]));
 }

 // 打包後自動跑一次：視窗真的開得起來、收銀系統載入完成、資料存得進去，才算通過。
 function smokeTest(target){
  // 打包後的 exe 在 Windows 上不一定看得到輸出，所以結果也寫進指定的檔案。
  const report=text=>{try{if(process.env.SAMEGG_POS_SMOKE_LOG)fs.writeFileSync(process.env.SAMEGG_POS_SMOKE_LOG,text+'\n');}catch{}};
  const fail=reason=>{console.error('SMOKE FAIL: '+reason);report('SMOKE FAIL: '+reason);app.exit(1);};
  const timer=setTimeout(()=>fail('timed out after 40 s'),40000);
  target.webContents.on('did-fail-load',(_event,code,description)=>fail('page did not load: '+code+' '+description));
  target.webContents.on('console-message',event=>{if(event.level==='error')console.error('PAGE ERROR: '+event.message);});
  target.webContents.once('did-finish-load',async()=>{
   try{
    const result=await target.webContents.executeJavaScript(`new Promise(resolve=>{
     const started=Date.now(),check=()=>{
      const app=document.getElementById('pos-app');
      if(app&&app.dataset.ready==='true')return resolve({ready:true,items:document.querySelectorAll('.pos-item').length,desktop:document.documentElement.classList.contains('pos-desktop'),warn:!!document.querySelector('.pos-banner-warn'),login:!!document.querySelector('#pos-dialog[open] [data-form=login]'),font:getComputedStyle(document.body).fontFamily});
      if(Date.now()-started>30000)return resolve({ready:false});
      setTimeout(check,200);
     };check();
    })`);
    clearTimeout(timer);
    if(!result.ready)return fail('the register never became ready');
    if(!result.desktop)return fail('desktop mode was not detected');
    if(!result.items)return fail('no products were shown');
    if(result.warn)return fail('storage is not available');
    if(!result.login)return fail('the store login did not open');
    console.log('SMOKE OK: '+result.items+' products, font '+result.font);report('SMOKE OK: '+result.items+' products, font '+result.font);
    app.exit(0);
   }catch(error){fail(String(error&&error.message||error));}
  });
 }

 app.whenReady().then(()=>{
  protocol.handle('app',request=>{
   const hit=resolveAsset(ROOT,request.url);
   if(!hit)return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
   try{return new Response(fs.readFileSync(hit.file),{headers:{'Content-Type':hit.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});}
   catch{return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
  });
  buildMenu();
  createWindow();
 });
 app.on('window-all-closed',()=>app.quit());
}
