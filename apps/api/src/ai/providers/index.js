const { createHttpProvider } = require('./http-provider');
const { createFakeProvider } = require('./fake-provider');

const createProvider = (tier) => {
  if (process.env.AI_PROVIDER_MODE === 'fake') return createFakeProvider({ tier });
  const prefix = tier === 'official' ? 'AI_OFFICIAL' : 'AI_CHEAP';
  return createHttpProvider({
    tier,
    provider: process.env[`${prefix}_PROVIDER`] || 'openai-compatible',
    baseUrl: process.env[`${prefix}_BASE_URL`],
    apiKey: process.env[`${prefix}_API_KEY`] || process.env.AI_API_KEY,
    model: process.env[`${prefix}_MODEL`],
  });
};

module.exports = { createProvider };
