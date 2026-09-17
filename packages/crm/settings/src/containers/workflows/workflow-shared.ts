import { Severity } from '@talisoft/ui/tag';
import { ActionType, RuleOperator, RuleType, TriggerType } from '@sankore/crm-api';

/**
 * `entityType` and `status` come back from the API as free strings (no
 * generated enum) — these helpers centralise the label/severity mapping so
 * the list and detail pages stay in sync.
 */

export const ENTITY_TYPE_OPTIONS = [
  { label: 'Lead', value: 'Lead' },
  { label: 'Contact', value: 'Contact' },
  { label: 'Opportunité', value: 'Deal' },
  { label: 'Client', value: 'Account' },
];

export function entityTypeLabel(entityType: string | null | undefined): string {
  return ENTITY_TYPE_OPTIONS.find((o) => o.value === entityType)?.label ?? entityType ?? '—';
}

interface StatusMeta {
  label: string;
  severity: Severity;
}

const INSTANCE_STATUS_META: Record<string, StatusMeta> = {
  InProgress: { label: 'En cours', severity: 'warning' },
  Approved: { label: 'Approuvé', severity: 'success' },
  Rejected: { label: 'Rejeté', severity: 'error' },
  Cancelled: { label: 'Annulé', severity: 'neutral' },
};

export function instanceStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && INSTANCE_STATUS_META[status]) || { label: status ?? '—', severity: 'neutral' };
}

const STEP_STATUS_META: Record<string, StatusMeta> = {
  Pending: { label: 'En attente', severity: 'warning' },
  Approved: { label: 'Approuvée', severity: 'success' },
  Rejected: { label: 'Rejetée', severity: 'error' },
  Skipped: { label: 'Ignorée', severity: 'neutral' },
};

export function stepStatusMeta(status: string | null | undefined): StatusMeta {
  return (status && STEP_STATUS_META[status]) || { label: status ?? '—', severity: 'neutral' };
}

// ─── Trigger types ────────────────────────────────────────────────────────────

export const TRIGGER_TYPE_OPTIONS: { label: string; value: TriggerType }[] = [
  { label: 'Manuel', value: TriggerType.NUMBER_0 },
  { label: 'Événement', value: TriggerType.NUMBER_1 },
  { label: 'Planifié', value: TriggerType.NUMBER_2 },
];

export function triggerTypeLabel(type: TriggerType | null | undefined): string {
  return TRIGGER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type ?? '—');
}

// ─── Action types ─────────────────────────────────────────────────────────────

export const ACTION_TYPE_OPTIONS: { label: string; value: ActionType }[] = [
  { label: 'Email', value: ActionType.NUMBER_0 },
  { label: 'Webhook', value: ActionType.NUMBER_1 },
  { label: 'Notification', value: ActionType.NUMBER_2 },
  { label: 'Assignation', value: ActionType.NUMBER_3 },
  { label: 'Mise à jour champ', value: ActionType.NUMBER_4 },
  { label: 'Création de tâche', value: ActionType.NUMBER_5 },
  { label: 'Script', value: ActionType.NUMBER_6 },
];

export function actionTypeLabel(type: ActionType | null | undefined): string {
  return ACTION_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type ?? '—');
}

// ─── Rule types & operators ───────────────────────────────────────────────────

export const RULE_TYPE_OPTIONS: { label: string; value: RuleType }[] = [
  { label: 'Pré-condition', value: RuleType.NUMBER_0 },
  { label: 'Post-condition', value: RuleType.NUMBER_1 },
  { label: 'Validation', value: RuleType.NUMBER_2 },
];

export const RULE_OPERATOR_OPTIONS: { label: string; value: RuleOperator }[] = [
  { label: 'Égal à', value: RuleOperator.NUMBER_0 },
  { label: 'Différent de', value: RuleOperator.NUMBER_1 },
  { label: 'Inférieur à', value: RuleOperator.NUMBER_2 },
  { label: 'Inférieur ou égal à', value: RuleOperator.NUMBER_3 },
  { label: 'Supérieur à', value: RuleOperator.NUMBER_4 },
  { label: 'Supérieur ou égal à', value: RuleOperator.NUMBER_5 },
  { label: 'Contient', value: RuleOperator.NUMBER_6 },
  { label: 'Ne contient pas', value: RuleOperator.NUMBER_7 },
  { label: 'Commence par', value: RuleOperator.NUMBER_8 },
  { label: 'Finit par', value: RuleOperator.NUMBER_9 },
  { label: 'Est vide', value: RuleOperator.NUMBER_10 },
  { label: "N'est pas vide", value: RuleOperator.NUMBER_11 },
];

/** Operators that don't require a value field */
export const NO_VALUE_OPERATORS = [RuleOperator.NUMBER_10, RuleOperator.NUMBER_11];

export function ruleTypeLabel(type: RuleType | null | undefined): string {
  return RULE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type ?? '—');
}

export function ruleOperatorLabel(op: RuleOperator | null | undefined): string {
  return RULE_OPERATOR_OPTIONS.find((o) => o.value === op)?.label ?? String(op ?? '—');
}
