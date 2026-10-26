import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import {
  InsuranceSubscriptionDto,
  IntegrationApiService,
  RecordUnderwritingRequestOutcomeEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { formatAmount } from '../data-access/integration-referential';
import {
  afterSaleErrorMessage,
  parseAmount,
  todayIso,
  UNDERWRITING_OUTCOME_OPTIONS,
} from './insurance-after-sale-labels';

export interface SubscriptionUnderwritingDrawerData {
  subscription: InsuranceSubscriptionDto;
  productLabel: string;
}

const OUTCOMES = RecordUnderwritingRequestOutcomeEnum;

class UnderwritingFormModel {
  public outcome!: string;
  public reference!: string;
  public receivedOn!: string;
  public surchargeAmount!: string;
  public exclusions!: string;
  public medicalExams!: string;

  public static instantiate(): UnderwritingFormModel {
    const m = new UnderwritingFormModel();
    m.outcome = '';
    m.reference = '';
    m.receivedOn = todayIso();
    m.surchargeAmount = '';
    m.exclusions = '';
    m.medicalExams = '';
    return m;
  }
}

/**
 * Réponse de l'assureur à une souscription, lue sur sa lettre ou son portail.
 *
 * Chaque issue a ses champs : le serveur refuse une surprime sans montant, des exclusions sans
 * leur libellé, des examens sans leur liste. Les validations les exigent ici pour que le refus
 * arrive avant l'envoi plutôt qu'en anglais après.
 */
@Component({
  selector: 'subscription-underwriting-drawer',
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
    TasHint,
    TasInput,
    TasSelect,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Réponse de l'assureur</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div>
            <p class="text-sm font-medium text-slate-800">{{ data.productLabel }}</p>
            <p class="mt-0.5 text-xs text-slate-500">
              Prime {{ premiumLabel }}. Saisissez la réponse telle qu'elle figure sur la lettre, l'e-mail
              ou le portail de l'assureur.
            </p>
          </div>

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>Réponse <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="outcomeOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Choisissez la réponse de l'assureur"
                [formField]="formSchema.outcome"
              ></tas-select>
              @if (formSchema.outcome().touched() && formSchema.outcome().invalid()) {
                <tas-error>{{ formSchema.outcome().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            @switch (outcome()) {
              @case (OUTCOMES.AcceptedWithSurcharge) {
                <tas-form-field>
                  <tas-label>Montant de la surprime <span class="text-functional-error">*</span></tas-label>
                  <input tasInput type="text" inputmode="decimal" [formField]="formSchema.surchargeAmount" />
                  <tas-hint>Le client devra accepter cette surprime avant l'émission de la police.</tas-hint>
                  @if (formSchema.surchargeAmount().touched() && formSchema.surchargeAmount().invalid()) {
                    <tas-error>{{ formSchema.surchargeAmount().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              }
              @case (OUTCOMES.AcceptedWithExclusions) {
                <tas-form-field>
                  <tas-label>Exclusions <span class="text-functional-error">*</span></tas-label>
                  <textarea tasInput rows="3" [formField]="formSchema.exclusions"></textarea>
                  <tas-hint>Recopiez le libellé de l'assureur : le client devra les accepter.</tas-hint>
                  @if (formSchema.exclusions().touched() && formSchema.exclusions().invalid()) {
                    <tas-error>{{ formSchema.exclusions().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              }
              @case (OUTCOMES.MedicalExamsRequired) {
                <tas-form-field>
                  <tas-label>Examens demandés <span class="text-functional-error">*</span></tas-label>
                  <textarea tasInput rows="3" [formField]="formSchema.medicalExams"></textarea>
                  <tas-hint>L'assureur rendra sa décision après les examens.</tas-hint>
                  @if (formSchema.medicalExams().touched() && formSchema.medicalExams().invalid()) {
                    <tas-error>{{ formSchema.medicalExams().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              }
              @case (OUTCOMES.Refused) {
                <tas-alert type="error">
                  <p class="text-sm font-medium">Un refus met fin à la souscription</p>
                  <p class="mt-1 text-xs">
                    Le contrat est clos. Une prime déjà encaissée devient due au client : elle
                    apparaîtra « à rembourser » sur la souscription.
                  </p>
                </tas-alert>
              }
            }

            <tas-form-field>
              <tas-label>Référence de la réponse <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="text"
                placeholder="N° de lettre, objet de l'e-mail, référence du portail"
                [formField]="formSchema.reference"
              />
              @if (formSchema.reference().touched() && formSchema.reference().invalid()) {
                <tas-error>{{ formSchema.reference().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <div>
              <tas-date-picker mode="date" [max]="today" [formField]="formSchema.receivedOn">
                Reçue le <span class="text-functional-error">*</span>
              </tas-date-picker>
              @if (formSchema.receivedOn().touched() && formSchema.receivedOn().invalid()) {
                <tas-error>{{ formSchema.receivedOn().errors()[0].message }}</tas-error>
              }
            </div>
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          [color]="outcome() === OUTCOMES.Refused ? 'warn' : 'primary'"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          Enregistrer la réponse
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class SubscriptionUnderwritingDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<SubscriptionUnderwritingDrawerData>(DIALOG_DATA);

  public readonly OUTCOMES = OUTCOMES;
  public readonly outcomeOptions = UNDERWRITING_OUTCOME_OPTIONS;
  public readonly today = todayIso();
  public readonly premiumLabel = formatAmount(
    this.data.subscription.premiumAmount,
    this.data.subscription.currency,
  );

  public readonly model = signal(UnderwritingFormModel.instantiate());

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.outcome, { message: 'Choisissez la réponse de l’assureur' });
    required(schema.reference, { message: 'La référence de la réponse est obligatoire' });
    required(schema.receivedOn, { message: 'La date de réception est obligatoire' });
    validate(schema.receivedOn, ({ value }) =>
      value() && value() > todayIso()
        ? { kind: 'future', message: 'La date ne peut pas être dans le futur' }
        : null,
    );
    validate(schema.surchargeAmount, (ctx) => {
      if (ctx.valueOf(schema.outcome) !== OUTCOMES.AcceptedWithSurcharge) return null;
      const amount = parseAmount(ctx.value());
      return amount !== null && amount > 0
        ? null
        : { kind: 'amount', message: 'Indiquez un montant de surprime positif' };
    });
    required(schema.exclusions, {
      message: 'Le libellé des exclusions est obligatoire',
      when: (ctx) => ctx.valueOf(schema.outcome) === OUTCOMES.AcceptedWithExclusions,
    });
    required(schema.medicalExams, {
      message: 'Indiquez les examens demandés',
      when: (ctx) => ctx.valueOf(schema.outcome) === OUTCOMES.MedicalExamsRequired,
    });
  });

  public readonly outcome = computed(() => this.formSchema.outcome().value());

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const outcome = value.outcome as RecordUnderwritingRequestOutcomeEnum;
      try {
        await firstValueFrom(
          this._api.recordInsuranceUnderwriting(this.data.subscription.id!, {
            outcome,
            reference: value.reference.trim(),
            receivedOn: value.receivedOn,
            // Seuls les champs de l'issue choisie partent : un reste de saisie d'une autre issue
            // serait enregistré tel quel par le serveur.
            surchargeAmount: outcome === OUTCOMES.AcceptedWithSurcharge ? parseAmount(value.surchargeAmount) : null,
            exclusions: outcome === OUTCOMES.AcceptedWithExclusions ? value.exclusions.trim() : null,
            medicalExams: outcome === OUTCOMES.MedicalExamsRequired ? value.medicalExams.trim() : null,
          }),
        );
      } catch (error) {
        this._snackbar.error(
          'Réponse non enregistrée',
          afterSaleErrorMessage(error as HttpErrorResponse, "La réponse de l'assureur n'a pas pu être enregistrée."),
        );
        return;
      }

      this._snackbar.success(
        'Réponse enregistrée',
        outcome === OUTCOMES.Refused
          ? 'La souscription et le contrat sont clos.'
          : outcome === OUTCOMES.AcceptedWithSurcharge || outcome === OUTCOMES.AcceptedWithExclusions
            ? 'Recueillez maintenant la réponse du client.'
            : "La réponse de l'assureur est au dossier.",
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
