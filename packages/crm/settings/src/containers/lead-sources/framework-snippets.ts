/**
 * Code à copier pour brancher un formulaire Angular ou React sur une source « Script embarqué ».
 *
 * Le script `forms.min.js` cherche le formulaire une seule fois, au chargement de la page : dans
 * une application Angular ou React, le formulaire est rendu plus tard (route, @if, SSR) et le
 * script ne le trouve jamais. Ce code appelle directement l'API d'ingestion, avec le même contenu
 * que le SDK (UTM, page, consentement, délai de saisie) et le même signal d'installation.
 *
 * Le code généré n'utilise pas de gabarits `${…}` : il est lui-même écrit dans un gabarit.
 */
export interface FrameworkSnippetInput {
  apiBaseUrl: string;
  publicKey: string;
  sourceLabel: string;
}

const CORE = (apiBaseUrl: string, publicKey: string) => `const SANKORE_API = '${apiBaseUrl}';
const SANKORE_KEY = '${publicKey}';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export type SankoreFields = Record<string, string | number | boolean | string[] | null | undefined>;

export interface SankoreSubmitOptions {
  /** La personne accepte le traitement de ses données. Obligatoire : refusé (422) sinon. */
  consent: boolean;
  /** Case d'accord WhatsApp : true/false si le formulaire la propose, null sinon. */
  whatsAppConsent?: boolean | null;
  captchaToken?: string | null;
  /** Moment où le formulaire est apparu : un envoi trop rapide est écarté comme un robot. */
  formLoadedAt?: Date;
}

export type SankoreResult =
  | { ok: true; ingestionId: string | null }
  | { ok: false; status: number; error: string };

function captureUtm(): void {
  try {
    if (sessionStorage.getItem('__sankore_utm')) return;
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    UTM_KEYS.forEach((k) => { const v = params.get(k); if (v) utm[k] = v; });
    if (Object.keys(utm).length > 0) sessionStorage.setItem('__sankore_utm', JSON.stringify(utm));
  } catch { /* stockage indisponible : on envoie sans UTM */ }
}

function storedUtm(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem('__sankore_utm') ?? '{}'); } catch { return {}; }
}

/** Signale l'installation au CRM, une fois par session (sans corps : pas de pré-requête CORS). */
function ping(): void {
  try {
    const flag = '__sankore_pinged_' + SANKORE_KEY;
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, '1');
  } catch { /* on pinge quand même */ }
  fetch(SANKORE_API + '/api/ingest/web/' + SANKORE_KEY + '/ping', {
    method: 'POST', mode: 'no-cors', keepalive: true,
  }).catch(() => undefined);
}

function toText(value: SankoreFields[string]): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join('; ');
  return String(value);
}

async function sendLead(fields: SankoreFields, options: SankoreSubmitOptions, loadedAt: Date): Promise<SankoreResult> {
  const utm = storedUtm();
  const payload = {
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toText(v)])),
    consent: options.consent,
    consentVersion: null,
    whatsAppConsent: options.whatsAppConsent ?? null,
    captchaToken: options.captchaToken ?? null,
    formLoadedAt: (options.formLoadedAt ?? loadedAt).toISOString(),
    page: window.location.href,
    referrer: document.referrer || null,
    utmSource: utm['utm_source'] ?? null,
    utmMedium: utm['utm_medium'] ?? null,
    utmCampaign: utm['utm_campaign'] ?? null,
    utmContent: utm['utm_content'] ?? null,
    utmTerm: utm['utm_term'] ?? null,
    sdkVersion: 'code-1',
  };
  try {
    const res = await fetch(SANKORE_API + '/api/ingest/web/' + SANKORE_KEY, {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, ingestionId: body?.ingestionId ?? null };
    return { ok: false, status: res.status, error: body?.error ?? 'HTTP_' + res.status };
  } catch {
    // Origine non autorisée sur la source, réseau coupé : le navigateur ne dit rien de plus.
    return { ok: false, status: 0, error: 'NETWORK' };
  }
}`;

export function angularSnippet(input: FrameworkSnippetInput): string {
  return `// sankore-lead.service.ts — Sankore CRM, source « ${input.sourceLabel} »
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

${CORE(input.apiBaseUrl, input.publicKey)}

@Injectable({ providedIn: 'root' })
export class SankoreLeadService {
  private readonly _browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly _loadedAt = new Date();

  constructor() {
    if (this._browser) { captureUtm(); ping(); }
  }

  /**
   * Envoie un lead. Les clés de \`fields\` sont celles de votre formulaire : faites-les
   * correspondre aux champs du CRM dans l'onglet « Correspondance des champs ».
   */
  public submit(fields: SankoreFields, options: SankoreSubmitOptions): Promise<SankoreResult> {
    if (!this._browser) return Promise.resolve({ ok: false, status: 0, error: 'SERVER_SIDE' });
    return sendLead(fields, options, this._loadedAt);
  }
}

/* Exemple d'utilisation dans un composant :

  private readonly _sankore = inject(SankoreLeadService);
  private readonly _shownAt = new Date();

  async send(): Promise<void> {
    const result = await this._sankore.submit(
      { fullName: this.fullName, phone: this.phone, email: this.email },
      { consent: this.consent, formLoadedAt: this._shownAt },
    );
    if (result.ok) { ... } else { console.warn('Sankore', result.error); }
  }
*/
`;
}

export function reactSnippet(input: FrameworkSnippetInput): string {
  return `// useSankoreLead.ts — Sankore CRM, source « ${input.sourceLabel} »
// Next.js : ajoutez 'use client'; en première ligne.
import { useCallback, useEffect, useRef, useState } from 'react';

${CORE(input.apiBaseUrl, input.publicKey)}

type Status = 'idle' | 'sending' | 'sent' | 'error';

/**
 * Les clés de \`fields\` sont celles de votre formulaire : faites-les correspondre aux champs
 * du CRM dans l'onglet « Correspondance des champs ».
 */
export function useSankoreLead() {
  const loadedAt = useRef(new Date());
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { captureUtm(); ping(); }, []);

  const submit = useCallback(async (fields: SankoreFields, options: SankoreSubmitOptions) => {
    setStatus('sending');
    setError(null);
    const result = await sendLead(fields, options, loadedAt.current);
    setStatus(result.ok ? 'sent' : 'error');
    if (!result.ok) setError(result.error);
    return result;
  }, []);

  const reset = useCallback(() => { setStatus('idle'); setError(null); }, []);

  return { submit, status, error, reset };
}

/* Exemple d'utilisation :

  const { submit, status, error } = useSankoreLead();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    await submit({ fullName: data.fullName, phone: data.phone, email: data.email }, { consent: true });
  }
*/
`;
}
