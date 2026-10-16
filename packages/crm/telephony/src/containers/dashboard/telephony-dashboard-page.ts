import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';
import {
  AgenciesApiService,
  AgencyDto,
  AgentPerformanceDto,
  LeadsAnalyticsApiService,
  TelephonyApiService,
  TelephonyStatsDto,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import {
  TEL_EMPTY_LABEL,
  telCallDirectionLabel,
  telephonyErrorMessage,
} from '../../data-access/telephony-referential';
import {
  EMPTY_LEAD_SLA_SUMMARY,
  TELEPHONY_NOBODY_HINT,
  TELEPHONY_NOBODY_LABEL,
  TELEPHONY_STATS_MAX_PERIOD_DAYS,
  answerRate,
  averageRingSeconds,
  averageTalkSeconds,
  buildTelephonyStatsCsv,
  callCount,
  dayChartColumns,
  dayChartTicks,
  dayFilterValue,
  defaultStatsPeriod,
  fillDailySeries,
  formatCount,
  formatDayLong,
  formatDuration,
  formatMinutes,
  formatPercent,
  isPeriodTooLong,
  periodDayCount,
  periodEndIso,
  periodStartIso,
  rankAgents,
  statsFreshness,
  summariseLeadSla,
  sumTelephonyRows,
  telephonyStatsCsvFileName,
  uuidFilterValue,
} from './dashboard-presentation';

const DEFAULT_PAGE_SIZE = 10;

/** BOM UTF-8, sans lequel un Excel français massacre les accents du fichier exporté. */
const UTF8_BOM = String.fromCharCode(0xfeff);

/**
 * TEL-F-12 — Tableau de bord téléphonie.
 *
 * Deux choses structurent cet écran, et aucune des deux n'est cosmétique.
 *
 * 1. **Les chiffres viennent d'une projection, pas du journal.** Elle est recalculée
 *    toutes les heures sur deux jours et toutes les nuits sur sept. L'écran affiche donc
 *    `computedAt` en permanence : un tableau de bord qui laisse croire à des chiffres
 *    temps réel est le défaut, pas celui qui annonce son retard.
 * 2. **Les appels internes sont exclus par construction.** Comptés, un agent passant la
 *    matinée à consulter son responsable devancerait celui qui la passe avec des clients.
 *    C'est dit à l'écran, parce qu'un responsable qui compare avec la console de son
 *    opérateur conclurait sinon à un chiffre manquant.
 *
 * Le délai de premier contact et la part des leads contactés dans le SLA ne sont PAS des
 * compteurs téléphoniques : ils viennent de `leads/agent-performance`, où vit l'horloge du
 * premier contact. Ils sont donc affichés à part, et masqués si l'utilisateur n'a pas le
 * droit de lire les statistiques de leads.
 */
@Component({
  selector: 'lib-telephony-dashboard-page',
  templateUrl: './telephony-dashboard-page.html',
  imports: [
    FormsModule,
    Button,
    TasCard,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSelect,
    TasSpinner,
    TasTable,
    TasTag,
  ],
})
export class TelephonyDashboardPage implements OnInit {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _leadsAnalyticsApi = inject(LeadsAnalyticsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** Le recalcul est une ÉCRITURE : il est accordé par `Telephony.Settings.Manage`, pas par la lecture. */
  public readonly canRecompute = this._permissions.can('Telephony.Settings.Manage');

  /** Les deux indicateurs de premier contact appartiennent au module Leads, et à son droit. */
  public readonly canReadLeadSla = this._permissions.can('lead:analytics:view');

  // Mises en forme liées au template.
  public readonly formatCount = formatCount;
  public readonly formatPercent = formatPercent;
  public readonly formatDuration = formatDuration;
  public readonly formatMinutes = formatMinutes;
  public readonly formatDayLong = formatDayLong;
  /** Les deux séries du graphique sont nommées par le référentiel, pas par deux chaînes locales. */
  public readonly directionLabel = telCallDirectionLabel;
  public readonly nobodyLabel = TELEPHONY_NOBODY_LABEL;
  public readonly nobodyHint = TELEPHONY_NOBODY_HINT;

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly stats = signal<TelephonyStatsDto | null>(null);

  public readonly isLeadSlaLoading = signal(false);
  public readonly leadSlaError = signal<string | null>(null);
  public readonly leadSla = signal(EMPTY_LEAD_SLA_SUMMARY);

  public readonly isRecomputing = signal(false);

  private readonly _period = defaultStatsPeriod();
  public readonly filterFrom = signal(this._period.from);
  public readonly filterTo = signal(this._period.to);
  public readonly filterAgencyId = signal<string | null>(null);
  public readonly filterAgentId = signal<string | null>(null);

  private readonly _users = signal<Map<string, string>>(new Map());
  private readonly _agencies = signal<AgencyDto[]>([]);

  public readonly agencyOptions = computed(() =>
    this._agencies().map((agency) => ({
      label: agency.name || agency.code || TEL_EMPTY_LABEL,
      value: agency.id ?? '',
    })),
  );

  public readonly agentOptions = computed(() =>
    [...this._users().entries()]
      .map(([id, name]) => ({ label: name, value: id }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr')),
  );

  private readonly _agencyNames = computed(() => {
    const names = new Map<string, string>();
    for (const agency of this._agencies()) {
      if (agency.id) names.set(agency.id, agency.name || agency.code || TEL_EMPTY_LABEL);
    }
    return names;
  });

  // ——— Période ———

  public readonly periodDays = computed(() => periodDayCount(this.filterFrom(), this.filterTo()));

  /**
   * La période est vérifiée AVANT l'appel. Le serveur refuse au-delà de 400 jours en 422
   * (`TELEPHONY_STATS_PERIOD_TOO_LONG`) sans rien tronquer : autant nommer le problème à
   * côté des dates plutôt qu'après un aller-retour, dans un bandeau d'erreur.
   */
  public readonly periodError = computed(() => {
    const from = this.filterFrom();
    const to = this.filterTo();
    if (!from || !to) return 'Renseignez les deux bornes de la période.';
    if (periodDayCount(from, to) === null) {
      return 'La date de fin précède la date de début.';
    }
    if (isPeriodTooLong(from, to)) {
      return `La période dépasse ${TELEPHONY_STATS_MAX_PERIOD_DAYS} jours, le maximum accepté par le serveur. Resserrez les dates : la demande serait refusée, pas tronquée.`;
    }
    return null;
  });

  public readonly hasActiveFilters = computed(
    () =>
      this.filterFrom() !== this._period.from ||
      this.filterTo() !== this._period.to ||
      !!this.filterAgencyId() ||
      !!this.filterAgentId(),
  );

  // ——— Indicateurs ———

  public readonly totals = computed(() => sumTelephonyRows(this.stats()?.totals));
  public readonly calls = computed(() => callCount(this.totals()));
  public readonly answerRate = computed(() => answerRate(this.totals()));
  public readonly averageTalkSeconds = computed(() => averageTalkSeconds(this.totals()));
  public readonly averageRingSeconds = computed(() => averageRingSeconds(this.totals()));

  public readonly freshness = computed(() => statsFreshness(this.stats()?.computedAt));

  /** Bornes telles que le SERVEUR les a retenues : il peut avoir appliqué ses valeurs par défaut. */
  public readonly servedFrom = computed(() => this.stats()?.from ?? this.filterFrom());
  public readonly servedTo = computed(() => this.stats()?.to ?? this.filterTo());

  public readonly dayPoints = computed(() =>
    fillDailySeries(this.stats()?.days, this.servedFrom(), this.servedTo()),
  );

  public readonly chartColumns = computed(() => dayChartColumns(this.dayPoints()));
  public readonly chartTicks = computed(() => dayChartTicks(this.dayPoints()));
  public readonly chartPeak = computed(() =>
    this.chartColumns().reduce((peak, column) => Math.max(peak, column.total), 0),
  );

  public readonly agentRows = computed(() => rankAgents(this.stats()?.totals));

  /** Le bucket « personne » n'apparaît que pour qui voit tout l'établissement : on l'explique alors. */
  public readonly hasNobodyBucket = computed(() =>
    this.agentRows().some((row) => row.crmUserId === null),
  );

  public readonly canExport = computed(() => (this.stats()?.days ?? []).length > 0);

  public tableConfig = signal<TableConfig>({
    property: 'key',
    pagination: {
      // Le classement n'est pas paginé par le serveur : `getTelephonyStats` renvoie TOUS
      // les buckets de la période en une fois. La pagination est donc locale, et c'est le
      // seul cas de l'écran où elle l'est.
      serverSide: false,
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      pageSizeOptions: [10, 20, 50],
    },
  });

  private readonly _load$ = new Subject<void>();
  private readonly _loadLeadSla$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Téléphonie', link: ['/settings/telephony'] },
      { label: 'Indicateurs' },
    ]);

    this._setupLoaders();
    this._restoreFilters();
    this._loadAgencies();
    this._loadUsers();
    this._load();
  }

  // ——— Résolution des noms ———

  /**
   * `TelephonyStatsRowDto` ne porte que des uuid. Un uuid affiché dans une cellule ne
   * veut rien dire pour un responsable : un nom introuvable rend « — », jamais
   * l'identifiant technique. Un `crmUserId` NUL est autre chose qu'un nom manquant : c'est
   * le bucket « personne », et il est nommé comme tel.
   */
  public agentName(crmUserId: string | null | undefined): string {
    if (crmUserId === null || crmUserId === undefined) return TELEPHONY_NOBODY_LABEL;
    return this._users().get(crmUserId) ?? TEL_EMPTY_LABEL;
  }

  public agencyName(agencyId: string | null | undefined): string {
    if (agencyId === null || agencyId === undefined) return TELEPHONY_NOBODY_LABEL;
    return this._agencyNames().get(agencyId) ?? TEL_EMPTY_LABEL;
  }

  /** Une ligne peut porter plusieurs agences : l'agence est estampillée sur l'appel, pas jointe à l'agent. */
  public agenciesLabel(agencyIds: ReadonlyArray<string | null>): string {
    if (agencyIds.length === 0) return TEL_EMPTY_LABEL;
    if (agencyIds.length === 1) return this.agencyName(agencyIds[0]);
    return `${agencyIds.length} agences`;
  }

  // ——— Filtres ———

  public onFromChange(value: string): void {
    this.filterFrom.set(dayFilterValue(value) ?? '');
    this._applyFilters();
  }

  public onToChange(value: string): void {
    this.filterTo.set(dayFilterValue(value) ?? '');
    this._applyFilters();
  }

  public onAgencyChange(value: string | null): void {
    this.filterAgencyId.set(uuidFilterValue(value));
    this._applyFilters();
  }

  public onAgentChange(value: string | null): void {
    this.filterAgentId.set(uuidFilterValue(value));
    this._applyFilters();
  }

  public resetFilters(): void {
    this.filterFrom.set(this._period.from);
    this.filterTo.set(this._period.to);
    this.filterAgencyId.set(null);
    this.filterAgentId.set(null);
    this._applyFilters();
  }

  public reload(): void {
    this._load();
  }

  // ——— Export ———

  /**
   * Export construit CÔTÉ CLIENT : le serveur n'expose pas d'export des indicateurs.
   * Ici c'est sans perte, contrairement au journal : la réponse contient déjà toutes les
   * lignes de la période, donc le fichier est complet et non une page.
   */
  public exportCsv(): void {
    const current = this.stats();
    const days = current?.days ?? [];
    if (days.length === 0) {
      this._snackbar.info(
        'Rien à exporter',
        "Aucun appel sur cette période : le fichier n'aurait que son en-tête.",
      );
      return;
    }

    const csv = buildTelephonyStatsCsv(days, {
      agentName: (id) => this.agentName(id),
      agencyName: (id) => this.agencyName(id),
    });

    // BOM UTF-8 et point-virgule, comme l'export du journal côté serveur : un Excel
    // français ouvre un fichier à virgules en une seule colonne et massacre les accents
    // sans BOM.
    // Le BOM est construit par code et non collé en clair : un U+FEFF littéral dans
    // la source est invisible, et le prochain « nettoyage » d'espaces l'emporterait.
    const blob = new Blob([`${UTF8_BOM}${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = telephonyStatsCsvFileName(this.servedFrom(), this.servedTo());
    anchor.click();
    URL.revokeObjectURL(url);

    this._snackbar.success(
      'Export téléchargé',
      `${formatCount(days.length)} ligne(s), au grain jour × agent × agence.`,
    );
  }

  // ——— Recalcul ———

  public confirmRecompute(): void {
    const from = this.filterFrom();
    const to = this.filterTo();
    if (this.periodError() || !from || !to) return;

    this._confirm.confirm({
      title: 'Recalculer les indicateurs de cette période ?',
      message:
        "Les compteurs de la période seront recomptés depuis le journal des appels et remplacés. L'opération est idempotente : la relancer donne le même résultat, rien n'est incrémenté. Utile après avoir corrigé le « compte comme contact » d'un résultat d'appel ou réattribué des appels — la tâche de nuit ne remonte que sept jours.",
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Recalculer', theme: 'primary' },
      rejectButtonProps: { label: 'Fermer' },
      accept: () => this._recompute(from, to),
    });
  }

  private _recompute(from: string, to: string): void {
    this.isRecomputing.set(true);
    this._telephonyApi
      .recomputeTelephonyStats({ from, to })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Recalcul impossible',
            telephonyErrorMessage(error, "Le recalcul n'a pas abouti."),
          );
          this.isRecomputing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((rewritten) => {
        this.isRecomputing.set(false);
        this._snackbar.success(
          'Indicateurs recalculés',
          `${formatCount(rewritten)} compteur(s) réécrit(s) depuis le journal.`,
        );
        this._load();
      });
  }

  // ——— URL ———

  private _restoreFilters(): void {
    const params = this._route.snapshot.queryParams;

    this.filterFrom.set(dayFilterValue(params['from']) ?? this._period.from);
    this.filterTo.set(dayFilterValue(params['to']) ?? this._period.to);
    this.filterAgencyId.set(uuidFilterValue(params['agencyId']));
    this.filterAgentId.set(uuidFilterValue(params['agentId']));
  }

  private _persistFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        from: this.filterFrom() === this._period.from ? null : this.filterFrom() || null,
        to: this.filterTo() === this._period.to ? null : this.filterTo() || null,
        agencyId: this.filterAgencyId() || null,
        agentId: this.filterAgentId() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Point de passage unique : URL, retour en première page du classement, rechargement. */
  private _applyFilters(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
    this._persistFilters();
    this._load();
  }

  // ——— Chargement ———

  private _load(): void {
    if (this.periodError()) {
      this.isLoading.set(false);
      return;
    }
    this.isLoading.set(true);
    this.loadError.set(null);
    this._load$.next();

    if (this.canReadLeadSla()) {
      this.isLeadSlaLoading.set(true);
      this.leadSlaError.set(null);
      this._loadLeadSla$.next();
    }
  }

  private _setupLoaders(): void {
    this._load$
      .pipe(
        switchMap(() =>
          this._telephonyApi
            .getTelephonyStats(
              this.filterFrom(),
              this.filterTo(),
              this.filterAgencyId() ?? undefined,
              this.filterAgentId() ?? undefined,
            )
            .pipe(
              catchError((error: HttpErrorResponse) => {
                this.loadError.set(
                  telephonyErrorMessage(error, "Les indicateurs n'ont pas pu être chargés."),
                );
                this.stats.set(null);
                this.isLoading.set(false);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((stats) => {
        this.stats.set(stats);
        this.isLoading.set(false);
      });

    this._loadLeadSla$
      .pipe(
        switchMap(() =>
          this._leadsAnalyticsApi
            .getAgentPerformance(
              periodStartIso(this.filterFrom()),
              periodEndIso(this.filterTo()),
              this.filterAgentId() ?? undefined,
              this.filterAgencyId() ?? undefined,
            )
            .pipe(
              catchError((error: HttpErrorResponse) => {
                // L'écran reste utilisable sans ces deux tuiles : ce sont des chiffres du
                // module Leads, et leur absence ne doit pas masquer les compteurs
                // téléphoniques qui, eux, ont répondu.
                this.leadSlaError.set(
                  error.status === 403
                    ? "Vous n'avez pas accès aux indicateurs de leads : le délai de premier contact n'est pas affiché."
                    : "Le délai de premier contact n'a pas pu être chargé.",
                );
                this.leadSla.set(EMPTY_LEAD_SLA_SUMMARY);
                this.isLeadSlaLoading.set(false);
                return EMPTY;
              }),
            ),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((rows: AgentPerformanceDto[]) => {
        this.leadSla.set(summariseLeadSla(rows));
        this.isLeadSlaLoading.set(false);
      });
  }

  private _loadAgencies(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(
        catchError(() => {
          // Sans la liste, l'écran reste lisible : les agences s'affichent « — » et le
          // filtre reste vide, au lieu de faire échouer le tableau de bord entier.
          return EMPTY;
        }),
      )
      .subscribe((page) => this._agencies.set(page.items ?? []));
  }

  private _loadUsers(): void {
    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => {
        const names = new Map<string, string>();
        for (const user of (result.items ?? []) as UserDto[]) {
          if (!user.id) continue;
          // `fullName || email` est la convention du repo ; à défaut des deux on laisse
          // « — » plutôt qu'un uuid.
          names.set(user.id, user.fullName || user.email || TEL_EMPTY_LABEL);
        }
        this._users.set(names);
      });
  }
}

export default TelephonyDashboardPage;
