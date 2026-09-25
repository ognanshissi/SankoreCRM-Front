import { Captcha } from './captcha';
import { storedUtm } from './session';
import { sendLead } from './transport';
import { IngestPayload, SdkConfig } from './types';
import { clearError, redirect, showError, showSuccess } from './ui';

const HONEYPOT_NAME = 'sankore_hp';
const FAILURE_MESSAGE =
  "Votre demande n'a pas pu être envoyée. Merci de réessayer dans un instant.";

/**
 * Champ piege : visuellement absent mais atteignable par un robot qui remplit
 * tout. `tabindex=-1` et `autocomplete=off` evitent qu'un humain ou un
 * gestionnaire de mots de passe le remplisse par accident.
 */
function injectHoneypot(form: HTMLFormElement): void {
  if (form.querySelector(`[name="${HONEYPOT_NAME}"]`)) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.name = HONEYPOT_NAME;
  input.tabIndex = -1;
  input.autocomplete = 'off';
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText =
    'position:absolute!important;left:-9999px!important;width:1px;height:1px;opacity:0;';
  form.appendChild(input);
}

function collectFields(form: HTMLFormElement, allowed: string[]): Record<string, string> {
  const data = new FormData(form);
  const fields: Record<string, string> = {};
  const filter = allowed.length > 0 ? new Set(allowed) : null;

  data.forEach((value, name) => {
    if (name === HONEYPOT_NAME) return;
    if (filter && !filter.has(name)) return;
    if (typeof value !== 'string') return; // les fichiers ne sont pas transmis
    // Les cases a cocher multiples sont concatenees plutot qu'ecrasees.
    fields[name] = name in fields ? `${fields[name]}, ${value}` : value;
  });

  return fields;
}

/**
  * Echappe une valeur d'attribut pour un selecteur. `CSS.escape` n'est pas
  * garanti partout (et absent de certains environnements de test) : dependre
  * d'un global optionnel ferait lever le gestionnaire de soumission.
  */
function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isConsentGiven(form: HTMLFormElement, fieldName: string): boolean {
  if (!fieldName) return true; // pas de case configuree : rien a verifier
  const el = form.querySelector<HTMLInputElement>(`[name="${escapeAttrValue(fieldName)}"]`);
  if (!el) return false;
  return el.type === 'checkbox' ? el.checked : !!el.value;
}

/**
 * Rend le retour visuel a l'appelant : le formulaire hebergé vit dans un
 * Shadow DOM, ou l'insertion en DOM clair n'atteindrait rien.
 */
export interface SubmitPresenter {
  clearError(): void;
  showError(message: string): void;
  showSuccess(message: string): void;
  setBusy(busy: boolean): void;
}

function defaultPresenter(form: HTMLFormElement): SubmitPresenter {
  return {
    clearError: () => clearError(form),
    showError: (m) => showError(form, m),
    showSuccess: (m) => showSuccess(form, m),
    setBusy: () => undefined,
  };
}

export class FormBinding {
  private readonly _captcha: Captcha;
  private readonly _presenter: SubmitPresenter;
  private _attachedAt = Date.now();
  private _submitting = false;

  constructor(
    private readonly _form: HTMLFormElement,
    private readonly _config: SdkConfig,
    presenter?: SubmitPresenter,
  ) {
    this._presenter = presenter ?? defaultPresenter(_form);
    this._captcha = new Captcha(_config);
    if (_config.honeypot) injectHoneypot(_form);

    // Le captcha ne se telecharge qu'a la premiere interaction reelle.
    _form.addEventListener('focusin', () => this._captcha.preload(), { once: true });
    _form.addEventListener('submit', (e) => this._onSubmit(e));
  }

  private _onSubmit(event: SubmitEvent): void {
    try {
      this._handleSubmit(event);
    } catch (err) {
      // FE-13 AC5 — le site du client ne doit jamais voir remonter une erreur
      // du SDK. On laisse la soumission d'origine suivre son cours.
      console.warn('[sankore] soumission non transmise.', err);
    }
  }

  private _handleSubmit(event: SubmitEvent): void {
    if (this._submitting) return;

    // FE-13 AC2 — les trois garde-fous. Un echec ici n'annonce rien au
    // visiteur : un robot ne doit pas apprendre ce qui l'a trahi.
    if (this._config.honeypot) {
      const hp = this._form.querySelector<HTMLInputElement>(`[name="${HONEYPOT_NAME}"]`);
      if (hp && hp.value) return;
    }

    const elapsed = (Date.now() - this._attachedAt) / 1000;
    if (elapsed < this._config.minFillSeconds) return;

    if (!isConsentGiven(this._form, this._config.consentField)) return;

    if (this._config.preventDefaultSubmit) {
      event.preventDefault();
      this._submitting = true;
      void this._submitAndReport();
    } else {
      // FE-13 AC3 — envoi en parallele : la soumission d'origine n'est ni
      // bloquee ni modifiee. `keepalive` fait survivre la requete a la
      // navigation qui suit.
      void this._send();
    }
  }

  private _buildPayload(captchaToken: string | undefined): IngestPayload {
    return {
      fields: collectFields(this._form, this._config.fieldNames),
      utm: storedUtm(),
      page: location.href,
      referrer: document.referrer,
      consentGiven: isConsentGiven(this._form, this._config.consentField),
      consentVersion: this._config.consentVersion,
      captchaToken,
      submittedAt: new Date().toISOString(),
    };
  }

  private async _send() {
    const token = await this._captcha.token();
    return sendLead(this._config, this._buildPayload(token));
  }

  /** Chemin `preventDefaultSubmit = true` : le SDK pilote le retour visuel. */
  private async _submitAndReport(): Promise<void> {
    this._presenter.clearError();
    this._presenter.setBusy(true);
    try {
      const outcome = await this._send();

      if (outcome.kind === 'accepted') {
        if (this._config.redirectUrl) {
          redirect(this._config.redirectUrl);
          return;
        }
        this._presenter.showSuccess(this._config.successMessage);
        return;
      }

      if (outcome.kind === 'invalid') {
        this._presenter.showError(outcome.message);
      } else {
        this._presenter.showError(FAILURE_MESSAGE);
      }
    } catch {
      // FE-13 AC5 — aucune exception ne remonte a la page du client.
      this._presenter.showError(FAILURE_MESSAGE);
    } finally {
      this._presenter.setBusy(false);
      this._submitting = false;
    }
  }
}
