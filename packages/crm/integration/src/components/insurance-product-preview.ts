import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { InsuranceProductDto } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { TasTag } from '@talisoft/ui/tag';
import {
  CONNECTION_KIND_LABELS,
  ConnectionKind,
  INSURANCE_MIN_KYC_LEVEL_LABELS,
  INSURANCE_PERIODICITY_LABELS,
  INSURANCE_PRICING_MODE_LABELS,
  InsuranceMinKycLevel,
  InsurancePeriodicity,
  formatAmount,
  formatContractDate,
  notOfferableReasonLabel,
} from '../data-access/integration-referential';

/**
 * Le produit tel qu'un agent le voit au guichet.
 *
 * Autonome par construction : il ne prend qu'un `InsuranceProductDto` et n'injecte
 * rien, parce que le parcours de souscription (ASS-15) le réutilise tel quel. Les
 * conditions d'éligibilité y sont des phrases et non des champs techniques : au
 * guichet, « minAge 18 / maxAge 65 » ne se lit pas, « Réservé aux 18 à 65 ans » se lit.
 */
@Component({
  selector: 'insurance-product-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, TasTag],
  template: `
    <div class="rounded-lg border border-slate-200 bg-white">
      <div class="p-4 border-b border-slate-100">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-semibold text-slate-800">{{ title() }}</p>
            <p class="text-xs text-slate-500 mt-0.5">{{ insurerLine() }}</p>
            @if (product().insurerProductCode) {
              <p class="font-mono text-xs text-slate-400 mt-1">
                {{ product().insurerProductCode }}
              </p>
            }
          </div>
          <tas-tag [severity]="product().isOfferable ? 'success' : 'warning'">
            {{ offerabilityLabel() }}
          </tas-tag>
        </div>
        @if (product().description) {
          <p class="text-sm text-slate-600 mt-2">{{ product().description }}</p>
        }
      </div>

      @if (notOfferableLabels().length) {
        <div class="p-4 border-b border-slate-100">
          <tas-alert type="error">
            <p class="text-sm">Ce produit ne peut pas être proposé pour le moment.</p>
            <ul class="mt-1 text-sm list-disc pl-5">
              @for (reason of notOfferableLabels(); track reason) {
                <li>{{ reason }}</li>
              }
            </ul>
          </tas-alert>
        </div>
      }

      <div class="p-4 border-b border-slate-100">
        <p class="text-sm font-medium text-slate-700">Prime</p>
        <p class="text-sm text-slate-800 mt-1 tabular-nums">{{ premiumLine() }}</p>
        @if (insuredAmountLine()) {
          <p class="text-sm text-slate-600 mt-1 tabular-nums">{{ insuredAmountLine() }}</p>
        }
        @if (validityLine()) {
          <p class="text-xs text-slate-500 mt-2">{{ validityLine() }}</p>
        }
      </div>

      <div class="p-4 border-b border-slate-100">
        <p class="text-sm font-medium text-slate-700">Garanties</p>
        @if (guaranteeRows().length) {
          <div class="mt-2 divide-y divide-slate-100">
            @for (guarantee of guaranteeRows(); track guarantee.key) {
              <div class="py-2">
                <div class="flex items-baseline justify-between gap-3">
                  <span class="text-sm text-slate-800">{{ guarantee.label }}</span>
                  @if (guarantee.code) {
                    <span class="font-mono text-xs text-slate-400">{{ guarantee.code }}</span>
                  }
                </div>
                <p class="text-xs text-slate-500 mt-0.5 tabular-nums">{{ guarantee.terms }}</p>
              </div>
            }
          </div>
        } @else {
          <p class="text-sm text-slate-500 mt-1">
            Aucune garantie décrite. L'agent n'a rien à présenter au client sur ce point.
          </p>
        }
      </div>

      <div class="p-4">
        <p class="text-sm font-medium text-slate-700">Qui peut souscrire</p>
        @if (eligibilitySentences().length) {
          <ul class="mt-2 text-sm text-slate-700 list-disc pl-5">
            @for (sentence of eligibilitySentences(); track sentence) {
              <li>{{ sentence }}</li>
            }
          </ul>
        } @else {
          <p class="text-sm text-slate-600 mt-1">Ouvert à tous les clients, sans condition.</p>
        }
      </div>
    </div>
  `,
})
export class InsuranceProductPreview {
  public readonly product = input.required<InsuranceProductDto>();

  public readonly title = computed(() => this.product().name || 'Produit sans nom');

  public readonly insurerLine = computed(() => {
    const product = this.product();
    const insurer = product.connectionName || 'Assureur non nommé';
    const kind = product.connectionKind
      ? CONNECTION_KIND_LABELS[product.connectionKind as ConnectionKind]
      : null;
    return kind ? `Assuré par ${insurer} (${kind})` : `Assuré par ${insurer}`;
  });

  public readonly offerabilityLabel = computed(() =>
    this.product().isOfferable ? 'Proposable' : 'Non proposable',
  );

  public readonly notOfferableLabels = computed(() =>
    (this.product().notOfferableReasons ?? []).map((reason) => notOfferableReasonLabel(reason)),
  );

  /**
   * En tarif calculé, le montant du catalogue n'a pas de sens : la prime est demandée
   * à l'assureur à la souscription. L'afficher quand même ferait annoncer à l'agent un
   * prix que le devis contredira.
   */
  public readonly premiumLine = computed(() => {
    const product = this.product();
    const periodicity = product.periodicity
      ? INSURANCE_PERIODICITY_LABELS[product.periodicity as InsurancePeriodicity]
      : null;

    if (product.pricingMode === 'InsurerComputed') {
      return INSURANCE_PRICING_MODE_LABELS.InsurerComputed +
        ' — le tarif est demandé à l’assureur à la souscription.';
    }

    if (product.fixedPremiumAmount === null || product.fixedPremiumAmount === undefined) {
      return 'Tarif fixe non renseigné. Demandez à votre administrateur de le compléter.';
    }

    const amount = formatAmount(product.fixedPremiumAmount, product.currency);
    if (product.periodicity === 'Single') {
      return `${amount}, en une seule fois`;
    }
    return periodicity ? `${amount}, périodicité ${periodicity.toLowerCase()}` : amount;
  });

  public readonly insuredAmountLine = computed(() => {
    const product = this.product();
    if (product.insuredAmount === null || product.insuredAmount === undefined) return null;
    return `Capital assuré : ${formatAmount(product.insuredAmount, product.currency)}`;
  });

  public readonly validityLine = computed(() => {
    const product = this.product();
    if (!product.effectiveFrom) return null;
    const from = formatContractDate(product.effectiveFrom);
    return product.effectiveTo
      ? `En vigueur du ${from} au ${formatContractDate(product.effectiveTo)}`
      : `En vigueur depuis le ${from}`;
  });

  public readonly guaranteeRows = computed(() => {
    const product = this.product();
    return (product.guarantees ?? []).map((guarantee, index) => {
      const terms: string[] = [];
      if (guarantee.ceilingAmount !== null && guarantee.ceilingAmount !== undefined) {
        terms.push(`Plafond ${formatAmount(guarantee.ceilingAmount, product.currency)}`);
      }
      if (guarantee.deductible !== null && guarantee.deductible !== undefined) {
        terms.push(`Franchise ${formatAmount(guarantee.deductible, product.currency)}`);
      }
      return {
        key: guarantee.code || `garantie-${index}`,
        code: guarantee.code ?? '',
        label: guarantee.label || guarantee.code || 'Garantie',
        terms: terms.length ? terms.join(' · ') : 'Plafond et franchise non précisés',
      };
    });
  });

  public readonly eligibilitySentences = computed(() => {
    const product = this.product();
    const sentences: string[] = [];

    const min = product.minAge ?? null;
    const max = product.maxAge ?? null;
    if (min !== null && max !== null) {
      sentences.push(`Réservé aux ${min} à ${max} ans`);
    } else if (min !== null) {
      sentences.push(`À partir de ${min} ans`);
    } else if (max !== null) {
      sentences.push(`Jusqu'à ${max} ans`);
    }

    if (product.requiresCbsAccount) {
      sentences.push('Nécessite un compte au core banking');
    }
    if (product.requiresActiveLoan) {
      sentences.push('Nécessite un prêt en cours');
    }
    if (product.minKycLevel && product.minKycLevel !== 'None') {
      const level = INSURANCE_MIN_KYC_LEVEL_LABELS[product.minKycLevel as InsuranceMinKycLevel];
      sentences.push(`${level} requis`);
    }
    if (product.linkedCreditProductCode) {
      sentences.push(`Proposé avec le produit de crédit ${product.linkedCreditProductCode}`);
    }

    return sentences;
  });
}
