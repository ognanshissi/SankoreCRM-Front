import { Severity } from '@talisoft/ui/tag';
import {
  OpenSupportTicketCommandCategoryEnum as Category,
  OpenSupportTicketCommandPriorityEnum as Priority,
  SupportTicketSummaryDtoStatusEnum as Status,
} from '@sankore/crm-api';

export const STATUS_LABELS: Record<string, string> = {
  [Status.New]: 'Nouveau',
  [Status.InProgress]: 'En cours',
  [Status.WaitingOnTenant]: 'En attente de votre réponse',
  [Status.Resolved]: 'Résolu',
  [Status.Closed]: 'Fermé',
};

export const STATUS_SEVERITIES: Record<string, Severity> = {
  [Status.New]: 'info',
  [Status.InProgress]: 'primary',
  [Status.WaitingOnTenant]: 'warning',
  [Status.Resolved]: 'success',
  [Status.Closed]: 'neutral',
};

export const CATEGORY_OPTIONS = [
  { label: 'Anomalie', value: Category.Bug },
  { label: 'Question', value: Category.Question },
  { label: 'Accès / compte', value: Category.Access },
  { label: 'Modules / facturation', value: Category.ModulesBilling },
  { label: 'Suggestion', value: Category.Suggestion },
];

export const PRIORITY_OPTIONS = [
  { label: 'Basse', value: Priority.Low },
  { label: 'Normale', value: Priority.Normal },
  { label: 'Haute', value: Priority.High },
  { label: 'Bloquante — je ne peux plus travailler', value: Priority.Blocking },
];

export const PRIORITY_LABELS: Record<string, string> = {
  [Priority.Low]: 'Basse',
  [Priority.Normal]: 'Normale',
  [Priority.High]: 'Haute',
  [Priority.Blocking]: 'Bloquante',
};

export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORY_OPTIONS.map((o) => [o.value, o.label]),
);

export const STATUS_FILTER_OPTIONS = [
  { label: 'Ouverts', value: 'open' },
  { label: 'Tous', value: '' },
  ...Object.values(Status).map((s) => ({ label: STATUS_LABELS[s], value: s })),
];

/** Les codes d'erreur du serveur, en phrases. Un code inconnu ne s'affiche jamais tel quel. */
export function supportErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'SUPPORT_TICKET_CLOSED':
      return 'Ce ticket est fermé : rouvrez-le pour répondre.';
    case 'SUPPORT_INVALID_TRANSITION':
      return 'Le ticket a changé entre-temps. Rechargez la page.';
    case 'SUPPORT_TICKET_NOT_FOUND':
      return 'Ce ticket n’existe pas ou ne vous est pas accessible.';
    case 'TENANT_REGISTRY_UNAVAILABLE':
      return 'Le support est momentanément injoignable. Réessayez dans quelques minutes.';
    default:
      return 'L’opération a échoué. Réessayez.';
  }
}
