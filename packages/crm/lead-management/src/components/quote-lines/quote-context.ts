import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { CompanyInfoApiService, ProductsApiService } from '@sankore/crm-api';
import { TenantProvider } from '@sankore/crm/common';
import { CatalogueProduct, QuoteRules, QuoteVatCategory } from './quote-lines.models';

/**
 * Ce que l'éditeur de lignes lit une fois : les produits Standard actifs, avec leur prix, et les
 * taux et le plafond de l'institution. À appeler dans un contexte d'injection.
 */
export function quoteContext() {
  const products = inject(ProductsApiService);
  const company = inject(CompanyInfoApiService);
  const currency = inject(TenantProvider).currency;

  const catalogue = toSignal(
    products.listProducts(true, 'Standard').pipe(
      map((list) =>
        (list ?? []).map<CatalogueProduct>((p) => ({
          id: p.id!, code: p.code ?? '', name: p.name ?? p.code ?? '',
          unitPrice: p.unitPrice ?? null, priceUnit: p.priceUnit ?? null,
          vatCategory: (p.vatCategory as QuoteVatCategory | undefined) ?? 'Standard',
        })),
      ),
      catchError(() => of([] as CatalogueProduct[])),
    ),
    { initialValue: [] as CatalogueProduct[] },
  );
  const pricing = toSignal(company.getPricingRules().pipe(catchError(() => of(null))), { initialValue: null });

  const rules = computed<QuoteRules>(() => ({
    currency: currency() || 'XOF',
    standardRate: pricing()?.vatStandardRate ?? 18,
    reducedRate: pricing()?.vatReducedRate ?? 9,
    ceiling: pricing()?.maxDiscountPercent ?? null,
  }));
  return { catalogue, rules };
}
