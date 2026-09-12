import { apiRequest } from '../../lib/api-client';

export type AutofillSuggestion = {
  field: string;
  value: string;
  confidence: number;
  needsConfirmation: boolean;
};

export type AutofillResponse = {
  data: { suggestions: AutofillSuggestion[] };
  requestId: string;
  attempts: Array<{ attempt: number; tier: string; status: string; model?: string }>;
};

export const getAutofillSuggestions = (input: {
  fields: string[];
  profile: Record<string, unknown>;
  jobContext?: Record<string, unknown>;
  requestId?: string;
}) => apiRequest<AutofillResponse>('/ai/autofill/suggestions', {
  method: 'POST',
  body: JSON.stringify(input),
});
