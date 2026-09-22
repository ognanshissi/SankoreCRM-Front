import { Injectable } from '@angular/core';
import {
  CreateProductRequestCategoryEnum,
  ProductDtoCategoryEnum,
} from '@sankore/crm-api';

// ——— Product Type Labels (string keys used by leads) ———

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  Loan: 'Prêt',
  Savings: 'Épargne',
  Insurance: 'Assurance',
  HealthInsurance: 'Assurance santé',
  ForecastInsurance: 'Assurance prévoyance',
  Tontine: 'Tontine',
  GroupCredit: 'Crédit groupe',
  Agriculture: 'Agriculture',
};

// ——— Product Categories ———

export const PRODUCT_CATEGORY_OPTIONS: { label: string; value: ProductDtoCategoryEnum }[] = [
  { label: 'Prêt',                  value: ProductDtoCategoryEnum.Loan },
  { label: 'Épargne',               value: ProductDtoCategoryEnum.Savings },
  { label: 'Assurance',             value: ProductDtoCategoryEnum.Insurance },
  { label: 'Assurance santé',       value: ProductDtoCategoryEnum.HealthInsurance },
  { label: 'Assurance prévoyance',  value: ProductDtoCategoryEnum.ForecastInsurance },
  { label: 'Tontine',               value: ProductDtoCategoryEnum.Tontine },
  { label: 'Crédit groupe',         value: ProductDtoCategoryEnum.GroupCredit },
  { label: 'Agriculture',           value: ProductDtoCategoryEnum.Agriculture },
];

export const PRODUCT_CATEGORY_LABELS: Record<string, string> = {
  [ProductDtoCategoryEnum.Loan]: 'Prêt',
  [ProductDtoCategoryEnum.Savings]: 'Épargne',
  [ProductDtoCategoryEnum.Insurance]: 'Assurance',
  [ProductDtoCategoryEnum.HealthInsurance]: 'Assurance santé',
  [ProductDtoCategoryEnum.ForecastInsurance]: 'Assurance prévoyance',
  [ProductDtoCategoryEnum.Tontine]: 'Tontine',
  [ProductDtoCategoryEnum.GroupCredit]: 'Crédit groupe',
  [ProductDtoCategoryEnum.Agriculture]: 'Agriculture',
};

export function productCategoryLabel(category: string | null | undefined): string {
  if (!category) return '—';
  return PRODUCT_CATEGORY_LABELS[category] ?? category;
}

// ——— Injectable service ———

@Injectable({ providedIn: 'root' })
export class ProductConfigService {
  public readonly categories: { label: string; value: CreateProductRequestCategoryEnum }[] = [
    { label: 'Prêt',                  value: CreateProductRequestCategoryEnum.Loan },
    { label: 'Épargne',               value: CreateProductRequestCategoryEnum.Savings },
    { label: 'Assurance',             value: CreateProductRequestCategoryEnum.Insurance },
    { label: 'Assurance santé',       value: CreateProductRequestCategoryEnum.HealthInsurance },
    { label: 'Assurance prévoyance',  value: CreateProductRequestCategoryEnum.ForecastInsurance },
    { label: 'Tontine',               value: CreateProductRequestCategoryEnum.Tontine },
    { label: 'Crédit groupe',         value: CreateProductRequestCategoryEnum.GroupCredit },
    { label: 'Agriculture',           value: CreateProductRequestCategoryEnum.Agriculture },
  ];
}
