import { AddStepRequestKindEnum, TriggerDto, WorkflowStepDto } from '@sankore/crm-api';

/**
 * Modèle du constructeur de parcours.
 *
 * Le serveur stocke une liste d'étapes ordonnées ; chacune porte un `kind` et une configuration
 * JSON libre (`configJson`). Ce fichier est le seul à connaître la forme de cette configuration :
 * le panneau et le canevas passent par `parseStepConfig` / `serializeStepConfig`, pour qu'une clé
 * renommée ne laisse pas une moitié de l'écran lire l'ancienne.
 */

export type StepKind = AddStepRequestKindEnum;
export const StepKind = AddStepRequestKindEnum;

export interface StepKindMeta {
  label: string;
  hint: string;
  icon: string;
  group: 'steps' | 'logic' | 'actions';
}

export const STEP_KIND_META: Record<StepKind, StepKindMeta> = {
  Form:              { label: 'Formulaire',                 hint: 'Saisie ou enrichissement', icon: 'feather:users',        group: 'steps' },
  QualificationForm: { label: 'Formulaire de qualification', hint: 'Questionnaire par personne', icon: 'feather:clipboard',   group: 'steps' },
  KycCheck:          { label: 'Vérification KYC',           hint: 'Simplifié ou complet',     icon: 'feather:shield',       group: 'steps' },
  Validation:        { label: 'Validation',                 hint: 'Par un rôle',              icon: 'feather:check-circle', group: 'steps' },
  ManualTask:        { label: 'Tâche manuelle',             hint: 'Appel, rendez-vous',       icon: 'feather:phone',        group: 'steps' },
  Condition:         { label: 'Condition',                  hint: 'Deux branches',            icon: 'feather:git-branch',   group: 'logic' },
  Wait:              { label: 'Attente',                    hint: 'Délai ou événement',       icon: 'feather:clock',        group: 'logic' },
  Notification:      { label: 'Notification',               hint: 'Email, SMS',               icon: 'feather:bell',         group: 'actions' },
  IntegrationAction: { label: 'Action Integration',         hint: 'CBS ou assurance',         icon: 'feather:send',         group: 'actions' },
};

export const PALETTE_GROUPS: { label: string; group: StepKindMeta['group'] }[] = [
  { label: 'Étapes', group: 'steps' },
  { label: 'Logique', group: 'logic' },
  { label: 'Actions', group: 'actions' },
];

export function kindsOf(group: StepKindMeta['group']): StepKind[] {
  return (Object.keys(STEP_KIND_META) as StepKind[]).filter((k) => STEP_KIND_META[k].group === group);
}

/** Une étape enregistrée avant le constructeur n'a pas de `kind` : c'est une validation, comme le moteur l'exécute. */
export function stepKind(step: WorkflowStepDto): StepKind {
  return (Object.values(StepKind) as string[]).includes(step.kind ?? '')
    ? (step.kind as StepKind)
    : StepKind.Validation;
}

// ——— Configuration par type ———

export type KycLevel = 'Simplified' | 'Full';
export type Escalation = 'none' | 'supervisor' | 'supervisor_then_reassign' | 'reassign';
export type Branch = 'yes' | 'no';

export interface StepConfig {
  kycLevel?: KycLevel;
  escalation?: Escalation;
  /** Rang dans la condition qui précède : branche « Oui » ou « Non ». */
  branch?: Branch;
  channel?: 'Email' | 'Sms';
  target?: 'CoreBanking' | 'Insurance';
}

export function parseStepConfig(json: string | null | undefined): StepConfig {
  if (!json) return {};
  try {
    const value = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as StepConfig) : {};
  } catch {
    // Une configuration illisible ne doit pas empêcher d'ouvrir le parcours : elle repart à vide
    // et sera réécrite au prochain enregistrement.
    return {};
  }
}

export function serializeStepConfig(config: StepConfig): string {
  const clean = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined && v !== ''));
  // Chaîne vide plutôt que « {} » : c'est ce que le serveur lit comme « effacer ».
  return Object.keys(clean).length ? JSON.stringify(clean) : '';
}

export const KYC_LEVEL_OPTIONS = [
  { label: 'KYC simplifié', value: 'Simplified' },
  { label: 'KYC complet', value: 'Full' },
];

export const KYC_CONTROLS: Record<KycLevel, string[]> = {
  Simplified: ["Pièce d'identité", 'OCR et lecture MRZ'],
  Full: [
    "Pièce d'identité et selfie, correspondance faciale",
    'OCR et lecture MRZ',
    "Score de confiance affiché à l'agent",
  ],
};

export const ESCALATION_OPTIONS = [
  { label: 'Aucune', value: 'none' },
  { label: 'Superviseur', value: 'supervisor' },
  { label: 'Superviseur, puis réassignation', value: 'supervisor_then_reassign' },
  { label: 'Réassignation', value: 'reassign' },
];

export const SLA_OPTIONS = [4, 8, 24, 48, 72, 120].map((h) => ({ label: `${h} h`, value: String(h) }));

export const CHANNEL_OPTIONS = [
  { label: 'Email', value: 'Email' },
  { label: 'SMS', value: 'Sms' },
];

export const TARGET_OPTIONS = [
  { label: 'Core banking (CBS)', value: 'CoreBanking' },
  { label: 'Back office assurance', value: 'Insurance' },
];

/** Types dont l'étape est confiée à un rôle, avec un délai. */
export function hasAssignee(kind: StepKind): boolean {
  return kind !== StepKind.Condition && kind !== StepKind.Wait && kind !== StepKind.Notification && kind !== StepKind.IntegrationAction;
}

// ——— Déclencheurs ———

export interface TriggerPreset {
  eventName: string;
  label: string;
  hint: string;
}

/**
 * Événements proposés dans la palette. `LEAD_CAPTURED` est émis par la capture ; `LEAD_QUALIFIED`
 * est enregistré tel quel, et ne démarrera un parcours que lorsque le module Leads le publiera.
 */
export const TRIGGER_PRESETS: TriggerPreset[] = [
  { eventName: 'LEAD_QUALIFIED', label: 'Lead qualifié (SQL)', hint: 'Passage en SQL' },
  { eventName: 'LEAD_CAPTURED', label: 'Nouveau lead', hint: 'À la capture' },
];

export function triggerLabel(trigger: TriggerDto): string {
  return TRIGGER_PRESETS.find((p) => p.eventName === trigger.eventName)?.label ?? trigger.eventName ?? 'Déclencheur';
}

/**
 * Le filtre produit d'un déclencheur, au format du `ConditionEvaluator` serveur (nœud feuille,
 * énumérations en camelCase). Seule cette forme simple est lue ici ; une condition plus riche,
 * posée ailleurs, est laissée intacte et résumée comme « condition personnalisée ».
 */
export function productOfTrigger(trigger: TriggerDto | null): string | null {
  if (!trigger?.conditionJson) return null;
  try {
    const node = JSON.parse(trigger.conditionJson);
    return node?.nodeType?.toLowerCase() === 'leaf' && node.field === 'interestedProduct' ? String(node.value ?? '') : null;
  } catch {
    return null;
  }
}

export function productCondition(product: string): string | null {
  const value = product.trim();
  return value ? JSON.stringify({ nodeType: 'leaf', field: 'interestedProduct', operator: 'eq', value }) : null;
}

// ——— Mise en page du parcours ———

export type FlowRow =
  | { type: 'step'; step: WorkflowStepDto }
  | { type: 'branches'; condition: WorkflowStepDto; yes: WorkflowStepDto[]; no: WorkflowStepDto[] };

/**
 * Lignes du canevas. Une condition est suivie de ses branches : les étapes contiguës qui portent
 * `branch`. Le moteur exécute aujourd'hui toutes les étapes à la suite ; les branches décrivent le
 * parcours voulu, elles n'aiguillent pas encore le dossier.
 */
export function layoutFlow(steps: WorkflowStepDto[]): FlowRow[] {
  const sorted = [...steps].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const rows: FlowRow[] = [];
  let i = 0;
  while (i < sorted.length) {
    const step = sorted[i];
    if (stepKind(step) !== StepKind.Condition) {
      rows.push({ type: 'step', step });
      i++;
      continue;
    }
    const yes: WorkflowStepDto[] = [];
    const no: WorkflowStepDto[] = [];
    i++;
    while (i < sorted.length) {
      const branch = parseStepConfig(sorted[i].configJson).branch;
      if (branch === 'yes') yes.push(sorted[i]);
      else if (branch === 'no') no.push(sorted[i]);
      else break;
      i++;
    }
    rows.push({ type: 'branches', condition: step, yes, no });
  }
  return rows;
}

/** Dernier ordre occupé par une ligne : une insertion « après » cette ligne prend l'ordre suivant. */
export function lastOrderOf(row: FlowRow): number {
  if (row.type === 'step') return row.step.order ?? 0;
  return Math.max(row.condition.order ?? 0, ...row.yes.map((s) => s.order ?? 0), ...row.no.map((s) => s.order ?? 0));
}

/** Où insérer une étape : ordre visé, et branche éventuelle. */
export interface InsertSlot {
  order: number;
  branch?: Branch;
}

export interface JourneyIssue {
  label: string;
}

/** Ce qui empêche de publier, vérifié avant l'appel plutôt que découvert dans un 400. */
export function validateJourney(steps: WorkflowStepDto[], triggers: TriggerDto[]): JourneyIssue[] {
  const issues: JourneyIssue[] = [];
  if (!triggers.length) issues.push({ label: 'Aucun déclencheur' });
  if (!steps.length) issues.push({ label: 'Aucune étape' });
  for (const step of steps) {
    const kind = stepKind(step);
    if (hasAssignee(kind) && !step.approverRoleCode) issues.push({ label: `« ${step.name} » n'a pas de responsable` });
  }
  return issues;
}
