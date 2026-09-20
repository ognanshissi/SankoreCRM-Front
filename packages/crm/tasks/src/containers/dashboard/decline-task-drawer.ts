import { Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
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
import { TasksApiService, CrmTaskDto } from '@sankore/crm-api';

export interface DeclineTaskDrawerData {
  task: CrmTaskDto;
}

function typeLabel(type: string | undefined): string {
  switch (type) {
    case 'FirstContact':   return 'Premier contact';
    case 'Qualification':  return 'Qualification';
    case 'SlaFollowUp':    return 'Suivi SLA';
    case 'ScoreReview':    return 'Revue score';
    case 'OwnerHandover':  return 'Passation';
    case 'ManualDispatch': return 'Dispatch manuel';
    case 'Generic':        return 'Générique';
    default:               return type ?? '—';
  }
}

const REASON_OPTIONS: { label: string; value: string }[] = [
  { label: 'Charge de travail trop élevée',     value: 'workload' },
  { label: 'Hors de mon périmètre / expertise', value: 'out_of_scope' },
  { label: 'Conflit d\'intérêt',                 value: 'conflict' },
  { label: 'Absence / congé prévu',             value: 'absence' },
  { label: 'Lead déjà traité par un collègue',  value: 'already_handled' },
  { label: 'Autre (préciser)',                   value: 'other' },
];

@Component({
  selector: 'decline-task-drawer',
  imports: [
    FormsModule,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <div class="flex items-center gap-2">
          <tas-icon iconName="feather:x-circle" class="text-red-500" style="font-size:18px"></tas-icon>
          <span>Refuser la tâche</span>
        </div>
      </tas-drawer-title>

      <tas-drawer-content>
        <!-- Task summary -->
        <div class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <p class="text-sm font-medium text-slate-800">{{ data.task.title ?? typeLabel(data.task.type) }}</p>
          <div class="flex items-center gap-2 mt-1">
            <tas-tag severity="info">{{ typeLabel(data.task.type) }}</tas-tag>
            @if (data.task.leadId) {
              <span class="text-xs text-slate-400">Lead {{ data.task.leadId }}</span>
            }
          </div>
          @if (data.task.description) {
            <p class="text-xs text-slate-500 mt-1.5">{{ data.task.description }}</p>
          }
        </div>

        <!-- Warning -->
        <div class="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
          <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
          <div>
            <p class="text-xs font-medium text-amber-800">Le refus est définitif</p>
            <p class="text-xs text-amber-700 mt-0.5">
              La tâche sera retirée de votre tableau et redistribuée automatiquement à un autre agent.
            </p>
          </div>
        </div>

        <!-- Reason (required) -->
        <tas-form-field appearance="outline">
          <tas-label>
            Motif du refus
            <span class="text-red-500 ml-0.5">*</span>
          </tas-label>
          <tas-select
            [options]="reasonOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Sélectionnez un motif"
            [ngModel]="selectedReason()"
            (ngModelChange)="selectedReason.set($event)"
          ></tas-select>
          @if (submitted() && !selectedReason()) {
            <tas-error>Le motif est obligatoire pour refuser une tâche.</tas-error>
          }
        </tas-form-field>

        <!-- Additional detail (for "other" reason) -->
        @if (selectedReason() === 'other') {
          <div class="mt-3">
            <tas-form-field appearance="outline">
              <tas-label>
                Précisez le motif
                <span class="text-red-500 ml-0.5">*</span>
              </tas-label>
              <textarea
                tasInput
                rows="3"
                placeholder="Décrivez la raison du refus..."
                [ngModel]="customReason()"
                (ngModelChange)="customReason.set($event)"
              ></textarea>
              @if (submitted() && selectedReason() === 'other' && !customReason().trim()) {
                <tas-error>Veuillez préciser le motif.</tas-error>
              }
            </tas-form-field>
          </div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-between w-full">
          <button tas-outlined-button type="button" (click)="close()">
            Annuler
          </button>
          <button
            tas-button
            color="primary"
            type="button"
            class="!bg-red-600 hover:!bg-red-700"
            [disabled]="isSubmitting()"
            (click)="submit()"
          >
            @if (isSubmitting()) {
              <tas-spinner size="3" class="text-white"></tas-spinner>
            }
            Confirmer le refus
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class DeclineTaskDrawer {
  public readonly data: DeclineTaskDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly reasonOptions = REASON_OPTIONS;
  public readonly typeLabel = typeLabel;

  public selectedReason = signal('');
  public customReason = signal('');
  public isSubmitting = signal(false);
  public submitted = signal(false);

  public submit(): void {
    this.submitted.set(true);

    if (!this.selectedReason()) return;
    if (this.selectedReason() === 'other' && !this.customReason().trim()) return;

    this.isSubmitting.set(true);
    const taskId = this.data.task.id!;

    const reasonLabel = this.selectedReason() === 'other'
      ? this.customReason().trim()
      : REASON_OPTIONS.find((r) => r.value === this.selectedReason())?.label ?? this.selectedReason();

    this._tasksApi.reassignCrmTask(taskId, {
      reason: reasonLabel,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de refuser la tâche.');
        this.isSubmitting.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Tâche refusée', 'La tâche a été retirée de votre tableau et sera redistribuée.');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
