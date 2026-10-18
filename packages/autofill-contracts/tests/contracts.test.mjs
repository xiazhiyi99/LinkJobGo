import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateResumeContext, validatePageSnapshot, validateSemanticPage, validateFillPlan, validateSourceRef } from '@job-assistant/autofill-contracts';
import { readHashRoute } from '@job-assistant/autofill-contracts';

const resume=JSON.parse(await readFile(new URL('../../../apps/extension/fixtures/autofill-context.example.json',import.meta.url),'utf8'));
const education=resume.records.find(record=>record.recordType==='education');
resume.records.push({...structuredClone(education),id:'second-education-fixture',index:1});
test('existing API fields retain identity, false and missing values',()=>{
 assert.equal(validateResumeContext(resume).ok,true);
 assert.equal(resume.records[0].fields.current,false);
 const alias=structuredClone(resume);alias.profile.highestDegree='硕士';assert.equal(validateResumeContext(alias).ok,false);
 const duplicate=structuredClone(resume);duplicate.records[1].id=duplicate.records[0].id;assert.equal(validateResumeContext(duplicate).ok,false);
 const malformed=structuredClone(resume);malformed.records[0].recordType={toString:null,valueOf:null};assert.equal(validateResumeContext(malformed).ok,false);
 assert.equal(validateSourceRef({scope:'record',recordType:'education',recordId:'absent',path:['fields','school']},undefined,resume).ok,false);
 assert.equal(validateSourceRef({scope:'profile',path:['__proto__']}).ok,false);
});
test('full record plan rejects wrong versions, template fields and crossed record sources',()=>{
 const template={viewId:'view-1',fields:[{fieldId:'field-school',label:'学校',kind:'text',required:true,currentState:'empty',hints:{}}]};
 const snapshot={protocolVersion:'autofill.next.v2',documentId:'document-1',pageRevision:0,page:{origin:'https://example.test',path:'/resume',title:'测试'},sections:[{sectionId:'education',label:'教育经历',mode:'inline',repeatable:true,records:[template],actions:[]}]};
 const semanticPage={documentId:snapshot.documentId,pageRevision:0,sections:[{sectionId:'education',recordType:'education',template,bindings:[{templateFieldId:'field-school',sourceKey:{scope:'record',recordType:'education',path:['fields','school']},status:'resolved',resolvedBy:'site'}]}],warnings:[]};
 const plan={runId:'run-1',documentId:snapshot.documentId,pageRevision:0,profileVersion:resume.profileVersion,sections:[{sectionId:'education',recordType:'education',records:resume.records.filter(r=>r.recordType==='education').map(r=>({recordId:r.id,recordIndex:r.index,recordType:r.recordType,targetIndex:r.index,assignments:[{templateFieldId:'field-school',sourceRef:{scope:'record',recordType:'education',recordId:r.id,path:['fields','school']},value:r.fields.school,status:'ready',transform:'identity',resolvedBy:'site'}]}))}],warnings:[]};
 const ctx={snapshot,semanticPage,resumeContext:resume,profileVersion:resume.profileVersion};
 assert.equal(validatePageSnapshot(snapshot).ok,true);assert.equal(validateSemanticPage(semanticPage,snapshot).ok,true);assert.equal(validateFillPlan(plan,ctx).ok,true);assert.equal(plan.sections[0].records.length,2);
 const wrong=structuredClone(plan);wrong.sections[0].records[1].assignments[0].sourceRef.recordId=education.id;assert.equal(validateFillPlan(wrong,ctx).ok,false);
 assert.equal(validateFillPlan({...plan,pageRevision:1},ctx).ok,false);
 const leaked=structuredClone(snapshot);leaked.sections[0].records[0].fields[0].value='private';assert.equal(validatePageSnapshot(leaked).ok,false);
 const badRecords=structuredClone(snapshot);badRecords.sections[0].records=[null];badRecords.sections[0].actions=[{actionId:'edit',kind:'open-record',sectionId:'education',viewId:'view-1',label:'编辑',hints:{}}];assert.equal(validatePageSnapshot(badRecords).ok,false);
 const badTemplate=structuredClone(semanticPage);badTemplate.sections[0].template.fields={};assert.equal(validateSemanticPage(badTemplate,snapshot).ok,false);
});

test('page hash routes are optional public paths with fragment queries excluded', () => {
 const snapshot={protocolVersion:'autofill.next.v2',documentId:'document-route',pageRevision:0,page:{origin:'https://app.mokahr.com',path:'/apply/blueinteractive/38433',title:'Application'},sections:[]};
 const route='/job/48c5ef6a-851a-4b09-aa6f-bd4ad62a311f/apply';
 assert.equal(validatePageSnapshot(snapshot).ok,true,'Old snapshots without a hash route remain valid');
 const extracted=readHashRoute(`#${route}?pure=1&access_token=PRIVATE_HASH_CANARY`);
 assert.equal(extracted,route);
 assert.equal(validatePageSnapshot({...snapshot,page:{...snapshot.page,hashRoute:extracted}}).ok,true);
 assert.equal(readHashRoute('#/'),'/');
 for(const hash of ['#PRIVATE_HASH_CANARY','#access_token=PRIVATE_HASH_CANARY','#education','#/job%2Fsecret','#/job#PRIVATE_HASH_CANARY','#//external.test/path','#/job/../apply','#/job/./apply',`#/${'a'.repeat(512)}`]) assert.equal(readHashRoute(hash),undefined,hash);
 for(const hashRoute of [null,0,{},'',`#${route}`,`${route}?token=PRIVATE_HASH_CANARY`,'https://example.test/route','//example.test','/encoded%3Ftoken','/has space','/has\ncontrol','/dot/../path',`/${'a'.repeat(512)}`]) {
   assert.equal(validatePageSnapshot({...snapshot,page:{...snapshot.page,hashRoute}}).ok,false,JSON.stringify(hashRoute));
 }
 assert.equal(snapshot.page.path,'/apply/blueinteractive/38433');
 assert.doesNotMatch(JSON.stringify({...snapshot,page:{...snapshot.page,hashRoute:extracted}}),/PRIVATE_HASH_CANARY|access_token|pure=1/);
});
