import type { ComboControl, ControlAdapter } from './index.js';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const visible = (node: HTMLElement) => node.isConnected && node.getClientRects().length > 0 && node.ownerDocument.defaultView!.getComputedStyle(node).visibility !== 'hidden';
const rectKey = (node: HTMLElement) => { const r = node.getBoundingClientRect(); return `${r.left}:${r.top}:${r.width}:${r.height}`; };
const panels = (root: HTMLElement) => Array.from(root.ownerDocument.querySelectorAll<HTMLElement>('.ud__select__dropdown')).filter(visible);
const inputFor = (element: HTMLElement) => element.matches('input[role="combobox"][readonly]') && element.closest<HTMLElement>('.ud__select');
const captionFor = (root: HTMLElement) => {
  const scope = root.closest<HTMLElement>('.ud-formily-item');
  const element = scope?.querySelector<HTMLElement>(':scope > .ud-formily-item-label');
  return scope && element && !element.querySelector('label[for],input,textarea,select,button,a,[role],[tabindex],[onclick],[contenteditable]') ? { element, scope } : undefined;
};

/** Universe UI single select: DOM interaction only, no résumé labels or mappings. */
export function createUniverseSelectControlAdapter(): ControlAdapter {
  const ownership = new WeakMap<HTMLElement, HTMLElement>();
  const before = new WeakMap<HTMLElement, Map<HTMLElement, string>>();
  const combo = (element: HTMLElement): ComboControl | undefined => {
    const root = inputFor(element);
    if (!root || root.querySelectorAll('input[role="combobox"]').length !== 1 || root.querySelector('.ud__select__selector-multiple')) return undefined;
    const caption = captionFor(root);
    const isOpen = () => Boolean(root.querySelector('.ud__select__selector-open'));
    const panel = () => {
      if (!isOpen() || !visible(root)) return undefined;
      const r = root.getBoundingClientRect();
      const matches = panels(root).filter(p => {
        const q = p.getBoundingClientRect();
        const anchored = Math.abs(q.width - r.width) <= 24 && (Math.abs(q.left - r.left) <= 16 || Math.abs(q.right - r.right) <= 16) && (Math.abs(q.top - r.bottom) <= 24 || Math.abs(q.bottom - r.top) <= 24);
        const prior = before.get(root);
        return anchored && p.querySelector('.ud__select__list') && (ownership.get(p) === root || prior && (!prior.has(p) || prior.get(p) !== rectKey(p)));
      });
      if (matches.length !== 1) return undefined;
      ownership.set(matches[0]!, root);
      return matches[0];
    };
    return {
      ...(!caption ? { unsupportedReason: 'universe-select-dismissal-unproven' } : {}),
      beforeOpen() { before.set(root, new Map(panels(root).map(p => [p, rectKey(p)]))); },
      panel, isOpen, openTarget: () => element, closeTarget: () => element,
      dismiss: () => caption ?? null,
      readValue: () => clean(root.querySelector('.ud__select__selector__selectItem')?.textContent),
      options: p => p === panel() ? Array.from(p.querySelectorAll<HTMLElement>('.ud__select__list__item')).filter(visible) : [],
      optionLabel: node => clean(node.querySelector('.ud__select__list__item__content')?.textContent),
      optionDisabled: node => node.classList.contains('ud__select__list__item-disabled') || node.getAttribute('aria-disabled') === 'true',
      searchInput: () => null,
    };
  };
  return {
    combo,
    approveDismissal(control, target) {
      const root = inputFor(control), expected = root && captionFor(root);
      return Boolean(expected && expected.element === target.element && expected.scope === target.scope);
    },
  };
}
