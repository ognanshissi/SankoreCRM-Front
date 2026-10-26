import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, required, submit, validate } from '@angular/forms/signals';
import { IntegrationApiService, StatementDto } from '@sankore/crm-api';
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
import { catchError, EMPTY, firstValueFrom, tap } from 'rxjs';
import { formatAmount } from '../../data-access/integration-referential';
import {
  commissionGapLabel,
  parseAmount,
  statementErrorMessage,
  todayIso,
} from './statement-referential';

export interface InsurerCommissionDrawerData {
  statement: StatementDto;
  insurerName: string;
  periodLabel: string;
}

class InsurerCommissionFormModel {
  public declaredCommission!: string;
  public reference!: string;
  public receivedOn!: string;

  public static fromStatement(statement: StatementDto): InsurerCommissionFormModel {
    const model = new InsurerCommissionFormModel();
    model.declaredCommission =
      statement.insurerDeclaredCommission === null || statement.insurerDeclaredCommission === undefined
        ? ''
        : String(statement.insurerDeclaredCommission);
    model.reference = statement.insurerCommissionReference ?? '';
    model.receivedOn = todayIso();
    return model;
  }
}

/**
 * Commission que le relevé de l'assureur annonce pour le mois, rapprochée de la nôtre.
 * L'écart affiché est calculé comme celui du serveur : notre commission moins la sienne.
 */
@Component({
  selector: 'insurer-commission-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Button,
    FormField,
    FormRoot,
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
        <TasTitle class="text-lg">Commission déclarée par l'assureur</TasTitle>
      </tas-drawer-title>

      <tas-drawer-content>
        <div class="flex flex-col gap-5">
          <div>
            <p class="text-sm font-medium text-slate-800">
              {{ data.insurerName || 'Assureur' }} — {{ data.periodLabel }}
            </p>
            <p class="mt-0.5 text-xs text-slate-500">
              Reportez la commission indiquée sur le relevé de l'assureur : elle est comparée à
              celle que le bordereau calcule, et un écart signale un différend à régler avec lui.
            </p>
          </div>

          <div class="grid grid-cols-3 gap-3 rounded-lg border border-slate-200 p-3">
            <div>
              <p class="text-xs text-slate-400">Notre commission</p>
              <p class="text-sm font-semibold tabular-nums text-slate-800">
                {{ amount(statement.commissionAmount) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400">Déclarée par l'assureur</p>
              <p class="text-sm font-semibold tabular-nums text-slate-800">
                {{ amount(declared()) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400">Écart</p>
              @if (gap(); as currentGap) {
                <tas-tag [severity]="currentGap.severity">{{ currentGap.label }}</tas-tag>
              } @else {
                <p class="text-sm text-slate-400">—</p>
              }
            </div>
          </div>

          <form [formRoot]="formSchema" class="flex flex-col gap-5">
            <tas-form-field>
              <tas-label>
                Commission déclarée
                @if (statement.currency) {
                  ({{ statement.currency }})
                }
                <span class="text-functional-error">*</span>
              </tas-label>
              <input
                tasInput
                type="text"
                inputmode="decimal"
                [formField]="formSchema.declaredCommission"
              />
              @if (
                formSchema.declaredCommission().touched() &&
                formSchema.declaredCommission().invalid()
              ) {
                <tas-error>{{ formSchema.declaredCommission().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <tas-form-field>
              <tas-label>Référence du relevé <span class="text-functional-error">*</span></tas-label>
              <input
                tasInput
                type="text"
                placeholder="ex : relevé de commissions n° 2026-10"
                [formField]="formSchema.reference"
              />
              <tas-hint>La référence du document de l'assureur qui annonce ce montant.</tas-hint>
              @if (formSchema.reference().touched() && formSchema.reference().invalid()) {
                <tas-error>{{ formSchema.reference().errors()[0].message }}</tas-error>
              }
            </tas-form-field>

            <div>
              <tas-date-picker mode="date" [max]="today" [formField]="formSchema.receivedOn">
                Reçu le <span class="text-functional-error">*</span>
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
          color="primary"
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
export class InsurerCommissionDrawer {
  private readonly _dialogRef = inject<DialogRef<boolean>>(DialogRef);
  private readonly _api = inject(IntegrationApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly data = inject<InsurerCommissionDrawerData>(DIALOG_DATA);
  public readonly statement = this.data.statement;
  public readonly today = todayIso();

  public readonly model = signal(InsurerCommissionFormModel.fromStatement(this.statement));
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.declaredCommission, { message: 'La commission déclarée est obligatoire' });
    validate(schema.declaredCommission, ({ value }) => {
      if (!value()) return null;
      const amount = parseAmount(value());
      return amount === null || amount < 0
        ? { kind: 'amount', message: 'Saisissez un montant positif ou nul' }
        : null;
    });
    required(schema.reference, { message: 'La référence du relevé est obligatoire' });
    validate(schema.reference, ({ value }) =>
      value() && !value().trim()
        ? { kind: 'required', message: 'La référence du relevé est obligatoire' }
        : null,
    );
    required(schema.receivedOn, { message: 'La date de réception est obligatoire' });
    validate(schema.receivedOn, ({ value }) =>
      value() && value() > this.today
        ? { kind: 'future', message: 'La date ne peut pas être dans le futur' }
        : null,
    );
  });

  public readonly declared = computed(() => parseAmount(this.formSchema.declaredCommission().value()));

  public readonly gap = computed(() => {
    const declared = this.declared();
    if (declared === null) return null;
    return commissionGapLabel((this.statement.commissionAmount ?? 0) - declared, this.statement.currency);
  });

  public amount(value: number | null | undefined): string {
    return formatAmount(value, this.statement.currency);
  }

  public handleSubmit(): void {
    const statementId = this.statement.id;
    if (!statementId) return;

    submit(this.formSchema, async (field) => {
      const value = field().value();
      let done = false;

      await firstValueFrom(
        this._api
          .recordInsurerDeclaredCommission(statementId, {
            declaredCommission: parseAmount(value.declaredCommission) ?? 0,
            reference: value.reference.trim(),
            receivedOn: value.receivedOn,
          })
          .pipe(
            tap(() => (done = true)),
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                statementErrorMessage(error, "La commission déclarée n'a pas pu être enregistrée."),
              );
              return EMPTY;
            }),
          ),
        { defaultValue: null },
      );

      if (!done) return;
      this._snackbar.success(
        'Commission enregistrée',
        "La commission de l'assureur est rapprochée de celle du bordereau.",
      );
      this._dialogRef.close(true);
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}
