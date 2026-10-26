import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasTitle } from '@talisoft/ui/title';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasAlert } from '@talisoft/ui/alert';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ClientsApiService, RegisterPaymentInstrumentRequestKindEnum } from '@sankore/crm-api';

export interface AddPaymentInstrumentDrawerData {
  clientId: string;
  /** Pré-remplit le titulaire : le plus souvent, c'est le client lui-même. */
  holderName?: string | null;
}

export const PAYMENT_INSTRUMENT_KIND_OPTIONS = [
  { label: 'Mobile Money', value: RegisterPaymentInstrumentRequestKindEnum.MobileMoney },
  { label: 'Compte bancaire (RIB)', value: RegisterPaymentInstrumentRequestKindEnum.BankAccount },
];

export function paymentInstrumentKindLabel(kind: string | null | undefined): string {
  return PAYMENT_INSTRUMENT_KIND_OPTIONS.find((o) => o.value === kind)?.label ?? kind ?? '—';
}

/** Valeur sentinelle du select : l'opérateur n'est pas dans la liste, on le saisit. */
const OTHER_PROVIDER = '__other__';

const MOBILE_MONEY_PROVIDER_OPTIONS = [
  { label: 'Orange Money', value: 'Orange Money' },
  { label: 'MTN MoMo', value: 'MTN MoMo' },
  { label: 'Moov Money', value: 'Moov Money' },
  { label: 'Wave', value: 'Wave' },
  { label: 'Autre opérateur', value: OTHER_PROVIDER },
];

/** Même règle que le serveur : au moins 6 lettres ou chiffres, séparateurs ignorés. */
function alphanumericCount(raw: string | null | undefined): number {
  return (raw ?? '').replace(/[^A-Za-z0-9]/g, '').length;
}

class AddPaymentInstrumentFormModel {
  public kind!: RegisterPaymentInstrumentRequestKindEnum;
  public providerChoice!: string;
  public providerName!: string;
  public identifier!: string;
  public holderName!: string;

  public static instantiate(holderName: string | null | undefined): AddPaymentInstrumentFormModel {
    const model = new AddPaymentInstrumentFormModel();
    model.kind = RegisterPaymentInstrumentRequestKindEnum.MobileMoney;
    model.providerChoice = '';
    model.providerName = '';
    model.identifier = '';
    model.holderName = holderName ?? '';
    return model;
  }
}

@Component({
  selector: 'add-payment-instrument-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle,
    Button, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasAlert,
    FormRoot, FormField,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Ajouter un moyen de paiement</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <tas-alert type="info" class="mb-5 block">
          Sert à encaisser une prime et à verser un remboursement. Le numéro est enregistré chiffré :
          seuls ses derniers chiffres seront affichés.
        </tas-alert>

        <form [formRoot]="formSchema" class="flex flex-col gap-5">
          <tas-form-field>
            <tas-label>Type <span class="text-functional-error">*</span></tas-label>
            <tas-select [options]="kindOptions" [formField]="formSchema.kind"></tas-select>
          </tas-form-field>

          @if (isMobileMoney()) {
            <tas-form-field>
              <tas-label>Opérateur <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="mobileMoneyProviders" placeholder="Choisissez un opérateur"
                          [formField]="formSchema.providerChoice"></tas-select>
              @if (formSchema.providerChoice().touched() && formSchema.providerChoice().invalid()) {
                <tas-error>{{ formSchema.providerChoice().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }

          @if (needsProviderName()) {
            <tas-form-field>
              <tas-label>{{ isMobileMoney() ? 'Nom de l’opérateur' : 'Banque' }} <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" [placeholder]="isMobileMoney() ? 'Ex. : Free Money' : 'Ex. : Société Générale CI'"
                     [formField]="formSchema.providerName" />
              @if (formSchema.providerName().touched() && formSchema.providerName().invalid()) {
                <tas-error>{{ formSchema.providerName().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }

          <tas-form-field>
            <tas-label>{{ isMobileMoney() ? 'Numéro Mobile Money' : 'RIB ou numéro de compte' }} <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" autocomplete="off"
                   [placeholder]="isMobileMoney() ? 'Ex. : 07 12 34 56 78' : 'Ex. : CI008 01234 012345678901 23'"
                   [formField]="formSchema.identifier" />
            @if (formSchema.identifier().touched() && formSchema.identifier().invalid()) {
              <tas-error>{{ formSchema.identifier().errors()[0].message }}</tas-error>
            } @else {
              <tas-hint>Espaces et tirets acceptés.</tas-hint>
            }
          </tas-form-field>

          <tas-form-field>
            <tas-label>Titulaire <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" placeholder="Nom du titulaire du compte" [formField]="formSchema.holderName" />
            @if (formSchema.holderName().touched() && formSchema.holderName().invalid()) {
              <tas-error>{{ formSchema.holderName().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </form>
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex items-center justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close()">Annuler</button>
          <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                  [disabled]="formSchema().invalid() || formSchema().submitting()"
                  [isLoading]="formSchema().submitting()">
            Ajouter
          </button>
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class AddPaymentInstrumentDrawer {
  public readonly data: AddPaymentInstrumentDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<string>);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly kindOptions = PAYMENT_INSTRUMENT_KIND_OPTIONS;
  public readonly mobileMoneyProviders = MOBILE_MONEY_PROVIDER_OPTIONS;

  public model = signal(AddPaymentInstrumentFormModel.instantiate(this.data.holderName));

  public formSchema = form(this.model, (schema) => {
    required(schema.kind, { message: 'Le type est obligatoire' });

    validate(schema.providerChoice, (ctx) =>
      ctx.valueOf(schema.kind) === RegisterPaymentInstrumentRequestKindEnum.MobileMoney && !ctx.value()
        ? { kind: 'required', message: 'Choisissez l’opérateur' }
        : null,
    );

    validate(schema.providerName, (ctx) => {
      const isMobileMoney = ctx.valueOf(schema.kind) === RegisterPaymentInstrumentRequestKindEnum.MobileMoney;
      if (isMobileMoney && ctx.valueOf(schema.providerChoice) !== OTHER_PROVIDER) return null;
      return ctx.value().trim()
        ? null
        : { kind: 'required', message: isMobileMoney ? 'Le nom de l’opérateur est obligatoire' : 'La banque est obligatoire' };
    });
    maxLength(schema.providerName, 100, { message: '100 caractères au plus' });

    validate(schema.identifier, (ctx) =>
      alphanumericCount(ctx.value()) >= 6
        ? null
        : { kind: 'minLength', message: 'Au moins 6 chiffres ou lettres' },
    );
    maxLength(schema.identifier, 64, { message: '64 caractères au plus' });

    required(schema.holderName, { message: 'Le titulaire est obligatoire' });
    maxLength(schema.holderName, 200, { message: '200 caractères au plus' });
  });

  public readonly isMobileMoney = computed(
    () => this.formSchema.kind().value() === RegisterPaymentInstrumentRequestKindEnum.MobileMoney,
  );

  /** Une banque se saisit toujours ; un opérateur, seulement s'il n'est pas dans la liste. */
  public readonly needsProviderName = computed(
    () => !this.isMobileMoney() || this.formSchema.providerChoice().value() === OTHER_PROVIDER,
  );

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const provider = this.needsProviderName() ? value.providerName.trim() : value.providerChoice;

      const id = await firstValueFrom(
        this._clientsApi
          .registerClientPaymentInstrument(this.data.clientId, {
            kind: value.kind,
            provider,
            identifier: value.identifier.trim(),
            holderName: value.holderName.trim(),
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error('Erreur', this._errorMessage(error));
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );
      if (!id) return;

      this._snackbar.success('Moyen de paiement ajouté', 'Seuls ses derniers chiffres resteront visibles.');
      this._dialogRef.close(id);
    });
  }

  public close(): void {
    this._dialogRef.close();
  }

  private _errorMessage(error: HttpErrorResponse): string {
    switch (error.error?.error) {
      case 'PAYMENT_INSTRUMENT_PROVIDER_REQUIRED':
        return 'Précisez l’opérateur ou la banque.';
      case 'PAYMENT_INSTRUMENT_IDENTIFIER_INVALID':
        return 'Le numéro doit comporter au moins 6 chiffres ou lettres.';
      case 'CLIENT_NOT_FOUND':
        return 'Client introuvable, ou hors de votre périmètre.';
      default:
        return error.error?.title ?? 'Impossible d’ajouter ce moyen de paiement.';
    }
  }
}
