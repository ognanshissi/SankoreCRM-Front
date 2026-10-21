import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MyCalendarEventDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { safeColor } from './calendar-meta';

export interface CalendarEventDrawerData {
  event: MyCalendarEventDto;
}

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

const SHOW_AS: Record<string, string> = {
  Busy: 'Occupé',
  Free: 'Disponible',
  Tentative: 'Provisoire',
  OutOfOffice: 'Absent',
  WorkingElsewhere: 'Travaille ailleurs',
};

/**
 * Un événement d'un agenda connecté, en lecture seule : il se modifie dans Outlook ou Google
 * Agenda, et revient ici à la synchronisation suivante.
 */
@Component({
  selector: 'calendar-event-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, TasIcon, Button],
  template: `
    <tas-side-drawer width="460px">
      <tas-drawer-title>
        <tas-title>{{ e.title || 'Occupé' }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div class="flex items-center gap-3">
            <span class="size-3 shrink-0 rounded-full" [style.background-color]="color" aria-hidden="true"></span>
            <div>
              <p class="text-sm font-semibold text-slate-900">{{ when }}</p>
              <p class="text-xs text-slate-500">{{ showAs }}</p>
            </div>
          </div>

          @if (e.location) {
            <p class="flex items-center gap-2 text-sm text-slate-700">
              <tas-icon iconName="feather:map-pin" class="text-slate-400" style="font-size:14px"></tas-icon>
              {{ e.location }}
            </p>
          }

          <dl class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Agenda</dt>
              <dd class="text-slate-800">{{ e.calendarName || '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Compte</dt>
              <dd class="text-slate-800">{{ e.accountLabel || '—' }} · {{ e.provider === 'Google' ? 'Google' : 'Microsoft' }}</dd>
            </div>
          </dl>

          <p class="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <tas-icon iconName="feather:lock" class="mt-0.5 shrink-0" style="font-size:12px"></tas-icon>
            Visible par vous seul. Pour le modifier, passez par {{ e.provider === 'Google' ? 'Google Agenda' : 'Outlook' }} :
            le changement apparaîtra ici à la prochaine synchronisation.
          </p>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex w-full justify-end">
          <button tas-raised-button color="primary" type="button" (click)="close()">Fermer</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CalendarEventDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _data = inject<CalendarEventDrawerData>(DIALOG_DATA);

  public readonly e = this._data.event;
  public readonly color = safeColor(this.e.color, this.e.provider);
  public readonly showAs = SHOW_AS[this.e.showAs ?? ''] ?? 'Occupé';

  public readonly when = (() => {
    const start = new Date(this.e.startAt ?? '');
    const end = new Date(this.e.endAt ?? '');
    const day = DAY.format(start);
    const label = `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
    return this.e.isAllDay ? `${label} · toute la journée` : `${label} · ${TIME.format(start)} – ${TIME.format(end)}`;
  })();

  public close(): void {
    this._dialogRef.close();
  }
}
