require('./register.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseDelimited,parseJson,decodeText,assertRows,completeText,uniqueHeaders}=require('../src/server/ingestion/tabular.ts');
const {createDatasets}=require('../src/server/analysis/tools/datasets.ts');
const {executeTool,documentChunks}=require('../src/server/analysis/tools/execute.ts');
const {validateAnswer,parseAction}=require('../src/server/analysis/workflow.ts');
const {dateValue}=require('../src/server/analysis/dates.ts');
const {numberValue}=require('../src/server/analysis/values.ts');
const {assistantInfo}=require('../src/server/analysis/assistant-info.ts');
const {modelErrorMessage}=require('../src/server/ai/provider.ts');
function source(id, data) {return {id,name:id+'.csv',size:1,mimeType:'text/csv',uploadedAt:'2026-11-24',...data};}
function setup(rows, columns=Object.keys(rows[0]||{})){const s=source('a',{kind:'table',rows,columns,extraction:{complete:true,method:'test'}});return {sources:[s], datasets:createDatasets([s])};}
function query(ctx, args, id='R1'){return executeTool({type:'query',datasetIds:[...ctx.datasets.keys()].slice(0,1),...args},ctx.datasets,ctx.sources,id);}

test('CSV preserves quoted delimiters, multiline cells and physical row references',()=>{
 const p=parseDelimited('Name,Note\r\nA,"a,b"\r\nB,"x\ny"\r\nC,z',',');
 assert.equal(p.rows.length,3);assert.equal(p.rows[0].Note,'a,b');assert.equal(p.rows[1].Note,'x\ny');assert.equal(p.rows[2].__row,5);
});
test('CSV preserves extra cells and header-only schema',()=>{
 const p=parseDelimited('A,B\n1,2,3\n4,5',',');assert.equal(p.columns.length,3);assert.equal(p.rows[0][p.columns[2]],'3');assert.ok(p.warnings.length);
 assert.deepEqual(parseDelimited('A,B\n',',').columns,['A','B']);
});
test('ambiguous CSV quotes are rejected',()=>{assert.throws(()=>parseDelimited('A,B\n1,"bad',','));assert.throws(()=>parseDelimited('A\n"x"oops',','));});
test('headers are globally unique and cannot overwrite provenance',()=>{
 const h=uniqueHeaders(['A','A (2)','A','__row','__proto__'],[]);assert.equal(new Set(h).size,5);assert.ok(!h.includes('__row'));assert.ok(!h.includes('__proto__'));
});
test('UTF16 and Persian numbers are preserved',()=>{
 const bytes=Buffer.concat([Buffer.from([255,254]),Buffer.from('نام\tمبلغ\nالف\t۱۲۳','utf16le')]);assert.match(decodeText(bytes,[]),/۱۲۳/);
 assert.equal(numberValue('۱٬۲۳۴٫۵'),1234.5);assert.equal(numberValue('1405/08/01'),null);assert.equal(numberValue(''),null);
});
test('limits reject rather than truncate',()=>{assert.throws(()=>assertRows(100001));assert.throws(()=>completeText('x'.repeat(1500001)));assert.doesNotThrow(()=>assertRows(100000));});
test('all JSON arrays and metadata survive extraction',()=>{
 const p=parseJson({version:2,data:[{id:1}],receipts:[{code:'R2'}]});assert.equal(p.rows.length,2);assert.equal(p.sheets.length,2);assert.match(p.text,/version/);
 const ctx=createDatasets([source('multi',p)]);assert.equal(ctx.size,2);
});
test('JSON reserved keys cannot override row provenance',()=>{
 const p=parseJson([JSON.parse('{"__row":999,"__proto__":"safe","name":"A"}')]);assert.equal(p.rows[0].__row,1);assert.equal(p.rows[0]['داده:__row'],999);
});
test('aggregate scans 208 rows despite display limit 1',()=>{
 const ctx=setup(Array.from({length:208},(_,i)=>({building:i===207?'LAST':'A',capacity:i===207?1000:1})));
 const r=query(ctx,{groupBy:['building'],metrics:[{name:'total',operation:'sum',column:'capacity'}],sort:[{column:'total',direction:'desc'}],limit:1});
 assert.equal(r.coverage.scannedRows,208);assert.equal(r.data.rows[0].building,'LAST');assert.equal(r.data.rows[0].total,1000);assert.equal(r.coverage.totalResultRows,2);
});
test('intermediate datasets contain ALL results beyond preview',()=>{
 const ctx=setup(Array.from({length:208},(_,i)=>({group:String(i),value:1})));
 query(ctx,{groupBy:['group'],metrics:[{name:'n',operation:'count'}],limit:2});
 const r=query(ctx,{datasetIds:['R1'],metrics:[{name:'n',operation:'sum',column:'n'}]},'R2');assert.equal(r.data.rows[0].n,208);
});
test('invalid filter columns fail rather than being ignored',()=>{const ctx=setup([{amount:1}]);assert.throws(()=>query(ctx,{filters:[{column:'wrong',operator:'eq',value:1}]}),/ستون/);});
test('all-invalid sums are null, mixed invalid counts are reported',()=>{
 const ctx=setup([{amount:''},{amount:'not a number'},{amount:null}]);const r=query(ctx,{metrics:[{name:'sum',operation:'sum',column:'amount'}]});assert.equal(r.data.rows[0].sum,null);assert.equal(r.data.audit.excludedNumericValues.sum,3);
});
test('derived zero division is null and reported',()=>{
 const ctx=setup([{used:10,total:20},{used:5,total:0}]);const r=query(ctx,{derive:[{name:'rate',operation:'percent',left:{column:'used'},right:{column:'total'}}]});assert.equal(r.data.rows[0].rate,50);assert.equal(r.data.rows[1].rate,null);assert.ok(r.warnings.length);
});
test('union of incompatible schemas is rejected',()=>{
 const s=[source('a',{kind:'table',rows:[{a:1}],columns:['a']}),source('b',{kind:'table',rows:[{b:1}],columns:['b']})];
 assert.throws(()=>executeTool({type:'query',datasetIds:['a:T1','b:T1']},createDatasets(s),s,'R1'),/ستون/);
});
test('join rejects duplicate keys to prevent inflated amounts',()=>{
 const s=[source('a',{kind:'table',rows:[{key:'1',amount:10}],columns:['key','amount']}),source('b',{kind:'table',rows:[{key:'1'},{key:'1'}],columns:['key']})];
 assert.throws(()=>executeTool({type:'query',datasetIds:['a:T1'],join:{datasetId:'b:T1',leftKey:'key',rightKey:'key',kind:'left'}},createDatasets(s),s,'R1'),/تکراری/);
});
test('left join preserves unmatched rows and distinguishes leading zero keys',()=>{
 const s=[source('a',{kind:'table',rows:[{key:'01'},{key:'1'},{key:''}],columns:['key']}),source('b',{kind:'table',rows:[{key:'1',value:'yes'}],columns:['key','value']})];
 const r=executeTool({type:'query',datasetIds:['a:T1'],join:{datasetId:'b:T1',leftKey:'key',rightKey:'key',kind:'left'}},createDatasets(s),s,'R1');assert.equal(r.data.rows.length,3);assert.equal(r.data.rows[0]['right.value'],null);assert.equal(r.data.rows[1]['right.value'],'yes');assert.equal(r.data.audit.join.unmatchedLeft,2);
});
test('unselected sources and arbitrary code cannot be used',()=>{
 const ctx=setup([{a:1}]);assert.throws(()=>query(ctx,{datasetIds:['hidden:T1']}));assert.throws(()=>executeTool({type:'exec',code:'process.exit()'},ctx.datasets,ctx.sources,'R1'));
});
test('incomplete extraction cannot produce a definitive aggregate',()=>{
 const ctx=setup([{a:1}]);ctx.datasets.values().next().value.complete=false;assert.throws(()=>query(ctx,{metrics:[{name:'n',operation:'count'}]}),/کامل/);
});
test('comparison includes late-row mismatches and reusable exception datasets',()=>{
 const a=Array.from({length:208},(_,i)=>({id:String(i),value:i})),b=a.map(row=>({...row}));b[207].value=999;
 const s=[source('a',{kind:'table',rows:a,columns:['id','value']}),source('b',{kind:'table',rows:b,columns:['id','value']})],ds=createDatasets(s);
 const r=executeTool({type:'compare',left:'a:T1',right:'b:T1',key:'id'},ds,s,'R1');assert.equal(r.data.different,1);assert.equal(r.data.same,207);assert.equal(ds.get('R1:changes').rows[0].key,'207');
});
test('document pagination preserves final sections and page provenance',()=>{
 const s=source('doc',{kind:'document',sections:[{page:1,text:'A'.repeat(2801)},{page:2,text:'FINAL'}]});const chunks=documentChunks(s);assert.equal(chunks.length,4);assert.equal(chunks[3].page,2);
 const r=executeTool({type:'read_document',sourceId:'doc',start:4,count:1},new Map(),[s],'R1');assert.equal(r.data.chunks[0].text,'FINAL');assert.equal(r.citations[0].page,2);
});
test('numeric and reference hallucinations are rejected',()=>{
 const ctx=setup([{amount:10},{amount:20}]);const r=query(ctx,{metrics:[{name:'total',operation:'sum',column:'amount'}]});
 assert.doesNotThrow(()=>validateAnswer('مجموع ۳۰ است. [R1]',['R1'],[r]));
 assert.throws(()=>validateAnswer('مجموع ۹۹۹ است. [R1]',['R1'],[r]),/محاسبه/);
 assert.throws(()=>validateAnswer('مجموع ۳۰ است. [R99]',['R99'],[r]),/شواهد/);
});
test('invalid model actions are rejected',()=>{assert.throws(()=>parseAction('{"type":"answer","answer":"made up","evidenceIds":[]}'));});
test('Jalali dates, leap year and Gregorian invalid dates',()=>{
 assert.equal((dateValue('۱۴۰۵/۰۸/۲۴','jalali')-dateValue('1405/08/20','jalali'))/86400000,4);
 assert.equal(dateValue('1405/12/30','jalali'),null);assert.equal(dateValue('2026-02-30','gregorian'),null);
 assert.equal(dateValue('1405/08/24','gregorian'),null);
});
test('date differences report invalid cells and preserve negatives',()=>{
 const ctx=setup([{start:'1405/08/24',end:'1405/08/20'},{start:'bad',end:'1405/08/20'}]);
 const r=query(ctx,{derive:[{name:'days',operation:'date_diff_days',left:{column:'end'},right:{column:'start'},calendar:'jalali'}]});assert.equal(r.data.rows[0].days,-4);assert.equal(r.data.rows[1].days,null);
});
test('identity does not need files and TLS errors are actionable',()=>{
 assert.match(assistantInfo('کی هستی؟'),/داده‌یار/);assert.equal(assistantInfo('نام مدیر در این فایل کی هست؟'),null);
 assert.match(modelErrorMessage(new TypeError('fetch failed',{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}})),/TLS/);
});

test('large JSON numeric identifiers are rejected before precision loss',()=>{
 const {safeJsonParse}=require('../src/server/ingestion/tabular.ts');
 assert.throws(()=>safeJsonParse('{"id":9007199254740993}'),/دقت/);
 assert.equal(safeJsonParse('{"id":"9007199254740993"}').id,'9007199254740993');
});
test('nested JSON leaf fields stay queryable without path collisions',()=>{
 const p=parseJson([{employee:{id:'01',name:'Ali'},'employee.name':'literal'}]);
 assert.equal(p.rows[0]['employee.name'],'Ali');assert.equal(p.rows[0]['employee\\.name'],'literal');assert.equal(p.rows[0]['employee.id'],'01');
});
test('numeric first rows are preserved as data',()=>{
 const csv=parseDelimited('1,2\n3,4',',');assert.equal(csv.rows.length,2);assert.equal(csv.rows[0]['ستون 1'],'1');
 const json=parseJson([[1,2],[3,4]]);assert.equal(json.rows.length,2);assert.equal(json.rows[0]['ستون 1'],1);
});
test('empty sheets remain visible in the dataset catalog',()=>{
 const s=source('a',{kind:'table',rows:[{x:1,__sheet:'full'}],columns:['x','y'],sheetColumns:{full:['x'],empty:['y']}});
 const ds=createDatasets([s]);assert.equal(ds.size,2);assert.equal(ds.get('a:T2').rows.length,0);assert.deepEqual(ds.get('a:T2').columns,['y']);
});

test('safe integer aggregates retain all digits and decimal sums are compensated',()=>{
 const ctx=setup([{amount:Number.MAX_SAFE_INTEGER}]);
 const r=query(ctx,{metrics:[{name:'sum',operation:'sum',column:'amount'}]});assert.equal(r.data.rows[0].sum,Number.MAX_SAFE_INTEGER);
 const p=executeTool({type:'profile',datasetIds:['a:T1']},ctx.datasets,ctx.sources,'R2');assert.equal(p.data[0].statistics[0].numeric.sum,Number.MAX_SAFE_INTEGER);
 const decimal=setup(Array.from({length:1000},()=>({amount:0.1})));
 const total=query(decimal,{metrics:[{name:'sum',operation:'sum',column:'amount'}]});assert.equal(total.data.rows[0].sum,100);
});
