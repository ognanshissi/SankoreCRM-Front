import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormField, FormRoot, form, required, submit, validate } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { IntegrationApiService, MoveOperationRequestStatusEnum, PolicyOperationDto } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { formatAmount } from '../data-access/integration-referential';
import {
  afterSaleErrorMessage,
  OPERATION_KIND_LABELS,
  operationStatusMeta,
  parseAmount,
  REFUND_BLOCKED_KYC_MESSAGE,
  todayIso,
} from './insurance-after-sale-labels';

export interface PolicyOperationStatusDrawerData {
  operation: PolicyOperationDto;
  target: MoveOperationRequestStatusEnum;
}

const STATUSES = MoveOperationRequestStatusEnum;

class MoveOperationFormModel {
  public insurerReference!: string;
  public amount!: string;
  public paidOn!: string;

  public static fromOperation(operation: PolicyOperationDto, target: string): MoveOperationFormModel {
    const m = new MoveOperationFormModel();
    m.insurerReference = operation.insurerReference ?? '';
    m.amount = operation.amount !== null && operation.amount !== undefined ? String(operation.amount) : '';
    m.paidOn = target === STATUSES.Paid ? todayIso() : '';
    return m;
  }
}

/**
 * Ce que l'assureur a fait d'une demande : transmise, acceptée, refusée ou payée. Le serveur
 * exige la date d'un paiement ; le montant n'est repris que s'il est saisi.
 */
@Component({
  selector: 'policy-operation-status-drawer',
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
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <span class="text-lg font-semibold text-slate-800">{{ kindLabel }} — {{ targetLabel }}</span>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <p class="text-xs text-slate-500">
            Demande actuellement « {{ currentLabel }} ». Montant demandé : {{ amountLabel }}.
          </p>

          @if (isPaid && data.operation.refundBlocked) {
            <tas-alert type="error"><p class="text-sm">{{ refundBlockedMessage }}</p></tas-alert>
          }
          @if (data.target === STATUSES.Refused) {
            <tas-alert type="info">
              <p class="text-xs">La demande sera close. Le client peut en présenter une nouvelle.</p>
            </tas-alert>
          }

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>Référence de l'assureur</tas-label>
              <input tasInput type="text" [formField]="formSchema.insurerReference" />
              <tas-hint>N° de dossier, de courrier ou de virement communiqué par l'assureur.</tas-hint>
            </tas-form-field>

            @if (showsAmount) {
              <tas-form-field>
                <tas-label>Montant {{ isPaid ? 'versé' : 'accordé' }}</tas-label>
                <input tasInput type="text" inputmode="decimal" [formField]="formSchema.amount" />
                <tas-hint>Laissez le montant demandé s'il n'a pas changé.</tas-hint>
                @if (formSchema.amount().touched() && formSchema.amount().invalid()) {
                  <tas-error>{{ formSchema.amount().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
            }

            @if (isPaid) {
              <div>
                <tas-date-picker mode="date" [max]="today" [formField]="formSchema.paidOn">
                  Payée le <span class="text-functional-error">*</span>
                </tas-date-picker>
                @if (formSchema.paidOn().touched() && formSchema.paidOn().invalid()) {
                  <tas-error>{{ formSchema.paidOn().errors()[0].message }}</tas-error>
                }
              </div>
            }
          </form>
        </div>
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button color="primary" type="button" (click)="close()">Annuler</button>
        <button
          tas-raised-button
          [color]="data.target === STATUSES.Refused ? 'warn' : 'primary'"
          type="button"
          [disabled]="formSchema().invalid() || formSchema().submitting()"
          [isLoading]="formSchema().submitting()"
          (click)="handleSubmit()"
        >
          Enregistrer
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class PolicyOperationStatusDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<PolicyOperationStatusDrawerData>(DIALOG_DATA);

  public readonly STATUSES = STATUSES;
  public readonly today = todayIso();
  public readonly refundBlockedMessage = REFUND_BLOCKED_KYC_MESSAGE;
  public readonly isPaid = this.data.target === STATUSES.Paid;
  public readonly showsAmount = this.data.target === STATUSES.Accepted || this.isPaid;
  public readonly kindLabel = OPERATION_KIND_LABELS[this.data.operation.kind ?? ''] ?? this.data.operation.kind ?? 'Demande';
  public readonly targetLabel = operationStatusMeta(this.data.target).label;
  public readonly currentLabel = operationStatusMeta(this.data.operation.status).label;
  public readonly amountLabel = formatAmount(this.data.operation.amount, this.data.operation.currency);

  public readonly model = signal(MoveOperationFormModel.fromOperation(this.data.operation, this.data.target));

  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.amount, ({ value }) => {
      if (!value()) return null;
      const amount = parseAmount(value());
      return amount !== null && amount > 0 ? null : { kind: 'amount', message: 'Indiquez un montant positif' };
    });
    required(schema.paidOn, {
      message: 'La date du paiement est obligatoire',
      when: () => this.isPaid,
    });
    validate(schema.paidOn, ({ value }) =>
      value() && value() > todayIso() ? { kind: 'future', message: 'La date ne peut pas être dans le futur' } : null,
    );
  });

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      try {
        await firstValueFrom(
          this._api.updateInsurancePolicyOperationStatus(this.data.operation.id!, {
            status: this.data.target,
            insurerReference: value.insurerReference.trim() || null,
            amount: this.showsAmount ? parseAmount(value.amount) : null,
            paidOn: this.isPaid ? value.paidOn : null,
          }),
        );
      } catch (error) {
        this._snackbar.error(
          'Demande non mise à jour',
          afterSaleErrorMessage(error as HttpErrorResponse, "L'avancement de la demande n'a pas pu être enregistré."),
        );
        return;
      }

      this._snackbar.success('Demande mise à jour', `${this.kindLabel} : ${this.targetLabel.toLowerCase()}.`);
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
