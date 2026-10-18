export class ServiceError extends Error {
  code: string;
  status: number;
  retryable: boolean;
  constructor(code: string, message: string, status?: number, retryable?: boolean);
}
export function checkDeadline(ctx: { signal?: AbortSignal; deadlineAt: number }): void;
