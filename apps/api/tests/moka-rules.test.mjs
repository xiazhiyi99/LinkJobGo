import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createConfiguredSiteRegistry } = require('../src/modules/autofill/dist/engine.cjs');
const { FIELD_CATALOG, validateSemanticPage } = require('@job-assistant/autofill-contracts');
const snapshot = { protocolVersion: 'autofill.next.v2', documentId: 'moka-test', pageRevision: 1, page: { origin: 'https://app.mokahr.com', path: '/campus_apply/zuoyebang/144908', hashRoute: '/job/6e0a630d-9d1b-4855-b0c2-a916adf971d3/apply', title: 'Synthetic application' }, sections: [{ sectionId: 'internships', label: '实习经历', mode: 'inline', repeatable: true, actions: [], records: [{ viewId: 'view', fields: [['公司名称', 'text'], ['职位名称', 'text'], ['工作职责', 'textarea']].map(([label, kind], i) => ({ fieldId: `field-${i}`, label, kind, required: false, currentState: 'empty', hints: {} })) }] }] };
const parser = createConfiguredSiteRegistry({ mokaMode: 'candidate' }).classify(snapshot).parser;

test('Moka internship sections filter record identity using explicit source metadata', () => {
  const result = parser.parse({ snapshot, catalog: FIELD_CATALOG });
  assert.equal(result.sections[0].recordType, 'experience');
  assert.equal(result.sections[0].recordFilter, 'internships');
  assert.equal(validateSemanticPage({ documentId: snapshot.documentId, pageRevision: 1, ...result }, snapshot, FIELD_CATALOG).ok, true);
  const include = (extra, recordType = 'experience') => parser.includeRecord({ filter: 'internships', record: { recordType, extra } });
  for (const employmentType of ['实习', '实习生', 'Intern', 'internship']) assert.equal(include({ employmentType }), true);
  for (const employmentType of ['正式', '全职', '兼职', '未知']) assert.equal(include({ employmentType, profileSection: '实习经历' }), false);
  assert.equal(include({ profileSection: '实习经历' }), true);
  assert.equal(include({ profileSection: '工作/实习经历' }), false);
  assert.equal(include({}), false);
  assert.equal(include({ employmentType: '实习' }, 'campus'), false);
});

test('record filters cannot be applied to a different record type', () => {
  const semantic = { documentId: snapshot.documentId, pageRevision: 1, ...parser.parse({ snapshot, catalog: FIELD_CATALOG }) };
  for (const [recordFilter, recordType] of [['internships', 'education'], ['papers', 'experience'], ['unknown', 'experience']]) {
    const changed = structuredClone(semantic); changed.sections[0].recordFilter = recordFilter; changed.sections[0].recordType = recordType;
    assert.equal(validateSemanticPage(changed, snapshot, FIELD_CATALOG).ok, false);
  }
});
