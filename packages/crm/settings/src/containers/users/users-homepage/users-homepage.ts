import { Component, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  UsersApiService,
  UserDto,
  UserStatusStatsDto,
  UserStatus,
} from '@sankore/crm-api';
import { CreateUserComponent } from '../create-user/create-user';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService, InitialsPipe } from '@sankore/crm/common';
import { TasTag } from '@talisoft/ui/tag';

const AVATAR_COLORS = [
  'bg-primary/10 text-primary',
  'bg-accent/10 text-accent',
  'bg-primary/20 text-primary',
  'bg-accent/20 text-accent',
];

@Component({
  templateUrl: './users-homepage.html',
  imports: [
    NgClass,
    Button,
    TasIcon,
    TasCard,
    TasTable,
    TasTag,
    TimeagoPipe,
    InitialsPipe,
  ],
})
export class UsersHomePage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(false);
  public users = signal<UserDto[]>([]);
  public searchQuery = signal('');
  public statusFilter = signal<UserStatus | undefined>(undefined);

  public userStatusStats = signal<UserStatusStatsDto>({ total: 0, active: 0 , disabled: 0, locked: 0, pendingActivation: 0});

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
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Utilisateurs' },
    ]);
    this.loadUsers(0, 20);
    this._usersApiService.getUserStatusStats().subscribe({
      next: data => this.userStatusStats.set(data),
    })
  }

  public onStatusFilterChange(status: UserStatus | undefined): void {
    this.statusFilter.set(status);
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.loadUsers(0, this.tableConfig().pagination.pageSize, this.searchQuery(), status);
  }

  public onSearchChange(query: string): void {
    this.searchQuery.set(query);
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.loadUsers(0, this.tableConfig().pagination.pageSize, query, this.statusFilter());
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateUserComponent, {
      width: '100vw',
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
    this.loadUsers(event.pageIndex, event.pageSize, this.searchQuery(), this.statusFilter());
  }

  public loadUsers(page: number, pageSize: number, search?: string, status?: UserStatus): void {
    this.isLoading.set(true);
    this._usersApiService
      .listUsers(status, undefined, search || undefined, page + 1, pageSize)
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
      case 'PendingActivation':
        return 'Activation en attente';
      case 'Active':
        return 'Actif';
      case 'Disabled':
        return 'Désactivé';
      case 'Locked':
        return 'Suspendu';
      default:
        return status ?? '—';
    }
  }

  public displayRoles(roles: string[]): string {
    return roles.join(', ');
  }

  public statusSeverity(status: string | null | undefined): 'success' | 'warning' | 'neutral' | 'error' {
    switch (status) {
      case 'Active': return 'success';
      case 'PendingActivation': return 'warning';
      case 'Locked': return 'error';
      default: return 'neutral';
    }
  }

  public accountTypeLabel(type: string | null | undefined): string {
    switch (type) {
      case '0':
        return 'Admin';
      case '1':
        return 'Manager';
      case '2':
        return 'Terrain';
      default:
        return type ?? '';
    }
  }

  public avatarColor(name: string | null | undefined): string {
    if (!name) return 'bg-slate-100 text-slate-400';
    return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  }
}

export default UsersHomePage;
