import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { TelephonyApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
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
import { UserLinkRow } from './user-link-presentation';

export interface UnlinkUserDrawerData {
  row: UserLinkRow;
}

class UnlinkUserFormModel {
  public reason!: string;

  public static instantiate(): UnlinkUserFormModel {
    const model = new UnlinkUserFormModel();
    model.reason = '';
    return model;
  }
}

/**
 * Détachement d'un poste (`POST user-links/{linkId}/unlink`).
 *
 * Un drawer avec un champ, et pas une boîte de confirmation : le MOTIF est obligatoire
 * côté serveur (422 TELEPHONY_UNLINK_REASON_REQUIRED) et il est consigné au journal
 * d'audit. « Un agent qui part », « un compte recyclé » et « un appariement erroné » sont
 * trois faits différents, et c'est cette phrase que relira quelqu'un dans deux ans pour
 * comprendre pourquoi les appels d'un poste ont cessé d'être attribués.
 */
@Component({
  selector: 'lib-unlink-user-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    TasIcon,
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
        <tas-title>Détacher le poste</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p class="text-sm font-medium text-slate-800">{{ row.crmUserName }}</p>
            <p class="mt-0.5 text-xs text-slate-500">
              Compte {{ row.externalDisplayName }} · {{ row.externalEmail }}
            </p>
          </div>

          <div class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <tas-icon
              iconName="feather:alert-triangle"
              class="mt-0.5 shrink-0 text-amber-600"
              style="font-size:14px"
            ></tas-icon>
            <p class="text-xs text-amber-800">
              Le rattachement est désactivé, jamais supprimé : les appels déjà au journal
              continuent de pointer dessus, et c'est lui qui explique pourquoi plus rien n'est
              attribué à cet utilisateur. Son bouton « Appeler » disparaîtra. Rattacher le même
              couple plus tard réactive cette ligne.
            </p>
          </div>

          <tas-form-field>
            <tas-label>Motif <span class="text-functional-error">*</span></tas-label>
            <input
              tasInput
              type="text"
              placeholder="ex: départ de l'agent le 12/03"
              [formField]="formSchema.reason"
            />
            @if (formSchema.reason().touched() && formSchema.reason().invalid()) {
              <tas-error>{{ formSchema.reason().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Conservé au journal d'audit, à votre nom. Soyez explicite.</tas-hint>
            }
          </tas-form-field>

          @if (submitError()) {
            <p class="text-sm text-functional-error">{{ submitError() }}</p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="warn"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Détacher
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class UnlinkUserDrawer {
  private readonly _data: UnlinkUserDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly row = this._data.row;
  public readonly submitError = signal<string | null>(null);

  public model = signal(UnlinkUserFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    validate(schema.reason, (ctx) => {
      const reason = (ctx.value() ?? '').trim();
      if (!reason) {
        return {
          kind: 'required',
          message: 'Le motif est obligatoire : il est conservé au journal',
        };
      }
      return reason.length >= 3
        ? null
        : { kind: 'minLength', message: 'Trois caractères au moins : ce motif sera relu' };
    });
  });

  public handleSubmit(): void {
    const linkId = this.row.linkId;
    if (!linkId) return;

    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      // 204 : rien dans le corps, donc un drapeau plutôt qu'un test sur la valeur reçue.
      let unlinked = false;
      await firstValueFrom(
        this._api
          .unlinkTelephonyUser(linkId, { reason: value.reason.trim() })
          .pipe(
            tap(() => {
              unlinked = true;
            }),
            catchError((error: HttpErrorResponse) => {
              const message = telephonyErrorMessage(
                error,
                "Le détachement n'a pas pu être enregistré.",
              );
              this.submitError.set(message);
              this._snackbar.error('Détachement refusé', message);
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!unlinked) return;

      this._snackbar.success(
        'Poste détaché',
        'Plus aucun appel ne sera attribué à cet utilisateur. Le motif est au journal.',
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
