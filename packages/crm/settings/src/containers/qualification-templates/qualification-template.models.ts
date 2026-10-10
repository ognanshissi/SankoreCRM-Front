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
