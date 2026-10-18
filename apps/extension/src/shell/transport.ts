import type { ApiResult, MappingClient, OperationContext, AnalyzeRequest, PlanRequest, ReadinessRequest, ReadinessResult } from '@job-assistant/autofill-contracts';
import { extension } from './chrome.js';
export interface Transport { send(message: unknown): Promise<unknown> }
function createRequest({ transport }: { transport: Transport }) {
  const request = async <T>(operation: 'readiness' | 'analyze' | 'plan', input: ReadinessRequest | AnalyzeRequest | PlanRequest, context?: OperationContext): Promise<T> => {
    const deadlineAt = Math.min(input.deadlineAt, context?.deadlineAt ?? Infinity);
    const cancel = () => { void transport.send({ type: 'autofill-cancel-request', requestId: input.requestId }).catch(() => {}); };
    if (context?.signal?.aborted) throw new Error('cancelled');
    if (Date.now() >= deadlineAt) throw new Error('deadline-exceeded');
    let rejectCancel: (error: Error) => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { rejectCancel = reject; });
    const onAbort = () => { cancel(); rejectCancel(new Error('cancelled')); };
    context?.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { cancel(); rejectCancel(new Error('deadline-exceeded')); }, Math.max(0, deadlineAt - Date.now()));
    try {
      const response = await Promise.race([transport.send({ type: 'autofill-request', operation, input: { ...input, deadlineAt } }), cancelled]) as ApiResult<T>;
      if (!response || response.requestId !== input.requestId || typeof response.ok !== 'boolean') throw new Error('backend-invalid-response');
      if (!response.ok) throw new Error(response.error?.code ?? 'backend-error');
      return response.data;
    } finally { clearTimeout(timer); context?.signal?.removeEventListener('abort', onAbort); }
  };
  return request;
}
export function createMappingClient({ transport }: { transport: Transport }): MappingClient {
  const request = createRequest({ transport });
  return { analyzePage: (input, context) => request('analyze', input, context), buildFillPlan: (input, context) => request('plan', input, context) };
}
export function createReadinessClient({ transport }: { transport: Transport }) {
  const request = createRequest({ transport });
  return { async checkReadiness(input: ReadinessRequest, context?: OperationContext): Promise<ReadinessResult> {
    const result = await request<ReadinessResult>('readiness', input, context);
    if (!result || Array.isArray(result) || typeof result.profileVersion !== 'string' || !/^[a-f\d]{64}$/i.test(result.profileVersion) || Object.keys(result).some(key => key !== 'profileVersion')) throw new Error('backend-invalid-response');
    return result;
  } };
}
export const backgroundTransport: Transport = { send: message => extension.runtime.sendMessage(message) };
