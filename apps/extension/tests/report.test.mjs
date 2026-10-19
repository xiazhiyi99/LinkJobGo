import test from 'node:test';
import assert from 'node:assert/strict';
import { reportSummary, needsReportDetail, isReportComplete } from '../src/report/index.ts';

const verified = { status: 'filled', verification: 'readback' };
const hidden = { status: 'skipped', reason: 'conditional-field-hidden', verification: 'none' };

test('fields hidden by a selected language do not become false attention or a partial result', () => {
  const report = { items: [verified, hidden, hidden], warnings: ['site-parser:synthetic@1.0'] };
  assert.equal(reportSummary(report).verified, 1);
  assert.equal(reportSummary(report).attention, 0);
  assert.equal(reportSummary(report).notApplicable, 2);
  assert.equal(needsReportDetail(hidden), false);
  assert.equal(isReportComplete(report), true);
});

test('missing data, failed writes and preserved conflicts cannot be hidden as not applicable', () => {
  for (const item of [
    { ...hidden, status: 'failed' },
    { ...hidden, reason: 'missing-source' },
    { ...hidden, reason: 'preserve-existing-value' },
    { ...verified, verification: 'none' },
  ]) {
    const report = { items: [verified, item], warnings: [] };
    assert.equal(reportSummary(report).notApplicable, 0);
    assert.equal(needsReportDetail(item), true);
    assert.equal(isReportComplete(report), false);
  }
  assert.equal(isReportComplete({ items: [verified, hidden], warnings: ['record-excluded:unknown-source'] }), false);
});
