import { PROTOCOL_VERSION, validateResumeContext, type ResumeContext, type PageSnapshot } from '@job-assistant/autofill-contracts';
const snapshot: PageSnapshot = { protocolVersion: PROTOCOL_VERSION, documentId: 'test', pageRevision: 0,
  page: { origin: 'https://example.test', path: '/', title: '' }, sections: [] };
const result = validateResumeContext({});
if (result.ok) { const resume: ResumeContext = result.value; void resume; }
void snapshot;
