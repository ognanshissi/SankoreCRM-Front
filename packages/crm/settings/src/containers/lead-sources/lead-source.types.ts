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

export type ChannelTypeParam =
  | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type ModeParam = 0 | 1 | 2 | 3 | 4 | 5;
export type StatusParam = 0 | 1 | 2 | 3 | 4 | 5;

const CHANNEL_TYPE_PARAM: Record<LeadChannelType, ChannelTypeParam> = {
  WebForm: 0,
  InboundWebhook: 1,
  ExternalApiPull: 2,
  FacebookLeadAds: 3,
  InstagramLeadAds: 4,
  LinkedInLeadGen: 5,
  WhatsAppInbound: 6,
  SocialEngagement: 7,
  MobileAgent: 8,
  WalkIn: 9,
  SmsUssdCampaign: 10,
  Referral: 11,
  FileImport: 12,
  InboundCall: 13,
};

const MODE_PARAM: Record<IntegrationMode, ModeParam> = {
  EmbeddedScript: 0,
  ServerWebhook: 1,
  ScheduledPull: 2,
  PlatformConnection: 3,
  SocialTracking: 4,
  Internal: 5,
};

const STATUS_PARAM: Record<LeadSourceStatus, StatusParam> = {
  Draft: 0,
  Testing: 1,
  Active: 2,
  Paused: 3,
  Error: 4,
  Archived: 5,
};

export function channelTypeToNumeric(value: string | null | undefined): ChannelTypeParam | undefined {
  return value ? CHANNEL_TYPE_PARAM[value as LeadChannelType] : undefined;
}

export function modeToNumeric(value: string | null | undefined): ModeParam | undefined {
  return value ? MODE_PARAM[value as IntegrationMode] : undefined;
}

export function statusToNumeric(value: string | null | undefined): StatusParam | undefined {
  return value ? STATUS_PARAM[value as LeadSourceStatus] : undefined;
}
