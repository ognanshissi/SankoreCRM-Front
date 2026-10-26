import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import {
  InsuranceSubscriptionDto,
  IntegrationApiService,
  RecordPremiumPaymentRequestPaymentMethodEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { formatAmount, formatContractDate } from '../data-access/integration-referential';
import { afterSaleErrorMessage, PAYMENT_METHOD_OPTIONS, todayIso } from './insurance-after-sale-labels';

export interface SubscriptionPremiumPaymentDrawerData {
  subscription: InsuranceSubscriptionDto;
  productLabel: string;
}

class PremiumPaymentFormModel {
  public paymentMethod!: string;
  public paymentReference!: string;
  public paidOn!: string;

  public static instantiate(): PremiumPaymentFormModel {
    const m = new PremiumPaymentFormModel();
    m.paymentMethod = '';
    m.paymentReference = '';
    m.paidOn = todayIso();
    return m;
  }
}

/**
 * Encaissement d'une prime restée due après l'envoi à l'assureur (paiement sous 60 jours, ou
 * surprime acceptée par le client). N'est possible que sous mandat d'encaissement de l'assureur.
 */
@Component({
  selector: 'subscription-premium-payment-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasAlert,
    Button,
    TasDatePicker,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Enregistrer l'encaissement</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-800">{{ data.productLabel }}</p>
            @if (data.subscription.premiumOutstanding) {
              <p class="mt-1 text-sm text-slate-800">
                Prime due : <span class="tabular-nums">{{ premiumLabel }}</span>
              </p>
            }
            @if (data.subscription.surchargeOutstanding) {
              <p class="mt-1 text-sm text-slate-800">
                Surprime due : <span class="tabular-nums">{{ surchargeLabel }}</span>
              </p>
            }
            @if (data.subscription.paymentDueBy) {
              <p class="mt-1 text-xs text-slate-500">À payer avant le {{ dueByLabel }}</p>
            }
          </div>

          <tas-alert type="info">
            <p class="text-xs">
              Si l'assureur n'a pas confié de mandat d'encaissement à l'institution, c'est lui qui
              encaisse : l'enregistrement sera refusé et le client le règle directement.
            </p>
          </tas-alert>

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>Mode de paiement <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="methodOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Choisissez le mode de paiement"
                [formField]="formSchema.paymentMethod"
              ></tas-select>
              @if (formSchema.paymentMethod().touched() && formSchema.paymentMethod().invalid()) {
                <tas-error>{{ formSchema.paymentMethod().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Référence du paiement <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="text"
                placeholder="N° de reçu, de transaction, de chèque…"
                [formField]="formSchema.paymentReference"
              />
              @if (formSchema.paymentReference().touched() && formSchema.paymentReference().invalid()) {
                <tas-error>{{ formSchema.paymentReference().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <div>
              <tas-date-picker mode="date" [max]="today" [formField]="formSchema.paidOn">
                Encaissée le <span class="text-functional-error">*</span>
              </tas-date-picker>
              @if (formSchema.paidOn().touched() && formSchema.paidOn().invalid()) {
                <tas-error>{{ formSchema.paidOn().errors()[0].message }}</tas-error>
              }
            </div>
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          Enregistrer l'encaissement
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SubscriptionPremiumPaymentDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<SubscriptionPremiumPaymentDrawerData>(DIALOG_DATA);

  public readonly methodOptions = PAYMENT_METHOD_OPTIONS;
  public readonly today = todayIso();
  public readonly premiumLabel = formatAmount(this.data.subscription.premiumAmount, this.data.subscription.currency);
  public readonly surchargeLabel = formatAmount(this.data.subscription.surchargeAmount, this.data.subscription.currency);
  public readonly dueByLabel = formatContractDate(this.data.subscription.paymentDueBy);

  public readonly model = signal(PremiumPaymentFormModel.instantiate());

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.paymentMethod, { message: 'Le mode de paiement est obligatoire' });
    required(schema.paymentReference, { message: 'La référence du paiement est obligatoire' });
    required(schema.paidOn, { message: "La date d'encaissement est obligatoire" });
    validate(schema.paidOn, ({ value }) =>
      value() && value() > todayIso()
        ? { kind: 'future', message: 'La date ne peut pas être dans le futur' }
        : null,
    );
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      try {
        await firstValueFrom(
          this._api.recordInsurancePremiumPayment(this.data.subscription.id!, {
            paymentMethod: value.paymentMethod as RecordPremiumPaymentRequestPaymentMethodEnum,
            paymentReference: value.paymentReference.trim(),
            paidOn: value.paidOn,
          }),
        );
      } catch (error) {
        this._snackbar.error(
          'Encaissement non enregistré',
          afterSaleErrorMessage(error as HttpErrorResponse, "L'encaissement n'a pas pu être enregistré."),
        );
        return;
      }

      this._snackbar.success('Encaissement enregistré', 'La prime est au dossier ; le contrat devient actif à l’émission de la police.');
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
