import { Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { WorkflowInstanceDto, WorkflowInstancesApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { entityTypeLabel, instanceStatusMeta } from '../workflow-shared';

@Component({
  selector: 'workflow-instances',
  imports: [TasCard, Button, TasTag, TasSpinner, TasIcon, TimeagoPipe],
  template: `
    <div class="pb-6">
      <tas-card>
        <div class="p-4 border-b border-slate-100 mb-2">
          <p class="font-semibold text-slate-800">Instances récentes</p>
          <p class="text-sm text-slate-500 mt-0.5">
            Suivis en cours ou terminés démarrés à partir de ce modèle
          </p>
        </div>

        <div class="px-4 pb-4">
          @if (isLoading()) {
            <div class="flex justify-center py-10">
              <tas-spinner size="8" class="text-primary"></tas-spinner>
            </div>
          } @else if (instances().length === 0) {
            <p class="text-sm text-slate-400 py-6 text-center">
              Aucune instance n'a encore été démarrée pour ce modèle.
            </p>
          } @else {
            <div class="flex flex-col divide-y divide-slate-100">
              @for (instance of instances(); track instance.id) {
                <div
                  class="flex items-center justify-between gap-4 py-3 cursor-pointer hover:bg-slate-50 -mx-4 px-4 rounded transition-colors"
                  (click)="navigateToInstance(instance)"
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-slate-800">{{ entityTypeLabel(instance.entityType) }}</span>
                      <span class="text-xs text-slate-400 font-mono truncate">{{ instance.entityId }}</span>
                    </div>
                    <p class="text-xs text-slate-400 mt-0.5">
                      Étape {{ instance.currentStepOrder }}/{{ instance.totalSteps }} · Démarré {{ instance.startedAt! | dateTimeAgo }}
                    </p>
                  </div>
                  <div class="flex items-center gap-3 shrink-0">
                    <tas-tag [severity]="instanceStatusMeta(instance.status).severity">
                      {{ instanceStatusMeta(instance.status).label }}
                    </tas-tag>
                    @if (instance.status === 'InProgress') {
                      <button
                        tas-button
                        iconButton
                        type="button"
                        title="Annuler l'instance"
                        [disabled]="cancellingInstanceId() === instance.id"
                        (click)="cancelInstance(instance); $event.stopPropagation()"
                      >
                        <tas-icon iconName="feather:x-circle" iconSize="sm" class="text-functional-error"></tas-icon>
                      </button>
                    }
                    <tas-icon iconName="feather:chevron-right" class="text-slate-300" style="font-size:14px"></tas-icon>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </tas-card>
    </div>
  `,
})
export class WorkflowInstancesPage {
  private readonly _workflowInstancesApiService = inject(WorkflowInstancesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();
  public readonly entityTypeLabel = entityTypeLabel;
  public readonly instanceStatusMeta = instanceStatusMeta;

  public isLoading = signal(true);
  public cancellingInstanceId = signal<string | null>(null);
  public instances = signal<WorkflowInstanceDto[]>([]);

  constructor() {
    effect(() => {
      this._loadInstances();
    });
  }

  public navigateToInstance(instance: WorkflowInstanceDto): void {
    if (!instance.id) return;
    this._router.navigate(['/settings/workflows', this.id(), 'instances', instance.id]);
  }

  public cancelInstance(instance: WorkflowInstanceDto): void {
    if (!instance.id) return;

    this._confirmDialogService.confirm({
      title: "Annuler l'instance",
      message: `Le suivi en cours sur "${instance.entityType ?? 'cette entité'}" sera annulé. Continuer ?`,
      closable: true,
      acceptButtonProps: { label: "Annuler l'instance", theme: 'warn' },
      rejectButtonProps: { label: 'Retour' },
      accept: () => {
        this.cancellingInstanceId.set(instance.id!);
        this._workflowInstancesApiService
          .cancelWorkflowInstance(instance.id!)
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', "Impossible d'annuler l'instance.");
              this.cancellingInstanceId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Instance annulée avec succès.');
            this.cancellingInstanceId.set(null);
            this._loadInstances();
          });
      },
    });
  }

  private _loadInstances(): void {
    this.isLoading.set(true);
    this._workflowInstancesApiService.listWorkflowInstances().subscribe({
      next: (result) => {
        this.instances.set((result ?? []).filter((i) => i.templateId === this.id()));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }
}

export default WorkflowInstancesPage;
