import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const built=await build({entryPoints:[fileURLToPath(new URL('../src/runner/index.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {createRunner}=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const ok=value=>({status:'ok',value});
test('unmapped empty-section probe rolls back and is not recreated during execution',async()=>{
 let revision=1, row=null, adds=0, rollbacks=0, proof;
 const field={fieldId:'field',label:'未知名称',kind:'text',required:false,currentState:'empty',hints:{}};
 const section=()=>({sectionId:'empty',label:'未知区块',mode:'inline',repeatable:true,records:row?[row]:[],actions:[{actionId:'add',kind:'add-record',sectionId:'empty',label:'添加',hints:{}}]});
 const snapshot=()=>({protocolVersion:'autofill.next.v2',documentId:'doc',pageRevision:revision,page:{origin:'https://jobs.bytedance.com',path:'/campus/resume/123/apply',title:'Synthetic'},sections:[section()]});
 const metrics={refreshes:0,refreshMs:0,looseControlsVisited:0,cacheHits:0,sectionRefreshes:0,sectionRefreshMs:0,sectionsScanned:0};
 const page={getIdentity:()=>({documentId:'doc',pageRevision:revision}),getPerformanceMetrics:()=>metrics,scanPage:async()=>ok(snapshot()),scanSection:async()=>ok(section()),canProbeAddition:()=>true,
 captureRecordAddition:()=>ok({probeId:'probe',documentId:'doc',sectionId:'empty',baselineViewIds:[]}),observeRecordAddition:baseline=>row?ok({record:row,proof:proof??={...baseline,viewId:'new-view'}}):{status:'needs-user',code:'addition-unconfirmed'},getActionHandle:()=>({documentId:'doc',pageRevision:revision,sectionId:'empty',actionId:'add'}),observeSection:()=>()=>{},getDiagnostics:()=>[]};
 const controls={performAction:async()=>{adds++;row={viewId:'new-view',fields:[field]};revision++;return ok({attempted:true,observed:true});},rollbackAddedRecord:async()=>{rollbacks++;row=null;revision++;return ok({removed:true});}};
 const mappingClient={analyzePage:async input=>({documentId:'doc',pageRevision:revision,warnings:['site-parser:bytedance@1.1.0'],sections:[{sectionId:'empty',template:input.snapshot.sections[0].records[0],bindings:[{templateFieldId:'field',sourceKey:null,status:'unsupported',resolvedBy:null}]}]}),buildFillPlan:async input=>({runId:input.runId,documentId:'doc',pageRevision:revision,profileVersion:'a'.repeat(64),warnings:['site-parser:bytedance@1.1.0'],sections:[{sectionId:'empty',records:[{recordId:null,recordIndex:null,recordType:null,targetIndex:null,assignments:[{templateFieldId:'field',sourceRef:null,value:null,status:'unsupported',resolvedBy:null,transform:'identity'}]}]}]})};
 const result=await createRunner({page,controls,mappingClient}).start({overwriteExisting:true});
 assert.equal(result.status,'partial',JSON.stringify(result));assert.equal(adds,1);assert.equal(rollbacks,1);assert.equal(row,null);assert.equal(result.items[0].reason,'unsupported');
});
