import type { SectionSnapshot, SemanticSection, SectionPlan } from '@job-assistant/autofill-contracts';

/** Only a complete, known-site overwrite plan can authorize tail removal. */
export function excessRecordIds(input: { section: SectionSnapshot; semantic: SemanticSection; plan: SectionPlan; overwrite: boolean; scoped: boolean; knownSite: boolean }): string[] {
  const { section, semantic, plan } = input;
  if (!input.overwrite || input.scoped || !input.knownSite || section.mode !== 'inline' || !section.repeatable || !semantic.recordType || semantic.recordVariants || plan.recordType !== semantic.recordType || !semantic.bindings.some(binding => binding.status === 'resolved' && binding.sourceKey?.scope === 'record' && binding.sourceKey.recordType === semantic.recordType)) return [];
  if (plan.records.some((record, index) => record.recordType !== semantic.recordType || record.targetIndex !== index || !record.recordId)) return [];
  return section.records.slice(plan.records.length).map(record => record.viewId).reverse();
}
