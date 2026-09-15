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
      <div class="pb-6 flex flex-col gap-4">
        <h1 class="text-lg font-semibold text-slate-800">Zone de danger</h1>

        <!-- Deactivate — active users only -->
        <tas-card>
          <div class="p-4 flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center shrink-0 mt-0.5">
                <tas-icon iconName="feather:user-x" class="text-red-400" style="font-size:14px"></tas-icon>
              </div>
              <div>
                <p class="text-sm font-semibold text-red-600">Désactiver cet utilisateur</p>
                <p class="text-sm text-slate-500 mt-0.5">
                  Révoque immédiatement tous les accès. Le compte reste conservé et peut être réactivé. Les leads actifs seront réassignés automatiquement.
                </p>
              </div>
            </div>
            <button
              tas-outlined-button
              color="warn"
              type="button"
              [disabled]="status() !== '1' || isDeactivating()"
              [isLoading]="isDeactivating()"
              (click)="confirmDeactivate()"
              class="shrink-0"
            >
              <tas-icon iconName="feather:user-x" iconSize="sm"></tas-icon>
              Désactiver
            </button>
          </div>
        </tas-card>

        <!-- Reactivate — disabled users only -->
        <tas-card>
          <div class="p-4 flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center shrink-0 mt-0.5">
                <tas-icon iconName="feather:user-check" class="text-green-500" style="font-size:14px"></tas-icon>
              </div>
              <div>
                <p class="text-sm font-semibold text-slate-700">Réactiver cet utilisateur</p>
                <p class="text-sm text-slate-500 mt-0.5">
                  Restaure l'accès à la plateforme. Disponible uniquement pour les comptes désactivés.
                </p>
              </div>
            </div>
            <button
              tas-outlined-button
              color="primary"
              type="button"
              [disabled]="status() !== '2' || isReactivating()"
              [isLoading]="isReactivating()"
              (click)="confirmReactivate()"
              class="shrink-0"
            >
              <tas-icon iconName="feather:user-check" iconSize="sm"></tas-icon>
              Réactiver
            </button>
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
  public isReactivating = signal(false);
  public user = signal<UserDto | null>(null);

  public status = computed(() => this.user()?.status ?? null);

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

  public confirmReactivate(): void {
    this._confirmDialogService.confirm({
      title: "Réactiver l'utilisateur",
      message: `Réactiver "${this.user()?.fullName ?? this.user()?.email}" ? L'utilisateur pourra à nouveau se connecter à la plateforme.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Réactiver', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isReactivating.set(true);
        this._usersApiService
          .reactivateUser(this.id())
          .pipe(catchError(() => {
            this._snackbarService.error('Erreur', "Impossible de réactiver l'utilisateur.");
            this.isReactivating.set(false);
            return EMPTY;
          }))
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Utilisateur réactivé.');
            this.user.update((u) => u ? { ...u, status: '1' } : u);
            this.isReactivating.set(false);
          });
      },
    });
  }
}

export default UserDangerPage;
