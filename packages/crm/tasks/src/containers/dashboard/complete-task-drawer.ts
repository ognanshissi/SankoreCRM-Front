import { Component, computed, inject, signal } from '@angular/core';
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
import {
  TasksApiService,
  CrmTaskDto,
  CrmTaskDtoTypeEnum,
  CreateTaskRequestTypeEnum,
  CreateTaskRequestPriorityEnum,
} from '@sankore/crm-api';

export interface CompleteTaskDrawerData {
  task: CrmTaskDto;
}

export interface CompleteTaskDrawerResult {
  completed: boolean;
  followUpCreated: boolean;
}

/** Task types that require a result/comment to close */
const TYPES_REQUIRING_RESULT = new Set<string>([
  CrmTaskDtoTypeEnum.FirstContact,
  CrmTaskDtoTypeEnum.Qualification,
  CrmTaskDtoTypeEnum.SlaFollowUp,
  CrmTaskDtoTypeEnum.ScoreReview,
  CrmTaskDtoTypeEnum.OwnerHandover,
]);

const OUTCOME_OPTIONS: { label: string; value: string }[] = [
  { label: 'Contacté avec succès',         value: 'contacted_success' },
  { label: 'Injoignable',                  value: 'unreachable' },
  { label: 'Rappel demandé',               value: 'callback_requested' },
  { label: 'Refus du prospect',            value: 'prospect_refused' },
  { label: 'Informations collectées',      value: 'info_collected' },
  { label: 'Qualification validée',        value: 'qualification_validated' },
  { label: 'Qualification insuffisante',   value: 'qualification_insufficient' },
  { label: 'Passation effectuée',          value: 'handover_done' },
  { label: 'Autre',                        value: 'other' },
];

/** Suggested follow-up task type based on current task type + outcome */
function suggestFollowUp(
  type: CrmTaskDtoTypeEnum | string | undefined,
  outcome: string,
): { type: CreateTaskRequestTypeEnum; title: string } | null {
  if (outcome === 'callback_requested') {
    return { type: CreateTaskRequestTypeEnum.FirstContact, title: 'Rappeler le prospect' };
  }
  if (outcome === 'unreachable') {
    return { type: CreateTaskRequestTypeEnum.SlaFollowUp, title: 'Relance — prospect injoignable' };
  }
  if (type === CrmTaskDtoTypeEnum.FirstContact && outcome === 'contacted_success') {
    return { type: CreateTaskRequestTypeEnum.Qualification, title: 'Qualifier le lead' };
  }
  if (type === CrmTaskDtoTypeEnum.Qualification && outcome === 'qualification_validated') {
    return { type: CreateTaskRequestTypeEnum.ScoreReview, title: 'Revue du score après qualification' };
  }
  if (outcome === 'qualification_insufficient') {
    return { type: CreateTaskRequestTypeEnum.Qualification, title: 'Compléter la qualification' };
  }
  return null;
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

@Component({
  selector: 'complete-task-drawer',
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
          <tas-icon iconName="feather:check-circle" style="font-size:18px"></tas-icon>
          <span>Terminer la tâche</span>
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

        <!-- Outcome (required for certain task types) -->
        @if (requiresResult()) {
          <div class="mb-1">
            <div class="flex items-center gap-1 mb-2">
              <tas-icon iconName="feather:alert-circle" class="text-amber-500" style="font-size:12px"></tas-icon>
              <span class="text-xs font-medium text-amber-700">Résultat obligatoire pour ce type de tâche</span>
            </div>
          </div>
        }

        <tas-form-field appearance="outline">
          <tas-label>
            Résultat
            @if (requiresResult()) {
              <span class="text-red-500 ml-0.5">*</span>
            }
          </tas-label>
          <tas-select
            [options]="outcomeOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="Sélectionnez un résultat"
            [ngModel]="selectedOutcome()"
            (ngModelChange)="selectedOutcome.set($event)"
          ></tas-select>
          @if (submitted() && requiresResult() && !selectedOutcome()) {
            <tas-error>Le résultat est obligatoire pour ce type de tâche.</tas-error>
          }
        </tas-form-field>

        <!-- Comment -->
        <div class="mt-3">
          <tas-form-field appearance="outline">
            <tas-label>Commentaire</tas-label>
            <textarea
              tasInput
              rows="3"
              placeholder="Notes, détails supplémentaires..."
              [ngModel]="comment()"
              (ngModelChange)="comment.set($event)"
            ></textarea>
          </tas-form-field>
        </div>

        <!-- Follow-up suggestion (shown after outcome selection) -->
        @if (followUpSuggestion()) {
          <div class="mt-4 p-3 rounded-lg border border-primary/20 bg-primary/5">
            <div class="flex items-center gap-2 mb-1.5">
              <tas-icon iconName="feather:fast-forward" class="text-primary" style="font-size:14px"></tas-icon>
              <p class="text-xs font-semibold text-slate-700">Tâche suivante suggérée</p>
            </div>
            <p class="text-xs text-slate-600 mb-2">{{ followUpSuggestion()!.title }}</p>
            <div class="flex items-center gap-2">
              <label class="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  class="form-checkbox accent-primary"
                  [checked]="createFollowUp()"
                  (change)="createFollowUp.set(!createFollowUp())"
                />
                <span class="text-xs text-slate-700">Créer cette tâche automatiquement</span>
              </label>
            </div>
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
            [disabled]="isSubmitting()"
            (click)="submit()"
          >
            @if (isSubmitting()) {
              <tas-spinner size="3" class="text-white"></tas-spinner>
            }
            Terminer la tâche
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CompleteTaskDrawer {
  public readonly data: CompleteTaskDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<CompleteTaskDrawerResult | false>);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly outcomeOptions = OUTCOME_OPTIONS;
  public readonly typeLabel = typeLabel;

  public selectedOutcome = signal('');
  public comment = signal('');
  public createFollowUp = signal(true);
  public isSubmitting = signal(false);
  public submitted = signal(false);

  public readonly requiresResult = computed(() =>
    TYPES_REQUIRING_RESULT.has(this.data.task.type ?? ''),
  );

  public readonly followUpSuggestion = computed(() =>
    this.selectedOutcome()
      ? suggestFollowUp(this.data.task.type, this.selectedOutcome())
      : null,
  );

  public submit(): void {
    this.submitted.set(true);

    if (this.requiresResult() && !this.selectedOutcome()) {
      return; // Block submission
    }

    this.isSubmitting.set(true);
    const taskId = this.data.task.id!;

    // Complete the task
    this._tasksApi.completeCrmTask(taskId).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de terminer la tâche.');
        this.isSubmitting.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      // If follow-up requested, create it
      if (this.createFollowUp() && this.followUpSuggestion()) {
        const suggestion = this.followUpSuggestion()!;
        const now = new Date();
        const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24h

        this._tasksApi.createCrmTask({
          type: suggestion.type as any,
          priority: this.data.task.priority as any ?? CreateTaskRequestPriorityEnum.Medium,
          title: suggestion.title,
          leadId: this.data.task.leadId,
          assignedAgentId: this.data.task.assignedAgentId,
          dueAt: dueAt.toISOString(),
          description: `Suite de : ${this.data.task.title ?? typeLabel(this.data.task.type)}. Résultat : ${this.selectedOutcome()}. ${this.comment() ? 'Note : ' + this.comment() : ''}`.trim(),
        }).pipe(
          catchError(() => {
            this._snackbar.info('Tâche terminée', 'La tâche suivante n\'a pas pu être créée.');
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Tâche terminée', 'La tâche suivante a été créée automatiquement.');
          this._dialogRef.close({ completed: true, followUpCreated: true });
        });
      } else {
        this._snackbar.success('Tâche terminée', 'La tâche a été complétée.');
        this._dialogRef.close({ completed: true, followUpCreated: false });
      }
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
