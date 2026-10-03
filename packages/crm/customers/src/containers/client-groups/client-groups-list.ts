import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, catchError, debounceTime, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { AgenciesApiService, ClientGroupsApiService, GroupListItemDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';

import { CreateGroupDrawer } from './create-group-drawer';
import {
  GROUP_STATUS_OPTIONS,
  GROUP_TYPE_OPTIONS,
  groupStatusLabel,
  groupStatusSeverity,
  groupStatusToParam,
  groupTypeLabel,
  groupTypeToParam,
} from './group-labels';

@Component({
  selector: 'client-groups-list',
  templateUrl: './client-groups-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    TasCard,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TasSpinner,
    TasTag,
    TasIcon,
  ],
})
export class ClientGroupsListPage implements OnInit {
  private readonly _clientGroupsApiService = inject(ClientGroupsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** La lecture tient à `customers:read` ; toute écriture sur un groupe exige ce droit. */
  public readonly canManage = this._permissions.can('customers:groups_manage');

  public readonly typeOptions = GROUP_TYPE_OPTIONS;
  public readonly statusOptions = GROUP_STATUS_OPTIONS;
  public readonly groupTypeLabel = groupTypeLabel;
  public readonly groupStatusLabel = groupStatusLabel;
  public readonly groupStatusSeverity = groupStatusSeverity;

  public isLoading = signal(true);
  public groups = signal<GroupListItemDto[]>([]);
  public totalCount = signal(0);
  public hasMore = signal(false);

  public filterQuery = signal('');
  public filterType = signal<string | null>(null);
  public filterStatus = signal<string | null>(null);
  public filterAgencyId = signal<string | null>(null);

  public agencyOptions = signal<{ label: string; value: string }[]>([]);
  private readonly _agencyNames = computed(() => {
    const map = new Map<string, string>();
    for (const option of this.agencyOptions()) map.set(option.value, option.label);
    return map;
  });

  public readonly hasActiveFilter = computed(
    () =>
      !!this.filterQuery() ||
      !!this.filterType() ||
      !!this.filterStatus() ||
      !!this.filterAgencyId(),
  );

  /** Frappes de recherche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  private _page = 1;
  private readonly _pageSize = 25;

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Clients', link: ['/customers'] },
      { label: 'Groupes' },
    ]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    const params = this._route.snapshot.queryParams;
    if (params['q']) this.filterQuery.set(params['q']);
    if (params['type']) this.filterType.set(params['type']);
    if (params['status']) this.filterStatus.set(params['status']);
    if (params['agence']) this.filterAgencyId.set(params['agence']);

    this._loadAgencies();
    this._load(true);
  }

  /**
   * `constitutionDate` arrive en `yyyy-MM-dd`. `DatePipe` l'interprète en UTC et
   * peut afficher la veille selon le fuseau : le découpage de la chaîne ne
   * décale rien.
   */
  public formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  public agencyName(agencyId: string | null | undefined): string {
    if (!agencyId) return '—';
    return this._agencyNames().get(agencyId) ?? '—';
  }

  /**
   * La recherche texte passe par un debounce : sans lui, chaque frappe
   * déclenchait un appel HTTP. Les listes déroulantes restent immédiates,
   * un clic étant déjà une intention ferme.
   */
  public onSearchChange(value: string | null): void {
    this.filterQuery.set(value ?? '');
    this._search$.next();
  }

  public onFilterChange(key: 'type' | 'status' | 'agence', value: string | null): void {
    switch (key) {
      case 'type':   this.filterType.set(value); break;
      case 'status': this.filterStatus.set(value); break;
      case 'agence': this.filterAgencyId.set(value); break;
    }
    this._applyFilters();
  }

  public resetFilters(): void {
    this.filterQuery.set('');
    this.filterType.set(null);
    this.filterStatus.set(null);
    this.filterAgencyId.set(null);
    this._applyFilters();
  }

  public openGroup(group: GroupListItemDto): void {
    if (!group.id) return;
    this._router.navigate(['/customers/groupes', group.id]);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateGroupDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    // Un groupe naît vide : on enchaîne sur sa fiche, seul endroit où l'on
    // compose le bureau et les membres.
    ref.closed.subscribe((groupId) => {
      if (typeof groupId === 'string' && groupId) {
        this._router.navigate(['/customers/groupes', groupId]);
      }
    });
  }

  public loadMore(): void {
    this._page++;
    this._load(false);
  }

  /** Point de passage unique : URL, retour en page 1, rechargement. */
  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery() || null,
        type: this.filterType() || null,
        status: this.filterStatus() || null,
        agence: this.filterAgencyId() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    this._page = 1;
    this._load(true);
  }

  private _load(reset: boolean): void {
    if (reset) this.isLoading.set(true);

    this._clientGroupsApiService
      .listClientGroups(
        groupTypeToParam(this.filterType()),
        groupStatusToParam(this.filterStatus()),
        this.filterAgencyId() ?? undefined,
        this.filterQuery() || undefined,
        this._page,
        this._pageSize,
      )
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'Impossible de charger les groupes.');
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const items = result.items ?? [];
        if (reset) this.groups.set(items);
        else this.groups.update((previous) => [...previous, ...items]);
        this.totalCount.set(result.totalCount ?? 0);
        this.hasMore.set(result.hasNextPage ?? false);
        this.isLoading.set(false);
      });
  }

  private _loadAgencies(): void {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => {
        this.agencyOptions.set(
          (result.items ?? []).map((agency) => ({
            label: agency.name ?? agency.code ?? '',
            value: agency.id ?? '',
          })),
        );
      });
  }
}

export default ClientGroupsListPage;
