import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import {
  UsersApiService,
  RolesApiService,
  PermissionsApiService,
  RoleDto,
  UserRoleDto,
  ScopedPermissionDto,
  AssignScopedPermissionRequest,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import Users from '../../roles/edit-role/users';
import { TimeagoPipe } from '@talisoft/ui/timeago';

@Component({
  selector: 'user-roles',
  imports: [
    FormsModule,
    TasCard,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasSelect,
    TasInput,
    TasSpinner,
    TasTag,
    TimeagoPipe,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <!-- Page header -->
        <div class="flex items-center gap-2">
          <h1 class="text-lg font-semibold text-slate-800">Rôles</h1>
          @if (roles().length > 0) {
            <span
              class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums"
            >
              {{ roles().length }}
            </span>
          }
        </div>

        <!-- Assign role -->
        <tas-card>
          <div class="p-4 flex flex-col gap-3">
            <p class="text-sm font-semibold text-slate-700">Assigner un rôle</p>
            <div class="flex gap-3 items-end">
              <div class="flex-1">
                <tas-form-field>
                  <tas-label>Rôle</tas-label>
                  <tas-select
                    [options]="roleOptions()"
                    placeholder="Sélectionnez un rôle"
                    [ngModel]="selectedRoleId()"
                    (ngModelChange)="selectedRoleId.set($event)"
                  ></tas-select>
                </tas-form-field>
              </div>
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="!selectedRoleId() || isAssigning()"
                [isLoading]="isAssigning()"
                (click)="assign()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
                Assigner
              </button>
            </div>
          </div>
        </tas-card>

        <!-- Roles list -->
        <tas-card>
          @if (roles().length === 0) {
            <div class="flex flex-col items-center py-12 gap-2">
              <div
                class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"
              >
                <tas-icon
                  iconName="feather:shield"
                  class="text-slate-400"
                ></tas-icon>
              </div>
              <p class="text-sm text-slate-500">Aucun rôle assigné.</p>
              <p class="text-xs text-slate-400">
                Utilisez le formulaire ci-dessus pour en ajouter un.
              </p>
            </div>
          } @else {
            <div class="divide-y divide-gray-100">
              @for (role of roles(); track role.id) {
                <div
                  class="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
                >
                  <div class="flex items-center gap-3 min-w-0">
                    <div
                      class="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0"
                    >
                      <tas-icon
                        iconName="feather:shield"
                        class="text-primary"
                        style="font-size:14px"
                      ></tas-icon>
                    </div>
                    <div class="min-w-0">
                      <p
                        class="font-medium text-slate-800 leading-tight truncate"
                      >
                        {{ role.label ?? role.name }}
                      </p>
                      @if (role.label) {
                        <p class="text-xs text-slate-400 font-mono mt-0.5">
                          {{ role.name }}
                        </p>
                      }
                      <p class="text-xs text-slate-400 font-mono mt-0.5">
                        @if (role.assignedAt) {
                          Assigné: {{ role.assignedAt | dateTimeAgo }}
                        } @else {
                          "Inconnu"
                        }
                      </p>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <tas-tag [severity]="role.isSystem ? 'neutral' : 'info'">
                      {{ role.isSystem ? 'Système' : 'Personnalisé' }}
                    </tas-tag>
                    <button
                      tas-outlined-button
                      color="warn"
                      type="button"
                      [disabled]="revokingRoleId() === role.id"
                      [isLoading]="revokingRoleId() === role.id"
                      (click)="revoke(role)"
                    >
                      <tas-icon iconName="feather:x" iconSize="sm"></tas-icon>
                      Révoquer
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </tas-card>

        <!-- Scoped permissions header -->
        <div class="flex items-center gap-2 mt-2">
          <h2 class="text-lg font-semibold text-slate-800">Permissions directes</h2>
          @if (scopedPermissions().length > 0) {
            <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-xs font-medium tabular-nums">
              {{ scopedPermissions().length }}
            </span>
          }
        </div>

        <!-- Assign scoped permission -->
        <tas-card>
          <div class="p-4 flex flex-col gap-3">
            <p class="text-sm font-semibold text-slate-700">Attribuer une permission directe</p>
            <div class="grid grid-cols-2 gap-3">
              <div class="col-span-2">
                <tas-form-field>
                  <tas-label>Permission</tas-label>
                  <tas-select
                    [options]="permissionOptions()"
                    placeholder="Sélectionnez une permission"
                    [ngModel]="newPermissionCode()"
                    (ngModelChange)="newPermissionCode.set($event)"
                  ></tas-select>
                </tas-form-field>
              </div>
              <tas-form-field>
                <tas-label>Type de portée</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="ex: agency, territory"
                  [ngModel]="newScopeType()"
                  (ngModelChange)="newScopeType.set($event)"
                />
              </tas-form-field>
              <tas-form-field>
                <tas-label>ID de portée</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="ID de l'entité"
                  [ngModel]="newScopeId()"
                  (ngModelChange)="newScopeId.set($event)"
                />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Date de début (optionnel)</tas-label>
                <input
                  tasInput
                  type="date"
                  [ngModel]="newStartDate()"
                  (ngModelChange)="newStartDate.set($event)"
                />
              </tas-form-field>
              <tas-form-field>
                <tas-label>Date de fin (optionnel)</tas-label>
                <input
                  tasInput
                  type="date"
                  [ngModel]="newEndDate()"
                  (ngModelChange)="newEndDate.set($event)"
                />
              </tas-form-field>
            </div>
            <div class="flex justify-end">
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="!newPermissionCode() || isAssigningPermission()"
                [isLoading]="isAssigningPermission()"
                (click)="assignScopedPermission()"
              >
                <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
                Attribuer
              </button>
            </div>
          </div>
        </tas-card>

        <!-- Scoped permissions list -->
        <tas-card>
          @if (scopedPermissions().length === 0) {
            <div class="flex flex-col items-center py-12 gap-2">
              <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                <tas-icon iconName="feather:lock" class="text-slate-400"></tas-icon>
              </div>
              <p class="text-sm text-slate-500">Aucune permission directe.</p>
              <p class="text-xs text-slate-400">Utilisez le formulaire ci-dessus pour en attribuer une.</p>
            </div>
          } @else {
            <div class="divide-y divide-gray-100">
              @for (perm of scopedPermissions(); track perm.id) {
                <div class="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                      <tas-icon iconName="feather:key" class="text-accent" style="font-size:14px"></tas-icon>
                    </div>
                    <div class="min-w-0">
                      <p class="font-medium text-slate-800 leading-tight font-mono text-sm">{{ perm.permissionCode }}</p>
                      @if (perm.scopeType || perm.scopeId) {
                        <p class="text-xs text-slate-400 mt-0.5">
                          {{ perm.scopeType }}{{ perm.scopeId ? ' · ' + perm.scopeId : '' }}
                        </p>
                      }
                      @if (perm.startDate || perm.endDate) {
                        <p class="text-xs text-slate-400 mt-0.5">
                          {{ perm.startDate ? 'Du ' + (perm.startDate | dateTimeAgo) : '' }}
                          {{ perm.endDate ? ' au ' + (perm.endDate | dateTimeAgo) : '' }}
                        </p>
                      }
                    </div>
                  </div>
                  <button
                    tas-outlined-button
                    color="warn"
                    type="button"
                    [disabled]="revokingPermissionId() === perm.id"
                    [isLoading]="revokingPermissionId() === perm.id"
                    (click)="revokeScopedPermission(perm)"
                  >
                    <tas-icon iconName="feather:x" iconSize="sm"></tas-icon>
                    Révoquer
                  </button>
                </div>
              }
            </div>
          }
        </tas-card>
      </div>
    }
  `,
})
export class UserRolesPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _permissionsApiService = inject(PermissionsApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isAssigning = signal(false);
  public isAssigningPermission = signal(false);
  public roles = signal<UserRoleDto[]>([]);
  public allRoles = signal<RoleDto[]>([]);
  public scopedPermissions = signal<ScopedPermissionDto[]>([]);
  public selectedRoleId = signal('');
  public revokingRoleId = signal<string | null>(null);
  public revokingPermissionId = signal<string | null>(null);

  public newPermissionCode = signal('');
  public newScopeType = signal('');
  public newScopeId = signal('');
  public newStartDate = signal('');
  public newEndDate = signal('');

  public permissionOptions = signal<{ label: string; value: string }[]>([]);

  public roleOptions = computed(() =>
    this.allRoles().map((r) => ({
      label: r.label ?? r.name ?? '',
      value: r.id ?? '',
    })),
  );

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        roles: this._usersApiService.getUserRoles(this.id()),
        allRoles: this._rolesApiService.listRoles(),
        permissions: this._usersApiService.getUserPermissions(this.id()),
        catalog: this._permissionsApiService.listPermissions(),
      }).subscribe({
        next: ({ roles, allRoles, permissions, catalog }) => {
          this.allRoles.set(allRoles ?? []);
          this.roles.set(roles);
          this.scopedPermissions.set(permissions.scopedPermissions ?? []);
          this.permissionOptions.set(
            (catalog ?? []).flatMap((g) =>
              (g.permissions ?? []).map((p) => ({
                label: `${p.code} — ${p.description}`,
                value: p.code ?? '',
              }))
            )
          );
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }

  public assign(): void {
    const roleId = this.selectedRoleId();
    if (!roleId) return;
    this.isAssigning.set(true);
    this._usersApiService
      .assignRoleToUser(this.id(), { roleId })
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            "Impossible d'assigner le rôle.",
          );
          this.isAssigning.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        const role = this.allRoles().find((r) => r.id === roleId);
        if (role) this.roles.update((list) => [...list, role]);
        this._snackbarService.success('Succès', 'Rôle assigné.');
        this.selectedRoleId.set('');
        this.isAssigning.set(false);
      });
  }

  public revoke(role: RoleDto): void {
    this._confirmDialogService.confirm({
      title: 'Révoquer le rôle',
      message: `Révoquer le rôle "${role.label ?? role.name}" pour cet utilisateur ?`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Révoquer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.revokingRoleId.set(role.id ?? null);
        this._usersApiService
          .revokeRoleFromUser(this.id(), { roleId: role.id! })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de révoquer le rôle.',
              );
              this.revokingRoleId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.roles.update((list) => list.filter((r) => r.id !== role.id));
            this._snackbarService.success('Succès', 'Rôle révoqué.');
            this.revokingRoleId.set(null);
          });
      },
    });
  }

  public assignScopedPermission(): void {
    const req: AssignScopedPermissionRequest = {
      permissionCode: this.newPermissionCode() || null,
      scopeType: this.newScopeType() || null,
      scopeId: this.newScopeId() || null,
      startDate: this.newStartDate() || undefined,
      endDate: this.newEndDate() || undefined,
    };
    this.isAssigningPermission.set(true);
    this._usersApiService
      .assignScopedPermission(this.id(), req)
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', "Impossible d'attribuer la permission.");
          this.isAssigningPermission.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._usersApiService.getUserPermissions(this.id()).subscribe({
          next: (p) => this.scopedPermissions.set(p.scopedPermissions ?? []),
        });
        this._snackbarService.success('Succès', 'Permission attribuée.');
        this.newPermissionCode.set('');
        this.newScopeType.set('');
        this.newScopeId.set('');
        this.newStartDate.set('');
        this.newEndDate.set('');
        this.isAssigningPermission.set(false);
      });
  }

  public revokeScopedPermission(perm: ScopedPermissionDto): void {
    this._confirmDialogService.confirm({
      title: 'Révoquer la permission',
      message: `Révoquer la permission "${perm.permissionCode}" pour cet utilisateur ?`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Révoquer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.revokingPermissionId.set(perm.id ?? null);
        this._usersApiService
          .revokeScopedPermission(this.id(), perm.id!)
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de révoquer la permission.');
              this.revokingPermissionId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.scopedPermissions.update((list) => list.filter((p) => p.id !== perm.id));
            this._snackbarService.success('Succès', 'Permission révoquée.');
            this.revokingPermissionId.set(null);
          });
      },
    });
  }

  protected readonly users = Users;
}

export default UserRolesPage;
