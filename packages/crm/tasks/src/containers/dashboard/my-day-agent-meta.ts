import { CrmTaskDto, CrmTaskDtoStatusEnum } from '@sankore/crm-api';
import { AgendaEntry } from './agenda-meta';
import { dayKey } from './my-day-meta';

/**
 * La journée de l'agent telle que la maquette du propriétaire la montre (2026-10-31) : tâches,
 * rappels et rendez-vous du jour dans une seule liste, rangée par moment puis par heure. Le
 * bandeau du haut, lui, garde l'ordre d'urgence (`byUrgency`) : c'est le seul endroit où la
 * liste et l'urgence se séparent.
 */
export type MomentKey = 'late' | 'morning' | 'afternoon' | 'evening';

export const MOMENTS: { key: MomentKey; label: string }[] = [
  { key: 'late', label: 'En retard' },
  { key: 'morning', label: 'Ce matin' },
  { key: 'afternoon', label: 'Cet après-midi' },
  { key: 'evening', label: 'Ce soir' },
];

export interface AgentDayItem {
  /** Préfixé du genre : une tâche et un rappel peuvent partager un identifiant. */
  key: string;
  kind: 'task' | 'reminder' | 'appointment' | 'activity';
  /** L'heure affichée et triée : l'échéance d'une tâche, l'heure d'un rappel ou d'un rendez-vous. */
  at: string;
  late: boolean;
  done: boolean;
  leadId: string | null;
  task?: CrmTaskDto;
  entry?: AgendaEntry;
}

export interface MomentGroup {
  key: MomentKey;
  label: string;
  items: AgentDayItem[];
}

/** Une ligne de « Dossiers à gérer » : combien, et la liste filtrée qu'elle ouvre. */
export interface WatchLine {
  key: string;
  icon: string;
  count: number;
  label: string;
  link: string;
  queryParams: Record<string, string>;
}

export function isOpenTask(task: CrmTaskDto): boolean {
  return task.status === CrmTaskDtoStatusEnum.Pending || task.status === CrmTaskDtoStatusEnum.InProgress;
}

/** En retard comme sur l'écran actuel : l'échéance SLA si la tâche en a une, sinon l'échéance. */
export function isLateTask(task: CrmTaskDto, now: number): boolean {
  const deadline = task.slaDeadline ?? task.dueAt;
  return isOpenTask(task) && !!deadline && new Date(deadline).getTime() < now;
}

function isToday(iso: string | null | undefined, now: number): boolean {
  return !!iso && dayKey(iso) === dayKey(now);
}

/**
 * Ce que la carte « Aujourd'hui » montre. « À faire » : les tâches ouvertes en retard ou dues
 * aujourd'hui, les rappels du jour ou en retard, les rendez-vous du jour pas encore passés.
 * « Tout voir » y ajoute les tâches du jour terminées et les rendez-vous déjà passés.
 */
export function agentDayItems(tasks: CrmTaskDto[], entries: AgendaEntry[], now: number, showAll: boolean): AgentDayItem[] {
  const items: AgentDayItem[] = [];

  for (const task of tasks) {
    if (!task.id || !task.dueAt && !task.slaDeadline) continue;
    const late = isLateTask(task, now);
    const open = isOpenTask(task);
    const today = isToday(task.dueAt, now);
    const doneToday = task.status === CrmTaskDtoStatusEnum.Completed && today;
    if (!(open && (late || today)) && !(showAll && doneToday)) continue;
    items.push({
      key: `t-${task.id}`,
      kind: 'task',
      at: task.dueAt ?? task.slaDeadline!,
      late,
      done: !open,
      leadId: task.leadId ?? null,
      task,
    });
  }

  for (const entry of entries) {
    if (!entry.at) continue;
    if (entry.kind === 'reminder') {
      if (!entry.isOverdue && !isToday(entry.at, now)) continue;
      items.push({ key: entry.key, kind: 'reminder', at: entry.at, late: entry.isOverdue, done: false, leadId: entry.leadId || null, entry });
      continue;
    }
    if (!isToday(entry.at, now)) continue;
    const end = new Date(entry.at).getTime() + (entry.durationMinutes ?? 0) * 60_000;
    if (!showAll && end < now) continue;
    items.push({ key: entry.key, kind: entry.kind, at: entry.at, late: false, done: end < now, leadId: entry.leadId || null, entry });
  }

  return items.sort((a, b) => Number(b.late) - Number(a.late) || new Date(a.at).getTime() - new Date(b.at).getTime());
}

export function momentOf(item: AgentDayItem): MomentKey {
  if (item.late) return 'late';
  const hour = new Date(item.at).getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

/** Les groupes dans l'ordre de la journée, sans groupe vide ; l'ordre des éléments est gardé. */
export function groupByMoment(items: AgentDayItem[]): MomentGroup[] {
  return MOMENTS
    .map(({ key, label }) => ({ key, label, items: items.filter((i) => momentOf(i) === key) }))
    .filter((g) => g.items.length > 0);
}

/**
 * La tâche du bandeau « À faire en premier » : la première, dans l'ordre d'urgence déjà appliqué
 * (`byUrgency`), parmi celles en retard ou dues aujourd'hui. Une tâche de la semaine prochaine
 * n'est pas « à faire en premier » aujourd'hui, même premier contact.
 */
export function heroTask(openTasksByUrgency: CrmTaskDto[], now: number): CrmTaskDto | null {
  return openTasksByUrgency.find((t) => isLateTask(t, now) || isToday(t.dueAt, now)) ?? null;
}

/** L'anneau « faites aujourd'hui » : les tâches dues aujourd'hui, les annulées à part. */
export function todayProgress(tasks: CrmTaskDto[], now: number): { done: number; total: number } {
  const today = tasks.filter((t) => isToday(t.dueAt, now) && t.status !== CrmTaskDtoStatusEnum.Cancelled);
  return { done: today.filter((t) => t.status === CrmTaskDtoStatusEnum.Completed).length, total: today.length };
}

/** « Voir toutes mes tâches (N à venir) » : les tâches ouvertes dues après aujourd'hui. */
export function upcomingCount(tasks: CrmTaskDto[], now: number): number {
  const today = dayKey(now);
  return tasks.filter((t) => isOpenTask(t) && !!t.dueAt && dayKey(t.dueAt) > today).length;
}
