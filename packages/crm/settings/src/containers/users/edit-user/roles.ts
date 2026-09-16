import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { UsersApiService, RolesApiService, RoleDto, UserRoleDto } from '@sankore/crm-api';
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
      </div>
    }
  `,
})
export class UserRolesPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isAssigning = signal(false);
  public roles = signal<UserRoleDto[]>([]);
  public allRoles = signal<RoleDto[]>([]);
  public selectedRoleId = signal('');
  public revokingRoleId = signal<string | null>(null);

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
      }).subscribe({
        next: ({ roles, allRoles }) => {
          this.allRoles.set(allRoles ?? []);
          // Build the user's current roles from the full list (user.roles not in DTO, show all for now)
          this.roles.set(roles);
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

  protected readonly users = Users;
}

export default UserRolesPage;
