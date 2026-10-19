import type { SemanticSection } from '@job-assistant/autofill-contracts';

/** Field mappings alone cannot select the internship subset of work history. */
export function requiresInternshipFilter(label: string, section: SemanticSection): boolean {
  return /^(实习经历|实习经验|internships?|internship experience)$/i.test(label.trim()) && section.recordType === 'experience' && section.recordFilter !== 'internships';
}
