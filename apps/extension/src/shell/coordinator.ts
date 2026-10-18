import { PROTOCOL_VERSION } from '@job-assistant/autofill-contracts';
import type { OperationContext, ReadinessRequest, ReadinessResult, RunReport } from '@job-assistant/autofill-contracts';
import type { Runner, RunnerState, StartOptions } from '../runner/index.js';

export type ShellState = RunnerState & { readiness: { status: 'idle' | 'checking' | 'ready' | 'failed'; reason?: string }; starting: boolean; commandTiming?: { startedAt: number; finishedAt?: number }; effectiveOptions?: { overwriteExisting: boolean; allowCollegeReset?: boolean } };
export interface ReadinessClient { checkReadiness(input: ReadinessRequest, context?: OperationContext): Promise<ReadinessResult> }
const safeReasons = new Set(['authentication-required', 'access-denied', 'resume-access-denied', 'resume-api-unavailable', 'resume-api-invalid', 'backend-unavailable', 'backend-invalid-response', 'settings-invalid', 'deadline-exceeded', 'cancelled', 'paused', 'document-changed']);

/** One shell entry point; availability is checked without scanning/opening/editing the form. */
export function createStartCoordinator({ runner, readinessClient, getDocumentId, timeoutMs = 15_000 }: {
  runner: Runner; readinessClient: ReadinessClient; getDocumentId(): string; timeoutMs?: number;
}) {
  let readiness: ShellState['readiness'] = { status: 'idle' };
  let effectiveOptions: ShellState['effectiveOptions'];
  let commandTiming: ShellState['commandTiming'];
  let starting = false, busy = false, disposed = false, generation = 0;
  let pending: AbortController | undefined;
  let interrupted = 'cancelled';
  const listeners = new Set<(state: ShellState) => void>();
  const getState = (): ShellState => ({ ...runner.getState(), readiness: { ...readiness }, starting, ...(commandTiming ? { commandTiming: { ...commandTiming } } : {}), ...(effectiveOptions ? { effectiveOptions: { ...effectiveOptions } } : {}) });
  const emit = () => { const state = getState(); for (const listener of listeners) listener(state); };
  const unsubscribe = runner.subscribe(emit);
  const interrupt = (reason: string) => { interrupted = reason; generation++; pending?.abort(); };
  const run = async (resume: boolean, options: StartOptions = {}): Promise<RunReport> => {
    if (disposed) throw new Error('cancelled');
    if (busy) throw new Error('run-in-progress');
    const phase = runner.getState().phase;
    if (resume ? phase !== 'paused' : !['idle', 'completed', 'partial', 'cancelled', 'failed'].includes(phase)) throw new Error('invalid-run-phase');
    busy = true; starting = true;
    commandTiming = { startedAt: Date.now() };
    if (!resume) effectiveOptions = { overwriteExisting: options.overwriteExisting === true, ...(options.allowCollegeReset === true ? { allowCollegeReset: true } : {}) };
    const mine = ++generation, documentId = getDocumentId();
    const controller = new AbortController(); pending = controller;
    const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + Math.max(1, Math.min(timeoutMs, 15_000)));
    const abort = () => { interrupted = 'cancelled'; controller.abort(); };
    const timer = setTimeout(() => { interrupted = 'deadline-exceeded'; controller.abort(); }, Math.max(0, deadlineAt - Date.now()));
    const navigation = setInterval(() => { if (getDocumentId() !== documentId) interrupt('document-changed'); }, 50);
    options.signal?.addEventListener('abort', abort, { once: true });
    let removeAbort = () => {};
    try {
      if (options.signal?.aborted) abort();
      readiness = { status: 'checking' }; emit();
      const cancelled = new Promise<never>((_, reject) => {
        const stop = () => reject(new Error(interrupted));
        if (controller.signal.aborted) stop(); else controller.signal.addEventListener('abort', stop, { once: true });
        removeAbort = () => controller.signal.removeEventListener('abort', stop);
      });
      await Promise.race([readinessClient.checkReadiness({ protocolVersion: PROTOCOL_VERSION, requestId: crypto.randomUUID(), runId: crypto.randomUUID(), deadlineAt }, { signal: controller.signal, deadlineAt }), cancelled]);
      if (disposed || mine !== generation || controller.signal.aborted || options.signal?.aborted) throw new Error(interrupted);
      if (Date.now() >= deadlineAt) throw new Error('deadline-exceeded');
      if (getDocumentId() !== documentId) throw new Error('document-changed');
      // Stop the preflight budget before the unchanged runner takes ownership.
      clearTimeout(timer); clearInterval(navigation); removeAbort(); pending = undefined;
      readiness = { status: 'ready' }; starting = false;
      // Do not emit between the last identity check and runner entry: listeners
      // may synchronously cancel. The runner's first progress event emits state.
      return await (resume ? runner.resume() : runner.start(options));
    } catch (error) {
      if (starting) {
        const reason = error instanceof Error && safeReasons.has(error.message) ? error.message : 'backend-unavailable';
        readiness = { status: 'failed', reason };
      }
      throw error;
    } finally {
      clearTimeout(timer); clearInterval(navigation); removeAbort();
      options.signal?.removeEventListener('abort', abort);
      if (pending === controller) pending = undefined;
      if (commandTiming) commandTiming.finishedAt = Date.now();
      starting = false; busy = false; emit();
    }
  };
  return {
    start: (options?: StartOptions) => run(false, options), resume: () => run(true),
    pause() { interrupt('paused'); runner.pause(); },
    cancel() { interrupt('cancelled'); runner.cancel(); },
    getState,
    subscribe(listener: (state: ShellState) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { disposed = true; interrupt('cancelled'); unsubscribe(); listeners.clear(); },
  };
}
