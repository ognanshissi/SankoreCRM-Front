/**
 * Sankore — SDK de capture de leads (`forms.js`).
 *
 * FE-13 : s'attache a un formulaire existant et transmet ses soumissions.
 * FE-14 : captcha a la demande et retours visibles pour le visiteur.
 *
 * Contraintes : aucune dependance, moins de 8 Ko compresse, aucune exception
 * non interceptee sur le site du client, aucune feuille de style injectee.
 */

import { readConfig } from './config';
import { FormBinding } from './form';
import { fetchDefinition, renderHostedForm } from './hosted-form';
import { captureUtm, shouldPing } from './session';
import { sendPing } from './transport';
import { SdkConfig } from './types';

const WARN_PREFIX = '[sankore]';

/**
 * `document.currentScript` est nul une fois le script execute (module differe,
 * injection dynamique). On retombe alors sur la derniere balise portant la cle.
 */
function locateScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.hasAttribute('data-sankore-key')) return current;
  const all = document.querySelectorAll<HTMLScriptElement>('script[data-sankore-key]');
  return all.length > 0 ? all[all.length - 1] : null;
}

function onReady(fn: () => void): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function start(): void {
  const script = locateScript();
  if (!script) return;

  const config = readConfig(script);
  if (!config) {
    console.warn(`${WARN_PREFIX} attribut data-sankore-key manquant : le script est inactif.`);
    return;
  }

  // Les UTM sont retenus des la premiere page, avant toute navigation interne.
  captureUtm();

  if (shouldPing(config.publicKey)) sendPing(config);

  if (config.render) {
    void renderAndBind(config, script);
    return;
  }

  if (!config.formSelector) {
    console.warn(
      `${WARN_PREFIX} aucun sélecteur de formulaire (data-sankore-form) : aucun formulaire n'est écouté.`,
    );
    return;
  }

  const form = document.querySelector<HTMLFormElement>(config.formSelector);
  if (!form) {
    // FE-13 AC6 — un avertissement UNIQUE, et aucun autre effet.
    console.warn(
      `${WARN_PREFIX} formulaire introuvable pour le sélecteur « ${config.formSelector} ».`,
    );
    return;
  }

  new FormBinding(form, config);
}

const HOST_TAG = 'sankore-form';

/**
 * Element hote du formulaire hebergé. C'est un Web Component : son Shadow DOM
 * isole les styles dans les deux sens — le site ne casse pas le formulaire, et
 * le formulaire ne repeint pas le site.
 */
function defineHostElement(): void {
  if (typeof customElements === 'undefined' || customElements.get(HOST_TAG)) return;
  customElements.define(HOST_TAG, class extends HTMLElement {});
}

/** Emplacement du formulaire : le conteneur designe, sinon apres le script. */
function resolveHost(config: SdkConfig, script: HTMLScriptElement): HTMLElement | null {
  if (config.formSelector) {
    const target = document.querySelector<HTMLElement>(config.formSelector);
    if (target) return target;
    console.warn(
      `${WARN_PREFIX} conteneur introuvable pour « ${config.formSelector} » : le formulaire est inséré après le script.`,
    );
  }
  const host = document.createElement(HOST_TAG);
  script.parentNode?.insertBefore(host, script.nextSibling);
  return host as HTMLElement;
}

async function renderAndBind(config: SdkConfig, script: HTMLScriptElement): Promise<void> {
  const definition = await fetchDefinition(config);
  if (!definition || !Array.isArray(definition.fields) || definition.fields.length === 0) {
    console.warn(`${WARN_PREFIX} définition de formulaire indisponible : rien n'est affiché.`);
    return;
  }

  defineHostElement();
  const host = resolveHost(config, script);
  if (!host) return;

  const rendered = renderHostedForm(host, definition, config);

  // Le formulaire rendu impose son champ de consentement et sa version : ils
  // viennent de la definition servie par le CRM, pas des attributs du script.
  const boundConfig: SdkConfig = {
    ...config,
    consentField: rendered.consentField,
    consentVersion: rendered.consentVersion,
    // Le formulaire nous appartient : aucune soumission native a preserver.
    preventDefaultSubmit: true,
  };

  new FormBinding(rendered.form, boundConfig, {
    clearError: () => rendered.showMessage('', 'status'),
    showError: (m) => rendered.showMessage(m, 'error'),
    showSuccess: (m) => rendered.replaceWithMessage(m),
    setBusy: (busy) => rendered.setBusy(busy),
  });
}

// Le SDK ne doit jamais casser la page qui l'heberge, quelle qu'en soit la cause.
try {
  onReady(() => {
    try {
      start();
    } catch (err) {
      console.warn(`${WARN_PREFIX} initialisation interrompue.`, err);
    }
  });
} catch {
  /* environnement sans DOM : rien a faire */
}
