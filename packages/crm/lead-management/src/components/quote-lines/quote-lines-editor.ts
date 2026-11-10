import { ChangeDetectionStrategy, Component, computed, effect, input, model, untracked } from '@angular/core';
import { applyEach, form, FormField, maxLength, required, validate } from '@angular/forms/signals';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel, TasSuffix } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { currencyUnit } from '@sankore/crm/common';
import {
  CatalogueProduct,
  computeQuote,
  DISCOUNT_KIND_OPTIONS,
  emptyLine,
  formatMoney,
  numberText,
  parseNumber,
  percentText,
  QuoteDraft,
  QuoteRules,
} from './quote-lines.models';

const positive = (t: string) => {
  const v = parseNumber(t);
  return v !== null && !Number.isNaN(v) && v > 0;
};
const positiveOrZero = (t: string) => {
  const v = parseNumber(t);
  return v !== null && !Number.isNaN(v);
};

/**
 * L'éditeur des lignes d'un projet (devis en lignes, lot 4) : produit du catalogue, désignation,
 * quantité, prix HT, remise ; les totaux et la TVA se calculent pendant la saisie, et une remise
 * au-delà du plafond de l'institution est signalée avant l'enregistrement.
 *
 * Une collection éditée sur place : l'exception admise à la règle `tas-table` par le plan
 * (docs/devis-en-lignes.md, lot 4). Le parent tient le brouillon (`[(draft)]`) et lit la validité
 * par `formSchema().invalid()`.
 */
@Component({
  selector: 'quote-lines-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, Button, TasFormField, TasLabel, TasError, TasSuffix, TasIcon, TasInput, TasSelect],
  template: `
    <div class="flex flex-col gap-3">
      @for (line of draft().lines; track line.key; let i = $index) {
        <div class="flex flex-col gap-3 rounded-xl border border-slate-200 p-3" role="group" [attr.aria-label]="'Ligne ' + (i + 1)">
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <tas-form-field>
              <tas-label>Produit <span class="text-functional-error">*</span></tas-label>
              <tas-select [options]="productOptions()" placeholder="Choisir" [formField]="formSchema.lines[i].productId"></tas-select>
              @if (formSchema.lines[i].productId().touched() && formSchema.lines[i].productId().invalid()) {
                <tas-error>{{ formSchema.lines[i].productId().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Désignation <span class="text-functional-error">*</span></tas-label>
              <input tasInput type="text" [formField]="formSchema.lines[i].label" />
              @if (formSchema.lines[i].label().touched() && formSchema.lines[i].label().invalid()) {
                <tas-error>{{ formSchema.lines[i].label().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </div>

          <!-- Deux rangées : dans un tiroir, cinq champs côte à côte écrasaient le prix. -->
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-[6rem_8rem_minmax(0,1fr)]">
            <tas-form-field>
              <tas-label>Quantité</tas-label>
              <input tasInput type="text" inputmode="decimal" [formField]="formSchema.lines[i].quantity" />
              @if (formSchema.lines[i].quantity().touched() && formSchema.lines[i].quantity().invalid()) {
                <tas-error>{{ formSchema.lines[i].quantity().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Unité</tas-label>
              <input tasInput type="text" placeholder="pièce" [formField]="formSchema.lines[i].unit" />
              @if (formSchema.lines[i].unit().touched() && formSchema.lines[i].unit().invalid()) {
                <tas-error>{{ formSchema.lines[i].unit().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
            <tas-form-field>
              <tas-label>Prix unitaire HT</tas-label>
              <input tasInput type="text" inputmode="decimal" [formField]="formSchema.lines[i].unitPrice" />
              <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">{{ unit() }}</button>
              @if (formSchema.lines[i].unitPrice().touched() && formSchema.lines[i].unitPrice().invalid()) {
                <tas-error>{{ formSchema.lines[i].unitPrice().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_minmax(0,14rem)]">
            <tas-form-field>
              <tas-label>Remise</tas-label>
              <tas-select [options]="discountKinds" [formField]="formSchema.lines[i].discountKind"></tas-select>
            </tas-form-field>
            @if (line.discountKind !== 'None') {
              <tas-form-field>
                <tas-label>{{ line.discountKind === 'Percent' ? 'Taux de remise' : 'Montant de remise' }}</tas-label>
                <input tasInput type="text" inputmode="decimal" [formField]="formSchema.lines[i].discountValue" />
                <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">{{ line.discountKind === 'Percent' ? '%' : unit() }}</button>
                @if (formSchema.lines[i].discountValue().touched() && formSchema.lines[i].discountValue().invalid()) {
                  <tas-error>{{ formSchema.lines[i].discountValue().errors()[0].message }}</tas-error>
                }
              </tas-form-field>
            }
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-sm">
            <p class="text-slate-600">
              TVA {{ percent(totals().lines[i].vatRate) }}&nbsp;%
              @if (totals().lines[i].discount > 0) {
                <span aria-hidden="true"> · </span>remise {{ money(totals().lines[i].discount) }}
              }
              <span aria-hidden="true"> · </span>
              <span class="font-semibold text-slate-900 tabular-nums">{{ money(totals().lines[i].net) }} HT</span>
            </p>
            <button tas-text-button color="warn" type="button" (click)="remove(i)">
              <tas-icon iconName="feather:trash-2" style="font-size:14px"></tas-icon> Retirer
            </button>
          </div>
        </div>
      }

      <button tas-outlined-button color="primary" type="button" class="self-start" [disabled]="draft().lines.length >= 100" (click)="add()">
        <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon> Ajouter un produit
      </button>
      @if (catalogue().length === 0) {
        <p class="text-xs text-slate-500">Aucun produit Standard actif au catalogue : créez-en dans Paramètres › Produits.</p>
      }

      @if (draft().lines.length > 0) {
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-[10rem_minmax(0,14rem)]">
          <tas-form-field>
            <tas-label>Remise globale</tas-label>
            <tas-select [options]="discountKinds" [formField]="formSchema.globalKind"></tas-select>
          </tas-form-field>
          @if (draft().globalKind !== 'None') {
            <tas-form-field>
              <tas-label>{{ draft().globalKind === 'Percent' ? 'Taux' : 'Montant' }}</tas-label>
              <input tasInput type="text" inputmode="decimal" [formField]="formSchema.globalValue" />
              <button tasSuffix type="button" tabindex="-1" aria-hidden="true" class="cursor-default whitespace-nowrap pr-3 text-sm text-slate-500">{{ draft().globalKind === 'Percent' ? '%' : unit() }}</button>
              @if (formSchema.globalValue().touched() && formSchema.globalValue().invalid()) {
                <tas-error>{{ formSchema.globalValue().errors()[0].message }}</tas-error>
              }
            </tas-form-field>
          }
        </div>

        <dl class="ml-auto grid w-full max-w-sm grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm tabular-nums" aria-live="polite">
          <dt class="text-slate-600">Sous-total HT</dt><dd class="text-right">{{ money(totals().subtotal) }}</dd>
          @if (totals().globalDiscount > 0) {
            <dt class="text-slate-600">Remise globale</dt><dd class="text-right">− {{ money(totals().globalDiscount) }}</dd>
          }
          <dt class="font-semibold text-slate-900">Total HT</dt><dd class="text-right font-semibold text-slate-900">{{ money(totals().totalExclTax) }}</dd>
          @for (b of totals().vatByRate; track b.rate) {
            <dt class="text-slate-600">TVA {{ percent(b.rate) }}&nbsp;%</dt><dd class="text-right">{{ money(b.vat) }}</dd>
          }
          <dt class="border-t border-slate-200 pt-1 font-bold text-slate-900">Total TTC</dt>
          <dd class="border-t border-slate-200 pt-1 text-right font-bold text-slate-900">{{ money(totals().totalInclTax) }}</dd>
        </dl>

        @if (totals().needsApproval) {
          <p class="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            <tas-icon iconName="feather:alert-triangle" class="mt-0.5 shrink-0 text-amber-600" style="font-size:14px"></tas-icon>
            Remise de {{ percent(totals().effectiveDiscountPercent) }}&nbsp;% par rapport au catalogue : au-delà du plafond de
            {{ percent(rules().ceiling!) }}&nbsp;%, le devis devra être validé par un responsable.
          </p>
        }
      }
    </div>
  `,
})
export class QuoteLinesEditor {
  public readonly draft = model.required<QuoteDraft>();
  public readonly catalogue = input.required<CatalogueProduct[]>();
  public readonly rules = input.required<QuoteRules>();

  public readonly discountKinds = DISCOUNT_KIND_OPTIONS;
  public readonly unit = computed(() => currencyUnit(this.rules().currency));
  public readonly totals = computed(() => computeQuote(this.draft(), this.rules(), this.catalogue()));

  /** Les produits actifs, plus ceux des lignes enregistrées qui ont quitté le catalogue depuis. */
  public readonly productOptions = computed(() => {
    const options = this.catalogue().map((p) => ({ value: p.id, label: p.name }));
    for (const line of this.draft().lines) {
      if (line.productId && !options.some((o) => o.value === line.productId))
        options.push({ value: line.productId, label: `${line.label} (retiré du catalogue)` });
    }
    return options;
  });

  public readonly formSchema = form(this.draft, (schema) => {
    applyEach(schema.lines, (line) => {
      required(line.productId, { message: 'Choisissez un produit' });
      required(line.label, { message: 'La désignation est obligatoire' });
      maxLength(line.label, 200, { message: '200 caractères au plus' });
      maxLength(line.unit, 30, { message: '30 caractères au plus' });
      validate(line.quantity, (ctx) => (positive(ctx.value()) ? null : { kind: 'qty', message: 'Une quantité positive' }));
      validate(line.unitPrice, (ctx) =>
        positiveOrZero(ctx.value()) ? null : { kind: 'price', message: 'Un prix en chiffres' });
      validate(line.discountValue, (ctx) => {
        const kind = ctx.valueOf(line.discountKind);
        if (kind === 'None') return null;
        const v = parseNumber(ctx.value());
        if (v === null || Number.isNaN(v)) return { kind: 'discount', message: 'Une remise en chiffres' };
        if (kind === 'Percent' && v > 100) return { kind: 'discount', message: '100 % au plus' };
        const gross = (parseNumber(ctx.valueOf(line.quantity)) || 0) * (parseNumber(ctx.valueOf(line.unitPrice)) || 0);
        return kind === 'Amount' && v > gross ? { kind: 'discount', message: 'Au-delà du montant de la ligne' } : null;
      });
    });
    validate(schema.globalValue, (ctx) => {
      const kind = ctx.valueOf(schema.globalKind);
      if (kind === 'None') return null;
      const v = parseNumber(ctx.value());
      if (v === null || Number.isNaN(v)) return { kind: 'discount', message: 'Une remise en chiffres' };
      if (kind === 'Percent' && v > 100) return { kind: 'discount', message: '100 % au plus' };
      return kind === 'Amount' && this.totals().globalDiscountTooHigh ? { kind: 'discount', message: 'Au-delà du sous-total' } : null;
    });
  });

  /** Le produit choisi sur une ligne : clé → id, pour savoir quand il change. */
  private readonly _seen = new Map<string, string>();

  constructor() {
    // Choisir un produit remplit la ligne avec ce que dit le catalogue : désignation, unité, prix
    // et TVA. Seulement au CHANGEMENT de produit : une ligne enregistrée garde ce qui a été saisi.
    effect(() => {
      const lines = this.draft().lines;
      const catalogue = this.catalogue();
      let changed = false;
      const next = lines.map((line) => {
        const before = this._seen.get(line.key);
        this._seen.set(line.key, line.productId);
        if (before === undefined || before === line.productId) return line;
        const product = catalogue.find((p) => p.id === line.productId);
        if (!product) return line;
        changed = true;
        return {
          ...line,
          label: product.name,
          unit: product.priceUnit ?? '',
          unitPrice: product.unitPrice != null ? numberText(product.unitPrice) : '',
          vatCategory: product.vatCategory,
        };
      });
      if (changed) untracked(() => this.draft.update((d) => ({ ...d, lines: next })));
    });
  }

  public money(value: number): string {
    return formatMoney(value, this.rules().currency);
  }

  public percent(value: number): string {
    return percentText(value);
  }

  public add(): void {
    const line = emptyLine();
    this._seen.set(line.key, '');
    this.draft.update((d) => ({ ...d, lines: [...d.lines, line] }));
  }

  public remove(index: number): void {
    this.draft.update((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== index) }));
  }
}
