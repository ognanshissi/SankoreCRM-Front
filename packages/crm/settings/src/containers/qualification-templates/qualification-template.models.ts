import {
  ProductDtoCategoryEnum,
  QuestionInputTypeEnum,
  RuleInputActionEnum,
} from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';
import { productCategoryLabel } from '@sankore/crm/common';

// Re-export for existing consumers

// ——— Editable models ———

export interface EditableQuestion {
  _uid: string;
  label: string;
  type: QuestionInputTypeEnum;
  weight: number;
  isRequired: boolean;
  options: string;
  helpText: string;
  placeholderText: string;
  minValue: number | null;
  maxValue: number | null;
  sectionIndex: number;
  expanded: boolean;
  rules: EditableRule[];
  /**
   * BNF-F-16 — question non médicale, réutilisable pour pré-remplir un autre
   * questionnaire. `QuestionInput` ne porte ni `isShareable` ni `isMedical` au
   * contrat : la valeur ne vit qu'en mémoire, le temps que l'API l'expose.
   */
  isShareable: boolean;
}

export interface EditableRule {
  triggerQuestionUid: string;
  triggerValue: string;
  action: RuleInputActionEnum;
}

export interface EditableSection {
  _uid: string;
  title: string;
  description: string;
}

let _uidCounter = 0;
export function uid(): string { return '__q' + (++_uidCounter); }

// ——— Constants ———

export const QUESTION_TYPE_OPTIONS = [
  { label: 'Oui/Non',          value: QuestionInputTypeEnum.YesNo },
  { label: 'Choix unique',     value: QuestionInputTypeEnum.SingleChoice },
  { label: 'Choix multiple',   value: QuestionInputTypeEnum.MultiChoice },
  { label: 'Numérique',        value: QuestionInputTypeEnum.Numeric },
  { label: 'Texte libre',      value: QuestionInputTypeEnum.Text },
];

/**
 * BNF-F-16 — « S'applique à ». Aucun champ de portée n'existe au contrat :
 * ni `appliesTo` ni `scope` sur `QualificationTemplateDto`,
 * `CreateQualificationTemplateRequest` ou `UpdateQualificationTemplateRequest`.
 * Les codes proposés suivent la nomenclature du foyer déjà utilisée par le
 * socle (principal / conjoint / enfants) et restent à confirmer côté back.
 */
export const APPLIES_TO_OPTIONS = [
  { label: 'Lead', value: 'Lead' },
  { label: 'Chaque assuré', value: 'EachInsured' },
  { label: 'Principal seulement', value: 'PrincipalOnly' },
  { label: 'Conjoint seulement', value: 'SpouseOnly' },
  { label: 'Enfants seulement', value: 'ChildrenOnly' },
];

/**
 * Catégories d'assurance de l'enum `ProductDtoCategoryEnum` : un questionnaire
 * santé n'est proposé que pour celles-ci (BNF-F-14 et BNF-F-16).
 */
export const INSURANCE_PRODUCT_CATEGORIES: string[] = [
  ProductDtoCategoryEnum.Insurance,
  ProductDtoCategoryEnum.HealthInsurance,
  ProductDtoCategoryEnum.ForecastInsurance,
];

export function isInsuranceCategory(
  category: string | null | undefined,
): boolean {
  return !!category && INSURANCE_PRODUCT_CATEGORIES.includes(category);
}

export const RULE_ACTION_OPTIONS = [
  { label: 'Afficher',      value: RuleInputActionEnum.Show },
  { label: 'Masquer',       value: RuleInputActionEnum.Hide },
  { label: 'Rendre requis', value: RuleInputActionEnum.Require },
];

export function statusSeverity(status: string | null | undefined): Severity {
  switch (status) {
    case 'Published': return 'success';
    case 'Draft':     return 'warning';
    case 'Archived':  return 'neutral';
    default:          return 'neutral';
  }
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'Published': return 'Publiée';
    case 'Draft':     return 'Brouillon';
    case 'Archived':  return 'Archivée';
    default:          return status ?? '—';
  }
}

export function productLabel(type: string | null | undefined): string {
  return productCategoryLabel(type);
}

export function questionTypeLabel(type: string): string {
  return QUESTION_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;
}

/**
 * Les versions d'un formulaire (propriétaire, 2026-10-27) : tous les formulaires d'un même produit
 * — ou d'une même famille quand aucun produit n'est précisé — sont les versions l'un de l'autre.
 * Un formulaire en est rarement la suite par duplication : on en refait aussi de zéro.
 */
export function qualificationScopeKey(t: { productCategory?: string | null; productCode?: string | null }): string {
  return `${t.productCategory ?? ''}|${(t.productCode ?? '').trim().toUpperCase()}`;
}

/**
 * Le numéro de chaque formulaire publié au moins une fois, dans l'ordre de publication de son
 * produit : 1 pour le premier publié, 2 pour le suivant… Le compteur propre à un formulaire
 * (`version`) ne sert pas ici : chaque nouvelle version est un formulaire à part, qui repart à 1.
 * Un brouillon jamais publié n'a pas de numéro.
 */
export function productVersionNumbers(
  templates: readonly { id?: string; productCategory?: string | null; productCode?: string | null; publishedAt?: string | null }[],
): Map<string, number> {
  const numbers = new Map<string, number>();
  const byScope = new Map<string, typeof templates[number][]>();
  for (const t of templates) {
    if (!t.id || !t.publishedAt) continue;
    const key = qualificationScopeKey(t);
    byScope.set(key, [...(byScope.get(key) ?? []), t]);
  }
  for (const list of byScope.values()) {
    [...list]
      .sort((a, b) => Date.parse(a.publishedAt!) - Date.parse(b.publishedAt!))
      .forEach((t, i) => numbers.set(t.id!, i + 1));
  }
  return numbers;
}
