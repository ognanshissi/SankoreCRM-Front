import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY } from 'rxjs';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { UsersApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasInputPassword } from '@talisoft/ui/input-password';

export interface ResetPasswordDialogData {
  userId: string;
  userName: string;
}

@Component({
  selector: 'reset-password-dialog',
  imports: [
    TasSideDrawer,
    Button,
    TasIcon,
    TasDrawerAction,
    TasDrawerContent,
    TasDrawerTitle,
    FormsModule,
    TasInputPassword,
  ],
  templateUrl: 'reset-password-dialog.html',
})
export class ResetPasswordDialog {
  public readonly data = inject<ResetPasswordDialogData>(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef);
  private readonly _usersApiService = inject(UsersApiService);
  private readonly _snackbarService = inject(SnackbarService);

  public newPassword = signal('');
  public confirmPassword = signal('');
  public submitted = signal(false);
  public isSaving = signal(false);

  public passwordsMatch = computed(
    () =>
      !!this.newPassword() &&
      !!this.confirmPassword() &&
      this.newPassword() === this.confirmPassword(),
  );

  public submit(): void {
    this.submitted.set(true);
    if (
      !this.newPassword() ||
      this.newPassword().length < 8 ||
      !this.passwordsMatch()
    )
      return;

    this.isSaving.set(true);
    this._usersApiService
      .adminResetPassword(this.data.userId, {
        newPassword: this.newPassword(),
        confirmPassword: this.confirmPassword(),
      })
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            'Impossible de modifier le mot de passe.',
          );
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._snackbarService.success('Succès', 'Mot de passe modifié.');
        this._dialogRef.close(true);
      });
  }

  public close(): void {
    this._dialogRef.close();
  }
}

export default ResetPasswordDialog;
