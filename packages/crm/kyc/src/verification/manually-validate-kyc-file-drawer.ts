import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
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

/**
 * Plus long que les dix caractères d'un refus de pièce, comme côté serveur : écraser la machine sur
 * un dossier entier est le geste le plus lourd des deux, et il est relu par qui devra signer.
 */
const MINIMUM_REASON_LENGTH = 20;
const MAXIMUM_REASON_LENGTH = 2000;

export interface ManuallyValidateKycFileDrawerData {
  kycFileId: string;
  /** Statut courant, pour rappeler au validateur d'où le dossier part. */
  currentStatus: string;
}

class ManualValidationFormModel {
  public reason!: string;

  public static empty(): ManualValidationFormModel {
    const model = new ManualValidationFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Validation manuelle des pièces d'un dossier (`POST /kyc-files/{id}/manual-validation`).
 *
 * L'échappatoire pour un dossier que la machine ne peut pas conclure : service biométrique
 * injoignable, ou pièce usée que le service refuse à répétition. Sans elle, un client honnête
 * tourne indéfiniment entre « complément requis » et « en vérification », parce que la seule autre
 * entrée en validation demande un score non rejeté.
 *
 * **Ce n'est pas une approbation**, et l'écran doit le dire : le circuit décide toujours, il gagne
 * le chef d'agence même sur un dossier à risque faible, et le validateur ne pourra signer aucun de
 * ses niveaux — c'est précisément ce qui fait que la validation à la main reste contrôlée.
 *
 * Le motif est obligatoire : c'est toute la preuve que l'écrasement de la machine était une
 * décision. Il n'est pas masqué dans la piste d'audit, donc l'aide du champ demande de n'y reporter
 * aucune donnée du client.
 */
@Component({
  selector: 'manually-validate-kyc-file-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    Button,
    TasError,
    TasFormField,
    TasHint,
    TasLabel,
    TasIcon,
    TasInput,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>Valider les pièces à la main</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p class="text-xs text-slate-600">
            Statut actuel : <span class="font-medium">{{ data.currentStatus }}</span>
          </p>
        </div>

        <div
          class="mb-4 flex gap-2 rounded-lg border border-warn-200 bg-warn-50 p-3"
          role="note"
        >
          <tas-icon iconName="feather:alert-triangle" class="text-warn shrink-0" style="font-size:14px"></tas-icon>
          <p class="text-xs text-slate-700">
            Le dossier entrera en validation <strong>sans score biométrique</strong>. Ce n'est pas
            une approbation : le circuit décide toujours, il comportera le chef d'agence, et
            <strong>vous ne pourrez signer aucun de ses niveaux</strong>.
          </p>
        </div>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>
              Sur quels motifs <span class="text-functional-error">*</span>
            </tas-label>
            <input
              tasInput
              type="text"
              [formField]="formSchema.reason"
              placeholder="Service biométrique indisponible depuis 48h, pièces contrôlées visuellement"
            />
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>
                Relu par qui signera le dossier, et conservé dans la piste d'audit : n'y reportez
                aucune donnée du client.
              </tas-hint>
            }
          </tas-form-field>

          @if (submitError()) {
            <p class="text-xs text-functional-error" role="alert">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">
          <tas-icon iconName="feather:x"></tas-icon> Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          <tas-icon iconName="feather:check-circle"></tas-icon>
          Valider à la main
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ManuallyValidateKycFileDrawer {
  public readonly data: ManuallyValidateKycFileDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public model = signal(ManualValidationFormModel.empty());

  public formSchema = form(this.model, (schema) => {
    validate(schema.reason, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw) return { kind: 'required', message: 'Le motif est obligatoire' };
      if (raw.length < MINIMUM_REASON_LENGTH) {
        return {
          kind: 'minLength',
          message: `Expliquez en au moins ${MINIMUM_REASON_LENGTH} caractères pourquoi la machine est écartée`,
        };
      }
      if (raw.length > MAXIMUM_REASON_LENGTH) {
        return {
          kind: 'maxLength',
          message: `Le motif ne peut pas dépasser ${MAXIMUM_REASON_LENGTH} caractères`,
        };
      }
      return null;
    });
  });

  public close(): void {
    this._dialogRef.close(false);
  }

  public handleSubmit(): void {
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const reason = (field()?.value()?.reason ?? '').trim();
      if (!reason) return;

      const result = await firstValueFrom(
        this._facade.manuallyValidate(this.data.kycFileId, reason).pipe(
          catchError((error: HttpErrorResponse) => {
            const message = this._errorMessage(error);
            this.submitError.set(message);
            this._snackbar.error('Validation impossible', message);
            return EMPTY;
          }),
        ),
      );

      if (!result) return;

      // Les niveaux renvoyés sont le circuit réellement créé : les nommer vaut mieux qu'un
      // « enregistré » qui laisse chercher qui doit signer.
      const levels = result.approvalLevels ?? [];
      this._snackbar.success(
        'Dossier validé à la main',
        levels.length > 0
          ? `Le dossier entre en validation. Doivent signer : ${levels.join(', ')}.`
          : 'Le dossier entre en validation.',
      );
      this._dialogRef.close(true);
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'avez pas le droit de valider les pièces d'un dossier.";
    }

    if (error.status === 409) {
      return error.error?.error === 'KYC_CONCURRENCY_CONFLICT'
        ? 'Le dossier a été modifié au même moment. Rechargez la fiche.'
        : "Le dossier n'est pas dans un état qui autorise une validation à la main : seuls un dossier en vérification ou en complément requis le permettent.";
    }

    const errors = error.error?.errors as Record<string, string[]> | undefined;
    const first = errors ? Object.values(errors).flat()[0] : undefined;

    return first ?? error.error?.title ?? "Le dossier n'a pas pu être validé.";
  }
}
