const CAPTCHA_CONFIG = {
  aliyun: {
    region: 'cn',
    regionId: 'cn-shanghai',
    endpoint: 'captcha.cn-shanghai.aliyuncs.com',
  },
  aliyun_sgp: {
    region: 'sgp',
    regionId: 'sgp',
    endpoint: 'captcha.ap-southeast-1.aliyuncs.com',
  },
};

const captchaError = (message, status = 400, code = 'CAPTCHA_FAILED') => Object.assign(new Error(message), { status, code });

function createCaptchaVerifier({ env = process.env, logger = console } = {}) {
  const production = env.NODE_ENV === 'production';
  const provider = String(env.CAPTCHA_PROVIDER || (production ? 'aliyun' : 'disabled')).toLowerCase();

  if (provider === 'disabled') {
    return async () => {
      if (production) throw captchaError('验证码服务未配置', 503, 'CAPTCHA_NOT_CONFIGURED');
    };
  }

  if (provider !== 'aliyun' && provider !== 'aliyun_sgp') {
    throw new Error(`不支持的 CAPTCHA_PROVIDER：${provider}`);
  }

  const config = CAPTCHA_CONFIG[provider];
  const regionId = String(env.ALIYUN_CAPTCHA_REGION_ID || config.regionId);
  const endpoint = String(env.ALIYUN_CAPTCHA_ENDPOINT || config.endpoint);
  const sceneId = String(env.ALIYUN_CAPTCHA_SCENE_ID || '');
  const accessKeyId = String(env.ALIYUN_CAPTCHA_ACCESS_KEY_ID || env.ALIYUN_ACCESS_KEY_ID || '');
  const accessKeySecret = String(env.ALIYUN_CAPTCHA_ACCESS_KEY_SECRET || env.ALIYUN_ACCESS_KEY_SECRET || '');
  if (!sceneId || !accessKeyId || !accessKeySecret) {
    return async () => { throw captchaError('验证码服务未配置完整', 503, 'CAPTCHA_NOT_CONFIGURED'); };
  }

  let client;
  let Captcha;
  try {
    Captcha = require('@alicloud/captcha20230305');
    const OpenApi = require('@alicloud/openapi-client');
    client = new Captcha.default(new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      regionId,
      endpoint,
      connectTimeout: 10000,
      readTimeout: 10000,
    }));
  } catch (error) {
    logger.error?.('[captcha] Alibaba SDK unavailable:', error.message);
    return async () => { throw captchaError('验证码服务暂不可用', 503, 'CAPTCHA_UNAVAILABLE'); };
  }

  return async (captcha) => {
    const raw = typeof captcha === 'string'
      ? captcha
      : captcha?.captchaVerifyParam || captcha?.param || '';
    if (!raw || raw.length > 20000) throw captchaError('请先完成安全验证');

    try {
      const response = await client.verifyIntelligentCaptcha(new Captcha.VerifyIntelligentCaptchaRequest({
        // Alibaba requires the client callback payload to be forwarded unchanged.
        captchaVerifyParam: raw,
        sceneId,
      }));
      const result = response?.body?.result;
      if (!(response?.body?.success && result?.verifyResult)) {
        throw captchaError('安全验证未通过');
      }
    } catch (error) {
      if (error?.code === 'CAPTCHA_FAILED') throw error;
      logger.warn?.('[captcha] verification failed:', error?.message || 'unknown error');
      throw captchaError('安全验证暂时失败，请重试', 400, 'CAPTCHA_FAILED');
    }
  };
}

module.exports = { createCaptchaVerifier, captchaError };
