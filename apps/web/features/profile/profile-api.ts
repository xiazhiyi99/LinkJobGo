import { apiRequest } from '../../lib/api-client';

export type ProfileRecord = Record<string, unknown> & { id?: string };

export type ProfilePayload = {
  profile?: ProfileRecord | null;
  preferences?: ProfileRecord | null;
  educations?: ProfileRecord[];
  experiences?: ProfileRecord[];
  campusExperiences?: ProfileRecord[];
  projects?: ProfileRecord[];
  awards?: ProfileRecord[];
  skills?: ProfileRecord[];
  [key: string]: unknown;
};

export const getProfile = () => apiRequest<ProfilePayload>('/profiles/me');

export const updateProfile = (body: unknown) => apiRequest<ProfilePayload>('/profiles/me', {
  method: 'PATCH',
  body: JSON.stringify(body),
});

export const updateProfilePreferences = (body: unknown) => apiRequest<ProfilePayload>('/profiles/me/preferences', {
  method: 'PATCH',
  body: JSON.stringify(body),
});

export const uploadResume = (body: { filename: string; contentType: string; content: string }) => apiRequest('/profiles/me/resume', {
  method: 'POST',
  body: JSON.stringify(body),
});

const createRecordEndpoint = (resource: string) => ({
  create: (body: unknown) => apiRequest<ProfileRecord>(`/profiles/me/${resource}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }),
  update: (id: string, body: unknown) => apiRequest<ProfileRecord>(`/profiles/me/${resource}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),
  remove: (id: string) => apiRequest<void>(`/profiles/me/${resource}/${id}`, { method: 'DELETE' }),
  restore: (id: string) => apiRequest<ProfileRecord>(`/profiles/me/${resource}/${id}/restore`, { method: 'POST' }),
});

export const profileRecordsApi = {
  educations: createRecordEndpoint('educations'),
  experiences: createRecordEndpoint('experiences'),
  projects: createRecordEndpoint('projects'),
  skills: createRecordEndpoint('skills'),
};
