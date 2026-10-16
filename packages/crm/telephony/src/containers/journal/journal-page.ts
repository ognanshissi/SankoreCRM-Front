import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  debounceTime,
  forkJoin,
  map,
  of,
  switchMap,
} from 'rxjs';
import {
  AgenciesApiService,
  AgencyDto,
  CallOutcomeDto,
  TelephonyApiService,
  TelephonyCallListItemDto,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { RecordingPlayer } from '../../components/recording-player/recording-player';
import { WrapUpForm } from '../../components/wrap-up-form/wrap-up-form';
import {
  TEL_EMPTY_LABEL,
  TelCallDirection,
  TelCallStatus,
  TelMatchStatus,
  telCallDirectionLabel,
  telCallStatusLabel,
  telCallStatusSeverity,
  telMatchStatusLabel,
  telMatchStatusSeverity,
  telRecordingStatusLabel,
  telephonyEntityTypeLabel,
} from '../../data-access/telephony-referential';
import {
  LinkCallDrawer,
  LinkCallDrawerData,
  LinkCallDrawerResult,
} from './link-call-drawer';
import {
  JOURNAL_ATTACHMENTS,
  JOURNAL_ATTACHMENT_OPTIONS,
  JOURNAL_DEFAULT_PAGE_SIZE,
  JOURNAL_DIRECTIONS,
  JOURNAL_DIRECTION_OPTIONS,
  JOURNAL_ENTITY_TYPES,
  JOURNAL_ENTITY_TYPE_OPTIONS,
  JOURNAL_PAGE_SIZE_OPTIONS,
  JOURNAL_QUEUES,
  JOURNAL_STATUSES,
  JOURNAL_STATUS_OPTIONS,
  JOURNAL_TABS,
  JournalQueue,
  JournalTabValue,
  callDurationLabel,
  csvFileName,
  endOfDayIso,
  isAttachmentSettled,
  isExportTooLarge,
  isUuid,
  journalErrorMessage,
  knownFilterValue,
  looksQualifiable,
  secondsLabel,
  startOfDayIso,
} from './journal-presentation';

/**
 * Pagination des référentiels de noms : un seul appel par page de 100, cinq pages au plus.
 *
 * Le journal ne renvoie que des uuid pour l'agent et l'agence, et un uuid affiché dans une
 * colonne n'est pas une information. Les noms sont donc résolus une fois au chargement de
 * l'écran — pas une requête par ligne — et la borne est là pour qu'un établissement de
 * trois mille utilisateurs ne déclenche pas trente requêtes à l'ouverture d'un journal.
 * Au-delà, les noms non résolus s'affichent « — » : c'est le comportement voulu, pas une
 * panne silencieuse.
 */
/** Marque d'ordre des octets UTF-8, attendue par un Excel français. */
const BOM = '\uFEFF';

const REFERENCE_PAGE_SIZE = 100;
const REFERENCE_MAX_PAGES = 5;

/**
 * TEL-F-08 — Journal des appels.
 *
 * Trois points de conception valent d'être lus avant de modifier cet écran.
 *
 * 1. **La liste est filtrée par PÉRIMÈTRE côté serveur**, et c'est le sujet de l'endpoint :
 *    un agent voit ses propres appels, ceux attribués à personne, et ceux des agences qu'il
 *    couvre. L'écran ne filtre donc rien par périmètre et ne prétend jamais montrer
 *    l'activité de tout l'établissement — la phrase sous le titre le dit, pour qu'un
 *    manager ne lise pas un total pour un autre.
 * 2. **Les onglets sont les trois `queue` du serveur**, qui sont des RÈGLES et non des
 *    combinaisons de filtres. Reconstruire « à qualifier » ici, c'est garantir qu'un jour
 *    l'écran et le serveur ne compteront plus la même chose.
 * 3. **Ni numéro de téléphone ni contenu de note n'existent dans le contrat**, par choix du
 *    back. `hasNote` dit qu'une note existe : c'est une icône, pas une colonne, et il n'y a
 *    rien à excuser dans l'interface.
 */
@Component({
  selector: 'lib-journal-page',
  templateUrl: './journal-page.html',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    Button,
    TasCard,
    TasError,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSelect,
    TasTable,
    TasTag,
    TimeagoPipe,
    RecordingPlayer,
    WrapUpForm,
  ],
})
export class JournalPage implements OnInit {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canLink = this._permissions.can('Telephony.Call.Link');

  /**
   * L'export est derrière `Telephony.Stats.View` et NON `Telephony.Call.View` : lire un
   * écran d'appels et sortir une année d'appels de l'établissement ne sont pas le même
   * acte. Le périmètre s'applique toujours par-dessus.
   */
  public readonly canExport = this._permissions.can('Telephony.Stats.View');

  /** La réparation d'un appel sans agent est un rattachement de POSTE, pas d'appel. */
  public readonly canManageUserLinks = this._permissions.can('Telephony.Settings.Manage');

  // ——— Libellés : tout vient du référentiel, rien n'est redéclaré ici ———
  public readonly directionLabel = telCallDirectionLabel;
  public readonly statusLabel = telCallStatusLabel;
  public readonly statusSeverity = telCallStatusSeverity;
  public readonly matchLabel = telMatchStatusLabel;
  public readonly matchSeverity = telMatchStatusSeverity;
  public readonly recordingLabel = telRecordingStatusLabel;
  public readonly entityTypeLabel = telephonyEntityTypeLabel;
  public readonly durationLabel = callDurationLabel;
  public readonly secondsLabel = secondsLabel;
  public readonly isSettled = isAttachmentSettled;
  public readonly emptyLabel = TEL_EMPTY_LABEL;

  public readonly tabs = JOURNAL_TABS;
  public readonly directionOptions = JOURNAL_DIRECTION_OPTIONS;
  public readonly statusOptions = JOURNAL_STATUS_OPTIONS;
  public readonly attachmentOptions = JOURNAL_ATTACHMENT_OPTIONS;
  public readonly entityTypeOptions = JOURNAL_ENTITY_TYPE_OPTIONS;

  public readonly isLoading = signal(true);
  public readonly isExporting = signal(false);
  public readonly rows = signal<TelephonyCallListItemDto[]>([]);
  public readonly totalCount = signal(0);
  public readonly loadError = signal<string | null>(null);

  /** Ligne dépliée : le détail s'ouvre sous la ligne cliquée, sans drawer. */
  public readonly expandedId = signal<string | null>(null);

  /** Ligne dépliée en mode qualification : le formulaire partagé remplace le détail. */
  public readonly qualifyingId = signal<string | null>(null);

  public readonly outcomes = signal<CallOutcomeDto[]>([]);
  public readonly recordingMode = signal<string | null>(null);

  public readonly users = signal<UserDto[]>([]);
  public readonly agencies = signal<AgencyDto[]>([]);
  public readonly directoryUnavailable = signal(false);

  public readonly filterTab = signal<JournalTabValue>('');
  public readonly filterFrom = signal<string | null>(null);
  public readonly filterTo = signal<string | null>(null);
  public readonly filterAgent = signal<string | null>(null);
  public readonly filterAgency = signal<string | null>(null);
  public readonly filterDirection = signal<string | null>(null);
  public readonly filterStatus = signal<string | null>(null);
  public readonly filterAttachment = signal<string | null>(null);
  public readonly filterOutcome = signal<string | null>(null);
  public readonly filterEntityType = signal<string | null>(null);
  public readonly filterEntityId = signal('');

  public readonly agentOptions = computed(() =>
    this.users()
      .filter((user) => !!user.id)
      .map((user) => ({ label: user.fullName || user.email || '—', value: user.id as string }))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr')),
  );

  public readonly agencyOptions = computed(() =>
    this.agencies()
      .filter((agency) => !!agency.id)
      .map((agency) => ({
        label: agency.name || agency.code || '—',
        value: agency.id as string,
      }))
      .sort((left, right) => left.label.localeCompare(right.label, 'fr')),
  );

  public readonly outcomeOptions = computed(() =>
    this.outcomes().map((outcome) => ({
      label: outcome.label || outcome.code || '—',
      value: outcome.code ?? '',
    })),
  );

  private readonly _userNames = computed(() => {
    const names = new Map<string, string>();
    for (const user of this.users()) {
      if (user.id) names.set(user.id, user.fullName || user.email || '');
    }
    return names;
  });

  private readonly _agencyNames = computed(() => {
    const names = new Map<string, string>();
    for (const agency of this.agencies()) {
      if (agency.id) names.set(agency.id, agency.name || agency.code || '');
    }
    return names;
  });

  public readonly entityIdError = computed(() => {
    const raw = this.filterEntityId().trim();
    if (!raw || isUuid(raw)) return null;
    return "L'identifiant d'une fiche est un UUID (8-4-4-4-12). Collez-le en entier.";
  });

  public readonly activeTab = computed(
    () => this.tabs.find((tab) => tab.value === this.filterTab()) ?? this.tabs[0],
  );

  public readonly isAssignTab = computed(() => this.filterTab() === 'ToAssign');

  public readonly hasActiveFilters = computed(
    () =>
      !!this.filterFrom() ||
      !!this.filterTo() ||
      !!this.filterAgent() ||
      !!this.filterAgency() ||
      !!this.filterDirection() ||
      !!this.filterStatus() ||
      !!this.filterAttachment() ||
      !!this.filterOutcome() ||
      !!this.filterEntityType() ||
      !!this.filterEntityId().trim(),
  );

  public tableConfig = signal<TableConfig>({
    property: 'callId',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: JOURNAL_DEFAULT_PAGE_SIZE,
      pageSizeOptions: JOURNAL_PAGE_SIZE_OPTIONS,
      totalElements: 0,
    },
  });

  /** Frappes de l'identifiant de fiche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  /** Un seul flux de chargement : `switchMap` annule la requête devenue obsolète. */
  private readonly _load$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Téléphonie', link: ['/settings/telephony'] },
      { label: 'Journal des appels' },
    ]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    this._setupLoader();
    this._restoreFilters();
    this._loadReferentials();
    this._load();
  }

  // ——— Résolution des noms ———

  public agentName(crmUserId: string | null | undefined): string {
    if (!crmUserId) return 'Personne';
    return this._userNames().get(crmUserId) || TEL_EMPTY_LABEL;
  }

  public agencyName(agencyId: string | null | undefined): string {
    if (!agencyId) return TEL_EMPTY_LABEL;
    return this._agencyNames().get(agencyId) || TEL_EMPTY_LABEL;
  }

  // ——— Ce que la ligne permet ———

  public canLinkRow(item: TelephonyCallListItemDto): boolean {
    return this.canLink() && !isAttachmentSettled(item);
  }

  public canCorrectRow(item: TelephonyCallListItemDto): boolean {
    return this.canLink() && isAttachmentSettled(item) && item.matchStatus !== 'Internal';
  }

  public canQualifyRow(item: TelephonyCallListItemDto): boolean {
    return looksQualifiable(item);
  }

  public outcomeText(item: TelephonyCallListItemDto): string {
    if (item.outcomeLabel) return item.outcomeLabel;
    if (item.dismissedAt) return 'Clôturé sans qualification';
    if (looksQualifiable(item)) return 'À qualifier';
    return TEL_EMPTY_LABEL;
  }

  // ——— Interactions ———

  public toggleRow(item: TelephonyCallListItemDto): void {
    const callId = item.callId;
    if (!callId) return;
    this.qualifyingId.set(null);
    this.expandedId.update((current) => (current === callId ? null : callId));
  }

  public startQualify(item: TelephonyCallListItemDto): void {
    const callId = item.callId;
    if (!callId) return;
    this.expandedId.set(callId);
    this.qualifyingId.set(callId);
  }

  public cancelQualify(): void {
    this.qualifyingId.set(null);
  }

  public onQualified(): void {
    this.qualifyingId.set(null);
    this.expandedId.set(null);
    this._snackbar.success('Appel qualifié', 'La ligne est rechargée avec son issue.');
    this._load();
  }

  public openLink(item: TelephonyCallListItemDto): void {
    if (!item.callId) return;

    const ref = this._sideDrawer.open<
      LinkCallDrawerResult | null,
      LinkCallDrawerData,
      LinkCallDrawer
    >(LinkCallDrawer, {
      data: {
        callId: item.callId,
        currentEntityType: item.entityType,
        currentEntityId: item.entityId,
      } satisfies LinkCallDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (!result) return;
      this._snackbar.success(
        'Appel rattaché',
        result.displayName
          ? `L'appel est désormais rattaché à ${result.displayName}.`
          : "L'appel est désormais rattaché à la fiche choisie.",
      );
      // Rechargement plutôt que correction sur place : le rattachement change le
      // `matchStatus` ET fait sortir la ligne de la file « À rattacher ».
      this._load();
    });
  }

  // ——— Filtres ———

  public onTabChange(value: JournalTabValue): void {
    this.filterTab.set(value);
    this.expandedId.set(null);
    this.qualifyingId.set(null);
    this._applyFilters();
  }

  public onFromChange(value: string): void {
    this.filterFrom.set(value || null);
    this._applyFilters();
  }

  public onToChange(value: string): void {
    this.filterTo.set(value || null);
    this._applyFilters();
  }

  public onAgentChange(value: string | null): void {
    this.filterAgent.set(value || null);
    this._applyFilters();
  }

  public onAgencyChange(value: string | null): void {
    this.filterAgency.set(value || null);
    this._applyFilters();
  }

  public onDirectionChange(value: string | null): void {
    this.filterDirection.set(knownFilterValue(value, JOURNAL_DIRECTIONS));
    this._applyFilters();
  }

  public onStatusChange(value: string | null): void {
    this.filterStatus.set(knownFilterValue(value, JOURNAL_STATUSES));
    this._applyFilters();
  }

  public onAttachmentChange(value: string | null): void {
    this.filterAttachment.set(knownFilterValue(value, JOURNAL_ATTACHMENTS));
    this._applyFilters();
  }

  public onOutcomeChange(value: string | null): void {
    this.filterOutcome.set(value || null);
    this._applyFilters();
  }

  public onEntityTypeChange(value: string | null): void {
    this.filterEntityType.set(knownFilterValue(value, JOURNAL_ENTITY_TYPES));
    this._applyFilters();
  }

  public onEntityIdChange(value: string | null): void {
    this.filterEntityId.set(value ?? '');
    this._search$.next();
  }

  public resetFilters(): void {
    this.filterFrom.set(null);
    this.filterTo.set(null);
    this.filterAgent.set(null);
    this.filterAgency.set(null);
    this.filterDirection.set(null);
    this.filterStatus.set(null);
    this.filterAttachment.set(null);
    this.filterOutcome.set(null);
    this.filterEntityType.set(null);
    this.filterEntityId.set('');
    this._applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    this.expandedId.set(null);
    this.qualifyingId.set(null);
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this._persistFilters();
    this._load();
  }

  public reload(): void {
    this._load();
  }

  // ——— Export CSV ———

  public exportCsv(): void {
    this.isExporting.set(true);

    this._telephonyApi
      .exportTelephonyCalls(
        startOfDayIso(this.filterFrom()),
        endOfDayIso(this.filterTo()),
        this.filterAgent() ?? undefined,
        this.filterAgency() ?? undefined,
        (this.filterDirection() as TelCallDirection | null) ?? undefined,
        (this.filterStatus() as TelCallStatus | null) ?? undefined,
        (this.filterAttachment() as TelMatchStatus | null) ?? undefined,
        this.filterOutcome() ?? undefined,
        this.filterEntityType() ?? undefined,
        this._entityIdParam(),
        this._queueParam(),
      )
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const message = journalErrorMessage(error, "L'export n'a pas abouti.");
          // Au-delà de 20 000 lignes le serveur REFUSE plutôt que de tronquer : ce n'est
          // pas une panne et le canal d'erreur le ferait lire comme telle. `SnackbarService`
          // n'a pas de `warning`, donc `info`.
          if (isExportTooLarge(error)) {
            this._snackbar.info('Période trop large', message);
          } else {
            this._snackbar.error('Export impossible', message);
          }
          this.isExporting.set(false);
          return EMPTY;
        }),
      )
      .subscribe((csv) => {
        this.isExporting.set(false);
        this._download(csv);
        this._snackbar.success(
          'Export prêt',
          'Le fichier porte les mêmes filtres et le même périmètre que cet écran.',
        );
      });
  }

  /**
   * Remise du fichier à l'utilisateur.
   *
   * Le contrat annonce `text/csv`, donc le client généré décode la réponse en CHAÎNE et non
   * en Blob — le BOM du serveur arrive en tête de cette chaîne. On ne le réécrit que s'il
   * manque : un second BOM s'afficherait dans la première cellule d'Excel. L'object URL est
   * révoqué immédiatement, et rien n'est conservé dans l'onglet.
   */
  private _download(csv: string): void {
    const content = csv.startsWith(BOM) ? csv : `${BOM}${csv}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = csvFileName(this.filterFrom(), this.filterTo());
    anchor.click();

    URL.revokeObjectURL(url);
  }

  // ——— URL ———

  private _restoreFilters(): void {
    const params = this._route.snapshot.queryParams;

    const queue = knownFilterValue(params['queue'], JOURNAL_QUEUES);
    this.filterTab.set((queue as JournalQueue | null) ?? '');

    this.filterFrom.set(params['from'] ?? null);
    this.filterTo.set(params['to'] ?? null);
    this.filterAgent.set(isUuid(params['agent']) ? params['agent'] : null);
    this.filterAgency.set(isUuid(params['agency']) ? params['agency'] : null);
    this.filterDirection.set(knownFilterValue(params['direction'], JOURNAL_DIRECTIONS));
    this.filterStatus.set(knownFilterValue(params['status'], JOURNAL_STATUSES));
    this.filterAttachment.set(knownFilterValue(params['attachment'], JOURNAL_ATTACHMENTS));
    // Le code d'issue est le référentiel du tenant, pas une énumération : aucune liste
    // connue à opposer à l'URL, on se contente de le nettoyer.
    this.filterOutcome.set((params['outcome'] as string | undefined)?.trim() || null);
    this.filterEntityType.set(knownFilterValue(params['entityType'], JOURNAL_ENTITY_TYPES));
    this.filterEntityId.set(params['entityId'] ?? '');

    const page = Number(params['page']);
    const pageSize = Number(params['pageSize']);
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        // L'URL porte le numéro de page tel que l'API le compte (1-based) ; le tableau
        // travaille en index 0-based.
        pageIndex: Number.isInteger(page) && page > 0 ? page - 1 : 0,
        pageSize: JOURNAL_PAGE_SIZE_OPTIONS.includes(pageSize)
          ? pageSize
          : JOURNAL_DEFAULT_PAGE_SIZE,
      },
    }));
  }

  private _persistFilters(): void {
    const pagination = this.tableConfig().pagination;
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        queue: this.filterTab() || null,
        from: this.filterFrom() || null,
        to: this.filterTo() || null,
        agent: this.filterAgent() || null,
        agency: this.filterAgency() || null,
        direction: this.filterDirection() || null,
        status: this.filterStatus() || null,
        attachment: this.filterAttachment() || null,
        outcome: this.filterOutcome() || null,
        entityType: this.filterEntityType() || null,
        entityId: this.filterEntityId().trim() || null,
        page: pagination.pageIndex > 0 ? pagination.pageIndex + 1 : null,
        pageSize:
          pagination.pageSize === JOURNAL_DEFAULT_PAGE_SIZE ? null : pagination.pageSize,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Point de passage unique : retour en première page, URL, rechargement. */
  private _applyFilters(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
    this._persistFilters();
    this._load();
  }

  // ——— Chargement ———

  private _queueParam(): JournalQueue | undefined {
    const tab = this.filterTab();
    return tab === '' ? undefined : tab;
  }

  private _entityIdParam(): string | undefined {
    const raw = this.filterEntityId().trim();
    // Un identifiant mal collé n'est pas envoyé : le serveur le refuserait en 400 et le
    // filtre paraîtrait actif sans l'être.
    return isUuid(raw) ? raw : undefined;
  }

  private _load(): void {
    this.isLoading.set(true);
    this._load$.next();
  }

  private _setupLoader(): void {
    this._load$
      .pipe(
        switchMap(() => {
          const pagination = this.tableConfig().pagination;

          return this._telephonyApi
            .listTelephonyCalls(
              startOfDayIso(this.filterFrom()),
              endOfDayIso(this.filterTo()),
              this.filterAgent() ?? undefined,
              this.filterAgency() ?? undefined,
              // Les champs d'énumération sont des `string` nues dans le DTO mais des
              // unions étroites en paramètre : le transtypage passe par les unions du
              // référentiel, qui sont la même liste de valeurs.
              (this.filterDirection() as TelCallDirection | null) ?? undefined,
              (this.filterStatus() as TelCallStatus | null) ?? undefined,
              (this.filterAttachment() as TelMatchStatus | null) ?? undefined,
              this.filterOutcome() ?? undefined,
              this.filterEntityType() ?? undefined,
              this._entityIdParam(),
              this._queueParam(),
              // `page` est 1-based côté API, `PageEvent.pageIndex` est 0-based.
              pagination.pageIndex + 1,
              pagination.pageSize,
            )
            .pipe(
              catchError((error: HttpErrorResponse) => {
                this.loadError.set(
                  journalErrorMessage(error, "Le journal n'a pas pu être chargé."),
                );
                this.rows.set([]);
                this.totalCount.set(0);
                this.isLoading.set(false);
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((page) => {
        this.loadError.set(null);
        this.rows.set(page.items ?? []);
        this.totalCount.set(page.totalCount ?? 0);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: page.totalCount ?? 0 },
        }));
        this.isLoading.set(false);
      });
  }

  private _loadReferentials(): void {
    // Les issues alimentent à la fois le filtre et le formulaire de qualification : une
    // seule lecture pour les deux.
    this._telephonyApi
      .listTelephonyCallOutcomes()
      .pipe(
        catchError(() => EMPTY),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((outcomes) => this.outcomes.set(outcomes));

    // La politique d'enregistrement est derrière `admin:compliance:manage`. Sans ce droit,
    // la lire répondrait 403 : on ne la demande pas, et le formulaire de qualification
    // masque alors sa case « Conserver l'enregistrement », ce qui est le repli sûr.
    if (this._permissions.has('admin:compliance:manage')) {
      this._telephonyApi
        .getTelephonyRecordingPolicy()
        .pipe(
          catchError(() => EMPTY),
          takeUntilDestroyed(this._destroyRef),
        )
        .subscribe((policy) => this.recordingMode.set(policy.mode ?? null));
    }

    this._loadAllPages((page) =>
      this._usersApi
        .listUsers(undefined, undefined, undefined, page, REFERENCE_PAGE_SIZE)
        .pipe(
          map((result) => ({
            items: result.items ?? [],
            totalCount: result.totalCount ?? 0,
          })),
        ),
    )
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((users) => this.users.set(users));

    this._loadAllPages((page) =>
      this._agenciesApi
        .listAgencies(false, page, REFERENCE_PAGE_SIZE)
        .pipe(
          map((result) => ({
            items: result.items ?? [],
            totalCount: result.totalCount ?? 0,
          })),
        ),
    )
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((agencies) => this.agencies.set(agencies));
  }

  /**
   * Lecture bornée d'un référentiel paginé.
   *
   * La première page donne le total, les suivantes sont demandées en parallèle, cinq au
   * plus. L'échec est absorbé : l'écran reste utilisable sans les noms, et le dit.
   */
  private _loadAllPages<T>(
    fetch: (page: number) => Observable<{ items: T[]; totalCount: number }>,
  ): Observable<T[]> {
    return fetch(1).pipe(
      switchMap(({ items, totalCount }) => {
        const pageCount = Math.min(
          REFERENCE_MAX_PAGES,
          Math.ceil(totalCount / REFERENCE_PAGE_SIZE),
        );
        if (pageCount <= 1) return of(items);

        const rest: Observable<{ items: T[]; totalCount: number }>[] = [];
        for (let page = 2; page <= pageCount; page += 1) rest.push(fetch(page));

        return forkJoin(rest).pipe(
          map((results) => items.concat(...results.map((result) => result.items))),
        );
      }),
      catchError(() => {
        this.directoryUnavailable.set(true);
        return EMPTY;
      }),
    );
  }
}

export default JournalPage;
