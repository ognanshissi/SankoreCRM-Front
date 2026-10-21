import { AgendaAppointmentDto, CrmTaskDto, CrmTaskDtoStatusEnum, MyAgendaDto, MyCalendarEventDto } from '@sankore/crm-api';
import { addDays, dayKey, startOfDay } from '../dashboard/my-day-meta';
import { appointmentSubject, appointmentTypeMeta, activityTypeMeta } from '../dashboard/agenda-meta';

/**
 * Le Calendrier : les entrées SANKORÉ (rendez-vous, activités planifiées, tâches, rappels) et les
 * événements des agendas connectés, sur une même grille. Tout est en heure LOCALE du navigateur,
 * comme « Ma journée » : c'est la journée de l'agent qui compte.
 */

export type CalendarView = 'day' | 'week' | 'month';

/** Les deux filtres SANKORÉ ; un agenda connecté a pour clé `cal:{id}`. */
export const SOURCE_MEETINGS = 'sankore:meetings';
export const SOURCE_TASKS = 'sankore:tasks';

export interface CalendarItem {
  key: string;
  kind: 'appointment' | 'activity' | 'task' | 'reminder' | 'external';
  /** Le filtre de la barre latérale qui l'affiche ou le masque. */
  source: string;
  title: string;
  /** Le lead, le client, l'agenda : ce que le bloc dit sous le titre. */
  detail: string;
  start: Date;
  end: Date;
  allDay: boolean;
  color: string;
  /** Un événement externe qui occupe le créneau : seul ce qui est « occupé » crée un conflit. */
  busy: boolean;
  leadId: string | null;
  appointment?: AgendaAppointmentDto;
  external?: MyCalendarEventDto;
}

/** Les couleurs SANKORÉ, et celle d'un agenda dont le fournisseur n'en donne pas. */
export const MEETING_COLOR = '#4f46e5';
export const TASK_COLOR = '#d97706';
const FALLBACK_COLORS: Record<string, string> = { Microsoft: '#0078d4', Google: '#0b8043' };

/** Une couleur venue d'un fournisseur n'est reprise que sous la forme #rrggbb. */
export function safeColor(color: string | null | undefined, provider?: string | null): string {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK_COLORS[provider ?? ''] ?? '#64748b';
}

/** Une tâche ou un rappel n'a qu'une échéance : on lui donne une demi-heure sur la grille. */
const POINT_MINUTES = 30;
const MINUTE = 60_000;

// ——— Période affichée ———

/** Lundi de la semaine du jour donné. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** [début, fin) de la période, et les jours qu'elle affiche (6 semaines pleines pour un mois). */
export function viewRange(view: CalendarView, anchor: Date): { from: Date; to: Date; days: Date[] } {
  let from: Date;
  let count: number;
  if (view === 'day') {
    from = startOfDay(anchor);
    count = 1;
  } else if (view === 'week') {
    from = startOfWeek(anchor);
    count = 7;
  } else {
    from = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    count = 42;
  }
  const days = Array.from({ length: count }, (_, i) => addDays(from, i));
  return { from, to: addDays(from, count), days };
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const FULL_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 19 – 25 octobre 2026 », « Mercredi 21 octobre 2026 », « Octobre 2026 ». */
export function rangeLabel(view: CalendarView, anchor: Date): string {
  if (view === 'day') return capitalize(FULL_DAY.format(anchor));
  if (view === 'month') return capitalize(MONTH_YEAR.format(anchor));
  const from = startOfWeek(anchor);
  const to = addDays(from, 6);
  return from.getMonth() === to.getMonth()
    ? `${from.getDate()} – ${to.getDate()} ${MONTH_YEAR.format(to)}`
    : `${DAY_MONTH.format(from)} – ${DAY_MONTH.format(to)} ${to.getFullYear()}`;
}

// ——— Construction des entrées ———

export function sankoreItems(agenda: MyAgendaDto | null, tasks: CrmTaskDto[]): CalendarItem[] {
  if (!agenda) agenda = {};
  const items: CalendarItem[] = [];

  for (const a of agenda.appointments ?? []) {
    if (!a.startAt) continue;
    const start = new Date(a.startAt);
    items.push({
      key: `m-${a.id}`,
      kind: 'appointment',
      source: SOURCE_MEETINGS,
      title: a.title?.trim() || appointmentTypeMeta(a).label,
      detail: appointmentSubject(a),
      start,
      end: new Date(start.getTime() + (a.durationMinutes || POINT_MINUTES) * MINUTE),
      allDay: false,
      color: MEETING_COLOR,
      busy: true,
      leadId: a.leadId ?? null,
      appointment: a,
    });
  }

  for (const a of agenda.activities ?? []) {
    if (!a.scheduledAt) continue;
    const start = new Date(a.scheduledAt);
    const type = activityTypeMeta(a.type);
    items.push({
      key: `a-${a.id}`,
      kind: 'activity',
      source: SOURCE_MEETINGS,
      title: a.subject?.trim() || type.label,
      detail: a.leadName?.trim() || 'Lead',
      start,
      end: new Date(start.getTime() + (a.durationMinutes || POINT_MINUTES) * MINUTE),
      allDay: false,
      color: MEETING_COLOR,
      busy: true,
      leadId: a.leadId ?? null,
    });
  }

  for (const r of agenda.reminders ?? []) {
    if (!r.dueAt) continue;
    const start = new Date(r.dueAt);
    items.push({
      key: `r-${r.id}`,
      kind: 'reminder',
      source: SOURCE_TASKS,
      title: r.title?.trim() || 'Rappel',
      detail: r.leadName?.trim() || 'Lead',
      start,
      end: new Date(start.getTime() + POINT_MINUTES * MINUTE),
      allDay: false,
      color: TASK_COLOR,
      busy: false,
      leadId: r.leadId ?? null,
    });
  }

  for (const t of tasks) {
    if (!t.dueAt || (t.status !== CrmTaskDtoStatusEnum.Pending && t.status !== CrmTaskDtoStatusEnum.InProgress)) continue;
    const start = new Date(t.dueAt);
    items.push({
      key: `t-${t.id}`,
      kind: 'task',
      source: SOURCE_TASKS,
      title: t.title?.trim() || 'Tâche',
      detail: 'Tâche',
      start,
      end: new Date(start.getTime() + POINT_MINUTES * MINUTE),
      allDay: false,
      color: TASK_COLOR,
      busy: false,
      leadId: t.leadId ?? null,
    });
  }
  return items;
}

/** Tentative compte comme occupé : le créneau n'est pas libre tant que la réponse n'est pas « non ». */
const BUSY = new Set(['Busy', 'OutOfOffice', 'Tentative']);

export function externalItems(events: MyCalendarEventDto[]): CalendarItem[] {
  return events
    .filter((e) => e.startAt && e.endAt)
    .map((e) => ({
      key: `e-${e.id}`,
      kind: 'external' as const,
      source: `cal:${e.calendarId}`,
      title: e.title?.trim() || 'Occupé',
      detail: e.calendarName?.trim() || e.accountLabel?.trim() || '',
      start: new Date(e.startAt!),
      end: new Date(e.endAt!),
      allDay: !!e.isAllDay,
      color: safeColor(e.color, e.provider),
      busy: BUSY.has(e.showAs ?? 'Busy'),
      leadId: null,
      external: e,
    }));
}

export function inRange(item: CalendarItem, from: Date, to: Date): boolean {
  return item.start < to && item.end > from;
}

// ——— Grille horaire ———

export interface PlacedItem {
  item: CalendarItem;
  /** En minutes depuis minuit, bornées à la journée. */
  startMinute: number;
  endMinute: number;
  column: number;
  columns: number;
}

/**
 * Les blocs horaires d'un jour, rangés en colonnes : deux événements qui se chevauchent se
 * partagent la largeur, un groupe sans chevauchement garde toute la largeur. Un événement qui
 * déborde de la journée y est coupé ; une durée nulle garde un quart d'heure pour rester cliquable.
 */
export function layoutDay(items: CalendarItem[], day: Date): PlacedItem[] {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const segments = items
    .filter((i) => !i.allDay && i.start.getTime() < dayEnd && i.end.getTime() > dayStart)
    .map((item) => {
      const startMinute = Math.max(0, Math.round((item.start.getTime() - dayStart) / MINUTE));
      const endMinute = Math.min(24 * 60, Math.round((item.end.getTime() - dayStart) / MINUTE));
      return { item, startMinute, endMinute: Math.max(endMinute, startMinute + 15), column: 0, columns: 1 };
    })
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const placed: PlacedItem[] = [];
  let cluster: PlacedItem[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const p of cluster) p.columns = columnEnds.length;
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const seg of segments) {
    if (seg.startMinute >= clusterEnd && cluster.length) closeCluster();
    let column = columnEnds.findIndex((end) => end <= seg.startMinute);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(seg.endMinute);
    } else {
      columnEnds[column] = seg.endMinute;
    }
    seg.column = column;
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, seg.endMinute);
  }
  if (cluster.length) closeCluster();
  return placed;
}

export function allDayItems(items: CalendarItem[], day: Date): CalendarItem[] {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  return items.filter((i) => i.allDay && inRange(i, from, to));
}

/** Les entrées d'un jour pour la vue mois, journées entières d'abord, puis par heure. */
export function itemsOfDay(items: CalendarItem[], day: Date): CalendarItem[] {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  return items
    .filter((i) => inRange(i, from, to))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
}

// ——— Conflits ———

export interface CalendarConflict {
  appointment: CalendarItem;
  /** Les événements externes occupés qui chevauchent le rendez-vous. */
  blockers: CalendarItem[];
  /** Le premier créneau libre du même jour, ou null s'il n'y en a pas. */
  freeSlot: Date | null;
}

/** Les heures où l'on propose un créneau de remplacement. */
export const WORK_START_HOUR = 8;
export const WORK_END_HOUR = 19;
const SLOT_STEP = 15;

/**
 * Les rendez-vous SANKORÉ à venir qui chevauchent un événement occupé d'un agenda connecté.
 * Les événements sur la journée entière n'en créent pas : un congé ou un anniversaire posé sur la
 * journée ferait sinon de chaque rendez-vous un conflit.
 */
export function findConflicts(items: CalendarItem[], now: Date): CalendarConflict[] {
  const busy = items.filter((i) => i.kind === 'external' && i.busy && !i.allDay);
  if (!busy.length) return [];

  return items
    .filter((i) => i.kind === 'appointment' && i.end > now)
    .map((appointment) => ({
      appointment,
      blockers: busy.filter((b) => b.start < appointment.end && b.end > appointment.start),
    }))
    .filter((c) => c.blockers.length > 0)
    .map((c) => ({ ...c, freeSlot: firstFreeSlot(c.appointment, items, now) }))
    .sort((a, b) => a.appointment.start.getTime() - b.appointment.start.getTime());
}

/**
 * Le premier créneau du jour du rendez-vous, entre 8 h et 19 h, au quart d'heure, après
 * maintenant, où sa durée ne touche ni un événement occupé ni un autre rendez-vous.
 */
export function firstFreeSlot(appointment: CalendarItem, items: CalendarItem[], now: Date): Date | null {
  const duration = appointment.end.getTime() - appointment.start.getTime();
  const day = startOfDay(appointment.start);
  const blockers = items.filter(
    (i) => i.key !== appointment.key && !i.allDay
      && ((i.kind === 'external' && i.busy) || i.kind === 'appointment' || i.kind === 'activity'),
  );

  const last = new Date(day);
  last.setHours(WORK_END_HOUR, 0, 0, 0);
  const slot = new Date(day);
  slot.setHours(WORK_START_HOUR, 0, 0, 0);

  for (; slot.getTime() + duration <= last.getTime(); slot.setMinutes(slot.getMinutes() + SLOT_STEP)) {
    if (slot <= now) continue;
    const end = slot.getTime() + duration;
    if (!blockers.some((b) => b.start.getTime() < end && b.end.getTime() > slot.getTime())) return new Date(slot);
  }
  return null;
}

// ——— Libellés ———

const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function timeLabel(d: Date): string {
  return TIME.format(d);
}

export function timeRange(item: CalendarItem): string {
  return item.allDay ? 'Toute la journée' : `${TIME.format(item.start)} – ${TIME.format(item.end)}`;
}

export { dayKey };
