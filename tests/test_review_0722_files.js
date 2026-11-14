'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{FileBridge}=require('../desktop/file-bridge.cjs');
const tests=[],test=(name,fn)=>tests.push([name,fn]),hash=text=>crypto.createHash('sha256').update(text).digest('hex');
const B=path.resolve(__dirname,'..');fs.mkdirSync(path.join(B,'qa'),{recursive:true});
async function fixture(fn){const root=fs.mkdtempSync(path.join(B,'qa/review-files-'));try{let picked=path.join(root,'Test.html');const bridge=new FileBridge({root,state:path.join(root,'grants.json'),picker:async()=>picked,opener:async()=>{}});await fn(bridge,picked,p=>picked=p)}finally{assert(root.startsWith(path.join(B,'qa')+path.sep+'review-files-'));fs.rmSync(root,{recursive:true,force:true})}}
test('V21-01 save ACK confirms only its own UTF8 payload even after an external replacement',()=>fixture(async(bridge,file)=>{
 const old='<script id="pipeline-document">OLD</script>',own='<script id="pipeline-document">СВОЯ ЗАПИСЬ</script>',external='EXTERNAL EDIT';fs.writeFileSync(file,old);const picked=await bridge.command('pick-document');const rename=fs.promises.rename;
 fs.promises.rename=async(...args)=>{await rename(...args);if(args[1]===file)fs.writeFileSync(file,external)};let receipt;try{receipt=await bridge.command('save',{nativePath:file,digest:picked.digest,text:own})}finally{fs.promises.rename=rename}
 await assert.rejects(()=>bridge.command('save',{nativePath:file,digest:hash(own),text:old}),/изменён/);assert.equal(fs.readFileSync(file,'utf8'),external);assert.equal(receipt.digest,hash(own));await assert.rejects(()=>bridge.command('save',{nativePath:file,digest:receipt.digest,text:old}),/изменён/);assert.equal(fs.readFileSync(file,'utf8'),external);
}));
test('V21-15 Save As replaces an explicitly chosen oversized destination with a valid new document',()=>fixture(async(bridge,file)=>{
 fs.writeFileSync(file,'x');fs.truncateSync(file,40*1024*1024+1);const fullRead=fs.promises.readFile;let largeReads=0;fs.promises.readFile=async(p,...args)=>{if(p===file&&fs.statSync(p).size>40*1024*1024)largeReads++;return fullRead(p,...args)};
 try{await assert.rejects(()=>bridge.command('pick-document'),/40|больш/);const target=await bridge.command('pick-save'),text='<script id="pipeline-document">NEW</script>';const receipt=await bridge.command('save',{...target,text});assert.equal(receipt.digest,hash(text));assert.equal(fs.readFileSync(file,'utf8'),text);assert.equal(largeReads,0)}finally{fs.promises.readFile=fullRead}
}));
test('R21-01 native PDF preview verifies the signature as well as the MIME extension',()=>fixture(async(bridge,file)=>{
 for(const [name,bytes,valid] of [['valid.pdf','%PDF-1.4\nsynthetic',true],['disguised.pdf','<html><script>bad()</script></html>',false],['active.html','%PDF-1.4\n<html>bad</html>',false]]){
  const source=path.join(path.dirname(file),name);fs.writeFileSync(source,bytes);
  if(valid){const info=await bridge.command('stat',{nativePath:source,pdf:true});assert.equal(info.mime,'application/pdf');assert.equal(info.pdf,true);assert.equal((await bridge.pdfSource(info.pdfURL)).nativePath,source);const forged=new URL(info.pdfURL);forged.searchParams.set('key','bad');await assert.rejects(()=>bridge.pdfSource(forged.href));fs.writeFileSync(source,'<html>replaced after stat</html>');await assert.rejects(()=>bridge.pdfSource(info.pdfURL),/PDF/)}else await assert.rejects(()=>bridge.command('stat',{nativePath:source,pdf:true}),/PDF/);
  assert.equal((await bridge.command('stat',{nativePath:source})).state,'ok');
 }
}));
(async()=>{let failed=0;for(const [name,run] of tests)try{await run();console.log('PASS',name)}catch(e){failed++;console.error('FAIL',name,e.message)}console.log('TOTAL',tests.length,'FAILED',failed);if(failed)process.exitCode=1})()
