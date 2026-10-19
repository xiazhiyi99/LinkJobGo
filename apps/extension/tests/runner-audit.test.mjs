import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/runner/index.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createRunner } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const ok = value => ({ status: 'ok', value });

function fixture({ rejectWrite = false, internship = false, filtered = false, derived = false } = {}) {
  const field = { fieldId: 'name', label: '姓名', kind: 'text', required: true, currentState: 'empty', hints: {} };
  const template = { viewId: 'view', fields: [field] };
  const section = { sectionId: 'basic', label: internship ? '实习经历' : '基本信息', mode: 'inline', repeatable: internship, records: [template], actions: [] };
  const snapshot = { protocolVersion: 'autofill.next.v2', documentId: 'document', pageRevision: 1, page: { origin: 'https://example.test', path: '/apply', title: 'Synthetic' }, sections: [section] };
  const sourceKey = internship ? { scope: 'record', recordType: 'experience', path: ['fields', 'company'] } : { scope: 'profile', path: ['name'] };
  const semanticPage = { documentId: 'document', pageRevision: 1, warnings: [], sections: [{ sectionId: 'basic', ...(internship ? { recordType: 'experience', ...(filtered ? { recordFilter: 'internships' } : {}) } : {}), template, bindings: [{ templateFieldId: 'name', sourceKey: derived ? null : sourceKey, ...(derived ? { derivation: 'alibaba-awards-summary' } : {}), status: 'resolved', resolvedBy: 'site' }] }] };
  const handle = { documentId: 'document', pageRevision: 1, sectionId: 'basic', viewId: 'view', fieldId: 'name' };
  const bound = { sectionId: 'basic', viewId: 'view', pageRevision: 1, fieldMap: { name: handle }, actionMap: {}, structureSignature: 'synthetic' };
  const page = { getIdentity: () => ({ documentId: 'document', pageRevision: 1 }), getPerformanceMetrics: () => ({ refreshes: 0, refreshMs: 0, looseControlsVisited: 0, cacheHits: 0, sectionRefreshes: 0, sectionRefreshMs: 0, sectionsScanned: 0 }), scanPage: async () => ok(snapshot), scanSection: async () => ok(section), bindRecord: async () => ok(bound), getDiagnostics: () => [] };
  const checks = []; let value = '';
  const controls = {
    verifyControl: async (handle, assignment, ctx) => { checks.push(ctx.verification ?? 'audit'); return ok({ matches: value === assignment.value, actual: value }); },
    writeControl: async () => { if (!rejectWrite) value = '合成候选人'; return ok({ attempted: true, value }); },
  };
  const mappingClient = { analyzePage: async () => semanticPage, buildFillPlan: async input => ({ runId: input.runId, documentId: 'document', pageRevision: 1, profileVersion: 'a'.repeat(64), warnings: [], sections: [{ sectionId: 'basic', ...(internship ? { recordType: 'experience' } : {}), records: [{ recordId: internship ? 'source-internship' : null, recordIndex: internship ? 0 : null, recordType: internship ? 'experience' : null, targetIndex: internship ? 0 : null, assignments: [{ templateFieldId: 'name', sourceRef: derived ? null : internship ? { ...sourceKey, recordId: 'source-internship' } : sourceKey, ...(derived ? { derivation: 'alibaba-awards-summary', sourceRefs: ['name','startDate'].map(key => ({ scope:'record', recordType:'award', recordId:'award-source', path:['fields',key] })) } : {}), value: '合成候选人', transform: derived ? 'join' : 'identity', status: 'ready', resolvedBy: 'site' }] }] }] }) };
  const progress=[];
  return { runner: createRunner({ page, controls, mappingClient, onProgress:state=>progress.push(state) }), checks, page, controls, mappingClient, snapshot, semanticPage, bound, progress };
}

test('ordinary filling confirms writes without repeating a whole-form value audit', async () => {
  const f = fixture(); const result = await f.runner.start();
  assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.deepEqual(f.checks, ['existing', 'after-write']);
  assert.equal(result.items[0].verification, 'readback');
});
test('validated multi-source derivations are still writable without a singular sourceRef', async () => {
  const f = fixture({ derived: true });
  assert.equal((await f.runner.start()).status, 'completed');
  assert.deepEqual(f.checks, ['existing','after-write']);
});

test('explicit QA audit remains available and rejected writes still fail in ordinary mode', async () => {
  const audited = fixture(); assert.equal((await audited.runner.start({ auditFinalValues: true })).status, 'completed');
  assert.deepEqual(audited.checks, ['existing', 'after-write', 'audit']);
  const rejected = fixture({ rejectWrite: true }); const result = await rejected.runner.start();
  assert.equal(result.status, 'partial', JSON.stringify(result));
  assert.equal(result.items[0].status, 'failed');
  assert.equal(result.items[0].reason, 'readback-mismatch');
});

test('unknown internship sections skip unfiltered work records before any write and allow proved subsets', async () => {
  const unfiltered = fixture({ internship: true });
  const result = await unfiltered.runner.start({ overwriteExisting: true });
  assert.equal(result.status, 'partial', JSON.stringify(result));
  assert.deepEqual(unfiltered.checks, []);
  assert.equal(result.items[0].reason, 'record-subtype-unconfirmed');
  const filtered = fixture({ internship: true, filtered: true });
  assert.equal((await filtered.runner.start({ overwriteExisting: true })).status, 'completed');
  assert.deepEqual(filtered.checks, ['existing', 'after-write']);
});

test('a field stability timeout leaves that field for the user and still fills the following field',async()=>{
  const f=fixture();
  const email={fieldId:'email',label:'邮箱',kind:'text',required:false,currentState:'empty',hints:{}};
  f.snapshot.sections[0].records[0].fields.push(email);
  f.semanticPage.sections[0].bindings.push({templateFieldId:'email',sourceKey:{scope:'profile',path:['email']},status:'resolved',resolvedBy:'site'});
  f.bound.fieldMap.email={...f.bound.fieldMap.name,fieldId:'email'};
  const originalPlan=f.mappingClient.buildFillPlan;
  f.mappingClient.buildFillPlan=async input=>{
    const plan=await originalPlan(input);
    plan.sections[0].records[0].assignments.push({templateFieldId:'email',sourceRef:{scope:'profile',path:['email']},value:'candidate@example.test',transform:'identity',status:'ready',resolvedBy:'site'});
    return plan;
  };
  const writes=[];let emailValue='';
  f.controls.verifyControl=async(handle,assignment)=>handle.fieldId==='name'?{status:'needs-user',code:'value-stability-timeout'}:ok({matches:emailValue===assignment.value,actual:emailValue});
  f.controls.writeControl=async(handle,assignment)=>{writes.push(handle.fieldId);emailValue=assignment.value;return ok({attempted:true,value:emailValue});};
  const result=await f.runner.start();
  assert.equal(result.status,'partial');
  assert.equal(result.items[0].reason,'value-stability-timeout');
  assert.equal(result.items[0].status,'needs-user');
  assert.equal(result.items[1].status,'filled');
  assert.deepEqual(writes,['email'],'an unconfirmed field is not written or retried in a loop');
  assert.ok(f.progress.some(state=>state.phase==='executing'&&state.report.items[0].reason==='value-stability-timeout'&&state.report.items[1].reason==='pending'),'progress advances before the next field finishes');
});
test('pause state records the current cause and clears it after ending the run',async()=>{
  const f=fixture();f.mappingClient.analyzePage=async()=>({});
  assert.equal((await f.runner.start()).status,'paused');
  assert.equal(f.runner.getState().pauseReason,'invalid-semantic-page');
  f.runner.cancel();assert.equal(f.runner.getState().pauseReason,undefined);
  const manual=fixture(),scan=manual.page.scanPage;
  manual.page.scanPage=async(...args)=>{manual.runner.pause();return scan(...args);};
  assert.equal((await manual.runner.start()).status,'paused');
  assert.equal(manual.runner.getState().pauseReason,'paused');
});
