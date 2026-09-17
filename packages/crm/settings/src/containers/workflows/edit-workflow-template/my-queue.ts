import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { TasCard } from '@talisoft/ui/card';
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
  imports: [NgClass, TasCard, TasSpinner, TasIcon, TimeagoPipe],
  template: `
    <div class="pb-6">
      <!-- Header -->
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-lg font-semibold text-slate-800">Ma file d'attente</h2>
          <p class="text-sm text-slate-500 mt-0.5">Étapes qui vous sont assignées et en attente d'action.</p>
        </div>
        @if (!isLoading() && steps().length > 0) {
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-sm text-slate-400">{{ steps().length }} tâche{{ steps().length > 1 ? 's' : '' }}</span>
            @if (overdueCount() > 0) {
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                <tas-icon iconName="feather:alert-circle" style="font-size:10px"></tas-icon>
                {{ overdueCount() }} en retard
              </span>
            }
          </div>
        }
      </div>

      <!-- Overdue alert banner -->
      @if (!isLoading() && overdueCount() > 0) {
        <div class="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50 mb-4">
          <tas-icon iconName="feather:alert-triangle" class="text-red-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
          <p class="text-sm text-red-700">
            <strong>{{ overdueCount() }} étape{{ overdueCount() > 1 ? 's sont' : ' est' }} en retard.</strong>
            Traitez-les en priorité pour respecter les délais.
          </p>
        </div>
      }

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
            @for (step of sortedSteps(); track step.stepId) {
              @let overdue = isOverdue(step.dueAt);
              <div
                class="flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors"
                [ngClass]="overdue ? 'bg-red-50/40 hover:bg-red-50' : 'hover:bg-slate-50'"
                (click)="navigateToStep(step)"
              >
                <!-- Step icon -->
                <div
                  class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center ring-2"
                  [ngClass]="overdue
                    ? 'bg-red-100 ring-red-400'
                    : 'bg-amber-100 ring-amber-300'"
                >
                  <tas-icon
                    [iconName]="overdue ? 'feather:alert-circle' : 'feather:clock'"
                    [ngClass]="overdue ? 'text-red-600' : 'text-amber-600'"
                    style="font-size:14px"
                  ></tas-icon>
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="text-sm font-medium text-slate-800 truncate">{{ step.stepName ?? '—' }}</p>
                    @if (overdue) {
                      <span class="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">
                        <tas-icon iconName="feather:clock" style="font-size:9px"></tas-icon>
                        En retard
                      </span>
                    }
                  </div>
                  <div class="flex items-center gap-3 mt-0.5 flex-wrap">
                    @if (step.approverRoleCode) {
                      <span class="text-xs text-slate-400 inline-flex items-center gap-1">
                        <tas-icon iconName="feather:users" style="font-size:10px"></tas-icon>
                        {{ step.approverRoleCode }}
                      </span>
                    }
                    @if (step.dueAt) {
                      <span
                        class="text-xs inline-flex items-center gap-1"
                        [ngClass]="overdue ? 'text-red-600 font-medium' : 'text-amber-600'"
                      >
                        <tas-icon iconName="feather:calendar" style="font-size:10px"></tas-icon>
                        {{ overdue ? 'Échéance dépassée' : 'Échéance' }} {{ step.dueAt | dateTimeAgo }}
                      </span>
                    }
                    @if (step.createdAt) {
                      <span class="text-xs text-slate-400">Reçu {{ step.createdAt | dateTimeAgo }}</span>
                    }
                  </div>
                </div>

                <!-- Nav indicator -->
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

  public readonly overdueCount = computed(
    () => this.steps().filter((s) => this.isOverdue(s.dueAt)).length,
  );

  /** Overdue first (by dueAt asc), then with dueAt (by dueAt asc), then rest (by createdAt desc). */
  public readonly sortedSteps = computed(() =>
    [...this.steps()].sort((a, b) => {
      const aOver = this.isOverdue(a.dueAt);
      const bOver = this.isOverdue(b.dueAt);
      if (aOver !== bOver) return aOver ? -1 : 1;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt) return -1;
      if (b.dueAt) return 1;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    }),
  );

  public isOverdue(dueAt: string | null | undefined): boolean {
    return !!dueAt && new Date(dueAt) < new Date();
  }

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
