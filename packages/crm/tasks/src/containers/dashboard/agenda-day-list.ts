import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { AgendaAppointmentDto, LeadDto, LeadsApiService } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { AgendaEntry, agendaWhen } from './agenda-meta';
import { ContactButtons } from './contact-buttons';
import { DayGroup } from './my-day-meta';

/**
 * Rappels ou rendez-vous de « Ma journée », une carte par jour comme les tâches. Un rappel se
 * clôt d'ici ; un rendez-vous planifié s'ouvre dans son détail ; une activité planifiée se
 * travaille sur la fiche du lead, où elle a été enregistrée.
 */
@Component({
  selector: 'my-day-agenda-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon, ContactButtons],
  template: `
    @if (groups().length === 0) {
      <div class="rounded-2xl border border-slate-100 bg-white px-5 py-12 text-center shadow-sm">
        <p class="text-sm font-medium text-slate-700">{{ emptyTitle() }}</p>
        <p class="mt-1 text-sm text-slate-500">{{ emptyText() }}</p>
      </div>
    } @else {
      <div class="flex flex-col gap-4">
        @for (group of groups(); track group.key) {
          <section class="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm" [attr.aria-label]="group.heading">
            <header class="border-b border-slate-100 px-4 py-3">
              <h2 class="text-sm font-semibold text-slate-900">
                {{ group.heading }}
                <span class="font-normal text-slate-500">· {{ group.items.length }}</span>
              </h2>
            </header>
            <ul class="divide-y divide-slate-100">
              @for (item of group.items; track item.key) {
                @let at = when(item.at, now(), item.isOverdue);
                <li class="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-slate-50"
                  tabindex="0" (click)="openItem(item)" (keydown.enter)="openItem(item)">
                  <span class="flex size-8 shrink-0 items-center justify-center rounded-lg" [class]="item.type.tone" aria-hidden="true">
                    <tas-icon [iconName]="item.type.icon" style="font-size:14px"></tas-icon>
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm text-slate-900">
                      <span class="font-semibold">{{ item.title }}</span> · {{ item.leadName }}
                    </p>
                    <p class="truncate text-xs text-slate-500">
                      {{ item.type.label }}@if (item.durationMinutes) { · {{ item.durationMinutes }} min}@if (item.notes) { · {{ item.notes }}}
                    </p>
                  </div>
                  <span class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums" [title]="at.fullDate"
                    [class]="at.tone === 'overdue' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-700'">{{ timeLabel(item) }}</span>
                  <div class="flex shrink-0 items-center gap-1.5" (click)="$event.stopPropagation()">
                    @if (item.appointment?.meetingUrl) {
                      <a [href]="item.appointment!.meetingUrl" target="_blank" rel="noopener"
                        class="inline-flex h-9 items-center gap-1.5 rounded-full bg-sky-50 px-3 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                        [attr.aria-label]="'Rejoindre : ' + item.title">
                        <tas-icon iconName="feather:video" style="font-size:13px"></tas-icon> Rejoindre
                      </a>
                    }
                    @if (item.leadId) {
                      <my-day-contact [leadId]="item.leadId" [phone]="phoneOf(item)" [name]="item.leadName"></my-day-contact>
                    }
                    @if (item.kind === 'reminder' && canManageReminders()) {
                      <button type="button"
                        class="inline-flex size-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                        title="Ignorer le rappel" [attr.aria-label]="'Ignorer le rappel : ' + item.title"
                        [disabled]="actingKey() === item.key" (click)="resolve(item, false)">
                        <tas-icon iconName="feather:x" style="font-size:14px"></tas-icon>
                      </button>
                      <button type="button"
                        class="inline-flex size-9 items-center justify-center rounded-full bg-primary text-white hover:opacity-90 disabled:opacity-50"
                        title="Rappel fait" [attr.aria-label]="'Rappel fait : ' + item.title"
                        [disabled]="actingKey() === item.key" (click)="resolve(item, true)">
                        <tas-icon iconName="feather:check" style="font-size:14px"></tas-icon>
                      </button>
                    }
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      </div>
    }
  `,
})
export class AgendaDayList {
  private readonly _router = inject(Router);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);
  public readonly canManageReminders = this._permissions.can('lead:reminder:manage');

  public readonly groups = input.required<DayGroup<AgendaEntry>[]>();
  public readonly leads = input<Map<string, LeadDto>>(new Map());
  public readonly now = input(Date.now());
  public readonly emptyTitle = input('Rien de prévu');
  public readonly emptyText = input('');

  /** Un rappel a été clos d'ici : l'écran recharge l'agenda et les compteurs. */
  public readonly changed = output<void>();
  /** Un rendez-vous s'ouvre dans son drawer de détail, que l'écran possède. */
  public readonly openAppointment = output<AgendaAppointmentDto>();

  public readonly actingKey = signal<string | null>(null);
  public readonly when = agendaWhen;

  /** L'heure suffit sous l'en-tête du jour ; le retard, lui, se dit en durée. */
  public timeLabel(item: AgendaEntry): string {
    const at = agendaWhen(item.at, this.now(), item.isOverdue);
    return at.tone === 'overdue' ? at.label : at.label.split(' · ').pop() ?? at.label;
  }

  public phoneOf(item: AgendaEntry): string | null {
    return (item.leadId && this.leads().get(item.leadId)?.phoneNumber) || null;
  }

  public openItem(item: AgendaEntry): void {
    if (item.appointment) {
      this.openAppointment.emit(item.appointment);
      return;
    }
    if (item.leadId) this._router.navigate(['/leads', item.leadId, 'suivi', item.kind === 'reminder' ? 'rappels' : 'activites']);
  }

  public resolve(item: AgendaEntry, done: boolean): void {
    if (item.kind !== 'reminder' || !item.leadId) return;
    this.actingKey.set(item.key);
    const request$ = done
      ? this._leadsApi.completeLeadReminder(item.leadId, item.id)
      : this._leadsApi.dismissLeadReminder(item.leadId, item.id);
    request$
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', done ? 'Le rappel n’a pas pu être marqué fait.' : 'Le rappel n’a pas pu être ignoré.');
          return EMPTY;
        }),
        finalize(() => this.actingKey.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success(done ? 'Rappel fait' : 'Rappel ignoré', `${item.leadName} : ${item.title}`);
        this.changed.emit();
      });
  }
}
