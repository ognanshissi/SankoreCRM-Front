import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { FormField, FormRoot, form, maxLength, required, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ClientDocumentsApiService } from '@sankore/crm-api';

export interface RemoveClientDocumentDrawerData {
  clientId: string;
  documentId: string;
  title: string;
}

class RemoveClientDocumentFormModel {
  public reason!: string;

  public static instantiate(): RemoveClientDocumentFormModel {
    const m = new RemoveClientDocumentFormModel();
    m.reason = '';
    return m;
  }
}

/**
 * Retrait d'un document déposé sur la fiche. Le retrait est logique et tracé : le motif est
 * obligatoire, le fichier reste conservé et le document disparaît seulement de la liste.
 */
@Component({
  selector: 'remove-client-document-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    Button,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Retirer le document</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-4">
          <p class="text-sm text-slate-700">« {{ data.title }} » ne sera plus affiché sur la fiche.</p>
          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="3" placeholder="Déposé sur la mauvaise fiche" [formField]="formSchema.reason"></textarea>
            <tas-hint>Le retrait est tracé, avec son motif ; le fichier est conservé.</tas-hint>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
          <button
            tas-raised-button
            color="warn"
            type="button"
            [disabled]="formSchema().invalid() || formSchema().submitting()"
            [isLoading]="formSchema().submitting()"
            (click)="handleSubmit()"
          >
            Retirer
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RemoveClientDocumentDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(ClientDocumentsApiService);
  private readonly _snackbar = inject(SnackbarService);
  public readonly data = inject<RemoveClientDocumentDrawerData>(DIALOG_DATA);

  public readonly model = signal(RemoveClientDocumentFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    maxLength(schema.reason, 500, { message: '500 caractères au plus' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      try {
        await firstValueFrom(
          this._api.removeClientDocument(this.data.clientId, this.data.documentId, {
            reason: field().value().reason.trim(),
          }),
        );
        this._snackbar.success('Document retiré', `« ${this.data.title} » n'est plus affiché sur la fiche.`);
        this._dialogRef.close(true);
      } catch {
        this._snackbar.error('Retrait impossible', "Le document n'a pas pu être retiré.");
      }
      return undefined;
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
