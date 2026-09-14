import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { UsersApiService, RolesApiService, UserDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';

@Component({
  selector: 'role-users',
  imports: [
    FormsModule,
    TasCard,
    Button,
    TasIcon,
    TasFormField,
    TasLabel,
    TasSelect,
    TasSpinner
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">
        <h1 class="text-lg font-semibold text-slate-900 truncate">Les utilisateurs</h1>

        <!-- Assign section -->
        <tas-card>
          <div class="p-4 flex flex-col gap-4">
            <p class="font-medium text-slate-800">Assigner ce rôle à un utilisateur</p>
            <div class="flex gap-3 items-end">
              <div class="flex-1">
                <tas-form-field>
                  <tas-label>Utilisateur</tas-label>
                  <tas-select
                    [options]="userOptions()"
                    placeholder="Sélectionnez un utilisateur"
                    [ngModel]="selectedUserId()"
                    (ngModelChange)="selectedUserId.set($event)"
                  ></tas-select>
                </tas-form-field>
              </div>
              <button
                tas-raised-button
                color="primary"
                type="button"
                [disabled]="!selectedUserId() || isAssigning()"
                [isLoading]="isAssigning()"
                (click)="assign()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:user-plus" iconSize="sm"></tas-icon>
                Assigner
              </button>
            </div>
          </div>
        </tas-card>

        <!-- Users list -->
        <h1 class="text-lg font-semibold text-slate-900 truncate">Liste des utilisateurs associés</h1>
        <tas-card>
          @if (users().length === 0) {
            <div class="flex flex-col items-center py-12 text-slate-400 gap-2">
              <tas-icon iconName="feather:users" iconSize="xl"></tas-icon>
              <p class="text-sm">Aucun utilisateur trouvé.</p>
            </div>
          } @else {
            <div class="divide-y divide-gray-100">
              @for (user of users(); track user.id) {
                <div class="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                  <div>
                    <p class="font-medium text-slate-800">{{ user.fullName ?? '—' }}</p>
                    <p class="text-xs text-slate-500">{{ user.email }}</p>
                  </div>
                  <button
                    tas-outlined-button
                    color="warn"
                    type="button"
                    [disabled]="revokingUserId() === user.id"
                    [isLoading]="revokingUserId() === user.id"
                    (click)="revoke(user)"
                  >
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
export class RoleUsersPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isAssigning = signal(false);
  public users = signal<UserDto[]>([]);
  public selectedUserId = signal('');
  public revokingUserId = signal<string | null>(null);

  public userOptions = computed(() =>
    this.users().map((u) => ({
      label: u.fullName ?? u.email ?? '',
      value: u.id ?? '',
    })),
  );

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._usersApiService
        .listUsers(undefined, undefined, undefined, 1, 0)
        .subscribe({
          next: (result) => {
            this.users.set(result.items ?? []);
            this.isLoading.set(false);
          },
          error: () => this.isLoading.set(false),
        });
    });
  }

  public assign(): void {
    const userId = this.selectedUserId();
    if (!userId) return;
    this.isAssigning.set(true);
    this._usersApiService
      .assignRoleToUser(userId, { roleId: this.id() })
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
        const user = this.users().find((u) => u.id === userId);
        this._snackbarService.success(
          'Succès',
          `Rôle assigné à ${user?.fullName ?? "l'utilisateur"}.`,
        );
        this.selectedUserId.set('');
        this.isAssigning.set(false);
      });
  }

  public revoke(user: UserDto): void {
    this._confirmDialogService.confirm({
      title: 'Révoquer le rôle',
      message: `Révoquer ce rôle pour "${user.fullName ?? user.email}" ?`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Révoquer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.revokingUserId.set(user.id ?? null);
        this._usersApiService
          .revokeRoleFromUser(user.id!, { roleId: this.id() })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                'Impossible de révoquer le rôle.',
              );
              this.revokingUserId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Rôle révoqué.');
            this.users.update((list) => list.filter((u) => u.id !== user.id));
            this.revokingUserId.set(null);
          });
      },
    });
  }
}

export default RoleUsersPage;
