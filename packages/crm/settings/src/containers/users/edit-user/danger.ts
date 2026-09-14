import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { UsersApiService, UserDto } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';

@Component({
  selector: 'user-danger',
  imports: [TasCard, Button, TasIcon, TasSpinner],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4 flex flex-col gap-4">
            <p class="text-sm font-semibold text-slate-700">Zone de danger</p>

            @if (!isActive()) {
              <div class="flex gap-3 p-4 rounded-lg bg-slate-50 border border-slate-200">
                <tas-icon iconName="feather:info" class="text-slate-400 shrink-0 mt-0.5"></tas-icon>
                <p class="text-sm text-slate-600">Cet utilisateur est déjà désactivé.</p>
              </div>
            } @else {
              <div class="flex items-start justify-between gap-4 p-4 rounded-lg border border-functional-error/20 bg-functional-error/5">
                <div>
                  <p class="font-medium text-warn">Désactiver l'utilisateur</p>
                  <p class="text-sm text-slate-500 mt-1">
                    Révoque tous les accès. Le compte n'est pas supprimé et peut être réactivé. Les leads actifs seront réassignés automatiquement.
                  </p>
                </div>
                <button
                  tas-outlined-button
                  color="warn"
                  type="button"
                  [disabled]="isDeactivating()"
                  [isLoading]="isDeactivating()"
                  (click)="confirmDeactivate()"
                  class="shrink-0"
                >
                  <tas-icon iconName="feather:user-x" iconSize="sm"></tas-icon>
                  Désactiver
                </button>
              </div>
            }
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class UserDangerPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isDeactivating = signal(false);
  public user = signal<UserDto | null>(null);

  public isActive = computed(() => this.user()?.status === '1');

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._usersApiService.getUser(this.id()).subscribe({
        next: (user) => {
          this.user.set(user);
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }

  public confirmDeactivate(): void {
    this._confirmDialogService.confirm({
      title: "Désactiver l'utilisateur",
      message: `Désactiver "${this.user()?.fullName ?? this.user()?.email}" ? L'utilisateur ne pourra plus se connecter et ses leads actifs seront réassignés.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Désactiver', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isDeactivating.set(true);
        this._usersApiService
          .deactivateUser(this.id())
          .pipe(catchError(() => {
            this._snackbarService.error('Erreur', "Impossible de désactiver l'utilisateur.");
            this.isDeactivating.set(false);
            return EMPTY;
          }))
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Utilisateur désactivé.');
            this._router.navigate(['/settings/users']);
          });
      },
    });
  }
}

export default UserDangerPage;
