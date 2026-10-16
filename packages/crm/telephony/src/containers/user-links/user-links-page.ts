import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  MyTelephonyStatusDto,
  TelephonyApiService,
  TelephonyDirectoryDto,
  TelephonyUserLinkDto,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, concatMap, debounceTime, EMPTY, from, of, Subject, toArray } from 'rxjs';
import { telephonyErrorMessage } from '../../data-access/telephony-referential';
import { CallerNumberDrawer, CallerNumberDrawerData } from './caller-number-drawer';
import { LinkUserDrawer, LinkUserDrawerData } from './link-user-drawer';
import { TelephonyUserLinksBadgeService } from './telephony-user-links-badge.service';
import { UnlinkUserDrawer, UnlinkUserDrawerData } from './unlink-user-drawer';
import {
  agencyOptions,
  brokenLinkCount,
  buildUserLinkRows,
  filterUserLinkRows,
  isProposalApplicable,
  USER_LINK_STATE_FILTER_OPTIONS,
  UserLinkRow,
} from './user-link-presentation';

/**
 * Rattachement des postes aux utilisateurs (TEL-F-02).
 *
 * L'écran lit DEUX sources et ne les confond pas :
 *
 * - `GET telephony/user-links` tient les rattachements. Il ne parle jamais au
 *   fournisseur, donc il répond même fournisseur à terre : c'est la liste, toujours.
 * - `GET telephony/directory` lit l'annuaire EN DIRECT et propose un appariement par
 *   e-mail. Ce seul appel EST « importer l'annuaire » ET « proposer par e-mail » : les
 *   propositions sont ses champs `proposed*`, et `ambiguousEmails` est ce sur quoi il a
 *   refusé de deviner. Son échec est donc une panne du FOURNISSEUR, affichée comme telle,
 *   et jamais un annuaire vide — les rattachements restent affichés et modifiables.
 *
 * Aucune proposition n'est appliquée automatiquement : « A proposal is never applied ».
 * Un clic la confirme, ligne par ligne ou en lot.
 */
@Component({
  selector: 'lib-user-links-page',
  templateUrl: './user-links-page.html',
  imports: [
    FormsModule,
    Button,
    TasCard,
    TasCheckbox,
    TasIcon,
    TasSpinner,
    TasTable,
    TasTag,
    TasSelect,
    TasInput,
    TasFormField,
    TasLabel,
    TimeagoPipe,
  ],
})
export class UserLinksPage implements OnInit {
  private readonly _api = inject(TelephonyApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _badge = inject(TelephonyUserLinksBadgeService);

  public readonly isLoading = signal(true);
  public readonly isImporting = signal(false);
  public readonly isApplying = signal(false);
  public readonly loadError = signal<string | null>(null);

  /** Panne de l'annuaire, distincte d'un échec de chargement de l'écran. */
  public readonly directoryError = signal<string | null>(null);

  public readonly links = signal<TelephonyUserLinkDto[]>([]);
  public readonly directory = signal<TelephonyDirectoryDto | null>(null);
  public readonly users = signal<UserDto[]>([]);
  public readonly usersUnavailable = signal(false);
  public readonly myStatus = signal<MyTelephonyStatusDto | null>(null);

  public readonly includeDisabled = signal(false);

  public readonly filterState = signal<string | null>(null);
  public readonly filterAgency = signal<string | null>(null);
  public readonly searchQuery = signal('');

  /** Propositions cochées, par identifiant de compte fournisseur. */
  public readonly selectedAccounts = signal<ReadonlySet<string>>(new Set<string>());

  public readonly stateOptions = USER_LINK_STATE_FILTER_OPTIONS.map((option) => ({
    label: option.label,
    value: option.value,
  }));

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  private readonly _search$ = new Subject<string>();

  public readonly usersById = computed<Record<string, UserDto>>(() => {
    const map: Record<string, UserDto> = {};
    for (const user of this.users()) {
      if (user.id) map[user.id] = user;
    }
    return map;
  });

  public readonly rows = computed(() =>
    buildUserLinkRows({
      links: this.links(),
      directory: this.directory(),
      usersById: this.usersById(),
    }),
  );

  public readonly filteredRows = computed(() =>
    filterUserLinkRows(this.rows(), {
      state: this.filterState(),
      agency: this.filterAgency(),
      search: this.searchQuery(),
    }),
  );

  public readonly agencyFilterOptions = computed(() => agencyOptions(this.rows()));

  public readonly applicableProposals = computed(() =>
    this.rows().filter((row) => isProposalApplicable(row)),
  );

  public readonly brokenCount = computed(() => brokenLinkCount(this.links()));

  public readonly selectedCount = computed(() => this.selectedAccounts().size);

  public readonly hasActiveFilter = computed(
    () =>
      this.filterState() !== null ||
      this.filterAgency() !== null ||
      this.searchQuery().trim() !== '',
  );

  public readonly isEmpty = computed(
    () => !this.isLoading() && !this.loadError() && this.rows().length === 0,
  );

  /**
   * Comptes que le drawer de rattachement peut proposer : ceux de l'annuaire encore
   * libres, plus les postes DÉTACHÉS — rattacher le même couple réactive la ligne
   * existante, et les exclure aurait rendu la réactivation impossible depuis l'écran.
   */
  public readonly availableAccounts = computed(() =>
    this.rows().filter(
      (row) => !!row.externalUserId && (!row.linkId || row.state === 'Disabled'),
    ),
  );

  public readonly linkedCrmUserIds = computed(() =>
    this.links()
      .filter((link) => link.status === 'Active' || link.status === 'Broken')
      .map((link) => link.crmUserId)
      .filter((id): id is string => !!id),
  );

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Téléphonie', link: ['/settings/telephony/journal'] },
      { label: 'Rattachement des postes' },
    ]);

    /**
     * Recherche debouncée à 300 ms et persistée dans l'URL, comme les autres listes. Le
     * spinner ne recouvre QUE la table : s'il remplaçait l'écran, le champ de recherche
     * serait détruit à chaque frappe et perdrait le focus.
     */
    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe((query) => {
        this.searchQuery.set(query);
        this._resetPage();
        this._persistFilters();
      });

    const params = this._route.snapshot.queryParams;
    if (params['etat']) this.filterState.set(params['etat']);
    if (params['agence']) this.filterAgency.set(params['agence']);
    if (params['q']) this.searchQuery.set(params['q']);
    if (params['detaches'] === '1') this.includeDisabled.set(true);

    this._loadUsers();
    this._loadMyStatus();
    this._loadLinks();
    this._loadDirectory(false);
  }

  // ——— Filtres ———

  public onSearchInput(query: string): void {
    this._search$.next(query);
  }

  public onFilterChange(key: 'etat' | 'agence', value: string | null): void {
    if (key === 'etat') this.filterState.set(value);
    else this.filterAgency.set(value);
    this._resetPage();
    this._persistFilters();
  }

  public clearFilters(): void {
    this.filterState.set(null);
    this.filterAgency.set(null);
    this.searchQuery.set('');
    this._resetPage();
    this._persistFilters();
  }

  public toggleIncludeDisabled(value: boolean): void {
    this.includeDisabled.set(value);
    this._persistFilters();
    this._loadLinks();
  }

  // ——— Sélection des propositions ———

  public isSelected(row: UserLinkRow): boolean {
    return this.selectedAccounts().has(row.externalUserId);
  }

  /**
   * Sélection tenue à la main plutôt que par `rowSelectionMaster` / `rowSelectionItem` :
   * ces directives câblent leurs abonnements une seule fois, à l'`AfterViewInit`, et par
   * INDEX de ligne. Après un rechargement — et l'écran recharge après chaque
   * rattachement — les cases cochées désigneraient la ligne qui occupe maintenant la
   * position, c'est-à-dire potentiellement le poste d'un autre agent.
   */
  public toggleSelection(row: UserLinkRow, checked: boolean): void {
    this.selectedAccounts.update((current) => {
      const next = new Set(current);
      if (checked) next.add(row.externalUserId);
      else next.delete(row.externalUserId);
      return next;
    });
  }

  public selectAllProposals(): void {
    this.selectedAccounts.set(
      new Set(this.applicableProposals().map((row) => row.externalUserId)),
    );
  }

  public clearSelection(): void {
    this.selectedAccounts.set(new Set<string>());
  }

  // ——— Écritures ———

  public applyProposal(row: UserLinkRow): void {
    if (!isProposalApplicable(row)) return;
    this._applyProposals([row]);
  }

  public applySelectedProposals(): void {
    const selected = this.selectedAccounts();
    const rows = this.applicableProposals().filter((row) =>
      selected.has(row.externalUserId),
    );
    if (rows.length === 0) return;
    this._applyProposals(rows);
  }

  public openLinkDrawer(row?: UserLinkRow): void {
    const data: LinkUserDrawerData = {
      availableAccounts: this.availableAccounts(),
      users: this.users(),
      linkedCrmUserIds: this.linkedCrmUserIds(),
      externalUserId: row?.externalUserId ?? null,
      directoryAvailable: this.directory() !== null,
    };

    const ref = this._sideDrawerService.open<boolean, LinkUserDrawerData, LinkUserDrawer>(
      LinkUserDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((saved) => {
      if (saved) this._reloadAfterWrite();
    });
  }

  public openCallerNumber(row: UserLinkRow): void {
    if (!row.linkId) return;

    const data: CallerNumberDrawerData = { row };
    const ref = this._sideDrawerService.open<
      boolean,
      CallerNumberDrawerData,
      CallerNumberDrawer
    >(CallerNumberDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((saved) => {
      if (saved) this._reloadAfterWrite();
    });
  }

  public openUnlink(row: UserLinkRow): void {
    if (!row.linkId) return;

    const data: UnlinkUserDrawerData = { row };
    const ref = this._sideDrawerService.open<boolean, UnlinkUserDrawerData, UnlinkUserDrawer>(
      UnlinkUserDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data },
    );

    ref.closed.subscribe((unlinked) => {
      if (unlinked) this._reloadAfterWrite();
    });
  }

  // ——— Chargements ———

  public refresh(): void {
    this._loadLinks();
  }

  /**
   * « Importer l'annuaire » : un seul appel, qui lit le fournisseur en direct et rend ses
   * propositions. Il n'écrit rien — c'est la confirmation qui écrit.
   */
  public importDirectory(): void {
    this._loadDirectory(true);
  }

  public openConnection(): void {
    const connectionId = this.myStatus()?.connectionId;
    this._router.navigate(
      connectionId
        ? ['/settings/integrations/connections', connectionId]
        : ['/settings/integrations/connections'],
    );
  }

  private _applyProposals(rows: UserLinkRow[]): void {
    this.isApplying.set(true);

    const failures: string[] = [];
    let applied = 0;

    /**
     * Séquentiel (`concatMap`), pas en parallèle : le serveur refuse en 409 un compte ou
     * un utilisateur déjà pris, et deux confirmations simultanées sur le même utilisateur
     * se répondraient l'une à l'autre. Un échec n'arrête pas le lot — il est collecté et
     * nommé à la fin, sinon valider vingt propositions s'arrêterait sur la première
     * anomalie sans dire laquelle.
     */
    from(rows)
      .pipe(
        concatMap((row) =>
          this._api
            .linkTelephonyUser({
              crmUserId: row.proposedCrmUserId as string,
              externalUserId: row.externalUserId,
              externalEmail: row.externalEmail === '—' ? null : row.externalEmail,
              defaultCallerNumber: null,
            })
            .pipe(
              catchError((error: HttpErrorResponse) => {
                failures.push(
                  `${row.proposedCrmUserName ?? row.externalEmail} : ${telephonyErrorMessage(
                    error,
                    'refus du serveur',
                  )}`,
                );
                return of(null);
              }),
            ),
        ),
        toArray(),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((results) => {
        applied = results.filter((result) => result !== null).length;
        this.isApplying.set(false);
        this.clearSelection();

        if (applied > 0) {
          this._snackbar.success(
            applied === 1 ? 'Proposition validée' : `${applied} propositions validées`,
            'Les appels de ces comptes seront attribués à leurs utilisateurs.',
          );
        }

        if (failures.length > 0) {
          // `SnackbarService` n'a pas de `warning` : un refus est une anomalie à corriger,
          // donc `error`, avec le détail de la première ligne en cause.
          this._snackbar.error(
            failures.length === 1
              ? 'Une proposition a été refusée'
              : `${failures.length} propositions ont été refusées`,
            failures[0],
          );
        }

        this._reloadAfterWrite();
      });
  }

  private _reloadAfterWrite(): void {
    this._loadLinks();
    // L'annuaire est relu aussi : un compte qui vient d'être rattaché ne doit plus
    // apparaître comme une proposition en attente.
    this._loadDirectory(false);
  }

  private _loadLinks(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .listTelephonyUserLinks(this.includeDisabled())
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            telephonyErrorMessage(
              error,
              "La liste des rattachements n'a pas pu être chargée. Réessayez dans un instant.",
            ),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((links) => {
        const rows = links ?? [];
        this.links.set(rows);
        this.isLoading.set(false);
        // Le badge du menu est alimenté par la liste déjà chargée : un second appel
        // n'apprendrait rien et doublerait la charge à chaque écriture.
        this._badge.setFromLinks(rows);
      });
  }

  private _loadDirectory(announce: boolean): void {
    this.isImporting.set(true);
    this.directoryError.set(null);

    this._api
      .getTelephonyDirectory()
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.directory.set(null);
          this.directoryError.set(this._directoryErrorMessage(error));
          this.isImporting.set(false);
          return EMPTY;
        }),
      )
      .subscribe((directory) => {
        this.directory.set(directory ?? { entries: [], ambiguousEmails: [] });
        this.isImporting.set(false);

        if (announce) {
          const count = directory?.entries?.length ?? 0;
          this._snackbar.success(
            'Annuaire importé',
            count === 0
              ? "Le fournisseur n'a listé aucun compte."
              : `${count} compte(s) lu(s) chez le fournisseur. Les propositions restent à confirmer.`,
          );
        }
      });
  }

  private _loadUsers(): void {
    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(
        catchError(() => {
          // L'écran reste utilisable sans : l'agence et le choix d'un utilisateur sont
          // alors indisponibles, et c'est dit en tête plutôt que rendu par une colonne
          // vide qu'on prendrait pour une absence d'agence.
          this.usersUnavailable.set(true);
          return EMPTY;
        }),
      )
      .subscribe((result) => this.users.set(result?.items ?? []));
  }

  private _loadMyStatus(): void {
    // Aucune permission requise, et c'est la seule lecture qui dise si une connexion
    // téléphonie est ACTIVE — sans elle, l'annuaire répond 422 et tout l'écran est inerte.
    this._api
      .getMyTelephonyStatus()
      .pipe(catchError(() => EMPTY))
      .subscribe((status) => this.myStatus.set(status));
  }

  /**
   * Les trois refus de l'annuaire sont trois réparations différentes, et le contrat le dit
   * explicitement. Deux d'entre eux portent un code de la famille INTÉGRATION, que le
   * référentiel téléphonie ne traduit pas : ils sont donc nommés ici, et tout le reste
   * repart dans `telephonyErrorMessage`.
   */
  private _directoryErrorMessage(error: HttpErrorResponse): string {
    const code = (error?.error as { error?: string } | undefined)?.error;

    if (error?.status === 503 || code === 'INTEGRATION_UNAVAILABLE') {
      return "Le fournisseur de téléphonie est injoignable : l'annuaire n'a pas pu être lu. Ce n'est pas un annuaire vide — les rattachements ci-dessous sont à jour et restent modifiables. Réessayez dans quelques minutes.";
    }

    if (code === 'INTEGRATION_CAPABILITY_NOT_SUPPORTED') {
      return "Votre fournisseur de téléphonie ne publie pas d'annuaire : les rattachements se font à la main, poste par poste. Il n'y a rien à importer.";
    }

    return telephonyErrorMessage(error, "L'annuaire du fournisseur n'a pas pu être lu.");
  }

  private _resetPage(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
  }

  private _persistFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        etat: this.filterState(),
        agence: this.filterAgency(),
        q: this.searchQuery().trim() || null,
        detaches: this.includeDisabled() ? '1' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export default UserLinksPage;
