import { SdkConfig } from './types';

/**
 * FE-15 — Formulaire hebergé, rendu par le SDK lui-meme.
 *
 * Rendu dans un Shadow DOM : les styles du site hote ne peuvent pas casser le
 * formulaire, et le formulaire ne peut pas repeindre le site. Les couleurs et
 * la police sont exposees en variables CSS, donc surchargeables par le site.
 *
 * Accessibilite (WCAG 2.1 AA) : chaque champ a un <label for> reel, le focus
 * reste visible, les erreurs sont reliees par aria-describedby, et la zone de
 * statut est annoncee en aria-live.
 */

/** Forme renvoyee par `GET /api/ingest/web/{publicKey}/form`. */
export interface HostedFormField {
  name: string;
  label: string;
  type: string;
  isRequired: boolean;
  placeholder?: string;
  options?: string[];
}

export interface HostedFormDefinition {
  fields: HostedFormField[];
  consentText?: string;
  consentVersion?: string;
  submitLabel?: string;
  accentColor?: string;
  fontFamily?: string;
}

const STYLES = `
:host{
  --sankore-accent:#2563eb;
  --sankore-font:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --sankore-radius:6px;
  --sankore-border:#cbd5e1;
  --sankore-text:#0f172a;
  --sankore-error:#b91c1c;
  display:block;font-family:var(--sankore-font);color:var(--sankore-text);
}
*,*::before,*::after{box-sizing:border-box}
form{display:flex;flex-direction:column;gap:.85rem;margin:0}
.field{display:flex;flex-direction:column;gap:.3rem}
label{font-size:.82rem;font-weight:600}
.req{color:var(--sankore-error);margin-left:.15rem}
input,select,textarea{
  font:inherit;color:inherit;width:100%;padding:.55rem .65rem;
  border:1px solid var(--sankore-border);border-radius:var(--sankore-radius);background:#fff;
}
textarea{min-height:5.5rem;resize:vertical}
/* Focus toujours visible : exigence WCAG, jamais supprime. */
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{
  outline:3px solid var(--sankore-accent);outline-offset:2px;
}
.consent{display:flex;align-items:flex-start;gap:.5rem;font-size:.8rem;font-weight:400}
.consent input{width:auto;margin-top:.15rem}
button[type=submit]{
  font:inherit;font-weight:600;color:#fff;background:var(--sankore-accent);
  border:0;border-radius:var(--sankore-radius);padding:.65rem 1rem;cursor:pointer;
}
button[type=submit][disabled]{opacity:.6;cursor:progress}
.msg{font-size:.85rem;margin:0}
.msg[data-kind=error]{color:var(--sankore-error)}
.hint{font-size:.75rem;color:var(--sankore-error)}
@media (max-width:420px){ button[type=submit]{width:100%} }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function controlFor(field: HostedFormField, id: string): HTMLElement {
  const common: Record<string, string> = { id, name: field.name };
  if (field.isRequired) common['required'] = '';
  if (field.placeholder) common['placeholder'] = field.placeholder;

  if (field.type === 'textarea') return el('textarea', common);

  if (field.type === 'select') {
    const select = el('select', common);
    select.appendChild(el('option', { value: '' }, '—'));
    for (const option of field.options ?? []) {
      select.appendChild(el('option', { value: option }, option));
    }
    return select;
  }

  // `tel`, `email`, `text` — tout autre type inconnu retombe sur `text`.
  const allowed = ['text', 'email', 'tel', 'number', 'url'];
  return el('input', { ...common, type: allowed.includes(field.type) ? field.type : 'text' });
}

export interface RenderedForm {
  form: HTMLFormElement;
  consentField: string;
  consentVersion: string;
  setBusy(busy: boolean): void;
  showMessage(text: string, kind: 'status' | 'error'): void;
  replaceWithMessage(text: string): void;
}

const CONSENT_FIELD = 'consentGiven';

/**
 * Rend le formulaire dans un Shadow DOM attache a `host`. Retourne le
 * `<form>` reel, que le binding habituel peut ecouter sans rien savoir du
 * mode de rendu.
 */
export function renderHostedForm(
  host: HTMLElement,
  definition: HostedFormDefinition,
  config: SdkConfig,
): RenderedForm {
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.textContent = '';

  const style = el('style');
  style.textContent = STYLES;
  root.appendChild(style);

  if (definition.accentColor) host.style.setProperty('--sankore-accent', definition.accentColor);
  if (definition.fontFamily && definition.fontFamily !== 'inherit') {
    host.style.setProperty('--sankore-font', definition.fontFamily);
  }

  const form = el('form', { novalidate: '' });

  for (const [index, field] of (definition.fields ?? []).entries()) {
    const id = `sankore-f${index}`;
    const wrapper = el('div', { class: 'field' });

    const label = el('label', { for: id }, field.label || field.name);
    if (field.isRequired) {
      const star = el('span', { class: 'req', 'aria-hidden': 'true' }, '*');
      label.appendChild(star);
    }

    wrapper.appendChild(label);
    wrapper.appendChild(controlFor(field, id));
    form.appendChild(wrapper);
  }

  // Case de consentement — toujours presente, toujours requise (F13.4).
  const consentWrap = el('label', { class: 'consent', for: 'sankore-consent' });
  consentWrap.appendChild(
    el('input', { type: 'checkbox', id: 'sankore-consent', name: CONSENT_FIELD, required: '' }),
  );
  consentWrap.appendChild(el('span', {}, definition.consentText ?? "J'accepte d'être contacté(e)."));
  form.appendChild(consentWrap);

  const submit = el('button', { type: 'submit' }, definition.submitLabel || 'Envoyer');
  form.appendChild(submit);

  // Zone d'annonce, lue sans interrompre la navigation.
  const message = el('p', { class: 'msg', role: 'status', 'aria-live': 'polite', tabindex: '-1' });
  form.appendChild(message);

  root.appendChild(form);

  return {
    form,
    consentField: CONSENT_FIELD,
    consentVersion: definition.consentVersion ?? config.consentVersion,
    setBusy(busy) {
      submit.toggleAttribute('disabled', busy);
      form.setAttribute('aria-busy', String(busy));
    },
    showMessage(text, kind) {
      message.textContent = text;
      message.setAttribute('data-kind', kind);
    },
    replaceWithMessage(text) {
      form.querySelectorAll('.field, .consent, button[type=submit]').forEach((n) => n.remove());
      message.textContent = text;
      message.setAttribute('data-kind', 'status');
      try {
        message.focus({ preventScroll: false });
      } catch {
        /* le role status suffit a l'annonce */
      }
    },
  };
}

/** Recupere la definition publique du formulaire. */
export async function fetchDefinition(config: SdkConfig): Promise<HostedFormDefinition | null> {
  try {
    const url = `${config.endpoint}/api/ingest/web/${encodeURIComponent(config.publicKey)}/form`;
    const response = await fetch(url, { credentials: 'omit', mode: 'cors' });
    if (!response.ok) return null;
    return (await response.json()) as HostedFormDefinition;
  } catch {
    return null;
  }
}
