import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NgClass } from '@angular/common';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TerritoriesApiService, TerritoryDto } from '@sankore/crm-api';
import { CreateTerritoryComponent } from '../create-territory/create-territory';
import { TimeagoPipe } from '@talisoft/ui/timeago';

@Component({
  templateUrl: './territories-homepage.html',
  imports: [TasTitle, Button, TasIcon, TasCard, TasTable, NgClass, TimeagoPipe],
})
export class TerritoriesHomePage {
  private readonly _territoriesApiService = inject(TerritoriesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  public isLoading = signal(false);
  public territories = signal<TerritoryDto[]>([]);

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
