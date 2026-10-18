import type { ComboControl, ControlAdapter } from './index.js';

const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const inputSelector = 'input#location-input.location-input[data-qa="location-input"][name="location"][type="text"]';
const optionSelector = ':scope > div.break-word.dropdown-location.width-full.py1.px2[id^="location-"]';
function visible(node: HTMLElement): boolean {
  if (!node.isConnected || !node.getClientRects().length || node.getBoundingClientRect().height <= 0) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(parent);
    if (parent.hidden || parent.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
interface State {
  opening: boolean;
  query?: { nodes: HTMLElement[]; labels: string[]; sawLoading: boolean; fresh: boolean };
  selection?: { key: string; label: string };
  confirmed?: { key: string; label: string };
}

/** Lever's verified local location search only; this does not register a server site. */
export function createLeverLocationControlAdapter(): ControlAdapter {
  const states = new WeakMap<HTMLElement, State>();
  const combo = (element: HTMLElement): ComboControl | undefined => {
    const location = element.ownerDocument.location;
    if (location.origin !== 'https://jobs.lever.co' || !/^\/[^/]+\/[^/]+\/apply\/?$/.test(location.pathname) || !element.matches(inputSelector)) return;
    const input = element as HTMLInputElement, root = input.parentElement;
    if (!root?.matches('div.application-field')) return;
    const inputs = root.querySelectorAll(':scope > ' + inputSelector);
    const hidden = root.querySelectorAll<HTMLInputElement>(':scope > input#selected-location[type="hidden"][name="selectedLocation"]');
    const containers = root.querySelectorAll<HTMLElement>(':scope > div.dropdown-container');
    if (inputs.length !== 1 || hidden.length !== 1 || containers.length !== 1) return;
    const container = containers[0]!, panels = container.querySelectorAll<HTMLElement>(':scope > div.dropdown-results');
    if (panels.length !== 1) return;
    const panel = panels[0]!, selected = hidden[0]!;
    const scope = root.parentElement;
    const captions = scope?.matches('label') ? Array.from(scope.querySelectorAll<HTMLElement>(':scope > div.application-label')).filter(node => visible(node) && !node.matches('[role],[tabindex],[contenteditable],[onclick]') && !node.querySelector('input,textarea,select,button,a,label,[role],[tabindex],[contenteditable],[onclick]')) : [];
    let state = states.get(input);
    if (!state) { state = { opening: false }; states.set(input, state); }
    const current = state;
    const local = () => input.isConnected && input.parentElement === root && selected.parentElement === root && panel.parentElement === container && container.parentElement === root && root.querySelectorAll(':scope > div.dropdown-container > div.dropdown-results').length === 1;
    const isOpen = () => local() && visible(container);
    const owned = () => current.opening && local() && visible(input) && input.ownerDocument.activeElement === input && isOpen() ? panel : undefined;
    const nodes = () => Array.from(panel.querySelectorAll<HTMLElement>(optionSelector)).filter(node => /^location-\d+$/.test(node.id) && visible(node));
    const loading = () => Array.from(container.querySelectorAll<HTMLElement>(':scope > .dropdown-loading-results')).some(visible);
    const fresh = () => {
      const query = current.query;
      if (!query) return false;
      if (loading()) { query.sawLoading = true; return false; }
      const candidates = nodes();
      if (candidates.length && (query.sawLoading || candidates.length !== query.nodes.length || candidates.some((node, index) => node !== query.nodes[index] || clean(node.textContent) !== query.labels[index]))) query.fresh = true;
      return query.fresh;
    };
    const proof = current.confirmed;
    const unsupportedReason = input.disabled || input.readOnly ? 'lever-location-disabled' : !scope || captions.length !== 1 ? 'lever-location-close-unproven' : selected.value ? proof && proof.key === selected.value && proof.label === clean(input.value) ? 'lever-location-preserve-selected-value' : 'lever-location-existing-selection-unverified' : undefined;
    return {
      ...(unsupportedReason ? { unsupportedReason } : {}),
      beforeOpen() { current.opening = true; },
      focusTarget: () => input,
      openTarget: () => input,
      panel: owned,
      isOpen,
      closeTarget: () => input,
      dismiss: () => scope && captions.length === 1 ? { element: captions[0]!, scope } : null,
      readValue: () => {
        const confirmed = current.confirmed;
        if (confirmed && local() && selected.value === confirmed.key && clean(input.value) === confirmed.label && !isOpen()) return confirmed.label;
        return selected.value ? null : '';
      },
      options: candidate => candidate === owned() && fresh() ? nodes() : [],
      optionLabel: node => clean(node.textContent),
      optionDisabled: node => Boolean(node.closest('[disabled],[aria-disabled="true"]')),
      searchInput: () => input,
      beforeQuery() { const before = nodes(); current.query = { nodes: before, labels: before.map(node => clean(node.textContent)), sawLoading: false, fresh: false }; },
      queryKeydown: 'Backspace',
      optionActivation: 'mousedown',
      restoreQueryAfterClose: true,
      restoreQuerySilently: true,
      blurToClose: !selected.value,
      loading: () => loading() || !fresh(),
      beforeSelection(label) { current.selection = { key: selected.value, label }; },
      selectionConfirmed(label) {
        const before = current.selection;
        if (!before || before.label !== label || !local() || !selected.value || selected.value === before.key || clean(input.value) !== label || isOpen()) return false;
        current.confirmed = { key: selected.value, label };
        return true;
      },
    };
  };
  return { combo };
}
