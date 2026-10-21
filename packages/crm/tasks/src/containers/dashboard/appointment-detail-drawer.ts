import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { AgendaAppointmentDto, AgendaAppointmentDtoModeEnum, AppointmentsApiService } from '@sankore/crm-api';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { appointmentTypeMeta } from './agenda-meta';

export interface AppointmentDetailDrawerData {
  appointment: AgendaAppointmentDto;
}

/** Ce que l'hôte doit faire en refermant : recharger l'agenda, ou ouvrir une fiche. */
export type AppointmentDetailDrawerResult =
  | { action: 'cancelled' }
  | { action: 'open'; route: string[] };

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

class CancelAppointmentFormModel {
  public reason!: string;

  public static instantiate(): CancelAppointmentFormModel {
    const m = new CancelAppointmentFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * Le détail d'un rendez-vous de « Ma journée » : quand, où ou par quel lien, avec qui, à propos de
 * qui. L'organisateur peut l'annuler — les invités en sont prévenus par e-mail ; un invité ne
 * peut que le consulter.
 */
@Component({
  selector: 'appointment-detail-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasFormField,
    TasLabel,
    TasHint,
    TasInput,
    Button,
    Anchor,
  ],
  template: `
    <tas-side-drawer width="520px">
      <tas-drawer-title>
        <tas-title>{{ a.title }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div class="flex items-center gap-3">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-lg" [class]="type.tone" aria-hidden="true">
              <tas-icon [iconName]="type.icon" style="font-size:16px"></tas-icon>
            </span>
            <div>
              <p class="text-sm font-semibold text-slate-900">{{ when }}</p>
              <p class="text-xs text-slate-500">{{ type.label }} · {{ a.durationMinutes }} min</p>
            </div>
          </div>

          @if (isOnline && a.meetingUrl) {
            <a tas-raised-button color="primary" [href]="a.meetingUrl" target="_blank" rel="noopener" class="self-start">
              <tas-icon iconName="feather:video" style="font-size:14px"></tas-icon>
              Rejoindre la réunion
            </a>
          } @else if (a.location) {
            <p class="flex items-center gap-2 text-sm text-slate-700">
              <tas-icon iconName="feather:map-pin" class="text-slate-400" style="font-size:14px"></tas-icon>
              {{ a.location }}
            </p>
          }

          <dl class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <dt class="text-xs text-slate-400">Concerne</dt>
              <dd class="text-slate-800">
                @if (a.leadId) {
                  <button type="button" class="font-medium text-primary hover:underline" (click)="open(['/leads', a.leadId])">
                    Lead · {{ a.leadName || 'Lead' }}
                  </button>
                } @else if (a.clientId) {
                  <button type="button" class="font-medium text-primary hover:underline" (click)="open(['/customers', a.clientId])">
                    Client · {{ a.clientName || 'Client' }}
                  </button>
                } @else {
                  Réunion interne
                }
              </dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Organisateur</dt>
              <dd class="text-slate-800">{{ a.isOrganizer ? 'Vous' : a.organizerName || '—' }}</dd>
            </div>
            <div>
              <dt class="text-xs text-slate-400">Participants</dt>
              <dd>
                @if (participants.length) {
                  <ul class="mt-1 flex flex-wrap gap-1.5">
                    @for (p of participants; track p.userId) {
                      <li class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">{{ p.fullName }}</li>
                    }
                  </ul>
                } @else {
                  <span class="text-slate-500">Aucun invité</span>
                }
              </dd>
            </div>
            @if (a.description) {
              <div>
                <dt class="text-xs text-slate-400">Détails</dt>
                <dd class="whitespace-pre-line text-slate-700">{{ a.description }}</dd>
              </div>
            }
          </dl>

          @if (a.isOrganizer && confirming()) {
            <form [formRoot]="formSchema" class="rounded-lg border border-red-200 bg-red-50/50 p-4">
              <tas-form-field>
                <tas-label>Motif de l’annulation</tas-label>
                <textarea tasInput rows="2" placeholder="Facultatif" [formField]="formSchema.reason"></textarea>
                @if (participants.length) {
                  <tas-hint>Les {{ participants.length }} invité(s) seront prévenus par e-mail.</tas-hint>
                }
              </tas-form-field>
            </form>
          }
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex justify-end gap-3">
          @if (a.isOrganizer) {
            @if (confirming()) {
              <button tas-outlined-button type="button" (click)="confirming.set(false)">Garder</button>
              <button tas-raised-button color="warn" type="button"
                [disabled]="formSchema().submitting()" [isLoading]="formSchema().submitting()"
                (click)="cancel()">Annuler le rendez-vous</button>
            } @else {
              <button tas-outlined-button color="warn" type="button" (click)="confirming.set(true)">Annuler le rendez-vous</button>
              <button tas-raised-button color="primary" type="button" (click)="close()">Fermer</button>
            }
          } @else {
            <button tas-raised-button color="primary" type="button" (click)="close()">Fermer</button>
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AppointmentDetailDrawer {
  private readonly _api = inject(AppointmentsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<AppointmentDetailDrawerResult>>(DialogRef);
  private readonly _data = inject<AppointmentDetailDrawerData>(DIALOG_DATA);

  public readonly a = this._data.appointment;
  public readonly type = appointmentTypeMeta(this.a);
  public readonly isOnline = this.a.mode === AgendaAppointmentDtoModeEnum.Online;
  public readonly participants = this.a.participants ?? [];

  /** « Jeudi 22 octobre 2026 · 14:00 – 14:30 », à l'heure de l'appareil qui l'affiche. */
  public readonly when = (() => {
    const start = new Date(this.a.startAt ?? '');
    const end = new Date(start.getTime() + (this.a.durationMinutes ?? 0) * 60_000);
    const day = DAY.format(start);
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${TIME.format(start)} – ${TIME.format(end)}`;
  })();

  public readonly confirming = signal(false);
  public model = signal(CancelAppointmentFormModel.instantiate());
  public formSchema = form(this.model);

  public cancel(): void {
    submit(this.formSchema, async (field) => {
      const reason = field()?.value().reason.trim() || null;
      const done = await firstValueFrom(
        this._api.cancelAppointment(this.a.id!, { reason }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'Annulation impossible',
              err.error?.detail === 'APPOINTMENT_ALREADY_HELD'
                ? 'Ce rendez-vous a déjà eu lieu.'
                : 'Le rendez-vous n’a pas pu être annulé.',
            );
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!done) return;
      this._snackbar.success('Rendez-vous annulé', this.participants.length ? 'Les invités ont été prévenus.' : this.a.title ?? '');
      this._dialogRef.close({ action: 'cancelled' });
    });
  }

  public open(route: string[]): void {
    this._dialogRef.close({ action: 'open', route });
  }

  public close(): void {
    this._dialogRef.close();
  }
}
