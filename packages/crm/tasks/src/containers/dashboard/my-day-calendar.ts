import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';
import { addDays, dayKey } from './my-day-meta';

/** Ce qu'un jour porte : une pastille par genre, pas un compte. */
export interface DayMarkers {
  tasks: boolean;
  reminders: boolean;
  meetings: boolean;
}

interface CalendarCell {
  key: string;
  day: number;
  label: string;
  isPast: boolean;
  isToday: boolean;
  markers: DayMarkers | undefined;
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const FULL_DAY = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' });
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Le mois de « Ma journée ». Un clic sur un jour filtre la liste sur ce jour ; un second clic sur
 * le même jour lève le filtre. Les pastilles disent ce qui tombe ce jour-là — tâches, rappels,
 * rendez-vous — sans compter : le compte est dans la liste.
 */
@Component({
  selector: 'my-day-calendar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <div class="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div class="flex items-center justify-between">
        <button type="button" class="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          aria-label="Mois précédent" (click)="shift(-1)">
          <tas-icon iconName="feather:chevron-left" style="font-size:14px"></tas-icon>
        </button>
        <p class="text-sm font-semibold text-slate-800">{{ title() }}</p>
        <button type="button" class="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
          aria-label="Mois suivant" (click)="shift(1)">
          <tas-icon iconName="feather:chevron-right" style="font-size:14px"></tas-icon>
        </button>
      </div>

      <div class="mt-3 grid grid-cols-7 gap-y-1 text-center" role="grid" [attr.aria-label]="title()">
        @for (w of weekdays; track $index) {
          <span class="pb-1 text-[11px] font-semibold text-slate-500" aria-hidden="true">{{ w }}</span>
        }
        @for (cell of cells(); track $index) {
          @if (cell) {
            <button type="button"
              class="mx-auto flex h-10 w-9 flex-col items-center justify-center rounded-lg text-sm tabular-nums transition-colors"
              [class]="cellClass(cell)"
              [attr.aria-pressed]="selected() === cell.key"
              [attr.aria-label]="cell.label"
              (click)="daySelect.emit(selected() === cell.key ? null : cell.key)">
              <span class="leading-none">{{ cell.day }}</span>
              <span class="mt-1 flex h-1 gap-0.5" aria-hidden="true">
                @if (cell.markers?.tasks) { <span class="size-1 rounded-full bg-primary" [class.bg-white]="selected() === cell.key"></span> }
                @if (cell.markers?.reminders) { <span class="size-1 rounded-full bg-amber-500"></span> }
                @if (cell.markers?.meetings) { <span class="size-1 rounded-full bg-blue-500"></span> }
              </span>
            </button>
          } @else {
            <span></span>
          }
        }
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-primary"></span> Tâches</span>
        <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-amber-500"></span> Rappels</span>
        <span class="inline-flex items-center gap-1"><span class="size-1.5 rounded-full bg-blue-500"></span> Rendez-vous</span>
      </div>
    </div>
  `,
})
export class MyDayCalendar {
  /** Le premier jour du mois affiché. */
  public readonly month = input.required<Date>();
  public readonly selected = input<string | null>(null);
  public readonly today = input.required<string>();
  public readonly markers = input<Map<string, DayMarkers>>(new Map());

  public readonly monthChange = output<Date>();
  public readonly daySelect = output<string | null>();

  public readonly weekdays = WEEKDAYS;

  public readonly title = computed(() => {
    const t = MONTH.format(this.month());
    return t.charAt(0).toUpperCase() + t.slice(1);
  });

  /** Lundi en tête ; les cases avant le 1er restent vides. */
  public readonly cells = computed<(CalendarCell | null)[]>(() => {
    const first = this.month();
    const offset = (first.getDay() + 6) % 7;
    const today = this.today();
    const markers = this.markers();
    const cells: (CalendarCell | null)[] = Array.from({ length: offset }, () => null);
    for (let d = first; d.getMonth() === first.getMonth(); d = addDays(d, 1)) {
      const key = dayKey(d);
      cells.push({ key, day: d.getDate(), label: FULL_DAY.format(d), isPast: key < today, isToday: key === today, markers: markers.get(key) });
    }
    return cells;
  });

  public cellClass(cell: CalendarCell): string {
    if (this.selected() === cell.key) return 'bg-primary text-white font-semibold';
    if (cell.isToday) return 'border-2 border-primary font-semibold text-slate-900';
    return cell.isPast ? 'text-slate-400 hover:bg-slate-50' : 'text-slate-800 hover:bg-slate-50';
  }

  public shift(months: number): void {
    const m = this.month();
    this.monthChange.emit(new Date(m.getFullYear(), m.getMonth() + months, 1));
  }
}
