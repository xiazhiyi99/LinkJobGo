const { AiError } = require('../errors');

const parseFailures = () => Math.max(0, Number(process.env.AI_FAKE_FAILURES || 0));
let calls = 0;

const createFakeProvider = ({ tier }) => ({
  name: `fake-${tier}`,
  tier,
  model: `fake-${tier}`,
  async completeStructured({ task, input, capability = 'text' }) {
    calls += 1;
    const failures = parseFailures();
    if (calls <= failures) throw new AiError('fake provider timeout', 'AI_TIMEOUT', { retryable: true, status: 504 });
    if (task === 'resume.parse') {
      return { profile: { name: input.filename || '测试用户' }, preferences: {}, records: {} };
    }
    if (task === 'resume.normalize') {
      return { profile: {}, preferences: {}, records: { educations: [], experiences: [], projects: [], awards: [], publications: [], campusExperiences: [], skills: [], languages: [], certificates: [] }, unmapped: [] };
    }
    if (task === 'mail.classify') {
      return { isJobRelated: false, company: null, title: null, status: 'saved', appliedOn: null, eventStart: null, eventEnd: null, assessmentUrl: null, interviewUrl: null, evidence: [] };
    }
    if (capability === 'vision') return { fields: {}, records: {}, source: 'fake-vlm' };
    return { suggestions: (input.fields || []).map((field) => ({ field, value: '', confidence: 0, needsConfirmation: true })) };
  },
});

const resetFakeProvider = () => { calls = 0; };

module.exports = { createFakeProvider, resetFakeProvider };
