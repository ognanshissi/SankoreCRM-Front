import { Severity } from '@talisoft/ui/tag';
import { BatchFileRow } from '../../data-access/pending-endpoints';

export type BatchDirection = 'Outbound' | 'Inbound';

export const BATCH_DIRECTION_OPTIONS: Array<{ label: string; value: BatchDirection }> = [
  { label: 'Sortant (envoyé par SANKORE)', value: 'Outbound' },
  { label: 'Entrant (reçu du système externe)', value: 'Inbound' },
];

export function batchDirectionLabel(direction: string | null | undefined): string {
  switch (direction) {
    case 'Outbound':
      return 'Sortant';
    case 'Inbound':
      return 'Entrant';
    default:
      return direction || '—';
  }
}

export interface AcknowledgementView {
  label: string;
  severity: Severity;
  /** Vrai quand le fichier doit être signalé : il est parti et personne n'a confirmé. */
  isOverdue: boolean;
  /** Phrase affichée à côté de l'état, quand il y a quelque chose à dire. */
  detail: string | null;
}

/**
 * Heures écoulées depuis la production du fichier. Renvoie `null` quand la date est
 * absente ou illisible : « zéro heure » se confondrait avec un fichier tout juste produit.
 */
export function hoursSince(producedAt: string | null | undefined, now = Date.now()): number | null {
  if (!producedAt) return null;
  const produced = Date.parse(producedAt);
  if (!Number.isFinite(produced)) return null;
  return Math.max(0, (now - produced) / 3_600_000);
}

/**
 * État de l'accusé, tel que la ligne doit le montrer.
 *
 * Deux sources se complètent, et c'est voulu : le serveur publie
 * `acknowledgementStatus = 'Overdue'` quand il a lui-même constaté le retard, mais un
 * fichier sortant peut dépasser le délai annoncé (`acknowledgementDueHours`) entre deux
 * passages du contrôle serveur. L'écran recalcule donc le dépassement à partir de la
 * date de production — sinon un fichier parti la nuit resterait « en attente » toute la
 * matinée alors que c'est exactement le cas que cet écran existe pour détecter.
 *
 * Un fichier ENTRANT sans accusé n'est pas en retard : l'accusé est ce que nous devons
 * au système externe, pas l'inverse.
 */
export function acknowledgementView(
  row: BatchFileRow,
  acknowledgementDueHours: number | null,
  now = Date.now(),
): AcknowledgementView {
  const elapsed = hoursSince(row.producedAt, now);
  const isPastDue =
    row.direction === 'Outbound' &&
    !row.acknowledgedAt &&
    acknowledgementDueHours !== null &&
    elapsed !== null &&
    elapsed > acknowledgementDueHours;

  switch (row.acknowledgementStatus) {
    case 'Acknowledged':
      return {
        label: 'Accusé reçu',
        severity: 'success',
        isOverdue: false,
        detail: null,
      };

    case 'Rejected':
      return {
        label: 'Accusé en rejet',
        severity: 'error',
        isOverdue: true,
        detail:
          row.rejectedRecordCount && row.rejectedRecordCount > 0
            ? `${row.rejectedRecordCount} enregistrement(s) refusé(s)`
            : 'Le système externe a refusé le fichier',
      };

    case 'Overdue':
      return {
        label: 'Accusé en retard',
        severity: 'error',
        isOverdue: true,
        detail: overdueDetail(elapsed, acknowledgementDueHours),
      };

    case 'Pending':
      return isPastDue
        ? {
            label: 'Accusé en retard',
            severity: 'error',
            isOverdue: true,
            detail: overdueDetail(elapsed, acknowledgementDueHours),
          }
        : {
            label: 'Accusé attendu',
            severity: 'warning',
            isOverdue: false,
            detail:
              acknowledgementDueHours !== null
                ? `Attendu sous ${acknowledgementDueHours} h`
                : null,
          };

    default:
      return {
        label: row.acknowledgementStatus || '—',
        severity: 'neutral',
        isOverdue: isPastDue,
        detail: isPastDue ? overdueDetail(elapsed, acknowledgementDueHours) : null,
      };
  }
}

function overdueDetail(elapsed: number | null, dueHours: number | null): string | null {
  if (elapsed === null) return "Aucun accusé reçu";
  const rounded = Math.floor(elapsed);
  if (dueHours === null) return `Aucun accusé depuis ${rounded} h`;
  return `Aucun accusé depuis ${rounded} h, délai annoncé ${dueHours} h`;
}

/** Nombre de fichiers signalés dans la page courante : le seul chiffre qui déclenche une action. */
export function overdueCount(
  rows: ReadonlyArray<BatchFileRow>,
  acknowledgementDueHours: number | null,
  now = Date.now(),
): number {
  return rows.filter((row) => acknowledgementView(row, acknowledgementDueHours, now).isOverdue)
    .length;
}
