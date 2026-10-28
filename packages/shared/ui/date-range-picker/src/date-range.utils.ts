import { maskDate as maskDay } from '@talisoft/ui/date-picker';

/** Une période en jours ISO — la même forme que le mode `daterange` de `tas-date-picker`. */
export interface DateRangeValue {
  start: string | null;
  end: string | null;
}

// ─── Dates as ISO days ────────────────────────────────────────────────────────
// The value is `{ start, end }` in ISO days (« 2026-10-27 »), like TasDatePicker's daterange mode:
// no time, no time zone. Every comparison below is on those strings, which order as dates.

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDay(value: string | null | undefined): string {
  const d = fromIso(value);
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

export function formatRange(value: DateRangeValue | null | undefined): string {
  if (!value?.start || !value.end) return '';
  return `${formatDay(value.start)}${RANGE_SEPARATOR}${formatDay(value.end)}`;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ─── Typing ───────────────────────────────────────────────────────────────────

export const RANGE_SEPARATOR = ' – ';

/**
 * What the agent typed, laid out as « JJ/MM/AAAA – JJ/MM/AAAA ». Typed digit after digit, the
 * separator appears with the ninth digit — never before, or Backspace could not get past it. A
 * pasted range whose two halves are separated by a dash keeps its halves apart, so « 2/3/2026 -
 * 5/3/2026 » pads each day instead of running the digits together.
 */
export function maskRange(raw: string): string {
  const halves = raw.split(/\s*[–—-]\s*|\s+(?:au|à)\s+/i);
  if (halves.length >= 2 && halves[0].trim() && /\d/.test(halves[1])) {
    return `${maskDay(halves[0])}${RANGE_SEPARATOR}${maskDay(halves.slice(1).join(''))}`;
  }

  const digits = raw.replace(/\D/g, '').slice(0, 16);
  const first = maskDay(digits.slice(0, 8));
  return digits.length > 8 ? `${first}${RANGE_SEPARATOR}${maskDay(digits.slice(8))}` : first;
}

/** « 21/10/2026 » → ISO, or null when incomplete or impossible (31/02, 00/13…). */
export function parseDay(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  // The Date constructor rolls 31/02 over to 03/03: a date that moved is a date that does not exist.
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && year >= 1000 ? toIso(d) : null;
}

export type TypedRangeProblem = 'format' | 'min' | 'max';

/**
 * The typed text as a range, or why it is not one. Two days in the wrong order are put back in
 * order: the agent meant the period between them.
 */
export function parseRange(
  text: string,
  min?: string | null,
  max?: string | null,
): { value: DateRangeValue } | { problem: TypedRangeProblem } {
  const [a, b] = text.split(RANGE_SEPARATOR);
  const start = parseDay(a ?? '');
  const end = parseDay(b ?? '');
  if (!start || !end) return { problem: 'format' };

  const [s, e] = start <= end ? [start, end] : [end, start];
  if (min && s < min) return { problem: 'min' };
  if (max && e > max) return { problem: 'max' };
  return { value: { start: s, end: e } };
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export interface DateRangePreset {
  label: string;
  /** The period, from today's date (local, midnight). */
  range: (today: Date) => { start: Date; end: Date };
}

export const DEFAULT_DATE_RANGE_PRESETS: DateRangePreset[] = [
  { label: 'Aujourd’hui', range: (t) => ({ start: t, end: t }) },
  { label: 'Hier', range: (t) => ({ start: addDays(t, -1), end: addDays(t, -1) }) },
  { label: '7 derniers jours', range: (t) => ({ start: addDays(t, -6), end: t }) },
  { label: '30 derniers jours', range: (t) => ({ start: addDays(t, -29), end: t }) },
  { label: 'Ce mois-ci', range: (t) => ({ start: new Date(t.getFullYear(), t.getMonth(), 1), end: new Date(t.getFullYear(), t.getMonth() + 1, 0) }) },
  { label: 'Mois dernier', range: (t) => ({ start: new Date(t.getFullYear(), t.getMonth() - 1, 1), end: new Date(t.getFullYear(), t.getMonth(), 0) }) },
];

/**
 * A preset's period held inside min/max — « Ce mois-ci » with `max` = today stops at today rather
 * than being refused — or null when nothing of it is left.
 */
export function presetRange(preset: DateRangePreset, today: Date, min?: string | null, max?: string | null): DateRangeValue | null {
  const r = preset.range(today);
  let start = toIso(r.start);
  let end = toIso(r.end);
  if (min && start < min) start = min;
  if (max && end > max) end = max;
  return start <= end ? { start, end } : null;
}

// ─── Month grid ───────────────────────────────────────────────────────────────

export interface MonthCell {
  /** null: a blank before the 1st or after the last day, so every week starts on Monday. */
  iso: string | null;
  day: number;
}

/** The weeks of a month, Monday first, padded with blanks. */
export function monthGrid(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(year, month + 1, 0).getDate();
  const cells: MonthCell[] = Array.from({ length: lead }, () => ({ iso: null, day: 0 }));
  for (let day = 1; day <= length; day++) cells.push({ iso: toIso(new Date(year, month, day)), day });
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: 0 });
  return cells;
}
