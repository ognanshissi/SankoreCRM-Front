import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router } from '@angular/router';
import { ConnectionListDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { catchError, EMPTY, Subject, switchMap } from 'rxjs';
import { ConnectionHealthBadgeComponent } from '../../components/connection-health-badge';
import {
  integrationErrorMessage,
  IntegrationFacadeService,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_FAMILIES,
  CONNECTION_FAMILY_LABELS,
  CONNECTION_KIND_LABELS,
  CONNECTION_MODE_LABELS,
  ConnectionFamily,
  ConnectionKind,
  ConnectionMode,
} from '../../data-access/integration-referential';
import { CreateConnectionDrawer, CreateConnectionDrawerData } from './create-connection-drawer';

/**
 * Liste des connexions, montée deux fois : sans famille pour l'écran « Connexions », et
 * avec `family: 'Insurance'` (par les `data` de route) pour l'écran « Assurance ». Un seul
 * écran parce que les deux listes répondent à la même question — laquelle est active, et
 * laquelle est en panne — et que les dupliquer les aurait fait diverger.
 */
@Component({
  templateUrl: './connections-page.html',
  imports: [
    FormsModule,
    Button,
    TasCard,
    TasIcon,
    TasTable,
    TasTag,
    TasSelect,
    TasFormField,
    TasLabel,
    TimeagoPipe,
    ConnectionHealthBadgeComponent,
  ],
})
export class ConnectionsPage {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _permissions = inject(PermissionsService);
  public readonly canManage = this._permissions.can('Integration.Connection.Manage');

  /** Famille imposée par la route. Absente, l'écran laisse choisir la famille en filtre. */
  public readonly family = input<ConnectionFamily | undefined>(undefined);

  public readonly isLoading = signal(true);
  public readonly connections = signal<ConnectionListDto[]>([]);
  public readonly totalCount = signal(0);

  public readonly filterFamily = signal<string | null>(null);
  public readonly filterActive = signal<string | null>(null);

  public readonly familyOptions = CONNECTION_FAMILIES.map((f) => ({
    label: f.label,
    value: f.value,
  }));

  public readonly activeOptions = [
    { label: 'Actives', value: 'true' },
    { label: 'Inactives', value: 'false' },
  ];

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  public readonly isInsurance = computed(() => this.family() === 'Insurance');

  public readonly pageTitle = computed(() =>
    this.isInsurance() ? 'Connexions assurance' : 'Connexions',
  );

  public readonly pageIntent = computed(() =>
    this.isInsurance()
      ? 'Déclarez les back-offices des assureurs dont vous distribuez les produits.'
      : 'Déclarez les systèmes externes avec lesquels SANKORE échange.',
  );

  /** Pour une connexion assurance, le nom de la connexion EST le nom de l'assureur. */
  public readonly nameColumnLabel = computed(() => (this.isInsurance() ? 'Assureur' : 'Nom'));

  public readonly showFamilyColumn = computed(() => this.family() === undefined);

  public readonly hasActiveFilter = computed(
    () => this.filterActive() !== null || this.filterFamily() !== null,
  );

  /**
   * Les connexions actives dont le dernier test a échoué : c'est l'information que
   * l'exploitant cherche en arrivant, et elle se perdrait dans une colonne de plus.
   */
  public readonly failingConnections = computed(() =>
    this.connections().filter((row) => row.isActive && row.lastHealthStatus === false),
  );

  private readonly _reload$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations/connections'] },
      { label: this.isInsurance() ? 'Assurance' : 'Connexions' },
    ]);

    /**
     * Les chargements passent par un `switchMap` : deux changements de filtre rapprochés
     * laissaient sinon gagner la réponse du filtre précédent.
     */
    this._reload$
      .pipe(
        switchMap(() => {
          this.isLoading.set(true);
          return this._facade
            .listConnections({
              family: this._effectiveFamily(),
              isActive: this.filterActive() === null ? undefined : this.filterActive() === 'true',
              // L'API d'intégration pagine en 1-based ; `PageEvent.pageIndex` est 0-based.
              page: this.tableConfig().pagination.pageIndex + 1,
              pageSize: this.tableConfig().pagination.pageSize,
            })
            .pipe(
              catchError((err: HttpErrorResponse) => {
                this._snackbar.error(
                  'Erreur',
                  integrationErrorMessage(err, 'Impossible de charger les connexions.'),
                );
                this.isLoading.set(false);
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        this.connections.set(result.items ?? []);
        this.totalCount.set(result.totalCount ?? 0);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: result.totalCount ?? 0 },
        }));
        this.isLoading.set(false);
      });

    const params = this._route.snapshot.queryParams;
    if (params['famille']) this.filterFamily.set(params['famille']);
    if (params['actif']) this.filterActive.set(params['actif']);
    const page = Number(params['page']);
    if (Number.isInteger(page) && page > 1) {
      this.tableConfig.update((config) => ({
        ...config,
        pagination: { ...config.pagination, pageIndex: page - 1 },
      }));
    }

    this._reload$.next();
  }

  public familyLabel(family: ConnectionFamily | undefined): string {
    return family ? CONNECTION_FAMILY_LABELS[family] : '—';
  }

  public kindLabel(kind: ConnectionKind | undefined): string {
    return kind ? CONNECTION_KIND_LABELS[kind] : '—';
  }

  public modeLabel(mode: ConnectionMode | undefined): string {
    return mode ? CONNECTION_MODE_LABELS[mode] : '—';
  }

  public onFilterChange(key: 'famille' | 'actif', value: string | null): void {
    if (key === 'famille') this.filterFamily.set(value);
    else this.filterActive.set(value);

    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
    this._applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize },
    }));
    this._applyFilters();
  }

  public refresh(): void {
    this._reload$.next();
  }

  public open(connection: ConnectionListDto): void {
    if (!connection.id) return;
    this._router.navigate(['/settings/integrations/connections', connection.id]);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open<string, CreateConnectionDrawerData, CreateConnectionDrawer>(
      CreateConnectionDrawer,
      {
        data: { family: this.family() ?? null },
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
      },
    );

    // Patron « création puis édition » : le drawer crée le brouillon inactif et rend son
    // id, l'écran d'édition porte le reste du paramétrage.
    ref.closed.subscribe((connectionId) => {
      if (connectionId) {
        this._router.navigate(['/settings/integrations/connections', connectionId]);
      }
    });
  }

  private _effectiveFamily(): ConnectionFamily | undefined {
    const pinned = this.family();
    if (pinned) return pinned;
    const picked = this.filterFamily();
    return picked ? (picked as ConnectionFamily) : undefined;
  }

  private _applyFilters(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        famille: this.family() ? null : this.filterFamily(),
        actif: this.filterActive(),
        page: this.tableConfig().pagination.pageIndex + 1,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    this._reload$.next();
  }
}

export default ConnectionsPage;
