import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgClass } from '@angular/common';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TerritoriesApiService, TerritoryDto } from '@sankore/crm-api';
import { CreateTerritoryComponent } from '../create-territory/create-territory';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService } from '@sankore/crm/common';

@Component({
  templateUrl: './territories-homepage.html',
  imports: [Button, TasIcon, TasCard, TasTable, NgClass, TimeagoPipe],
})
export class TerritoriesHomePage {
  private readonly _territoriesApiService = inject(TerritoriesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(false);
  public territories = signal<TerritoryDto[]>([]);
  public searchQuery = signal('');

  public filteredTerritories = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.territories();
    return this.territories().filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.code?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q),
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
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Territoires' },
    ]);
    this.loadTerritories();
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateTerritoryComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((result) => {
      if (result) {
        this.loadTerritories();
      }
    });
  }

  public navigateToEdit(territory: TerritoryDto): void {
    this._router.navigate(['/settings/territories', territory.id, 'edit']);
  }

  public codeBadge(code: string | null | undefined): string {
    if (!code) return '??';
    return code.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  }

  public loadTerritories(): void {
    this.isLoading.set(true);
    this._territoriesApiService.listTerritories(false).subscribe({
      next: (items) => {
        this.territories.set(items ?? []);
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

export default TerritoriesHomePage;
