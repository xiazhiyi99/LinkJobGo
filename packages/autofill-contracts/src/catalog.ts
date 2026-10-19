import type { FieldCatalog, RecordType, SourceKey } from './types.js';

export const PROFILE_FIELDS = ['name','avatarUrl','phone','city','personalWebsite','githubUrl','portfolioUrl','gender','birthday','homeCity','homeDistrict','schoolCity','address','politicalStatus','nationality','citizenship','wechat','nativePlace','highestEducation','firstWorkYear','fullTimeStudent','hasRelativesInCompany','recommendationMethod','workVisaRequired','workExperience','interests','selfIntroduction','email'] as const;
export const PREFERENCE_FIELDS = ['targetTitles','targetCities','employmentType','targetIndustries','availableFrom','salaryExpectation','relocation','preferenceNote'] as const;
const education = ['school','degree','major','startDate','endDate','current','gpa','courses'];
const experience = ['company','title','city','startDate','endDate','current','description'];
const project = ['name','role','startDate','endDate','url','description'];
const skill = ['name','level','certificate','issuer','obtainedAt'];
export const RECORD_FIELDS: Record<RecordType, readonly string[]> = { education, experience, campus: experience, project, award: project, publication: project, skill, language: skill, certificate: skill };
const labels: Record<string, string> = { name:'姓名或名称', avatarUrl:'头像链接', phone:'手机号码', city:'所在城市', personalWebsite:'个人网站', githubUrl:'GitHub链接', portfolioUrl:'作品集链接', gender:'性别', birthday:'出生日期', homeCity:'家庭所在城市', homeDistrict:'家庭所在区县', schoolCity:'学校城市', address:'地址', politicalStatus:'政治面貌', nationality:'民族', citizenship:'国籍', wechat:'微信号', nativePlace:'籍贯', highestEducation:'最高学历', firstWorkYear:'首次工作年份', fullTimeStudent:'是否全日制在读学生', hasRelativesInCompany:'是否有亲属在本公司', recommendationMethod:'推荐方式', workVisaRequired:'是否需要工作签证', workExperience:'工作年限', interests:'兴趣爱好', selfIntroduction:'自我介绍', email:'电子邮箱', targetTitles:'期望职位', targetCities:'期望城市', employmentType:'求职类型', targetIndustries:'期望行业', availableFrom:'到岗时间', salaryExpectation:'期望薪资', relocation:'是否接受调动', preferenceNote:'求职备注', school:'学校', degree:'学历学位', major:'专业', startDate:'开始日期', endDate:'结束日期', current:'是否至今', gpa:'绩点', courses:'主修课程', company:'公司或组织', title:'职位', description:'经历描述', role:'角色', url:'项目链接', level:'水平或等级', certificate:'证书', issuer:'颁发机构', obtainedAt:'取得时间' };
export const FIELD_CATALOG: FieldCatalog = [
  { sourceKey: { scope: 'record', recordType: 'education', path: ['extra', 'educationType'] }, label: '教育经历类型', valueType: 'string' },
  { sourceKey: { scope: 'record', recordType: 'project', path: ['extra', 'organization'] }, label: '项目所属组织', valueType: 'string' },
  { sourceKey: { scope: 'record', recordType: 'publication', path: ['extra', 'publicationType'] }, label: '成果类型', valueType: 'string' },
  { sourceKey: { scope: 'record', recordType: 'language', path: ['extra', 'score'] }, label: '语言考试分数', valueType: 'string' },
  ...PROFILE_FIELDS.map(field => ({ sourceKey: { scope:'profile' as const, path:[field] }, label:labels[field]!, valueType:'string' as const })),
  ...PREFERENCE_FIELDS.map(field => ({ sourceKey: { scope:'preferences' as const, path:[field] }, label:labels[field]!, valueType:'string' as const })),
  ...Object.entries(RECORD_FIELDS).flatMap(([recordType, fields]) => fields.map(field => ({ sourceKey: { scope:'record' as const, recordType:recordType as RecordType, path:['fields',field] }, label:labels[field]!, valueType:field==='current' ? 'boolean' as const : 'string' as const }))),
];
export const sourceKeyId = (key: SourceKey): string => JSON.stringify([key.scope, key.scope==='record'?key.recordType:null, key.path]);
