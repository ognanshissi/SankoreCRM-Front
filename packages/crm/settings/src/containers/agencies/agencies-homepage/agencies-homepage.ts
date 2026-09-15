import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { PageEvent } from '@angular/material/paginator';
import { AgenciesApiService, AgencyDto } from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { CreateAgencyComponent } from '../create-agency/create-agency';
import { NgClass } from '@angular/common';
import { TimeagoPipe } from '@talisoft/ui/timeago';

@Component({
  templateUrl: './agencies-homepage.html',
  imports: [
    Button,
    TasIcon,
    TasCard,
    TasTable,
    NgClass,
    TimeagoPipe,
  ],
})
export class AgenciesHomePage {
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  public isLoading = signal(false);
  public agencies = signal<AgencyDto[]>([]);
  public searchQuery = signal('');

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [5, 10, 30, 50],
      totalElements: 0,
    },
  });

  ngOnInit(): void {
    this.loadAgencies(0, 10);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateAgencyComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (result) {
        this.loadAgencies(
          this.tableConfig().pagination.pageIndex,
          this.tableConfig().pagination.pageSize,
        );
      }
    });
  }

  public navigateToEdit(agency: AgencyDto): void {
    this._router.navigate(['/settings/agencies', agency.id, 'edit']);
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
    this.loadAgencies(event.pageIndex, event.pageSize, this.searchQuery() || undefined);
  }

  public onSearchChange(q: string): void {
    this.searchQuery.set(q);
    const pageSize = this.tableConfig().pagination.pageSize;
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.loadAgencies(0, pageSize, q || undefined);
  }

  public loadAgencies(page: number, pageSize: number, search?: string): void {
    this.isLoading.set(true);
    this._agenciesApiService.listAgencies(false, page + 1, pageSize, undefined, search).subscribe({
      next: (result) => {
        this.agencies.set(result.items ?? []);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: {
            ...config.pagination,
            totalElements: result.totalCount ?? 0,
          },
        }));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  public codeBadge(code: string | null | undefined, name: string | null | undefined): string {
    const src = code ?? name ?? '??';
    return src.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  }

  public agencyTypeLabel(type: number | string | null | undefined): string {
    switch (Number(type)) {
      case 0: return 'HQ';
      case 1: return 'Région';
      case 2: return 'Zone';
      case 3: return 'Agence';
      default: return type != null ? String(type) : '—';
    }
  }
}

export default AgenciesHomePage;
