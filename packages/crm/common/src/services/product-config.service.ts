import { Injectable } from '@angular/core';
import {
  CreateProductRequestCategoryEnum,
  ProductDtoCategoryEnum,
} from '@sankore/crm-api';

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  Loan: 'Prêt',
  Savings: 'Épargne',
  GroupCredit: 'Crédit groupe',
  Tontine: 'Tontine',
  Agriculture: 'Agriculture',
};

// ——— Product Categories ———
export const PRODUCT_CATEGORY_OPTIONS = [
  { label: 'Prêt',    value: ProductDtoCategoryEnum.Loan },
  { label: 'Épargne', value: ProductDtoCategoryEnum.Savings },
  { label: 'Tontine', value: ProductDtoCategoryEnum.Tontine },
];

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  [ProductDtoCategoryEnum.Loan]: 'Prêt',
  [ProductDtoCategoryEnum.Savings]: 'Épargne',
  [ProductDtoCategoryEnum.Tontine]: 'Tontine',
};

export function productCategoryLabel(category: string | null | undefined): string {
  if (!category) return '—';
  return PRODUCT_CATEGORY_LABELS[category] ?? category;
}

// ——— Injectable service ———

@Injectable({ providedIn: 'root' })
export class ProductConfigService {
  public readonly categories: { label: string; value: CreateProductRequestCategoryEnum }[] = [
    { label: 'Prêt', value: CreateProductRequestCategoryEnum.Loan },
    { label: 'Épargne', value: CreateProductRequestCategoryEnum.Savings },
    { label: 'Tontine', value: CreateProductRequestCategoryEnum.Tontine },
  ];
}
