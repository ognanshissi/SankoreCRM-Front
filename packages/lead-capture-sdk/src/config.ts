import { CaptchaProvider, SdkConfig } from './types';

const PREFIX = 'data-sankore-';

function attr(el: Element, name: string): string {
  return (el.getAttribute(PREFIX + name) ?? '').trim();
}

function bool(el: Element, name: string, fallback: boolean): boolean {
  const raw = attr(el, name).toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

function num(el: Element, name: string, fallback: number): number {
  const parsed = Number(attr(el, name));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const PROVIDERS: CaptchaProvider[] = ['None', 'Turnstile', 'HCaptcha', 'RecaptchaV3'];

function provider(el: Element): CaptchaProvider {
  const raw = attr(el, 'captcha');
  return PROVIDERS.find((p) => p.toLowerCase() === raw.toLowerCase()) ?? 'None';
}

/**
 * Origine par defaut : celle depuis laquelle le script a ete servi. Le
 * webmaster n'a donc rien a configurer, et une instance de recette ne parle
 * jamais a la production par accident.
 */
function originOf(script: HTMLScriptElement): string {
  try {
    return new URL(script.src, location.href).origin;
  } catch {
    return location.origin;
  }
}

export function readConfig(script: HTMLScriptElement): SdkConfig | null {
  const publicKey = attr(script, 'key');
  if (!publicKey) return null;

  return {
    publicKey,
    endpoint: attr(script, 'endpoint').replace(/\/+$/, '') || originOf(script),
    formSelector: attr(script, 'form'),
    consentField: attr(script, 'consent-field'),
    consentVersion: attr(script, 'consent-version'),
    fieldNames: attr(script, 'fields')
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
    honeypot: bool(script, 'honeypot', true),
    minFillSeconds: num(script, 'min-fill', 3),
    captchaProvider: provider(script),
    captchaSiteKey: attr(script, 'captcha-key'),
    preventDefaultSubmit: bool(script, 'prevent-default', true),
    successMessage: attr(script, 'success') || 'Merci, votre demande a bien été envoyée.',
    redirectUrl: attr(script, 'redirect'),
    // FE-15 — le SDK rend lui-meme le formulaire au lieu d'en ecouter un.
    render: bool(script, 'render', false),
  };
}
