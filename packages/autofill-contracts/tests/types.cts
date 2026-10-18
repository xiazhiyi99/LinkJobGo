import contracts = require('@job-assistant/autofill-contracts');
const result = contracts.validateResumeContext({});
if (result.ok) { const resume: contracts.ResumeContext = result.value; void resume; }
