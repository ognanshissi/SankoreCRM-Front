import { Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, EMPTY, forkJoin, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  TasksApiService,
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  WorkflowInstancesApiService,
  MyStepDto,
  CompletedTaskDto,
  ApproveStepRequest,
  RejectStepRequest,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
import {
  computeSla,
  priorityMeta,
  SlaInfo,
  statusMeta,
  typeLabel,
} from './task-meta';
import { CompleteTaskDrawer } from './complete-task-drawer';
import { DeclineTaskDrawer } from './decline-task-drawer';
import { TaskDetailDrawer, TaskDetailDrawerResult } from './task-detail-drawer';

// ——— Queue metadata ———

const COMPLETED_STATUS_META: Record<string, { label: string; severity: Severity }> = {
  Approved: { label: 'Approuvé', severity: 'success' }, Rejected: { label: 'Rejeté', severity: 'error' },
  TimedOut: { label: 'Expiré', severity: 'warning' }, Cancelled: { label: 'Annulé', severity: 'neutral' },
  Skipped: { label: 'Sauté', severity: 'neutral' },
};
function completedStatusMeta(status: string | null | undefined) {
  return COMPLETED_STATUS_META[status ?? ''] ?? { label: status ?? '—', severity: 'neutral' as Severity };
}

// ——— Types ———

type MainTab = 'tasks' | 'queue' | 'done';
type FilterTab = 'all' | 'overdue' | 'today' | 'upcoming';

const KANBAN_STATUSES = [
  { key: 'overdue', label: 'En retard', color: '#ef4444' },
  { key: 'Pending', label: 'En attente', color: '#94a3b8' },
  { key: 'InProgress', label: 'En cours', color: '#3b82f6' },
  { key: 'Completed', label: 'Terminées', color: '#22c55e' },
];

@Component({
  templateUrl: './dashboard.html',
  imports: [NgClass, FormsModule, TasCard, TasSpinner, TasIcon, TasTag, TimeagoPipe, Button],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _workflowApi = inject(WorkflowInstancesApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly statusMeta = statusMeta;
  public readonly priorityMeta = priorityMeta;
  public readonly typeLabel = typeLabel;
  public readonly kanbanStatuses = KANBAN_STATUSES;
  public readonly completedStatusMeta = completedStatusMeta;

  // ——— Shared state ———
  public mainTab = signal<MainTab>('tasks');
  public now = signal(Date.now());
  private _tickTimer: ReturnType<typeof setInterval> | null = null;

  // ——— Tasks state ———
  public isLoading = signal(true);
  public allTasks = signal<CrmTaskDto[]>([]);
  public viewMode = signal<'list' | 'kanban'>('list');
  public activeFilter = signal<FilterTab>('all');
  public actionInProgress = signal<string | null>(null);

  public readonly openTasks = computed(() =>
    this.allTasks().filter((t) => t.status === CrmTaskDtoStatusEnum.Pending || t.status === CrmTaskDtoStatusEnum.InProgress),
  );
  public readonly filteredTasks = computed(() => {
    const filter = this.activeFilter(); const tasks = this.allTasks(); const n = this.now();
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999); const te = todayEnd.getTime();
    switch (filter) {
      case 'overdue': return tasks.filter((t) => { if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false; const dl = t.slaDeadline ?? t.dueAt; return dl && new Date(dl).getTime() < n; });
      case 'today': return tasks.filter((t) => { if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false; const dl = t.slaDeadline ?? t.dueAt; return dl && new Date(dl).getTime() <= te; });
      case 'upcoming': return tasks.filter((t) => { if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false; const dl = t.slaDeadline ?? t.dueAt; return dl && new Date(dl).getTime() > te; });
      default: return tasks;
    }
  });
  public readonly overdueCount = computed(() => { const n = this.now(); return this.openTasks().filter((t) => { const dl = t.slaDeadline ?? t.dueAt; return dl && new Date(dl).getTime() < n; }).length; });
  public readonly todayCount = computed(() => { const n = this.now(); const te = new Date(); te.setHours(23,59,59,999); return this.openTasks().filter((t) => { const dl = t.slaDeadline ?? t.dueAt; if (!dl) return false; const d = new Date(dl).getTime(); return d >= n && d <= te.getTime(); }).length; });

  public readonly filterTabs: { key: FilterTab; label: string; count: () => number }[] = [
    { key: 'all', label: 'Toutes', count: () => this.allTasks().length },
    { key: 'overdue', label: 'En retard', count: () => this.overdueCount() },
    { key: 'today', label: "Aujourd'hui", count: () => this.todayCount() },
    { key: 'upcoming', label: 'À venir', count: () => this.openTasks().length - this.overdueCount() - this.todayCount() },
  ];

  // ——— Queue state (from Ma file) ———
  public queueLoading = signal(true);
  public queueSteps = signal<MyStepDto[]>([]);
  public expandedStepId = signal<string | null>(null);
  public queueActionType = signal<'approve' | 'reject' | null>(null);
  public actingOnStepId = signal<string | null>(null);
  public navigatingStepId = signal<string | null>(null);
  public actionComment = '';

  /** Map instanceId → entity context resolved from WorkflowInstanceDto */
  public queueEntityMap = signal<Map<string, { entityType: string; entityId: string; templateName: string }>>(new Map());

  public queueEntityInfo(step: MyStepDto): { entityType: string; entityId: string; templateName: string } | null {
    return this.queueEntityMap().get(step.instanceId ?? '') ?? null;
  }

  public navigateToEntity(entityType: string, entityId: string): void {
    if (entityType === 'Lead' || entityType === 'lead') {
      this._router.navigate(['/leads', entityId]);
    }
  }

  public readonly queueOverdueCount = computed(() => this.queueSteps().filter((s) => this.isQueueOverdue(s.dueAt)).length);
  public readonly sortedQueueSteps = computed(() =>
    [...this.queueSteps()].sort((a, b) => {
      const aO = this.isQueueOverdue(a.dueAt); const bO = this.isQueueOverdue(b.dueAt);
      if (aO !== bO) return aO ? -1 : 1;
      if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      if (a.dueAt) return -1; if (b.dueAt) return 1;
      return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
    }),
  );

  // ——— Done state ———
  public doneLoading = signal(false);
  public doneSteps = signal<CompletedTaskDto[]>([]);
  public doneTotalCount = signal(0);
  public doneHasNextPage = signal(false);
  public doneLoadingMore = signal(false);
  private _donePage = 1;

  // ——— Kanban helpers ———
  public kanbanTasks(columnKey: string): CrmTaskDto[] {
    const tasks = this.filteredTasks(); const n = this.now();
    if (columnKey === 'overdue') return tasks.filter((t) => { if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false; const dl = t.slaDeadline ?? t.dueAt; return dl && new Date(dl).getTime() < n; });
    return tasks.filter((t) => { if (columnKey === 'Completed') return t.status === CrmTaskDtoStatusEnum.Completed; if (t.status !== columnKey) return false; const dl = t.slaDeadline ?? t.dueAt; if (dl && new Date(dl).getTime() < n) return false; return true; });
  }
  public taskSla(task: CrmTaskDto): SlaInfo { return computeSla(task, this.now()); }

  // ——— Lifecycle ———
  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Ma journée' }]);
    this._loadTasks();
    this._loadQueue();
    this._tickTimer = setInterval(() => this.now.set(Date.now()), 30_000);
  }
  ngOnDestroy(): void { if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; } }

  // ——— Tab switching ———
  public setMainTab(tab: MainTab): void {
    this.mainTab.set(tab);
    if (tab === 'done' && this.doneSteps().length === 0 && !this.doneLoading()) this._loadDone(1);
  }
  public setViewMode(mode: 'list' | 'kanban'): void { this.viewMode.set(mode); }
  public setFilter(tab: FilterTab): void { this.activeFilter.set(tab); }

  // ——— Task actions ———
  public startTask(task: CrmTaskDto): void {
    if (!task.id) return;
    this.allTasks.update((list) => list.map((t) => t.id === task.id ? { ...t, status: CrmTaskDtoStatusEnum.InProgress, startedAt: new Date().toISOString() } : t));
    this._tasksApi.startCrmTask(task.id).pipe(catchError(() => { this.allTasks.update((list) => list.map((t) => t.id === task.id ? { ...t, status: CrmTaskDtoStatusEnum.Pending, startedAt: null } : t)); this._snackbar.error('Erreur', 'Impossible de démarrer.'); return EMPTY; })).subscribe();
  }
  public completeTask(task: CrmTaskDto): void {
    if (!task.id) return;
    const ref = this._sideDrawer.open(CompleteTaskDrawer, { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { task } });
    ref.closed.subscribe((result: any) => { if (result?.completed) this._loadTasks(); });
  }
  public declineTask(task: CrmTaskDto): void {
    if (!task.id) return;
    const ref = this._sideDrawer.open(DeclineTaskDrawer, { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { task } });
    ref.closed.subscribe((declined: any) => { if (declined) this.allTasks.update((list) => list.filter((t) => t.id !== task.id)); });
  }
  public navigateToLead(leadId: string | null | undefined): void { if (leadId) this._router.navigate(['/leads', leadId]); }

  /**
   * Détail d'une tâche. Le drawer n'exécute aucune action : il demande, et c'est ici qu'on rejoue les
   * parcours existants — sinon « Terminer » aurait deux implémentations, l'une avec résultat et tâche
   * de suivi, l'autre sans.
   */
  public openTaskDetail(task: CrmTaskDto): void {
    if (!task.id) return;
    // `open<R, D, C>` : le premier paramètre est le résultat, le troisième le composant — sans ce
    // dernier, la signature attend un `TasSideDrawer`.
    const ref = this._sideDrawer.open<TaskDetailDrawerResult, { task: CrmTaskDto }, TaskDetailDrawer>(
      TaskDetailDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { task },
      },
    );

    ref.closed.subscribe((result) => {
      if (!result) return;
      switch (result.action) {
        case 'start':
          this.startTask(result.task);
          break;
        case 'complete':
          this.completeTask(result.task);
          break;
        case 'decline':
          this.declineTask(result.task);
          break;
        case 'open-lead':
          this.navigateToLead(result.task.leadId);
          break;
      }
    });
  }

  // ——— Queue actions (from Ma file) ———
  public isQueueOverdue(dueAt: string | null | undefined): boolean { return !!dueAt && new Date(dueAt) < new Date(); }

  public openQueueAction(step: MyStepDto, type: 'approve' | 'reject'): void {
    this.actionComment = ''; this.queueActionType.set(type); this.expandedStepId.set(step.stepId ?? null);
  }
  public closeQueueAction(): void { this.expandedStepId.set(null); this.queueActionType.set(null); this.actionComment = ''; }

  public submitQueueAction(step: MyStepDto): void {
    if (!step.instanceId) return;
    const type = this.queueActionType(); if (!type) return;
    this.actingOnStepId.set(step.stepId ?? null);
    const comment = this.actionComment.trim() || null;
    const req$ = type === 'approve'
      ? this._workflowApi.approveWorkflowStep(step.instanceId, { comment } as ApproveStepRequest)
      : this._workflowApi.rejectWorkflowStep(step.instanceId, { comment } as RejectStepRequest);
    req$.subscribe({
      next: () => { this._snackbar.success('Succès', type === 'approve' ? 'Étape approuvée.' : 'Étape rejetée.'); this.actingOnStepId.set(null); this.closeQueueAction(); this.queueSteps.update((l) => l.filter((s) => s.stepId !== step.stepId)); },
      error: () => { this._snackbar.error('Erreur', 'Action échouée.'); this.actingOnStepId.set(null); },
    });
  }

  public navigateToQueueStep(step: MyStepDto | CompletedTaskDto): void {
    const instanceId = (step as any).instanceId; if (!instanceId) return;
    this.navigatingStepId.set((step as any).stepId ?? null);
    this._workflowApi.getWorkflowInstance(instanceId).subscribe({
      next: (inst: any) => { this.navigatingStepId.set(null); if (inst.templateId) this._router.navigate(['/settings/workflows', inst.templateId, 'instances', instanceId]); },
      error: () => { this.navigatingStepId.set(null); this._snackbar.error('Erreur', 'Impossible d\'ouvrir l\'instance.'); },
    });
  }

  // ——— Done actions ———
  public loadMoreDone(): void { this._loadDone(this._donePage + 1, true); }

  // ——— Private loaders ———
  private _loadTasks(): void {
    this.isLoading.set(true);
    const agentId = this._auth.connectedUser()?.id;
    this._tasksApi.listCrmTasks(undefined, agentId).pipe(catchError(() => { this.isLoading.set(false); return EMPTY; }))
      .subscribe((tasks) => { this.allTasks.set(tasks ?? []); this.isLoading.set(false); });
  }

  private _loadQueue(): void {
    this.queueLoading.set(true);
    this._workflowApi.listMySteps().pipe(catchError(() => { this.queueLoading.set(false); return EMPTY; }))
      .subscribe((steps: any) => {
        this.queueSteps.set(steps ?? []);
        this.queueLoading.set(false);
        this._resolveQueueEntities(steps ?? []);
      });
  }

  private _resolveQueueEntities(steps: MyStepDto[]): void {
    const instanceIds = [...new Set(steps.map((s) => s.instanceId).filter(Boolean) as string[])];
    if (instanceIds.length === 0) return;

    const calls = instanceIds.reduce((acc, id) => {
      acc[id] = this._workflowApi.getWorkflowInstance(id).pipe(catchError(() => of(null)));
      return acc;
    }, {} as Record<string, any>);

    forkJoin(calls).subscribe((results: any) => {
      const map = new Map<string, { entityType: string; entityId: string; templateName: string }>();
      for (const [instanceId, inst] of Object.entries(results)) {
        if (inst && (inst as any).entityId) {
          map.set(instanceId, {
            entityType: (inst as any).entityType ?? '',
            entityId: (inst as any).entityId ?? '',
            templateName: (inst as any).templateName ?? '',
          });
        }
      }
      this.queueEntityMap.set(map);
    });
  }

  private _loadDone(page: number, append = false): void {
    if (append) this.doneLoadingMore.set(true); else this.doneLoading.set(true);
    this._workflowApi.getMyCompletedTasks(page, 20).pipe(catchError(() => { this.doneLoading.set(false); this.doneLoadingMore.set(false); return EMPTY; }))
      .subscribe((result: any) => {
        this._donePage = page;
        const items = result.items ?? [];
        this.doneSteps.update((prev) => append ? [...prev, ...items] : items);
        this.doneTotalCount.set(result.totalCount ?? items.length);
        this.doneHasNextPage.set(result.hasNextPage ?? false);
        this.doneLoading.set(false); this.doneLoadingMore.set(false);
      });
  }
}
