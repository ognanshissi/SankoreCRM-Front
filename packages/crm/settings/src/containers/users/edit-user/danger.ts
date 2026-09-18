import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { UsersApiService, UserDto, AuthApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ResetPasswordDialog } from './reset-password-dialog';
import { TasCard } from '@talisoft/ui/card';

@Component({
  selector: 'user-danger',
  imports: [Button, TasSpinner, TasCard],
  template: `
    <tas-card class="px-4">
      @if (isLoading()) {
        <div class="flex justify-center py-24">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <div class="pb-6">
          <!-- Flat action manifest -->
          <div class="divide-y divide-slate-100">
            <!-- Modifier le mot de passe -->
            <div class="flex items-start justify-between gap-6 py-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm font-medium text-slate-800"
                    >Modifier le mot de passe</span
                  >
                  <span
                    class="inline-flex items-center gap-1.5 text-xs text-green-600"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                    ></span>
                    Disponible
                  </span>
                </div>
                <p class="text-sm text-slate-400 leading-snug">
                  Définissez directement un nouveau mot de passe pour ce compte.
                  Le changement prend effet immédiatement.
                </p>
              </div>
              <button
                tas-outlined-button
                type="button"
                (click)="openChangePasswordDialog()"
                class="shrink-0 mt-0.5"
              >
                Modifier
              </button>
            </div>

            <!-- Envoyer lien de réinitialisation -->
            <div class="flex items-start justify-between gap-6 py-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm font-medium text-slate-800"
                    >Envoyer un lien de réinitialisation</span
                  >
                  @if (status() === '1' || status() === '0') {
                    <span
                      class="inline-flex items-center gap-1.5 text-xs text-green-600"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                      ></span>
                      Disponible
                    </span>
                  } @else {
                    <span
                      class="inline-flex items-center gap-1.5 text-xs text-slate-400"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"
                      ></span>
                      Non disponible
                    </span>
                  }
                </div>
                <p class="text-sm text-slate-400 leading-snug">
                  Un email sera envoyé à
                  <span class="font-medium text-slate-600">{{
                    user()?.email ?? '—'
                  }}</span
                  >. L'utilisateur choisira son nouveau mot de passe via ce
                  lien.
                </p>
              </div>
              <button
                tas-outlined-button
                type="button"
                [disabled]="
                  (status() !== '1' && status() !== '0') || isSendingReset()
                "
                [isLoading]="isSendingReset()"
                (click)="confirmResetPassword()"
                class="shrink-0 mt-0.5"
              >
                Envoyer
              </button>
            </div>

            <!-- Réactiver -->
            <div class="flex items-start justify-between gap-6 py-4">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-sm font-medium text-slate-800"
                    >Réactiver le compte</span
                  >
                  @if (status() === '2') {
                    <span
                      class="inline-flex items-center gap-1.5 text-xs text-green-600"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0"
                      ></span>
                      Disponible
                    </span>
                  } @else {
                    <span
                      class="inline-flex items-center gap-1.5 text-xs text-slate-400"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"
                      ></span>
                      Compte actif
                    </span>
                  }
                </div>
                <p class="text-sm text-slate-400 leading-snug">
                  Restaure l'accès à la plateforme. Disponible uniquement pour
                  les comptes désactivés.
                </p>
              </div>
              <button
                tas-outlined-button
                color="primary"
                type="button"
                [disabled]="status() !== '2' || isReactivating()"
                [isLoading]="isReactivating()"
                (click)="confirmReactivate()"
                class="shrink-0 mt-0.5"
              >
                Réactiver
              </button>
            </div>
          </div>

          <!-- Separator before destructive action -->
          <div class="my-5 flex items-center gap-3">
            <div class="flex-1 h-px bg-slate-100"></div>
            <span class="text-xs text-slate-300 font-medium"
              >action irréversible</span
            >
            <div class="flex-1 h-px bg-slate-100"></div>
          </div>

          <!-- Désactiver — quarantined with dashed border -->
          <div
            class="border border-dashed border-red-200 rounded-lg p-4 flex items-start justify-between gap-6"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-medium text-red-700"
                  >Désactiver le compte</span
                >
                @if (status() === '1') {
                  <span
                    class="inline-flex items-center gap-1.5 text-xs text-red-500"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"
                    ></span>
                    Disponible
                  </span>
                } @else {
                  <span
                    class="inline-flex items-center gap-1.5 text-xs text-slate-400"
                  >
                    <span
                      class="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"
                    ></span>
                    Non disponible
                  </span>
                }
              </div>
              <p class="text-sm text-slate-400 leading-snug">
                Révoque immédiatement tous les accès. Le compte reste conservé
                et peut être réactivé. Les leads actifs seront réassignés
                automatiquement.
              </p>
            </div>
            <button
              tas-outlined-button
              color="warn"
              type="button"
              [disabled]="status() !== '1' || isDeactivating()"
              [isLoading]="isDeactivating()"
              (click)="confirmDeactivate()"
              class="shrink-0 mt-0.5"
            >
              Désactiver
            </button>
          </div>
        </div>
      }
    </tas-card>
  `,
})
export class UserDangerPage {
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _authApiService = inject(AuthApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isDeactivating = signal(false);
  public isReactivating = signal(false);
  public isSendingReset = signal(false);
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
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible de désactiver l'utilisateur.",
              );
              this.isDeactivating.set(false);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Utilisateur désactivé.');
            this._router.navigate(['/settings/users']);
          });
      },
    });
  }

  public openChangePasswordDialog(): void {
    this._sideDrawerService.open(ResetPasswordDialog, {
      data: {
        userId: this.id(),
        userName: this.user()?.fullName ?? this.user()?.email ?? 'Utilisateur',
      },
    });
  }

  public confirmResetPassword(): void {
    const email = this.user()?.email;
    if (!email) return;
    this._confirmDialogService.confirm({
      title: 'Réinitialiser le mot de passe',
      message: `Un email de réinitialisation sera envoyé à "${email}". L'utilisateur devra définir un nouveau mot de passe avant de se reconnecter.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Envoyer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isSendingReset.set(true);
        this._authApiService
          .forgotPassword({ email })
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible d'envoyer l'email de réinitialisation.",
              );
              this.isSendingReset.set(false);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success(
              'Succès',
              'Email de réinitialisation envoyé.',
            );
            this.isSendingReset.set(false);
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
          .pipe(
            catchError(() => {
              this._snackbarService.error(
                'Erreur',
                "Impossible de réactiver l'utilisateur.",
              );
              this.isReactivating.set(false);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Utilisateur réactivé.');
            this.user.update((u) => (u ? { ...u, status: '1' } : u));
            this.isReactivating.set(false);
          });
      },
    });
  }
}

export default UserDangerPage;
