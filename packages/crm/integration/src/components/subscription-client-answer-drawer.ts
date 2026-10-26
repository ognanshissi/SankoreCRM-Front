import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, required, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import {
  InsuranceSubscriptionDto,
  IntegrationApiService,
  RecordClientAnswerRequestAnswerEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { formatAmount } from '../data-access/integration-referential';
import { afterSaleErrorMessage, CLIENT_ANSWER_LABELS } from './insurance-after-sale-labels';

export interface SubscriptionClientAnswerDrawerData {
  subscription: InsuranceSubscriptionDto;
  productLabel: string;
}

const ANSWERS = RecordClientAnswerRequestAnswerEnum;

class ClientAnswerFormModel {
  public answer!: string;
  public reference!: string;

  public static instantiate(): ClientAnswerFormModel {
    const m = new ClientAnswerFormModel();
    m.answer = '';
    m.reference = '';
    return m;
  }
}

/**
 * Réponse du client à une surprime ou à des exclusions posées par l'assureur. Un refus met fin à
 * la souscription et au contrat, comme un refus de l'assureur.
 */
@Component({
  selector: 'subscription-client-answer-drawer',
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
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">Réponse du client</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p class="text-sm font-medium text-slate-800">{{ data.productLabel }}</p>
            <p class="mt-1 text-xs text-slate-500">Conditions posées par l'assureur :</p>
            @if (data.subscription.surchargeAmount) {
              <p class="mt-1 text-sm text-slate-800">
                Surprime de <span class="tabular-nums">{{ surchargeLabel }}</span>
              </p>
            }
            @if (data.subscription.underwritingExclusions) {
              <p class="mt-1 text-sm text-slate-800">Exclusions : {{ data.subscription.underwritingExclusions }}</p>
            }
          </div>

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>Le client <span class="text-functional-error">*</span></tas-label>
              <tas-select
                [options]="answerOptions"
                optionLabel="label"
                optionValue="value"
                placeholder="Choisissez la réponse du client"
                [formField]="formSchema.answer"
              ></tas-select>
              @if (formSchema.answer().touched() && formSchema.answer().invalid()) {
                <tas-error>{{ formSchema.answer().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            @if (answer() === ANSWERS.Declined) {
              <tas-alert type="error">
                <p class="text-sm font-medium">Un refus du client met fin à la souscription</p>
                <p class="mt-1 text-xs">
                  Le contrat est clos sans couverture. Une prime déjà encaissée devient due au client.
                </p>
              </tas-alert>
            }

            <tas-form-field>
              <tas-label>Référence <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="text"
                placeholder="Avenant signé, lettre du client…"
                [formField]="formSchema.reference"
              />
              @if (formSchema.reference().touched() && formSchema.reference().invalid()) {
                <tas-error>{{ formSchema.reference().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          [color]="answer() === ANSWERS.Declined ? 'warn' : 'primary'"
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
export class SubscriptionClientAnswerDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<SubscriptionClientAnswerDrawerData>(DIALOG_DATA);

  public readonly ANSWERS = ANSWERS;
  public readonly answerOptions = [
    { value: ANSWERS.Accepted, label: CLIENT_ANSWER_LABELS[ANSWERS.Accepted] },
    { value: ANSWERS.Declined, label: CLIENT_ANSWER_LABELS[ANSWERS.Declined] },
  ];
  public readonly surchargeLabel = formatAmount(
    this.data.subscription.surchargeAmount,
    this.data.subscription.currency,
  );

  public readonly model = signal(ClientAnswerFormModel.instantiate());

  public readonly formSchema = form(this.model, (schema) => {
    required(schema.answer, { message: 'Choisissez la réponse du client' });
    required(schema.reference, { message: 'La référence est obligatoire' });
  });

  public readonly answer = computed(() => this.formSchema.answer().value());

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const answer = value.answer as RecordClientAnswerRequestAnswerEnum;
      try {
        await firstValueFrom(
          this._api.recordInsuranceClientAnswer(this.data.subscription.id!, {
            answer,
            reference: value.reference.trim(),
          }),
        );
      } catch (error) {
        this._snackbar.error(
          'Réponse non enregistrée',
          afterSaleErrorMessage(error as HttpErrorResponse, "La réponse du client n'a pas pu être enregistrée."),
        );
        return;
      }

      this._snackbar.success(
        'Réponse enregistrée',
        answer === ANSWERS.Declined
          ? 'La souscription et le contrat sont clos.'
          : "L'acceptation du client est au dossier.",
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
