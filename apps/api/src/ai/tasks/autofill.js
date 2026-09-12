const { AiError } = require('../errors');

const validateAutofillResult = (result) => {
  if (!result || !Array.isArray(result.suggestions)) return { ok: false, message: '智能填写结果缺少 suggestions' };
  return { ok: true };
};
const autofillMessages = (input) => [
  { role: 'system', content: '你是求职网申辅助助手。只根据提供的资料生成建议，不自动提交表单。只返回 JSON，格式为 {"suggestions":[{"field":string,"value":string,"confidence":number,"needsConfirmation":boolean}]}。无法确定时 value 留空并将 needsConfirmation 设为 true。' },
  { role: 'user', content: JSON.stringify({ task: 'autofill.suggest', fields: input.fields, profile: input.profile, jobContext: input.jobContext }) },
];

const createAutofillService = (gateway) => ({
  suggest({ fields, profile, jobContext = {}, userId, requestId }) {
    if (!Array.isArray(fields) || !fields.length) throw new AiError('待填写字段不能为空', 'AI_INVALID_INPUT', { status: 400 });
    return gateway.run({ task: 'autofill.suggest', input: { fields, profile, jobContext }, userId, requestId, messages: autofillMessages({ fields, profile, jobContext }), validate: validateAutofillResult });
  },
});

module.exports = { createAutofillService, validateAutofillResult, autofillMessages };
