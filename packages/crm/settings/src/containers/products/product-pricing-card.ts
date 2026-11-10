import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import {
  CompanyInfoApiService,
  PricingRulesDto,
  ProductDto,
  ProductsApiService,
  SetProductPricingRequestVatCategoryEnum,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { currencyUnit, TenantProvider } from '@sankore/crm/common';
import { decimalText, isDecimalOrEmpty, parseDecimal } from '../pricing-amounts';

type VatCategory = `${SetProductPricingRequestVatCategoryEnum}`;

class PricingFormModel {
  public unitPrice!: string;
  public priceUnit!: string;
  public vatCategory!: VatCategory;

  public static fromDto(dto: ProductDto | null): PricingFormModel {
    const m = new PricingFormModel();
    m.unitPrice = decimalText(dto?.unitPrice);
    m.priceUnit = dto?.priceUnit ?? '';
    m.vatCategory = (dto?.vatCategory as VatCategory | undefined) ?? 'Standard';
    return m;
  }
}

/**
 * « Prix et TVA » d'un produit Standard (devis en lignes, lot 1) : ce qu'une ligne de devis
 * proposera par défaut. Le prix est hors taxes, dans la monnaie de l'institution ; les taux
 * viennent des réglages de l'institution, la carte n'en garde que la catégorie.
 */
@Component({
  selector: 'product-pricing-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormRoot, FormField, Button, TasFormField, TasLabel, TasError, TasHint, TasInput, TasSuffix, TasSelect],
  template: `
    <section aria-labelledby="product-pricing" class="rounded-2xl bg-white shadow-sm border border-slate-100 p-6">
      <h2 id="product-pricing" class="text-xl font-bold text-primary">Prix et TVA</h2>
      <p class="text-sm text-slate-600 mt-1">Repris sur chaque ligne de devis, et modifiable par l’agent.</p>

      @if (!editing()) {
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 mt-4">
          <div>
            <dt class="text-xs text-slate-500">Prix unitaire HT</dt>
            <dd class="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">
              @if (product()?.unitPrice != null) {
                {{ priceText() }}
              } @else {
                <span class="font-normal text-slate-500">Non renseigné</span>
              }
            </dd>
          </div>
          <div>
            <dt class="text-xs text-slate-500">TVA</dt>
            <dd class="text-sm font-semibold text-slate-900 mt-0.5">{{ vatText() }}</dd>
          </div>
        </dl>
        @if (canUpdate()) {
          <button tas-outlined-button color="primary" type="button" class="mt-5" (click)="editing.set(true)">
            {{ product()?.unitPrice != null ? 'Modifier' : 'Renseigner le prix' }}
          </button>
        }
      } @else {
        <form [formRoot]="formSchema" class="flex flex-col gap-4 mt-4" (submit)="$event.preventDefault()">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <tas-form-field>
              <tas-label>Prix unitaire HT</tas-label>
              <input tasInput type="text" inputmode="decimal" placeholder="Ex. 4 750" [formField]="formSchema.unitPrice" />
              <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">{{ unit() }}</button>
              @if (formSchema.unitPrice().touched() && formSchema.unitPrice().invalid()) {
                <tas-error>{{ formSchema.unitPrice().errors()[0].message }}</tas-error>
              } @else {
                <tas-hint>Vide : la ligne démarre sans prix.</tas-hint>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Unité</tas-label>
              <input tasInput type="text" placeholder="pièce, carton, heure…" [formField]="formSchema.priceUnit" />
              @if (formSchema.priceUnit().touched() && formSchema.priceUnit().invalid()) {
                <tas-error>{{ formSchema.priceUnit().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </div>
          <tas-form-field>
            <tas-label>TVA</tas-label>
            <tas-select [options]="vatOptions()" [formField]="formSchema.vatCategory"></tas-select>
            <tas-hint>Les taux se règlent dans Paramètres › Institution.</tas-hint>
          </tas-form-field>
          <div class="flex gap-2">
            <button tas-raised-button color="primary" type="button" (click)="handleSubmit()"
                    [disabled]="formSchema().invalid() || formSchema().submitting()"
                    [isLoading]="formSchema().submitting()">Enregistrer</button>
            <button tas-text-button color="primary" type="button" [disabled]="formSchema().submitting()" (click)="cancel()">Annuler</button>
          </div>
        </form>
      }
    </section>
  `,
})
export class ProductPricingCard {
  private readonly _products = inject(ProductsApiService);
  private readonly _companyInfo = inject(CompanyInfoApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _currency = inject(TenantProvider).currency;

  public readonly product = input<ProductDto | null>(null);
  public readonly canUpdate = input(false);
  public readonly saved = output<void>();

  public readonly editing = signal(false);
  public readonly rules = signal<PricingRulesDto | null>(null);
  public readonly unit = computed(() => currencyUnit(this._currency()));

  public readonly vatOptions = computed(() => {
    const r = this.rules();
    return [
      { label: `Taux normal${r ? ` (${decimalText(r.vatStandardRate)} %)` : ''}`, value: 'Standard' },
      { label: `Taux réduit${r ? ` (${decimalText(r.vatReducedRate)} %)` : ''}`, value: 'Reduced' },
      { label: 'Exonéré', value: 'Exempt' },
    ];
  });

  public readonly priceText = computed(() => {
    const p = this.product();
    if (p?.unitPrice == null) return '';
    const per = p.priceUnit ? ` / ${p.priceUnit}` : '';
    return `${decimalText(p.unitPrice)} ${this.unit()}${per}`;
  });

  public readonly vatText = computed(() => {
    const category = this.product()?.vatCategory ?? 'Standard';
    return this.vatOptions().find((o) => o.value === category)?.label ?? 'Taux normal';
  });

  public readonly model = linkedSignal(() => PricingFormModel.fromDto(this.product()));
  public readonly formSchema = form(this.model, (schema) => {
    validate(schema.unitPrice, (ctx) =>
      isDecimalOrEmpty(ctx.value()) ? null : { kind: 'amount', message: 'Un montant positif, en chiffres (2 décimales au plus)' });
    validate(schema.priceUnit, (ctx) =>
      ctx.value().trim().length <= 30 ? null : { kind: 'length', message: '30 caractères au plus' });
  });

  constructor() {
    this._companyInfo.getPricingRules().pipe(catchError(() => EMPTY)).subscribe((r) => this.rules.set(r));
  }

  public cancel(): void {
    this.model.set(PricingFormModel.fromDto(this.product()));
    this.editing.set(false);
  }

  public handleSubmit(): void {
    const id = this.product()?.id;
    if (!id) return;
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const ok = await firstValueFrom(
        this._products
          .setProductPricing(id, {
            unitPrice: parseDecimal(value.unitPrice),
            priceUnit: value.priceUnit.trim() || null,
            vatCategory: value.vatCategory as SetProductPricingRequestVatCategoryEnum,
          })
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this._snackbar.error(
                'Prix non enregistré',
                err.error?.error === 'PRODUCT_PRICING_STANDARD_ONLY'
                  ? 'Seuls les produits Standard ont un prix au catalogue.'
                  : 'Le prix de ce produit n’a pas pu être enregistré.',
              );
              return EMPTY;
            }),
          ),
        { defaultValue: false },
      ).then((r) => r !== false);
      if (!ok) return;
      this.editing.set(false);
      this._snackbar.success('Prix enregistré', 'Les prochaines lignes de devis reprendront ce prix.');
      this.saved.emit();
    });
  }
}
