import type { ComboControl, ControlAdapter } from './index.js';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const popupSelector = 'body > div.el-select-dropdown.el-popper.is-multiple.country-select-popper';
function visible(node: HTMLElement): boolean {
  if (!node.isConnected || !node.getClientRects().length || node.getBoundingClientRect().height <= 0) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(parent);
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
const rectKey = (node: HTMLElement) => { const box = node.getBoundingClientRect(); return `${box.left}:${box.top}:${box.width}:${box.height}`; };
interface Ownership { before: Map<HTMLElement, string>; opening: boolean; proven?: HTMLElement }

/** Verified Tencent work-intent city multi-select, with no deletion capability. */
export function createTencentCityControlAdapter(): ControlAdapter {
  const states = new WeakMap<HTMLElement, Ownership>();
  const owners = new WeakMap<HTMLElement, HTMLElement>();
  const combo = (element: HTMLElement): ComboControl | undefined => {
    const location = element.ownerDocument.location;
    if (location.origin !== 'https://careers.tencent.com' || location.pathname !== '/resume.html' || !element.matches('div.el-select.custom-selected[filterable][multiple="multiple"][clearable][popper-class="country-select-popper"][placeholder="请选择城市"]')) return;
    const root = element, section = root.closest<HTMLElement>('.information');
    if (!section?.parentElement?.matches('.resume-content') || !['工作意向', '求职意向'].includes(clean(section.querySelector(':scope > .title')?.textContent))) return;
    const caption = root.closest('.resume-module-left,.resume-module-right,.resume-module')?.querySelector(':scope > p.text');
    const staticSpan = caption && Array.from(caption.children).find(node => node.tagName === 'SPAN' && !clean(node.getAttribute('class')));
    const fieldLabel = clean(staticSpan?.textContent || Array.from(caption?.childNodes ?? []).filter(node => node.nodeType === 3).map(node => node.textContent).join('')).replace(/[＊*：:]+$/u, '').trim();
    if (fieldLabel !== '期望工作城市') return;
    const triggers = root.querySelectorAll<HTMLInputElement>(':scope > div.el-input.el-input--suffix > input.el-input__inner[readonly]');
    const tagContainers = root.querySelectorAll<HTMLElement>(':scope > div.el-select__tags');
    if (triggers.length !== 1 || tagContainers.length !== 1) return;
    const trigger = triggers[0]!, tags = tagContainers[0]!;
    const carets = root.querySelectorAll<HTMLElement>(':scope > div.el-input.el-input--suffix > .el-input__suffix .el-select__caret.el-input__icon.el-icon-arrow-up');
    if (carets.length !== 1) return;
    const caret = carets[0]!;
    let state = states.get(root);
    if (!state) { state = { before: new Map(), opening: false }; states.set(root, state); }
    const current = state;
    const local = () => root.isConnected && trigger.parentElement?.parentElement === root && tags.parentElement === root && caret.closest('.el-select') === root;
    const expanded = () => local() && caret.classList.contains('is-reverse');
    const panels = () => Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(popupSelector)).filter(visible);
    const anchored = (panel: HTMLElement) => {
      const box = root.getBoundingClientRect(), popup = panel.getBoundingClientRect();
      return box.width > 0 && Math.abs(popup.width - box.width) <= 24 && Math.abs(popup.left - box.left) <= 16 &&
        (Math.abs(popup.top - box.bottom) <= 24 || Math.abs(popup.bottom - box.top) <= 24) && /^(?:bottom|top)-start$/.test(panel.getAttribute('x-placement') ?? '');
    };
    const panelFor = () => {
      if (!expanded() || !visible(root)) return;
      const eligible = panels().filter(anchored);
      if (eligible.length !== 1) return;
      const panel = eligible[0]!, active = root.ownerDocument.activeElement;
      if (!(active && (root.contains(active) || owners.get(panel) === root && panel.contains(active)))) return;
      if (!(owners.get(panel) === root || current.opening && (!current.before.has(panel) || current.before.get(panel) !== rectKey(panel)))) return;
      if (panel.querySelectorAll('ul.el-select-dropdown__list').length !== 1) return;
      current.proven = panel; owners.set(panel, root); return panel;
    };
    const labels = () => Array.from(tags.querySelectorAll<HTMLElement>('.el-tag > .el-select__tags-text')).filter(node => node.closest('.el-select') === root && visible(node)).map(node => clean(node.textContent));
    const checkbox = (node: HTMLElement) => {
      const choices = node.querySelectorAll<HTMLInputElement>(':scope > div.custom-label > label.el-checkbox input.el-checkbox__original[type="checkbox"]');
      return choices.length === 1 ? choices[0] : undefined;
    };
    const optionLabel = (node: HTMLElement) => {
      const text = node.querySelectorAll<HTMLElement>(':scope > div.custom-label > span.label-txt');
      return text.length === 1 ? clean(text[0]!.textContent) : '';
    };
    const disabled = (node: HTMLElement) => Boolean(node.closest('[disabled],[aria-disabled="true"],.is-disabled') || checkbox(node)?.disabled);
    const tagCount = Array.from(tags.querySelectorAll<HTMLElement>('.el-tag')).filter(node => node.closest('.el-select') === root && visible(node)).length;
    const unsupportedReason = root.matches('.is-disabled') || trigger.disabled ? 'tencent-city-disabled' : tagCount !== labels().length || labels().some(label => !label) ? 'tencent-city-selected-label-unproven' : undefined;
    return {
      ...(unsupportedReason ? { unsupportedReason } : {}),
      beforeOpen() { current.before = new Map(panels().map(panel => [panel, rectKey(panel)])); current.opening = true; },
      focusTarget: () => trigger,
      openTarget: () => trigger,
      closeTarget: () => trigger,
      panel: panelFor,
      isOpen: () => expanded() || Boolean(current.proven && visible(current.proven)),
      readValue: labels,
      options: panel => panel === panelFor() ? Array.from(panel.querySelectorAll<HTMLElement>('ul.el-select-dropdown__list > li.el-select-dropdown__item')).filter(node => visible(node) && checkbox(node) && optionLabel(node)) : [],
      optionLabel,
      optionDisabled: disabled,
      searchInput: () => null,
      multiple: {
        choiceTarget: node => checkbox(node) && !disabled(node) ? node : undefined,
        choiceSelected: node => checkbox(node)?.checked === true,
      },
      loading: panel => Array.from(panel.querySelectorAll<HTMLElement>('[aria-busy="true"],[role="progressbar"],.el-loading-mask')).some(visible),
    };
  };
  return { combo };
}
