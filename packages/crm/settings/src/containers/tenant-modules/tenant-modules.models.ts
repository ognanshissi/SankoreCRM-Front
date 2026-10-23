import { HttpErrorResponse } from '@angular/common/http';
import { TenantModuleDtoStateEnum } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

export const MODULE_STATE_META: Record<TenantModuleDtoStateEnum, { label: string; severity: Severity }> = {
  None: { label: 'Non souscrit', severity: 'neutral' },
  Requested: { label: 'Demande en attente', severity: 'info' },
  Active: { label: 'Actif', severity: 'success' },
  Rejected: { label: 'Demande refusée', severity: 'error' },
  Cancelled: { label: 'Demande annulée', severity: 'neutral' },
  Deactivated: { label: 'Désactivé', severity: 'warning' },
};

const PRICE_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatModulePrice(amount: number | null | undefined, currency: string | null | undefined): string {
  return `${PRICE_FORMAT.format(amount ?? 0)} ${currency ?? ''}`.trim();
}

/** Les codes que le registre renvoie, traduits pour l'administrateur qui a cliqué. */
const ERROR_MESSAGES: Record<string, string> = {
  MODULE_PRICE_CHANGED: 'Le prix a changé depuis l’affichage de la page. Vérifiez-le avant de renouveler la demande.',
  MODULE_UNAVAILABLE: 'Ce module n’est pas encore proposé.',
  MODULE_REQUEST_PENDING: 'Une demande est déjà en attente pour ce module.',
  MODULE_ALREADY_ACTIVE: 'Ce module est déjà actif.',
  MODULE_NOT_ACTIVE: 'Ce module n’est plus actif.',
  MODULE_REQUEST_NOT_PENDING: 'Cette demande a déjà été traitée.',
  MODULE_SUBSCRIPTION_NOT_FOUND: 'Cette demande est introuvable.',
  TENANT_REGISTRY_UNAVAILABLE: 'Le service des abonnements ne répond pas. Réessayez dans un instant.',
};

export function moduleErrorCode(err: unknown): string | null {
  return err instanceof HttpErrorResponse ? (err.error?.error ?? null) : null;
}

export function moduleErrorMessage(err: unknown, fallback: string): string {
  const code = moduleErrorCode(err);
  return (code && ERROR_MESSAGES[code]) || fallback;
}
