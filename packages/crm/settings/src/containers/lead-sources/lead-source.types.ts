/**
 * FE-01 — Types TypeScript pour les sources de leads.
 *
 * Unions de chaines alignees sur le contrat API, gardes de type exhaustives,
 * pas de secret en clair dans les modeles de lecture.
 */

import {
  LeadSourceListDto,
  LeadSourceListDtoChannelTypeEnum,
  LeadSourceListDtoModeEnum,
  LeadSourceListDtoStatusEnum,
  LeadSourceListDtoHealthEnum,
  SourceMetadataResponse,
  ChannelMetadata,
} from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

// ——— String union types (aligned with backend enums) ———

export type LeadChannelType = `${LeadSourceListDtoChannelTypeEnum}`;
export type IntegrationMode = `${LeadSourceListDtoModeEnum}`;
export type LeadSourceStatus = `${LeadSourceListDtoStatusEnum}`;
export type SourceHealth = `${LeadSourceListDtoHealthEnum}`;

// ——— Re-export generated enums as const objects for iteration ———

export const LeadChannelType = LeadSourceListDtoChannelTypeEnum;
export const IntegrationMode = LeadSourceListDtoModeEnum;
export const LeadSourceStatus = LeadSourceListDtoStatusEnum;
export const SourceHealth = LeadSourceListDtoHealthEnum;

// ——— Exhaustive guard helper ———

export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`);
}

// ——— Channel labels ———

const CHANNEL_LABELS: Record<LeadChannelType, string> = {
  WebForm: 'Formulaire web',
  InboundWebhook: 'Webhook entrant',
  ExternalApiPull: 'API externe (pull)',
  FacebookLeadAds: 'Facebook Lead Ads',
  InstagramLeadAds: 'Instagram Lead Ads',
  LinkedInLeadGen: 'LinkedIn Lead Gen',
  WhatsAppInbound: 'WhatsApp entrant',
  SocialEngagement: 'Réseaux sociaux',
  MobileAgent: 'Agent mobile',
  WalkIn: 'Visite agence',
  SmsUssdCampaign: 'SMS / USSD',
  Referral: 'Parrainage',
  FileImport: 'Import fichier',
  InboundCall: 'Appel entrant',
};

export function channelLabel(type: LeadChannelType | string | null | undefined): string {
  return CHANNEL_LABELS[type as LeadChannelType] ?? type ?? '—';
}

// ——— Mode labels ———

const MODE_LABELS: Record<IntegrationMode, string> = {
  EmbeddedScript: 'Script embarqué',
  ServerWebhook: 'Webhook serveur',
  ScheduledPull: 'Collecte planifiée',
  PlatformConnection: 'Connexion plateforme',
  SocialTracking: 'Suivi social',
  Internal: 'Interne',
};

export function modeLabel(mode: IntegrationMode | string | null | undefined): string {
  return MODE_LABELS[mode as IntegrationMode] ?? mode ?? '—';
}

/**
 * FE-05 — Onglet du detail sur lequel ouvrir une source selon son mode, pour
 * enchainer directement sur l'assistant apres la creation.
 */
export function tabForMode(mode: IntegrationMode | string | null | undefined): string {
  switch (mode) {
    case 'EmbeddedScript': return 'script-config';
    case 'ServerWebhook': return 'webhook';
    case 'ScheduledPull': return 'pull-config';
    default: return 'general';
  }
}

// ——— Status labels + severity ———

const STATUS_LABELS: Record<LeadSourceStatus, string> = {
  Draft: 'Brouillon',
  Testing: 'Test',
  Active: 'Active',
  Paused: 'En pause',
  Error: 'Erreur',
  Archived: 'Archivée',
};

export function statusLabel(status: LeadSourceStatus | string | null | undefined): string {
  return STATUS_LABELS[status as LeadSourceStatus] ?? status ?? '—';
}

export function statusSeverity(status: LeadSourceStatus | string | null | undefined): Severity {
  switch (status) {
    case 'Active': return 'success';
    case 'Testing': return 'info';
    case 'Draft': return 'neutral';
    case 'Paused': return 'warning';
    case 'Error': return 'error';
    case 'Archived': return 'neutral';
    default: return 'neutral';
  }
}

// ——— Health labels + icon ———

export function healthIcon(health: SourceHealth | string | null | undefined): string {
  switch (health) {
    case 'Ok': return 'feather:check-circle';
    case 'Stale': return 'feather:alert-triangle';
    case 'Error': return 'feather:x-circle';
    default: return 'feather:minus-circle';
  }
}

export function healthColor(health: SourceHealth | string | null | undefined): string {
  switch (health) {
    case 'Ok': return 'text-green-500';
    case 'Stale': return 'text-amber-500';
    case 'Error': return 'text-red-500';
    default: return 'text-slate-300';
  }
}

export function healthTooltip(health: SourceHealth | string | null | undefined): string {
  switch (health) {
    case 'Ok': return 'Fonctionnement normal';
    case 'Stale': return 'Aucun lead reçu depuis plus de 7 jours';
    case 'Error': return 'Erreur détectée';
    default: return 'Inconnu';
  }
}

// ——— Channel icon ———

export function channelIcon(type: LeadChannelType | string | null | undefined): string {
  switch (type) {
    case 'WebForm': return 'feather:globe';
    case 'InboundWebhook': return 'feather:zap';
    case 'ExternalApiPull': return 'feather:download-cloud';
    case 'FacebookLeadAds': return 'feather:facebook';
    case 'InstagramLeadAds': return 'feather:instagram';
    case 'LinkedInLeadGen': return 'feather:linkedin';
    case 'WhatsAppInbound': return 'feather:message-circle';
    case 'SocialEngagement': return 'feather:share-2';
    case 'MobileAgent': return 'feather:smartphone';
    case 'WalkIn': return 'feather:home';
    case 'SmsUssdCampaign': return 'feather:phone';
    case 'Referral': return 'feather:users';
    case 'FileImport': return 'feather:upload';
    case 'InboundCall': return 'feather:phone-incoming';
    default: return 'feather:radio';
  }
}

// ——— Filter option builders (from metadata) ———

export function buildChannelOptions(metadata: SourceMetadataResponse | null): { label: string; value: string }[] {
  return (metadata?.channels ?? []).map((ch: ChannelMetadata) => ({
    label: channelLabel(ch.code),
    value: ch.code ?? '',
  }));
}

export function buildModeOptions(metadata: SourceMetadataResponse | null): { label: string; value: string }[] {
  return (metadata?.modes ?? []).map((m: string) => ({
    label: modeLabel(m),
    value: m,
  }));
}

export function buildStatusOptions(): { label: string; value: string }[] {
  return Object.values(LeadSourceStatus).map((s) => ({
    label: statusLabel(s),
    value: s,
  }));
}

// ——— Numeric enum mapping for API filter params ———
//
// L'API attend des index numeriques pour les filtres. Ils sont ecrits
// explicitement (et non derives de la position dans l'enum genere) : une
// insertion ou un reordonnancement cote OpenAPI casserait silencieusement
// tous les filtres. Les `Record` complets forcent le compilateur a signaler
// toute valeur ajoutee au contrat.

/**
 * Filtre -> paramètre de requête. Ces énumérations sortaient en ENTIER du contrat tant
 * qu'elles étaient optionnelles : côté API, `EnumSchemaFilter` testait `context.Type.IsEnum`,
 * qui est faux pour un `Nullable<TEnum>`, si bien que seules les énumérations obligatoires
 * étaient documentées en chaîne. Il fallait donc traduire chaque nom en indice ici — avec des
 * correspondances devinées, puisque le swagger ne nommait rien. Le contrat les expose
 * désormais en chaîne des deux côtés : il ne reste qu'à valider que la valeur vient bien de
 * l'énumération. Ne réintroduis pas de table d'indices.
 */
export function channelTypeToParam(value: string | null | undefined): LeadChannelType | undefined {
  return value && value in LeadChannelType ? (value as LeadChannelType) : undefined;
}

export function modeToParam(value: string | null | undefined): IntegrationMode | undefined {
  return value && value in IntegrationMode ? (value as IntegrationMode) : undefined;
}

export function statusToParam(value: string | null | undefined): LeadSourceStatus | undefined {
  return value && value in LeadSourceStatus ? (value as LeadSourceStatus) : undefined;
}
