import { beforeEach, describe, expect, it } from 'vitest';
import { HostedFormDefinition, renderHostedForm } from './hosted-form';
import { SdkConfig } from './types';

const config = {
  publicKey: 'pk', endpoint: 'https://ingest.test', formSelector: '', consentField: '',
  consentVersion: 'fallback', fieldNames: [], honeypot: true, minFillSeconds: 0,
  captchaProvider: 'None', captchaSiteKey: '', preventDefaultSubmit: true,
  successMessage: 'ok', redirectUrl: '', render: true,
} as SdkConfig;

const definition: HostedFormDefinition = {
  fields: [
    { name: 'lastName', label: 'Nom', type: 'text', isRequired: false, placeholder: 'Votre nom' },
    { name: 'phoneNumber', label: 'Téléphone', type: 'tel', isRequired: true },
    { name: 'productCode', label: 'Produit', type: 'select', isRequired: false, options: ['A', 'B'] },
    { name: 'message', label: 'Message', type: 'textarea', isRequired: false },
  ],
  consentText: "J'accepte d'être contacté(e).",
  consentVersion: 'v3',
  submitLabel: 'Envoyer',
  accentColor: '#ff0000',
};

let host: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.querySelector<HTMLElement>('#host')!;
});

describe('renderHostedForm', () => {
  it('isole le rendu dans un Shadow DOM', () => {
    renderHostedForm(host, definition, config);
    expect(host.shadowRoot).not.toBeNull();
    expect(host.querySelector('form')).toBeNull(); // rien ne fuit en DOM clair
    expect(host.shadowRoot!.querySelector('form')).not.toBeNull();
  });

  it('rend chaque champ avec le bon contrôle', () => {
    const { form } = renderHostedForm(host, definition, config);
    expect(form.querySelector('input[name="lastName"]')?.getAttribute('type')).toBe('text');
    expect(form.querySelector('input[name="phoneNumber"]')?.getAttribute('type')).toBe('tel');
    expect(form.querySelectorAll('select[name="productCode"] option')).toHaveLength(3); // + placeholder
    expect(form.querySelector('textarea[name="message"]')).not.toBeNull();
  });

  it('associe un label explicite à chaque champ (WCAG)', () => {
    const { form } = renderHostedForm(host, definition, config);
    const labels = Array.from(form.querySelectorAll('label[for]'));
    expect(labels.length).toBeGreaterThanOrEqual(definition.fields.length);
    for (const label of labels) {
      const id = label.getAttribute('for')!;
      expect(form.querySelector(`#${id}`), `champ manquant pour le label ${id}`).not.toBeNull();
    }
  });

  it('marque comme requis les champs obligatoires', () => {
    const { form } = renderHostedForm(host, definition, config);
    expect(form.querySelector('input[name="phoneNumber"]')!.hasAttribute('required')).toBe(true);
    expect(form.querySelector('input[name="lastName"]')!.hasAttribute('required')).toBe(false);
  });

  it('rend la case de consentement, requise, avec son texte', () => {
    const { form, consentField, consentVersion } = renderHostedForm(host, definition, config);
    const box = form.querySelector<HTMLInputElement>(`input[name="${consentField}"]`)!;
    expect(box.type).toBe('checkbox');
    expect(box.hasAttribute('required')).toBe(true);
    expect(form.textContent).toContain("J'accepte d'être contacté(e).");
    // La version vient de la définition servie par le CRM, pas du script.
    expect(consentVersion).toBe('v3');
  });

  it('expose une région aria-live pour les messages', () => {
    const { form, showMessage } = renderHostedForm(host, definition, config);
    const region = form.querySelector('[role="status"]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');

    showMessage('Numéro invalide', 'error');
    expect(region.textContent).toBe('Numéro invalide');
    expect(region.getAttribute('data-kind')).toBe('error');
  });

  it('remplace le formulaire par le message de confirmation', () => {
    const { form, replaceWithMessage } = renderHostedForm(host, definition, config);
    replaceWithMessage('Merci !');
    expect(form.querySelector('input[name="phoneNumber"]')).toBeNull();
    expect(form.querySelector('button[type=submit]')).toBeNull();
    expect(form.querySelector('[role="status"]')!.textContent).toBe('Merci !');
  });

  it('applique la couleur d’accent en variable CSS surchargeable', () => {
    renderHostedForm(host, definition, config);
    expect(host.style.getPropertyValue('--sankore-accent')).toBe('#ff0000');
  });

  it('désactive le bouton pendant l’envoi', () => {
    const { form, setBusy } = renderHostedForm(host, definition, config);
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    setBusy(true);
    expect(submit.hasAttribute('disabled')).toBe(true);
    expect(form.getAttribute('aria-busy')).toBe('true');
    setBusy(false);
    expect(submit.hasAttribute('disabled')).toBe(false);
  });

  it('est idempotent : un second rendu ne duplique pas le formulaire', () => {
    renderHostedForm(host, definition, config);
    renderHostedForm(host, definition, config);
    expect(host.shadowRoot!.querySelectorAll('form')).toHaveLength(1);
  });
});
