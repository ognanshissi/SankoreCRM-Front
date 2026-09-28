import { Component, computed, inject, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectionModel } from '@angular/cdk/collections';
import { PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  UsersApiService,
  UserDto,
  UserStatusStatsDto,
} from '@sankore/crm-api';

type UserStatus = 0 | 1 | 2 | 3;
import { CreateUserComponent } from '../create-user/create-user';
import {
  BULK_ASSIGN_MAX_USERS,
  BulkAssignDrawer,
  BulkAssignDrawerData,
  BulkAssignMode,
} from './bulk-assign-drawer';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService, InitialsPipe, PermissionsService } from '@sankore/crm/common';
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
  private readonly _permissions = inject(PermissionsService);
  public readonly canCreate = this._permissions.can('user:create');
  public readonly canAssignAgency = this._permissions.can('user:assign-agency');
  public readonly canAssignRole = this._permissions.can('user:assign-role');

  private readonly _usersApiService = inject(UsersApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbarService = inject(SnackbarService);
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

  /**
   * Sélection multiple de la liste, portée par le `SelectionModel` du CDK comme
   * dans le design system (`table.ts`, `multi-select.ts`). Le comparateur sur
   * l'id est indispensable : chaque rechargement renvoie de nouveaux objets
   * `UserDto`, et l'égalité par référence perdrait la sélection.
   *
   * On conserve les DTO entiers, pas seulement les identifiants, parce que
   * `BulkUserOutcome` ne renvoie qu'un `userId` : nommer les utilisateurs
   * ignorés dans le compte rendu n'est possible qu'avec ce qui est affiché.
   */
  public readonly selection = new SelectionModel<UserDto>(
    true,
    [],
    true,
    (a, b) => a.id === b.id,
  );

  /** Miroir en signal : `SelectionModel` n'est pas réactif. */
  public selectedUsers = signal<UserDto[]>([]);
  public readonly selectedCount = computed(() => this.selectedUsers().length);
  public readonly selectedIds = computed(
    () => new Set(this.selectedUsers().map((user) => user.id)),
  );

  /**
   * « Tout sélectionner » ne porte que sur la page affichée : la liste est
   * paginée côté serveur, le front n'a jamais les autres pages en mémoire et
   * les endpoints en masse veulent des identifiants explicites (200 au plus).
   */
  public readonly allOnPageSelected = computed(() => {
    const users = this.users();
    const selected = this.selectedIds();
    return users.length > 0 && users.every((user) => selected.has(user.id));
  });
  public readonly someOnPageSelected = computed(
    () => this.selectedCount() > 0 && !this.allOnPageSelected(),
  );

  constructor() {
    this.selection.changed
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.selectedUsers.set([...this.selection.selected]));
  }

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

  public toggleUser(user: UserDto): void {
    this.selection.toggle(user);
  }

  public toggleAllOnPage(): void {
    if (this.allOnPageSelected()) {
      this.selection.clear();
      return;
    }
    this.selection.select(...this.users());
  }

  public clearSelection(): void {
    this.selection.clear();
  }

  /**
   * Ouvre le drawer d'affectation en masse. Le mode décide de l'endpoint, du
   * référentiel chargé et de la permission exigée.
   */
  public openBulkAssignDrawer(mode: BulkAssignMode): void {
    const selected = this.selectedUsers();
    if (selected.length === 0) return;

    // La permission est retestée ici : masquer le bouton ne protège que
    // l'affichage, et cette méthode reste appelable.
    const requiredPermission =
      mode === 'agency' ? 'user:assign-agency' : 'user:assign-role';
    if (!this._permissions.has(requiredPermission)) return;

    // Le contrat plafonne les deux endpoints à 200 utilisateurs par envoi. La
    // plus grande page vaut 50, la garde est donc théorique — mais elle évite
    // un 400 muet si les tailles de page changent.
    if (selected.length > BULK_ASSIGN_MAX_USERS) {
      this._snackbarService.error(
        'Sélection trop large',
        `Le serveur traite au plus ${BULK_ASSIGN_MAX_USERS} utilisateurs par envoi.`,
      );
      return;
    }

    const data: BulkAssignDrawerData = {
      mode,
      users: selected.map((user) => ({
        id: user.id ?? '',
        fullName: user.fullName ?? '',
        email: user.email ?? '',
        agencyId: user.agencyId ?? null,
        roles: user.roles ?? [],
      })),
    };

    const ref = this._sideDrawerService.open(BulkAssignDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe(() => {
      // Rechargement inconditionnel : la croix du drawer (`closable-drawer`)
      // ferme avec `undefined`, la valeur de fermeture ne dit donc pas de façon
      // fiable si l'affectation a eu lieu. Un GET de trop coûte moins qu'une
      // colonne Agence ou Rôle périmée.
      this.reloadCurrentPage();
    });
  }

  public reloadCurrentPage(): void {
    this.loadUsers(
      this.tableConfig().pagination.pageIndex,
      this.tableConfig().pagination.pageSize,
      this.searchQuery(),
      this.statusFilter(),
    );
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
    // La sélection ne survit pas à un rechargement : elle ne porte que sur la
    // page affichée, et un changement de page, de filtre ou de recherche
    // remplace entièrement les lignes qui la composaient.
    this.selection.clear();
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
