import {
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
