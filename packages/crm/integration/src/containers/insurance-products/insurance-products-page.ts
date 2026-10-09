import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConnectionListDto, InsuranceProductDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSwitch } from '@talisoft/ui/switch';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { EMPTY, Subject, catchError, switchMap } from 'rxjs';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_KIND_LABELS,
  ConnectionKind,
  INSURANCE_PERIODICITY_LABELS,
  INSURANCE_PRICING_MODE_LABELS,
  InsurancePeriodicity,
  formatAmount,
  notOfferableReasonLabel,
} from '../../data-access/integration-referential';
import { CreateInsuranceProductDrawer } from './create-insurance-product-drawer';

/**
 * Une ligne du catalogue, libellés déjà résolus.
 *
 * Déclaré en `type` et non en `interface` : `TasTable<T extends TableEntity>` exige une
 * signature d'index, que TypeScript n'accorde implicitement qu'aux alias de type.
 */
export type InsuranceProductRow = {
  id: string;
  name: string;
  insurerProductCode: string;
  insurerName: string;
  connectionKindLabel: string;
  periodicityLabel: string;
  premiumLabel: string;
  isActive: boolean;
  activeLabel: string;
  isOfferable: boolean;
  notOfferableLabels: string[];
};

/** Écran ASS-14 — le catalogue des produits d'assurance distribués par l'IMF. */
@Component({
  selector: 'insurance-products-page',
  templateUrl: './insurance-products-page.html',
  imports: [
    FormsModule,
    RouterLink,
    Anchor,
    Button,
    Menu,
    MenuItem,
    TasAlert,
    TasCard,
    TasFormField,
    TasIcon,
    TasLabel,
    TasMenuTrigger,
    TasSelect,
    TasSwitch,
    TasTable,
    TasTag,
  ],
})
export class InsuranceProductsPage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);

  public readonly canManage = this._permissions.can('Ins.Product.Manage');

  /** L'écran des connexions assurance, vers lequel renvoyer quand aucune n'est déclarée. */
  public readonly insuranceConnectionsLink = '/settings/integrations/insurance-connections';

  public isLoading = signal(true);
  public isLoadingInsurers = signal(true);
  public rows = signal<InsuranceProductRow[]>([]);
  public totalCount = signal(0);
  public insurers = signal<ConnectionListDto[]>([]);
  public actionInProgress = signal<string | null>(null);

  public filterConnectionId = signal<string | null>(null);
  public filterStatus = signal<string | null>(null);
  public filterOfferableOnly = signal(false);

  public readonly statusOptions = [
    { label: 'Actifs', value: 'active' },
    { label: 'Retirés de la distribution', value: 'inactive' },
  ];

  public readonly insurerOptions = computed(() =>
    this.insurers().map((connection) => ({
      label: connection.name ?? 'Connexion sans nom',
      value: connection.id ?? '',
    })),
  );

  public readonly hasInsurer = computed(() => this.insurers().length > 0);

  public readonly hasActiveFilters = computed(
    () => !!this.filterConnectionId() || !!this.filterStatus() || this.filterOfferableOnly(),
  );

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  /**
   * Chargements de la liste. Deux changements de filtre rapprochés laisseraient sinon
   * gagner la réponse du filtre précédent : `switchMap` annule la requête obsolète.
   */
  private readonly _load$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: "Produits d'assurance" },
    ]);

    const params = this._route.snapshot.queryParams;
    if (params['insurer']) this.filterConnectionId.set(params['insurer']);
    if (params['status']) this.filterStatus.set(params['status']);
    if (params['offerable'] === 'true') this.filterOfferableOnly.set(true);

    this._setupLoader();
    this._loadInsurers();
    this._load();
  }

  public onInsurerChange(value: string | null): void {
    this.filterConnectionId.set(value || null);
    this._applyFilters();
  }

  public onStatusChange(value: string | null): void {
    this.filterStatus.set(value || null);
    this._applyFilters();
  }

  public onOfferableOnlyChange(value: boolean): void {
    this.filterOfferableOnly.set(value);
    this._applyFilters();
  }

  public resetFilters(): void {
    this.filterConnectionId.set(null);
    this.filterStatus.set(null);
    this.filterOfferableOnly.set(false);
    this._applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this._load();
  }

  public refresh(): void {
    this._load();
  }

  public openProduct(row: InsuranceProductRow): void {
    this._router.navigate(['/settings/integrations/insurance-products', row.id]);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawer.open(CreateInsuranceProductDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    // Patron « création puis édition » : le drawer ne pose que le socle requis, la
    // configuration riche se fait sur l'écran d'édition, qui a besoin de l'id.
    ref.closed.subscribe((productId) => {
      if (typeof productId === 'string' && productId) {
        this._router.navigate(['/settings/integrations/insurance-products', productId]);
      }
    });
  }

  public activate(row: InsuranceProductRow): void {
    this._confirm.confirm({
      title: 'Mettre ce produit en distribution ?',
      message: `Les agents pourront proposer « ${row.name} » à la souscription, s'il est proposable.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._runActivation(row, true),
    });
  }

  /**
   * Il n'y a pas de DELETE côté contrat : souscriptions, contrats, échéances et lignes
   * de bordereau nomment le produit. Le retrait est donc un statut, et il n'arrête que
   * les nouvelles souscriptions.
   */
  public withdraw(row: InsuranceProductRow): void {
    this._confirm.confirm({
      title: 'Retirer ce produit de la distribution ?',
      message:
        `« ${row.name} » ne pourra plus être proposé à la souscription. ` +
        'Les contrats en cours continuent : seules les nouvelles souscriptions sont arrêtées.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Retirer de la distribution', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._runActivation(row, false),
    });
  }

  private _runActivation(row: InsuranceProductRow, activate: boolean): void {
    this.actionInProgress.set(row.id);
    const call = activate
      ? this._facade.activateInsuranceProduct(row.id)
      : this._facade.deactivateInsuranceProduct(row.id);

    call
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(
              error,
              activate
                ? "Impossible d'activer ce produit."
                : 'Impossible de retirer ce produit de la distribution.',
            ),
          );
          this.actionInProgress.set(null);
          return EMPTY;
        }),
      )
      .subscribe((product) => {
        this.actionInProgress.set(null);
        this.rows.update((rows) =>
          rows.map((current) => (current.id === row.id ? this._toRow(product) : current)),
        );

        if (!activate) {
          this._snackbar.success('Produit retiré', 'Aucune nouvelle souscription ne sera prise.');
          return;
        }

        // Un produit actif peut rester non proposable (connexion inactive, pas encore
        // en vigueur…) : le dire ici évite de le découvrir au guichet.
        const reasons = (product.notOfferableReasons ?? []).map((reason) =>
          notOfferableReasonLabel(reason),
        );
        if (product.isOfferable) {
          this._snackbar.success('Produit activé', 'Vos agents peuvent le proposer.');
        } else {
          this._snackbar.info(
            'Produit activé, mais pas encore proposable',
            reasons.join(' · ') || "L'assureur ne renvoie pas de tarif.",
          );
        }
      });
  }

  private _applyFilters(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));

    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        insurer: this.filterConnectionId() || null,
        status: this.filterStatus() || null,
        offerable: this.filterOfferableOnly() ? 'true' : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    this._load();
  }

  private _load(): void {
    this.isLoading.set(true);
    this._load$.next();
  }

  private _setupLoader(): void {
    this._load$
      .pipe(
        switchMap(() => {
          const status = this.filterStatus();
          const pagination = this.tableConfig().pagination;
          return this._facade
            .listInsuranceProducts({
              connectionId: this.filterConnectionId() ?? undefined,
              isActive: status === null ? undefined : status === 'active',
              offerableOnly: this.filterOfferableOnly() ? true : undefined,
              // L'API pagine en 1-based, `PageEvent.pageIndex` est 0-based.
              page: pagination.pageIndex + 1,
              pageSize: pagination.pageSize,
            })
            .pipe(
              catchError((error: HttpErrorResponse) => {
                this._snackbar.error(
                  'Erreur',
                  integrationErrorMessage(error, 'Impossible de charger le catalogue.'),
                );
                this.isLoading.set(false);
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        this.rows.set((result.items ?? []).map((product) => this._toRow(product)));
        this.totalCount.set(result.totalCount ?? 0);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: result.totalCount ?? 0 },
        }));
        this.isLoading.set(false);
      });
  }

  private _loadInsurers(): void {
    this.isLoadingInsurers.set(true);
    this._facade
      .listAllConnections('Insurance')
      .pipe(
        catchError(() => {
          this.isLoadingInsurers.set(false);
          return EMPTY;
        }),
      )
      .subscribe((connections) => {
        this.insurers.set(connections);
        this.isLoadingInsurers.set(false);
      });
  }

  private _toRow(product: InsuranceProductDto): InsuranceProductRow {
    const periodicityLabel = product.periodicity
      ? INSURANCE_PERIODICITY_LABELS[product.periodicity as InsurancePeriodicity]
      : '—';

    return {
      id: product.id ?? '',
      name: product.name || 'Produit sans nom',
      insurerProductCode: product.insurerProductCode ?? '—',
      insurerName: product.connectionName || '—',
      connectionKindLabel: product.connectionKind
        ? CONNECTION_KIND_LABELS[product.connectionKind as ConnectionKind]
        : '—',
      periodicityLabel,
      premiumLabel:
        product.pricingMode === 'InsurerComputed'
          ? INSURANCE_PRICING_MODE_LABELS.InsurerComputed
          : formatAmount(product.fixedPremiumAmount, product.currency),
      isActive: product.isActive ?? false,
      activeLabel: product.isActive ? 'Actif' : 'Retiré',
      isOfferable: product.isOfferable ?? false,
      notOfferableLabels: (product.notOfferableReasons ?? []).map((reason) =>
        notOfferableReasonLabel(reason),
      ),
    };
  }
}

export default InsuranceProductsPage;
