import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasTitle } from '@talisoft/ui/title';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { IssueKycRemoteInvitationRequestChannelEnum } from '@sankore/crm-api';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { kycRemoteUnavailableLabel } from '../data-access/kyc-referential';

export interface SendKycRemoteInvitationDrawerData {
  kycFileId: string;
  /** Un lien est-il déjà en circulation : ce qui décide du titre et de l'avertissement. */
  hasActiveLink: boolean;
  canSendByEmail: boolean;
  canSendBySms: boolean;
  /** Pourquoi un canal est fermé, déjà traduit par le serveur en code. */
  emailUnavailableReason: string | null;
  smsUnavailableReason: string | null;
  /** Où cela part, masqué. Null quand le canal est fermé. */
  recipientEmailMasked: string | null;
  recipientPhoneMasked: string | null;
  linkValidityHours: number | null;
}

class SendInvitationFormModel {
  public channel!: string;

  public static startingOn(channel: string): SendInvitationFormModel {
    const model = new SendInvitationFormModel();
    model.channel = channel;
    return model;
  }
}

/**
 * Envoi (ou renvoi) du lien de collecte, avec le choix du canal
 * (`POST /kyc-files/{id}/remote-invitations`).
 *
 * **Un drawer et non une boîte de confirmation**, parce qu'il y a maintenant quelque chose à
 * choisir : `ConfirmDialogService.confirm()` ne prend qu'un message, et un canal ne se choisit pas
 * dans une chaîne de caractères. Tout ce que la boîte disait est conservé — la destination masquée,
 * la durée de validité, et surtout la phrase sur le lien précédent.
 *
 * **Le lien précédent cesse de fonctionner, et c'est annoncé avant le clic.** Le serveur révoque
 * le lien en cours à chaque émission — au plus un lien vivant par dossier, garanti par un index
 * unique partiel en base. Un agent qui ne le sait pas croit dépanner un client alors qu'il vient
 * de couper le lien que celui-ci était peut-être en train d'ouvrir.
 *
 * **Un canal fermé reste affiché, désactivé, avec sa raison.** Le masquer ferait croire que
 * l'option n'existe pas, là où « ce client n'a pas de numéro » est une chose qu'un agent corrige
 * en une minute sur la fiche.
 */
@Component({
  selector: 'send-kyc-remote-invitation-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    FormRoot,
    Button,
    TasFormField,
    TasHint,
    TasLabel,
    TasIcon,
    TasSelect,
    TasTitle,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">
          {{ data.hasActiveLink ? 'Renvoyer le lien' : 'Envoyer le lien' }}
        </TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Canal d'envoi</tas-label>
            <tas-select
              [options]="channelOptions()"
              optionLabel="label"
              optionValue="value"
              [formField]="formSchema.channel"
            ></tas-select>
            <tas-hint>{{ recipientHint() }}</tas-hint>
          </tas-form-field>

          @if (closedChannelReason(); as closed) {
            <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
              <tas-icon
                iconName="feather:info"
                class="text-slate-500 mt-0.5"
                style="font-size: 16px"
              ></tas-icon>
              <p class="text-xs text-slate-600">{{ closed }}</p>
            </div>
          }

          @if (data.hasActiveLink) {
            <!--
              L'avertissement est la raison d'être de cet écran autant que le choix du canal :
              le lien en circulation meurt à la seconde où celui-ci part.
            -->
            <div class="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
              <tas-icon
                iconName="feather:alert-triangle"
                class="text-amber-500 mt-0.5"
                style="font-size: 16px"
              ></tas-icon>
              <div class="text-xs">
                <p class="font-medium text-amber-900">Le lien précédent cessera de fonctionner</p>
                <p class="text-amber-800 mt-0.5">
                  Un seul lien est valable à la fois. Si le client est en train d'utiliser le
                  précédent, il devra recommencer avec le nouveau.
                </p>
              </div>
            </div>
          }

          <p class="text-xs text-slate-500">
            Un lien à usage unique
            {{ data.linkValidityHours ? ', valable ' + data.linkValidityHours + ' heures' : '' }}.
            Il n'est affiché nulle part : ni vous ni le support ne pourrez le relire.
          </p>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">
          Annuler
        </button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().submitting() || channelOptions().length === 0"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          <tas-icon iconName="feather:send" style="font-size: 14px"></tas-icon>
          Envoyer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SendKycRemoteInvitationDrawer {
  private readonly _facade = inject(KycFacadeService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);

  public readonly data = inject<SendKycRemoteInvitationDrawerData>(DIALOG_DATA);

  /**
   * Les canaux réellement ouverts. Le défaut est l'email quand il l'est — c'est le canal qui ne
   * coûte rien, et basculer un établissement sur le SMS par défaut lui ferait payer des envois
   * que personne n'a demandés.
   */
  public readonly channelOptions = computed(() => {
    const options: { label: string; value: string }[] = [];

    if (this.data.canSendByEmail) options.push({ label: 'Email', value: 'Email' });
    if (this.data.canSendBySms) options.push({ label: 'SMS', value: 'Sms' });

    return options;
  });

  public model = signal(
    SendInvitationFormModel.startingOn(this.data.canSendByEmail ? 'Email' : 'Sms'),
  );

  public formSchema = form(this.model);

  /** Où cela part, pour le canal choisi. */
  public readonly recipientHint = computed(() => {
    const recipient =
      this.model().channel === 'Sms'
        ? this.data.recipientPhoneMasked
        : this.data.recipientEmailMasked;

    return recipient
      ? `Destinataire : ${recipient}`
      : 'La destination enregistrée sur la fiche du client.';
  });

  /** La raison du canal qui n'est PAS disponible, quand il y en a un. */
  public readonly closedChannelReason = computed(() => {
    if (!this.data.canSendBySms && this.data.smsUnavailableReason) {
      return kycRemoteUnavailableLabel(this.data.smsUnavailableReason);
    }

    if (!this.data.canSendByEmail && this.data.emailUnavailableReason) {
      return kycRemoteUnavailableLabel(this.data.emailUnavailableReason);
    }

    return null;
  });

  public close(): void {
    this._dialogRef.close(false);
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const channel = field()?.value().channel as IssueKycRemoteInvitationRequestChannelEnum;

      const sent = await firstValueFrom(
        this._facade.issueRemoteInvitation(this.data.kycFileId, channel).pipe(
          map(() => true),
          catchError((error: HttpErrorResponse) => {
            // Le code du serveur plutôt qu'un message générique : il nomme le canal fermé, et
            // c'est exactement ce que l'agent doit corriger.
            this._snackbar.error(
              'Envoi impossible',
              kycRemoteUnavailableLabel(error.error?.error)
                || "Le lien n'a pas pu être envoyé.",
            );
            return EMPTY;
          }),
        ),
      );

      if (!sent) return;

      this._snackbar.success(
        'Lien envoyé',
        channel === 'Sms'
          ? 'Le client recevra le SMS dans les prochaines minutes.'
          : "Le client recevra l'email dans les prochaines minutes.",
      );

      this._dialogRef.close(true);
    });
  }
}

export default SendKycRemoteInvitationDrawer;
