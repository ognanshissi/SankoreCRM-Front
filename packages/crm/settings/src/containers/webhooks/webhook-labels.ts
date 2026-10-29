import { HttpErrorResponse } from '@angular/common/http';
import { WebhookDeliveryDto, WebhookSubscriptionDto } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

export interface WebhookState {
  label: string;
  severity: Severity;
}

/** Actif, désactivé à la main, ou coupé par la plateforme après une journée d’échecs. */
export function webhookState(s: WebhookSubscriptionDto): WebhookState {
  if (s.isActive) {
    return (s.consecutiveFailures ?? 0) > 0
      ? { label: 'Actif — en échec', severity: 'warning' }
      : { label: 'Actif', severity: 'success' };
  }
  return s.disabledAt
    ? { label: 'Coupé automatiquement', severity: 'error' }
    : { label: 'Désactivé', severity: 'neutral' };
}

const DELIVERY_STATUS: Record<string, WebhookState> = {
  Pending: { label: 'En attente', severity: 'info' },
  Succeeded: { label: 'Livré', severity: 'success' },
  Failed: { label: 'Abandonné', severity: 'error' },
  Cancelled: { label: 'Annulé', severity: 'neutral' },
};

export function deliveryState(d: WebhookDeliveryDto): WebhookState {
  return DELIVERY_STATUS[d.status ?? ''] ?? { label: d.status ?? '—', severity: 'neutral' };
}

export const DELIVERY_STATUS_OPTIONS = [
  // Pas de valeur vide : tas-select n'affiche pas l'option d'une valeur vide, et le filtre
  // montrait « Choisissez une option » au lieu de « Tous les statuts ».
  { label: 'Tous les statuts', value: 'All' },
  { label: 'En attente', value: 'Pending' },
  { label: 'Livré', value: 'Succeeded' },
  { label: 'Abandonné', value: 'Failed' },
  { label: 'Annulé', value: 'Cancelled' },
];

/** Ce que le partenaire a répondu, ou pourquoi rien n’est parti — jamais le code brut seul. */
export function failureLabel(code: string | null | undefined): string {
  if (!code) return '';
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) return `Le partenaire a répondu ${http[1]}`;
  switch (code) {
    case 'TIMEOUT':
      return 'Pas de réponse en 10 secondes';
    case 'UNREACHABLE':
      return 'Adresse injoignable';
    case 'ADDRESS_REFUSED':
      return 'Adresse refusée (réseau interne ou port non autorisé)';
    case 'REDIRECT_REFUSED':
      return 'Redirection refusée (autre domaine ou http)';
    case 'NO_SECRET':
      return 'Aucun secret de signature';
    case 'SUBSCRIPTION_DISABLED':
      return 'Webhook désactivé avant l’envoi';
    case 'SUBSCRIPTION_DELETED':
      return 'Webhook supprimé avant l’envoi';
    case 'SUBJECT_ERASED':
      return 'Données de la personne effacées';
    default:
      return code;
  }
}

/**
 * Le message d’un refus du serveur : le premier message de champ d’une erreur de validation
 * (422 avec `errors`), sinon le code métier traduit, sinon le texte par défaut.
 */
export function webhookErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error.error as { detail?: string; errors?: Record<string, string[]> } | null;
  const fieldMessage = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
  if (fieldMessage) return fieldMessage;

  switch (body?.detail) {
    case 'WEBHOOK_TOO_MANY':
      return 'Vingt webhooks au plus : supprimez-en un avant d’en créer un autre.';
    case 'WEBHOOK_EVENT_MODULE_DISABLED':
      return 'Un des événements choisis demande un module que l’institution n’a pas.';
    case 'WEBHOOK_SUBSCRIPTION_INACTIVE':
      return 'Réactivez le webhook avant de renvoyer une livraison.';
    case 'WEBHOOK_DELIVERY_ERASED':
      return 'Cette livraison concernait une personne dont les données ont été effacées : elle ne peut pas être renvoyée.';
    case 'WEBHOOK_NOT_FOUND':
    case 'WEBHOOK_DELIVERY_NOT_FOUND':
      return 'Introuvable : il a peut-être été supprimé.';
    default:
      return fallback;
  }
}

/**
 * Ce que le partenaire doit écrire pour vérifier une signature — affiché tel quel dans la
 * documentation. Node.js, parce que c’est ce que la plupart des intégrateurs ouvrent en premier.
 */
export const SIGNATURE_SNIPPET = `const crypto = require('crypto');

// header = req.headers['x-sankore-signature']  →  "t=1730198400,v1=ab12…[,v1=…]"
// body   = le corps BRUT de la requête, avant tout JSON.parse
function verify(header, body, secret, toleranceSeconds = 300) {
  const parts = header.split(',');
  const t = parts.find((p) => p.startsWith('t='))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false;

  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${body}\`).digest('hex');
  return signatures.some((s) =>
    s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}`;
