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
import { TasFormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
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
    return null;
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
    if (!day.currentMonth) return;
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

  private _emit(value: DatePickerValue): void {
    this._value = value;
    this._rawValue.set(value);
    this.onTouched();
    this.onChange(value);
  }
}
