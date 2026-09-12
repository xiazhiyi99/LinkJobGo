const { AiError } = require('../errors');

const parseFailures = () => Math.max(0, Number(process.env.AI_FAKE_FAILURES || 0));
let calls = 0;

const createFakeProvider = ({ tier }) => ({
  name: `fake-${tier}`,
  tier,
  model: `fake-${tier}`,
  async completeStructured({ task, input }) {
    calls += 1;
    const failures = parseFailures();
    if (calls <= failures) throw new AiError('fake provider timeout', 'AI_TIMEOUT', { retryable: true, status: 504 });
    if (task === 'resume.parse') {
      return { profile: { name: input.filename || '测试用户' }, preferences: {}, records: {} };
    }
    return { suggestions: (input.fields || []).map((field) => ({ field, value: '', confidence: 0, needsConfirmation: true })) };
  },
});

const resetFakeProvider = () => { calls = 0; };

module.exports = { createFakeProvider, resetFakeProvider };
