import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { ProductsApiService, ProductDto } from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { catchError, EMPTY } from 'rxjs';
import { CreateProductComponent } from '../create-product/create-product';

@Component({
  templateUrl: './products-homepage.html',
  imports: [Button, TasIcon, TasCard, TasTable],
})
export class ProductsHomePage {
  private readonly _productsApiService = inject(ProductsApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _router = inject(Router);

  public isLoading = signal(false);
  public products = signal<ProductDto[]>([]);
  public searchQuery = signal('');
  public deletingId = signal<string | null>(null);

  public filteredProducts = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.products();
    return this.products().filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.code?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q),
    );
  });

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

  ngOnInit(): void {
    this.loadProducts();
  }

  public onSearchChange(query: string): void {
    this.searchQuery.set(query);
  }

  public codeBadge(code: string | null | undefined): string {
    if (!code) return '??';
    return code.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateProductComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((result) => {
      if (result) this.loadProducts();
    });
  }

  public navigateToEdit(product: ProductDto): void {
    this._router.navigate(['/settings/products', product.id, 'edit']);
  }

  public confirmDelete(product: ProductDto): void {
    this._confirmDialogService.confirm({
      title: 'Supprimer le produit',
      message: `Supprimer "${product.name ?? product.code}" ? Cette action est irréversible.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.deletingId.set(product.id ?? null);
        this._productsApiService
          .deleteProduct(product.id!)
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de supprimer le produit.');
              this.deletingId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Produit supprimé.');
            this.products.update((list) => list.filter((p) => p.id !== product.id));
            this.deletingId.set(null);
          });
      },
    });
  }

  public loadProducts(): void {
    this.isLoading.set(true);
    this._productsApiService.listProducts().subscribe({
      next: (items) => {
        this.products.set(items ?? []);
        this.tableConfig.update((c) => ({
          ...c,
          pagination: { ...c.pagination, totalElements: (items ?? []).length },
        }));
        this.isLoading.set(false);
      },
      error: () => this.isLoading.set(false),
    });
  }
}

export default ProductsHomePage;
