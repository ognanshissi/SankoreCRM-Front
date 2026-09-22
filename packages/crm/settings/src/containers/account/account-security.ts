import { Component, computed, inject, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { UsersApiService } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';
import { TimeagoPipe } from '@talisoft/ui/timeago';

@Component({
  selector: 'account-security',
  imports: [
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasInputPassword,
    TimeagoPipe,
  ],
  template: `
    <div class="pb-6 flex flex-col gap-4">
      <!-- Change password -->
      <tas-card>
        <div class="p-4 border-b border-slate-100">
          <p
            class="text-sm font-semibold text-slate-700 flex items-center gap-2"
          >
            <tas-icon
              iconName="feather:lock"
              class="text-slate-400"
              style="font-size:14px"
            ></tas-icon>
            Changer mon mot de passe
          </p>
        </div>
        <div class="p-4 flex flex-col gap-4">
          <tas-input-password
            placeholder="Mot de passe actuel"
            [(value)]="currentPassword"
          >
            Mot de passe actuel
          </tas-input-password>
          @if (submitted() && !currentPassword()) {
            <p class="text-xs text-red-500 -mt-3">
              Le mot de passe actuel est obligatoire.
            </p>
          }

          <tas-input-password
            placeholder="Nouveau mot de passe"
            [(value)]="newPassword"
          >
            Nouveau mot de passe
          </tas-input-password>
          @if (submitted() && !newPassword()) {
            <p class="text-xs text-red-500 -mt-3">
              Le mot de passe est obligatoire.
            </p>
          } @else if (submitted() && newPassword().length < 8) {
            <p class="text-xs text-red-500 -mt-3">
              Au moins 8 caractères requis.
            </p>
          }

          <tas-input-password
            placeholder="Confirmer le mot de passe"
            [(value)]="confirmPassword"
          >
            Confirmer le mot de passe
          </tas-input-password>
          @if (
            submitted() &&
            confirmPassword() &&
            newPassword() !== confirmPassword()
          ) {
            <p class="text-xs text-red-500 -mt-3">
              Les mots de passe ne correspondent pas.
            </p>
          }

          <!-- Rules -->
          <ul class="text-xs text-slate-400 space-y-1 list-none">
            <li class="flex items-center gap-1.5">
              <tas-icon
                [iconName]="
                  newPassword().length >= 8 ? 'feather:check' : 'feather:circle'
                "
                style="font-size:12px"
                [class.text-green-500]="newPassword().length >= 8"
              ></tas-icon>
              Au moins 8 caractères
            </li>
            <li class="flex items-center gap-1.5">
              <tas-icon
                [iconName]="
                  passwordsMatch() ? 'feather:check' : 'feather:circle'
                "
                style="font-size:12px"
                [class.text-green-500]="passwordsMatch()"
              ></tas-icon>
              Les mots de passe correspondent
            </li>
          </ul>

          <div class="flex justify-end">
            <button
              tas-raised-button
              color="primary"
              type="button"
              [disabled]="isSaving()"
              [isLoading]="isSaving()"
              (click)="changePassword()"
            >
              <tas-icon
                iconName="feather:save"
                style="font-size:14px"
              ></tas-icon>
              Modifier le mot de passe
            </button>
          </div>
        </div>
      </tas-card>

      <!-- Session info -->
      <tas-card>
        <div class="p-4 border-b border-slate-100">
          <p
            class="text-sm font-semibold text-slate-700 flex items-center gap-2"
          >
            <tas-icon
              iconName="feather:shield"
              class="text-slate-400"
              style="font-size:14px"
            ></tas-icon>
            Session active
          </p>
        </div>
        <div class="p-4 grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs text-slate-400 mb-1">Dernière connexion</p>
            <p class="text-sm text-slate-800">
              {{ lastLogin() ? (lastLogin() | dateTimeAgo) : '—' }}
            </p>
          </div>
          <div>
            <p class="text-xs text-slate-400 mb-1">MFA</p>
            <tas-tag [severity]="mfaEnabled ? 'success' : 'neutral'">
              {{ mfaEnabled ? 'Activé' : 'Désactivé' }}
            </tas-tag>
          </div>
        </div>
        <div class="p-4 border-t border-slate-100">
          <button
            tas-outlined-button
            color="warn"
            type="button"
            (click)="logout()"
          >
            <tas-icon
              iconName="feather:log-out"
              style="font-size:14px"
            ></tas-icon>
            Se déconnecter
          </button>
        </div>
      </tas-card>
    </div>
  `,
})
export class AccountSecurity {
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);

  public currentPassword = signal('');
  public newPassword = signal('');
  public confirmPassword = signal('');
  public submitted = signal(false);
  public isSaving = signal(false);

  public readonly passwordsMatch = computed(
    () =>
      !!this.newPassword() &&
      !!this.confirmPassword() &&
      this.newPassword() === this.confirmPassword(),
  );

  public lastLogin = computed(() => {
    return this._auth.connectedUser()?.lastLoginAt;
  });
  public mfaEnabled = false;

  public changePassword(): void {
    this.submitted.set(true);
    if (
      !this.currentPassword() ||
      !this.newPassword() ||
      this.newPassword().length < 8 ||
      !this.passwordsMatch()
    )
      return;

    this.isSaving.set(true);
    this._usersApi
      .changePassword({
        currentPassword: this.currentPassword(),
        newPassword: this.newPassword(),
        confirmPassword: this.confirmPassword(),
      })
      .pipe(
        catchError(() => {
          this._snackbar.error(
            'Erreur',
            'Impossible de modifier le mot de passe.',
          );
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbar.success(
          'Mot de passe modifié',
          'Votre mot de passe a été mis à jour.',
        );
        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
        this.submitted.set(false);
        this.isSaving.set(false);
        this._auth.logout();
      });
  }

  public logout(): void {
    this._auth.logout();
  }
}

export default AccountSecurity;
