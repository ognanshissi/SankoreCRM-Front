import { CrmTaskDto } from '@sankore/crm-api';

/**
 * Le calendrier de « Ma journée » : jours locaux, groupes par jour, report et répartition des
 * tâches. Tout est en heure LOCALE — c'est la journée de l'agent qui compte, pas celle du
 * serveur en UTC — et en français par `Intl`, l'application n'enregistrant pas la locale
 * française d'Angular.
 */

const DAY_MS = 86_400_000;

/** « 2026-10-22 », en heure locale : la clé d'un jour du calendrier. */
export function dayKey(value: Date | string | number): string {
  const d = new Date(value);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((fromDayKey(toKey).getTime() - fromDayKey(fromKey).getTime()) / DAY_MS);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LONG_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** « Aujourd'hui · mercredi 21 oct. », « Demain · jeudi 22 oct. », « Samedi 24 oct. ». */
export function dayHeading(key: string, now: number): string {
  const long = LONG_DAY.format(fromDayKey(key));
  switch (daysBetween(dayKey(now), key)) {
    case 0:  return `Aujourd'hui · ${long}`;
    case 1:  return `Demain · ${long}`;
    case -1: return `Hier · ${long}`;
    default: return capitalize(long);
  }
}

/** La pastille d'échéance d'une ligne : « 14:30 » le jour même, « Demain », « Sam. 24 ». */
export function dayChip(iso: string, now: number): string {
  const at = new Date(iso);
  switch (daysBetween(dayKey(now), dayKey(at))) {
    case 0:  return TIME.format(at);
    case 1:  return 'Demain';
    case -1: return 'Hier';
    default: return capitalize(SHORT_DAY.format(at));
  }
}

/** « Promis hier 10:00 », « Promis lundi 14:00 », « Promis le 12 oct. à 14:00 ». */
export function promisedLabel(iso: string, now: number): string {
  const at = new Date(iso);
  const time = TIME.format(at);
  const ago = daysBetween(dayKey(at), dayKey(now));
  if (ago === 0) return `Promis aujourd'hui ${time}`;
  if (ago === 1) return `Promis hier ${time}`;
  if (ago < 7) return `Promis ${WEEKDAY.format(at)} ${time}`;
  return `Promis le ${DAY_MONTH.format(at)} à ${time}`;
}

export interface DayGroup<T> {
  key: string;
  heading: string;
  items: T[];
}

/** Regroupe par jour local, du plus ancien au plus récent ; l'ordre dans un jour est conservé. */
export function groupByDay<T>(items: T[], at: (item: T) => string | null | undefined, now: number): DayGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const iso = at(item);
    if (!iso) continue;
    const key = dayKey(iso);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, heading: dayHeading(key, now), items: list }));
}

// ——— Report et répartition ———

/**
 * Le report d'un cran : le lendemain de l'échéance si elle est encore à venir, sinon demain —
 * à la même heure dans les deux cas. Reporter « à demain » une tâche prévue samedi l'avancerait.
 */
export function postponedDueAt(task: CrmTaskDto, now: number): Date {
  const due = new Date(task.dueAt ?? now);
  const base = due.getTime() > now ? due : new Date(now);
  const next = addDays(startOfDay(base), 1);
  next.setHours(due.getHours(), due.getMinutes(), 0, 0);
  return next;
}

/** Au-delà de ce nombre de premiers contacts sur un même jour, l'écran propose de les étaler. */
export const SPREAD_THRESHOLD = 6;

/** Le jour de départ et les quatre jours ouvrés suivants : « la semaine » d'un agent. */
const SPREAD_DAYS = 5;

export function isFirstContact(task: CrmTaskDto): boolean {
  // Code système en clair : importer @sankore/crm/common ici tirerait ses composants dans le spec.
  return task.type === 'FirstContact';
}

/**
 * Étale les premiers contacts d'un jour sur ce jour et les quatre jours ouvrés suivants, à part
 * égale, en gardant l'heure de chacun. Les premiers (dans l'ordre de la journée) restent où ils
 * sont ; seuls les déplacés sont rendus, c'est ce qui part au serveur.
 */
export function spreadOverWeek(tasks: CrmTaskDto[], fromKey: string): { taskId: string; dueAt: string }[] {
  const contacts = tasks
    .filter((t) => isFirstContact(t) && t.id && t.dueAt)
    .sort((a, b) => new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime());
  if (contacts.length < 2) return [];

  const days = [fromDayKey(fromKey)];
  for (let d = addDays(days[0], 1); days.length < SPREAD_DAYS; d = addDays(d, 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d);
  }

  const perDay = Math.ceil(contacts.length / SPREAD_DAYS);
  const moves: { taskId: string; dueAt: string }[] = [];
  contacts.forEach((task, i) => {
    const slot = Math.floor(i / perDay);
    if (slot === 0) return;
    const due = new Date(task.dueAt!);
    const target = new Date(days[slot]);
    target.setHours(due.getHours(), due.getMinutes(), 0, 0);
    moves.push({ taskId: task.id!, dueAt: target.toISOString() });
  });
  return moves;
}

/** Le dernier jour touché par une répartition, pour le dire dans la confirmation. */
export function spreadLastDay(moves: { dueAt: string }[]): Date | null {
  if (!moves.length) return null;
  return new Date(Math.max(...moves.map((m) => new Date(m.dueAt).getTime())));
}

/**
 * Tâches ouvertes en double : même lead, même type. Deux « Qualifier Paul Yapi » sont presque
 * toujours deux règles qui ont réagi au même évènement ; l'agent doit le voir pour en fermer une.
 */
export function duplicateTaskIds(tasks: CrmTaskDto[]): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.leadId || !t.id) continue;
    const key = `${t.leadId}|${t.type}`;
    byKey.set(key, [...(byKey.get(key) ?? []), t.id]);
  }
  const ids = new Set<string>();
  for (const list of byKey.values()) {
    if (list.length > 1) list.slice(1).forEach((id) => ids.add(id));
  }
  return ids;
}

/**
 * Lien WhatsApp vers un numéro, ou `null` s'il n'est pas au format international. wa.me exige
 * l'indicatif : un numéro saisi en local (« 0708091801 ») ouvrirait la conversation d'un inconnu
 * dans un autre pays, alors on ne devine pas.
 */
export function whatsappUrl(phone: string | null | undefined): string | null {
  const raw = phone?.trim() ?? '';
  const international = raw.startsWith('+') || raw.startsWith('00');
  const digits = raw.replace(/\D/g, '').replace(/^00/, '');
  return international && digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
