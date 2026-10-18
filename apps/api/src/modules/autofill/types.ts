import type { ResumeContext } from '@job-assistant/autofill-contracts';

// Server-only identity. Never accept this object from a page or model response.
export interface RequestContext {
  principal: { id: string; email: string };
  requestId: string;
  signal?: AbortSignal;
  deadlineAt: number;
}
export interface AiCallContext extends RequestContext {
  runId: string;
  aiPhase: 'mapping' | 'options';
  siteId: null;
  siteVersion: null;
}
export interface ResumeClient {
  load(context: Omit<RequestContext, 'requestId'> & { expectedProfileVersion?: string }): Promise<ResumeContext>;
}
