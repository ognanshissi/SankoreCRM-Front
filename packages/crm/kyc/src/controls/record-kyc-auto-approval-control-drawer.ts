import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { KYCApiService, KycAutoApprovalControlItem } from '@sankore/crm-api';

class FindingFormModel {
  public compliant!: string;
  public finding!: string;

  public static instantiate(): FindingFormModel {
    const m = new FindingFormModel();
    // Rien de présélectionné : le constat est une décision, et un bouton coché d'avance est un
    // constat que quelqu'un enregistre sans l'avoir pris.
    m.compliant = '';
    m.finding = '';
    return m;
  }
}

/**
 * Consigner le constat d'un contrôle a posteriori (KRM-B-11).
 *
 * **Une seule fois, et le tiroir le dit avant d'enregistrer.** Le serveur refuse un second
 * constat — un constat enregistré est la preuve qu'un contrôle a eu lieu, le réécrire
 * réécrirait qui a trouvé quoi — donc l'écran annonce l'irréversibilité plutôt que de laisser
 * découvrir un 409.
 *
 * **Le motif est obligatoire pour « non conforme » et facultatif pour « conforme ».** « J'ai
 * regardé et c'était bon » n'a pas besoin d'un paragraphe ; « ce dossier n'aurait pas dû être
 * validé » est la phrase que lira le collègue qui reprend la revue ouverte derrière.
 */
@Component({
  selector: 'record-kyc-auto-approval-control-drawer',
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    Button,
    TasIcon,
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
      <div tasDrawerTitle>Consigner le constat</div>

      <div tasDrawerContent class="flex flex-col gap-5">
        <div class="flex gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
          <tas-icon iconName="feather:info" class="text-slate-500 shrink-0 mt-0.5" style="font-size:14px"></tas-icon>
          <p class="text-sm text-slate-700">
            Dossier de <strong>{{ control.customerName ?? 'client non résolu' }}</strong>, validé
            automatiquement au niveau {{ control.grantedTier }} sous la politique
            v{{ control.policyVersion }}.
          </p>
        </div>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm font-medium text-slate-700 mb-1">
              Votre constat <span class="text-functional-error">*</span>
            </legend>

            <label class="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="compliant"
                value="yes"
                class="mt-1"
                [checked]="verdict() === 'yes'"
                (change)="setVerdict('yes')"
              />
              <span>
                <span class="font-medium">Conforme</span>
                <span class="block text-xs text-slate-500">
                  La validation sans intervention humaine était justifiée.
                </span>
              </span>
            </label>

            <label class="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="compliant"
                value="no"
                class="mt-1"
                [checked]="verdict() === 'no'"
                (change)="setVerdict('no')"
              />
              <span>
                <span class="font-medium">Non conforme</span>
                <span class="block text-xs text-slate-500">
                  Une revue sera ouverte sur le dossier.
                </span>
              </span>
            </label>
          </fieldset>

          <tas-form-field>
            <tas-label>
              Motif
              @if (verdict() === 'no') {
                <span class="text-functional-error">*</span>
              }
            </tas-label>
            <input
              tasInput
              type="text"
              [formField]="formSchema.finding"
              [placeholder]="verdict() === 'no' ? 'Ce qui n’allait pas' : 'Facultatif'"
            />
            <tas-hint>
              Lu par vos collègues et conservé en clair : jamais un numéro de pièce, une date de
              naissance ni une adresse.
            </tas-hint>
            @if (formSchema.finding().touched() && formSchema.finding().invalid()) {
              <tas-error>{{ formSchema.finding().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <p class="text-xs text-slate-500">
            Un constat enregistré ne peut plus être modifié : il est la preuve que le contrôle a
            eu lieu.
          </p>
        </form>
      </div>

      <div tasDrawerAction class="flex items-center gap-2">
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="!verdict() || formSchema().invalid() || isSaving()"
          [isLoading]="isSaving()"
          (click)="handleSubmit()"
        >
          Enregistrer le constat
        </button>
        <button tas-outlined-button type="button" [disabled]="isSaving()" (click)="close()">
          Annuler
        </button>
      </div>
    </tas-side-drawer>
  `,
})
export class RecordKycAutoApprovalControlDrawer {
  private readonly _kycApi = inject(KYCApiService);
  private readonly _drawerRef = inject(DialogRef<boolean>);
  private readonly _snackbar = inject(SnackbarService);

  public readonly control: KycAutoApprovalControlItem =
    inject<{ control: KycAutoApprovalControlItem }>(DIALOG_DATA).control;

  public isSaving = signal(false);
  public verdict = signal<'' | 'yes' | 'no'>('');

  public model = signal(FindingFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    validate(schema.finding, (ctx) => {
      if (this.verdict() !== 'no') return null;
      return (ctx.value() ?? '').trim()
        ? null
        : { kind: 'required', message: 'Un motif est obligatoire pour un constat non conforme' };
    });
  });

  public setVerdict(value: 'yes' | 'no'): void {
    this.verdict.set(value);
    // Revalide le motif : il devient obligatoire en passant à « non conforme », et le bouton
    // doit se désactiver immédiatement plutôt qu'au premier caractère tapé.
    this.formSchema.finding().markAsTouched();
  }

  public close(): void {
    this._drawerRef.close(false);
  }

  public handleSubmit(): void {
    const verdict = this.verdict();
    if (!verdict) return;

    // Le générateur rend toutes les propriétés optionnelles ; un identifiant absent est une ligne
    // que la file n'aurait pas dû afficher, et l'annoncer vaut mieux qu'un appel sur `undefined`.
    const controlId = this.control.id;
    if (!controlId) {
      this._snackbar.error('Constat impossible', 'Cette ligne est incomplète : rechargez la file.');
      return;
    }

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      this.isSaving.set(true);

      const result = await firstValueFrom(
        this._kycApi
          .recordKycAutoApprovalControl(controlId, {
            compliant: verdict === 'yes',
            finding: value.finding.trim() || undefined,
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Constat refusé', this._errorMessage(error));
              this.isSaving.set(false);
              return EMPTY;
            }),
          ),
      );

      this.isSaving.set(false);
      if (result) this._drawerRef.close(true);
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 409:
        return 'Ce contrôle a déjà été consigné entre-temps. Rechargez la file.';
      case 403:
        // Le seul contrôle de quatre yeux que ce dispositif puisse appliquer : l'agent qui a
        // converti le client ne certifie pas qu'une machine a eu raison de valider son dossier.
        return "Vous ne pouvez pas contrôler ce dossier : vous en êtes l'agent responsable.";
      case 404:
        return "Ce contrôle est introuvable : il a peut-être été consigné puis purgé.";
      default:
        return error.error?.error ?? "Le constat n'a pas pu être enregistré.";
    }
  }
}
