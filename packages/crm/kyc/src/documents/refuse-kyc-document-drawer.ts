import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
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
import { ReviewKycDocumentRequestDecisionEnum } from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';

/** Longueur minimale du motif, telle que le validateur serveur l'exige. */
const MINIMUM_REASON_LENGTH = 10;
const MAXIMUM_REASON_LENGTH = 2000;

export interface RefuseKycDocumentDrawerData {
  kycFileId: string;
  documentId: string;
  /** Libellé de la nature de la pièce, pour que le validateur voie ce qu'il refuse. */
  kindLabel: string;
}

class RefuseDocumentFormModel {
  public reason!: string;

  public static empty(): RefuseDocumentFormModel {
    const model = new RefuseDocumentFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Refus d'une pièce, avec motif (`POST /kyc-files/{id}/documents/{documentId}/review`).
 *
 * **Le motif est obligatoire et c'est le cœur de l'écran.** Il est lu par l'agent qui doit
 * reproduire une image exploitable : « Refusé » sans motif l'envoie deviner laquelle des pièces
 * reprendre et ce qui n'allait pas. Le serveur exige au moins dix caractères, et l'écran le dit
 * avant l'envoi plutôt que de traduire un 400.
 *
 * Deux conséquences à annoncer, parce qu'elles ne se devinent pas :
 *
 * - **Le dossier repart en complément.** Refuser une pièce ne refuse pas le client : le dossier
 *   retourne à l'agent pour qu'il fournisse mieux.
 * - **Un refus ne se reprend pas.** Une pièce se décide une fois ; corriger passe par un nouveau
 *   dépôt, qui crée une nouvelle ligne, et ce refus reste au dossier comme la raison de ce dépôt.
 *
 * Le motif part dans la piste d'audit sans être masqué — c'est ce qui prouve que le refus était une
 * décision et non un clic — donc l'aide du champ demande de n'y reporter aucune donnée du client.
 */
@Component({
  selector: 'refuse-kyc-document-drawer',
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
        <tas-title>Refuser la pièce</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p class="text-xs text-slate-600">
            Pièce concernée :
            <span class="font-medium">{{ data.kindLabel }}</span>
          </p>
        </div>

        <p class="mb-4 text-xs text-slate-500">
          Le dossier repartira en <strong>complément requis</strong> : l'agent devra fournir une
          image exploitable. Une pièce ne se décide qu'une fois — un refus se corrige par un
          nouveau dépôt, pas en revenant sur celui-ci.
        </p>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>
              Motif du refus <span class="text-functional-error">*</span>
            </tas-label>
            <input
              tasInput
              type="text"
              [formField]="formSchema.reason"
              placeholder="Photo floue, le numéro de la pièce est illisible"
            />
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>
                Lu par l'agent et conservé dans la piste d'audit : n'y reportez aucune donnée du
                client (numéro de pièce, téléphone, adresse).
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
          color="warn"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          <tas-icon iconName="feather:x-circle"></tas-icon>
          Refuser la pièce
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RefuseKycDocumentDrawer {
  public readonly data: RefuseKycDocumentDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public model = signal(RefuseDocumentFormModel.empty());

  public formSchema = form(this.model, (schema) => {
    validate(schema.reason, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw) return { kind: 'required', message: 'Le motif est obligatoire pour un refus' };
      if (raw.length < MINIMUM_REASON_LENGTH) {
        return {
          kind: 'minLength',
          message: `Décrivez le problème en au moins ${MINIMUM_REASON_LENGTH} caractères`,
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

      const refused = await firstValueFrom(
        this._facade
          .reviewDocument(
            this.data.kycFileId,
            this.data.documentId,
            ReviewKycDocumentRequestDecisionEnum.Refused,
            reason,
          )
          .pipe(
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              const message = this._errorMessage(error);
              this.submitError.set(message);
              this._snackbar.error('Refus impossible', message);
              return EMPTY;
            }),
          ),
      );

      if (!refused) return;

      this._snackbar.success(
        'Pièce refusée',
        'Le dossier repart en complément requis avec votre motif.',
      );
      this._dialogRef.close(true);
    });
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 403) {
      return "Vous n'avez pas le droit de valider les pièces d'un dossier.";
    }

    // 409 couvre trois courses distinctes, et les confondre enverrait le validateur chercher la
    // mauvaise cause : le code du serveur est ce qui les sépare.
    if (error.status === 409) {
      switch (error.error?.error) {
        case 'KYC_DOCUMENT_ALREADY_REVIEWED':
          return 'Cette pièce a déjà été décidée. Rechargez la liste pour voir par qui.';
        case 'KYC_DOCUMENT_NOT_CURRENT':
          return "Une image plus récente a remplacé celle-ci : c'est la nouvelle qu'il faut examiner.";
        case 'KYC_INVALID_TRANSITION':
          return "Le dossier n'est plus dans un état où une pièce peut être refusée.";
        case 'KYC_CONCURRENCY_CONFLICT':
          return 'Quelqu\'un a décidé cette pièce au même moment. Rechargez la liste.';
        default:
          return 'Le dossier a changé entre-temps. Rechargez la liste.';
      }
    }

    const errors = error.error?.errors as Record<string, string[]> | undefined;
    const first = errors ? Object.values(errors).flat()[0] : undefined;

    return first ?? error.error?.title ?? 'La pièce n\'a pas pu être refusée.';
  }
}
