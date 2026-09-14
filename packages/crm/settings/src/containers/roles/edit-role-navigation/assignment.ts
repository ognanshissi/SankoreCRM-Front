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

@Component({
  selector: 'role-assignment',
  imports: [FormsModule, TasCard, Button, TasIcon, TasFormField, TasLabel, TasSelect, TasSpinner],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="py-6">
        <tas-card>
          <div class="p-4 flex flex-col gap-4">
            <div>
              <p class="font-medium text-slate-800 mb-1">Assigner ce rôle à un utilisateur</p>
              <p class="text-sm text-slate-500">
                Sélectionnez un utilisateur pour lui attribuer le rôle
                <span class="font-medium">{{ roleName() }}</span>.
              </p>
            </div>
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
      </div>
    }
  `,
})
export class RoleAssignmentPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isAssigning = signal(false);
  public users = signal<UserDto[]>([]);
  public selectedUserId = signal('');
  public roleName = signal('');

  public userOptions = computed(() =>
    this.users().map((u) => ({ label: u.fullName ?? u.email ?? '', value: u.id ?? '' }))
  );

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._rolesApiService.getRole(this.id()).subscribe({
        next: (role) => this.roleName.set(role.label ?? role.name ?? ''),
      });
      this._usersApiService.listUsers(undefined, undefined, undefined, 1, 0).subscribe({
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
      .pipe(catchError(() => {
        this._snackbarService.error('Erreur', "Impossible d'assigner le rôle.");
        this.isAssigning.set(false);
        return EMPTY;
      }))
      .subscribe(() => {
        const user = this.users().find((u) => u.id === userId);
        this._snackbarService.success('Succès', `Rôle assigné à ${user?.fullName ?? "l'utilisateur"}.`);
        this.selectedUserId.set('');
        this.isAssigning.set(false);
      });
  }
}

export default RoleAssignmentPage;
