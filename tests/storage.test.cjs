require('./register.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

test('concurrent saves keep every source; corrupt index is not silently replaced',async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'dadyar-store-'));
 process.env.DATA_DIR=temp;
 const {sourceRepository}=require('../src/server/storage/local-store.ts');
 try{
  const saved=await Promise.all(Array.from({length:12},(_,i)=>sourceRepository.save({name:`${i}.txt`,kind:'document',mimeType:'text/plain',size:1,text:'content',sections:[{text:'content'}]},Buffer.from(String(i)))));
  const listed=await sourceRepository.list();assert.equal(listed.length,12);assert.ok(listed.every(s=>!('sections' in s)&&!('text' in s)));
  assert.equal(Buffer.from(await sourceRepository.original(saved[3].id)).toString(),'3');
  await fs.writeFile(path.join(temp,'index.json'),'{broken');
  await assert.rejects(sourceRepository.list(),/بازنویسی نشد/);
  assert.equal(await fs.readFile(path.join(temp,'index.json'),'utf8'),'{broken');
 } finally {await fs.rm(temp,{recursive:true,force:true});}
});
