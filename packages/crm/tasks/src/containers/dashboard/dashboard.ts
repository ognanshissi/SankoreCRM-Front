import { Component, computed, DestroyRef, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, finalize, forkJoin, map, of } from 'rxjs';
import { TasSelect } from '@talisoft/ui/select';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  AgendaAppointmentDto,
  AgenciesApiService,
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  LeadDto,
  LeadsApiService,
  MyAgendaDto,
  TasksApiService,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService, QuickCreateEvents } from '@sankore/crm/common';
import { leadDisplayName } from './task-meta';
import { ReassignTaskDrawer, ReassignTaskDrawerData } from './reassign-task-drawer';
import { ApprovalItem, MyApprovalsService } from './my-approvals.service';
import { ApprovalsList } from './approvals-list';
import { NewTaskDrawer, NewTaskDrawerData } from '../task/new-task-drawer';
import { agendaEntries } from './agenda-meta';
import {
  addDays,
  dayKey,
  dayHeading,
  DayGroup,
  duplicateTaskIds,
  fromDayKey,
  groupByDay,
  postponedDueAt,
  spreadLastDay,
  spreadOverWeek,
  startOfDay,
} from './my-day-meta';
import { DayMarkers, MyDayCalendar } from './my-day-calendar';
import { PromisedReminders } from './promised-reminders';
import { TaskDayList } from './task-day-list';
import { AgendaDayList } from './agenda-day-list';
import { TaskWorkDrawer, TaskWorkDrawerData, TaskWorkDrawerResult } from './task-work-drawer';
import { CreateAppointmentDrawer, CreateAppointmentDrawerData } from './create-appointment-drawer';
import { AppointmentDetailDrawer, AppointmentDetailDrawerData, AppointmentDetailDrawerResult } from './appointment-detail-drawer';

type MyDayView = 'todo' | 'overdue' | 'reminders' | 'meetings' | 'approvals' | 'done';
type TaskScope = 'mine' | 'team';

interface NavItem {
  view: MyDayView;
  label: string;
  icon: string;
  count: () => number;
  /** Pastille colorée quand le compte n'est pas nul : ce qui attend une réponse de l'agent. */
  tone: 'neutral' | 'amber' | 'blue';
  /** Rappels, rendez-vous et approbations sont ceux de l'utilisateur : pas de vue équipe. */
  mineOnly: boolean;
}

/**
 * Les rôles que le serveur traite en superviseur (`ListTasksHandler.SupervisorRoles`) : sans agent
 * demandé, il leur rend les tâches de leur équipe — leur agence et ses sous-agences, ou tout le
 * tenant pour un super-utilisateur ou un compte sans agence. À garder alignés.
 */
const SUPERVISOR_ROLES = ['System', 'Administrator', 'SalesManager', 'BranchManager'];

/** Ce que l'agenda couvre au moins à partir d'aujourd'hui, quel que soit le mois affiché. */
const AGENDA_AHEAD_DAYS = 14;
/** Le plafond du serveur (`GetMyAgendaHandler.MaxDays`). */
const AGENDA_MAX_DAYS = 62;

const LONG_DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });

function deadlineOf(task: CrmTaskDto): number {
  const d = task.slaDeadline ?? task.dueAt;
  return d ? new Date(d).getTime() : Infinity;
}

function isOpen(task: CrmTaskDto): boolean {
  return task.status === CrmTaskDtoStatusEnum.Pending || task.status === CrmTaskDtoStatusEnum.InProgress;
}

/**
 * « Ma journée » : les tâches de l'agent groupées par jour, ses rappels et rendez-vous, et le
 * calendrier du mois qui dit ce qui tombe quand. Les tâches se traitent dans un drawer (le panneau
 * de travail, qui consigne le résultat de l'appel sur le lead) ; elles se reportent et se
 * répartissent d'ici, sans toucher au SLA de premier contact.
 */
@Component({
  templateUrl: './dashboard.html',
  imports: [
    FormsModule,
    TasSelect,
    TasIcon,
    Button,
    ApprovalsList,
    MyDayCalendar,
    PromisedReminders,
    TaskDayList,
    AgendaDayList,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _approvalsService = inject(MyApprovalsService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _quickCreate = inject(QuickCreateEvents);
  private readonly _destroyRef = inject(DestroyRef);

  /** Planifier un rendez-vous, c'est consigner une interaction à venir : le droit de l'activité. */
  public readonly canScheduleAppointment = this._permissions.can('lead:activity:log');
  public readonly canManageTasks = this._permissions.can('lead:task:manage');

  public now = signal(Date.now());
  private _tickTimer: ReturnType<typeof setInterval> | null = null;

  public isLoading = signal(true);
  public allTasks = signal<CrmTaskDto[]>([]);
  public leads = signal<Map<string, LeadDto>>(new Map());
  public view = signal<MyDayView>('todo');
  /** Tâches en cours de report : la ligne est grisée et son bouton désactivé. */
  public busyIds = signal<Set<string>>(new Set());

  // ——— Portée ———

  /**
   * « Mes tâches » ou « Équipe ». La vue équipe existe parce qu'un responsable qui importe des leads
   * ne voyait rien arriver : les tâches partent chez les agents, et « Mes tâches » ne montre que les
   * siennes. Gardée dans l'URL (`vue=equipe`).
   */
  public scope = signal<TaskScope>('mine');
  public readonly isSupervisor = computed(() =>
    (this._auth.connectedUser()?.roles ?? []).some((r) => SUPERVISOR_ROLES.includes(r)),
  );
  /** Filtre agent de la vue équipe, appliqué côté client sur les tâches chargées. */
  public agentFilter = signal('');
  public agentNames = signal<Map<string, string>>(new Map());
  public readonly agentOptions = computed(() => {
    const names = this.agentNames();
    const ids = [...new Set(this.allTasks().map((t) => t.assignedAgentId).filter((id): id is string => !!id))];
    return [
      { label: 'Tous les agents', value: '' },
      ...ids
        .map((id) => ({ label: names.get(id) ?? 'Agent inconnu', value: id }))
        .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    ];
  });
  public agencyName = signal('');

  // ——— Calendrier ———

  public calendarMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  /** Jour choisi dans le calendrier : filtre la liste affichée. `null` = tous les jours. */
  public selectedDay = signal<string | null>(null);
  public readonly todayKey = computed(() => dayKey(this.now()));
  public readonly selectedDayLabel = computed(() => {
    const key = this.selectedDay();
    if (!key) return '';
    const label = LONG_DATE.format(fromDayKey(key));
    return label.charAt(0).toUpperCase() + label.slice(1);
  });

  // ——— Agenda et approbations ———

  /** Rappels, activités planifiées et alertes SLA de l'utilisateur. Toujours les SIENS. */
  public agenda = signal<MyAgendaDto | null>(null);
  public isAgendaLoading = signal(true);
  public approvals = signal<ApprovalItem[]>([]);
  public kycAwaitingTotal = signal(0);
  public isApprovalsLoading = signal(true);
  public readonly approvalsCount = computed(
    () => Math.max(this.kycAwaitingTotal(), this.approvals().filter((a) => a.kind === 'kyc').length)
      + this.approvals().filter((a) => a.kind === 'workflow').length,
  );

  public readonly entries = computed(() => agendaEntries(this.agenda()));
  public readonly reminders = computed(() => this.entries().filter((e) => e.kind === 'reminder'));
  /**
   * Les rendez-vous à venir : ceux planifiés d'ici, et les activités enregistrées avec une date
   * prévue. Un rendez-vous passé n'a pas de statut « fait », il quitte la liste.
   */
  public readonly meetings = computed(() => {
    const today = startOfDay(new Date(this.now())).getTime();
    return this.entries().filter((e) => e.kind !== 'reminder' && new Date(e.at).getTime() >= today);
  });

  // ——— Tâches ———

  public readonly userFirstName = computed(() => {
    const user = this._auth.connectedUser();
    return user?.fullName?.trim().split(/\s+/)[0] ?? '';
  });

  private readonly _scopedTasks = computed(() => {
    const agent = this.scope() === 'team' ? this.agentFilter() : '';
    return agent ? this.allTasks().filter((t) => t.assignedAgentId === agent) : this.allTasks();
  });

  public readonly openTasks = computed(() =>
    this._scopedTasks()
      .filter(isOpen)
      .sort((a, b) => new Date(a.dueAt ?? 0).getTime() - new Date(b.dueAt ?? 0).getTime()),
  );
  public readonly overdueTasks = computed(() => {
    const n = this.now();
    return this.openTasks().filter((t) => deadlineOf(t) < n);
  });
  public readonly doneTasks = computed(() =>
    this._scopedTasks()
      .filter((t) => t.status === CrmTaskDtoStatusEnum.Completed)
      .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime()),
  );
  public readonly tasksToday = computed(() => this.openTasks().filter((t) => t.dueAt && dayKey(t.dueAt) === this.todayKey()).length);
  public readonly duplicates = computed(() => duplicateTaskIds(this.openTasks()));

  private _onSelectedDay<T>(items: T[], at: (item: T) => string | null | undefined): T[] {
    const day = this.selectedDay();
    return day ? items.filter((i) => { const iso = at(i); return !!iso && dayKey(iso) === day; }) : items;
  }

  public readonly taskGroups = computed<DayGroup<CrmTaskDto>[]>(() => {
    const now = this.now();
    switch (this.view()) {
      case 'done': {
        // Les plus récentes d'abord : on relit ce qu'on vient de faire.
        return groupByDay(this._onSelectedDay(this.doneTasks(), (t) => t.completedAt), (t) => t.completedAt, now).reverse();
      }
      case 'overdue':
        return groupByDay(this._onSelectedDay(this.overdueTasks(), (t) => t.dueAt), (t) => t.dueAt, now);
      default:
        return groupByDay(this._onSelectedDay(this.openTasks(), (t) => t.dueAt), (t) => t.dueAt, now);
    }
  });
  public readonly reminderGroups = computed(() =>
    groupByDay(this._onSelectedDay(this.reminders(), (e) => e.at), (e) => e.at, this.now()),
  );
  public readonly meetingGroups = computed(() =>
    groupByDay(this._onSelectedDay(this.meetings(), (e) => e.at), (e) => e.at, this.now()),
  );

  /** Ce que chaque jour du calendrier porte. La vue équipe n'a que des tâches. */
  public readonly markers = computed(() => {
    const map = new Map<string, DayMarkers>();
    const mark = (iso: string | null | undefined, kind: keyof DayMarkers) => {
      if (!iso) return;
      const key = dayKey(iso);
      const m = map.get(key) ?? { tasks: false, reminders: false, meetings: false };
      m[kind] = true;
      map.set(key, m);
    };
    this.openTasks().forEach((t) => mark(t.dueAt, 'tasks'));
    if (this.scope() === 'mine') {
      this.reminders().forEach((e) => mark(e.at, 'reminders'));
      this.entries().filter((e) => e.kind !== 'reminder').forEach((e) => mark(e.at, 'meetings'));
    }
    return map;
  });

  public readonly nav: NavItem[] = [
    { view: 'todo',      label: 'À faire',      icon: 'feather:check-square', count: () => this.openTasks().length,    tone: 'neutral', mineOnly: false },
    { view: 'overdue',   label: 'En retard',    icon: 'feather:alert-circle', count: () => this.overdueTasks().length, tone: 'neutral', mineOnly: false },
    { view: 'reminders', label: 'Rappels',      icon: 'feather:bell',         count: () => this.reminders().length,    tone: 'amber',   mineOnly: true },
    { view: 'meetings',  label: 'Rendez-vous',  icon: 'feather:calendar',     count: () => this.meetings().length,     tone: 'blue',    mineOnly: true },
    { view: 'approvals', label: 'Approbations', icon: 'feather:user-check',   count: () => this.approvalsCount(),      tone: 'amber',   mineOnly: true },
    { view: 'done',      label: 'Terminées',    icon: 'feather:check',        count: () => this.doneTasks().length,    tone: 'neutral', mineOnly: false },
  ];
  public readonly visibleNav = computed(() => this.nav.filter((n) => this.scope() === 'mine' || !n.mineOnly));

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Ma journée' }]);
    if (this._route.snapshot.queryParams['vue'] === 'equipe' && this.isSupervisor()) {
      this.scope.set('team');
      this._loadAgentNames();
    }
    this._loadTasks();
    this.loadApprovals();
    this.loadAgenda();
    this._loadAgency();
    this._tickTimer = setInterval(() => this.now.set(Date.now()), 30_000);

    // Créé depuis « Créer » de la barre du haut : ce n'est pas cette page qui a ouvert le tiroir.
    this._quickCreate.created$.pipe(takeUntilDestroyed(this._destroyRef)).subscribe(({ kind }) => {
      if (kind === 'task') this._loadTasks();
      if (kind === 'appointment') this.loadAgenda();
    });
  }

  ngOnDestroy(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  // ——— Navigation de l'écran ———

  public setView(view: MyDayView): void {
    this.view.set(view);
  }

  public setScope(scope: TaskScope): void {
    if (this.scope() === scope) return;
    this.scope.set(scope);
    this.agentFilter.set('');
    if (scope === 'team' && this.nav.find((n) => n.view === this.view())?.mineOnly) this.view.set('todo');
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { vue: scope === 'team' ? 'equipe' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    if (scope === 'team') this._loadAgentNames();
    this._loadTasks();
  }

  public setAgentFilter(agentId: string | null): void {
    this.agentFilter.set(agentId ?? '');
  }

  public onMonthChange(month: Date): void {
    this.calendarMonth.set(month);
    this.loadAgenda();
  }

  // ——— Rendez-vous ———

  /** Une tâche pour soi (ou pour un collègue) : elle rejoint la journée de qui la porte. */
  public openNewTask(): void {
    const ref = this._sideDrawer.open<string, NewTaskDrawerData, NewTaskDrawer>(NewTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((id) => {
      if (id) this._loadTasks();
    });
  }

  public openCreateAppointment(): void {
    const ref = this._sideDrawer.open<string, CreateAppointmentDrawerData, CreateAppointmentDrawer>(CreateAppointmentDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { day: this.selectedDay() },
    });
    ref.closed.subscribe((id) => {
      if (!id) return;
      // On montre ce qu'on vient de créer.
      this.view.set('meetings');
      this.loadAgenda();
    });
  }

  public openAppointment(appointment: AgendaAppointmentDto): void {
    const ref = this._sideDrawer.open<AppointmentDetailDrawerResult, AppointmentDetailDrawerData, AppointmentDetailDrawer>(
      AppointmentDetailDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { appointment } },
    );
    ref.closed.subscribe((result) => {
      if (result?.action === 'cancelled') this.loadAgenda();
      if (result?.action === 'open') this._router.navigate(result.route);
    });
  }

  // ——— Actions sur les tâches ———

  public openTask(task: CrmTaskDto): void {
    const agentName = this.scope() === 'team'
      ? (task.assignedAgentId ? this.agentNames().get(task.assignedAgentId) ?? 'Agent inconnu' : 'Non affectée')
      : this._auth.connectedUser()?.fullName?.trim() ?? '';
    const ref = this._sideDrawer.open<TaskWorkDrawerResult, TaskWorkDrawerData, TaskWorkDrawer>(TaskWorkDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task, lead: task.leadId ? this.leads().get(task.leadId) ?? null : null, agentName },
    });
    ref.closed.subscribe((result) => {
      switch (result?.action) {
        case 'completed': this._loadTasks(); break;
        case 'reassign':  this.openReassign(result.task); break;
        case 'open-lead': this._router.navigate(['/leads', result.leadId]); break;
        case 'open-task': this._router.navigate(['/tasks', result.taskId]); break;
      }
    });
  }

  public openReassign(task: CrmTaskDto): void {
    const ref = this._sideDrawer.open<boolean, ReassignTaskDrawerData, ReassignTaskDrawer>(ReassignTaskDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task },
    });
    ref.closed.subscribe((reassigned) => {
      if (reassigned) this._loadTasks();
    });
  }

  public postpone(task: CrmTaskDto): void {
    if (!task.id) return;
    const target = postponedDueAt(task, Date.now());
    const name = this._leadName(task);
    const when = dayHeading(dayKey(target), Date.now()).startsWith('Demain')
      ? 'reporté à demain'
      : `reporté au ${LONG_DATE.format(target)}`;

    this._reschedule([{ taskId: task.id, dueAt: target.toISOString() }], [task.id], () =>
      this._snackbar.success(name ? `${name} : ${when}` : `Tâche ${when}`, ''),
    );
  }

  public spread(group: DayGroup<CrmTaskDto>): void {
    const moves = spreadOverWeek(group.items.filter(isOpen), group.key);
    const last = spreadLastDay(moves);
    if (!moves.length || !last) return;

    const from = LONG_DATE.format(fromDayKey(group.key));
    this._confirm.confirm({
      title: 'Répartir ces premiers contacts ?',
      message:
        `${moves.length} premiers contacts seront déplacés entre le ${from} et le ${LONG_DATE.format(last)}, ` +
        `à part égale et à la même heure. Leur échéance SLA ne bouge pas : un contact déplacé au-delà ` +
        `apparaîtra en retard.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Répartir', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler', theme: 'primary' },
      accept: () =>
        this._reschedule(moves, moves.map((m) => m.taskId), () =>
          this._snackbar.success('Premiers contacts répartis', `${moves.length} tâches déplacées sur la semaine.`),
        ),
    });
  }

  private _reschedule(items: { taskId: string; dueAt: string }[], ids: string[], onDone: () => void): void {
    this.busyIds.update((s) => new Set([...s, ...ids]));
    this._tasksApi
      .rescheduleCrmTasks({ items })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          const code = err.error?.detail;
          this._snackbar.error(
            'Report impossible',
            code === 'NOT_TASK_OWNER'
              ? 'Une de ces tâches est tenue par un autre agent.'
              : code === 'TASK_ALREADY_COMPLETED' || code === 'TASK_CANCELLED'
                ? 'Une de ces tâches est déjà close.'
                : 'Les échéances n’ont pas pu être déplacées.',
          );
          return EMPTY;
        }),
        finalize(() => this.busyIds.update((s) => new Set([...s].filter((id) => !ids.includes(id))))),
      )
      .subscribe(() => {
        const due = new Map(items.map((i) => [i.taskId, i.dueAt]));
        this.allTasks.update((all) => all.map((t) => (t.id && due.has(t.id) ? { ...t, dueAt: due.get(t.id)! } : t)));
        onDone();
      });
  }

  private _leadName(task: CrmTaskDto): string {
    const lead = task.leadId ? this.leads().get(task.leadId) : null;
    return lead ? leadDisplayName(lead) : '';
  }

  // ——— Chargements ———

  public loadApprovals(): void {
    this.isApprovalsLoading.set(true);
    this._approvalsService.load().subscribe((result) => {
      this.approvals.set(result.items);
      this.kycAwaitingTotal.set(result.kycAwaitingTotal);
      this.isApprovalsLoading.set(false);
    });
  }

  /**
   * La fenêtre couvre le mois affiché (pour ses pastilles) et au moins deux semaines à partir
   * d'aujourd'hui (pour les listes), dans la limite du serveur. Les rappels en retard viennent
   * toujours, quelle que soit la fenêtre.
   */
  public loadAgenda(): void {
    const today = startOfDay(new Date());
    const month = this.calendarMonth();
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    const from = month < today ? month : today;
    const ahead = addDays(today, AGENDA_AHEAD_DAYS);
    const to = nextMonth > ahead ? nextMonth : ahead;
    const days = Math.min(AGENDA_MAX_DAYS, Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000)));

    this.isAgendaLoading.set(true);
    this._leadsApi
      .getMyAgenda(from.toISOString(), days)
      .pipe(
        catchError(() => {
          // L'agenda complète la page : son absence ne doit pas masquer les tâches.
          this.isAgendaLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((agenda) => {
        this.agenda.set(agenda);
        this.isAgendaLoading.set(false);
        this._loadLeads([...(agenda.reminders ?? []), ...(agenda.activities ?? []), ...(agenda.appointments ?? [])].map((e) => e.leadId));
      });
  }

  private _loadTasks(): void {
    this.isLoading.set(true);
    // Sans agent demandé, le serveur rend à un superviseur les tâches de son équipe.
    const agentId = this.scope() === 'team' ? undefined : this._auth.connectedUser()?.id;
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
        this.isLoading.set(false);
        this._loadLeads((tasks ?? []).map((t) => t.leadId));
      });
  }

  /**
   * Les DTO de tâche et d'agenda ne portent que `leadId` : nom, produit, source et téléphone du
   * lead sont chargés à part. Un lead introuvable (fusionné, supprimé) laisse sa ligne sans nom.
   */
  private _loadLeads(ids: (string | null | undefined)[]): void {
    const known = this.leads();
    const missing = [...new Set(ids.filter((id): id is string => !!id && !known.has(id)))];
    if (!missing.length) return;

    forkJoin(missing.map((id) => this._leadsApi.getLead(id).pipe(catchError(() => of(null)))))
      .pipe(map((leads) => leads.filter((l): l is LeadDto => !!l?.id)))
      .subscribe((leads) => {
        const next = new Map(this.leads());
        leads.forEach((l) => next.set(l.id!, l));
        this.leads.set(next);
      });
  }

  /** Noms des agents pour la vue équipe : la tâche ne porte que l'identifiant de son titulaire. */
  private _loadAgentNames(): void {
    if (this.agentNames().size) return;
    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(catchError(() => of({ items: [] as UserDto[] })))
      .subscribe((result) => {
        const names = new Map<string, string>();
        (result.items ?? []).forEach((u) => {
          if (u.id) names.set(u.id, u.fullName?.trim() || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '—');
        });
        this.agentNames.set(names);
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
