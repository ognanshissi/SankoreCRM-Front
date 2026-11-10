import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { form, FormField, FormRoot, readonly, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { CompanyInfoApiService, PricingRulesDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { decimalText, isDecimalOrEmpty, parseDecimal } from '../pricing-amounts';

class PricingRulesFormModel {
  public standard!: string;
  public reduced!: string;
  public maxDiscount!: string;

  public static fromDto(dto: PricingRulesDto | null): PricingRulesFormModel {
    const m = new PricingRulesFormModel();
    m.standard = decimalText(dto?.vatStandardRate ?? 18);
    m.reduced = decimalText(dto?.vatReducedRate ?? 9);
    m.maxDiscount = decimalText(dto?.maxDiscountPercent);
    return m;
  }
}

const PERCENT_MESSAGE = 'Un pourcentage entre 0 et 100';

/**
 * « TVA et remises » de l'institution (devis en lignes, lot 1). Les taux ne sont jamais codés :
 * 18 % et 9 % sont ceux de la Côte d'Ivoire, proposés au départ, et le taux normal varie de 15 à
 * 20 % dans l'UEMOA. Son propre bouton : la carte écrit par `company-info/pricing`, pas avec
 * l'identité de la page.
 */
@Component({
  selector: 'pricing-rules-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasCard, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSuffix],
  template: `
    <tas-card>
      <form [formRoot]="formSchema" class="p-4 flex flex-col gap-4" (submit)="$event.preventDefault()">
        <div>
          <p class="text-sm font-semibold text-slate-700">TVA et remises</p>
          <p class="text-xs text-slate-400 mt-0.5">
            Appliqués aux devis. Une ligne déjà saisie garde le taux du moment de sa saisie.
          </p>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <tas-form-field>
            <tas-label>Taux normal <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" inputmode="decimal" [formField]="formSchema.standard" />
            <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default pr-3 text-sm text-slate-500">%</button>
            @if (formSchema.standard().touched() && formSchema.standard().invalid()) {
              <tas-error>{{ formSchema.standard().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Taux réduit <span class="text-functional-error">*</span></tas-label>
            <input tasInput type="text" inputmode="decimal" [formField]="formSchema.reduced" />
            <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default pr-3 text-sm text-slate-500">%</button>
            @if (formSchema.reduced().touched() && formSchema.reduced().invalid()) {
              <tas-error>{{ formSchema.reduced().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
          <tas-form-field>
            <tas-label>Plafond de remise</tas-label>
            <input tasInput type="text" inputmode="decimal" placeholder="Aucun" [formField]="formSchema.maxDiscount" />
            <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default pr-3 text-sm text-slate-500">%</button>
            @if (formSchema.maxDiscount().touched() && formSchema.maxDiscount().invalid()) {
              <tas-error>{{ formSchema.maxDiscount().errors()[0].message }}</tas-error>
            }
          </tas-form-field>
        </div>
        <p class="-mt-2 text-xs text-slate-500">
          18 % et 9 % sont les taux de la Côte d’Ivoire. Au-delà du plafond, un devis attend la validation d’un responsable ; vide, aucune remise n’en demande.
        </p>

        @if (canUpdate()) {
          <div class="flex justify-end">
            <button tas-outlined-button color="primary" type="button" (click)="handleSubmit()"
                    [disabled]="formSchema().invalid() || formSchema().submitting()"
                    [isLoading]="formSchema().submitting()">Enregistrer la TVA</button>
          </div>
        }
      </form>
    </tas-card>
  `,
})
export class PricingRulesCard implements OnInit {
  private readonly _api = inject(CompanyInfoApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly canUpdate = input(false);

  public readonly model = signal(PricingRulesFormModel.fromDto(null));
  public readonly formSchema = form(this.model, (schema) => {
    // Lecture seule sans le droit de modifier l'institution : les taux restent visibles.
    readonly(schema.standard, () => !this.canUpdate());
    readonly(schema.reduced, () => !this.canUpdate());
    readonly(schema.maxDiscount, () => !this.canUpdate());
    required(schema.standard, { message: 'Le taux normal est obligatoire' });
    required(schema.reduced, { message: 'Le taux réduit est obligatoire' });
    validate(schema.standard, (ctx) => (isDecimalOrEmpty(ctx.value(), 100) ? null : { kind: 'percent', message: PERCENT_MESSAGE }));
    validate(schema.reduced, (ctx) => {
      if (!isDecimalOrEmpty(ctx.value(), 100)) return { kind: 'percent', message: PERCENT_MESSAGE };
      const reduced = parseDecimal(ctx.value());
      const standard = parseDecimal(ctx.valueOf(schema.standard));
      return reduced !== null && standard !== null && !Number.isNaN(standard) && reduced > standard
        ? { kind: 'order', message: 'Pas au-dessus du taux normal' }
        : null;
    });
    validate(schema.maxDiscount, (ctx) => (isDecimalOrEmpty(ctx.value(), 100) ? null : { kind: 'percent', message: PERCENT_MESSAGE }));
  });

  ngOnInit(): void {
    this._api.getPricingRules().pipe(catchError(() => EMPTY))
      .subscribe((r) => this.model.set(PricingRulesFormModel.fromDto(r)));
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
      const body = {
        vatStandardRate: parseDecimal(v.standard) ?? 0,
        vatReducedRate: parseDecimal(v.reduced) ?? 0,
        maxDiscountPercent: parseDecimal(v.maxDiscount),
      };
      const failed = await firstValueFrom(
        this._api.setPricingRules(body).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'TVA non enregistrée',
              err.error?.error === 'VAT_RATES_INVALID'
                ? 'Le taux réduit ne peut pas dépasser le taux normal.'
                : 'Les taux de TVA n’ont pas pu être enregistrés.',
            );
            return [true];
          }),
        ),
        { defaultValue: false },
      );
      if (failed === true) return;
      this._snackbar.success('TVA enregistrée', 'Les prochaines lignes de devis appliqueront ces taux.');
    });
  }
}
