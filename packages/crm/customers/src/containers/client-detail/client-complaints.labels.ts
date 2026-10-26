import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés du registre des réclamations (2026-10-26). Le serveur renvoie les noms d'enum
 * (`ClientComplaintChannel`, `ClientComplaintCategory`, `ClientComplaintStatus`) ; un nom inconnu
 * s'affiche tel quel plutôt que de disparaître.
 */
export const COMPLAINT_CHANNEL_OPTIONS = [
  { value: 'Branch', label: 'Agence' },
  { value: 'Telephone', label: 'Téléphone' },
  { value: 'Email', label: 'E-mail' },
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Post', label: 'Courrier' },
];

/** Même ordre que le menu proposé par le bot WhatsApp. */
export const COMPLAINT_CATEGORY_OPTIONS = [
  { value: 'Credit', label: 'Crédit' },
  { value: 'Savings', label: 'Épargne' },
  { value: 'FeesAndPricing', label: 'Frais et tarifs' },
  { value: 'PaymentMeans', label: 'Moyens de paiement' },
  { value: 'Service', label: 'Accueil et service' },
  { value: 'DataProtection', label: 'Données personnelles' },
  { value: 'Other', label: 'Autre' },
];

const STATUSES: Record<string, { label: string; severity: Severity }> = {
  Received: { label: 'Reçue', severity: 'warning' },
  Acknowledged: { label: 'Prise en charge', severity: 'info' },
  Resolved: { label: 'Résolue', severity: 'success' },
  Closed: { label: 'Clôturée', severity: 'neutral' },
};

export const COMPLAINT_STATUS_FILTER_OPTIONS = [
  { value: 'open', label: 'En cours (reçues ou prises en charge)' },
  { value: 'overdue', label: 'En retard' },
  { value: 'Resolved', label: 'Résolues' },
  { value: 'Closed', label: 'Clôturées' },
];

export function complaintChannelLabel(value: string | null | undefined): string {
  return COMPLAINT_CHANNEL_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

export function complaintCategoryLabel(value: string | null | undefined): string {
  return COMPLAINT_CATEGORY_OPTIONS.find((o) => o.value === value)?.label ?? value ?? '—';
}

export function complaintStatus(value: string | null | undefined): { label: string; severity: Severity } {
  return (value && STATUSES[value]) || { label: value ?? '—', severity: 'neutral' };
}

export function isOpenComplaint(status: string | null | undefined): boolean {
  return status === 'Received' || status === 'Acknowledged';
}

export function formatComplaintDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
