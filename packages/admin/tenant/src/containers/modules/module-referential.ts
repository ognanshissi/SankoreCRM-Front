import { HttpErrorResponse } from '@angular/common/http';
import { ModuleSubscriptionStatus, TenantModuleState } from '@sankore/crm-admin-api';

export interface StatusStyle {
  label: string;
  tone: string;
  dot: string;
}

/** Même grammaire visuelle que les statuts de tenant et de domaine : une pastille et un libellé. */
export const MODULE_STATE_STYLE: Record<TenantModuleState, StatusStyle> = {
  None: { label: 'Non souscrit', tone: 'text-slate-600', dot: 'bg-slate-300' },
  Requested: { label: 'En attente', tone: 'text-blue-800', dot: 'bg-blue-400' },
  Active: { label: 'Actif', tone: 'text-green-800', dot: 'bg-green-700' },
  Rejected: { label: 'Refusé', tone: 'text-red-800', dot: 'bg-red-400' },
  Cancelled: { label: 'Annulé', tone: 'text-slate-600', dot: 'bg-slate-400' },
  Deactivated: { label: 'Désactivé', tone: 'text-orange-800', dot: 'bg-orange-300' },
};

export function statusStyle(status: ModuleSubscriptionStatus | TenantModuleState | null | undefined): StatusStyle {
  return MODULE_STATE_STYLE[(status ?? 'None') as TenantModuleState];
}

const PRICE_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export function formatPrice(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '—';
  return `${PRICE_FORMAT.format(amount)} ${currency ?? ''}`.trim();
}

/**
 * Délai de prise en compte côté Sankore.Api, qui relit les modules d'un tenant avec son statut
 * (`TenantStore:CacheTtl`, 30 s). Dit dans chaque confirmation, sinon l'opérateur croit l'effet
 * immédiat et le tenant appelle le support.
 */
export const MODULE_DELAY_NOTICE = 'Le module est ouvert dans le CRM du tenant sous 30 secondes.';

const ERROR_MESSAGES: Record<string, string> = {
  MODULE_UNKNOWN: 'Ce module n’existe pas.',
  MODULE_UNAVAILABLE: 'Ce module n’est pas proposé.',
  MODULE_ALREADY_ACTIVE: 'Ce module est déjà actif pour ce tenant.',
  MODULE_REQUEST_NOT_PENDING: 'Cette demande a déjà été traitée — la liste a été rechargée.',
  MODULE_SUBSCRIPTION_NOT_FOUND: 'Cette demande n’existe plus.',
  REJECTION_REASON_REQUIRED: 'Le motif du refus est obligatoire.',
  INVALID_MODULE_DEFINITION: 'La définition est invalide.',
  PLATFORM_ADMIN_REQUIRED: 'Cette décision exige une session d’administrateur de la plateforme.',
  TENANT_NOT_FOUND: 'Ce tenant n’existe plus.',
};

export function describeModuleError(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  if (err.status === 0) return 'Le serveur d’administration est injoignable.';
  const code: string | undefined = err.error?.error;
  const known = code ? ERROR_MESSAGES[code] : undefined;
  return known ? (err.error?.detail ? `${known} ${err.error.detail}` : known) : (err.error?.detail ?? fallback);
}
