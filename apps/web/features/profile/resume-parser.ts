export type ResumeDraft = {
  values: Record<string, string>;
  records: Record<string, Array<Record<string, string>>>;
  sourceName: string;
  sourceText: string;
};

const valueAfterLabel = (text: string, labels: string[]) => {
  const label = labels.join('|');
  return text.match(new RegExp(`(?:${label})[：:]\\s*([^\\n]+)`))?.[1]?.trim() || '';
};

const parseResumeEntries = (text: string, heading: string, section: string) => {
  const block = text.match(new RegExp(`##\\s*${heading}[\\s\\S]*?(?=\\n##\\s|$)`))?.[0] || '';
  const headings = [...block.matchAll(/^###\s+([^\n]+)$/gm)];
  return headings.map((match, index) => {
    const body = block.slice(match.index! + match[0].length, headings[index + 1]?.index ?? block.length);
    const parts = match[1].split('|').map((part) => part.trim());
    const dates = body.match(/(\d{4}-\d{2})\s*-\s*(\d{4}-\d{2}|至今)?/)?.slice(1) || [];
    const city = body.match(/\|\s*([^\n|]+)\s*$/m)?.[1]?.trim() || '';
    const bullets = [...body.matchAll(/^[-*]\s+(.+)$/gm)].map((item) => item[1].trim()).join('\n');
    if (section === 'education') {
      return { school: parts[0] || '', major: parts[1] || '', degree: parts[2] || '', startDate: dates[0] || '', endDate: dates[1] || '', current: dates[1] === '至今' ? '在读' : '已毕业', schoolCity: city, description: bullets };
    }
    if (section === 'experience') {
      return { company: parts[0] || '', title: parts[1] || '', startDate: dates[0] || '', endDate: dates[1] || '', current: dates[1] === '至今' ? '在职' : '已离职', city, description: bullets };
    }
    return { name: parts[0] || '', role: parts[1] || '', startDate: dates[0] || '', endDate: dates[1] || '', description: bullets, url: body.match(/https?:\/\/\S+/)?.[0] || '' };
  });
};

export function parseResumeText(text: string, sourceName = 'resume.txt'): ResumeDraft {
  const values: Record<string, string> = {
    name: valueAfterLabel(text, ['姓名']),
    gender: valueAfterLabel(text, ['性别']),
    birthday: valueAfterLabel(text, ['出生日期']),
    nationality: valueAfterLabel(text, ['国籍']),
    politicalStatus: valueAfterLabel(text, ['政治面貌']),
    phone: valueAfterLabel(text, ['手机', '手机号']),
    email: valueAfterLabel(text, ['电子邮箱', '邮箱']),
    homeCity: valueAfterLabel(text, ['现居地']),
    targetCities: valueAfterLabel(text, ['期望工作地点']),
    targetTitles: valueAfterLabel(text, ['求职方向']),
    availableFrom: valueAfterLabel(text, ['可入职日期']),
  };
  return {
    values,
    records: {
      教育经历: parseResumeEntries(text, '教育经历', 'education'),
      '工作/实习经历': parseResumeEntries(text, '实习经历', 'experience'),
      项目经历: parseResumeEntries(text, '项目经历', 'project'),
    },
    sourceName,
    sourceText: text,
  };
}
