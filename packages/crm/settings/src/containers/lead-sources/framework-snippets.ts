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
import { LEAD_TARGET_FIELDS, MappingRule, REQUIRED_FIELD_GROUPS } from './field-mapping.types';

export interface FrameworkSnippetInput {
  apiBaseUrl: string;
  publicKey: string;
  sourceLabel: string;
  /** Les champs attendus par la source, tels que le CRM les configure (voir `expectedFields`). */
  fields: ExpectedField[];
  /** Vrai : les champs viennent des règles de correspondance ; faux : noms du CRM, faute de règle. */
  fromRules: boolean;
}

/** Une clé que le site envoie dans `fields`, et ce que le CRM en fait. */
export interface ExpectedField {
  key: string;
  /** Où la valeur arrive dans le lead (« Téléphone », « Nom complet »…). */
  target: string;
  required: boolean;
  /** Pour un champ d'un groupe dont un seul membre suffit (« au moins un de : … »). */
  note?: string;
}

/**
 * Les champs attendus sont ceux que le CRM configure : les règles de « Correspondance des champs »
 * (une clé envoyée par le site → un champ du lead). Sans règle, l'ingestion lit les clés comme des
 * noms du CRM : ce sont alors eux qui sont attendus. Une clé est obligatoire quand elle est la seule
 * à alimenter le téléphone, ou le nom.
 */
export function expectedFields(rules: MappingRule[], customLabels: Record<string, string> = {}): { fields: ExpectedField[]; fromRules: boolean } {
  const labelOf = (target: string) =>
    LEAD_TARGET_FIELDS.find((f) => f.key === target)?.label ?? customLabels[target] ?? target;
  const usable = rules.filter((r) => r.sourceField?.trim() && r.targetField);

  if (usable.length === 0) {
    return {
      fromRules: false,
      fields: LEAD_TARGET_FIELDS.map((f) => ({
        key: f.key,
        target: f.label,
        required: f.required,
        note: f.requiredGroup ? 'au moins un de : fullName, firstName, lastName' : undefined,
      })),
    };
  }

  const byKey = new Map<string, ExpectedField>();
  for (const rule of usable) {
    const key = rule.sourceField.trim();
    const existing = byKey.get(key);
    const target = labelOf(rule.targetField);
    byKey.set(key, existing
      ? { ...existing, target: existing.target + ', ' + target }
      : { key, target, required: false });
  }
  for (const group of REQUIRED_FIELD_GROUPS) {
    const feeding = [...new Set(usable.filter((r) => group.keys.includes(r.targetField)).map((r) => r.sourceField.trim()))];
    if (feeding.length === 1) {
      byKey.get(feeding[0])!.required = true;
    } else {
      feeding.forEach((k) => (byKey.get(k)!.note = 'au moins un de : ' + feeding.join(', ')));
    }
  }
  return { fromRules: true, fields: [...byKey.values()] };
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** L'interface TypeScript des champs attendus, à jour de la configuration du CRM. */
function fieldsInterface(input: FrameworkSnippetInput): string {
  const origin = input.fromRules
    ? "l'onglet « Correspondance des champs » de la source"
    : "aucune règle de correspondance : les clés sont les noms du CRM";
  const lines = input.fields.map((f) => {
    const name = IDENTIFIER.test(f.key) ? f.key : "'" + f.key.replace(/'/g, "\\'") + "'";
    const doc = '→ ' + f.target + (f.required ? ' (obligatoire)' : '') + (f.note ? ' — ' + f.note : '');
    return '  /** ' + doc.replace(/\*\//g, '* /') + ' */\n  ' + name + (f.required ? '' : '?') + ': SankoreValue;';
  });
  return [
    '/**',
    ' * Champs attendus par le CRM (' + origin + ').',
    ' * Si la configuration change dans le CRM, recopiez ce fichier.',
    ' */',
    'export interface SankoreLeadFields {',
    ...lines,
    '}',
  ].join('\n');
}

const CORE = (input: FrameworkSnippetInput) => `const SANKORE_API = '${input.apiBaseUrl}';
const SANKORE_KEY = '${input.publicKey}';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export type SankoreValue = string | number | boolean | string[] | null | undefined;

${fieldsInterface(input)}

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

function toText(value: SankoreValue): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join('; ');
  return String(value);
}

async function sendLead(fields: SankoreLeadFields, options: SankoreSubmitOptions, loadedAt: Date): Promise<SankoreResult> {
  const utm = storedUtm();
  const payload = {
    fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, toText(v as SankoreValue)])),
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

${CORE(input)}

@Injectable({ providedIn: 'root' })
export class SankoreLeadService {
  private readonly _browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly _loadedAt = new Date();

  constructor() {
    if (this._browser) { captureUtm(); ping(); }
  }

  /** Envoie un lead : \`fields\` suit \`SankoreLeadFields\`, la liste que le CRM attend. */
  public submit(fields: SankoreLeadFields, options: SankoreSubmitOptions): Promise<SankoreResult> {
    if (!this._browser) return Promise.resolve({ ok: false, status: 0, error: 'SERVER_SIDE' });
    return sendLead(fields, options, this._loadedAt);
  }
}

/* Exemple d'utilisation dans un composant :

  private readonly _sankore = inject(SankoreLeadService);
  private readonly _shownAt = new Date();

  async send(): Promise<void> {
    const result = await this._sankore.submit(
      ${exampleFields(input, 'this.')},
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

${CORE(input)}

type Status = 'idle' | 'sending' | 'sent' | 'error';

/** \`submit(fields)\` : \`fields\` suit \`SankoreLeadFields\`, la liste que le CRM attend. */
export function useSankoreLead() {
  const loadedAt = useRef(new Date());
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { captureUtm(); ping(); }, []);

  const submit = useCallback(async (fields: SankoreLeadFields, options: SankoreSubmitOptions) => {
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
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; // ou votre état
    await submit(${exampleFields(input, 'data.')}, { consent: true });
  }
*/
`;
}

/** Les champs obligatoires (au moins deux) de l'exemple d'utilisation. */
function exampleFields(input: FrameworkSnippetInput, prefix: string): string {
  const required = input.fields.filter((f) => f.required);
  const picked = (required.length >= 2 ? required : [...required, ...input.fields.filter((f) => !f.required)]).slice(0, 3);
  const pairs = picked.map((f) => {
    const name = IDENTIFIER.test(f.key) ? f.key : "'" + f.key + "'";
    const value = IDENTIFIER.test(f.key) ? prefix + f.key : prefix.replace(/\.$/, '') + "['" + f.key + "']";
    return name + ': ' + value;
  });
  return '{ ' + pairs.join(', ') + ' }';
}

// ——— Formulaire hébergé (docs/formulaire-heberge.md, lot 4) ———

/**
 * Ce que le script doit savoir pour le formulaire créé dans le CRM. Depuis la version 1.4.0, il
 * surveille la page : chargé UNE fois dans `index.html`, il remplit le conteneur dès qu'il apparaît
 * (route, @if, rendu React) et prévient la page par les évènements `sankore:success` et
 * `sankore:error`. Plus besoin de charger le script depuis un composant ni d'observer la page.
 */
export interface HostedSnippetInput {
  sdkUrl: string;
  sriHash: string;
  publicKey: string;
  apiBaseUrl: string;
  containerId: string;
  sourceLabel: string;
}

export function hostedScriptTag(input: HostedSnippetInput): string {
  return `<!-- Sankore CRM — formulaire « ${input.sourceLabel} » : une seule fois, dans index.html -->
<script src="${input.sdkUrl}"
        integrity="${input.sriHash}"
        crossorigin="anonymous"
        data-sankore-key="${input.publicKey}"
        data-sankore-api="${input.apiBaseUrl}"
        data-sankore-render="true"
        data-sankore-container="#${input.containerId}"
        defer></script>`;
}

export function angularHostedSnippet(input: HostedSnippetInput): string {
  return `// sankore-form.ts — le formulaire « ${input.sourceLabel} », composé dans le CRM
import { Component, ElementRef, afterNextRender, inject, output } from '@angular/core';

/**
 * Affichez <app-sankore-form /> où le formulaire doit apparaître. Le script chargé dans index.html
 * le remplit ; ses champs, son texte et son captcha se règlent dans le CRM (onglet « Champs du formulaire »).
 */
@Component({
  selector: 'app-sankore-form',
  template: '<div id="${input.containerId}"></div>',
})
export class SankoreForm {
  /** Le CRM a reçu la demande. */
  public readonly sent = output<string | null>();
  /** Le CRM a refusé la demande (le formulaire affiche déjà le message). */
  public readonly failed = output<string | null>();

  constructor() {
    const host = inject(ElementRef).nativeElement as HTMLElement;
    afterNextRender(() => {
      host.addEventListener('sankore:success', (e) => this.sent.emit((e as CustomEvent).detail?.ingestionId ?? null));
      host.addEventListener('sankore:error', (e) => this.failed.emit((e as CustomEvent).detail?.error ?? null));
    });
  }
}
`;
}

export function reactHostedSnippet(input: HostedSnippetInput): string {
  return `// SankoreForm.tsx — le formulaire « ${input.sourceLabel} », composé dans le CRM
// Next.js : ajoutez 'use client'; en première ligne.
import { useEffect, useRef } from 'react';

interface Props {
  /** Le CRM a reçu la demande. */
  onSent?: (ingestionId: string | null) => void;
  /** Le CRM a refusé la demande (le formulaire affiche déjà le message). */
  onError?: (error: string | null) => void;
}

/**
 * Affichez <SankoreForm /> où le formulaire doit apparaître. Le script chargé dans index.html le
 * remplit ; ses champs, son texte et son captcha se règlent dans le CRM (onglet « Champs du formulaire »).
 */
export function SankoreForm({ onSent, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sent = (e: Event) => onSent?.((e as CustomEvent).detail?.ingestionId ?? null);
    const failed = (e: Event) => onError?.((e as CustomEvent).detail?.error ?? null);
    el.addEventListener('sankore:success', sent);
    el.addEventListener('sankore:error', failed);
    return () => {
      el.removeEventListener('sankore:success', sent);
      el.removeEventListener('sankore:error', failed);
    };
  }, [onSent, onError]);

  return <div id="${input.containerId}" ref={ref} />;
}
`;
}
