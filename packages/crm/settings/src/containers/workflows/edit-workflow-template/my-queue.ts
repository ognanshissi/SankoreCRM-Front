import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  ApproveStepRequest,
  CompletedTaskDto,
  MyStepDto,
  RejectStepRequest,
  WorkflowInstancesApiService,
} from '@sankore/crm-api';

const COMPLETED_STATUS_META: Record<string, { label: string; severity: 'success' | 'error' | 'warning' | 'neutral' }> = {
  Approved:  { label: 'Approuvé',  severity: 'success'  },
  Rejected:  { label: 'Rejeté',   severity: 'error'    },
  TimedOut:  { label: 'Expiré',   severity: 'warning'  },
  Cancelled: { label: 'Annulé',   severity: 'neutral'  },
  Skipped:   { label: 'Sauté',    severity: 'neutral'  },
};

function completedStatusMeta(status: string | null | undefined) {
  return COMPLETED_STATUS_META[status ?? ''] ?? { label: status ?? '—', severity: 'neutral' as const };
}

@Component({
  selector: 'workflow-my-queue',
  imports: [NgClass, FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TimeagoPipe],
  template: `
    <div class="pb-6">
      <!-- Header -->
      <div class="flex items-start justify-between mb-4">
        <div>
          <h2 class="text-lg font-semibold text-slate-800">Ma file d'attente</h2>
          <p class="text-sm text-slate-500 mt-0.5">Étapes assignées et historique de vos actions.</p>
        </div>
        @if (!isLoading() && activeTab() === 'pending' && steps().length > 0) {
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

      <!-- Tabs -->
      <div class="flex items-center gap-1 mb-4 p-1 rounded-lg bg-slate-100 w-fit">
        <button
          type="button"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          [class.bg-white]="activeTab() === 'pending'"
          [class.text-slate-800]="activeTab() === 'pending'"
          [class.shadow-sm]="activeTab() === 'pending'"
          [class.text-slate-500]="activeTab() !== 'pending'"
          (click)="setTab('pending')"
        >
          En attente
          @if (steps().length > 0) {
            <span class="ml-1.5 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full"
              [class.bg-primary]="activeTab() === 'pending'"
              [class.text-white]="activeTab() === 'pending'"
              [class.bg-slate-200]="activeTab() !== 'pending'"
              [class.text-slate-600]="activeTab() !== 'pending'"
            >{{ steps().length }}</span>
          }
        </button>
        <button
          type="button"
          class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          [class.bg-white]="activeTab() === 'done'"
          [class.text-slate-800]="activeTab() === 'done'"
          [class.shadow-sm]="activeTab() === 'done'"
          [class.text-slate-500]="activeTab() !== 'done'"
          (click)="setTab('done')"
        >
          Terminé
          @if (doneTotalCount() > 0) {
            <span class="ml-1.5 text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full"
              [class.bg-primary]="activeTab() === 'done'"
              [class.text-white]="activeTab() === 'done'"
              [class.bg-slate-200]="activeTab() !== 'done'"
              [class.text-slate-600]="activeTab() !== 'done'"
            >{{ doneTotalCount() }}</span>
          }
        </button>
      </div>

      <!-- ── Pending tab ───────────────────────────────────────────────────── -->
      @if (activeTab() === 'pending') {

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
          <div class="flex flex-col gap-3">
            @for (step of sortedSteps(); track step.stepId) {
              @let overdue = isOverdue(step.dueAt);
              @let isExpanded = expandedStepId() === step.stepId;
              @let isActing = actingOnStepId() === step.stepId;

            <tas-card>
              <!-- Step row -->
              <div
                class="flex items-center gap-4 px-4 py-3 transition-colors"
                [ngClass]="overdue ? 'bg-red-50/40' : ''"
              >
                <!-- Step icon -->
                <div
                  class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center ring-2"
                  [ngClass]="overdue ? 'bg-red-100 ring-red-400' : 'bg-amber-100 ring-amber-300'"
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

                <!-- Actions -->
                <div class="flex items-center gap-1.5 shrink-0">
                  <button
                    tas-raised-button
                    color="primary"
                    type="button"
                    size="small"
                    [disabled]="isActing"
                    (click)="openAction(step, 'approve')"
                  >
                    <tas-icon iconName="feather:check" style="font-size:12px"></tas-icon>
                    Approuver
                  </button>
                  <button
                    tas-outlined-button
                    color="warn"
                    type="button"
                    size="small"
                    [disabled]="isActing"
                    (click)="openAction(step, 'reject')"
                  >
                    <tas-icon iconName="feather:x" style="font-size:12px"></tas-icon>
                    Rejeter
                  </button>
                  <button
                    tas-button
                    iconButton
                    type="button"
                    size="small"
                    title="Voir l'instance"
                    [disabled]="navigatingStepId() === step.stepId"
                    (click)="navigateToStep(step)"
                  >
                    @if (navigatingStepId() === step.stepId) {
                      <tas-spinner size="4" class="text-primary"></tas-spinner>
                    } @else {
                      <tas-icon iconName="feather:external-link" style="font-size:13px"></tas-icon>
                    }
                  </button>
                </div>
              </div>

              <!-- Inline action form -->
              @if (isExpanded) {
                <div
                  class="mx-4 mb-4 mt-1 p-3 rounded-lg border"
                  [ngClass]="actionType() === 'approve'
                    ? 'border-green-200 bg-green-50'
                    : 'border-red-200 bg-red-50'"
                >
                  <p
                    class="text-sm font-medium mb-2"
                    [ngClass]="actionType() === 'approve' ? 'text-green-800' : 'text-red-800'"
                  >
                    {{ actionType() === 'approve' ? 'Confirmer l\'approbation' : 'Confirmer le rejet' }}
                  </p>
                  <textarea
                    class="w-full px-2.5 py-1.5 text-sm border rounded-md bg-white focus:outline-none focus:ring-1 resize-none"
                    [ngClass]="actionType() === 'approve'
                      ? 'border-green-200 focus:ring-green-400'
                      : 'border-red-200 focus:ring-red-400'"
                    rows="2"
                    [placeholder]="actionType() === 'approve' ? 'Commentaire (optionnel)' : 'Motif du rejet (optionnel)'"
                    [(ngModel)]="actionComment"
                  ></textarea>
                  <div class="flex items-center gap-2 mt-2">
                    <button
                      tas-button
                      type="button"
                      size="small"
                      [ngClass]="actionType() === 'approve' ? '' : 'text-red-600'"
                      [disabled]="isActing"
                      (click)="submitAction(step)"
                    >
                      @if (isActing) {
                        <tas-spinner size="4"></tas-spinner>
                      }
                      {{ actionType() === 'approve' ? 'Approuver' : 'Rejeter' }}
                    </button>
                    <button
                      tas-outlined-button
                      type="button"
                      size="small"
                      [disabled]="isActing"
                      (click)="closeAction()"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              }
            </tas-card>
          }
          </div>
        }

      }

      <!-- ── Done tab ──────────────────────────────────────────────────────── -->
      @if (activeTab() === 'done') {

        @if (isDoneLoading()) {
          <div class="flex justify-center py-16">
            <tas-spinner size="8" class="text-primary"></tas-spinner>
          </div>
        } @else if (doneSteps().length === 0) {
          <tas-card>
            <div class="p-12 flex flex-col items-center gap-2 text-center">
              <tas-icon iconName="feather:clock" class="text-slate-300" style="font-size:40px"></tas-icon>
              <p class="text-base font-medium text-slate-700 mt-2">Aucune action effectuée</p>
              <p class="text-sm text-slate-400">Votre historique de validation apparaîtra ici.</p>
            </div>
          </tas-card>
        } @else {
          <div class="flex flex-col gap-3">
            @for (task of doneSteps(); track task.stepId) {
              @let meta = completedStatusMeta(task.status);
              <tas-card>
                <div class="flex items-start gap-4 px-4 py-3">
                  <!-- Icon -->
                  <div
                    class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center ring-2 mt-0.5"
                    [ngClass]="task.status === 'Approved'
                      ? 'bg-green-100 ring-green-300'
                      : task.status === 'Rejected'
                        ? 'bg-red-100 ring-red-300'
                        : 'bg-slate-100 ring-slate-200'"
                  >
                    <tas-icon
                      [iconName]="task.status === 'Approved' ? 'feather:check' : task.status === 'Rejected' ? 'feather:x' : 'feather:minus'"
                      [ngClass]="task.status === 'Approved' ? 'text-green-600' : task.status === 'Rejected' ? 'text-red-500' : 'text-slate-400'"
                      style="font-size:14px"
                    ></tas-icon>
                  </div>

                  <!-- Info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <p class="text-sm font-medium text-slate-800 truncate">{{ task.stepName ?? '—' }}</p>
                      <tas-tag [severity]="meta.severity">{{ meta.label }}</tas-tag>
                    </div>
                    <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-400">
                      @if (task.templateName) {
                        <span class="truncate max-w-[160px]">{{ task.templateName }}</span>
                      }
                      @if (task.entityType) {
                        <span>{{ task.entityType }} · <span class="font-mono">{{ task.entityId }}</span></span>
                      }
                      @if (task.stepOrder != null) {
                        <span>Étape {{ task.stepOrder }}</span>
                      }
                    </div>
                    @if (task.comment) {
                      <p class="text-xs text-slate-500 italic mt-1">"{{ task.comment }}"</p>
                    }
                    @if (task.completedAt) {
                      <p class="text-xs text-slate-400 mt-1">{{ task.completedAt | dateTimeAgo }}</p>
                    }
                  </div>

                  <!-- Link to instance -->
                  <button
                    tas-button
                    iconButton
                    type="button"
                    size="small"
                    title="Voir l'instance"
                    [disabled]="navigatingStepId() === task.stepId"
                    (click)="navigateToDoneTask(task)"
                  >
                    @if (navigatingStepId() === task.stepId) {
                      <tas-spinner size="4" class="text-primary"></tas-spinner>
                    } @else {
                      <tas-icon iconName="feather:external-link" style="font-size:13px"></tas-icon>
                    }
                  </button>
                </div>
              </tas-card>
            }

            <!-- Load more -->
            @if (doneHasNextPage()) {
              <div class="flex justify-center pt-2">
                <button
                  tas-outlined-button
                  color="primary"
                  type="button"
                  [disabled]="isDoneLoadingMore()"
                  [isLoading]="isDoneLoadingMore()"
                  (click)="loadMoreDone()"
                >
                  Charger plus
                </button>
              </div>
            }
          </div>
        }

      }

    </div>
  `,
})
export class WorkflowMyQueuePage implements OnInit {
  private readonly _api = inject(WorkflowInstancesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly completedStatusMeta = completedStatusMeta;

  // ── Pending tab ────────────────────────────────────────────────────────────
  public readonly isLoading = signal(true);
  public readonly steps = signal<MyStepDto[]>([]);
  public readonly navigatingStepId = signal<string | null>(null);
  public readonly expandedStepId = signal<string | null>(null);
  public readonly actionType = signal<'approve' | 'reject' | null>(null);
  public readonly actingOnStepId = signal<string | null>(null);
  public actionComment = '';

  // ── Done tab ───────────────────────────────────────────────────────────────
  public readonly activeTab = signal<'pending' | 'done'>('pending');
  public readonly doneSteps = signal<CompletedTaskDto[]>([]);
  public readonly doneTotalCount = signal(0);
  public readonly isDoneLoading = signal(false);
  public readonly isDoneLoadingMore = signal(false);
  public readonly doneHasNextPage = signal(false);
  private _donePage = 1;
  private readonly _donePageSize = 20;

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

  public setTab(tab: 'pending' | 'done'): void {
    this.activeTab.set(tab);
    if (tab === 'done' && this.doneSteps().length === 0 && !this.isDoneLoading()) {
      this._loadDone(1);
    }
  }

  public loadMoreDone(): void {
    this._loadDone(this._donePage + 1, true);
  }

  private _loadDone(page: number, append = false): void {
    if (append) {
      this.isDoneLoadingMore.set(true);
    } else {
      this.isDoneLoading.set(true);
    }
    this._api.getMyCompletedTasks(page, this._donePageSize).subscribe({
      next: (result) => {
        this._donePage = page;
        const items = result.items ?? [];
        this.doneSteps.update((prev) => append ? [...prev, ...items] : items);
        this.doneTotalCount.set(result.totalCount ?? items.length);
        this.doneHasNextPage.set(result.hasNextPage ?? false);
        this.isDoneLoading.set(false);
        this.isDoneLoadingMore.set(false);
      },
      error: () => {
        this._snackbar.error('Erreur', 'Impossible de charger l\'historique.');
        this.isDoneLoading.set(false);
        this.isDoneLoadingMore.set(false);
      },
    });
  }

  public navigateToDoneTask(task: CompletedTaskDto): void {
    if (!task.instanceId) return;
    this.navigatingStepId.set(task.stepId ?? null);
    this._api.getWorkflowInstance(task.instanceId).subscribe({
      next: (instance) => {
        this.navigatingStepId.set(null);
        if (!instance.templateId) {
          this._snackbar.error('Erreur', 'Template introuvable pour cette instance.');
          return;
        }
        this._router.navigate(['/settings/workflows', instance.templateId, 'instances', task.instanceId]);
      },
      error: () => {
        this.navigatingStepId.set(null);
        this._snackbar.error('Erreur', 'Impossible d\'ouvrir l\'instance.');
      },
    });
  }

  public openAction(step: MyStepDto, type: 'approve' | 'reject'): void {
    this.actionComment = '';
    this.actionType.set(type);
    this.expandedStepId.set(step.stepId ?? null);
  }

  public closeAction(): void {
    this.expandedStepId.set(null);
    this.actionType.set(null);
    this.actionComment = '';
  }

  public submitAction(step: MyStepDto): void {
    if (!step.instanceId) return;
    const type = this.actionType();
    if (!type) return;

    this.actingOnStepId.set(step.stepId ?? null);
    const comment = this.actionComment.trim() || null;
    const request$ = type === 'approve'
      ? this._api.approveWorkflowStep(step.instanceId, { comment } as ApproveStepRequest)
      : this._api.rejectWorkflowStep(step.instanceId, { comment } as RejectStepRequest);

    request$.subscribe({
      next: () => {
        this._snackbar.success(
          'Succès',
          type === 'approve' ? 'Étape approuvée.' : 'Étape rejetée.',
        );
        this.actingOnStepId.set(null);
        this.closeAction();
        this.steps.update((list) => list.filter((s) => s.stepId !== step.stepId));
      },
      error: () => {
        this._snackbar.error('Erreur', type === 'approve' ? "Impossible d'approuver." : 'Impossible de rejeter.');
        this.actingOnStepId.set(null);
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
