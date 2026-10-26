import { HttpErrorResponse } from '@angular/common/http';
import { StatementDto } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';
import { integrationErrorMessage } from '../../data-access/integration-facade.service';
import { formatAmount, formatContractDate } from '../../data-access/integration-referential';

/** Les quatre états de `StatementStatus`, côté serveur. */
export function statementStatusMeta(status: string | null | undefined): {
  label: string;
  severity: Severity;
} {
  switch (status) {
    case 'Draft':
      return { label: 'Brouillon', severity: 'neutral' };
    case 'Finalised':
      return { label: 'Clôturé', severity: 'info' };
    case 'Transmitted':
      return { label: "Transmis à l'assureur", severity: 'success' };
    case 'TransmitFailed':
      return { label: 'Transmission échouée', severity: 'error' };
    default:
      return { label: status || '—', severity: 'neutral' };
  }
}

export function statementLineTypeLabel(lineType: string | null | undefined): string {
  switch (lineType) {
    case 'Subscription':
      return 'Adhésion';
    case 'PremiumPaid':
      return 'Prime encaissée';
    case 'Reversal':
      return 'Contre-passation';
    case 'Cancellation':
      return 'Résiliation';
    default:
      return lineType || '—';
  }
}

/** Primes dues à l'assureur, contre-passations déduites. */
export function premiumsDue(statement: StatementDto | null | undefined): number {
  return (statement?.premiumCollected ?? 0) - (statement?.premiumReversed ?? 0);
}

/** Date du jour au format `yyyy-MM-dd`, en heure locale (pas d'ISO : le décalage UTC ferait reculer d'un jour). */
export function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Jours restants avant une date `yyyy-MM-dd` (négatif une fois dépassée). */
export function daysUntil(isoDate: string): number {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export type RemittanceState =
  | { kind: 'remitted'; label: string; severity: Severity }
  | { kind: 'due'; label: string; severity: Severity; overdue: boolean }
  | { kind: 'none'; label: string; severity: Severity };

/**
 * Échéance du reversement : 30 jours après la plus ancienne prime encaissée au nom de
 * l'assureur. Rouge une fois dépassée, orange à cinq jours ou moins (l'alerte J-5 du serveur).
 */
export function remittanceState(statement: StatementDto | null | undefined): RemittanceState {
  if (statement?.remittedOn) {
    return {
      kind: 'remitted',
      label: `Reversé le ${formatContractDate(statement.remittedOn)}`,
      severity: 'success',
    };
  }
  if (!statement?.remittanceDueBy) {
    return { kind: 'none', label: 'Aucune prime à reverser', severity: 'neutral' };
  }
  const days = daysUntil(statement.remittanceDueBy);
  const label = `À reverser avant le ${formatContractDate(statement.remittanceDueBy)}`;
  if (days < 0) return { kind: 'due', label, severity: 'error', overdue: true };
  if (days <= 5) return { kind: 'due', label, severity: 'warning', overdue: false };
  return { kind: 'due', label, severity: 'neutral', overdue: false };
}

/** « Conforme » à écart nul, « Écart de X » sinon ; rien tant que l'assureur n'a rien déclaré. */
export function commissionGapLabel(
  gap: number | null | undefined,
  currency: string | null | undefined,
): { label: string; severity: Severity } | null {
  if (gap === null || gap === undefined) return null;
  if (Math.abs(gap) < 0.005) return { label: 'Conforme', severity: 'success' };
  return { label: `Écart de ${formatAmount(gap, currency)}`, severity: 'error' };
}

/** Accepte « 1 234,56 » comme « 1234.56 » : les montants se saisissent à la française. */
export function parseAmount(raw: string | null | undefined): number | null {
  const text = (raw ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Le serveur répond `{ error: "CODE: message" }` pour les refus du domaine : le message
 * anglais qui suit le code est traduit quand on le connaît, pour que l'agent lise la
 * raison exacte (montant trop bas, référence absente…) plutôt qu'un échec générique.
 */
export function statementErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as { code?: string; error?: string } | undefined;
  const raw = body?.code ?? body?.error ?? '';
  const [code, ...rest] = raw.split(':');
  const detail = rest.join(':').trim();

  switch (code.trim()) {
    case 'INSURANCE_REMITTANCE_INVALID':
      return remittanceDetail(detail);
    case 'INSURANCE_INSURER_COMMISSION_INVALID':
      return "La commission déclarée s'enregistre avec la référence du relevé de l'assureur.";
    case 'INSURANCE_STATEMENT_NOT_TRANSMITTABLE':
      return "Seul un bordereau clôturé peut être marqué comme transmis à l'assureur.";
    case 'INSURANCE_STATEMENT_ALREADY_CLOSED':
      return 'Ce bordereau est déjà clôturé.';
    case 'INSURANCE_STATEMENT_NOT_FOUND':
      return "Ce bordereau n'existe pas, ou plus.";
    case 'INSURANCE_STATEMENT_PERIOD_INVALID':
      return 'Le mois demandé est invalide.';
    default:
      return integrationErrorMessage(error, fallback);
  }
}

function remittanceDetail(detail: string): string {
  if (detail.startsWith('Finalise the statement')) {
    return "Clôturez le bordereau avant d'enregistrer son reversement.";
  }
  if (detail.startsWith('A remittance is recorded with its transfer reference')) {
    return "Le reversement s'enregistre avec la référence du virement.";
  }
  if (detail.startsWith('The amount remitted is below the premiums net')) {
    return 'Le montant reversé est inférieur aux primes nettes de la commission convenue avec l’assureur.';
  }
  if (detail.startsWith("Without the insurer's agreement")) {
    return "Sans l'accord de compensation de l'assureur, aucune commission ne peut être déduite : l'intégralité des primes doit être reversée.";
  }
  return detail ? `Reversement refusé : ${detail}` : 'Le reversement a été refusé.';
}
