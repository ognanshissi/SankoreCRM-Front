import { Severity } from '@talisoft/ui/tag';

export type SuspicionAlertStatus = 'Open' | 'UnderReview' | 'Declared' | 'ClosedWithoutDeclaration';

export function suspicionAlertStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'Open':                     return { label: 'Nouvelle', severity: 'warning' };
    case 'UnderReview':              return { label: 'En examen', severity: 'info' };
    case 'Declared':                 return { label: 'Déclarée à la CENTIF', severity: 'accent' };
    case 'ClosedWithoutDeclaration': return { label: 'Classée sans déclaration', severity: 'neutral' };
    default:                         return { label: status ?? '—', severity: 'neutral' };
  }
}

/** Une alerte déclarée ou classée est close : le serveur refuse tout nouveau traitement. */
export function isSuspicionAlertClosed(status: string | null | undefined): boolean {
  return status === 'Declared' || status === 'ClosedWithoutDeclaration';
}

export function suspicionAlertErrorMessage(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case 'SUSPICION_ALERT_DECLARATION_REQUIRED':
      return 'La date et la référence de la déclaration à la CENTIF sont obligatoires.';
    case 'SUSPICION_ALERT_REASON_REQUIRED':
      return 'Indiquez pourquoi l’alerte est classée sans déclaration.';
    case 'SUSPICION_ALERT_CLOSED':
      return 'Cette alerte est déjà close : elle ne peut plus être traitée.';
    case 'SUSPICION_ALERT_INVALID_STATUS':
      return 'Une alerte ne peut pas revenir à l’état « Nouvelle ».';
    case 'SUSPICION_ALERT_NOT_FOUND':
      return 'Alerte introuvable.';
    default:
      return fallback;
  }
}
