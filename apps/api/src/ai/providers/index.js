const { createHttpProvider } = require('./http-provider');
const { createFakeProvider } = require('./fake-provider');

const createProvider = (tier, capability = 'text') => {
  if (process.env.AI_PROVIDER_MODE === 'fake') return createFakeProvider({ tier });
  const tierPrefix = tier === 'official' ? 'OFFICIAL' : 'CHEAP';
  const prefix = capability === 'vision' ? `AI_VLM_${tierPrefix}` : `AI_${tierPrefix}`;
  return createHttpProvider({
    tier,
    provider: process.env[`${prefix}_PROVIDER`] || 'openai-compatible',
    baseUrl: process.env[`${prefix}_BASE_URL`],
    apiKey: process.env[`${prefix}_API_KEY`] || process.env.AI_API_KEY,
    model: process.env[`${prefix}_MODEL`],
  });
};

module.exports = { createProvider };
