import { HttpErrorResponse } from '@angular/common/http';

/**
 * Le vocabulaire WhatsApp de la fiche lead : les obstacles à l'envoi, les états, les statuts.
 * Les codes viennent du serveur (WhatsAppErrors, IntegrationErrors) ; un code inconnu s'affiche
 * tel quel plutôt que d'être tu.
 */
export const WHATSAPP_BLOCKER_LABELS: Record<string, string> = {
  WHATSAPP_LEAD_CLOSED: 'Ce lead est clôturé.',
  WHATSAPP_CONSENT_MISSING: 'Le consentement WhatsApp n’est pas renseigné.',
  WHATSAPP_CONSENT_REVOKED: 'Le prospect a retiré son consentement WhatsApp.',
  WHATSAPP_PHONE_INVALID: 'Le numéro ne peut pas s’écrire au format international (indicatif manquant ?).',
  WHATSAPP_CHANNEL_INACTIVE: 'Aucun numéro WhatsApp actif pour l’agence de ce lead.',
  WHATSAPP_TEMPLATE_COOLDOWN: 'Un template a déjà été envoyé il y a moins de 24 h, sans réponse.',
};

const SEND_ERROR_LABELS: Record<string, string> = {
  ...WHATSAPP_BLOCKER_LABELS,
  WHATSAPP_TEMPLATE_NOT_FOUND: 'Ce template n’existe plus pour ce numéro.',
  WHATSAPP_TEMPLATE_NOT_APPROVED: 'Ce template n’est pas approuvé par Meta.',
  WHATSAPP_TEMPLATE_NOT_FOR_PRODUCT: 'Ce template n’est pas prévu pour le produit de ce lead.',
  WHATSAPP_VARIABLES_INVALID: 'Chaque variable doit être renseignée, sur une seule ligne.',
  LEAD_NOT_YOURS: 'Ce lead n’est pas dans votre portefeuille.',
  LEAD_NOT_FOUND: 'Lead introuvable.',
};

/** Pourquoi un message n'est pas parti, tel que l'agent le lit sous la bulle. */
export const WHATSAPP_FAILURE_LABELS: Record<string, string> = {
  MESSAGING_RECIPIENT_INVALID: 'Ce numéro ne reçoit pas de messages WhatsApp.',
  MESSAGING_TEMPLATE_REJECTED: 'Meta a refusé le template.',
  MESSAGING_OUTSIDE_WINDOW: 'Hors de la fenêtre de 24 h : seul un template peut être envoyé.',
  MESSAGING_QUOTA_EXCEEDED: 'Limite d’envoi atteinte, réessayez plus tard.',
  MESSAGING_NOT_DELIVERED: 'Meta n’a pas délivré le message.',
  MESSAGING_CHANNEL_INACTIVE: 'Le numéro WhatsApp de l’institution est désactivé.',
  INTEGRATION_AUTHENTICATION_REFUSED: '360dialog refuse la clé API du numéro.',
  INTEGRATION_CREDENTIAL_MISSING: 'La clé API du numéro n’est pas configurée.',
  INTEGRATION_UNAVAILABLE: '360dialog est indisponible.',
  INTEGRATION_TIMEOUT: '360dialog n’a pas répondu à temps.',
  WHATSAPP_SEND_UNCERTAIN: 'Envoi incertain : vérifiez avant de renvoyer.',
  WHATSAPP_SEND_FAILED: 'L’envoi a échoué.',
};

export function whatsAppBlockerLabel(code: string): string {
  return WHATSAPP_BLOCKER_LABELS[code] ?? code;
}

export function whatsAppFailureLabel(code: string | null | undefined): string {
  return code ? WHATSAPP_FAILURE_LABELS[code] ?? code : 'Échec de l’envoi.';
}

export function whatsAppSendError(error: HttpErrorResponse): string {
  const code = error.error?.detail ?? error.error?.error;
  if (code && SEND_ERROR_LABELS[code]) return SEND_ERROR_LABELS[code];
  if (error.status === 403) return 'Vous n’avez pas le droit d’écrire à ce lead sur WhatsApp.';
  return code || 'L’envoi n’a pas pu être demandé.';
}

/** État de la conversation, pour le bandeau (WA-FE-06). */
export const CONVERSATION_STATUS: Record<string, { label: string; tone: string; icon: string }> = {
  AwaitingReply: { label: 'En attente du client', tone: 'bg-slate-100 text-slate-700', icon: 'feather:clock' },
  Bot: { label: 'Bot actif', tone: 'bg-sky-50 text-sky-800', icon: 'feather:cpu' },
  PendingHuman: { label: 'En attente d’un agent', tone: 'bg-amber-50 text-amber-800', icon: 'feather:alert-circle' },
  Human: { label: 'Pris en charge', tone: 'bg-emerald-50 text-emerald-800', icon: 'feather:user-check' },
  Closed: { label: 'Clôturée', tone: 'bg-slate-100 text-slate-500', icon: 'feather:archive' },
};

/** Le badge de consentement (WA-FE-03). */
export const CONSENT_STATE: Record<string, { label: string; tone: string }> = {
  Granted: { label: 'Consenti', tone: 'bg-emerald-50 text-emerald-800' },
  Unknown: { label: 'Non renseigné', tone: 'bg-slate-100 text-slate-600' },
  Revoked: { label: 'Révoqué', tone: 'bg-red-50 text-red-700' },
};

export const CONSENT_CHANNEL_LABELS: Record<string, string> = {
  WebForm: 'formulaire web',
  Phone: 'appel téléphonique',
  Paper: 'formulaire signé',
  Sms: 'SMS',
  InPerson: 'en agence',
  WhatsApp: 'message WhatsApp entrant',
  Email: 'e-mail',
  Import: 'import',
  Other: 'autre',
};

/** Pourquoi la conversation attend une personne (WA-FE-06, WA-FE-12). */
export const ESCALATION_REASON_LABELS: Record<string, string> = {
  CUSTOMER_REPLIED: 'Le client a répondu',
  REASSIGNED: 'Conversation réattribuée',
  TAKEOVER_SLA_BREACHED: 'Délai de prise en charge dépassé',
  // Lot 3 : les règles du bot et ses propres raisons. Le serveur envoie aussi le libellé
  // (`escalationReasonLabel`) ; cette table ne sert qu'aux écrans qui n'ont que le code.
  BOT_HUMAN_REQUESTED: 'Le client demande un conseiller',
  BOT_SENSITIVE_KEYWORD: 'Sujet sensible détecté',
  BOT_NO_USEFUL_ANSWER: 'Le bot n’a pas su répondre',
  BOT_LEAD_QUALIFIED: 'Prospect qualifié',
  BOT_WINDOW_EXPIRING: 'Fenêtre WhatsApp bientôt fermée',
  BOT_UNSUPPORTED_MESSAGE: 'Message que le bot ne sait pas lire',
  BOT_FAILURE: 'Le bot n’a pas pu répondre',
  BOT_DISABLED: 'Bot désactivé',
  BOT_CUSTOMER_REQUEST: 'Le client demande un conseiller',
  BOT_READY_TO_SUBSCRIBE: 'Le client veut souscrire',
  BOT_COMPLAINT: 'Réclamation',
  BOT_SENSITIVE_TOPIC: 'Sujet sensible',
  BOT_OUT_OF_SCOPE: 'Question hors du périmètre du bot',
  BOT_OTHER: 'Passage à un conseiller demandé par le bot',
};

/**
 * Où se corrige chaque champ recueilli par le bot (WA-FE-12) : l'onglet de la fiche qui le porte.
 */
export const BOT_FIELD_TABS: Record<string, string> = {
  FIRST_NAME: 'identite',
  LAST_NAME: 'identite',
  CITY: 'identite',
  EMAIL: 'informations',
  DESIRED_AMOUNT: 'informations',
};

const ACTION_ERROR_LABELS: Record<string, string> = {
  ...SEND_ERROR_LABELS,
  WHATSAPP_NOT_HOLDER: 'Vous n’avez pas la main sur cette conversation.',
  WHATSAPP_CONVERSATION_ALREADY_ATTACHED: 'Cette conversation est déjà rattachée à une fiche lead.',
  WHATSAPP_CONVERSATION_HELD_BY_ANOTHER: 'Un autre agent a la main : un superviseur doit d’abord la réassigner.',
  WHATSAPP_WINDOW_CLOSED: 'La fenêtre de 24 h est fermée : seul un template peut être envoyé.',
  WHATSAPP_TEXT_INVALID: 'Le message est vide ou trop long.',
  WHATSAPP_MEDIA_INVALID: 'Ce fichier n’est pas une image JPEG/PNG ou un PDF valide, ou il est trop lourd.',
  WHATSAPP_CONVERSATION_CLOSED: 'La conversation est clôturée.',
  WHATSAPP_CLOSE_REASON_REQUIRED: 'Le motif de clôture est obligatoire.',
  WHATSAPP_AGENT_NOT_IN_TEAM: 'Cet agent ne fait pas partie de votre équipe.',
  WHATSAPP_NOT_SUPERVISOR: 'Seul un superviseur peut réassigner une conversation.',
  WHATSAPP_CONVERSATION_NOT_FOUND: 'Conversation introuvable.',
};

export function whatsAppActionError(error: HttpErrorResponse): string {
  const code = error.error?.detail ?? error.error?.error;
  if (code && ACTION_ERROR_LABELS[code]) return ACTION_ERROR_LABELS[code];
  if (error.status === 403) return 'Vous n’avez pas le droit de faire cela sur cette conversation.';
  return code || 'L’action n’a pas pu être effectuée.';
}
