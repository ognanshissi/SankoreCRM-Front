import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, minLength, required, submit } from '@angular/forms/signals';
import { catchError, firstValueFrom, of } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { UsersApiService } from '@sankore/crm-api';
import { AuthenticationService } from '@sankore/crm/common';

export interface ImpersonateDialogData {
  userId: string;
  userName: string;
}

class ImpersonateFormModel {
  public reason!: string;
  public static instantiate(): ImpersonateFormModel {
    const m = new ImpersonateFormModel();
    m.reason = '';
    return m;
  }
}

/** Motif obligatoire avant d'agir sous l'identité de quelqu'un : il part dans l'audit. */
@Component({
  selector: 'impersonate-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, Button, TasError, TasFormField, TasLabel, TasInput, FormRoot, FormField],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Se faire passer pour {{ data.userName }}</p>
        <p class="text-xs text-slate-400 mt-0.5">Pour voir l'application exactement comme cette personne la voit.</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
            <ul class="list-disc pl-5 space-y-0.5">
              <li>Vous aurez ses droits, et seulement les siens, pendant 30 minutes au plus.</li>
              <li>Chaque action sera enregistrée dans l'audit à votre nom et au sien.</li>
              <li>Son mot de passe et ses sessions restent hors de portée.</li>
              <li>Un bandeau vous permet de revenir à votre compte à tout moment.</li>
            </ul>
          </div>
          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="3" placeholder="Ex. : reproduire l'erreur signalée sur son tableau de bord" [formField]="formSchema.reason"></textarea>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          @if (serverError(); as message) {
            <p class="text-sm text-functional-error">{{ message }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="primary" type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()" [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()">
          Commencer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ImpersonateDialog {
  public readonly data = inject<ImpersonateDialogData>(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _snackbar = inject(SnackbarService);

  public serverError = signal<string | null>(null);
  public model = signal(ImpersonateFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Indiquez le motif' });
    minLength(schema.reason, 5, { message: '5 caractères au moins' });
    maxLength(schema.reason, 500, { message: '500 caractères au maximum' });
  });

  public handleSubmit(): void {
    this.serverError.set(null);
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;
      const started = await firstValueFrom(
        this._usersApi.impersonateUser(this.data.userId, { reason: value.reason.trim() }).pipe(
          catchError((err: HttpErrorResponse) => {
            this.serverError.set(err.error?.detail ?? err.error?.title ?? 'L’usurpation n’a pas pu commencer.');
            return of(null);
          }),
        ),
      );
      if (!started?.accessToken) return;
      this._snackbar.info('Usurpation', `Vous agissez maintenant en tant que ${this.data.userName}.`);
      this._dialogRef.close(true);
      this._auth.startImpersonation(started, `/settings/users/${this.data.userId}/informations`);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
