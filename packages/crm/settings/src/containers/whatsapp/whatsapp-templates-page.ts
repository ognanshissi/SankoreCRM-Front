import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, EMPTY, of, Subject } from 'rxjs';
import {
  ProductDto,
  ProductsApiService,
  WhatsAppApiService,
  WhatsAppTemplateDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import {
  TEMPLATE_CATEGORY_LABELS,
  templateStatusView,
  whatsAppErrorMessage,
} from './whatsapp-referential';
import {
  WhatsAppTemplateDrawer,
  WhatsAppTemplateDrawerData,
} from './whatsapp-template-drawer';

const STATUS_FILTER_OPTIONS = [
  { label: 'Tous les statuts', value: '' },
  { label: 'Approuvé', value: 'Approved' },
  { label: 'En attente', value: 'Pending' },
  { label: 'Refusé', value: 'Rejected' },
  { label: 'En pause', value: 'Paused' },
  { label: 'Désactivé', value: 'Disabled' },
  { label: 'Autre', value: 'Other' },
  { label: 'Retiré', value: 'Unavailable' },
];

/**
 * Les templates WhatsApp de l'institution (WA-FE-02).
 *
 * Le catalogue vient de Meta via 360dialog : l'écran ne crée ni ne modifie un template, il
 * le synchronise, puis dit pour quels produits il est proposé et quel champ du lead remplit
 * chacune de ses variables. L'approbation appartient à Meta.
 *
 * L'endpoint ne pagine ni ne filtre : recherche et statut sont appliqués côté client, sur une
 * liste qui reste courte (quelques dizaines de templates par numéro).
 */
@Component({
  selector: 'whatsapp-templates-page',
  templateUrl: './whatsapp-templates-page.html',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    Anchor,
    Button,
    TasCard,
    TasFormField,
    TasLabel,
    TasIcon,
    TasInput,
    TasSelect,
    TasTable,
    TasTag,
  ],
})
export class WhatsAppTemplatesPage implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly statusOptions = STATUS_FILTER_OPTIONS;

  public isLoading = signal(true);
  public isSyncing = signal(false);
  public loadError = signal<string | null>(null);
  public templates = signal<WhatsAppTemplateDto[]>([]);
  private readonly _products = signal<ProductDto[]>([]);

  public filterQuery = signal('');
  /** Valeur appliquée à la liste, en retard de 300 ms sur la frappe. */
  private readonly _appliedQuery = signal('');
  public filterStatus = signal('');

  private readonly _search$ = new Subject<void>();

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  public readonly productNames = computed(() => {
    const names: Record<string, string> = {};
    for (const product of this._products()) {
      if (product.id) names[product.id] = product.name || product.code || '—';
    }
    return names;
  });

  public readonly productOptions = computed(() =>
    this._products()
      .filter((product) => !!product.id)
      .map((product) => ({
        label: `${product.name ?? product.code ?? '—'}${product.isActive === false ? ' (inactif)' : ''}`,
        value: product.id!,
      })),
  );

  public readonly filteredTemplates = computed(() => {
    const query = this._appliedQuery().trim().toLowerCase();
    const status = this.filterStatus();

    return this.templates().filter((template) => {
      if (status === 'Unavailable' && template.isAvailable !== false) return false;
      if (status && status !== 'Unavailable' && template.status !== status) return false;
      if (!query) return true;
      return [template.name, template.channelDisplayPhoneNumber, template.language]
        .some((value) => (value ?? '').toLowerCase().includes(query));
    });
  });

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'WhatsApp Business', link: ['/settings/whatsapp'] },
      { label: 'Templates' },
    ]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    const params = this._route.snapshot.queryParams;
    if (params['q']) {
      this.filterQuery.set(params['q']);
      this._appliedQuery.set(params['q']);
    }
    if (params['status']) this.filterStatus.set(params['status']);

    this._loadProducts();
    this.reload();
  }

  public onSearchChange(value: string | null): void {
    this.filterQuery.set(value ?? '');
    this._search$.next();
  }

  public onStatusChange(value: string | null): void {
    this.filterStatus.set(value ?? '');
    this._applyFilters();
  }

  public categoryLabel(category: string | null | undefined): string {
    return TEMPLATE_CATEGORY_LABELS[category ?? ''] ?? (category || '—');
  }

  public statusOf(template: WhatsAppTemplateDto) {
    return templateStatusView(template.status);
  }

  public productsLabel(template: WhatsAppTemplateDto): string {
    const ids = template.productLineIds ?? [];
    if (ids.length === 0) return 'Tous';
    const names = this.productNames();
    return ids.map((id) => names[id] ?? 'Produit inconnu').join(', ');
  }

  public reload(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._api
      .listWhatsAppTemplates()
      .pipe(
        catchError((err: unknown) => {
          this.loadError.set(
            whatsAppErrorMessage(err, 'Les templates WhatsApp n’ont pas pu être chargés.'),
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((templates) => {
        this.templates.set(templates ?? []);
        this.isLoading.set(false);
      });
  }

  public synchronize(): void {
    this.isSyncing.set(true);

    this._api
      .syncWhatsAppTemplates()
      .pipe(
        catchError((err: unknown) => {
          this._snackbar.error(
            'Synchronisation impossible',
            whatsAppErrorMessage(err, 'Les templates n’ont pas pu être relus chez 360dialog.'),
          );
          this.isSyncing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        const summary =
          `${result.added ?? 0} ajouté(s), ${result.updated ?? 0} mis à jour, `
          + `${result.unavailable ?? 0} retiré(s) sur ${result.channels ?? 0} numéro(s).`;
        const failed = result.failed ?? [];

        if (failed.length > 0) {
          // Une synchronisation partielle reste une anomalie à corriger sur ces numéros.
          this._snackbar.error(
            'Synchronisation partielle',
            `${summary} Échec pour : ${failed.join(', ')}.`,
          );
        } else if ((result.channels ?? 0) === 0) {
          this._snackbar.info(
            'Aucun numéro actif',
            'Activez un numéro WhatsApp pour synchroniser ses templates.',
          );
        } else {
          this._snackbar.success('Templates synchronisés', summary);
        }

        this.isSyncing.set(false);
        this.reload();
      });
  }

  public openTemplate(template: WhatsAppTemplateDto): void {
    const ref = this._sideDrawer.open<boolean, WhatsAppTemplateDrawerData, WhatsAppTemplateDrawer>(WhatsAppTemplateDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { template, productOptions: this.productOptions() },
    });
    ref.closed.subscribe((saved) => {
      if (saved) this.reload();
    });
  }

  private _applyFilters(): void {
    this._appliedQuery.set(this.filterQuery());
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery() || null,
        status: this.filterStatus() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private _loadProducts(): void {
    // Lead.ProductLineId est l'identifiant d'une entrée du catalogue produits : c'est donc
    // cette liste, et non une autre nomenclature, qui alimente le choix des produits.
    this._productsApi
      .listProducts()
      .pipe(catchError(() => of([] as ProductDto[])))
      .subscribe((products) => this._products.set(products ?? []));
  }
}

export default WhatsAppTemplatesPage;
