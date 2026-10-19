import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresInternshipFilter } from '../src/runner/record-scope.ts';

test('internship-only sections cannot consume an undifferentiated work-history plan', () => {
  for (const label of ['实习经历', '实习经验', 'Internship experience', 'Internships']) {
    assert.equal(requiresInternshipFilter(label, { recordType: 'experience' }), true);
    assert.equal(requiresInternshipFilter(label, { recordType: 'experience', recordFilter: 'internships' }), false);
  }
  assert.equal(requiresInternshipFilter('工作/实习经历', { recordType: 'experience' }), false);
  assert.equal(requiresInternshipFilter('工作经历', { recordType: 'experience' }), false);
  assert.equal(requiresInternshipFilter('实习经历', { recordType: 'project' }), false);
});
