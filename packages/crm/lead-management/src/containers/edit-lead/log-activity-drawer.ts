import { Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  TasSideDrawer,
  TasDrawerTitle,
  TasDrawerContent,
  TasDrawerAction,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  LeadsApiService,
  LogActivityRequestTypeEnum,
  LogActivityRequestOutcomeEnum,
  ActivityDto,
  ActivityDtoTypeEnum,
} from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';
import { TasTitle } from '@talisoft/ui/title';

export interface LogActivityDrawerData {
  leadId: string;
  leadName: string;
}

export interface LogActivityDrawerResult {
  activity: ActivityDto;
}

// ——— Type metadata ———

interface TypeOption {
  value: LogActivityRequestTypeEnum;
  label: string;
  icon: string;
  severity: Severity;
  /** Which extra fields to show */
  fields: Set<'duration' | 'outcome' | 'scheduledAt'>;
}

const ACTIVITY_TYPES: TypeOption[] = [
  {
    value: LogActivityRequestTypeEnum.Call,
    label: 'Appel',
    icon: 'feather:phone',
    severity: 'info',
    fields: new Set(['duration', 'outcome']),
  },
  {
    value: LogActivityRequestTypeEnum.Meeting,
    label: 'Rendez-vous',
    icon: 'feather:users',
    severity: 'warning',
    fields: new Set(['duration', 'outcome', 'scheduledAt']),
  },
  {
    value: LogActivityRequestTypeEnum.Email,
    label: 'E-mail',
    icon: 'feather:mail',
    severity: 'info',
    fields: new Set(['outcome']),
  },
  {
    value: LogActivityRequestTypeEnum.Visit,
    label: 'Visite',
    icon: 'feather:map-pin',
    severity: 'success',
    fields: new Set(['duration', 'outcome', 'scheduledAt']),
  },
  {
    value: LogActivityRequestTypeEnum.Sms,
    label: 'SMS',
    icon: 'feather:message-square',
    severity: 'info',
    fields: new Set([]),
  },
  {
    value: LogActivityRequestTypeEnum.WhatsApp,
    label: 'WhatsApp',
    icon: 'feather:message-circle',
    severity: 'success',
    fields: new Set([]),
  },
  {
    value: LogActivityRequestTypeEnum.Note,
    label: 'Note',
    icon: 'feather:file-text',
    severity: 'neutral',
    fields: new Set([]),
  },
];

const TYPE_OPTIONS = ACTIVITY_TYPES.map((t) => ({ label: t.label, value: t.value }));

const OUTCOME_OPTIONS = [
  { label: 'Contacté avec succès', value: String(LogActivityRequestOutcomeEnum.NUMBER_0) },
  { label: 'Injoignable', value: String(LogActivityRequestOutcomeEnum.NUMBER_1) },
  { label: 'Messagerie vocale', value: String(LogActivityRequestOutcomeEnum.NUMBER_2) },
  { label: 'Rappel demandé',value: String(LogActivityRequestOutcomeEnum.NUMBER_3) },
  { label: 'Intéressé', value: String(LogActivityRequestOutcomeEnum.NUMBER_4) },
  { label: 'Pas intéressé', value: String(LogActivityRequestOutcomeEnum.NUMBER_5) },
  { label: 'Faux numéro', alue: String(LogActivityRequestOutcomeEnum.NUMBER_6) },
  { label: 'Autre', value: String(LogActivityRequestOutcomeEnum.NUMBER_7) },
];

@Component({
  selector: 'log-activity-drawer',
  imports: [
    FormsModule,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasSpinner,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Enregistrer une activité</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Lead context -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">{{ data.leadName }}</p>
        </div>

        <!-- Activity type selector (visual cards) -->
        <p class="text-xs font-semibold text-slate-600 mb-2">Type d'activité</p>
        <div class="grid grid-cols-4 gap-1.5 mb-4">
          @for (t of activityTypes; track t.value) {
            <button
              type="button"
              class="flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center"
              [class]="
                selectedType() === t.value
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-slate-200 hover:border-slate-300'
              "
              (click)="selectedType.set(t.value)"
            >
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center"
                [class]="
                  selectedType() === t.value
                    ? 'bg-primary/15 text-primary'
                    : 'bg-slate-100 text-slate-400'
                "
              >
                <tas-icon [iconName]="t.icon" style="font-size:12px"></tas-icon>
              </div>
              <span class="text-[10px] font-medium truncate w-full">{{
                t.label
              }}</span>
            </button>
          }
        </div>

        @if (submitted() && !selectedType()) {
          <p class="text-xs text-red-500 mb-3">
            Veuillez sélectionner un type d'activité.
          </p>
        }

        <!-- Subject -->
        <tas-form-field>
          <tas-label>
            Sujet
            <span class="text-red-500 ml-0.5">*</span>
          </tas-label>
          <input
            tasInput
            type="text"
            [placeholder]="subjectPlaceholder()"
            [ngModel]="subject()"
            (ngModelChange)="subject.set($event)"
          />
          @if (submitted() && !subject().trim()) {
            <tas-error>Le sujet est obligatoire.</tas-error>
          }
        </tas-form-field>

        <!-- Polymorphic fields based on type -->

        @if (activeFields().has('scheduledAt')) {
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Date/heure prévue</tas-label>
              <input
                tasInput
                type="datetime-local"
                [ngModel]="scheduledAt()"
                (ngModelChange)="scheduledAt.set($event)"
              />
            </tas-form-field>
          </div>
        }

        @if (activeFields().has('duration')) {
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Durée (minutes)</tas-label>
              <input
                tasInput
                type="number"
                placeholder="Ex : 15"
                min="1"
                [ngModel]="durationMinutes()"
                (ngModelChange)="durationMinutes.set($event)"
              />
            </tas-form-field>
          </div>
        }

        @if (activeFields().has('outcome')) {
          <div class="mt-3">
            <tas-form-field>
              <tas-label>Résultat</tas-label>
              <tas-select
                [options]="outcomeOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Sélectionnez un résultat"
                [ngModel]="outcome()"
                (ngModelChange)="outcome.set($event)"
              ></tas-select>
            </tas-form-field>
          </div>
        }

        <!-- Notes (always shown) -->
        <div class="mt-3">
          <tas-form-field>
            <tas-label>Notes</tas-label>
            <textarea
              tasInput
              rows="3"
              placeholder="Détails de l'interaction..."
              [ngModel]="notes()"
              (ngModelChange)="notes.set($event)"
            ></textarea>
          </tas-form-field>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="space-x-4">
          <button tas-outlined-button type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-raised-button
            color="primary"
            type="button"
            [disabled]="isSubmitting()"
            (click)="submit()"
          >
            @if (isSubmitting()) {
              <tas-spinner size="3" class="text-white"></tas-spinner>
            }
            Enregistrer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class LogActivityDrawer {
  public readonly data: LogActivityDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(
    DialogRef<LogActivityDrawerResult | false>,
  );
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly activityTypes = ACTIVITY_TYPES;
  public readonly outcomeOptions = OUTCOME_OPTIONS;

  public selectedType = signal<LogActivityRequestTypeEnum | ''>('');
  public subject = signal('');
  public notes = signal('');
  public durationMinutes = signal<number | null>(null);
  public outcome = signal('');
  public scheduledAt = signal('');
  public isSubmitting = signal(false);
  public submitted = signal(false);

  public readonly activeFields = computed(() => {
    const type = this.selectedType();
    if (!type) return new Set<string>();
    return ACTIVITY_TYPES.find((t) => t.value === type)?.fields ?? new Set();
  });

  public readonly subjectPlaceholder = computed(() => {
    switch (this.selectedType()) {
      case LogActivityRequestTypeEnum.Call:
        return 'Ex : Appel de qualification';
      case LogActivityRequestTypeEnum.Meeting:
        return 'Ex : Rendez-vous en agence';
      case LogActivityRequestTypeEnum.Email:
        return 'Ex : Envoi offre commerciale';
      case LogActivityRequestTypeEnum.Visit:
        return 'Ex : Visite terrain client';
      case LogActivityRequestTypeEnum.Sms:
        return 'Ex : SMS de relance';
      case LogActivityRequestTypeEnum.WhatsApp:
        return 'Ex : Échange WhatsApp';
      case LogActivityRequestTypeEnum.Note:
        return 'Ex : Note interne';
      default:
        return "Sujet de l'activité";
    }
  });

  public submit(): void {
    this.submitted.set(true);

    if (!this.selectedType() || !this.subject().trim()) return;

    this.isSubmitting.set(true);
    const performedBy = this._auth.connectedUser()?.id ?? '';

    this._leadsApi
      .logLeadActivity(this.data.leadId, {
        type: this.selectedType() as LogActivityRequestTypeEnum,
        subject: this.subject().trim(),
        notes: this.notes().trim() || null,
        performedBy,
        durationMinutes: this.activeFields().has('duration')
          ? this.durationMinutes()
          : null,
        outcome:
          this.activeFields().has('outcome') && this.outcome()
            ? (Number(this.outcome()) as any)
            : null,
        scheduledAt:
          this.activeFields().has('scheduledAt') && this.scheduledAt()
            ? new Date(this.scheduledAt()).toISOString()
            : null,
      })
      .pipe(
        catchError(() => {
          this._snackbar.error(
            'Erreur',
            "Impossible d'enregistrer l'activité.",
          );
          this.isSubmitting.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const typeMeta = ACTIVITY_TYPES.find(
          (t) => t.value === this.selectedType(),
        );

        // Build an ActivityDto for optimistic insertion
        const activity: ActivityDto = {
          id: result.activityId,
          type: this.selectedType() as unknown as ActivityDtoTypeEnum,
          subject: this.subject().trim(),
          notes: this.notes().trim() || null,
          performedBy,
          performedAt: result.performedAt ?? new Date().toISOString(),
          durationMinutes: this.durationMinutes(),
          outcome: this.outcome() ? (Number(this.outcome()) as any) : null,
          scheduledAt: this.scheduledAt()
            ? new Date(this.scheduledAt()).toISOString()
            : null,
        };

        this._snackbar.success(
          'Activité enregistrée',
          `${typeMeta?.label ?? 'Activité'} ajoutée à la fiche.`,
        );
        this._dialogRef.close({ activity });
      });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
