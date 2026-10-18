import type { SiteParser } from './registry.js';

// Explicit equivalences only, restricted to their source semantics. Exam levels
// never acquire a proficiency or conversation meaning from the candidate list.
export const resolveResumeOption: NonNullable<SiteParser['resolveOption']> = ({ sourceKey, sourceValue, candidates }) => {
  const exact = candidates.filter(candidate => !candidate.disabled && candidate.label.trim() === String(sourceValue).trim());
  if (exact.length > 0) return exact.length === 1 ? exact[0].optionId : null;
  if (typeof sourceValue !== 'string') return null;
  let equivalent: (label: string) => boolean = () => false;
  if (sourceKey.scope === 'profile' && sourceKey.path.join('.') === 'highestEducation' || sourceKey.scope === 'record' && sourceKey.recordType === 'education' && sourceKey.path.join('.') === 'fields.degree') {
    const groups = [['本科', '大学本科'], ['硕士', '硕士研究生'], ['博士', '博士研究生'], ['大专', '大学专科', '专科']];
    const group = groups.find(labels => labels.includes(sourceValue.trim()));
    equivalent = label => Boolean(group?.includes(label.trim()));
  } else if (sourceKey.scope === 'record' && sourceKey.recordType === 'language' && ['fields.level', 'fields.certificate'].includes(sourceKey.path.join('.'))) {
    const exam = (value: string) => {
      const text = value.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
      const code = /^CET-?([46])$/.exec(text)?.[1];
      if (code) return code;
      const chinese = /^(?:大学英语|英语)([四六])级(?:考试|证书)?$/.exec(text)?.[1];
      return chinese === '四' ? '4' : chinese === '六' ? '6' : null;
    };
    const sourceExam = exam(sourceValue);
    equivalent = label => sourceExam !== null && exam(label) === sourceExam;
  }
  const matches = candidates.filter(candidate => !candidate.disabled && equivalent(candidate.label));
  return matches.length === 1 ? matches[0].optionId : null;
};
