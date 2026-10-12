import { Severity } from '@talisoft/ui/tag';
import { CrmTaskDto, CrmTaskDtoPriorityEnum, CrmTaskDtoStatusEnum } from '@sankore/crm-api';

/**
 * Libellés, sévérités et calcul de SLA d'une tâche CRM.
 *
 * Extrait de `dashboard.ts` pour être partagé avec le drawer de détail : deux copies de
 * `computeSla` auraient fini par donner deux verdicts différents sur la même tâche.
 */

export function statusMeta(
  status: CrmTaskDtoStatusEnum | string | undefined,
): { label: string; severity: Severity } {
  switch (status) {
    case CrmTaskDtoStatusEnum.Pending:    return { label: 'En attente', severity: 'neutral' };
    case CrmTaskDtoStatusEnum.InProgress: return { label: 'En cours',   severity: 'info' };
    case CrmTaskDtoStatusEnum.Completed:  return { label: 'Terminée',   severity: 'success' };
    case CrmTaskDtoStatusEnum.Cancelled:  return { label: 'Annulée',    severity: 'error' };
    default:                              return { label: '—',          severity: 'neutral' };
  }
}

export function priorityMeta(
  priority: CrmTaskDtoPriorityEnum | string | undefined,
): { label: string; severity: Severity; icon: string } {
  switch (priority) {
    case CrmTaskDtoPriorityEnum.Low:      return { label: 'Basse',    severity: 'neutral', icon: 'feather:arrow-down' };
    case CrmTaskDtoPriorityEnum.Medium:   return { label: 'Moyenne',  severity: 'info',    icon: 'feather:minus' };
    case CrmTaskDtoPriorityEnum.High:     return { label: 'Haute',    severity: 'warning', icon: 'feather:arrow-up' };
    case CrmTaskDtoPriorityEnum.Critical: return { label: 'Critique', severity: 'error',   icon: 'feather:alert-triangle' };
    default:                              return { label: '—',        severity: 'neutral', icon: 'feather:minus' };
  }
}

export function typeLabel(type: string | undefined): string {
  switch (type) {
    case 'FirstContact':   return 'Premier contact';
    case 'Qualification':  return 'Qualification';
    case 'SlaFollowUp':    return 'Suivi SLA';
    case 'ScoreReview':    return 'Revue score';
    case 'OwnerHandover':  return 'Passation';
    case 'ManualDispatch': return 'Dispatch manuel';
    case 'Generic':        return 'Générique';
    default:               return type ?? '—';
  }
}

/**
 * Évènement déclencheur, quand la tâche a été créée par une règle et non à la main. Les valeurs
 * viennent de `CrmTaskDto.triggerEventType`, une chaîne libre au contrat : tout libellé inconnu est
 * rendu tel quel plutôt que masqué.
 */
export function triggerLabel(triggerEventType: string | null | undefined): string {
  switch (triggerEventType) {
    case 'LeadCaptured':      return 'Lead capturé';
    case 'LeadAssigned':      return 'Lead assigné';
    case 'LeadQualified':     return 'Lead qualifié';
    case 'SlaBreached':       return 'SLA dépassé';
    case 'ScoreChanged':      return 'Score modifié';
    case 'OwnerChanged':      return 'Changement de propriétaire';
    case 'ManualDispatch':    return 'Dispatch manuel';
    default:                  return triggerEventType ?? '';
  }
}

export interface SlaInfo {
  status: 'ok' | 'warning' | 'breach';
  /**
   * Phrase complète, prête à afficher. Les gabarits se contentent de l'imprimer : ils préfixaient
   * auparavant « En retard : » un libellé commençant déjà par « En retard de », ce qui donnait
   * « En retard : En retard de 3h ».
   */
  label: string;
  icon: string;
  remainingMs: number;
}

/** Aucun compte à rebours ne court plus : ni libellé, ni rouge. */
const NO_SLA: SlaInfo = { status: 'ok', label: '', icon: '', remainingMs: Infinity };

export function computeSla(task: CrmTaskDto, now: number): SlaInfo {
  const deadline = task.slaDeadline ?? task.dueAt;

  // Une tâche terminée ne court plus après rien : le dépassement devient un fait passé, énoncé au
  // passé et en gris (`status: 'ok'`, la branche neutre des gabarits). L'afficher en rouge envoyait
  // l'agent vers une tâche qu'il a déjà traitée, et peignait toute la colonne « Terminées ».
  if (task.status === CrmTaskDtoStatusEnum.Completed) {
    if (!deadline || !task.completedAt) return NO_SLA;
    const lateBy = new Date(task.completedAt).getTime() - new Date(deadline).getTime();
    // Terminée dans les délais : l'étiquette de statut le dit déjà, inutile d'en rajouter.
    if (lateBy <= 0) return NO_SLA;
    return {
      status: 'ok',
      label: `Terminée avec ${fmtDur(lateBy)} de retard`,
      icon: 'feather:clock',
      remainingMs: -lateBy,
    };
  }

  // Une tâche annulée ne dit rien du délai : elle n'a pas été traitée, la mesurer n'aurait pas de
  // sens.
  if (task.status === CrmTaskDtoStatusEnum.Cancelled) return NO_SLA;

  if (!deadline) return NO_SLA;
  const diff = new Date(deadline).getTime() - now;
  if (diff < 0) {
    return {
      status: 'breach',
      label: `En retard de ${fmtDur(Math.abs(diff))}`,
      icon: 'feather:alert-octagon',
      remainingMs: diff,
    };
  }
  if (diff < 3_600_000) {
    return {
      status: 'warning',
      label: `SLA : ${fmtDur(diff)} restant`,
      icon: 'feather:alert-triangle',
      remainingMs: diff,
    };
  }
  return {
    status: 'ok',
    label: `SLA : ${fmtDur(diff)} restant`,
    icon: 'feather:clock',
    remainingMs: diff,
  };
}

export function fmtDur(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h${String(rm).padStart(2, '0')}` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}j ${rh}h` : `${d}j`;
}

/** Libellé court du statut, à la manière d'une liste de travail : « À faire » plutôt que « En attente ». */
export function workStatusLabel(status: CrmTaskDtoStatusEnum | string | undefined): string {
  switch (status) {
    case CrmTaskDtoStatusEnum.Pending:    return 'À faire';
    case CrmTaskDtoStatusEnum.InProgress: return 'En cours';
    case CrmTaskDtoStatusEnum.Completed:  return 'Terminée';
    case CrmTaskDtoStatusEnum.Cancelled:  return 'Annulée';
    default:                              return '—';
  }
}

/** Ce que l'agent doit faire, à l'infinitif. Une tâche générique garde son titre, seul porteur de sens. */
export function taskActionLabel(task: CrmTaskDto): string {
  switch (task.type) {
    case 'FirstContact':   return 'Contacter';
    case 'Qualification':  return 'Qualifier';
    case 'SlaFollowUp':    return 'Relancer';
    case 'ScoreReview':    return 'Revoir le score';
    case 'OwnerHandover':  return 'Reprendre le lead';
    case 'ManualDispatch': return 'Dispatcher';
    default:               return task.title?.trim() || typeLabel(task.type);
  }
}

export interface DueInfo {
  label: string;
  /** `breach` et `soon` s'affichent en pastille ; `plain` en simple texte. */
  tone: 'breach' | 'soon' | 'plain';
}

const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function computeDue(task: CrmTaskDto, now: number): DueInfo {
  const deadline = task.slaDeadline ?? task.dueAt;
  if (!deadline) return { label: '—', tone: 'plain' };

  const at = new Date(deadline);
  const isOpen =
    task.status === CrmTaskDtoStatusEnum.Pending || task.status === CrmTaskDtoStatusEnum.InProgress;
  const diff = at.getTime() - now;

  if (isOpen && diff < 0) return { label: `Dépassée de ${fmtDur(-diff)}`, tone: 'breach' };

  const today = new Date(now);
  if (isOpen && sameDay(at, today)) return { label: `Dans ${fmtDur(diff)}`, tone: 'soon' };

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(at, today)) return { label: `Aujourd'hui, ${TIME_FMT.format(at)}`, tone: 'plain' };
  if (sameDay(at, tomorrow)) return { label: `Demain, ${TIME_FMT.format(at)}`, tone: 'plain' };

  const day = DAY_FMT.format(at);
  return { label: day.charAt(0).toUpperCase() + day.slice(1), tone: 'plain' };
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Le parcours du lead en cinq temps, tel que l'agent le pense. Les douze étapes du pipeline y sont
 * regroupées ; une étape inconnue retombe sur « Qualifier » plutôt que de laisser le repère vide.
 */
export const LEAD_JOURNEY = ['Capture', 'Qualifier', 'Enrichir', 'KYC', 'Convertir'] as const;

export function journeyIndex(pipelineStage: string | null | undefined): number {
  switch (pipelineStage) {
    case 'Qualified':
    case 'ProductProposed':
    case 'ApplicationStarted':
      return 2;
    case 'DocumentCollection':
    case 'ApplicationCompleted':
    case 'ApprovalPending':
      return 3;
    case 'Converted':
      // Au-delà de la dernière étape : toutes sont cochées.
      return LEAD_JOURNEY.length;
    default:
      return 1;
  }
}

export function leadDisplayName(lead: { fullName?: string | null; firstName?: string | null; lastName?: string | null; phoneNumber?: string | null; email?: string | null } | null | undefined): string {
  if (!lead) return '';
  return (
    lead.fullName?.trim() ||
    [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() ||
    lead.phoneNumber?.trim() ||
    lead.email?.trim() ||
    'Lead sans nom'
  );
}
