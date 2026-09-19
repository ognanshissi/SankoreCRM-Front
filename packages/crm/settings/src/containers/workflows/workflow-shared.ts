import { Severity } from '@talisoft/ui/tag';
import {
  AddActionRequestActionTypeEnum,
  AddRuleRequestOperatorEnum,
  AddRuleRequestRuleTypeEnum,
  AddTriggerRequestTriggerTypeEnum,
} from '@sankore/crm-api';

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

export const TRIGGER_TYPE_OPTIONS: { label: string; value: AddTriggerRequestTriggerTypeEnum }[] = [
  { label: 'Événement entité', value: AddTriggerRequestTriggerTypeEnum.EntityEvent },
  { label: 'Planifié', value: AddTriggerRequestTriggerTypeEnum.Schedule },
  { label: 'Événement externe', value: AddTriggerRequestTriggerTypeEnum.ExternalEvent },
];

export function triggerTypeLabel(type: AddTriggerRequestTriggerTypeEnum | string | null | undefined): string {
  return TRIGGER_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type ?? '—');
}

// ─── Action types ─────────────────────────────────────────────────────────────

export const ACTION_TYPE_OPTIONS: { label: string; value: AddActionRequestActionTypeEnum }[] = [
  { label: 'Assigner un utilisateur', value: AddActionRequestActionTypeEnum.AssignUser },
  { label: 'Round Robin', value: AddActionRequestActionTypeEnum.AssignRoundRobin },
  { label: 'Notification', value: AddActionRequestActionTypeEnum.SendNotification },
  { label: 'Créer une tâche', value: AddActionRequestActionTypeEnum.CreateTask },
  { label: 'Webhook', value: AddActionRequestActionTypeEnum.CallWebhook },
  { label: 'Publier un événement', value: AddActionRequestActionTypeEnum.PublishEvent },
  { label: 'Sous-workflow', value: AddActionRequestActionTypeEnum.StartChildWorkflow },
];

export function actionTypeLabel(type: AddActionRequestActionTypeEnum | string | null | undefined): string {
  return ACTION_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type ?? '—');
}

// ─── Rule types & operators ───────────────────────────────────────────────────

export const RULE_TYPE_OPTIONS: { label: string; value: AddRuleRequestRuleTypeEnum }[] = [
  { label: 'Ignorer si', value: AddRuleRequestRuleTypeEnum.SkipIf },
  { label: 'Auto-approuver si', value: AddRuleRequestRuleTypeEnum.AutoApproveIf },
  { label: 'Requis si', value: AddRuleRequestRuleTypeEnum.RequireIf },
];

export const RULE_OPERATOR_OPTIONS: { label: string; value: AddRuleRequestOperatorEnum }[] = [
  { label: 'Égal à', value: AddRuleRequestOperatorEnum.Eq },
  { label: 'Différent de', value: AddRuleRequestOperatorEnum.NotEq },
  { label: 'Inférieur à', value: AddRuleRequestOperatorEnum.Lt },
  { label: 'Inférieur ou égal à', value: AddRuleRequestOperatorEnum.Lte },
  { label: 'Supérieur à', value: AddRuleRequestOperatorEnum.Gt },
  { label: 'Supérieur ou égal à', value: AddRuleRequestOperatorEnum.Gte },
  { label: 'Contient', value: AddRuleRequestOperatorEnum.Contains },
  { label: 'Dans la liste', value: AddRuleRequestOperatorEnum.In },
  { label: 'Hors liste', value: AddRuleRequestOperatorEnum.NotIn },
  { label: 'Est vide', value: AddRuleRequestOperatorEnum.IsEmpty },
  { label: "N'est pas vide", value: AddRuleRequestOperatorEnum.IsNotEmpty },
  { label: 'Entre', value: AddRuleRequestOperatorEnum.Between },
];

/** Operators that don't require a value field */
export const NO_VALUE_OPERATORS = [AddRuleRequestOperatorEnum.IsEmpty, AddRuleRequestOperatorEnum.IsNotEmpty];

export function ruleTypeLabel(type: AddRuleRequestRuleTypeEnum | string | null | undefined): string {
  return RULE_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? String(type ?? '—');
}

export function ruleOperatorLabel(op: AddRuleRequestOperatorEnum | string | null | undefined): string {
  return RULE_OPERATOR_OPTIONS.find((o) => o.value === op)?.label ?? String(op ?? '—');
}
