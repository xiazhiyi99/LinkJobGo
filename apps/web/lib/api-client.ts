const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

export class ApiRequestError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.payload = payload;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...(init.headers || {}) },
    });
  } catch {
    throw new ApiRequestError('暂时无法连接服务，请确认 API 已启动。', 0, null);
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'object' && data && 'error' in data
      ? String((data as { error?: unknown }).error || '请求失败')
      : '请求失败';
    throw new ApiRequestError(message, response.status, data);
  }
  return data as T;
}
