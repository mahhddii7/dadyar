// Run after npm run build. Tests the real Next.js HTTP routes against a local fake model.
const assert = require('node:assert/strict');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {mkdtemp,rm,access} = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const ExcelJS = require('exceljs');
const {once} = require('node:events');
let requests=0, repaired=0, observedHistory=false;
const mock=http.createServer(async(req,res)=>{
 try {
  const chunks=[];for await(const c of req) chunks.push(c);
  const payload=JSON.parse(Buffer.concat(chunks).toString());requests++;
  const messages=payload.messages;
  let result;
  if (Array.isArray(messages.at(-1)?.content)) {
    result={text:'تصویر آزمایشی',tables:[{name:'test',columns:['item','amount'],rows:[['A',12],['B',8]]}],uncertain:false};
  } else if(messages.length===1) result='OK';
  else {
    const context=JSON.parse(messages[1].content);
    const last=messages.at(-1);
    let data;try{data=JSON.parse(last.content)}catch{data={}}
    if(context.question.includes('سند')) {
      if(messages.length===2) result={type:'tools',calls:[{type:'read_document',sourceId:context.documents[0].id,start:context.documents[0].chunks,count:1}]};
      else result={type:'answer',answer:'مبلغ انتهای سند ۷۵ است. [R1]',evidenceIds:['R1']};
    } else if(context.question.includes('بیرون')) {
      if(messages.length===2) result={type:'tools',calls:[{type:'query',datasetIds:['UNSELECTED:T1'],metrics:[{name:'n',operation:'count'}]}]};
      else {assert.ok(data.toolResults[0].error);result={type:'clarify',question:'کدام فایل انتخاب‌شده مدنظر است؟'};}
    } else if(context.question.includes('فقط اول')) {
      if(messages.length===2) result={type:'tools',calls:[{type:'query',datasetIds:[context.tables[0].id],metrics:[{name:'total',operation:'sum',column:'amount'}]}]};
      else result={type:'answer',answer:'مجموع فایل اول ۱۰۴ است. [R1]',evidenceIds:['R1']};
    } else if(context.question.includes('تفکیک')) {
      observedHistory=Array.isArray(context.previousConversation)&&context.previousConversation.length===2;
      if(messages.length===2) result={type:'tools',calls:[{type:'query',datasetIds:context.tables.map(x=>x.id),groupBy:['building'],metrics:[{name:'total',operation:'sum',column:'amount'}],sort:[{column:'total',direction:'desc'}]}]};
      else result={type:'answer',answer:'مجموع ساختمان A برابر ۲۰۷ و ساختمان B برابر ۱ است. [R1]',evidenceIds:['R1']};
    } else {
      if(messages.length===2) result={type:'tools',calls:[{type:'query',datasetIds:context.tables.map(x=>x.id),metrics:[{name:'total',operation:'sum',column:'amount'}],limit:1}]};
      else if(data.validationError) {repaired++;result={type:'answer',answer:'مجموع مبلغ همهٔ ۲۰۸ ردیف برابر ۲۰۸ است. [R1]',evidenceIds:['R1']};}
      else result={type:'answer',answer:'مجموع ۹۹۹ است. [R1]',evidenceIds:['R1']};
    }
  }
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({choices:[{message:{content:typeof result==='string'?result:JSON.stringify(result)},finish_reason:'stop'}]}));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
});
async function main(){
 const temp=await mkdtemp(path.join(os.tmpdir(),'dadyar-integration-'));
 mock.listen(0,'127.0.0.1');await once(mock,'listening');const modelPort=mock.address().port;
 // Reserve a free port in this process so tests do not depend on an existing dev server.
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const appPort=probe.address().port;await new Promise(r=>probe.close(r));
 const server=spawn(process.execPath,['.next/standalone/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,HOSTNAME:'127.0.0.1',PORT:String(appPort),DATA_DIR:temp,AI_PROVIDER:'openai-compatible',AI_API_KEY:'integration-test-placeholder',AI_MODEL:'mock',AI_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,AI_OCR_ENABLED:'true',AI_VISION_MODEL:'mock-vision'},stdio:['ignore','pipe','pipe']});
 let log='';server.stdout.on('data',d=>log+=d);server.stderr.on('data',d=>log+=d);
 const base=`http://127.0.0.1:${appPort}`;
 const chat=async body=>{const r=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,...await r.json()};};
 const upload=async files=>{const form=new FormData();files.forEach(file=>form.append('files',new Blob([file.bytes]),file.name));const r=await fetch(base+'/api/files',{method:'POST',body:form});return {status:r.status,...await r.json()};};
 try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,log);
  const intro=await chat({question:'کی هستی؟'});assert.equal(intro.status,200);assert.equal(intro.plan.intent,'assistant_info');assert.equal(requests,0);
  const one='building,amount\n'+Array.from({length:104},()=> 'A,1').join('\n');
  const two='building,amount\n'+Array.from({length:104},(_,i)=>i===103?'B,1':'A,1').join('\n');
  const files=await upload([{name:'one.csv',bytes:one},{name:'two.csv',bytes:two},{name:'bad.csv',bytes:'a,b\n1,"bad'}]);
  assert.equal(files.status,201);assert.equal(files.sources.length,2);assert.equal(files.errors.length,1);assert.equal(files.errors[0].file,'bad.csv');
  const ids=files.sources.map(s=>s.id);
  const original=await fetch(base+`/api/files/${ids[0]}?download=1`);assert.equal(await original.text(),one);assert.match(original.headers.get('content-disposition'),/attachment/);
  const answer=await chat({question:'جمع مبلغ در همه فایل‌ها چقدر است؟',sourceIds:ids});
  assert.equal(answer.status,200);assert.equal(answer.result.status,'answered');assert.match(answer.answer,/۲۰۸/);assert.ok(!answer.answer.includes('۹۹۹'));assert.equal(answer.result.evidence[0].coverage.scannedRows,208);assert.equal(repaired,1);
  const follow=await chat({question:'به تفکیک ساختمان هم بگو',sourceIds:ids,history:[{role:'user',content:'جمع مبلغ',sourceIds:ids},{role:'assistant',content:answer.answer,sourceIds:ids},{role:'user',content:'OUT OF SCOPE SECRET',sourceIds:['00000000-0000-4000-8000-000000000000']}]});
  assert.equal(follow.result.status,'answered');assert.equal(observedHistory,true);
  const partial=await chat({question:'فقط اول را بررسی کن',sourceIds:ids});assert.equal(partial.result.status,'limited');assert.equal(partial.result.unreviewedSources.length,1);assert.match(partial.result.unreviewedSources[0],/two.csv/);
  const scope=await chat({question:'از فایل بیرون انتخاب بخوان',sourceIds:ids});assert.equal(scope.result.status,'clarification');assert.equal(scope.result.evidence.length,0);
  const doc=await upload([{name:'report.txt',bytes:'ابتدا\n'+'x'.repeat(10000)+'\nمبلغ نهایی 75 است.'}]);
  const document=await chat({question:'آخر سند چه مبلغی است؟',sourceIds:[doc.sources[0].id]});assert.equal(document.result.status,'limited');assert.match(document.answer,/۷۵/);assert.ok(document.citations[0].sectionNumber>1);
  const wb=new ExcelJS.Workbook();const s1=wb.addWorksheet('first');s1.addRow(['id','amount']);s1.addRow(['a',1]);const s2=wb.addWorksheet('second');s2.addRow(['label','capacity']);s2.addRow(['B',2]);
  const book=await upload([{name:'multi.xlsx',bytes:Buffer.from(await wb.xlsx.writeBuffer())}]);assert.deepEqual(book.sources[0].sheets,['first','second']);assert.equal(book.sources[0].rowCount,2);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=','base64');
  const image=await upload([{name:'scan.png',bytes:png}]);assert.equal(image.status,201);assert.equal(image.sources[0].rowCount,2);assert.equal(image.sources[0].extraction.method,'vision-ocr');
  const health=await fetch(base+'/api/health',{method:'POST'}).then(r=>r.json());assert.equal(health.connected,true);
  const deletion=await fetch(base+`/api/files/${ids[0]}`,{method:'DELETE'});assert.equal(deletion.status,200);
  await assert.rejects(access(path.join(temp,'originals',ids[0])));assert.equal((await fetch(base+`/api/files/${ids[0]}`)).status,404);
  console.log('PASS: identity, partial batch, original download/delete, 208-row multi-file analysis, invalid-number repair, scoped history, selected-file boundary, last document chunk, multi-sheet workbook, OCR protocol, live connection probe.');
 } finally {server.kill();await new Promise(r=>mock.close(r));await rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;mock.close();});
