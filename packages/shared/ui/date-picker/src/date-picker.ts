import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import { AbstractControlValueAccessor } from '@talisoft/ui/core';
import {
  AbstractControl,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
} from '@angular/forms';
import { CdkConnectedOverlay, CdkOverlayOrigin } from '@angular/cdk/overlay';
import { NgClass } from '@angular/common';
import {
  CalendarDay,
  DatePickerMode,
  DatePickerValue,
  DateRangeValue,
} from './date-picker.types';
import { TasIcon } from '@talisoft/ui/icon';
import { TasError, TasFormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WEEK_DAYS = ['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'];
const MONTHS_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isInRange(currentDate: Date, startDate: Date, endDate: Date): boolean {
  const [s, e] =
    startDate <= endDate ? [startDate, endDate] : [endDate, startDate];
  return (
    currentDate.getTime() > s.getTime() && currentDate.getTime() < e.getTime()
  );
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date | null): string {
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(
    d.getMonth() + 1
  ).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * What the agent typed, laid out as JJ/MM/AAAA. Digits only; a separator the agent typed after a
 * single digit pads it (« 2/3/2026 » → « 02/03/2026 »), so both habits work.
 */
function maskDate(raw: string): string {
  const parts = raw.split(/[^\d]+/);
  let digits = raw;
  if (parts.length > 1) {
    const [d = '', m = '', ...rest] = parts;
    const day = d.length === 1 ? `0${d}` : d.slice(0, 2);
    const month = parts.length > 2 && m.length === 1 ? `0${m}` : m.slice(0, 2);
    digits = day + month + rest.join('');
  }
  digits = digits.replace(/\D/g, '').slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4)}`;
  return out;
}

/** « 21/10/2026 » → the date, or null when incomplete or impossible (31/02, 00/13…). */
function parseTyped(text: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(year, month - 1, day);
  // The Date constructor rolls 31/02 over to 03/03: a date that moved is a date that does not exist.
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day && year >= 1000 ? d : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// ─── Component ───────────────────────────────────────────────────────────────
@Component({
  selector: 'tas-date-picker, TasDatePicker',
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasFormField,
    TasLabel,
    TasError,
    TasSuffix,
    TasIcon,
    TasInput,
    CdkOverlayOrigin,
    CdkConnectedOverlay,
    NgClass,
    TasIcon,
    TasSuffix,
    TasInput,
    TasLabel,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => TasDatePicker),
      multi: true,
    },
    {
      provide: NG_VALIDATORS,
      useExisting: forwardRef(() => TasDatePicker),
      multi: true,
    },
  ],
})
export class TasDatePicker extends AbstractControlValueAccessor<DatePickerValue> {
  // ── Inputs ──────────────────────────────────────────────────────────────────
  readonly mode = input<DatePickerMode>('date');
  readonly placeholder = input<string>('');
  readonly labelScreenOnly = input(false, { transform: booleanAttribute });
  /** Earliest selectable day, ISO (« 2026-10-25 »); the native input's `min`. */
  readonly min = input<string | null | undefined>(null);
  /** Latest selectable day, ISO; the native input's `max`. */
  readonly max = input<string | null | undefined>(null);

  // ── Overlay ──────────────────────────────────────────────────────────────────
  readonly isOpen = signal(false);

  // ── Calendar navigation ───────────────────────────────────────────────────
  readonly viewYear = signal(new Date().getFullYear());
  readonly viewMonth = signal(new Date().getMonth());

  // ── Time ─────────────────────────────────────────────────────────────────────
  readonly selectedHour = signal(0);
  readonly selectedMinute = signal(0);

  // ── Range ─────────────────────────────────────────────────────────────────
  readonly rangeStart = signal<string | null>(null);
  readonly rangeEnd = signal<string | null>(null);
  readonly rangePhase = signal<'start' | 'end'>('start');
  readonly hoverDate = signal<Date | null>(null);

  // ── Reactive value (fixes displayValue reactivity) ────────────────────────
  // Instead of reading from a FormControl (non-signal), we keep our own signal.
  private readonly _rawValue = signal<DatePickerValue>(null);

  // ── Typing (date mode) ────────────────────────────────────────────────────
  /** What the input shows in date mode: the agent's text while typing, the value otherwise. */
  readonly typedText = signal('');
  private readonly _blurred = signal(false);

  readonly typable = computed(() => this.mode() === 'date');

  /** Text typed and left, which is not a date: said under the field, never silently dropped. */
  readonly showInvalid = computed(() =>
    this.typable() && this._blurred() && !!this.typedText() && this._typedProblem() !== null);

  readonly invalidMessage = computed(() => {
    switch (this._typedProblem()) {
      case 'min': return `Date trop ancienne — au plus tôt le ${formatDate(parseDate(this.min()))}.`;
      case 'max': return `Date trop lointaine — au plus tard le ${formatDate(parseDate(this.max()))}.`;
      default: return 'Date invalide — attendue au format JJ/MM/AAAA.';
    }
  });

  /** Why the typed text is not a value: unreadable, or outside min/max. */
  private readonly _typedProblem = computed<'format' | 'min' | 'max' | null>(() => {
    const date = parseTyped(this.typedText());
    if (!date) return 'format';
    return this._outOfRange(date);
  });

  private _outOfRange(date: Date): 'min' | 'max' | null {
    const iso = toISODate(date);
    const min = this.min();
    const max = this.max();
    if (min && iso < min) return 'min';
    if (max && iso > max) return 'max';
    return null;
  }

  // ── Static data ───────────────────────────────────────────────────────────
  readonly weekDays = WEEK_DAYS;

  // ── Computed ─────────────────────────────────────────────────────────────

  readonly monthYearLabel = computed(
    () => `${MONTHS_FR[this.viewMonth()]} ${this.viewYear()}`,
  );

  readonly hourDisplay = computed(() => pad2(this.selectedHour()));
  readonly minuteDisplay = computed(() => pad2(this.selectedMinute()));

  readonly prefixIcon = computed(() =>
    this.mode() === 'time' ? 'feather:clock' : 'feather:calendar',
  );

  readonly hasValue = computed(() => {
    if (this.mode() === 'daterange') {
      return !!this.rangeStart() || !!this.rangeEnd();
    }
    return !!this._rawValue();
  });

  readonly effectivePlaceholder = computed(() => {
    // Typing: the expected format is the only useful hint — « Sélectionnez une date » would hide it.
    if (this.mode() === 'date') return 'JJ/MM/AAAA';
    const custom = this.placeholder();
    if (custom) return custom;
    switch (this.mode()) {
      case 'date':
        return 'JJ/MM/AAAA';
      case 'time':
        return 'HH:MM';
      case 'datetime':
        return 'JJ/MM/AAAA HH:MM';
      case 'daterange':
        return 'Date de début – Date de fin';
    }
  });

  /** Formatted display value for the trigger input. */
  readonly displayValue = computed(() => {
    const mode = this.mode();

    if (mode === 'daterange') {
      const s = this.rangeStart();
      const e = this.rangeEnd();
      if (!s && !e) return '';
      return `${s ? formatDate(parseDate(s)) : '...'} – ${
        e ? formatDate(parseDate(e)) : '...'
      }`;
    }

    const val = this._rawValue();
    if (!val || typeof val !== 'string') return '';

    switch (mode) {
      case 'date':
        return formatDate(parseDate(val));
      case 'time':
        return val;
      case 'datetime': {
        const [datePart, timePart] = val.split('T');
        return `${formatDate(parseDate(datePart))}  ${timePart ?? ''}`.trim();
      }
    }
  });

  /** Currently selected Date object (null for time-only or range modes). */
  readonly selectedDate = computed((): Date | null => {
    const mode = this.mode();
    if (mode === 'daterange' || mode === 'time') return null;
    const val = this._rawValue();
    if (!val || typeof val !== 'string') return null;
    return parseDate(val.split('T')[0]);
  });

  readonly calendarDays = computed<CalendarDay[]>(() => {
    const year = this.viewYear();
    const month = this.viewMonth();
    const mode = this.mode();
    const today = new Date();
    const selected =
      mode === 'date' || mode === 'datetime' ? this.selectedDate() : null;

    // Only read range signals when needed to avoid spurious recomputations
    let rangeStartDate: Date | null = null;
    let effectiveRangeEnd: Date | null = null;
    if (mode === 'daterange') {
      rangeStartDate = parseDate(this.rangeStart());
      effectiveRangeEnd =
        parseDate(this.rangeEnd()) ??
        (this.rangePhase() === 'end' ? this.hoverDate() : null);
    }

    const firstDay = new Date(year, month, 1);
    const dow = firstDay.getDay();
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - (dow === 0 ? 6 : dow - 1));

    const days: CalendarDay[] = [];
    const cur = new Date(startDate);

    for (let i = 0; i < 42; i++) {
      days.push({
        date: new Date(cur),
        dayNumber: cur.getDate(),
        currentMonth: cur.getMonth() === month,
        isToday: isSameDay(cur, today),
        isSelected: selected ? isSameDay(cur, selected) : false,
        isRangeStart: rangeStartDate ? isSameDay(cur, rangeStartDate) : false,
        isRangeEnd: effectiveRangeEnd
          ? isSameDay(cur, effectiveRangeEnd)
          : false,
        inRange:
          rangeStartDate && effectiveRangeEnd
            ? isInRange(cur, rangeStartDate, effectiveRangeEnd)
            : false,
        outOfRange: this._outOfRange(cur) !== null,
      });
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  });

  // ── ControlValueAccessor ──────────────────────────────────────────────────

  override writeValue(obj: DatePickerValue): void {
    // Set internal value without calling onChange (avoid feedback loop)
    this._value = obj;
    this._rawValue.set(obj);
    this.typedText.set(typeof obj === 'string' ? formatDate(parseDate(obj.split('T')[0])) : '');
    this._blurred.set(false);

    if (obj && typeof obj === 'object') {
      // daterange
      this.rangeStart.set(obj.start);
      this.rangeEnd.set(obj.end);
      this.rangePhase.set('start');
    } else if (typeof obj === 'string') {
      const datePart = obj.split('T')[0];
      const d = parseDate(datePart);
      if (d) {
        this.viewYear.set(d.getFullYear());
        this.viewMonth.set(d.getMonth());
      }
      if (obj.includes('T')) {
        const [, time] = obj.split('T');
        const [h, m] = (time ?? '').split(':');
        if (h !== undefined)
          this.selectedHour.set(Math.min(23, Math.max(0, parseInt(h, 10))));
        if (m !== undefined)
          this.selectedMinute.set(Math.min(59, Math.max(0, parseInt(m, 10))));
      }
    }
  }

  override validate(_control: AbstractControl): ValidationErrors | null {
    return this.typable() && this.typedText() && this._typedProblem() !== null
      ? { datePickerInvalid: { expected: 'JJ/MM/AAAA', min: this.min() ?? null, max: this.max() ?? null } }
      : null;
  }

  // ── Typing ─────────────────────────────────────────────────────────────────

  onType(event: Event): void {
    if (!this.typable()) return;
    const field = event.target as HTMLInputElement;
    const masked = maskDate(field.value);
    // Written back at once: a letter or an extra digit disappears as it is typed.
    field.value = masked;
    this.typedText.set(masked);
    this._blurred.set(false);

    const date = parseTyped(masked);
    if (date && this._outOfRange(date) === null) {
      this.viewYear.set(date.getFullYear());
      this.viewMonth.set(date.getMonth());
      this._emit(toISODate(date), false);
    } else if (this._rawValue()) {
      // Incomplete or impossible: the field holds no date until it does — never the previous one.
      this._emit(null, false);
    }
  }

  onBlur(): void {
    if (!this.typable()) return;
    this._blurred.set(true);
    this.onTouched();
  }

  openCalendar(): void {
    if (!this.disabled()) this.isOpen.set(true);
  }

  // ── Overlay ────────────────────────────────────────────────────────────────

  toggleCalendar(): void {
    if (this.disabled()) return;
    this.isOpen.update((v) => !v);
  }

  closeCalendar(): void {
    this.isOpen.set(false);
    this.hoverDate.set(null);
  }

  // ── Calendar interactions ──────────────────────────────────────────────────

  selectDay(day: CalendarDay): void {
    if (!day.currentMonth || day.outOfRange) return;
    const mode = this.mode();

    if (mode === 'daterange') {
      this._selectRangeDay(day);
      return;
    }

    const iso = toISODate(day.date);

    if (mode === 'datetime') {
      const value = `${iso}T${this.hourDisplay()}:${this.minuteDisplay()}`;
      this._emit(value);
      // Keep open so user can also adjust time
    } else {
      this._emit(iso);
      this.isOpen.set(false);
    }
  }

  onDayHover(day: CalendarDay): void {
    if (this.mode() === 'daterange' && this.rangePhase() === 'end') {
      this.hoverDate.set(day.date);
    }
  }

  clearHover(): void {
    this.hoverDate.set(null);
  }

  private _selectRangeDay(day: CalendarDay): void {
    if (this.rangePhase() === 'start') {
      this.rangeStart.set(toISODate(day.date));
      this.rangeEnd.set(null);
      this.rangePhase.set('end');
    } else {
      let start = this.rangeStart()!;
      let end = toISODate(day.date);
      if (end < start) [start, end] = [end, start];
      this.rangeStart.set(start);
      this.rangeEnd.set(end);
      this.rangePhase.set('start');
      this.hoverDate.set(null);
      const value: DateRangeValue = { start, end };
      this._emit(value);
      this.isOpen.set(false);
    }
  }

  // ── Time interactions ──────────────────────────────────────────────────────

  changeHour(delta: number): void {
    this.selectedHour.update((h) => (h + delta + 24) % 24);
    if (this.mode() === 'datetime') this._syncDatetime();
  }

  changeMinute(delta: number): void {
    this.selectedMinute.update((m) => (m + delta + 60) % 60);
    if (this.mode() === 'datetime') this._syncDatetime();
  }

  confirmTime(): void {
    const mode = this.mode();
    const h = this.hourDisplay();
    const m = this.minuteDisplay();

    if (mode === 'time') {
      this._emit(`${h}:${m}`);
    } else if (mode === 'datetime') {
      const cur = this._rawValue();
      const datePart =
        typeof cur === 'string' && cur.includes('T')
          ? cur.split('T')[0]
          : typeof cur === 'string'
            ? cur
            : toISODate(new Date());
      this._emit(`${datePart}T${h}:${m}`);
    }
    this.isOpen.set(false);
  }

  private _syncDatetime(): void {
    const cur = this._rawValue();
    if (!cur || typeof cur !== 'string') return;
    const datePart = cur.includes('T') ? cur.split('T')[0] : cur;
    this._emit(`${datePart}T${this.hourDisplay()}:${this.minuteDisplay()}`);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  prevMonth(): void {
    if (this.viewMonth() === 0) {
      this.viewMonth.set(11);
      this.viewYear.update((y) => y - 1);
    } else {
      this.viewMonth.update((m) => m - 1);
    }
  }

  nextMonth(): void {
    if (this.viewMonth() === 11) {
      this.viewMonth.set(0);
      this.viewYear.update((y) => y + 1);
    } else {
      this.viewMonth.update((m) => m + 1);
    }
  }

  prevYear(): void {
    this.viewYear.update((y) => y - 1);
  }

  nextYear(): void {
    this.viewYear.update((y) => y + 1);
  }

  selectToday(): void {
    const today = new Date();
    if (this._outOfRange(today) !== null) return;
    const iso = toISODate(today);
    this.viewYear.set(today.getFullYear());
    this.viewMonth.set(today.getMonth());
    if (this.mode() === 'datetime') {
      this._emit(`${iso}T${this.hourDisplay()}:${this.minuteDisplay()}`);
    } else {
      this._emit(iso);
      this.isOpen.set(false);
    }
  }

  clearDate(): void {
    this._emit(null);
    this.rangeStart.set(null);
    this.rangeEnd.set(null);
    this.rangePhase.set('start');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** @param syncText false while typing: the agent's text is what the input shows, not a reformat. */
  private _emit(value: DatePickerValue, syncText = true): void {
    this._value = value;
    this._rawValue.set(value);
    if (syncText) {
      this.typedText.set(typeof value === 'string' ? formatDate(parseDate(value.split('T')[0])) : '');
      this._blurred.set(false);
    }
    this.onTouched();
    this.onChange(value);
  }
}
