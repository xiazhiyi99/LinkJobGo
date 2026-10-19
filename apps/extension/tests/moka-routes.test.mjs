import test from 'node:test';
import assert from 'node:assert/strict';
import { isMokaApplicationPage, isCompatibleMokaDocument } from '../src/page/adapters/moka.ts';

test('Moka scanning and control drivers accept changing employers, forms and job IDs', () => {
  for (const tenant of ['baai', 'zuoyebang', 'synthetic-a', 'synthetic_b']) {
    for (const job of ['original-job', 'different-job']) assert.equal(isMokaApplicationPage({ origin: 'https://app.mokahr.com', pathname: `/campus_apply/${tenant}/9988`, hash: `#/job/${job}/apply?from=test` }), true);
  }
  for (const location of [
    { origin: 'https://app.mokahr.com.evil.test', pathname: '/campus_apply/company/9988', hash: '#/job/job/apply' },
    { origin: 'https://app.mokahr.com', pathname: '/campus_apply/company/not-an-id', hash: '#/job/job/apply' },
    { origin: 'https://app.mokahr.com', pathname: '/campus_apply/company/9988', hash: '#/job/job' },
    { origin: 'https://app.mokahr.com', pathname: '/campus_apply/company/9988', hash: '#/jobs' },
  ]) assert.equal(isMokaApplicationPage(location), false);
});
test('a provider URL alone does not select the Moka page adapter without matching DOM blocks', () => {
  const document = { location: { origin: 'https://app.mokahr.com', pathname: '/campus_apply/synthetic/9988', hash: '#/job/job/apply' }, querySelectorAll: () => [] };
  assert.equal(isCompatibleMokaDocument(document), false);
});
