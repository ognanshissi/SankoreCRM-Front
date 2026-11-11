import { HttpErrorResponse } from '@angular/common/http';
import { TenantSignupView } from '@sankore/crm-admin-api';
import { StatusStyle } from '../modules/module-referential';

/** Même grammaire visuelle que les modules et le support : une pastille et un libellé. */
export const TRIAL_STATUS_STYLE: Record<TenantSignupView, StatusStyle> = {
  PendingEmail: { label: 'E-mail à confirmer', tone: 'text-blue-800', dot: 'bg-blue-400' },
  Expired: { label: 'Expirée', tone: 'text-slate-600', dot: 'bg-slate-400' },
  Confirmed: { label: 'À valider', tone: 'text-orange-800', dot: 'bg-orange-300' },
  Approved: { label: 'Approuvée', tone: 'text-green-800', dot: 'bg-green-700' },
  Rejected: { label: 'Refusée', tone: 'text-red-800', dot: 'bg-red-400' },
};

export function trialStatusStyle(status: TenantSignupView | null | undefined): StatusStyle {
  return TRIAL_STATUS_STYLE[status ?? TenantSignupView.PendingEmail];
}

/** Les pays les plus probables ; un code inconnu s'affiche tel quel. */
const COUNTRY_LABELS: Record<string, string> = {
  CI: 'Côte d’Ivoire', SN: 'Sénégal', ML: 'Mali', BF: 'Burkina Faso', BJ: 'Bénin', TG: 'Togo', NE: 'Niger',
  GN: 'Guinée', CM: 'Cameroun', GA: 'Gabon', CG: 'Congo', CD: 'RD Congo', GH: 'Ghana', NG: 'Nigeria', FR: 'France',
};

export function countryLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return COUNTRY_LABELS[code] ?? code;
}

const ERROR_MESSAGES: Record<string, string> = {
  TRIAL_SIGNUP_NOT_FOUND: 'Cette demande n’existe plus.',
  TRIAL_SIGNUP_NOT_CONFIRMED: 'L’adresse e-mail de cette demande n’a pas été confirmée : elle ne peut pas encore être approuvée.',
  TRIAL_SIGNUP_ALREADY_DECIDED: 'Cette demande a déjà été traitée — la fiche a été rechargée.',
  TRIAL_SLUG_TAKEN: 'L’adresse demandée a été attribuée entre-temps à une autre institution.',
  TRIAL_EMAIL_IN_USE: 'Cette adresse e-mail administre déjà une institution.',
  TRIAL_REJECTION_REASON_REQUIRED: 'Le motif est obligatoire (1 000 caractères au plus).',
  TRIAL_SIGNUP_NOT_CONFIGURED: 'L’essai gratuit n’est pas ouvert sur cette plateforme (TrialSignup:AddressTemplate du registre).',
  TENANT_NOT_A_TRIAL: 'Cette institution n’est pas en essai gratuit.',
  TRIAL_END_IN_PAST: 'Choisissez une date à venir.',
  PLATFORM_ADMIN_REQUIRED: 'Cette action exige une session d’administrateur de la plateforme.',
};

export function describeTrialError(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  if (err.status === 0) return 'Le serveur d’administration est injoignable.';
  const code: string | undefined = err.error?.error;
  return (code && ERROR_MESSAGES[code]) || err.error?.detail || fallback;
}
