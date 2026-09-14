import { Component, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { UsersApiService, UserDto } from '@sankore/crm-api';
import { CreateUserComponent } from '../create-user/create-user';
import { TimeagoPipe } from '@talisoft/ui/timeago';

@Component({
  templateUrl: './users-homepage.html',
  imports: [
    NgClass,
    TasTitle,
    Button,
    TasIcon,
    TasCard,
    TasTable,
    TimeagoPipe,
  ],
})
export class UsersHomePage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  public isLoading = signal(false);
  public users = signal<UserDto[]>([]);

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

  ngOnInit(): void {
    this.loadUsers(0, 20);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateUserComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((result) => {
      if (result) {
        this.loadUsers(
          this.tableConfig().pagination.pageIndex,
          this.tableConfig().pagination.pageSize,
        );
      }
    });
  }

  public navigateToEdit(user: UserDto): void {
    this._router.navigate(['/settings/users', user.id]);
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((c) => ({
      ...c,
      pagination: {
        ...c.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this.loadUsers(event.pageIndex, event.pageSize);
  }

  public loadUsers(page: number, pageSize: number): void {
    this.isLoading.set(true);
    this._usersApiService
      .listUsers(undefined, undefined, undefined, page + 1, pageSize)
      .subscribe({
        next: (result) => {
          this.users.set(result.items ?? []);
          this.tableConfig.update((c) => ({
            ...c,
            pagination: {
              ...c.pagination,
              totalElements: result.totalCount ?? 0,
            },
          }));
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
  }

  public statusLabel(status: string | null | undefined): string {
    switch (status) {
      case '0':
        return 'En attente';
      case '1':
        return 'Actif';
      case '2':
        return 'Désactivé';
      case '3':
        return 'Suspendu';
      default:
        return status ?? '—';
    }
  }

  public statusClass(
    status: string | null | undefined,
  ): Record<string, boolean> {
    return {
      'bg-yellow-100 text-yellow-700': status === '0',
      'bg-green-100 text-green-700': status === '1',
      'bg-slate-100 text-slate-500': status === '2',
      'bg-red-100 text-red-700': status === '3',
    };
  }
}

export default UsersHomePage;
