// ─── Public types ────────────────────────────────────────────────────────────

export interface DateRangeValue {
  start: string | null;
  end: string | null;
}

export type DatePickerMode = 'date' | 'time' | 'datetime' | 'daterange';
export type DatePickerValue = string | null | DateRangeValue;

// ─── Internal types ───────────────────────────────────────────────────────────

export interface CalendarDay {
  date: Date;
  dayNumber: number;
  currentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isRangeStart: boolean;
  isRangeEnd: boolean;
  inRange: boolean;
}
