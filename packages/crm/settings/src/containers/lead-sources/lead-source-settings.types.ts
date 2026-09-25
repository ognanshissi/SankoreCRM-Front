/**
 * FE-01 — Union discriminee des settings de source, sur `$mode`.
 *
 * Le contrat genere (`SourceSettings`) ne porte que `schemaVersion` et
 * `expectedMode` : le reste du sac est libre cote API. Ce module est donc la
 * SEULE frontiere entre ce sac et le reste du front :
 *
 *   - `readSettings(dto)`  — unique point d'entree : normalise et restreint
 *   - `writeSettings(...)` — unique point de sortie : porte l'unique cast
 *
 * Aucun autre fichier ne doit caster `settings`.
 */

import { SourceSettings } from '@sankore/crm-api';
import { assertNever, IntegrationMode } from './lead-source.types';
import {
  emptyRule,
  MapEntry,
  MappingRule,
  TransformationType,
} from './field-mapping.types';

// ——— Consentement (FE-08) ———

export type ConsentPolicy =
  | 'CollectedByForm'
  | 'ProviderAttested'
  | 'LegitimateInterest'
  | 'None';

export interface ConsentConfig {
  policy: ConsentPolicy;
  consentFieldPath: string;
  consentTextVersion: string;
  providerContractRef: string;
}

export function emptyConsentConfig(): ConsentConfig {
  return {
    policy: 'None',
    consentFieldPath: '',
    consentTextVersion: '',
    providerContractRef: '',
  };
}

// ——— Script embarque (FE-10) ———

export type CaptchaProvider = 'None' | 'Turnstile' | 'HCaptcha' | 'RecaptchaV3';

export interface ScriptConfig {
  allowedOrigins: string[];
  formMode: 'existing' | 'hosted';
  formSelector: string;
  /** FE-10 AC2 — attributs `name` du formulaire existant, separes par des virgules. */
  formFieldNames: string;
  captchaProvider: CaptchaProvider;
  captchaSiteKey: string;
  honeypot: boolean;
  minFillTimeSeconds: number;
  afterSubmit: 'message' | 'redirect';
  successMessage: string;
  redirectUrl: string;
  preventDefaultSubmit: boolean;
}

export function defaultScriptConfig(): ScriptConfig {
  return {
    allowedOrigins: [''],
    formMode: 'existing',
    formSelector: '',
    formFieldNames: '',
    captchaProvider: 'None',
    captchaSiteKey: '',
    honeypot: true,
    minFillTimeSeconds: 3,
    afterSubmit: 'message',
    successMessage: 'Merci, votre demande a bien été envoyée.',
    redirectUrl: '',
    preventDefaultSubmit: true,
  };
}

// ——— Collecte planifiee (FE-19 / FE-21) ———

export type PullAuthType =
  | 'ApiKey'
  | 'Bearer'
  | 'OAuthClientCredentials'
  | 'Basic'
  | 'None';

export type PullAuthLocation = 'header' | 'query';

export type PaginationStrategy =
  | 'None'
  | 'Page'
  | 'Offset'
  | 'Cursor'
  | 'LinkHeader'
  | 'Since';

export type PullHttpMethod = 'GET' | 'POST';
export type AckHttpMethod = 'POST' | 'PUT' | 'PATCH';

export interface PullConfig {
  baseUrl: string;
  authType: PullAuthType;
  authHeaderName: string;
  authHeaderLocation: PullAuthLocation;
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthScope: string;
  requestMethod: PullHttpMethod;
  requestPath: string;
  requestParams: string;
  paginationStrategy: PaginationStrategy;
  pageParamName: string;
  pageSizeParamName: string;
  cursorJsonPath: string;
  sinceField: string;
  dataJsonPath: string;
  idJsonPath: string;
  dateJsonPath: string;
  cronExpression: string;
  schedulePreset: string;
  /** FE-21 — heure (0-23) de la collecte quotidienne. */
  dailyHour: number;
  ackEnabled: boolean;
  ackMethod: AckHttpMethod;
  ackPath: string;
  costPerLead: number | null;
  costCurrency: string;
}

export function defaultPullConfig(): PullConfig {
  return {
    baseUrl: '',
    authType: 'None',
    authHeaderName: 'X-API-Key',
    authHeaderLocation: 'header',
    oauthTokenUrl: '',
    oauthClientId: '',
    oauthScope: '',
    requestMethod: 'GET',
    requestPath: '/leads',
    requestParams: '',
    paginationStrategy: 'None',
    pageParamName: 'page',
    pageSizeParamName: 'pageSize',
    cursorJsonPath: '$.nextCursor',
    sinceField: 'since',
    dataJsonPath: '$.data',
    idJsonPath: '$.id',
    dateJsonPath: '$.createdAt',
    cronExpression: '',
    schedulePreset: '15min',
    dailyHour: 6,
    ackEnabled: false,
    ackMethod: 'POST',
    ackPath: '/leads/ack',
    costPerLead: null,
    costCurrency: 'XOF',
  };
}

// ——— Formulaire heberge (FE-15 / FE-16) ———

/**
 * Definition du formulaire rendu par le SDK quand `formMode === 'hosted'`.
 *
 * La forme est alignee sur `WebFormResponse` / `WebFormFieldDto` (contrat deja
 * genere, servi par `GET /api/ingest/web/{publicKey}/form`) : ce que l'editeur
 * produit est exactement ce que le SDK consomme, sans traduction intermediaire.
 */
export type HostedFieldType = 'text' | 'email' | 'tel' | 'textarea' | 'select';

export interface HostedFormField {
  /** Attribut `name` envoye au CRM — sert de champ source au mapping FE-07. */
  name: string;
  label: string;
  type: HostedFieldType;
  isRequired: boolean;
  placeholder: string;
  options: string[];
}

export interface HostedFormConfig {
  fields: HostedFormField[];
  consentText: string;
  consentVersion: string;
  submitLabel: string;
  /** Couleur d'accent, exposee au site hote via une variable CSS. */
  accentColor: string;
  fontFamily: string;
}

/** Catalogue ferme des champs proposables (FE-16 AC1). */
export interface HostedFieldTemplate {
  name: string;
  label: string;
  type: HostedFieldType;
  placeholder: string;
  /** Impose par le metier : ni retirable, ni facultatif (FE-16 AC3). */
  locked?: boolean;
}

export const HOSTED_FIELD_CATALOG: HostedFieldTemplate[] = [
  { name: 'lastName', label: 'Nom', type: 'text', placeholder: 'Votre nom' },
  { name: 'firstName', label: 'Prénom', type: 'text', placeholder: 'Votre prénom' },
  { name: 'phoneNumber', label: 'Téléphone', type: 'tel', placeholder: '07 00 00 00 00', locked: true },
  { name: 'email', label: 'E-mail', type: 'email', placeholder: 'vous@exemple.ci' },
  { name: 'city', label: 'Ville', type: 'text', placeholder: 'Votre ville' },
  { name: 'productCode', label: "Produit d'intérêt", type: 'select', placeholder: '' },
  { name: 'message', label: 'Message', type: 'textarea', placeholder: 'Votre message' },
];

/** Le telephone est toujours present et toujours obligatoire (FE-16 AC3). */
export const LOCKED_FIELD_NAME = 'phoneNumber';

export function fieldFromTemplate(t: HostedFieldTemplate): HostedFormField {
  return {
    name: t.name,
    label: t.label,
    type: t.type,
    isRequired: !!t.locked,
    placeholder: t.placeholder,
    options: [],
  };
}

export function defaultHostedFormConfig(): HostedFormConfig {
  const phone = HOSTED_FIELD_CATALOG.find((f) => f.name === LOCKED_FIELD_NAME)!;
  return {
    fields: [
      fieldFromTemplate(HOSTED_FIELD_CATALOG.find((f) => f.name === 'lastName')!),
      fieldFromTemplate(phone),
    ],
    consentText:
      "J'accepte d'être contacté(e) au sujet de ma demande.",
    consentVersion: 'v1',
    submitLabel: 'Envoyer ma demande',
    accentColor: '#2563eb',
    fontFamily: 'inherit',
  };
}

// ——— Correspondance des champs persistee (FE-07) ———

/**
 * Forme reellement stockee : les options inutilisees valent `null`, et il n'y a
 * pas de `_uid` (purement UI). `MappingRule` est la forme editable.
 */
export interface PersistedMappingRule {
  sourceField: string;
  targetField: string;
  transformation: TransformationType;
  defaultValue: string | null;
  e164Country: string | null;
  mapEntries: MapEntry[] | null;
  concatSeparator: string | null;
}

export function toPersistedRules(rules: MappingRule[]): PersistedMappingRule[] {
  return rules.map((r) => ({
    sourceField: r.sourceField,
    targetField: r.targetField,
    transformation: r.transformation,
    defaultValue: r.defaultValue || null,
    e164Country: r.transformation === 'e164' ? r.e164Country : null,
    mapEntries: r.transformation === 'map' ? r.mapEntries : null,
    concatSeparator: r.transformation === 'concat' ? r.concatSeparator : null,
  }));
}

export function toEditableRules(raw: unknown): MappingRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const m = (entry ?? {}) as Partial<PersistedMappingRule>;
    const base = emptyRule();
    return {
      ...base,
      sourceField: m.sourceField ?? base.sourceField,
      targetField: m.targetField ?? base.targetField,
      transformation: m.transformation ?? base.transformation,
      defaultValue: m.defaultValue ?? base.defaultValue,
      e164Country: m.e164Country ?? base.e164Country,
      mapEntries: m.mapEntries ?? base.mapEntries,
      concatSeparator: m.concatSeparator ?? base.concatSeparator,
    };
  });
}

// ——— Union discriminee ———

export interface BaseSourceSettings {
  schemaVersion: number;
  /** Correspondance des champs — commune a tous les modes. */
  fieldMappings: MappingRule[];
  /** Politique de consentement — commune a tous les modes. */
  consent: ConsentConfig | null;
}

export interface ScriptSourceSettings extends BaseSourceSettings {
  $mode: 'EmbeddedScript';
  script: ScriptConfig | null;
  /** FE-16 — definition du formulaire rendu par le SDK (mode `hosted`). */
  hostedForm: HostedFormConfig | null;
}

export interface WebhookSourceSettings extends BaseSourceSettings {
  $mode: 'ServerWebhook';
  allowedIps: string[];
  externalIdPath: string | null;
}

export interface PullSourceSettings extends BaseSourceSettings {
  $mode: 'ScheduledPull';
  pull: PullConfig | null;
}

export interface PlatformSourceSettings extends BaseSourceSettings {
  $mode: 'PlatformConnection';
}

export interface SocialSourceSettings extends BaseSourceSettings {
  $mode: 'SocialTracking';
}

export interface InternalSourceSettings extends BaseSourceSettings {
  $mode: 'Internal';
}

export type LeadSourceSettings =
  | ScriptSourceSettings
  | WebhookSourceSettings
  | PullSourceSettings
  | PlatformSourceSettings
  | SocialSourceSettings
  | InternalSourceSettings;

// ——— Gardes de type ———

export function isScriptSettings(s: LeadSourceSettings): s is ScriptSourceSettings {
  return s.$mode === 'EmbeddedScript';
}

export function isWebhookSettings(s: LeadSourceSettings): s is WebhookSourceSettings {
  return s.$mode === 'ServerWebhook';
}

export function isPullSettings(s: LeadSourceSettings): s is PullSourceSettings {
  return s.$mode === 'ScheduledPull';
}

// ——— Lecture ———

type RawSettings = Record<string, unknown>;

/**
 * L'API renvoie le sac de settings en PascalCase (`FieldMappings`,
 * `TargetField`, ...) alors que le front ecrit en camelCase. Plutot que de
 * figer une casse — et de casser a chaque aller-retour — on normalise en
 * profondeur a la lecture. Les deux formes sont donc acceptees.
 */
function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.charAt(0).toLowerCase() + k.slice(1)] = camelizeKeys(v);
    }
    return out;
  }
  return value;
}

function raw(settings: SourceSettings | null | undefined): RawSettings {
  return camelizeKeys(settings ?? {}) as RawSettings;
}

function readConsent(value: unknown): ConsentConfig | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Partial<ConsentConfig>;
  return { ...emptyConsentConfig(), ...c };
}

function readScript(value: unknown): ScriptConfig | null {
  if (!value || typeof value !== 'object') return null;
  return { ...defaultScriptConfig(), ...(value as Partial<ScriptConfig>) };
}

function readHostedForm(value: unknown): HostedFormConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<HostedFormConfig>;
  const base = defaultHostedFormConfig();
  const fields = Array.isArray(raw.fields)
    ? raw.fields.map((f) => ({
        name: f?.name ?? '',
        label: f?.label ?? '',
        type: f?.type ?? 'text',
        isRequired: !!f?.isRequired,
        placeholder: f?.placeholder ?? '',
        options: Array.isArray(f?.options) ? f.options : [],
      }))
    : base.fields;
  return { ...base, ...raw, fields };
}

function readPull(value: unknown): PullConfig | null {
  if (!value || typeof value !== 'object') return null;
  return { ...defaultPullConfig(), ...(value as Partial<PullConfig>) };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Unique point d'entree. `mode` vient du DTO (source de verite) et sert de
 * discriminant ; `$mode` eventuellement stocke sert de repli.
 */
export function readSettings(
  settings: SourceSettings | null | undefined,
  mode: IntegrationMode | null | undefined,
): LeadSourceSettings {
  const r = raw(settings);
  const resolved = (mode ?? (r['$mode'] as IntegrationMode | undefined) ?? 'Internal') as IntegrationMode;

  const base: BaseSourceSettings = {
    schemaVersion: typeof r['schemaVersion'] === 'number' ? (r['schemaVersion'] as number) : 1,
    fieldMappings: toEditableRules(r['fieldMappings']),
    consent: readConsent(r['consent']),
  };

  switch (resolved) {
    case 'EmbeddedScript':
      return {
        ...base,
        $mode: 'EmbeddedScript',
        script: readScript(r['script']),
        hostedForm: readHostedForm(r['hostedForm']),
      };
    case 'ServerWebhook':
      return {
        ...base,
        $mode: 'ServerWebhook',
        allowedIps: readStringArray(r['allowedIps']),
        externalIdPath: typeof r['externalIdPath'] === 'string' ? (r['externalIdPath'] as string) : null,
      };
    case 'ScheduledPull':
      return { ...base, $mode: 'ScheduledPull', pull: readPull(r['pull']) };
    case 'PlatformConnection':
      return { ...base, $mode: 'PlatformConnection' };
    case 'SocialTracking':
      return { ...base, $mode: 'SocialTracking' };
    case 'Internal':
      return { ...base, $mode: 'Internal' };
    default:
      return assertNever(resolved);
  }
}

// ——— Ecriture ———

/**
 * Unique point de sortie : fusionne un patch dans les settings existants en
 * preservant les cles inconnues, et reaffirme `$mode` a chaque ecriture.
 * C'est le SEUL cast vers `SourceSettings` du front.
 */
export function writeSettings(
  current: SourceSettings | null | undefined,
  mode: IntegrationMode | null | undefined,
  patch: Record<string, unknown>,
): SourceSettings {
  // On fusionne sur le sac TEL QUEL (pas normalise) : renommer les cles que ce
  // patch ne touche pas ferait perdre les reglages des autres onglets.
  const current_ = (current ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current_, $mode: mode ?? null };

  // Un patch camelCase doit ecraser son homologue PascalCase eventuel.
  for (const key of Object.keys(patch)) {
    const pascal = key.charAt(0).toUpperCase() + key.slice(1);
    if (pascal !== key && pascal in merged) delete merged[pascal];
  }

  return { ...merged, ...patch } as SourceSettings;
}
