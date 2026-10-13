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
import { KycFacadeService } from '../data-access/kyc-facade.service';

/** Longueurs telles que le validateur serveur les exige. */
const MINIMUM_REASON_LENGTH = 5;
const MAXIMUM_REASON_LENGTH = 2000;

export interface RevokeKycRemoteInvitationDrawerData {
  kycFileId: string;
  invitationId: string;
  /** Statut du lien au moment du clic, pour que l'agent voie ce qu'il retire. */
  statusLabel: string;
}

class RevokeInvitationFormModel {
  public reason!: string;

  public static empty(): RevokeInvitationFormModel {
    const model = new RevokeInvitationFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Révocation d'un lien de collecte, avec motif
 * (`POST /kyc-files/{id}/remote-invitations/{invId}/revoke`).
 *
 * **Le motif est obligatoire et c'est le cœur de l'écran.** Ce qui disparaît ici, c'est le chemin
 * d'accès d'un client à son propre dossier : s'il rappelle en disant « mon lien ne marche plus »,
 * le motif est la seule chose qui permette de lui répondre. Le serveur exige au moins cinq
 * caractères et l'écran le dit avant l'envoi plutôt que de traduire un 400.
 *
 * Révoquer n'envoie pas de nouveau lien. C'est volontaire : « ce lien ne doit plus fonctionner » et
 * « ce client doit pouvoir reprendre » sont deux décisions, et les confondre enverrait un email à
 * quelqu'un dont on vient peut-être de découvrir que l'adresse n'est pas la bonne.
 */
@Component({
  selector: 'revoke-kyc-remote-invitation-drawer',
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
        <tas-title>Révoquer le lien</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p class="text-xs text-slate-600">
            Lien concerné : <span class="font-medium">{{ data.statusLabel }}</span>
          </p>
        </div>

        <p class="mb-4 text-xs text-slate-500">
          Le lien cessera immédiatement de fonctionner. <strong>Aucun nouveau lien
          n'est envoyé</strong> : si le client doit reprendre sa démarche, utilisez
          « Renvoyer le lien » après avoir vérifié son adresse email.
        </p>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>
              Motif de la révocation <span class="text-functional-error">*</span>
            </tas-label>
            <input
              tasInput
              type="text"
              [formField]="formSchema.reason"
              placeholder="Le client indique ne pas être à l'origine de la demande"
            />
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>
                Lu par vos collègues et conservé dans la piste d'audit : n'y
                reportez aucune donnée du client (email, téléphone, numéro de pièce).
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
          <tas-icon iconName="feather:slash"></tas-icon>
          Révoquer le lien
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class RevokeKycRemoteInvitationDrawer {
  public readonly data: RevokeKycRemoteInvitationDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly submitError = signal<string | null>(null);

  public model = signal(RevokeInvitationFormModel.empty());

  public formSchema = form(this.model, (schema) => {
    validate(schema.reason, (ctx) => {
      const raw = (ctx.value() ?? '').trim();
      if (!raw) {
        return { kind: 'required', message: 'Le motif est obligatoire' };
      }
      if (raw.length < MINIMUM_REASON_LENGTH) {
        return {
          kind: 'minLength',
          message: `Indiquez un motif d'au moins ${MINIMUM_REASON_LENGTH} caractères`,
        };
      }
      if (raw.length > MAXIMUM_REASON_LENGTH) {
        return {
          kind: 'maxLength',
          message: `Le motif ne peut pas dépasser ${MAXIMUM_REASON_LENGTH} caractères`,
        };
      }
      return undefined;
    });
  });

  public close(): void {
    this._dialogRef.close(false);
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const reason = field().value().reason.trim();
      this.submitError.set(null);

      const done = await firstValueFrom(
        this._facade
          .revokeRemoteInvitation(this.data.kycFileId, this.data.invitationId, reason)
          .pipe(
            map(() => true),
            catchError((error: HttpErrorResponse) => {
              this.submitError.set(revokeErrorMessage(error));
              return EMPTY;
            }),
          ),
      );

      if (done) {
        this._snackbar.success('Lien révoqué', 'Le lien ne fonctionne plus.');
        this._dialogRef.close(true);
      }
    });
  }
}

function revokeErrorMessage(error: HttpErrorResponse): string {
  const code = error.error?.error;

  if (code === 'KYC_REMOTE_INVITATION_REVOKE_REASON_REQUIRED') {
    return 'Le motif est obligatoire.';
  }
  if (code === 'KYC_REMOTE_INVITATION_NOT_FOUND' || code === 'KYC_FILE_NOT_FOUND') {
    return "Ce lien n'existe plus. Rafraîchissez la page.";
  }
  if (error.status === 403) {
    return "Vous n'avez pas le droit de révoquer un lien de collecte.";
  }

  const errors = error.error?.errors as Record<string, string[]> | undefined;
  const first = errors ? Object.values(errors)[0]?.[0] : null;

  return first ?? "Le lien n'a pas pu être révoqué.";
}
