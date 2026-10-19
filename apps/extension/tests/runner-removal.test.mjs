import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/runner/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createRunner } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const ok = value => ({ status:'ok', value });
function fixture({ wrongRemoval = false, supportsRemoval = true, beforeAlignment, beforeDeletion } = {}) {
  let revision = 1;
  const events = [], rows = [0,1,2].map(i => ({ viewId:`row-${i}`, fields:[{ fieldId:`field-${i}`,label:'公司名称',kind:'text',required:false,currentState:'nonempty',hints:{} }] }));
  const values = new Map(rows.map(row => [row.viewId,'旧数据']));
  const section = () => ({ sectionId:'internships',label:'实习经历',mode:'inline',repeatable:true,records:[...rows],actions:supportsRemoval ? rows.map(row => ({ actionId:`remove-${row.viewId}`,kind:'remove-record',sectionId:'internships',viewId:row.viewId,label:'删除',hints:{} })) : [] });
  const snapshot = () => ({protocolVersion:'autofill.next.v2',documentId:'doc',pageRevision:revision,page:{origin:'https://jobs.bytedance.com',path:'/campus/resume/123/apply',title:'Synthetic'},sections:[section()]});
  const sourceKey = {scope:'record',recordType:'experience',path:['fields','company']};
  const semantic = input => ({documentId:'doc',pageRevision:revision,warnings:['site-parser:bytedance@1.1.0'],sections:[{sectionId:'internships',recordType:'experience',recordFilter:'internships',template:input.snapshot.sections[0].records[0],bindings:[{templateFieldId:'field-0',sourceKey,status:'resolved',resolvedBy:'site'}]}]});
  const page = {
    getIdentity:() => ({documentId:'doc',pageRevision:revision}), getPerformanceMetrics:() => ({refreshes:0,refreshMs:0,looseControlsVisited:0,cacheHits:0,sectionRefreshes:0,sectionRefreshMs:0,sectionsScanned:0}),
    scanPage:async()=>ok(snapshot()),scanSection:async()=>{ if(beforeAlignment){beforeAlignment(rows);beforeAlignment=undefined;revision++;} return ok(section()); },observeSection:()=>()=>{},getDiagnostics:()=>[],
    getActionHandle:actionId => ({documentId:'doc',pageRevision:revision,sectionId:'internships',viewId:actionId.slice(7),actionId}),
    bindRecord:async({viewId})=>ok({sectionId:'internships',viewId,pageRevision:revision,structureSignature:'shape',fieldMap:{'field-0':{documentId:'doc',pageRevision:revision,sectionId:'internships',viewId,fieldId:rows.find(row=>row.viewId===viewId).fields[0].fieldId}},actionMap:{}}),
  };
  const controls = {
    performAction:async(handle,intent,ctx)=>{assert.equal(ctx.overwrite,'replace'); if(beforeDeletion){beforeDeletion(rows);beforeDeletion=undefined;revision++;} if(JSON.stringify(ctx.expectedRecordOrder)!==JSON.stringify(rows.map(row=>row.viewId)))return {status:'needs-user',code:'overwrite-record-order-changed'}; events.push(`remove:${handle.viewId}`);rows.splice(wrongRemoval?0:rows.findIndex(row=>row.viewId===handle.viewId),1);revision++;return ok({attempted:true,observed:true});},
    verifyControl:async(handle,assignment)=>ok({matches:values.get(handle.viewId)===assignment.value,actual:values.get(handle.viewId)}),
    writeControl:async(handle,assignment)=>{events.push(`write:${handle.viewId}`);values.set(handle.viewId,assignment.value);return ok({attempted:true,value:assignment.value});},
  };
  const mappingClient = {analyzePage:async input=>semantic(input),buildFillPlan:async input=>({runId:input.runId,documentId:'doc',pageRevision:revision,profileVersion:'a'.repeat(64),warnings:['site-parser:bytedance@1.1.0'],sections:[{sectionId:'internships',recordType:'experience',records:[{recordType:'experience',recordId:'intern-source',recordIndex:0,targetIndex:0,assignments:[{templateFieldId:'field-0',sourceRef:{...sourceKey,recordId:'intern-source'},value:'正确的实习公司',transform:'identity',status:'ready',resolvedBy:'site'}]}]}]})};
  return {runner:createRunner({page,controls,mappingClient}),events,rows};
}
test('runner trims only surplus rows before filling and accepts the new retained prefix', async()=>{
  const f=fixture(),report=await f.runner.start({overwriteExisting:true});
  assert.equal(report.status,'completed',JSON.stringify(report));
  assert.deepEqual(f.events,['remove:row-2','remove:row-1','write:row-0']);
  assert.deepEqual(f.rows.map(row=>row.viewId),['row-0']);
  assert.equal(report.actions.filter(action=>action.kind==='remove-record').length,2);
});
test('adapters without verified removal keep their existing filling behavior',async()=>{
  const f=fixture({supportsRemoval:false}),report=await f.runner.start({overwriteExisting:true});
  assert.equal(report.status,'completed',JSON.stringify(report));
  assert.deepEqual(f.events,['write:row-0']);assert.equal(f.rows.length,3);
});
test('an unexpected retained-row change stops before a second deletion or any write',async()=>{
  const f=fixture({wrongRemoval:true}),report=await f.runner.start({overwriteExisting:true,deadlineAt:Date.now()+150});
  assert.equal(report.status,'paused');
  assert.deepEqual(f.events,['remove:row-2']);
});

test('reordered, replaced or appended records invalidate deletion before any action', async()=>{
  for (const mutate of [rows=>rows.reverse(), rows=>rows.splice(0,1,{...rows[0],viewId:'replacement'}), rows=>rows.push({...rows[0],viewId:'user-added'})]) {
    const f=fixture({beforeAlignment:mutate}),report=await f.runner.start({overwriteExisting:true});
    assert.equal(report.status,'paused',JSON.stringify(report));
    assert.ok(report.warnings.includes('overwrite-record-order-changed'));
    assert.deepEqual(f.events,[]);
  }
});

test('the control boundary also refuses a reorder after the alignment scan',async()=>{
  const f=fixture({beforeDeletion:rows=>rows.reverse()}),report=await f.runner.start({overwriteExisting:true});
  assert.equal(report.status,'paused',JSON.stringify(report));
  assert.deepEqual(f.events,[]);
});
