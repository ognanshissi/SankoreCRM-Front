import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { WhatsAppApiService, WhatsAppChannelDto } from '@sankore/crm-api';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { E164_PATTERN, whatsAppErrorMessage } from './whatsapp-referential';

export interface WhatsAppSimulateInboundDrawerData {
  channel: WhatsAppChannelDto;
}

class SimulateInboundFormModel {
  public fromE164!: string;
  public profileName!: string;
  public text!: string;

  public static instantiate(): SimulateInboundFormModel {
    const m = new SimulateInboundFormModel();
    m.fromE164 = '';
    m.profileName = '';
    m.text = '';
    return m;
  }
}

/**
 * Un client fictif écrit au numéro simulé. Le serveur fait passer le message par le VRAI
 * chemin du webhook (jeton, stockage, traitement, rattachement au lead) : c'est un test de
 * bout en bout, pas un raccourci. L'endpoint n'existe qu'en développement (404 ailleurs).
 */
@Component({
  selector: 'whatsapp-simulate-inbound-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasError,
    TasInput,
    FormRoot,
    FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <p class="text-base font-semibold text-slate-800">Simuler un message entrant</p>
        <p class="text-xs text-slate-400 mt-0.5">
          Vers {{ data.channel.displayPhoneNumber || data.channel.name }} — développement uniquement.
        </p>
      </tas-drawer-title>

      <tas-drawer-content>
        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Numéro de l’expéditeur <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="+2250700000000" [formField]="formSchema.fromE164" />
            <tas-hint>Au format E.164. Utilisez le numéro d’un lead existant pour voir le message s’y rattacher.</tas-hint>
            @if (formSchema.fromE164().touched() && formSchema.fromE164().invalid()) {
              <tas-error>{{ formSchema.fromE164().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Nom du profil WhatsApp</tas-label>
            <input tasInput type="text" placeholder="Ex : Awa Koné" [formField]="formSchema.profileName" />
          </tas-form-field>

          <tas-form-field>
            <tas-label>Texte <span class="text-functional-error">*</span></tas-label>
            <textarea tasInput rows="4" [formField]="formSchema.text"></textarea>
            @if (formSchema.text().touched() && formSchema.text().invalid()) {
              <tas-error>{{ formSchema.text().errors()[0].message }}</tas-error>
            }
          </tas-form-field>

          @if (unavailable()) {
            <p class="text-sm text-functional-error">
              La simulation n’est pas disponible sur cet environnement : le serveur ne l’expose qu’en développement.
            </p>
          }
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Fermer</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          (click)="handleSubmit()"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
        >
          Envoyer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class WhatsAppSimulateInboundDrawer {
  public readonly data: WhatsAppSimulateInboundDrawerData = inject(DIALOG_DATA);

  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(WhatsAppApiService);
  private readonly _snackbar = inject(SnackbarService);

  public unavailable = signal(false);

  public model = signal(SimulateInboundFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    validate(schema.fromE164, (ctx) => {
      const value = (ctx.value() ?? '').trim();
      if (!value) return { kind: 'required', message: 'Le numéro de l’expéditeur est obligatoire' };
      return E164_PATTERN.test(value)
        ? null
        : { kind: 'pattern', message: 'Format attendu : +XXXXXXXX (E.164, sans espace)' };
    });
    required(schema.text, { message: 'Le texte est obligatoire' });
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      let sent = false;
      await firstValueFrom(
        this._api
          .simulateWhatsAppInbound(this.data.channel.id!, {
            fromE164: value.fromE164.trim(),
            profileName: value.profileName.trim() || null,
            text: value.text,
          })
          .pipe(
            tap(() => {
              sent = true;
            }),
            catchError((err: unknown) => {
              if (err instanceof HttpErrorResponse && err.status === 404) {
                this.unavailable.set(true);
                return EMPTY;
              }
              this._snackbar.error(
                'Simulation refusée',
                whatsAppErrorMessage(err, 'Le message n’a pas pu être simulé.'),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!sent) return;

      this._snackbar.success(
        'Message simulé',
        'Le message suit le chemin du webhook ; il apparaît sur le lead dans quelques secondes.',
      );
      // Le formulaire garde le numéro : on enchaîne souvent plusieurs messages du même client.
      this.model.update((m) => ({ ...m, text: '' }));
    });
  }

  public close(): void {
    this._dialogRef.close(true);
  }
}
