import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { RolesApiService, RoleDto } from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { catchError, EMPTY } from 'rxjs';
import { CreateRoleComponent } from '../create-role/create-role';

@Component({
  templateUrl: './roles-homepage.html',
  imports: [Button, TasIcon, TasCard, TasTable, TasTag],
})
export class RolesHomePage {
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _router = inject(Router);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _snackbarService = inject(SnackbarService);

  public isLoading = signal(false);
  public roles = signal<RoleDto[]>([]);
  public searchQuery = signal('');
  public deletingId = signal<string | null>(null);

  public filteredRoles = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return this.roles();
    return this.roles().filter(
      (r) =>
        r.name?.toLowerCase().includes(q) ||
        r.label?.toLowerCase().includes(q),
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
    this.loadRoles();
  }

  public onSearchChange(query: string): void {
    this.searchQuery.set(query);
  }

  public navigateToEdit(role: RoleDto): void {
    this._router.navigate(['/settings/roles', role.id]);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateRoleComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (result) {
        this.loadRoles();
      }
    });
  }

  public confirmDelete(role: RoleDto): void {
    this._confirmDialogService.confirm({
      title: 'Supprimer le rôle',
      message: `Êtes-vous sûr de vouloir supprimer le rôle "${role.label ?? role.name}" ? Cette action est irréversible.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.deletingId.set(role.id ?? null);
        this._rolesApiService
          .deleteRole(role.id!)
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de supprimer le rôle.');
              this.deletingId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Rôle supprimé avec succès.');
            this.roles.update((list) => list.filter((r) => r.id !== role.id));
            this.deletingId.set(null);
          });
      },
    });
  }

  public loadRoles(): void {
    this.isLoading.set(true);
    this._rolesApiService.listRoles().subscribe({
      next: (roles) => {
        this.roles.set(roles);
        this.tableConfig.update((c) => ({
          ...c,
          pagination: { ...c.pagination, totalElements: roles.length },
        }));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }
}

export default RolesHomePage;
