import { apiRequest } from '../../lib/api-client';
import { createProfileCache } from './profile-cache';

export type ProfileRecord = Record<string, unknown> & { id?: string };

export type ProfilePayload = {
  profile?: ProfileRecord | null;
  preferences?: ProfileRecord | null;
  educations?: ProfileRecord[];
  experiences?: ProfileRecord[];
  campusExperiences?: ProfileRecord[];
  projects?: ProfileRecord[];
  awards?: ProfileRecord[];
  publications?: ProfileRecord[];
  languages?: ProfileRecord[];
  certificates?: ProfileRecord[];
  skills?: ProfileRecord[];
  [key: string]: unknown;
};

const profileCache = createProfileCache<ProfilePayload>({ load: signal => apiRequest('/profiles/me', { signal }) });
export const setProfileAccount = profileCache.setAccount;
export const getCachedProfile = profileCache.getSnapshot;
export const subscribeProfile = profileCache.subscribe;
export const getProfile = (options: { fresh?: boolean } = {}) => profileCache.read(options.fresh);
const mutate = async <T>(operation: () => Promise<T>): Promise<T> => {
  const generation = profileCache.generation();
  const result = await operation();
  const payload = result as ProfilePayload | undefined;
  profileCache.update(current => ({ ...current,
    ...(payload?.profile ? { profile: { ...current.profile, ...payload.profile } } : {}),
    ...(payload?.preferences ? { preferences: { ...current.preferences, ...payload.preferences } } : {}),
  }), generation);
  return result;
};

export const updateProfile = (body: unknown) => mutate(() => apiRequest<ProfilePayload>('/profiles/me', {
  method: 'PATCH',
  body: JSON.stringify(body),
}));

export const updateProfilePreferences = (body: unknown) => mutate(() => apiRequest<ProfilePayload>('/profiles/me/preferences', {
  method: 'PATCH',
  body: JSON.stringify(body),
}));

export const uploadResume = (body: { filename: string; contentType: string; content: string }) => apiRequest('/profiles/me/resume', {
  method: 'POST',
  body: JSON.stringify(body),
});

export const importResume = (body: { result: unknown; idempotencyKey?: string; resolutions?: Record<string, 'replace' | 'keep'> }) => mutate(() => apiRequest('/profiles/me/resume/import', {
  method: 'POST',
  body: JSON.stringify(body),
}));

export type AiResumeParseResponse = {
  data: { profile: Record<string, unknown>; preferences: Record<string, unknown>; records: Record<string, Array<Record<string, string>>> };
  filename?: string;
  pages?: number;
  source?: Record<string, unknown>;
  normalized?: AiResumeParseResponse['data'];
  databaseReady?: { profile: Record<string, unknown>; preferences: Record<string, unknown>; records: Record<string, Array<Record<string, unknown>>> };
  requestId: string;
  attempts: Array<{ attempt: number; tier: string; status: string; model?: string }>;
};

export type AiResumeFileResponse = {
  filename: string;
  pages: number;
  source?: Record<string, unknown>;
  normalized?: Record<string, unknown>;
  /** Stable, database-ready payload returned by the API pipeline. */
  databaseReady?: { profile: Record<string, unknown>; preferences: Record<string, unknown>; records: Record<string, Array<Record<string, unknown>>>; unmapped?: unknown[] };
  /** Exact Prisma-oriented rows produced by the same projection used on import. */
  databaseRows?: { profile: Record<string, unknown>; preferences: Record<string, unknown>; educations: Array<Record<string, unknown>>; experiences: Array<Record<string, unknown>>; projects: Array<Record<string, unknown>>; skills: Array<Record<string, unknown>>; unmapped?: unknown[] };
  requestId?: string;
  attempts?: Array<{ attempt: number; tier: string; status: string; model?: string }>;
};

/**
 * Sends a document to the API resume pipeline. The API is responsible for
 * decoding PDF/Word/Markdown, extracting its contents and returning the
 * normalized, database-ready shape. Keeping the binary upload here means UI
 * components do not need to know how a document is parsed.
 */
export const parseResumeFileWithAi = (body: {
  filename: string;
  contentType: string;
  contentBase64: string;
  requestId?: string;
}) => apiRequest<AiResumeFileResponse>('/ai/resume/parse-file', {
  method: 'POST',
  body: JSON.stringify(body),
});

export const parseResumeWithAi = (body: { filename: string; content: string; requestId?: string }) => apiRequest<AiResumeParseResponse>('/ai/resume/parse', {
  method: 'POST',
  body: JSON.stringify(body),
});

export const normalizeResumeWithAi = (body: { payload: unknown; requestId?: string }) => apiRequest<AiResumeParseResponse>('/ai/resume/normalize', {
  method: 'POST',
  body: JSON.stringify({ payload: body.payload, requestId: body.requestId }),
});

const createRecordEndpoint = (resource: string) => ({
  create: (body: unknown) => mutate(() => apiRequest<ProfileRecord>(`/profiles/me/${resource}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })),
  update: (id: string, body: unknown) => mutate(() => apiRequest<ProfileRecord>(`/profiles/me/${resource}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })),
  remove: (id: string) => mutate(() => apiRequest<void>(`/profiles/me/${resource}/${id}`, { method: 'DELETE' })),
  restore: (id: string) => mutate(() => apiRequest<ProfileRecord>(`/profiles/me/${resource}/${id}/restore`, { method: 'POST' })),
});

export const profileRecordsApi = {
  educations: createRecordEndpoint('educations'),
  experiences: createRecordEndpoint('experiences'),
  projects: createRecordEndpoint('projects'),
  skills: createRecordEndpoint('skills'),
};
