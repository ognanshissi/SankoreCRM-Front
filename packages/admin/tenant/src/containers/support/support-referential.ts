import { HttpErrorResponse } from '@angular/common/http';
import { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from '@sankore/crm-admin-api';
import { StatusStyle } from '../modules/module-referential';

/** Même grammaire visuelle que les statuts de module : une pastille et un libellé. */
export const SUPPORT_STATUS_STYLE: Record<SupportTicketStatus, StatusStyle> = {
  New: { label: 'Nouveau', tone: 'text-blue-800', dot: 'bg-blue-400' },
  InProgress: { label: 'En cours', tone: 'text-primary', dot: 'bg-primary' },
  WaitingOnTenant: { label: 'En attente du client', tone: 'text-orange-800', dot: 'bg-orange-300' },
  Resolved: { label: 'Résolu', tone: 'text-green-800', dot: 'bg-green-700' },
  Closed: { label: 'Fermé', tone: 'text-slate-600', dot: 'bg-slate-400' },
};

export function supportStatusStyle(status: SupportTicketStatus | null | undefined): StatusStyle {
  return SUPPORT_STATUS_STYLE[status ?? SupportTicketStatus.New];
}

export const SUPPORT_STATUS_OPTIONS = Object.values(SupportTicketStatus).map((s) => ({
  label: SUPPORT_STATUS_STYLE[s].label,
  value: s,
}));

export const SUPPORT_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  Low: 'Basse',
  Normal: 'Normale',
  High: 'Haute',
  Blocking: 'Bloquante',
};

export const SUPPORT_PRIORITY_TONE: Record<SupportTicketPriority, string> = {
  Low: 'text-slate-500',
  Normal: 'text-slate-700',
  High: 'font-semibold text-orange-700',
  Blocking: 'font-bold text-red-700',
};

export const SUPPORT_PRIORITY_OPTIONS = Object.values(SupportTicketPriority).map((p) => ({
  label: SUPPORT_PRIORITY_LABELS[p],
  value: p,
}));

export const SUPPORT_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  Bug: 'Anomalie',
  Question: 'Question',
  Access: 'Accès / compte',
  ModulesBilling: 'Modules / facturation',
  Suggestion: 'Suggestion',
};

const ERROR_MESSAGES: Record<string, string> = {
  SUPPORT_TICKET_NOT_FOUND: 'Ce ticket n’existe plus.',
  SUPPORT_TICKET_CLOSED: 'Ce ticket est fermé : rouvrez-le (statut « En cours ») pour répondre.',
  SUPPORT_INVALID_TRANSITION: 'Le ticket est déjà dans ce statut — la fiche a été rechargée.',
  SUPPORT_ASSIGNEE_NOT_FOUND: 'Cet administrateur n’existe plus ou est désactivé.',
  INVALID_SUPPORT_MESSAGE: 'Le message est vide ou trop long (10 000 caractères au plus).',
  INVALID_ACTOR: 'Votre session d’administrateur n’est plus reconnue. Reconnectez-vous.',
  PLATFORM_ADMIN_REQUIRED: 'Cette action exige une session d’administrateur de la plateforme.',
};

export function describeSupportError(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  if (err.status === 0) return 'Le serveur d’administration est injoignable.';
  const code: string | undefined = err.error?.error;
  return (code && ERROR_MESSAGES[code]) || err.error?.detail || fallback;
}
