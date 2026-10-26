import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { DistributionCredentialsApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { credentialErrorMessage } from './credential.models';

export interface WithdrawCredentialDrawerData {
  userId: string;
  userName: string;
}

class WithdrawFormModel {
  public reason!: string;
  public static instantiate(): WithdrawFormModel {
    const m = new WithdrawFormModel();
    m.reason = '';
    return m;
  }
}

/** Clôt la carte en vigueur sans la remplacer : retrait, suspension, départ. */
@Component({
  selector: 'withdraw-credential-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasFormField, TasLabel, TasError, TasInput, Button, FormRoot, FormField],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>Retirer la carte professionnelle</tas-drawer-title>
      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <p class="text-sm text-slate-600">
            Dès le retrait, {{ data.userName }} ne peut plus signer de contrat d'assurance ni recevoir de lead
            assurance. La carte reste à l'historique.
          </p>
          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="3" placeholder="Retrait par l'autorité, départ de l'institution…" [formField]="formSchema.reason"></textarea>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" class="rounded-full" (click)="dialogRef.close(false)">Annuler</button>
          <button tas-raised-button color="warn" type="button" class="rounded-full"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="handleSubmit()">Retirer la carte</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class WithdrawCredentialDrawer {
  protected readonly data = inject<WithdrawCredentialDrawerData>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(DistributionCredentialsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly model = signal(WithdrawFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.reason, (ctx) => (ctx.value().trim() ? null : { kind: 'required', message: 'Le motif est obligatoire' }));
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const done = await firstValueFrom(
        this._api.withdrawUserCredential(this.data.userId, { reason: field().value().reason.trim() }).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Carte non retirée', credentialErrorMessage(err, "La carte n'a pas pu être retirée."));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (!done) return;
      this._snackbar.success('Carte retirée', 'Elle reste consultable dans l’historique.');
      this.dialogRef.close(true);
    });
  }
}
