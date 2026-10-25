import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { ErasureRequestDto, ErasureRequestsApiService } from '@sankore/crm-api';
import { erasureBlockerLabel, erasureErrorMessage } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';

export interface DecideErasureDrawerData {
  request: ErasureRequestDto;
  decision: 'approve' | 'reject';
  requestedByName: string;
}

class DecisionFormModel {
  public note = '';
}

/**
 * La décision de la seconde personne (purge de données, lot 3). Approuver efface — ou restreint le
 * client tant que sa conservation légale court ; refuser exige un motif.
 */
@Component({
  selector: 'decide-erasure-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasIcon, Button, FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>{{ isApproval ? 'Approuver l’effacement' : 'Refuser la demande' }}</tas-drawer-title>
      <tas-drawer-content>
        <dl class="mb-5 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt class="text-slate-500">Personne</dt>
          <dd class="font-semibold text-slate-900">{{ data.request.subjectReference }}</dd>
          <dt class="text-slate-500">Demandé par</dt>
          <dd class="text-slate-800">{{ data.requestedByName }}</dd>
          <dt class="text-slate-500">Motif</dt>
          <dd class="text-slate-800 whitespace-pre-line">{{ data.request.reason }}</dd>
          <dt class="text-slate-500">Preuve</dt>
          <dd class="text-slate-800">{{ data.request.evidence }}</dd>
        </dl>

        @if (isApproval) {
          <div class="mb-5 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="note">
            <tas-icon iconName="feather:alert-triangle" class="mt-0.5 shrink-0" style="font-size:15px"></tas-icon>
            <p>Si la personne peut être effacée maintenant, ses données le seront <span class="font-semibold">immédiatement
              et définitivement</span> dans tous les modules. Sinon (client encore sous conservation légale), elle sera
              restreinte et effacée automatiquement à l'échéance.</p>
          </div>
        }

        <form [formRoot]="formSchema">
          <tas-form-field>
            <tas-label>{{ isApproval ? 'Commentaire' : 'Motif du refus' }}@if (!isApproval) {<span class="text-functional-error"> *</span>}</tas-label>
            <textarea tasInput rows="3" [formField]="formSchema.note"
                      [placeholder]="isApproval ? 'Facultatif' : 'Ex. : obligation légale de conservation en cours.'"></textarea>
            @if (formSchema.note().touched() && formSchema.note().invalid()) {
              <tas-error>{{ formSchema.note().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Conservé avec la demande : n'y écrivez pas le nom de la personne.</tas-hint>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>
      <tas-drawer-action>
        <div class="flex justify-end gap-2">
          <button tas-outlined-button color="primary" type="button" class="rounded-full" (click)="dialogRef.close(null)">Annuler</button>
          <button tas-raised-button [color]="isApproval ? 'warn' : 'primary'" type="button" class="rounded-full"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()"
                  (click)="handleSubmit()">{{ isApproval ? 'Approuver' : 'Refuser' }}</button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class DecideErasureDrawer {
  protected readonly data = inject<DecideErasureDrawerData>(DIALOG_DATA);
  protected readonly dialogRef = inject(DialogRef<ErasureRequestDto | null>);
  private readonly _api = inject(ErasureRequestsApiService);
  private readonly _snackbar = inject(SnackbarService);

  protected readonly isApproval = this.data.decision === 'approve';

  public readonly model = signal(new DecisionFormModel());
  public readonly formSchema = form(this.model, (schema) => {
    maxLength(schema.note, 500, { message: '500 caractères au plus' });
    validate(schema.note, (ctx) =>
      !this.isApproval && ctx.value().trim().length < 5 ? { kind: 'required', message: 'Le motif du refus est obligatoire' } : null);
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const note = field().value().note.trim() || null;
      const id = this.data.request.id!;
      const call = this.isApproval
        ? this._api.approveErasureRequest(id, { note })
        : this._api.rejectErasureRequest(id, { note });
      const decided = await firstValueFrom(
        call.pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Effacement', erasureErrorMessage(err.error?.error, 'La décision n’a pas pu être enregistrée.'));
            return EMPTY;
          }),
        ),
        { defaultValue: null },
      );
      if (!decided) return;

      if (decided.status === 'Completed') this._snackbar.success('Données effacées', 'L’effacement a été réalisé dans tous les modules.');
      else if (decided.status === 'Restricted') this._snackbar.info('Personne restreinte', erasureBlockerLabel(decided.blocker));
      else this._snackbar.success('Demande refusée', '');
      this.dialogRef.close(decided);
    });
  }
}
