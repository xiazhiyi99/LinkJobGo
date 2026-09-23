export type ResumeDraft = {
  values: Record<string, string>;
  records: Record<string, Array<Record<string, string>>>;
  sourceName: string;
  sourceText: string;
  /** Binary imports are parsed and retained by the API; no local text is available. */
  sourceContentType?: string;
  sourceStored?: boolean;
  sourceFingerprint?: string;
};

const valueAfterLabel = (text: string, labels: string[]) => {
  const label = labels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return text.match(new RegExp(`(?:${label})[：:]\\s*([^\\n]+)`))?.[1]?.trim() || '';
};

const sectionText = (text: string, heading: string) => text.match(new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n##\\s|$)`))?.[0] || '';
const bulletLines = (text: string) => [...text.matchAll(/^[-*]\s+(.+)$/gm)].map((item) => item[1].trim());
const numberedLines = (text: string) => [...text.matchAll(/^\d+\.\s+(.+)$/gm)].map((item) => item[1].trim());
const entryBlocks = (text: string, heading: string) => {
  const block = sectionText(text, heading);
  const headings = [...block.matchAll(/^###\s+([^\n]+)$/gm)];
  return headings.map((match, index) => ({ title: match[1].trim(), body: block.slice(match.index! + match[0].length, headings[index + 1]?.index ?? block.length) }));
};
const datesOf = (body: string) => body.match(/(\d{4}-\d{2})\s*-\s*(\d{4}-\d{2}|至今)?/)?.slice(1) || [];
const cityOf = (body: string) => body.match(/\|\s*([^\n|]+)\s*$/m)?.[1]?.trim() || '';
const bulletsOf = (body: string) => bulletLines(body).filter((item) => !/^部门[：:]/.test(item));

const parseEducation = (text: string) => entryBlocks(text, '教育经历').map(({ title, body }) => {
  const parts = title.split('|').map((part) => part.trim());
  const dates = datesOf(body);
  const bullets = bulletLines(body);
  const gpa = bullets.find((item) => /^GPA[：:]/i.test(item))?.replace(/^GPA[：:]\s*/i, '') || '';
  const rank = gpa.match(/专业\s*(前\s*[^，。]+)/)?.[1] || '';
  const courses = bullets.find((item) => /^(?:主修课程|交换课程)[：:]/.test(item))?.replace(/^(?:主修课程|交换课程)[：:]\s*/, '') || '';
  const research = bullets.find((item) => /^研究方向[：:]/.test(item))?.replace(/^研究方向[：:]\s*/, '') || '';
  const description = bullets.filter((item) => !/^GPA[：:]/i.test(item) && !/^(?:主修课程|交换课程|研究方向)[：:]/.test(item)).join('\n');
  return { school: parts[0] || '', major: parts[1] || '', degree: parts[2] || '', educationType: parts[3] || '', startDate: dates[0] || '', endDate: dates[1] || '', current: dates[1] === '至今' ? '在读' : '已毕业', schoolCity: cityOf(body), gpa, rank, courses, research, description };
});

const parseExperience = (text: string) => entryBlocks(text, '实习经历').map(({ title, body }) => {
  const parts = title.split('|').map((part) => part.trim());
  const dates = datesOf(body);
  const bullets = bulletLines(body);
  const department = bullets.find((item) => /^部门[：:]/.test(item))?.replace(/^部门[：:]\s*/, '') || '';
  const achievements = bullets.filter((item) => !/^部门[：:]/.test(item)).join('\n');
  return { company: parts[0] || '', title: parts[1] || '', startDate: dates[0] || '', endDate: dates[1] || '', current: dates[1] === '至今' ? '在职' : '已离职', city: cityOf(body), department, description: achievements, achievements };
});

const parseProjects = (text: string) => entryBlocks(text, '项目经历').map(({ title, body }) => {
  const parts = title.split('|').map((part) => part.trim());
  const dates = datesOf(body);
  const bullets = bulletsOf(body);
  const organization = bullets.find((item) => /^所属单位[：:]/.test(item))?.replace(/^所属单位[：:]\s*/, '') || '';
  const description = bullets.filter((item) => !/^所属单位[：:]/.test(item)).join('\n');
  return { name: parts[0] || '', role: parts[1] || '', startDate: dates[0] || '', endDate: dates[1] || '', organization, description, responsibilities: description, url: body.match(/https?:\/\/\S+/)?.[0] || '' };
});

const parseCampus = (text: string) => entryBlocks(text, '校园与社会经历').map(({ title, body }) => {
  const parts = title.split('|').map((part) => part.trim());
  const dates = datesOf(body);
  return { title: parts[1] || parts[0] || '', activity: parts[0] || '', startDate: dates[0] || '', endDate: dates[1] || '', description: bulletsOf(body).join('\n') };
});

const parseAwards = (text: string) => bulletLines(sectionText(text, '竞赛、奖项与荣誉')).map((item) => {
  const match = item.match(/^(\d{4}-\d{2})\s*[：|]\s*(.+)$/);
  return { date: match?.[1] || '', name: match?.[2] || item, category: '竞赛/荣誉', level: '', rank: '' };
});

const parsePublications = (text: string) => numberedLines(sectionText(text, '论文与专利')).map((item) => {
  const title = item.match(/\*\*(.+?)\*\*/)?.[1] || item;
  return { name: title, title, type: /专利/.test(item) ? '专利' : '论文', year: item.match(/[,，]\s*(\d{4})/)?.[1] || '', role: item.match(/(第一作者|第二作者)/)?.[1] || '', description: item };
});

const parseSkillRecords = (text: string) => {
  const lines = bulletLines(sectionText(text, '技能与证书'));
  const skills: Array<Record<string, string>> = [];
  const languages: Array<Record<string, string>> = [];
  const certificates: Array<Record<string, string>> = [];
  for (const line of lines) {
    const [label, ...rest] = line.split(/[：:]/);
    const value = rest.join(':').trim();
    if (/^(英语|中文)$/.test(label)) {
      const exam = value.match(/(CET-4|CET-6|IELTS)\s*([\d.]+)/);
      languages.push({ kind: 'language', language: label, level: /母语/.test(value) ? '母语' : '熟练', certificate: exam?.[1] || '', score: exam?.[2] || '', usage: value });
    } else if (/^(证书|考试)$/.test(label)) {
      certificates.push({ kind: 'certificate', name: value, issuer: '', obtainedAt: '' });
    } else {
      skills.push({ kind: 'skill', category: label || '技能', name: value || label });
    }
  }
  return { skills, languages, certificates };
};

export function parseResumeText(text: string, sourceName = 'resume.txt'): ResumeDraft {
  const values: Record<string, string> = {
    name: valueAfterLabel(text, ['姓名']), gender: valueAfterLabel(text, ['性别']), birthday: valueAfterLabel(text, ['出生日期']),
    citizenship: valueAfterLabel(text, ['国籍']), nationality: valueAfterLabel(text, ['民族']), politicalStatus: valueAfterLabel(text, ['政治面貌']),
    phone: valueAfterLabel(text, ['手机', '手机号']), email: valueAfterLabel(text, ['电子邮箱', '邮箱']), wechat: valueAfterLabel(text, ['微信']),
    homeCity: valueAfterLabel(text, ['现居地']), nativePlace: valueAfterLabel(text, ['籍贯']), targetCities: valueAfterLabel(text, ['期望工作地点']),
    highestEducation: valueAfterLabel(text, ['最高学历']), firstWorkYear: valueAfterLabel(text, ['首次参加工作年份']), targetTitles: valueAfterLabel(text, ['求职方向']),
    availableFrom: valueAfterLabel(text, ['可入职日期']), fullTimeStudent: valueAfterLabel(text, ['是否全日制在校生']),
    relocation: valueAfterLabel(text, ['是否接受调剂']), hasRelativesInCompany: valueAfterLabel(text, ['是否有亲友在应聘企业就职']),
    recommendationMethod: valueAfterLabel(text, ['推荐方式']), workVisaRequired: valueAfterLabel(text, ['是否需要工作签证']),
    selfIntroduction: sectionText(text, '自我评价').replace(/^##\s*自我评价\s*/m, '').trim(),
  };
  const skillRecords = parseSkillRecords(text);
  return {
    values,
    records: {
      教育经历: parseEducation(text),
      '工作/实习经历': parseExperience(text),
      项目经历: parseProjects(text),
      在校经历: parseCampus(text),
      获奖经历: parseAwards(text),
      论文与专利: parsePublications(text),
      技能: skillRecords.skills,
      语言能力: skillRecords.languages,
      证书信息: skillRecords.certificates,
    },
    sourceName,
    sourceText: text,
  };
}
