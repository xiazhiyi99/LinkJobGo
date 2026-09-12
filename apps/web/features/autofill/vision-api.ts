import { apiRequest } from '../../lib/api-client';

export type VisionExtractResponse = {
  data: Record<string, unknown>;
  requestId: string;
  attempts: Array<{ attempt: number; tier: string; status: string; model?: string }>;
};

export const extractFromImages = (input: {
  images: Array<{ url?: string; data?: string; mimeType?: string }>;
  instruction?: string;
  requestId?: string;
}) => apiRequest<VisionExtractResponse>('/ai/vision/extract', {
  method: 'POST',
  body: JSON.stringify(input),
});
