import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TasCard } from '@talisoft/ui/card';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  MyStepDto,
  WorkflowInstancesApiService,
} from '@sankore/crm-api';

@Component({
  selector: 'workflow-my-queue',
  imports: [TasCard, TasSpinner, TasIcon, TimeagoPipe],
  template: `
    <div class="pb-6">
      <div class="mb-4">
        <h2 class="text-lg font-semibold text-slate-800">Ma file d'attente</h2>
        <p class="text-sm text-slate-500 mt-0.5">Étapes qui vous sont assignées et en attente d'action.</p>
      </div>

      @if (isLoading()) {
        <div class="flex justify-center py-16">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else if (steps().length === 0) {
        <tas-card>
          <div class="p-12 flex flex-col items-center gap-2 text-center">
            <tas-icon iconName="feather:check-circle" class="text-green-400" style="font-size:40px"></tas-icon>
            <p class="text-base font-medium text-slate-700 mt-2">Aucune étape en attente</p>
            <p class="text-sm text-slate-400">Vous n'avez aucune étape à traiter pour le moment.</p>
          </div>
        </tas-card>
      } @else {
        <tas-card>
          <div class="divide-y divide-slate-100">
            @for (step of steps(); track step.stepId) {
              <div
                class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                (click)="navigateToStep(step)"
              >
                <!-- Step icon -->
                <div class="shrink-0 w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center ring-2 ring-amber-300">
                  <tas-icon iconName="feather:clock" class="text-amber-600" style="font-size:14px"></tas-icon>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-slate-800 truncate">{{ step.stepName ?? '—' }}</p>
                  <div class="flex items-center gap-3 mt-0.5">
                    @if (step.approverRoleCode) {
                      <span class="text-xs text-slate-400">
                        <tas-icon iconName="feather:users" class="inline-block" style="font-size:10px"></tas-icon>
                        {{ step.approverRoleCode }}
                      </span>
                    }
                    @if (step.dueAt) {
                      <span class="text-xs text-amber-600">
                        <tas-icon iconName="feather:calendar" class="inline-block" style="font-size:10px"></tas-icon>
                        Échéance {{ step.dueAt | dateTimeAgo }}
                      </span>
                    }
                    @if (step.createdAt) {
                      <span class="text-xs text-slate-400">Reçu {{ step.createdAt | dateTimeAgo }}</span>
                    }
                  </div>
                </div>

                <!-- Loading indicator for this step -->
                @if (navigatingStepId() === step.stepId) {
                  <tas-spinner size="4" class="text-primary shrink-0"></tas-spinner>
                } @else {
                  <tas-icon iconName="feather:chevron-right" class="text-slate-300 shrink-0" style="font-size:16px"></tas-icon>
                }
              </div>
            }
          </div>
        </tas-card>
      }
    </div>
  `,
})
export class WorkflowMyQueuePage implements OnInit {
  private readonly _api = inject(WorkflowInstancesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly isLoading = signal(true);
  public readonly steps = signal<MyStepDto[]>([]);
  public readonly navigatingStepId = signal<string | null>(null);

  ngOnInit(): void {
    this._api.listMySteps().subscribe({
      next: (result) => {
        this.steps.set(result ?? []);
        this.isLoading.set(false);
      },
      error: () => {
        this._snackbar.error('Erreur', 'Impossible de charger la file d\'attente.');
        this.isLoading.set(false);
      },
    });
  }

  public navigateToStep(step: MyStepDto): void {
    if (!step.instanceId) return;
    this.navigatingStepId.set(step.stepId ?? null);
    // MyStepDto has no templateId — fetch instance to resolve it
    this._api.getWorkflowInstance(step.instanceId).subscribe({
      next: (instance) => {
        this.navigatingStepId.set(null);
        const templateId = instance.templateId;
        if (!templateId) {
          this._snackbar.error('Erreur', 'Template introuvable pour cette instance.');
          return;
        }
        this._router.navigate(['/settings/workflows', templateId, 'instances', step.instanceId]);
      },
      error: () => {
        this.navigatingStepId.set(null);
        this._snackbar.error('Erreur', 'Impossible d\'ouvrir l\'instance.');
      },
    });
  }
}

export default WorkflowMyQueuePage;
