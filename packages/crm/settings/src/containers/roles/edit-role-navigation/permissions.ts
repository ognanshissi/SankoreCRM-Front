import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { RolesApiService, RolePermissionDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';

export interface PermissionEntry { code: string; description: string; }
export interface PermissionGroup { domain: string; label: string; permissions: PermissionEntry[]; }

export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    domain: 'agency', label: 'Agences',
    permissions: [
      { code: 'agency:read', description: 'Consulter les agences' },
      { code: 'agency:create', description: 'Créer une agence' },
      { code: 'agency:delete', description: 'Supprimer une agence' },
      { code: 'agency:activate', description: 'Réactiver une agence supprimée' },
      { code: 'agency:move', description: 'Déplacer / réorganiser la hiérarchie' },
    ],
  },
  {
    domain: 'user', label: 'Utilisateurs',
    permissions: [
      { code: 'user:read', description: 'Consulter les utilisateurs' },
      { code: 'user:create', description: 'Créer un utilisateur' },
      { code: 'user:update', description: 'Modifier un utilisateur' },
      { code: 'user:deactivate', description: 'Désactiver un utilisateur' },
      { code: 'user:assign-role', description: 'Assigner un rôle à un utilisateur' },
      { code: 'user:revoke-role', description: "Révoquer un rôle d'un utilisateur" },
      { code: 'user:assign-permission', description: 'Attribuer une permission directe' },
      { code: 'user:revoke-permission', description: 'Révoquer une permission directe' },
    ],
  },
  {
    domain: 'role', label: 'Rôles',
    permissions: [
      { code: 'role:read', description: 'Consulter les rôles' },
      { code: 'role:create', description: 'Créer un rôle personnalisé' },
      { code: 'role:update', description: "Modifier le libellé d'un rôle" },
      { code: 'role:delete', description: 'Supprimer un rôle personnalisé' },
      { code: 'role:assign-permission', description: 'Ajouter une permission à un rôle' },
      { code: 'role:revoke-permission', description: "Retirer une permission d'un rôle" },
    ],
  },
  {
    domain: 'product', label: 'Produits',
    permissions: [
      { code: 'product:read', description: 'Consulter les produits' },
      { code: 'product:create', description: 'Créer un produit' },
      { code: 'product:update', description: 'Modifier un produit' },
      { code: 'product:delete', description: 'Supprimer un produit' },
    ],
  },
  {
    domain: 'territory', label: 'Territoires',
    permissions: [
      { code: 'territory:read', description: 'Consulter les territoires' },
      { code: 'territory:create', description: 'Créer un territoire' },
      { code: 'territory:update', description: 'Modifier un territoire' },
      { code: 'territory:delete', description: 'Désactiver un territoire' },
    ],
  },
  {
    domain: 'lead', label: 'Leads',
    permissions: [
      { code: 'lead:read', description: 'Consulter les leads' },
      { code: 'lead:create', description: 'Créer un lead' },
      { code: 'lead:update', description: 'Modifier un lead' },
      { code: 'lead:delete', description: 'Supprimer un lead' },
      { code: 'lead:assign', description: 'Assigner un lead à un agent' },
    ],
  },
];

@Component({
  selector: 'role-permissions',
  imports: [TasCard, TasIcon, TasSpinner, TasTitle],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <tas-title>Permissions</tas-title>
        @if (isSystem()) {
          <div class="flex gap-3 p-4 rounded-lg bg-slate-50 border border-slate-200">
            <tas-icon iconName="feather:info" class="text-slate-400 shrink-0 mt-0.5"></tas-icon>
            <p class="text-sm text-slate-600">Les permissions des rôles système ne peuvent pas être modifiées.</p>
          </div>
        }

        @for (group of catalog; track group.domain) {
          <tas-card>
            <div class="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <p class="text-sm font-semibold text-slate-700">{{ group.label }}</p>
              <span class="text-xs text-slate-400 font-mono">{{ group.domain }}</span>
            </div>
            <div class="divide-y divide-gray-100">
              @for (perm of group.permissions; track perm.code) {
                @let granted = grantedCodes().has(perm.code);
                @let toggling = togglingCode() === perm.code;
                <div
                  class="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                  [class.opacity-50]="toggling"
                >
                  <button
                    type="button"
                    class="relative flex-shrink-0 w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed"
                    [class.bg-primary]="granted"
                    [class.bg-slate-200]="!granted"
                    [disabled]="isSystem() || togglingCode() !== null"
                    (click)="toggle(perm.code, granted)"
                    [title]="granted ? 'Retirer la permission' : 'Accorder la permission'"
                  >
                    <span
                      class="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform"
                      [class.translate-x-4]="granted"
                    ></span>
                    @if (toggling) {
                      <span class="absolute inset-0 flex items-center justify-center">
                        <tas-spinner size="3" class="text-white"></tas-spinner>
                      </span>
                    }
                  </button>
                  <div class="flex-1 min-w-0">
                    <p class="font-mono text-sm font-medium text-slate-800">{{ perm.code }}</p>
                    <p class="text-xs text-slate-500 mt-0.5">{{ perm.description }}</p>
                  </div>
                  @if (granted) {
                    <span class="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">Accordée</span>
                  }
                </div>
              }
            </div>
          </tas-card>
        }
      </div>
    }
  `,
})
export class RolePermissionsPage {
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public readonly catalog = PERMISSION_CATALOG;
  public isLoading = signal(true);
  public isSystem = signal(false);
  public permissions = signal<RolePermissionDto[]>([]);
  public togglingCode = signal<string | null>(null);

  public grantedCodes = computed(
    () => new Set(this.permissions().map((p) => p.code ?? '')),
  );

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._rolesApiService.getRole(this.id()).subscribe({
        next: (role) => {
          this.isSystem.set(role.isSystem ?? false);
          this.permissions.set(role.permissions ?? []);
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error(
            'Erreur',
            'Impossible de charger les permissions.',
          );
          this.isLoading.set(false);
        },
      });
    });
  }

  public toggle(code: string, currentlyGranted: boolean): void {
    if (this.togglingCode()) return;
    this.togglingCode.set(code);
    if (currentlyGranted) {
      this._rolesApiService
        .revokePermissionFromRole(this.id(), code)
        .pipe(
          catchError(() => {
            this._snackbarService.error(
              'Erreur',
              'Impossible de retirer la permission.',
            );
            this.togglingCode.set(null);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this.permissions.update((list) =>
            list.filter((p) => p.code !== code),
          );
          this.togglingCode.set(null);
        });
    } else {
      this._rolesApiService
        .assignPermissionToRole(this.id(), { permissionCode: code })
        .pipe(
          catchError(() => {
            this._snackbarService.error(
              'Erreur',
              "Impossible d'ajouter la permission.",
            );
            this.togglingCode.set(null);
            return EMPTY;
          }),
        )
        .subscribe(() => {
          this.permissions.update((list) => [
            ...list,
            { code, description: null } as RolePermissionDto,
          ]);
          this.togglingCode.set(null);
        });
    }
  }
}

export default RolePermissionsPage;
