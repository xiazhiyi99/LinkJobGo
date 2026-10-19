const { FIELD_CATALOG } = require('@job-assistant/autofill-contracts');
const { createMappingService, createAiResolver, createConfiguredSiteRegistry } = require('./dist/engine.cjs');
const { createPlatformResumeClient } = require('./adapters/resume-client');
const { createGatewayAiProvider } = require('./adapters/ai-provider');
const { createAutofillHandler } = require('./routes');
const { createSiteRulesAdminHandler } = require('./admin-routes');

const createAutofillModule = ({ profileService, aiGateway, authenticate, config = {} }) => {
  const siteRegistry = createConfiguredSiteRegistry({ mokaMode: config.mokaMode });
  const service = createMappingService({
    resumeClient: createPlatformResumeClient({ profileService }),
    siteRegistry,
    aiResolver: createAiResolver({ provider: createGatewayAiProvider({ aiGateway }) }),
    catalog: FIELD_CATALOG,
  });
  return {
    handle: createAutofillHandler({ service, authenticate, allowedOrigins: config.allowedOrigins }),
    handleAdminSites: createSiteRulesAdminHandler({ authenticate, list: () => siteRegistry.list(), allowedOrigins: config.allowedOrigins }),
    service,
  };
};

module.exports = { createAutofillModule };
