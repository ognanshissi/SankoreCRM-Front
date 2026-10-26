import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { IntegrationApiService, StatementDto } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import { catchError, EMPTY, firstValueFrom, of, tap } from 'rxjs';
import { formatAmount, formatContractDate } from '../../data-access/integration-referential';
import {
  parseAmount,
  premiumsDue,
  remittanceState,
  statementErrorMessage,
  todayIso,
} from './statement-referential';

export interface StatementRemittanceDrawerData {
  statement: StatementDto;
  insurerName: string;
  periodLabel: string;
}

class RemittanceFormModel {
  public remittedOn!: string;
  public reference!: string;
  public amount!: string;

  public static fromStatement(statement: StatementDto): RemittanceFormModel {
    const model = new RemittanceFormModel();
    model.remittedOn = statement.remittedOn?.slice(0, 10) ?? todayIso();
    model.reference = statement.remittanceReference ?? '';
    model.amount = String(statement.remittedAmount ?? premiumsDue(statement));
    return model;
  }
}

/**
 * Reversement à l'assureur des primes encaissées en son nom.
 *
 * Le plancher dépend de l'accord de compensation de la connexion : sans lui, l'intégralité
 * des primes est reversée. L'accord est relu ici plutôt que reçu du parent, parce que la
 * liste des connexions ne le porte pas ; s'il est illisible (droit de lecture des
 * connexions absent), le tiroir explique les deux cas et laisse le serveur trancher.
 */
@Component({
  selector: 'statement-remittance-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    FormField,
    FormRoot,
    TasAlert,
    TasDatePicker,
    TasDrawerAction,
    TasDrawerContent,
    TasDrawerTitle,
    TasError,
    TasFormField,
    TasHint,
    TasInput,
    TasLabel,
    TasSideDrawer,
    TasTag,
    TasTitle,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">Reversement à l'assureur</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div>
            <p class="text-sm font-medium text-slate-800">
              {{ data.insurerName || 'Assureur' }} — {{ data.periodLabel }}
            </p>
            <div class="mt-2">
              <tas-tag [severity]="remittance.severity">{{ remittance.label }}</tas-tag>
            </div>
          </div>

          <tas-alert type="info">
            <p class="text-sm">
              Les primes encaissées au nom de l'assureur lui sont reversées dans les 30 jours
              qui suivent la plus ancienne d'entre elles.
            </p>
            <p class="mt-1 text-sm">
              @if (nettingAgreed() === true) {
                L'assureur a accordé la compensation des commissions : vous pouvez déduire votre
                commission ({{ amount(statement.commissionAmount) }}) des primes reversées, soit
                {{ amount(floor()) }} au minimum.
              } @else if (nettingAgreed() === false) {
                L'assureur n'a pas accordé la compensation des commissions : l'intégralité des
                primes est reversée, sans déduire de commission. Un montant inférieur à
                {{ amount(due) }} sera refusé.
              } @else {
                Sans accord de compensation de l'assureur, l'intégralité des primes est
                reversée, sans déduire de commission ; un montant inférieur est refusé.
              }
            </p>
          </tas-alert>

          <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt class="text-slate-500">Primes encaissées</dt>
            <dd class="text-right tabular-nums text-slate-800">
              {{ amount(statement.premiumCollected) }}
            </dd>
            <dt class="text-slate-500">Contre-passations</dt>
            <dd class="text-right tabular-nums text-slate-800">
              − {{ amount(statement.premiumReversed) }}
            </dd>
            <dt class="font-medium text-slate-700">Primes à reverser</dt>
            <dd class="text-right font-medium tabular-nums text-slate-800">{{ amount(due) }}</dd>
            <dt class="text-slate-500">Votre commission</dt>
            <dd class="text-right tabular-nums text-slate-800">
              {{ amount(statement.commissionAmount) }}
            </dd>
          </dl>

          @if (statement.remittedOn) {
            <p class="text-xs text-slate-500">
              Un reversement est déjà enregistré ({{ amount(statement.remittedAmount) }} le
              {{ date(statement.remittedOn) }}, réf. {{ statement.remittanceReference || '—' }}) :
              l'enregistrer à nouveau le remplace.
            </p>
          }

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <div>
              <tas-date-picker mode="date" [max]="today" [formField]="formSchema.remittedOn">
                Date du reversement <span class="text-functional-error">*</span>
              </tas-date-picker>
              @if (formSchema.remittedOn().touched() && formSchema.remittedOn().invalid()) {
                <tas-error>{{ formSchema.remittedOn().errors()[0].message }}</tas-error>
              }
            </div>

            <tas-form-field>
              <tas-label>Référence du virement <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="text"
                placeholder="ex : VIR-2026-10-0042"
                [formField]="formSchema.reference"
              />
              @if (formSchema.reference().touched() && formSchema.reference().invalid()) {
                <tas-error>{{ formSchema.reference().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>
                Montant reversé
                @if (statement.currency) {
                  ({{ statement.currency }})
                }
                <span class="text-functional-error">*</span>
              </tas-label>
              <input tasInput type="text" inputmode="decimal" [formField]="formSchema.amount" />
              <tas-hint>Pré-rempli avec les primes encaissées, contre-passations déduites.</tas-hint>
              @if (formSchema.amount().touched() && formSchema.amount().invalid()) {
                <tas-error>{{ formSchema.amount().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
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
          Enregistrer le reversement
        </button>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class StatementRemittanceDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<StatementRemittanceDrawerData>(DIALOG_DATA);
  public readonly statement = this.data.statement;
  public readonly due = premiumsDue(this.statement);
  public readonly remittance = remittanceState(this.statement);
  public readonly today = todayIso();

  /** `null` tant que l'accord n'est pas connu (ou illisible). */
  public readonly nettingAgreed = signal<boolean | null>(null);

  public readonly floor = computed(() =>
    this.nettingAgreed() === true ? this.due - (this.statement.commissionAmount ?? 0) : this.due,
  );

  public readonly model = signal(RemittanceFormModel.fromStatement(this.statement));
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.remittedOn, { message: 'La date du reversement est obligatoire' });
    validate(schema.remittedOn, ({ value }) =>
      value() && value() > this.today
        ? { kind: 'future', message: 'La date ne peut pas être dans le futur' }
        : null,
    );
    required(schema.reference, { message: 'La référence du virement est obligatoire' });
    validate(schema.reference, ({ value }) =>
      value() && !value().trim()
        ? { kind: 'required', message: 'La référence du virement est obligatoire' }
        : null,
    );
    required(schema.amount, { message: 'Le montant est obligatoire' });
    validate(schema.amount, ({ value }) => {
      if (!value()) return null;
      const amount = parseAmount(value());
      if (amount === null || amount <= 0) {
        return { kind: 'amount', message: 'Saisissez un montant positif' };
      }
      // Le serveur reste juge (INSURANCE_REMITTANCE_INVALID) ; on ne prévient que
      // lorsque l'accord de compensation est connu.
      if (this.nettingAgreed() !== null && amount < this.floor() - 0.005) {
        return {
          kind: 'floor',
          message:
            this.nettingAgreed() === true
              ? `Au minimum ${formatAmount(this.floor(), this.statement.currency)} (primes nettes de la commission)`
              : `Sans accord de compensation, l'intégralité des primes est due : ${formatAmount(this.floor(), this.statement.currency)}`,
        };
      }
      return null;
    });
  });

  constructor() {
    const connectionId = this.statement.connectionId;
    if (connectionId) {
      this._api
        .getIntegrationConnection(connectionId)
        .pipe(catchError(() => of(null)))
        .subscribe((connection) => {
          if (connection) this.nettingAgreed.set(connection.hasCommissionNettingAgreement ?? false);
        });
    }
  }

  public amount(value: number | null | undefined): string {
    return formatAmount(value, this.statement.currency);
  }

  public date(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public handleSubmit(): void {
    const statementId = this.statement.id;
    if (!statementId) return;

    submit(this.formSchema, async (field) => {
      const value = field().value();
      let done = false;

      await firstValueFrom(
        this._api
          .recordInsurerStatementRemittance(statementId, {
            remittedOn: value.remittedOn,
            reference: value.reference.trim(),
            amount: parseAmount(value.amount) ?? 0,
          })
          .pipe(
            tap(() => (done = true)),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Reversement refusé',
                statementErrorMessage(error, "Le reversement n'a pas pu être enregistré."),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!done) return;
      this._snackbar.success('Reversement enregistré', "Le reversement à l'assureur est consigné.");
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
