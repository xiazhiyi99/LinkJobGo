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
  const multiField = sections.filter(element => element.querySelectorAll(options.controls).length >= 2);
  if (multiField.length < 2) return [];
  // A shared add control belongs to the collection, not an individual card.
  const sharedAdd = Array.from(parent.querySelectorAll('button,a,[role="button"],input[type="button"]')).some(button => options.visible(button) && !sections.some(section => section.contains(button)) && /^(添加|新增|增加|add)(\s|教育|工作|经历|记录|项目|$)/i.test((button.getAttribute('aria-label') || button.textContent || button.getAttribute('value') || '').replace(/\s+/g, ' ').trim()));
  if (sharedAdd) return [];
  const shape = (section: Element) => JSON.stringify(Array.from(section.querySelectorAll(options.controls)).map(field => [field.tagName, field.getAttribute('type'), field.getAttribute('role'), field.getAttribute('aria-label') || Array.from((field as HTMLInputElement).labels ?? []).map(options.readText).join(' ') || nearbyFieldCaption(field, options.readText, options.controls) || field.getAttribute('placeholder') || '']));
  // Numbered headings do not turn structurally identical records into modules.
  if (new Set(multiField.map(shape)).size === 1) return [];
  return sections;
}

/** Component libraries may render a caption label without a native `for`. */
export function nearbyFieldCaption(element: Element, readText: (element: Element) => string, controls: string): string {
  for (let parent = element.parentElement, depth = 0; parent && depth < 12; parent = parent.parentElement, depth++) {
    if (parent.matches('form,body,section,fieldset,[role="region"],[role="dialog"]')) break;
    const labels = Array.from(parent.querySelectorAll('label')).filter(label => !label.querySelector(interactive) && readText(label));
    if (labels.length > 1) break;
    if (!labels.length) continue;
    const candidates = Array.from(parent.querySelectorAll(controls));
    const fields = candidates.filter(field => !candidates.some(other => other !== field && other.contains(field)));
    if (fields.length > 2) break;
    const caption = readText(labels[0]!);
    if (caption.length > 80) return '';
    if (fields.length === 2 && /时间|日期|date|period/i.test(caption) && fields.every(field => field.matches('input:not([role="combobox"]):not([type="checkbox"]):not([type="radio"])'))) return `${caption}（${fields.indexOf(element) === 0 ? '开始' : '结束'}）`;
    // Shared captions provide context, but cannot name two unrelated inputs.
    return fields.length === 1 ? caption : '';
  }
  return '';
}
