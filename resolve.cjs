// Maps an app://pos/... address to a file inside the bundled app folder.
// Kept free of Electron so it can be tested with plain Node.
'use strict';
const path=require('node:path');

const MIME={
 '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
 '.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'
};
const HOST='pos';

// Returns {file,type} for a request the app may read, or null for anything else
// (another host, a path that climbs out of the folder, an unknown file type).
function resolveAsset(root,address){
 let url;
 try{url=new URL(address);}catch{return null;}
 if(url.protocol!=='app:'||url.hostname!==HOST)return null;
 let pathname;
 try{pathname=decodeURIComponent(url.pathname);}catch{return null;}
 if(pathname.includes('\0')||pathname.includes('\\'))return null;
 if(pathname===''||pathname.endsWith('/'))pathname+='index.html';
 const base=path.resolve(root),file=path.resolve(base,'.'+pathname);
 if(file!==base&&!file.startsWith(base+path.sep))return null;
 const type=MIME[path.extname(file).toLowerCase()];
 return type?{file,type}:null;
}

module.exports={resolveAsset,MIME,HOST,START:'app://'+HOST+'/index.html'};
