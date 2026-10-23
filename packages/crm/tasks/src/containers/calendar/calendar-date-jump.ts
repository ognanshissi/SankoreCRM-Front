import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { TasIcon } from '@talisoft/ui/icon';
import { addDays, dayKey, startOfDay } from '../dashboard/my-day-meta';
import { CalendarView, startOfWeek, viewRange } from './calendar-meta';

interface JumpCell {
  day: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
  inPeriod: boolean;
  label: string;
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
const FULL_DAY = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' });
const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Le libellé de la période du Calendrier, cliquable : il ouvre un mois où l'on avance de mois en
 * mois (ou d'année en année) pour sauter à une date. La période affichée y est surlignée ; choisir
 * un jour garde la vue courante (jour, semaine ou mois) et la recentre sur ce jour.
 */
@Component({
  selector: 'calendar-date-jump',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkOverlayOrigin, CdkConnectedOverlay, TasIcon],
  template: `
    <button
      type="button"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      class="flex min-w-40 items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-slate-800 hover:bg-slate-100"
      aria-haspopup="dialog"
      [attr.aria-expanded]="isOpen()"
      (click)="toggle()"
    >
      {{ label() }}
      <tas-icon iconName="feather:chevron-down" class="text-slate-500" style="font-size:14px"></tas-icon>
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="isOpen()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayHasBackdrop]="true"
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      (backdropClick)="close()"
      (detach)="close()"
      (overlayKeydown)="$event.key === 'Escape' && close()"
    >
      <div class="w-72 rounded-2xl border border-slate-100 bg-white p-4 shadow-lg" role="dialog" aria-label="Aller à une date">
        <div class="flex items-center justify-between gap-1">
          <div class="flex">
            <button type="button" class="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Année précédente" (click)="shift(-12)">
              <tas-icon iconName="feather:chevrons-left" style="font-size:14px"></tas-icon>
            </button>
            <button type="button" class="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Mois précédent" (click)="shift(-1)">
              <tas-icon iconName="feather:chevron-left" style="font-size:14px"></tas-icon>
            </button>
          </div>
          <p class="text-sm font-semibold text-slate-800 first-letter:uppercase" aria-live="polite">{{ title() }}</p>
          <div class="flex">
            <button type="button" class="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Mois suivant" (click)="shift(1)">
              <tas-icon iconName="feather:chevron-right" style="font-size:14px"></tas-icon>
            </button>
            <button type="button" class="inline-flex size-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              aria-label="Année suivante" (click)="shift(12)">
              <tas-icon iconName="feather:chevrons-right" style="font-size:14px"></tas-icon>
            </button>
          </div>
        </div>

        <div class="mt-3 grid grid-cols-7 gap-y-1 text-center" role="grid" [attr.aria-label]="title()">
          @for (w of weekdays; track $index) {
            <span class="pb-1 text-[11px] font-semibold text-slate-500" aria-hidden="true">{{ w }}</span>
          }
          @for (cell of cells(); track cell.key) {
            <button
              type="button"
              class="mx-auto flex size-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors"
              [class]="cellClass(cell)"
              [attr.aria-label]="cell.label"
              [attr.aria-current]="cell.isToday ? 'date' : null"
              (click)="pick(cell.day)"
            >
              {{ cell.day.getDate() }}
            </button>
          }
        </div>

        <div class="mt-3 flex justify-center border-t border-slate-100 pt-3">
          <button type="button" class="rounded-lg px-3 py-1 text-sm font-semibold text-primary hover:bg-slate-100" (click)="pick(today())">
            Aujourd'hui
          </button>
        </div>
      </div>
    </ng-template>
  `,
})
export class CalendarDateJump {
  public readonly view = input.required<CalendarView>();
  public readonly anchor = input.required<Date>();
  public readonly label = input.required<string>();
  public readonly datePick = output<Date>();

  public readonly weekdays = WEEKDAYS;
  public readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  ];

  public readonly isOpen = signal(false);
  /** Premier jour du mois montré dans la fenêtre, indépendant de la période du Calendrier. */
  public readonly month = signal(new Date());

  public readonly title = computed(() => MONTH.format(this.month()));

  public readonly cells = computed<JumpCell[]>(() => {
    const first = this.month();
    const todayKey = dayKey(new Date());
    const period = this._period();
    return Array.from({ length: 42 }, (_, i) => {
      const day = addDays(startOfWeek(first), i);
      const key = dayKey(day);
      return {
        day,
        key,
        inMonth: day.getMonth() === first.getMonth(),
        isToday: key === todayKey,
        inPeriod: period.has(key),
        label: FULL_DAY.format(day),
      };
    });
  });

  /** Les jours de la période affichée ; en vue mois, les seuls jours du mois, pas les 6 semaines. */
  private readonly _period = computed(() => {
    const anchor = this.anchor();
    const days = viewRange(this.view(), anchor).days;
    const inPeriod = this.view() === 'month' ? days.filter((d) => d.getMonth() === anchor.getMonth()) : days;
    return new Set(inPeriod.map(dayKey));
  });

  public today(): Date {
    return startOfDay(new Date());
  }

  public toggle(): void {
    if (this.isOpen()) {
      this.close();
      return;
    }
    const anchor = this.anchor();
    this.month.set(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
    this.isOpen.set(true);
  }

  public close(): void {
    this.isOpen.set(false);
  }

  public shift(months: number): void {
    this.month.update((m) => new Date(m.getFullYear(), m.getMonth() + months, 1));
  }

  public pick(day: Date): void {
    this.isOpen.set(false);
    this.datePick.emit(startOfDay(day));
  }

  public cellClass(cell: JumpCell): string {
    if (cell.inPeriod) return 'bg-primary text-white font-semibold';
    if (cell.isToday) return 'font-semibold text-primary ring-1 ring-primary hover:bg-slate-100';
    return cell.inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50';
  }
}
