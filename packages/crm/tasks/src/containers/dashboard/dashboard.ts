import { Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY, forkJoin, map, of } from 'rxjs';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  AgenciesApiService,
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  LeadDto,
  LeadsApiService,
  TasksApiService,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
import { computeDue, leadDisplayName, taskActionLabel, workStatusLabel } from './task-meta';
import { TaskWorkPanel } from './task-work-panel';
import { ReassignTaskDrawer, ReassignTaskDrawerData } from './reassign-task-drawer';
import { ApprovalItem, MyApprovalsService } from './my-approvals.service';
import { ApprovalsList } from './approvals-list';

type TaskTab = 'todo' | 'overdue' | 'done' | 'approvals';

function deadlineOf(task: CrmTaskDto): number {
  const d = task.slaDeadline ?? task.dueAt;
  return d ? new Date(d).getTime() : Infinity;
}

@Component({
  templateUrl: './dashboard.html',
  imports: [TasTable, TaskWorkPanel, ApprovalsList],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _approvalsService = inject(MyApprovalsService);

  public readonly computeDue = computeDue;
  public readonly taskActionLabel = taskActionLabel;
  public readonly workStatusLabel = workStatusLabel;

  public now = signal(Date.now());
  private _tickTimer: ReturnType<typeof setInterval> | null = null;

  public isLoading = signal(true);
  public allTasks = signal<CrmTaskDto[]>([]);
  public leads = signal<Map<string, LeadDto>>(new Map());
  public activeTab = signal<TaskTab>('todo');
  public selectedTaskId = signal<string | null>(null);
  public agencyName = signal('');

  /** Ce qui attend la signature de l'utilisateur, chargé avec la page pour que l'onglet affiche son compte. */
  public approvals = signal<ApprovalItem[]>([]);
  public kycAwaitingTotal = signal(0);
  public isApprovalsLoading = signal(true);
  public readonly approvalsCount = computed(
    () => Math.max(this.kycAwaitingTotal(), this.approvals().filter((a) => a.kind === 'kyc').length)
      + this.approvals().filter((a) => a.kind === 'workflow').length,
  );

  public readonly userName = computed(() => this._auth.connectedUser()?.fullName?.trim() ?? '');

  public readonly openTasks = computed(() =>
    this.allTasks()
      .filter((t) => t.status === CrmTaskDtoStatusEnum.Pending || t.status === CrmTaskDtoStatusEnum.InProgress)
      .sort((a, b) => deadlineOf(a) - deadlineOf(b)),
  );
  public readonly overdueTasks = computed(() => {
    const n = this.now();
    return this.openTasks().filter((t) => deadlineOf(t) < n);
  });
  public readonly doneTasks = computed(() =>
    this.allTasks()
      .filter((t) => t.status === CrmTaskDtoStatusEnum.Completed)
      .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()),
  );

  public readonly visibleTasks = computed(() => {
    switch (this.activeTab()) {
      case 'overdue': return this.overdueTasks();
      case 'done':    return this.doneTasks();
      default:        return this.openTasks();
    }
  });

  /** La première tâche de l'onglet est ouverte d'office : le panneau n'est jamais vide quand la liste ne l'est pas. */
  public readonly selectedTask = computed<CrmTaskDto | null>(() => {
    const tasks = this.visibleTasks();
    return tasks.find((t) => t.id === this.selectedTaskId()) ?? tasks[0] ?? null;
  });

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50], totalElements: 0 },
  });

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Mes tâches' }]);
    this._loadTasks();
    this.loadApprovals();
    this._loadAgency();
    this._tickTimer = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  public setTab(tab: TaskTab): void {
    this.activeTab.set(tab);
    this.selectedTaskId.set(null);
  }

  public selectTask(task: CrmTaskDto): void {
    this.selectedTaskId.set(task.id ?? null);
  }

  public leadOf(task: CrmTaskDto | null): LeadDto | null {
    return task?.leadId ? this.leads().get(task.leadId) ?? null : null;
  }

  public leadName(task: CrmTaskDto): string {
    return leadDisplayName(this.leadOf(task));
  }

  public onTaskCompleted(): void {
    this.selectedTaskId.set(null);
    this._loadTasks();
  }

  public openReassign(task: CrmTaskDto): void {
    const ref = this._sideDrawer.open<boolean, ReassignTaskDrawerData, ReassignTaskDrawer>(ReassignTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task },
    });
    ref.closed.subscribe((reassigned) => {
      if (!reassigned) return;
      this.selectedTaskId.set(null);
      this._loadTasks();
    });
  }

  public loadApprovals(): void {
    this.isApprovalsLoading.set(true);
    this._approvalsService.load().subscribe((result) => {
      this.approvals.set(result.items);
      this.kycAwaitingTotal.set(result.kycAwaitingTotal);
      this.isApprovalsLoading.set(false);
    });
  }

  public openLead(leadId: string): void {
    this._router.navigate(['/leads', leadId]);
  }

  private _loadTasks(): void {
    this.isLoading.set(true);
    const agentId = this._auth.connectedUser()?.id;
    this._tasksApi
      .listCrmTasks(undefined, agentId)
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((tasks) => {
        this.allTasks.set(tasks ?? []);
        this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: (tasks ?? []).length } }));
        this.isLoading.set(false);
        this._loadLeads(tasks ?? []);
      });
  }

  /**
   * Le DTO de tâche ne porte que `leadId` : nom, produit et étape du lead sont chargés à part. Un lead
   * introuvable (fusionné, supprimé) laisse simplement sa ligne sans nom.
   */
  private _loadLeads(tasks: CrmTaskDto[]): void {
    const known = this.leads();
    const missing = [...new Set(tasks.map((t) => t.leadId).filter((id): id is string => !!id && !known.has(id)))];
    if (!missing.length) return;

    forkJoin(missing.map((id) => this._leadsApi.getLead(id).pipe(catchError(() => of(null)))))
      .pipe(map((leads) => leads.filter((l): l is LeadDto => !!l?.id)))
      .subscribe((leads) => {
        const next = new Map(this.leads());
        leads.forEach((l) => next.set(l.id!, l));
        this.leads.set(next);
      });
  }

  private _loadAgency(): void {
    const agencyId = this._auth.connectedUser()?.agencyId;
    if (!agencyId) return;
    this._agenciesApi
      .getAgency(agencyId)
      .pipe(catchError(() => EMPTY))
      .subscribe((agency) => this.agencyName.set(agency?.name ?? ''));
  }
}
