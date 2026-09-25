import { SdkConfig } from './types';

/**
 * FE-14 AC1 — le fournisseur de captcha est charge A LA DEMANDE : rien n'est
 * telecharge tant que le visiteur n'a pas touche au formulaire. Le jeton est
 * ensuite joint a l'envoi.
 */

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  getResponse(id: string): string | undefined;
  reset(id: string): void;
}
interface HCaptchaApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  execute(id: string, opts: { async: true }): Promise<{ response: string }>;
}
interface GrecaptchaApi {
  ready(cb: () => void): void;
  execute(siteKey: string, opts: { action: string }): Promise<string>;
}

type ProviderWindow = Window & {
  turnstile?: TurnstileApi;
  hcaptcha?: HCaptchaApi;
  grecaptcha?: GrecaptchaApi;
};

const SCRIPT_URLS: Record<string, string> = {
  Turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  HCaptcha: 'https://js.hcaptcha.com/1/api.js?render=explicit&onload=__sankoreHc',
  RecaptchaV3: 'https://www.google.com/recaptcha/api.js?render=',
};

function loadScript(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve(true);
    el.onerror = () => resolve(false);
    document.head.appendChild(el);
  });
}

function hiddenHost(): HTMLElement {
  const host = document.createElement('div');
  host.style.display = 'none';
  document.body.appendChild(host);
  return host;
}

function waitFor<T>(probe: () => T | undefined, timeoutMs = 8000): Promise<T | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const value = probe();
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export class Captcha {
  private _loading: Promise<void> | null = null;
  private _widgetId: string | null = null;
  private _host: HTMLElement | null = null;

  constructor(private readonly _config: SdkConfig) {}

  public get enabled(): boolean {
    return this._config.captchaProvider !== 'None' && !!this._config.captchaSiteKey;
  }

  /** Demarre le chargement sans l'attendre — appele des la premiere interaction. */
  public preload(): void {
    if (!this.enabled) return;
    void this._ensureLoaded();
  }

  /**
   * Jeton a joindre a l'envoi. Retourne `undefined` si le captcha est desactive
   * ou si le fournisseur n'a pas repondu : on ne bloque jamais la soumission
   * sur une dependance tierce indisponible, c'est au serveur de trancher.
   */
  public async token(): Promise<string | undefined> {
    if (!this.enabled) return undefined;
    try {
      await this._ensureLoaded();
      return (await this._execute()) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private _ensureLoaded(): Promise<void> {
    if (!this._loading) {
      const provider = this._config.captchaProvider;
      const base = SCRIPT_URLS[provider] ?? '';
      const url = provider === 'RecaptchaV3' ? base + encodeURIComponent(this._config.captchaSiteKey) : base;
      this._loading = loadScript(url).then(() => undefined);
    }
    return this._loading;
  }

  private async _execute(): Promise<string | null> {
    const w = window as ProviderWindow;
    const key = this._config.captchaSiteKey;

    switch (this._config.captchaProvider) {
      case 'Turnstile': {
        const api = await waitFor(() => w.turnstile);
        if (!api) return null;
        if (this._widgetId === null) {
          this._host = this._host ?? hiddenHost();
          this._widgetId = api.render(this._host, { sitekey: key, size: 'invisible' });
        } else {
          api.reset(this._widgetId);
        }
        const id = this._widgetId;
        return await waitFor(() => api.getResponse(id), 10000);
      }

      case 'HCaptcha': {
        const api = await waitFor(() => w.hcaptcha);
        if (!api) return null;
        if (this._widgetId === null) {
          this._host = this._host ?? hiddenHost();
          this._widgetId = api.render(this._host, { sitekey: key, size: 'invisible' });
        }
        const result = await api.execute(this._widgetId, { async: true });
        return result?.response ?? null;
      }

      case 'RecaptchaV3': {
        const api = await waitFor(() => w.grecaptcha);
        if (!api) return null;
        await new Promise<void>((resolve) => api.ready(resolve));
        return await api.execute(key, { action: 'lead_submit' });
      }

      default:
        return null;
    }
  }
}
