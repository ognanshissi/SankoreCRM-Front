import { Component, computed, DestroyRef, effect, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, of } from 'rxjs';
import {
  AppointmentsApiService,
  ConnectedAccountsApiService,
  ConnectedAccountsDto,
  CrmTaskDto,
  LeadsApiService,
  MyAgendaDto,
  MyCalendarEventDto,
  TasksApiService,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { AppointmentDetailDrawer, AppointmentDetailDrawerData, AppointmentDetailDrawerResult } from '../dashboard/appointment-detail-drawer';
import { CreateAppointmentDrawer, CreateAppointmentDrawerData } from '../dashboard/create-appointment-drawer';
import { dayKey, fromDayKey, startOfDay } from '../dashboard/my-day-meta';
import { CalendarEventDrawer, CalendarEventDrawerData } from './calendar-event-drawer';
import {
  allDayItems,
  CalendarConflict,
  CalendarItem,
  CalendarView,
  externalItems,
  findConflicts,
  inRange,
  itemsOfDay,
  layoutDay,
  MEETING_COLOR,
  PlacedItem,
  rangeLabel,
  safeColor,
  sankoreItems,
  shiftAnchor,
  SOURCE_MEETINGS,
  SOURCE_TASKS,
  TASK_COLOR,
  timeLabel,
  timeRange,
  viewRange,
} from './calendar-meta';

/** Hauteur d'une heure sur la grille, en pixels. */
const HOUR_PX = 48;
const MONTH_CHIPS = 3;
const HIDDEN_KEY = 'sankore.calendar.hidden';

const VIEW_PARAM: Record<CalendarView, string> = { day: 'jour', week: 'semaine', month: 'mois' };
const WEEKDAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const CONFLICT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });

interface FilterRow {
  key: string;
  label: string;
  color: string;
  count: number;
}

interface AccountFilters {
  id: string;
  label: string;
  provider: string;
  needsReconnect: boolean;
  calendars: FilterRow[];
}

interface DayColumn {
  day: Date;
  key: string;
  isToday: boolean;
  label: string;
  placed: PlacedItem[];
  allDay: CalendarItem[];
}

interface MonthCell {
  day: Date;
  key: string;
  isToday: boolean;
  inMonth: boolean;
  items: CalendarItem[];
  more: number;
}

/** Les filtres masqués restent d'une visite à l'autre, sur ce navigateur seulement. */
function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const keys = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeHidden(keys: Set<string>): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...keys]));
  } catch {
    // Stockage indisponible (navigation privée) : le filtre vaut pour la visite.
  }
}

/**
 * Le Calendrier : les rendez-vous, activités, tâches et rappels SANKORÉ, et les événements des
 * agendas connectés (lot 2), sur une grille jour / semaine / mois. Un rendez-vous qui chevauche un
 * créneau occupé ailleurs est signalé, avec le premier créneau libre du jour pour le déplacer.
 *
 * La grille est faite maison (pas de bibliothèque de calendrier) : choix validé pour ce lot.
 */
@Component({
  selector: 'calendar-page',
  imports: [RouterLink, Button, TasIcon, TasSpinner],
  templateUrl: './calendar-page.html',
})
export class CalendarPage implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _tasksApi = inject(TasksApiService);
  private readonly _accountsApi = inject(ConnectedAccountsApiService);
  private readonly _appointmentsApi = inject(AppointmentsApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly hourPx = HOUR_PX;
  public readonly hours = Array.from({ length: 24 }, (_, h) => h);
  public readonly meetingColor = MEETING_COLOR;
  public readonly taskColor = TASK_COLOR;
  public readonly canConnect = this._permissions.can(PERMISSIONS.CONNECTED_ACCOUNTS_USE);

  public readonly view = signal<CalendarView>('week');
  public readonly anchor = signal<Date>(startOfDay(new Date()));
  public readonly now = signal(new Date());

  public readonly agenda = signal<MyAgendaDto | null>(null);
  public readonly tasks = signal<CrmTaskDto[]>([]);
  public readonly events = signal<MyCalendarEventDto[]>([]);
  public readonly accounts = signal<ConnectedAccountsDto | null>(null);
  public readonly hidden = signal<Set<string>>(readHidden());

  public readonly isLoading = signal(false);
  public readonly externalFailed = signal(false);
  public readonly movingId = signal<string | null>(null);

  private readonly _scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private _loadSeq = 0;

  public readonly range = computed(() => viewRange(this.view(), this.anchor()));
  public readonly label = computed(() => rangeLabel(this.view(), this.anchor()));

  /** Tout ce que la période contient, filtres compris ou non : les compteurs et les conflits. */
  private readonly _items = computed(() => {
    const { from, to } = this.range();
    return [...sankoreItems(this.agenda(), this.tasks()), ...externalItems(this.events())].filter((i) => inRange(i, from, to));
  });

  public readonly visibleItems = computed(() => {
    const hidden = this.hidden();
    return this._items().filter((i) => !hidden.has(i.source));
  });

  private readonly _counts = computed(() => {
    const counts = new Map<string, number>();
    for (const i of this._items()) counts.set(i.source, (counts.get(i.source) ?? 0) + 1);
    return counts;
  });

  public readonly sankoreFilters = computed<FilterRow[]>(() => [
    { key: SOURCE_MEETINGS, label: 'Rendez-vous clients', color: MEETING_COLOR, count: this._counts().get(SOURCE_MEETINGS) ?? 0 },
    { key: SOURCE_TASKS, label: 'Tâches et rappels', color: TASK_COLOR, count: this._counts().get(SOURCE_TASKS) ?? 0 },
  ]);

  /** Seuls les agendas cochés sont synchronisés : ce sont les seuls qu'on peut filtrer ici. */
  public readonly accountFilters = computed<AccountFilters[]>(() =>
    (this.accounts()?.accounts ?? []).map((a) => ({
      id: a.id ?? '',
      label: a.label?.trim() || a.email || a.displayName || 'Compte',
      provider: a.provider ?? '',
      needsReconnect: a.status === 'NeedsReconnect',
      calendars: (a.calendars ?? [])
        .filter((c) => c.isSelected)
        .map((c) => ({
          key: `cal:${c.id}`,
          label: c.name?.trim() || 'Agenda',
          color: safeColor(c.color, a.provider),
          count: this._counts().get(`cal:${c.id}`) ?? 0,
        })),
    })),
  );

  public readonly subtitle = computed(() => {
    const n = this.visibleItems().length;
    const accounts = this.accounts()?.accounts?.length ?? 0;
    const entries = `${n} ${n > 1 ? 'entrées' : 'entrée'}`;
    if (!this.canConnect()) return entries;
    return accounts
      ? `${entries} · ${accounts} ${accounts > 1 ? 'comptes connectés' : 'compte connecté'}`
      : `${entries} · aucun agenda connecté`;
  });

  public readonly conflicts = computed(() => findConflicts(this._items(), this.now()).slice(0, 3));

  public readonly columns = computed<DayColumn[]>(() => {
    if (this.view() === 'month') return [];
    const todayKey = dayKey(this.now());
    const items = this.visibleItems();
    return this.range().days.map((day) => ({
      day,
      key: dayKey(day),
      isToday: dayKey(day) === todayKey,
      label: `${WEEKDAY.format(day)} ${day.getDate()}`,
      placed: layoutDay(items, day),
      allDay: allDayItems(items, day),
    }));
  });

  public readonly hasAllDay = computed(() => this.columns().some((c) => c.allDay.length > 0));

  public readonly monthCells = computed<MonthCell[]>(() => {
    if (this.view() !== 'month') return [];
    const todayKey = dayKey(this.now());
    const month = this.anchor().getMonth();
    const items = this.visibleItems();
    return this.range().days.map((day) => {
      const all = itemsOfDay(items, day);
      return {
        day,
        key: dayKey(day),
        isToday: dayKey(day) === todayKey,
        inMonth: day.getMonth() === month,
        items: all.slice(0, MONTH_CHIPS),
        more: Math.max(0, all.length - MONTH_CHIPS),
      };
    });
  });

  public readonly weekdayHeaders = computed(() => this.range().days.slice(0, 7).map((d) => WEEKDAY.format(d)));

  /** La ligne « maintenant », en pixels depuis minuit. */
  public readonly nowTop = computed(() => {
    const n = this.now();
    return ((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR_PX;
  });

  constructor() {
    const timer = setInterval(() => this.now.set(new Date()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));

    // À chaque fois que la grille horaire apparaît, elle s'ouvre sur le début de journée.
    effect(() => {
      const el = this._scroller()?.nativeElement;
      if (el) el.scrollTop = 7 * HOUR_PX;
    });
  }

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Calendrier' }]);

    const params = this._route.snapshot.queryParamMap;
    const view = (Object.keys(VIEW_PARAM) as CalendarView[]).find((v) => VIEW_PARAM[v] === params.get('vue'));
    if (view) this.view.set(view);
    const date = params.get('date');
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) this.anchor.set(fromDayKey(date));

    this._loadTasks();
    if (this.canConnect()) this._loadAccounts();
    this._load();
  }

  // ——— Navigation ———

  public setView(view: CalendarView): void {
    this.view.set(view);
    this._navigated();
  }

  public move(direction: 1 | -1): void {
    this.anchor.update((a) => shiftAnchor(this.view(), a, direction));
    this._navigated();
  }

  public goToday(): void {
    this.anchor.set(startOfDay(new Date()));
    this._navigated();
  }

  public openDay(day: Date): void {
    this.anchor.set(startOfDay(day));
    this.view.set('day');
    this._navigated();
  }

  private _navigated(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { vue: VIEW_PARAM[this.view()], date: dayKey(this.anchor()) },
      replaceUrl: true,
    });
    this._load();
  }

  // ——— Filtres ———

  public isShown(key: string): boolean {
    return !this.hidden().has(key);
  }

  public toggle(key: string): void {
    const next = new Set(this.hidden());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.hidden.set(next);
    writeHidden(next);
  }

  // ——— Grille ———

  public blockStyle(p: PlacedItem): Record<string, string> {
    const width = 100 / p.columns;
    return {
      top: `${(p.startMinute / 60) * HOUR_PX}px`,
      height: `${Math.max(18, ((p.endMinute - p.startMinute) / 60) * HOUR_PX - 2)}px`,
      left: `calc(${p.column * width}% + 2px)`,
      width: `calc(${width}% - 4px)`,
      'background-color': `${p.item.color}1f`,
      'border-left-color': p.item.color,
    };
  }

  public chipStyle(item: CalendarItem): Record<string, string> {
    return { 'background-color': `${item.color}1f`, 'border-left-color': item.color };
  }

  public timeLabel(d: Date): string {
    return timeLabel(d);
  }

  public timeRange(item: CalendarItem): string {
    return timeRange(item);
  }

  public isShort(p: PlacedItem): boolean {
    return p.endMinute - p.startMinute < 45;
  }

  /** Un clic dans une colonne vide propose un rendez-vous à la demi-heure cliquée. */
  public onSlotClick(column: DayColumn, event: MouseEvent): void {
    const minutes = Math.floor(((event.offsetY / HOUR_PX) * 60) / 30) * 30;
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
    const mm = String(minutes % 60).padStart(2, '0');
    this.createAppointment(column.key, `${hh}:${mm}`);
  }

  // ——— Actions ———

  public createAppointment(day?: string, time?: string): void {
    const ref = this._sideDrawer.open<string, CreateAppointmentDrawerData, CreateAppointmentDrawer>(CreateAppointmentDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { day: day ?? dayKey(this.view() === 'month' ? new Date() : this.anchor()), time: time ?? null },
    });
    ref.closed.subscribe((id) => {
      if (id) this._load();
    });
  }

  public open(item: CalendarItem): void {
    if (item.appointment) {
      const ref = this._sideDrawer.open<AppointmentDetailDrawerResult, AppointmentDetailDrawerData, AppointmentDetailDrawer>(
        AppointmentDetailDrawer,
        { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { appointment: item.appointment } },
      );
      ref.closed.subscribe((result) => {
        if (result?.action === 'cancelled') this._load();
        if (result?.action === 'open') this._router.navigate(result.route);
      });
      return;
    }
    if (item.external) {
      this._sideDrawer.open<void, CalendarEventDrawerData, CalendarEventDrawer>(CalendarEventDrawer, {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { event: item.external },
      });
      return;
    }
    this._router.navigate(item.leadId ? ['/leads', item.leadId] : ['/tasks/my-day']);
  }

  public conflictText(c: CalendarConflict): string {
    const day = CONFLICT_DAY.format(c.appointment.start);
    const blocker = c.blockers[0];
    const others = c.blockers.length > 1 ? ` et ${c.blockers.length - 1} autre${c.blockers.length > 2 ? 's' : ''}` : '';
    return `« ${c.appointment.title} » (${day}, ${timeRange(c.appointment)}) chevauche « ${blocker.title} »`
      + `${blocker.detail ? ` — ${blocker.detail}` : ''}${others}.`;
  }

  public canMove(c: CalendarConflict): boolean {
    return !!c.freeSlot && !!c.appointment.appointment?.isOrganizer;
  }

  public moveTo(c: CalendarConflict): void {
    const id = c.appointment.appointment?.id;
    if (!id || !c.freeSlot || this.movingId()) return;
    const slot = c.freeSlot;
    this.movingId.set(id);
    this._appointmentsApi
      .rescheduleAppointment(id, { startAt: slot.toISOString(), durationMinutes: null })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          const code = err.error?.detail;
          this._snackbar.error(
            'Déplacement impossible',
            code === 'APPOINTMENT_IN_PAST'
              ? 'Ce créneau est déjà passé.'
              : code === 'NOT_APPOINTMENT_ORGANIZER'
                ? 'Seul l’organisateur peut déplacer ce rendez-vous.'
                : 'Le rendez-vous n’a pas pu être déplacé.',
          );
          return EMPTY;
        }),
        finalize(() => this.movingId.set(null)),
      )
      .subscribe(() => {
        this._snackbar.success('Rendez-vous déplacé', `Nouvel horaire : ${timeLabel(slot)}. Les invités sont prévenus.`);
        this._load();
      });
  }

  // ——— Chargements ———

  /**
   * L'agenda SANKORÉ et les agendas connectés de la période. Un numéro de séquence écarte une
   * réponse arrivée après qu'on a changé de semaine : sans lui, un aller-retour rapide afficherait
   * la semaine précédente sous le libellé de la suivante.
   */
  private _load(): void {
    const { from, to } = this.range();
    const seq = ++this._loadSeq;
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    this.isLoading.set(true);

    this._leadsApi
      .getMyAgenda(from.toISOString(), days)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Votre agenda n’a pas pu être chargé.');
          return of(null);
        }),
        finalize(() => {
          if (seq === this._loadSeq) this.isLoading.set(false);
        }),
      )
      .subscribe((agenda) => {
        if (seq === this._loadSeq) this.agenda.set(agenda);
      });

    if (!this.canConnect()) return;
    this._accountsApi
      .listMyCalendarEvents(from.toISOString(), to.toISOString())
      .pipe(
        catchError(() => {
          if (seq === this._loadSeq) {
            this.externalFailed.set(true);
            this.events.set([]);
          }
          return of(null);
        }),
      )
      .subscribe((events) => {
        if (seq !== this._loadSeq || events === null) return;
        this.externalFailed.set(false);
        this.events.set(events ?? []);
      });
  }

  private _loadTasks(): void {
    const me = this._auth.connectedUser()?.id;
    if (!me) return;
    this._tasksApi
      .listCrmTasks(undefined, me)
      .pipe(catchError(() => of([] as CrmTaskDto[])))
      .subscribe((tasks) => this.tasks.set(tasks ?? []));
  }

  private _loadAccounts(): void {
    this._accountsApi
      .listMyConnectedAccounts()
      .pipe(catchError(() => of(null)))
      .subscribe((accounts) => this.accounts.set(accounts));
  }
}

export default CalendarPage;
