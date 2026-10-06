import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, firstValueFrom, map, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { KycFacadeService } from '../data-access/kyc-facade.service';

export interface ClearDuplicateFlagDrawerData {
  kycFileId: string;
  /** Nom du client, pour que l'agent sache sur quel dossier il lève le signalement. */
  customerName: string | null;
}

class ClearDuplicateFlagFormModel {
  public reason!: string;

  public static instantiate(): ClearDuplicateFlagFormModel {
    const model = new ClearDuplicateFlagFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Levée du signalement de doublon (`POST /kyc-files/{id}/duplicate-flag/clear`).
 *
 * Deux choses que l'écran doit dire, et qui viennent du contrat :
 *
 * 1. **Le motif est obligatoire** et part dans la piste d'audit. C'est tout l'objet de l'opération :
 *    le serveur n'accepte pas de lever un signalement sans justification écrite.
 * 2. **Le niveau de vigilance n'est pas abaissé.** Le dossier a été suspect, et cela reste vrai.
 *    Promettre le contraire ferait croire à l'agent qu'il vient de ramener le dossier à un parcours
 *    ordinaire, alors que la vigilance renforcée et son étape de conformité restent en place.
 */
@Component({
  selector: 'kyc-clear-duplicate-flag-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    Button,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Lever le signalement de doublon</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          @if (customerName) {
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p class="text-xs text-slate-400">Dossier</p>
              <p class="text-sm font-medium text-slate-700">{{ customerName }}</p>
            </div>
          }

          <div class="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <tas-icon
              iconName="feather:alert-triangle"
              class="mt-0.5 shrink-0 text-amber-600"
              style="font-size:14px"
            ></tas-icon>
            <div class="text-sm text-slate-700">
              <p class="font-medium text-amber-800">Le niveau de vigilance reste inchangé</p>
              <p class="mt-0.5 text-xs text-amber-700">
                Lever le signalement retire l'alerte de doublon du dossier, rien de plus : le dossier
                a été suspect, et son niveau de vigilance — avec l'étape de conformité qu'il impose —
                reste celui qu'il avait.
              </p>
            </div>
          </div>

          <tas-form-field>
            <tas-label>
              Motif de la levée <span class="text-functional-error">*</span>
            </tas-label>
            <textarea
              tasInput
              rows="3"
              placeholder="Ex. vérification faite avec le client présent : homonymie, pièces et dates de naissance différentes"
              [formField]="formSchema.reason"
            ></textarea>
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>
                Conservé dans la piste d'audit du dossier, avec votre nom. Écrivez ce qui a été
                vérifié, pas « doublon levé ».
              </tas-hint>
            }
          </tas-form-field>

          @if (submitError()) {
            <p class="text-sm text-functional-error" role="alert">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          Lever le signalement
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ClearDuplicateFlagDrawer {
  private readonly _data: ClearDuplicateFlagDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly customerName = this._data.customerName;

  public readonly submitError = signal<string | null>(null);

  public model = signal(ClearDuplicateFlagFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    // `required` laisserait passer une suite d'espaces : une justification vide de sens inscrite à
    // la piste d'audit vaut moins que pas de levée du tout, puisqu'elle donne l'illusion d'un
    // contrôle. Même parti que le motif de soumission forcée de la comparaison faciale.
    validate(schema.reason, (ctx) =>
      (ctx.value() ?? '').trim()
        ? undefined
        : { kind: 'required', message: 'Le motif de la levée est obligatoire' },
    );
  });

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const reason = (value?.reason ?? '').trim();
      if (!reason) return;

      // L'opération répond **204 sans corps** : tester la vérité de la réponse ne distinguerait pas
      // le succès de l'échec. D'où le jeton explicite, et `of(null)` plutôt que `EMPTY` sur l'erreur
      // — `firstValueFrom` rejette sur un flux vide.
      const outcome = await firstValueFrom(
        this._facade.clearDuplicateFlag(this._data.kycFileId, reason).pipe(
          map(() => 'cleared' as const),
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Levée refusée', message);
            return of(null);
          }),
        ),
      );

      if (!outcome) return;

      this._snackbar.success(
        'Signalement levé',
        'Le motif est enregistré dans le dossier. Le niveau de vigilance, lui, reste inchangé.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _errorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 400:
        return error.error?.detail ?? error.error?.title ?? 'Le motif a été refusé par le serveur.';
      case 403:
        return "Vous n'avez pas le droit de lever un signalement de doublon.";
      case 404:
        return "Ce dossier n'existe plus côté serveur. Rechargez la page.";
      default:
        return error.error?.detail ?? "Le signalement n'a pas pu être levé. Réessayez.";
    }
  }
}
