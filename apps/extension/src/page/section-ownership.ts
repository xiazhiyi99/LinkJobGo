/** A fallback/outer section must not borrow nodes from a declared inner section. */
export function ownsSectionNode(section: Element, node: Element, boundaries: readonly Element[]): boolean {
  return !boundaries.some(other => other !== section && section.contains(other) && other.contains(node));
}
