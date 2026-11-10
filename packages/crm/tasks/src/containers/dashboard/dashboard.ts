import { Component, computed, DestroyRef, effect, inject, signal, OnInit, OnDestroy, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, finalize, forkJoin, map, of, Subscription } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  AgendaAppointmentDto,
  AgenciesApiService,
  CrmTaskDto,
  CrmTaskDtoStatusEnum,
  KYCApiService,
  LeadDto,
  LeadsAnalyticsApiService,
  LeadsApiService,
  MyScorecardDto,
  MyAgendaDto,
  OpportunitiesApiService,
  TeamScorecardDto,
  TasksApiService,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService, QuickCreateEvents, TenantKycService } from '@sankore/crm/common';
import { leadDisplayName } from './task-meta';
import { ReassignTaskDrawer, ReassignTaskDrawerData } from './reassign-task-drawer';
import { ApprovalItem, MyApprovalsService } from './my-approvals.service';
import { ApprovalsList } from './approvals-list';
import { NewTaskDrawer, NewTaskDrawerData } from '../task/new-task-drawer';
import { agendaEntries } from './agenda-meta';
import { isLateTask, WatchLine } from './my-day-agent-meta';
import {
  byUrgency,
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
import { TaskDayList } from './task-day-list';
import { TaskWorkDrawer, TaskWorkDrawerData, TaskWorkDrawerResult } from './task-work-drawer';
import { CreateAppointmentDrawer, CreateAppointmentDrawerData } from './create-appointment-drawer';
import { AppointmentDetailDrawer, AppointmentDetailDrawerData, AppointmentDetailDrawerResult } from './appointment-detail-drawer';
import { MyDayAgent } from './my-day-agent';
import { ScorePeriod } from './my-day-scorecard';
import { MyDayTeam, MyDayTeamTable, TeamPeriod } from './my-day-team';

/** La journée, ou l'une des deux listes qu'elle ouvre. */
type AgentMode = 'today' | 'upcoming' | 'approvals';
/** Le plafond de `GET leads?ids=` (`ListLeadsQuery.MaxIds`). */
const LEADS_PER_CALL = 100;

/** Ce que l'agenda couvre à partir d'aujourd'hui. Les rappels en retard viennent toujours. */
const AGENDA_AHEAD_DAYS = 14;

const LONG_DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });

function isOpen(task: CrmTaskDto): boolean {
  return task.status === CrmTaskDtoStatusEnum.Pending || task.status === CrmTaskDtoStatusEnum.InProgress;
}

/**
 * « Ma journée », le même écran pour tous (propriétaire, 2026-11-05) : ses tâches, rappels et
 * rendez-vous, ce qui attend sa décision. Les droits ajoutent le reste : la journée de son équipe,
 * ou ses chiffres à qui travaille des leads. Les tâches se traitent dans un drawer (le panneau de
 * travail, qui consigne le résultat de l'appel sur le lead) ; elles se reportent et se répartissent
 * d'ici, sans toucher au SLA de premier contact.
 */
@Component({
  templateUrl: './dashboard.html',
  imports: [
    TasIcon,
    ApprovalsList,
    TaskDayList,
    MyDayAgent,
    MyDayTeam,
    MyDayTeamTable,
  ],
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _kycApi = inject(KYCApiService);
  private readonly _projectsApi = inject(OpportunitiesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _analyticsApi = inject(LeadsAnalyticsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
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
  /** Tâches en cours de report : la ligne est grisée et son bouton désactivé. */
  public busyIds = signal<Set<string>>(new Set());

  /** La journée de l'équipe ; sans elle, les chiffres de qui travaille des leads. */
  public readonly isTeamView = this._permissions.canAll('lead:team:supervise', 'lead:analytics:view');
  private readonly _worksLeads = this._permissions.can('lead:update');
  public readonly showsOwnScorecard = computed(() => !this.isTeamView() && this._worksLeads());
  public agentMode = signal<AgentMode>('today');
  /** La journée de l'équipe (`GET leads/me/team-scorecard`) ; agence et agent restent dans l'URL. */
  public teamCard = signal<TeamScorecardDto | null>(null);
  public teamPeriod = signal<TeamPeriod>('day');
  public teamAgency = signal('');
  public teamAgent = signal('');
  public isTeamLoading = signal(false);
  public readonly teamPeriodLabel = computed(() =>
    this.teamPeriod() === 'day' ? 'aujourd’hui' : this.teamPeriod() === 'week' ? 'cette semaine' : 'ce mois-ci');
  /** « Mes performances » et « Attribués aujourd'hui » (`GET leads/me/scorecard`). */
  public scorecard = signal<MyScorecardDto | null>(null);
  public scorePeriod = signal<ScorePeriod>('month');
  public isScorecardLoading = signal(false);
  /** « Voir toutes mes tâches » : les tâches ouvertes à partir de demain, par jour et dans l'ordre d'urgence. */
  public readonly upcomingGroups = computed(() => {
    const today = this.todayKey();
    const later = this.openTasks().filter((t) => !!t.dueAt && dayKey(t.dueAt) > today);
    return groupByDay(later, (t) => t.dueAt, this.now());
  });
  public agencyName = signal('');

  public readonly todayKey = computed(() => dayKey(this.now()));
  // ——— Agenda et approbations ———

  /** Rappels, activités planifiées et alertes SLA de l'utilisateur. Toujours les SIENS. */
  public agenda = signal<MyAgendaDto | null>(null);
  public isAgendaLoading = signal(true);
  public approvals = signal<ApprovalItem[]>([]);
  public kycAwaitingTotal = signal(0);
  public isApprovalsLoading = signal(true);
  public readonly kycApprovals = computed(
    () => Math.max(this.kycAwaitingTotal(), this.approvals().filter((a) => a.kind === 'kyc').length),
  );
  public readonly workflowApprovals = computed(() => this.approvals().filter((a) => a.kind === 'workflow').length);
  public readonly approvalsCount = computed(
    () => Math.max(this.kycAwaitingTotal(), this.approvals().filter((a) => a.kind === 'kyc').length)
      + this.approvals().filter((a) => a.kind === 'workflow').length,
  );

  public readonly entries = computed(() => agendaEntries(this.agenda()));
  // ——— Dossiers à gérer ———

  // KYC désactivé pour l'institution : révisions et pièces à renouveler n'ont plus d'objet (docs/kyc-par-institution.md).
  private readonly _canWorkKyc = inject(TenantKycService).whileInForce(this._permissions.can('kyc:manage'));
  private readonly _canWorkProjects = this._permissions.can('lead:opportunity:manage');
  private readonly _kycReviews = signal(0);
  private readonly _kycExpiring = signal(0);
  private readonly _overdueProjects = signal(0);

  /** Chaque nombre est ce que son lien ouvre : mêmes filtres, même périmètre. */
  public readonly watchLines = computed<WatchLine[]>(() => {
    const now = this.now();
    const lateTasks = this.allTasks().filter((t) => isLateTask(t, now)).length;
    const lines: WatchLine[] = [
      { key: 'tasks', icon: 'feather:alert-circle', count: lateTasks, label: lateTasks > 1 ? 'tâches en retard' : 'tâche en retard', link: '/tasks', queryParams: { vue: 'Overdue' } },
      { key: 'projects', icon: 'feather:briefcase', count: this._overdueProjects(), label: this._overdueProjects() > 1 ? 'projets en retard' : 'projet en retard', link: '/leads/projets', queryParams: { statut: 'retard' } },
      { key: 'reviews', icon: 'feather:refresh-cw', count: this._kycReviews(), label: this._kycReviews() > 1 ? 'révisions KYC à faire' : 'révision KYC à faire', link: '/kyc', queryParams: { filtre: 'revisions' } },
      { key: 'expiring', icon: 'feather:file-text', count: this._kycExpiring(), label: this._kycExpiring() > 1 ? "pièces d'identité à renouveler" : "pièce d'identité à renouveler", link: '/kyc', queryParams: { filtre: 'pieces' } },
    ];
    return lines.filter((l) => l.count > 0);
  });

  // ——— Tâches ———

  public readonly userFirstName = computed(() => {
    const user = this._auth.connectedUser();
    return user?.fullName?.trim().split(/\s+/)[0] ?? '';
  });

  /** Par urgence (`byUrgency`) ; `groupByDay` les range ensuite par jour d'échéance sans changer cet ordre. */
  public readonly openTasks = computed(() => {
    const leads = this.leads();
    const scoreOf = (t: CrmTaskDto) => (t.leadId ? leads.get(t.leadId)?.score : undefined);
    const intentOf = (t: CrmTaskDto) => (t.leadId ? leads.get(t.leadId)?.intentLevel : undefined);
    return this.allTasks().filter(isOpen).sort(byUrgency(this.now(), scoreOf, intentOf));
  });
  public readonly duplicates = computed(() => duplicateTaskIds(this.openTasks()));

  /**
   * Ce qui dépend du compte attend qu'il soit chargé. Lu dans `ngOnInit`, il ne l'était pas encore
   * à l'ouverture directe de la page : ses « Mes tâches » recevaient l'équipe (aucun agent demandé),
   * l'agence manquait à l'en-tête, et l'écran ne demandait pas ses chiffres.
   */
  private _accountReady = false;
  private readonly _whenAccountReady = effect(() => {
    const user = this._auth.connectedUser();
    if (!user?.id || this._accountReady) return;
    this._accountReady = true;
    untracked(() => {
      const params = this._route.snapshot.queryParams;
      if (this.isTeamView()) {
        if (['day', 'week', 'month'].includes(params['periode'])) this.teamPeriod.set(params['periode']);
        this.teamAgency.set(params['agence'] ?? '');
        this.teamAgent.set(params['agent'] ?? '');
        this.loadTeamScorecard();
      }
      this._loadTasks();
      // Lit les droits : lancé avant, un rechargement de la page ne montrait aucune approbation.
      this.loadApprovals();
      if (this.showsOwnScorecard()) this.loadScorecard();
      this._loadWatchCounts();
      this._loadAgency();
    });
  });

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Ma journée' }]);
    this.loadAgenda();
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
      data: { day: null },
    });
    ref.closed.subscribe((id) => {
      if (id) this.loadAgenda();
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
    const agentName = this._auth.connectedUser()?.fullName?.trim() ?? '';
    const ref = this._sideDrawer.open<TaskWorkDrawerResult, TaskWorkDrawerData, TaskWorkDrawer>(TaskWorkDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { task, lead: task.leadId ? this.leads().get(task.leadId) ?? null : null, agentName },
    });
    ref.closed.subscribe((result) => {
      switch (result?.action) {
        case 'completed':
          this._loadTasks();
          if (this.showsOwnScorecard()) this.loadScorecard();
          if (this.isTeamView()) this.loadTeamScorecard();
          break;
        case 'reassign':  this.openReassign(result.task); break;
        case 'open-subject': this._router.navigate(result.route); break;
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

  public setScorePeriod(period: ScorePeriod): void {
    if (this.scorePeriod() === period) return;
    this.scorePeriod.set(period);
    this.loadScorecard();
  }

  private _scorecardRequest?: Subscription;
  private _teamRequest?: Subscription;

  /** Les chiffres complètent la journée : leur absence n'empêche pas de travailler. */
  public loadScorecard(): void {
    this._scorecardRequest?.unsubscribe();
    this.isScorecardLoading.set(true);
    this._scorecardRequest = this._analyticsApi
      .getMyScorecard(this.scorePeriod())
      .pipe(
        catchError(() => of(null)),
        finalize(() => this.isScorecardLoading.set(false)),
      )
      .subscribe((card) => {
        this.scorecard.set(card);
        // Le numéro pour appeler un lead attribué aujourd'hui vient du lead, pas des chiffres.
        this._loadLeads((card?.assignedToday?.items ?? []).map((i) => i.leadId));
      });
  }



  public setTeamPeriod(period: TeamPeriod): void {
    if (this.teamPeriod() === period) return;
    this.teamPeriod.set(period);
    this.loadTeamScorecard();
  }

  /** Changer d'agence remet l'agent à « Tous » : celui d'avant n'en fait peut-être pas partie. */
  public setTeamAgency(agencyId: string): void {
    if (this.teamAgency() === agencyId) return;
    this.teamAgency.set(agencyId);
    this.teamAgent.set('');
    this.loadTeamScorecard();
  }

  public setTeamAgent(agentId: string): void {
    // Recliquer l'agent choisi dans le tableau revient à toute l'équipe.
    this.teamAgent.set(this.teamAgent() === agentId ? '' : agentId);
    this.loadTeamScorecard();
  }

  /** Les chiffres d'équipe complètent la journée : leur absence n'empêche pas de travailler. */
  public loadTeamScorecard(): void {
    if (!this.isTeamView()) return;
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        periode: this.teamPeriod() === 'day' ? null : this.teamPeriod(),
        agence: this.teamAgency() || null,
        agent: this.teamAgent() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    // La demande précédente est abandonnée : la réponse lente d'un mois pouvait arriver après celle
    // du jour et afficher les chiffres du mois sous « aujourd'hui ».
    this._teamRequest?.unsubscribe();
    this.isTeamLoading.set(true);
    this._teamRequest = this._analyticsApi
      .getTeamScorecard(this.teamPeriod(), this.teamAgency() || undefined, this.teamAgent() || undefined)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // Une agence ou un agent sorti du périmètre (lien ancien) : on revient à toute l'équipe.
          if (err.status === 404 && (this.teamAgency() || this.teamAgent())) {
            this.teamAgency.set('');
            this.teamAgent.set('');
            this.loadTeamScorecard();
            return EMPTY;
          }
          return of(null);
        }),
        finalize(() => this.isTeamLoading.set(false)),
      )
      .subscribe((card) => this.teamCard.set(card));
  }

  public loadApprovals(): void {
    this.isApprovalsLoading.set(true);
    this._approvalsService.load().subscribe((result) => {
      this.approvals.set(result.items);
      this.kycAwaitingTotal.set(result.kycAwaitingTotal);
      this.isApprovalsLoading.set(false);
    });
  }

  public loadAgenda(): void {
    const from = startOfDay(new Date());
    this.isAgendaLoading.set(true);
    this._leadsApi
      .getMyAgenda(from.toISOString(), AGENDA_AHEAD_DAYS)
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

  /** Ces compteurs complètent la journée : leur absence n'empêche pas de travailler. */
  private _loadWatchCounts(): void {
    if (this._canWorkProjects()) {
      this._projectsApi.getOverdueProjectCount().pipe(catchError(() => EMPTY)).subscribe((n) => this._overdueProjects.set(n ?? 0));
    }
    if (this._canWorkKyc()) {
      const total = (status?: 'UnderReview', expiring?: boolean) =>
        this._kycApi.listKycFiles(status, undefined, undefined, undefined, undefined, 1, 1, undefined, expiring).pipe(
          map((page) => page.totalCount ?? 0),
          catchError(() => of(0)),
        );
      total('UnderReview').subscribe((n) => this._kycReviews.set(n));
      total(undefined, true).subscribe((n) => this._kycExpiring.set(n));
    }
  }

  private _loadTasks(): void {
    this.isLoading.set(true);
    // L'agent est toujours nommé : sans lui, le serveur rend à un superviseur les tâches de son équipe.
    this._tasksApi
      .listCrmTasks(undefined, this._auth.connectedUser()?.id)
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
   * lead sont chargés à part, par lots de 100 (`GET leads?ids=`). Un appel par lead dépassait la
   * limite de l'API (200 par minute et par utilisateur) dès la vue équipe, qui en compte une
   * centaine, et l'appel suivant de l'écran échouait en 429. Un lead hors de portée ou introuvable
   * (fusionné, supprimé) laisse sa ligne sans nom.
   */
  private readonly _requestedLeadIds = new Set<string>();

  private _loadLeads(ids: (string | null | undefined)[]): void {
    const known = this.leads();
    const missing = [...new Set(ids.filter((id): id is string => !!id && !known.has(id) && !this._requestedLeadIds.has(id)))];
    if (!missing.length) return;
    missing.forEach((id) => this._requestedLeadIds.add(id));

    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += LEADS_PER_CALL) batches.push(missing.slice(i, i + LEADS_PER_CALL));

    forkJoin(batches.map((batch) =>
      this._leadsApi
        .listLeads(1, LEADS_PER_CALL, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, batch)
        .pipe(
          map((page) => page.items ?? []),
          catchError(() => {
            // Un lot perdu pourra être redemandé au prochain chargement.
            batch.forEach((id) => this._requestedLeadIds.delete(id));
            return of([] as LeadDto[]);
          }),
        ),
    ))
      .pipe(map((pages) => pages.flat().filter((l) => !!l.id)))
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
