import { Component, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { catchError, debounceTime, EMPTY, filter, of, Subject, Subscription } from 'rxjs';
import { CrmTaskDto, LeadDto, LeadsApiService, TaskPageCountsDto, TasksApiService, UsersApiService } from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService, QuickCreateEvents } from '@sankore/crm/common';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { leadDisplayName, typeLabel } from '../dashboard/task-meta';
import { PRIORITY_LABELS, STATUS_LABELS } from '../task/task-meta';

type TaskView = 'Open' | 'Overdue' | 'Done' | 'Cancelled' | 'All';

const VIEWS: { key: TaskView; label: string; count: keyof TaskPageCountsDto }[] = [
  { key: 'Open', label: 'À faire', count: 'open' },
  { key: 'Overdue', label: 'En retard', count: 'overdue' },
  { key: 'Done', label: 'Terminées', count: 'done' },
  { key: 'Cancelled', label: 'Annulées', count: 'cancelled' },
  { key: 'All', label: 'Toutes', count: 'all' },
];
/** `tas-select` n'affiche pas une option de valeur vide : « Toute mon équipe » a la sienne. */
const WHOLE_TEAM = 'team';

/**
 * « Toutes les tâches », à toute date et tout statut. « Ma journée » ne montre qu'aujourd'hui et les
 * tâches ouvertes à venir : une tâche terminée, ou celle d'un collègue, n'était visible nulle part.
 */
@Component({
  selector: 'tasks-task-list',
  imports: [DatePipe, FormsModule, RouterLink, TasFormField, TasLabel, TasInput, TasSelect, TasTable],
  templateUrl: './task-list.html',
})
export class TaskListPage implements OnInit {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _quickCreate = inject(QuickCreateEvents);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly views = VIEWS;
  public readonly priorityLabels = PRIORITY_LABELS;
  public readonly statusLabels = STATUS_LABELS;
  public readonly typeLabel = typeLabel;

  public isLoading = signal(true);
  public tasks = signal<CrmTaskDto[]>([]);
  public counts = signal<TaskPageCountsDto | null>(null);
  public view = signal<TaskView>('Open');
  public agent = signal('');
  public search = signal('');
  public leads = signal<Map<string, LeadDto>>(new Map());
  public agentNames = signal<Map<string, string>>(new Map());

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 25, pageSizeOptions: [10, 25, 50], totalElements: 0 },
  });

  public readonly isSupervisor = this._permissions.can('lead:team:supervise');
  public readonly wholeTeam = WHOLE_TEAM;
  public readonly agentOptions = computed(() => {
    const me = this._auth.connectedUser()?.id ?? '';
    const others = [...this.agentNames()]
      .filter(([id]) => id !== me)
      .map(([value, label]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
    return [{ label: 'Toute mon équipe', value: WHOLE_TEAM }, { label: 'Mes tâches', value: me }, ...others];
  });

  private readonly _search$ = new Subject<void>();
  private _request?: Subscription;

  /** Le rôle décide du filtre et de la colonne « Porteur » : on attend le compte, absent à l'ouverture directe. */
  private _accountReady = false;
  private readonly _whenAccountReady = effect(() => {
    if (!this._auth.connectedUser()?.id || this._accountReady) return;
    this._accountReady = true;
    untracked(() => {
      if (this.isSupervisor()) {
        this.agent.set(this._route.snapshot.queryParams['agent'] ?? '');
        this._loadAgentNames();
      }
      this.reload();
    });
  });

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Tâches' }]);
    const params = this._route.snapshot.queryParams;
    if (VIEWS.some((v) => v.key === params['vue'])) this.view.set(params['vue']);
    if (params['q']) this.search.set(params['q']);

    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(() => this._applyFilters());
    this._quickCreate.created$
      .pipe(filter((c) => c.kind === 'task'), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this.reload());
  }

  public count(view: (typeof VIEWS)[number]): number | null {
    return this.counts()?.[view.count] ?? null;
  }

  public setView(view: TaskView): void {
    this.view.set(view);
    this._applyFilters();
  }

  public setAgent(agent: string | null): void {
    this.agent.set(!agent || agent === WHOLE_TEAM ? '' : agent);
    this._applyFilters();
  }

  public onSearchChange(value: string | null): void {
    this.search.set(value ?? '');
    this._search$.next();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize } }));
    this.reload();
  }

  public leadName(task: CrmTaskDto): string {
    return task.leadId ? leadDisplayName(this.leads().get(task.leadId)) : '';
  }

  public holder(task: CrmTaskDto): string {
    if (!task.assignedAgentId) return 'Non attribuée';
    return this.agentNames().get(task.assignedAgentId) ?? '—';
  }

  public isOpen(task: CrmTaskDto): boolean {
    return task.status === 'Pending' || task.status === 'InProgress';
  }

  public isLate(task: CrmTaskDto): boolean {
    const deadline = task.slaDeadline ?? task.dueAt;
    return this.isOpen(task) && !!deadline && new Date(deadline).getTime() < Date.now();
  }

  public reload(): void {
    this._request?.unsubscribe();
    this.isLoading.set(true);
    const { pageIndex, pageSize } = this.tableConfig().pagination;
    this._request = this._tasksApi
      .getCrmTaskPage(this.view(), this.agent() || undefined, this.search() || undefined, pageIndex + 1, pageSize)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Les tâches n’ont pas pu être chargées.');
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((page) => {
        this.tasks.set(page.items ?? []);
        this.counts.set(page.counts ?? null);
        this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: page.totalCount ?? 0 } }));
        this.isLoading.set(false);
        this._loadLeads(page.items ?? []);
      });
  }

  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { vue: this.view() === 'Open' ? null : this.view(), agent: this.agent() || null, q: this.search() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
    this.reload();
  }

  /** Le DTO de tâche ne porte que `leadId` : le nom vient du lead, une page tient dans un appel. */
  private _loadLeads(tasks: CrmTaskDto[]): void {
    const known = this.leads();
    const missing = [...new Set(tasks.map((t) => t.leadId).filter((id): id is string => !!id && !known.has(id)))];
    if (!missing.length) return;
    this._leadsApi
      .listLeads(1, missing.length, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, missing)
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        this.leads.update((map) => {
          const next = new Map(map);
          (result?.items ?? []).forEach((l) => l.id && next.set(l.id, l));
          return next;
        });
      });
  }

  private _loadAgentNames(): void {
    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(catchError(() => of(null)))
      .subscribe((result) => {
        const names = new Map<string, string>();
        (result?.items ?? []).forEach((u) => {
          if (u.id) names.set(u.id, u.fullName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '—');
        });
        this.agentNames.set(names);
      });
  }
}

export default TaskListPage;
