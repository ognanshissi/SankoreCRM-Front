/**
 * FE-14 AC2 / AC3 / AC4 — retours visibles pour le visiteur.
 *
 * Aucune feuille de style n'est injectee : le SDK ne doit pas repeindre le site
 * du client. Seules quelques proprietes inline, neutres, sont posees.
 */

const SUCCESS_ATTR = 'data-sankore-success';
const ERROR_ATTR = 'data-sankore-error';

/**
 * Region d'annonce partagee. `role="status"` + `aria-live="polite"` : le
 * message est lu par les lecteurs d'ecran sans interrompre la navigation.
 */
function ensureRegion(form: HTMLFormElement, attr: string, color: string): HTMLElement {
  let el = form.parentElement?.querySelector<HTMLElement>(`[${attr}]`) ?? null;
  if (!el) {
    el = document.createElement('div');
    el.setAttribute(attr, '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.margin = '1em 0';
    el.style.color = color;
    form.parentElement?.insertBefore(el, form.nextSibling);
  }
  return el;
}

/** Remplace le formulaire par le message de confirmation. */
export function showSuccess(form: HTMLFormElement, message: string): void {
  const region = ensureRegion(form, SUCCESS_ATTR, 'inherit');
  region.textContent = message;
  clearError(form);
  form.style.display = 'none';
  // Le focus part sur le message : sans cela, un utilisateur au clavier reste
  // sur un formulaire devenu invisible.
  region.setAttribute('tabindex', '-1');
  try {
    region.focus({ preventScroll: false });
  } catch {
    /* focus non supporte : le role status suffit a l'annonce */
  }
}

/** Affiche un message d'erreur a proximite du formulaire, sans le masquer. */
export function showError(form: HTMLFormElement, message: string): void {
  const region = ensureRegion(form, ERROR_ATTR, '#b91c1c');
  region.textContent = message;
}

export function clearError(form: HTMLFormElement): void {
  const region = form.parentElement?.querySelector<HTMLElement>(`[${ERROR_ATTR}]`);
  if (region) region.textContent = '';
}

export function redirect(url: string): void {
  try {
    location.assign(url);
  } catch {
    /* URL invalide : on laisse la page en l'etat */
  }
}
