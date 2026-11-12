const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {resolveAsset,START,MIME}=require('./resolve.cjs');
// path.resolve adds the drive letter on Windows (D:\opt\...), so expected paths match what resolveAsset returns.
const root=path.resolve(path.sep,'opt','SamEgg POS','resources','app');
const inside=file=>path.join(root,file);

test('addresses inside app://pos/ map to files in the bundle',()=>{
 assert.equal(START,'app://pos/index.html');
 assert.deepEqual(resolveAsset(root,START),{file:inside('index.html'),type:MIME['.html']});
 assert.deepEqual(resolveAsset(root,'app://pos/'),{file:inside('index.html'),type:MIME['.html']});
 assert.deepEqual(resolveAsset(root,'app://pos/app.js?v=20261115'),{file:inside('app.js'),type:MIME['.js']});
 assert.deepEqual(resolveAsset(root,'app://pos/fonts/tc/core.woff2?v=abc#x'),{file:inside(path.join('fonts','tc','core.woff2')),type:'font/woff2'});
 assert.equal(resolveAsset(root,'app://pos/fonts/NotoSansTC-OFL.txt').type,MIME['.txt']);
});

test('nothing outside the bundle can be read',()=>{
 for(const address of [
  'app://pos/../main.cjs','app://pos/%2e%2e/package.json','app://pos/..%2f..%2fetc/passwd','app://pos/fonts/../../main.cjs',
  'app://pos/%5c..%5cmain.cjs','app://pos/a%00.js','app://pos/%E0%A4%A','app://other/index.html','app://pos.evil/index.html',
  'file:///etc/passwd','https://example.com/index.html','not a url',''
 ])assert.equal(resolveAsset(root,address),null,address);
});

test('unknown file types are refused',()=>{
 for(const address of ['app://pos/main.cjs','app://pos/data.exe','app://pos/readme','app://pos/app.js.map'])assert.equal(resolveAsset(root,address),null,address);
});
