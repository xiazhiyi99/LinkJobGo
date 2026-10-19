const interactive = 'input,textarea,select,button,a,[contenteditable="true"],[role="combobox"],[role="button"]';

/** Read a static leading caption, never selected values or editable contents. */
export function leadingCaption(element: Element, readText: (element: Element) => string): string {
  const first = element.firstElementChild;
  if (!first || first.matches(interactive) || first.querySelector(interactive)) return '';
  let caption = first;
  while (caption.firstElementChild && caption.children.length === 1) caption = caption.firstElementChild;
  // A title and its help text are often siblings. Only the first names the block.
  const text = readText(caption.firstElementChild ?? caption);
  return text.length > 0 && text.length <= 80 ? text : '';
}

/** Infer sibling modules only when several have their own caption and form body. */
export function titledFormSections(parent: Element, options: { readText: (element: Element) => string; hasStructure: (element: Element) => boolean; visible: (element: Element) => boolean; controls: string }): Element[] {
  const sections = Array.from(parent.children).filter(element => options.visible(element) && element.children.length >= 2 && leadingCaption(element, options.readText) && options.hasStructure(element));
  // Single-field label/input rows alone are not independent resume sections.
  return sections.filter(element => element.querySelectorAll(options.controls).length >= 2).length >= 2 ? sections : [];
}

/** Component libraries may render a caption label without a native `for`. */
export function nearbyFieldCaption(element: Element, readText: (element: Element) => string, controls: string): string {
  for (let parent = element.parentElement, depth = 0; parent && depth < 12; parent = parent.parentElement, depth++) {
    if (parent.matches('form,body,section,fieldset,[role="region"],[role="dialog"]')) break;
    const labels = Array.from(parent.querySelectorAll('label')).filter(label => !label.querySelector(interactive) && readText(label));
    if (labels.length > 1) break;
    if (!labels.length) continue;
    const fields = Array.from(parent.querySelectorAll(controls));
    if (fields.length > 2) break;
    const caption = readText(labels[0]!);
    if (caption.length > 80) return '';
    if (fields.length === 2 && /时间|日期|date|period/i.test(caption) && fields.every(field => field.matches('input:not([role="combobox"]):not([type="checkbox"]):not([type="radio"])'))) return `${caption}（${fields.indexOf(element) === 0 ? '开始' : '结束'}）`;
    return caption;
  }
  return '';
}
