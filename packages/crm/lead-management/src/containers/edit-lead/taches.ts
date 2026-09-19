import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasksApiService,
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  CrmTaskDtoPriorityEnum,
} from '@sankore/crm-api';

function statusMeta(status: CrmTaskDtoStatusEnum | undefined): { label: string; severity: Severity } {
  switch (status) {
    case CrmTaskDtoStatusEnum.Pending:    return { label: 'En attente',  severity: 'neutral' };
    case CrmTaskDtoStatusEnum.InProgress: return { label: 'En cours',    severity: 'info' };
    case CrmTaskDtoStatusEnum.Completed:  return { label: 'Terminée',    severity: 'success' };
    case CrmTaskDtoStatusEnum.Cancelled:  return { label: 'Annulée',     severity: 'error' };
    default:                              return { label: '—',           severity: 'neutral' };
  }
}

function priorityMeta(priority: CrmTaskDtoPriorityEnum | undefined): { label: string; severity: Severity } {
  switch (priority) {
    case CrmTaskDtoPriorityEnum.Low:      return { label: 'Basse',     severity: 'neutral' };
    case CrmTaskDtoPriorityEnum.Medium:   return { label: 'Moyenne',   severity: 'info' };
    case CrmTaskDtoPriorityEnum.High:     return { label: 'Haute',     severity: 'warning' };
    case CrmTaskDtoPriorityEnum.Critical: return { label: 'Critique',  severity: 'error' };
    default:                              return { label: '—',         severity: 'neutral' };
  }
}

function typeLabel(type: string | undefined): string {
  switch (type) {
    case 'FirstContact':    return 'Premier contact';
    case 'Qualification':   return 'Qualification';
    case 'SlaFollowUp':     return 'Suivi SLA';
    case 'ScoreReview':     return 'Revue score';
    case 'OwnerHandover':   return 'Passation';
    case 'ManualDispatch':  return 'Dispatch manuel';
    case 'Generic':         return 'Générique';
    default:                return type ?? '—';
  }
}

@Component({
  selector: 'lead-taches',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, TimeagoPipe, Button],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4 border-b border-slate-100 flex items-center justify-between">
            <div>
              <p class="font-semibold text-slate-800">Tâches</p>
              <p class="text-sm text-slate-500 mt-0.5">Tâches liées à ce lead</p>
            </div>
            @if (tasks().length > 0) {
              <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums">
                {{ tasks().length }}
              </span>
            }
          </div>

          @if (tasks().length === 0) {
            <div class="flex flex-col items-center justify-center py-16 text-center">
              <tas-icon iconName="feather:check-square" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400">Aucune tâche liée à ce lead</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (task of tasks(); track task.id) {
                <div class="p-4 hover:bg-slate-50 transition-colors">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <p class="text-sm font-medium text-slate-800 truncate">{{ task.title ?? typeLabel(task.type) }}</p>
                        <tas-tag [severity]="statusMeta(task.status).severity">
                          {{ statusMeta(task.status).label }}
                        </tas-tag>
                      </div>
                      @if (task.description) {
                        <p class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ task.description }}</p>
                      }
                      <div class="flex items-center gap-3 mt-2">
                        <span class="text-xs text-slate-400 flex items-center gap-1">
                          <tas-icon iconName="feather:tag" style="font-size:10px"></tas-icon>
                          {{ typeLabel(task.type) }}
                        </span>
                        <tas-tag [severity]="priorityMeta(task.priority).severity">
                          {{ priorityMeta(task.priority).label }}
                        </tas-tag>
                        @if (task.dueAt) {
                          <span class="text-xs text-slate-400 flex items-center gap-1">
                            <tas-icon iconName="feather:calendar" style="font-size:10px"></tas-icon>
                            {{ task.dueAt | dateTimeAgo }}
                          </span>
                        }
                      </div>
                    </div>

                    @if (task.status === 'Pending') {
                      <button
                        tas-outlined-button
                        color="primary"
                        type="button"
                        class="shrink-0"
                        (click)="startTask(task)"
                        [disabled]="actionInProgress() === task.id"
                      >
                        Démarrer
                      </button>
                    }
                    @if (task.status === 'InProgress') {
                      <button
                        tas-outlined-button
                        color="primary"
                        type="button"
                        class="shrink-0"
                        (click)="completeTask(task)"
                        [disabled]="actionInProgress() === task.id"
                      >
                        Terminer
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </tas-card>
      </div>
    }
  `,
})
export class LeadTachesPage {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly id = input.required<string>();
  public readonly statusMeta = statusMeta;
  public readonly priorityMeta = priorityMeta;
  public readonly typeLabel = typeLabel;

  public isLoading = signal(true);
  public tasks = signal<CrmTaskDto[]>([]);
  public actionInProgress = signal<string | null>(null);

  constructor() {
    effect(() => {
      this._loadTasks();
    });
  }

  public startTask(task: CrmTaskDto): void {
    if (!task.id) return;
    this.actionInProgress.set(task.id);
    this._tasksApi.startCrmTask(task.id).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de démarrer la tâche.');
        this.actionInProgress.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Tâche démarrée', 'La tâche est maintenant en cours.');
      this.actionInProgress.set(null);
      this._loadTasks();
    });
  }

  public completeTask(task: CrmTaskDto): void {
    if (!task.id) return;
    this.actionInProgress.set(task.id);
    this._tasksApi.completeCrmTask(task.id).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de terminer la tâche.');
        this.actionInProgress.set(null);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Tâche terminée', 'La tâche a été complétée.');
      this.actionInProgress.set(null);
      this._loadTasks();
    });
  }

  private _loadTasks(): void {
    this.isLoading.set(true);
    this._tasksApi.listCrmTasks(this.id()).pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((tasks) => {
      this.tasks.set(tasks ?? []);
      this.isLoading.set(false);
    });
  }
}

export default LeadTachesPage;
