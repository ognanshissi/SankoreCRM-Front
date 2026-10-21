import { HttpErrorResponse } from '@angular/common/http';
import {
  WhatsAppChannelDto,
  WhatsAppVariableMappingDtoFieldEnum,
} from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

/** Un numéro E.164 : `+`, indicatif non nul, 8 à 15 chiffres au total. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export const DEFAULT_360DIALOG_BASE_URL = 'https://waba-v2.360dialog.io';

export interface ChannelStatusView {
  label: string;
  severity: Severity;
}

/**
 * Le serveur dit `status` en chaîne (Active / Pending / Error). Une valeur inconnue est
 * affichée telle quelle plutôt que rangée d'autorité dans « En attente ».
 */
export function channelStatusView(channel: WhatsAppChannelDto): ChannelStatusView {
  switch (channel.status) {
    case 'Active':
      return { label: 'Actif', severity: 'success' };
    case 'Pending':
      return { label: 'En attente', severity: 'warning' };
    case 'Error':
      return { label: 'Erreur', severity: 'error' };
    default:
      return { label: channel.status || 'Inconnu', severity: 'neutral' };
  }
}

export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilitaire',
  AUTHENTICATION: 'Authentification',
};

export const TEMPLATE_STATUS_VIEWS: Record<string, ChannelStatusView> = {
  Approved: { label: 'Approuvé', severity: 'success' },
  Pending: { label: 'En attente', severity: 'warning' },
  Rejected: { label: 'Refusé', severity: 'error' },
  Paused: { label: 'En pause', severity: 'warning' },
  Disabled: { label: 'Désactivé', severity: 'neutral' },
  Other: { label: 'Autre', severity: 'neutral' },
};

export function templateStatusView(status: string | null | undefined): ChannelStatusView {
  return (
    TEMPLATE_STATUS_VIEWS[status ?? ''] ?? { label: status || 'Autre', severity: 'neutral' }
  );
}

/** Les champs que le serveur sait substituer à une variable. Vide = l'agent saisit. */
export const VARIABLE_FIELD_LABELS: Record<WhatsAppVariableMappingDtoFieldEnum, string> = {
  [WhatsAppVariableMappingDtoFieldEnum.LeadFirstName]: 'Prénom du lead',
  [WhatsAppVariableMappingDtoFieldEnum.LeadLastName]: 'Nom du lead',
  [WhatsAppVariableMappingDtoFieldEnum.LeadFullName]: 'Nom complet du lead',
  [WhatsAppVariableMappingDtoFieldEnum.InterestedProduct]: 'Produit demandé',
  [WhatsAppVariableMappingDtoFieldEnum.AgentFirstName]: 'Prénom de l’agent',
  [WhatsAppVariableMappingDtoFieldEnum.AgentFullName]: 'Nom complet de l’agent',
};

export const VARIABLE_FIELD_OPTIONS: { label: string; value: string }[] = [
  { label: 'Aucun — l’agent saisit', value: '' },
  ...Object.entries(VARIABLE_FIELD_LABELS).map(([value, label]) => ({ label, value })),
];

const ERROR_MESSAGES: Record<string, string> = {
  MESSAGING_NUMBER_ALREADY_CONNECTED:
    'Ce numéro est déjà connecté, ici ou dans une autre institution.',
  INTEGRATION_CONNECTION_NOT_HEALTHY: 'Testez la connexion avec succès avant d’activer.',
  INTEGRATION_CREDENTIAL_MISSING: 'Aucune clé API 360dialog n’est enregistrée pour ce numéro.',
  INTEGRATION_AUTHENTICATION_REFUSED: '360dialog refuse la clé API.',
  MESSAGING_PUBLIC_URL_MISSING:
    'L’adresse publique de la plateforme n’est pas configurée : 360dialog ne saurait pas où livrer les messages.',
  INTEGRATION_FAKE_ADAPTER_NOT_ALLOWED: 'Les numéros simulés n’existent qu’en développement.',
  INTEGRATION_CONCURRENCY_CONFLICT:
    'Ce numéro a été modifié entre-temps. Rechargez la page et recommencez.',
  WHATSAPP_TEMPLATE_VARIABLE_UNKNOWN: 'Une variable ne correspond à aucune variable du template.',
  WHATSAPP_TEMPLATE_VARIABLE_DUPLICATE: 'Une même variable est paramétrée deux fois.',
};

/** Traduit un code connu ; rend le texte tel quel sinon (un détail libre venu du fournisseur). */
export function whatsAppCodeMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? code;
}

/**
 * Les endpoints des numéros répondent `{ error: CODE }`, ceux des templates un ProblemDetails
 * dont `detail` porte le code. Les deux sont lus ; un code inconnu est affiché tel quel plutôt
 * que noyé dans un message générique — c'est lui qui permet de chercher la cause côté serveur.
 */
export function whatsAppErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;

  const body = error.error;
  const code = typeof body?.error === 'string' ? body.error : typeof body?.detail === 'string' ? body.detail : null;

  if (code) return ERROR_MESSAGES[code] ?? code;

  const errors = body?.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors).flat()[0];
    if (typeof first === 'string') return first;
  }

  if (typeof body?.title === 'string' && body.title) return body.title;

  if (error.status === 403) return 'Vous n’avez pas le droit de paramétrer WhatsApp.';
  return fallback;
}

export interface PreviewSegment {
  kind: 'text' | 'variable';
  text: string;
  index?: number;
  label?: string | null;
}

/**
 * Découpe un texte de template autour de ses `{{n}}`, pour que l'aperçu puisse montrer chaque
 * variable comme une pastille portant le champ qui la remplira.
 */
export function splitTemplateText(
  text: string | null | undefined,
  labelFor: (index: number) => string | null,
): PreviewSegment[] {
  if (!text) return [];

  const segments: PreviewSegment[] = [];
  const pattern = /\{\{\s*(\d+)\s*\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    const index = Number(match[1]);
    segments.push({ kind: 'variable', text: `{{${index}}}`, index, label: labelFor(index) });
    last = match.index + match[0].length;
  }

  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}
