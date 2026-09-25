import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormBinding } from './form';
import { SdkConfig } from './types';

function config(overrides: Partial<SdkConfig> = {}): SdkConfig {
  return {
    publicKey: 'pk_test',
    endpoint: 'https://ingest.test',
    formSelector: '#f',
    consentField: 'consent',
    consentVersion: 'v1',
    fieldNames: [],
    honeypot: true,
    minFillSeconds: 0,
    captchaProvider: 'None',
    captchaSiteKey: '',
    preventDefaultSubmit: true,
    successMessage: 'Merci !',
    redirectUrl: '',
    ...overrides,
  };
}

function mountForm(): HTMLFormElement {
  document.body.innerHTML = `
    <div>
      <form id="f">
        <input name="nom" value="Awa" />
        <input name="telephone" value="0700000000" />
        <input type="checkbox" name="consent" checked />
        <button type="submit">Envoyer</button>
      </form>
    </div>`;
  return document.querySelector<HTMLFormElement>('#f')!;
}

/** Laisse les promesses internes du binding se résoudre. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function mockFetch(impl: (url: string, init: RequestInit) => Partial<Response>) {
  const spy = vi.fn((url: string, init: RequestInit) => Promise.resolve(impl(url, init) as Response));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const accepted = () => ({ ok: true, status: 202 });

describe('FormBinding', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('transmet les champs bruts, la page et le consentement', async () => {
    const fetchSpy = mockFetch(accepted);
    const form = mountForm();
    new FormBinding(form, config());

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.fields).toEqual({ nom: 'Awa', telephone: '0700000000', consent: 'on' });
    expect(body.consentGiven).toBe(true);
    expect(body.consentVersion).toBe('v1');
    expect(body.page).toBe(location.href);
  });

  it('n’envoie rien si le honeypot est rempli', async () => {
    const fetchSpy = mockFetch(accepted);
    const form = mountForm();
    new FormBinding(form, config());

    form.querySelector<HTMLInputElement>('[name="sankore_hp"]')!.value = 'robot';
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('n’envoie rien avant le délai minimal de saisie', async () => {
    const fetchSpy = mockFetch(accepted);
    const form = mountForm();
    new FormBinding(form, config({ minFillSeconds: 30 }));

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('n’envoie rien si le consentement n’est pas coché', async () => {
    const fetchSpy = mockFetch(accepted);
    const form = mountForm();
    form.querySelector<HTMLInputElement>('[name="consent"]')!.checked = false;
    new FormBinding(form, config());

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('affiche le message de succès dans une région aria-live et masque le formulaire', async () => {
    mockFetch(accepted);
    const form = mountForm();
    new FormBinding(form, config());

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    const region = document.querySelector('[data-sankore-success]')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Merci !');
    expect(form.style.display).toBe('none');
  });

  it('affiche le message du serveur sur 422 sans masquer le formulaire', async () => {
    mockFetch(() => ({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: 'Numéro de téléphone invalide.' }),
    }));
    const form = mountForm();
    new FormBinding(form, config());

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect(document.querySelector('[data-sankore-error]')!.textContent).toBe(
      'Numéro de téléphone invalide.',
    );
    expect(form.style.display).not.toBe('none');
  });

  it('réessaie une seule fois sur 5xx puis abandonne sans lever', async () => {
    const fetchSpy = mockFetch(() => ({ ok: false, status: 503, json: () => Promise.resolve({}) }));
    const form = mountForm();
    new FormBinding(form, config());

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 1200));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-sankore-error]')!.textContent).toContain('réessayer');
  });

  it('ne bloque pas la soumission d’origine quand preventDefaultSubmit est faux', async () => {
    mockFetch(accepted);
    const form = mountForm();
    new FormBinding(form, config({ preventDefaultSubmit: false }));

    const event = new Event('submit', { cancelable: true, bubbles: true });
    form.dispatchEvent(event);
    await flush();

    expect(event.defaultPrevented).toBe(false);
  });

  it('envoie avec keepalive pour survivre à la navigation', async () => {
    const fetchSpy = mockFetch(accepted);
    const form = mountForm();
    new FormBinding(form, config({ preventDefaultSubmit: false }));

    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await flush();

    expect((fetchSpy.mock.calls[0][1] as RequestInit).keepalive).toBe(true);
  });
});
