import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, minLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInputPassword } from '@talisoft/ui/input-password';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { UsersApiService } from '@sankore/crm-api';

class ChangePasswordFormModel {
  public currentPassword!: string;
  public newPassword!: string;
  public confirmPassword!: string;

  public static instantiate(): ChangePasswordFormModel {
    const m = new ChangePasswordFormModel();
    m.currentPassword = '';
    m.newPassword = '';
    m.confirmPassword = '';
    return m;
  }
}

/** Messages lisibles pour les codes que renvoie `POST users/me/change-password`. */
const SERVER_ERRORS: Record<string, string | undefined> = {
  PASSWORD_RECENTLY_USED: 'Ce mot de passe a déjà été utilisé récemment. Choisissez-en un autre.',
  CURRENT_PASSWORD_INCORRECT: 'Le mot de passe actuel est incorrect.',
};

/**
 * Ferme le tiroir avec `true` quand le mot de passe a changé : le serveur a alors fermé toutes les
 * sessions, celle-ci comprise, et l'appelant doit déconnecter l'utilisateur.
 */
@Component({
  selector: 'change-password-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, Button, TasError, TasIcon,
    TasInputPassword, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Modifier le mot de passe</p>
        <p class="text-xs text-slate-400 mt-0.5">Toutes vos sessions seront fermées : vous vous reconnecterez avec le nouveau.</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <div>
            <tas-input-password placeholder="Mot de passe actuel" [formField]="formSchema.currentPassword">
              Mot de passe actuel
            </tas-input-password>
            @if (formSchema.currentPassword().touched() && formSchema.currentPassword().invalid()) {
              <tas-error>{{ formSchema.currentPassword().errors()[0].message }}</tas-error>
            }
          </div>

          <div>
            <tas-input-password placeholder="Nouveau mot de passe" [formField]="formSchema.newPassword">
              Nouveau mot de passe
            </tas-input-password>
            @if (formSchema.newPassword().touched() && formSchema.newPassword().invalid()) {
              <tas-error>{{ formSchema.newPassword().errors()[0].message }}</tas-error>
            }
          </div>

          <div>
            <tas-input-password placeholder="Confirmer le mot de passe" [formField]="formSchema.confirmPassword">
              Confirmer le mot de passe
            </tas-input-password>
            @if (formSchema.confirmPassword().touched() && formSchema.confirmPassword().invalid()) {
              <tas-error>{{ formSchema.confirmPassword().errors()[0].message }}</tas-error>
            }
          </div>

          <ul class="text-xs text-slate-500 space-y-1">
            <li class="flex items-center gap-1.5" [class.text-green-700]="model().newPassword.length >= 8">
              <tas-icon [iconName]="model().newPassword.length >= 8 ? 'feather:check' : 'feather:circle'" style="font-size:12px"></tas-icon>
              Au moins 8 caractères
            </li>
            <li class="flex items-center gap-1.5" [class.text-green-700]="passwordsMatch()">
              <tas-icon [iconName]="passwordsMatch() ? 'feather:check' : 'feather:circle'" style="font-size:12px"></tas-icon>
              Les deux saisies correspondent
            </li>
          </ul>

          @if (serverError(); as message) {
            <p class="text-sm text-functional-error">{{ message }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()">
          Modifier le mot de passe
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ChangePasswordDrawer {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);

  public model = signal(ChangePasswordFormModel.instantiate());
  public serverError = signal<string | null>(null);

  public formSchema = form(this.model, (schema) => {
    required(schema.currentPassword, { message: 'Le mot de passe actuel est obligatoire' });
    required(schema.newPassword, { message: 'Le nouveau mot de passe est obligatoire' });
    minLength(schema.newPassword, 8, { message: 'Au moins 8 caractères' });
    validate(schema.confirmPassword, (ctx) =>
      ctx.value() !== ctx.valueOf(schema.newPassword)
        ? { kind: 'mismatch', message: 'Les deux saisies ne correspondent pas' }
        : null,
    );
  });

  public passwordsMatch(): boolean {
    const m = this.model();
    return !!m.newPassword && m.newPassword === m.confirmPassword;
  }

  public handleSubmit(): void {
    this.serverError.set(null);
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const ok = await firstValueFrom(
        this._usersApi.changePassword({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
          confirmPassword: value.confirmPassword,
        }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            const code: string | undefined = err.error?.detail ?? err.error?.title;
            this.serverError.set((code && SERVER_ERRORS[code]) ?? code ?? 'Le mot de passe n’a pas pu être modifié.');
            return of(false);
          }),
        ),
      );
      if (!ok) return;

      this._snackbar.success('Mot de passe modifié', 'Reconnectez-vous avec votre nouveau mot de passe.');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
