import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { TelephonyApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { telephonyErrorMessage } from '../../data-access/telephony-referential';
import { isValidCallerNumber, UserLinkRow } from './user-link-presentation';

export interface CallerNumberDrawerData {
  row: UserLinkRow;
}

class CallerNumberFormModel {
  public defaultCallerNumber!: string;

  public static fromRow(row: UserLinkRow): CallerNumberFormModel {
    const model = new CallerNumberFormModel();
    // La valeur BRUTE, pas la valeur masquée affichée dans la liste : pré-remplir avec
    // « •••• 5678 » ferait enregistrer ces points à la première validation.
    model.defaultCallerNumber = row.rawCallerNumber ?? '';
    return model;
  }
}

/**
 * Numéro d'appelant d'un poste (`PUT user-links/{linkId}/caller-number`).
 *
 * Le champ vide n'est pas une absence de saisie : il EFFACE la surcharge et fait retomber
 * l'utilisateur sur le numéro par défaut de la connexion, ce que le contrat décrit comme
 * l'état ordinaire. Le bouton le dit donc explicitement plutôt que de laisser croire à un
 * enregistrement sans effet.
 */
@Component({
  selector: 'lib-caller-number-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Numéro d'appelant</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p class="text-sm font-medium text-slate-800">{{ row.crmUserName }}</p>
            <p class="mt-0.5 text-xs text-slate-500">
              Compte {{ row.externalDisplayName }} · numéro actuel {{ row.callerNumber }}
            </p>
          </div>

          <tas-form-field>
            <tas-label>Numéro présenté aux clients</tas-label>
            <input tasInput type="text" placeholder="+2252012345678" [formField]="formSchema.defaultCallerNumber" />
            @if (formSchema.defaultCallerNumber().touched() && formSchema.defaultCallerNumber().invalid()) {
              <tas-error>{{ formSchema.defaultCallerNumber().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>
                Format international : un « + » puis 8 à 15 chiffres, sans espace. La valeur est
                remise telle quelle au fournisseur, qui refuse un format local.
              </tas-hint>
            }
          </tas-form-field>

          <p class="text-xs text-slate-500">
            Laissez le champ vide pour supprimer la surcharge : l'utilisateur appellera alors avec
            le numéro par défaut de la connexion.
          </p>

          @if (submitError()) {
            <p class="text-sm text-functional-error">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          {{ isClearing() ? 'Supprimer la surcharge' : 'Enregistrer' }}
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class CallerNumberDrawer {
  private readonly _data: CallerNumberDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly row = this._data.row;
  public readonly submitError = signal<string | null>(null);

  public model = signal(CallerNumberFormModel.fromRow(this._data.row));

  public formSchema = form(this.model, (schema) => {
    validate(schema.defaultCallerNumber, (ctx) =>
      isValidCallerNumber(ctx.value())
        ? null
        : {
            kind: 'pattern',
            message:
              'Format international attendu : un « + » puis 8 à 15 chiffres, sans espace',
          },
    );
  });

  public isClearing(): boolean {
    return (this.formSchema.defaultCallerNumber().value() ?? '').trim() === '';
  }

  public handleSubmit(): void {
    const linkId = this.row.linkId;
    if (!linkId) return;

    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const cleared = value.defaultCallerNumber.trim() === '';

      /**
       * L'endpoint répond 204 : l'observable émet `null`, et un succès ne se distingue
       * donc pas par la valeur reçue d'un repli sur `EMPTY`. Le drapeau le dit.
       */
      let saved = false;
      await firstValueFrom(
        this._api
          .setTelephonyCallerNumber(linkId, {
            defaultCallerNumber: cleared ? null : value.defaultCallerNumber.trim(),
          })
          .pipe(
            tap(() => {
              saved = true;
            }),
            catchError((error: HttpErrorResponse) => {
              const message = telephonyErrorMessage(
                error,
                "Le numéro d'appelant n'a pas pu être enregistré.",
              );
              this.submitError.set(message);
              this._snackbar.error('Enregistrement refusé', message);
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!saved) return;

      this._snackbar.success(
        cleared ? 'Surcharge supprimée' : 'Numéro enregistré',
        cleared
          ? 'Cet utilisateur appelle désormais avec le numéro par défaut de la connexion.'
          : 'Il sera présenté aux clients lors des prochains appels.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
