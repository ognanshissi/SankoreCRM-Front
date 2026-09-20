import { Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
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
  CrmTaskDtoPriorityEnum,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
import { CompleteTaskDrawer } from './complete-task-drawer';
import { DeclineTaskDrawer } from './decline-task-drawer';

// ——— Status / Priority / Type metadata ———

function statusMeta(status: CrmTaskDtoStatusEnum | string | undefined): { label: string; severity: Severity } {
  switch (status) {
    case CrmTaskDtoStatusEnum.Pending:    return { label: 'En attente',  severity: 'neutral' };
    case CrmTaskDtoStatusEnum.InProgress: return { label: 'En cours',    severity: 'info' };
    case CrmTaskDtoStatusEnum.Completed:  return { label: 'Terminée',    severity: 'success' };
    case CrmTaskDtoStatusEnum.Cancelled:  return { label: 'Annulée',     severity: 'error' };
    default:                              return { label: '—',           severity: 'neutral' };
  }
}

function priorityMeta(priority: CrmTaskDtoPriorityEnum | string | undefined): { label: string; severity: Severity; icon: string } {
  switch (priority) {
    case CrmTaskDtoPriorityEnum.Low:      return { label: 'Basse',    severity: 'neutral',  icon: 'feather:arrow-down' };
    case CrmTaskDtoPriorityEnum.Medium:   return { label: 'Moyenne',  severity: 'info',     icon: 'feather:minus' };
    case CrmTaskDtoPriorityEnum.High:     return { label: 'Haute',    severity: 'warning',  icon: 'feather:arrow-up' };
    case CrmTaskDtoPriorityEnum.Critical: return { label: 'Critique', severity: 'error',    icon: 'feather:alert-triangle' };
    default:                              return { label: '—',        severity: 'neutral',  icon: 'feather:minus' };
  }
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

// ——— SLA helpers ———

interface SlaInfo {
  status: 'ok' | 'warning' | 'breach';
  label: string;
  icon: string;
  remainingMs: number;
}

function computeSla(task: CrmTaskDto, now: number): SlaInfo {
  const deadline = task.slaDeadline ?? task.dueAt;
  if (!deadline) return { status: 'ok', label: '', icon: '', remainingMs: Infinity };

  const deadlineMs = new Date(deadline).getTime();
  const diff = deadlineMs - now;

  if (diff < 0) {
    const breach = Math.abs(diff);
    return {
      status: 'breach',
      label: `En retard de ${formatDuration(breach)}`,
      icon: 'feather:alert-octagon',
      remainingMs: diff,
    };
  }

  const oneHour = 3_600_000;
  if (diff < oneHour) {
    return {
      status: 'warning',
      label: `${formatDuration(diff)} restant`,
      icon: 'feather:alert-triangle',
      remainingMs: diff,
    };
  }

  return {
    status: 'ok',
    label: `${formatDuration(diff)} restant`,
    icon: 'feather:clock',
    remainingMs: diff,
  };
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes > 0 ? `${hours}h${String(minutes).padStart(2, '0')}` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}j ${remHours}h` : `${days}j`;
}

// ——— Kanban columns ———

const KANBAN_STATUSES = [
  { key: 'overdue',     label: 'En retard',   color: '#ef4444' },
  { key: 'Pending',     label: 'En attente',  color: '#94a3b8' },
  { key: 'InProgress',  label: 'En cours',    color: '#3b82f6' },
  { key: 'Completed',   label: 'Terminées',   color: '#22c55e' },
];

// ——— Filter tabs ———

type FilterTab = 'all' | 'overdue' | 'today' | 'upcoming';

@Component({
  templateUrl: './dashboard.html',
  imports: [TasCard, TasSpinner, TasIcon, TasTag, TimeagoPipe, Button],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly statusMeta = statusMeta;
  public readonly priorityMeta = priorityMeta;
  public readonly typeLabel = typeLabel;
  public readonly kanbanStatuses = KANBAN_STATUSES;

  public isLoading = signal(true);
  public allTasks = signal<CrmTaskDto[]>([]);
  public viewMode = signal<'list' | 'kanban'>('list');
  public activeFilter = signal<FilterTab>('all');
  public actionInProgress = signal<string | null>(null);

  /** Ticks every 30s to refresh SLA countdowns */
  public now = signal(Date.now());
  private _tickTimer: ReturnType<typeof setInterval> | null = null;

  // ——— Computed views ———

  public readonly openTasks = computed(() =>
    this.allTasks().filter((t) =>
      t.status === CrmTaskDtoStatusEnum.Pending || t.status === CrmTaskDtoStatusEnum.InProgress,
    ),
  );

  public readonly filteredTasks = computed(() => {
    const filter = this.activeFilter();
    const tasks = this.allTasks();
    const now = this.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();

    switch (filter) {
      case 'overdue':
        return tasks.filter((t) => {
          if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false;
          const dl = t.slaDeadline ?? t.dueAt;
          return dl && new Date(dl).getTime() < now;
        });
      case 'today':
        return tasks.filter((t) => {
          if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false;
          const dl = t.slaDeadline ?? t.dueAt;
          return dl && new Date(dl).getTime() <= todayEndMs;
        });
      case 'upcoming':
        return tasks.filter((t) => {
          if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false;
          const dl = t.slaDeadline ?? t.dueAt;
          return dl && new Date(dl).getTime() > todayEndMs;
        });
      default:
        return tasks;
    }
  });

  public readonly overdueCount = computed(() => {
    const now = this.now();
    return this.openTasks().filter((t) => {
      const dl = t.slaDeadline ?? t.dueAt;
      return dl && new Date(dl).getTime() < now;
    }).length;
  });

  public readonly todayCount = computed(() => {
    const now = this.now();
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    return this.openTasks().filter((t) => {
      const dl = t.slaDeadline ?? t.dueAt;
      if (!dl) return false;
      const dlMs = new Date(dl).getTime();
      return dlMs >= now && dlMs <= todayEnd.getTime();
    }).length;
  });

  public readonly filterTabs: { key: FilterTab; label: string; count: () => number }[] = [
    { key: 'all',      label: 'Toutes',       count: () => this.allTasks().length },
    { key: 'overdue',  label: 'En retard',    count: () => this.overdueCount() },
    { key: 'today',    label: 'Aujourd\'hui',  count: () => this.todayCount() },
    { key: 'upcoming', label: 'À venir',      count: () => this.openTasks().length - this.overdueCount() - this.todayCount() },
  ];

  // ——— Kanban helpers ———

  public kanbanTasks(columnKey: string): CrmTaskDto[] {
    const tasks = this.filteredTasks();
    const now = this.now();

    if (columnKey === 'overdue') {
      return tasks.filter((t) => {
        if (t.status === CrmTaskDtoStatusEnum.Completed || t.status === CrmTaskDtoStatusEnum.Cancelled) return false;
        const dl = t.slaDeadline ?? t.dueAt;
        return dl && new Date(dl).getTime() < now;
      });
    }
    return tasks.filter((t) => {
      if (columnKey === 'Completed') return t.status === CrmTaskDtoStatusEnum.Completed;
      if (t.status !== columnKey) return false;
      // Exclude overdue from their normal column
      const dl = t.slaDeadline ?? t.dueAt;
      if (dl && new Date(dl).getTime() < now) return false;
      return true;
    });
  }

  // ——— SLA for a task ———

  public taskSla(task: CrmTaskDto): SlaInfo {
    return computeSla(task, this.now());
  }

  // ——— Lifecycle ———

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Ma journée' }]);
    this._loadTasks();
    this._tickTimer = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  // ——— Actions ———

  public setViewMode(mode: 'list' | 'kanban'): void {
    this.viewMode.set(mode);
  }

  public setFilter(tab: FilterTab): void {
    this.activeFilter.set(tab);
  }

  public startTask(task: CrmTaskDto): void {
    if (!task.id) return;

    // Optimistic update — switch to InProgress immediately
    this.allTasks.update((list) =>
      list.map((t) =>
        t.id === task.id
          ? { ...t, status: CrmTaskDtoStatusEnum.InProgress, startedAt: new Date().toISOString() }
          : t,
      ),
    );

    // Silent server confirmation
    this._tasksApi.startCrmTask(task.id).pipe(
      catchError(() => {
        // Rollback
        this.allTasks.update((list) =>
          list.map((t) =>
            t.id === task.id ? { ...t, status: CrmTaskDtoStatusEnum.Pending, startedAt: null } : t,
          ),
        );
        this._snackbar.error('Erreur', 'Impossible de démarrer la tâche. Elle a été remise en attente.');
        return EMPTY;
      }),
    ).subscribe();
  }

  public completeTask(task: CrmTaskDto): void {
    if (!task.id) return;

    const ref = this._sideDrawer.open(CompleteTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task },
    });

    ref.closed.subscribe((result) => {
      if (result && typeof result === 'object' && result.completed) {
        this._loadTasks();
      }
    });
  }

  public declineTask(task: CrmTaskDto): void {
    if (!task.id) return;

    const ref = this._sideDrawer.open(DeclineTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task },
    });

    ref.closed.subscribe((declined) => {
      if (declined) {
        // Remove immediately from local list
        this.allTasks.update((list) => list.filter((t) => t.id !== task.id));
      }
    });
  }

  public navigateToLead(leadId: string | null | undefined): void {
    if (leadId) this._router.navigate(['/leads', leadId]);
  }

  private _loadTasks(): void {
    this.isLoading.set(true);
    const agentId = this._auth.connectedUser()?.id;
    this._tasksApi.listCrmTasks(undefined, agentId).pipe(
      catchError(() => { this.isLoading.set(false); return EMPTY; }),
    ).subscribe((tasks) => {
      this.allTasks.set(tasks ?? []);
      this.isLoading.set(false);
    });
  }
}
