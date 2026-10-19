/** An explicitly approved component caption may contain non-associated labels. */
export function isStaticDismissal(element: HTMLElement, componentApproved: boolean): boolean {
  return element.matches('p,div,span') && !element.matches('[role],[tabindex],[contenteditable],[onclick]')
    && !element.querySelector('input,textarea,select,button,a,[role],[tabindex],[contenteditable],[onclick]')
    && !element.querySelector(componentApproved ? 'label[for]' : 'label');
}
