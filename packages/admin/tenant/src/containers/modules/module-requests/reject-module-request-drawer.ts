import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, maxLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { TasTitle } from '@talisoft/ui/title';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { ModuleSubscriptionsApiService } from '@sankore/crm-admin-api';
import { describeModuleError } from '../module-referential';

export interface RejectModuleRequestData {
  subscriptionId: string;
  tenantName: string;
  moduleLabel: string;
}

class RejectFormModel {
  public reason!: string;

  public static instantiate(): RejectFormModel {
    const m = new RejectFormModel();
    m.reason = '';
    return m;
  }
}

/** Le motif est montré tel quel à l'administrateur du tenant, sur sa page « Modules ». */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasHint, TasError, TasInput, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Refuser la demande</TasTitle>
        <p class="text-sm text-slate-500">« {{ data.moduleLabel }} » pour {{ data.tenantName }}</p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="4" placeholder="Ex : contrat de souscription non signé"
                      [formField]="formSchema.reason"></textarea>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Affiché à l’administrateur du tenant, qui pourra faire une nouvelle demande.</tas-hint>
            }
          </tas-form-field>

          @if (serverError()) {
            <p role="alert" class="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{{ serverError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button tas-raised-button color="warn" type="button" (click)="handleSubmit()"
                [disabled]="formSchema().invalid() || formSchema().submitting()"
                [isLoading]="formSchema().submitting()">
          Refuser la demande
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RejectModuleRequestDrawer {
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(ModuleSubscriptionsApiService);
  public readonly data = inject<RejectModuleRequestData>(DIALOG_DATA);

  public serverError = signal<string | null>(null);

  public model = signal(RejectFormModel.instantiate());
  public formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    maxLength(schema.reason, 1000, { message: '1 000 caractères au plus' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      this.serverError.set(null);
      const done = await firstValueFrom(
        this._api.rejectModuleRequest(this.data.subscriptionId, { reason: field().value().reason.trim() }).pipe(
          map(() => true),
          catchError((err) => {
            this.serverError.set(describeModuleError(err, 'La demande n’a pas pu être refusée.'));
            return EMPTY;
          }),
        ),
        { defaultValue: false },
      );
      if (done) this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
