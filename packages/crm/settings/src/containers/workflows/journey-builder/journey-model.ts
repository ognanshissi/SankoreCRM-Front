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

/**
 * Ce que le moteur fait aujourd'hui de chaque type — à dire dans l'écran plutôt que de le laisser
 * découvrir sur un dossier arrêté. `blocked` : refusé à la publication (le serveur refuse aussi
 * l'activation, `StepKinds.BlocksActivation`) parce que l'étape arrêterait le dossier. `approvalOnly` :
 * le responsable approuve l'étape, rien de plus.
 */
export const STEP_KIND_SUPPORT: Partial<Record<StepKind, 'blocked' | 'approvalOnly'>> = {
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
  /** Notification : à qui. Absent = la personne du dossier (étapes enregistrées avant ce champ). */
  recipients?: NotificationRecipient[];
  roleCodes?: string[];
  subject?: string;
  message?: string;
  /** Attente : l'événement interne attendu (code du catalogue). Le délai est alors un maximum. */
  eventCode?: string;
  /** Condition : une comparaison sur un fait du dossier, au format du `ConditionEvaluator` serveur. */
  condition?: ConditionLeaf;
  /** Formulaire : les champs du dossier à remplir avant que l'étape puisse être approuvée. */
  fields?: string[];
}

export interface ConditionLeaf {
  nodeType: 'leaf';
  field: string;
  operator: string;
  value?: string;
}

/** Un fait du dossier qu'une condition peut comparer (`GET workflow/templates/condition-fields`). */
export interface ConditionFieldOption {
  key: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[] | null;
}

const OPERATORS: Record<string, { value: string; label: string; symbol: string }> = {
  eq: { value: 'eq', label: 'est égal à', symbol: '=' },
  noteq: { value: 'noteq', label: 'est différent de', symbol: '≠' },
  gt: { value: 'gt', label: 'est supérieur à', symbol: '>' },
  gte: { value: 'gte', label: 'est supérieur ou égal à', symbol: '≥' },
  lt: { value: 'lt', label: 'est inférieur à', symbol: '<' },
  lte: { value: 'lte', label: 'est inférieur ou égal à', symbol: '≤' },
  contains: { value: 'contains', label: 'contient', symbol: 'contient' },
  isempty: { value: 'isempty', label: 'est vide', symbol: 'est vide' },
  isnotempty: { value: 'isnotempty', label: 'est renseigné', symbol: 'est renseigné' },
};

/** Les opérateurs qui ont un sens pour ce type de fait. */
export function conditionOperators(type: string | undefined): { value: string; label: string }[] {
  const keys =
    type === 'number' ? ['eq', 'noteq', 'gt', 'gte', 'lt', 'lte']
    : type === 'choice' || type === 'boolean' ? ['eq', 'noteq']
    : ['eq', 'noteq', 'contains', 'isempty', 'isnotempty'];
  return keys.map((k) => ({ value: OPERATORS[k].value, label: OPERATORS[k].label }));
}

export function operatorNeedsValue(operator: string | undefined): boolean {
  return operator !== 'isempty' && operator !== 'isnotempty';
}

/** « Score du lead ≥ 60 », pour la carte du canevas. */
export function conditionSummary(condition: ConditionLeaf | undefined, fields: ConditionFieldOption[]): string | null {
  if (!condition?.field) return null;
  const field = fields.find((f) => f.key === condition.field);
  const op = OPERATORS[condition.operator?.toLowerCase()];
  const value =
    field?.type === 'boolean' ? (condition.value === 'true' ? 'oui' : 'non')
    : field?.options?.find((o) => o.value === condition.value)?.label ?? condition.value ?? '';
  return [field?.label ?? condition.field, op?.symbol ?? condition.operator, operatorNeedsValue(condition.operator) ? value : '']
    .filter(Boolean)
    .join(' ');
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

// ——— Notification ———
// Les mêmes chaînes que `WorkflowNotificationRecipients` côté serveur, qui les lit dans la configuration.

export type NotificationRecipient = 'subject' | 'assignedAgent' | 'role';

/** Le serveur lit une liste ABSENTE comme « la personne du dossier » : l'écran fait de même. */
export function notificationRecipients(config: StepConfig): NotificationRecipient[] {
  return config.recipients ?? ['subject'];
}

/** Variables du message, remplacées à l'envoi par `WorkflowNotificationText` (serveur). */
export const NOTIFICATION_VARIABLES = [
  { key: 'prenom', label: 'Prénom', sample: 'Awa' },
  { key: 'nom', label: 'Nom', sample: 'Ndiaye' },
  { key: 'agent', label: 'Agent', sample: 'Koffi Yao' },
  { key: 'produit', label: 'Produit', sample: 'Crédit individuel' },
  { key: 'institution', label: 'Institution', sample: 'Votre institution' },
] as const;

/** L'aperçu : la règle du serveur — variable connue remplacée, inconnue laissée telle quelle. */
export function renderNotificationPreview(text: string): string {
  return text
    .replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, (match, name: string) =>
      NOTIFICATION_VARIABLES.find((v) => v.key === name.toLowerCase())?.sample ?? match)
    .trim();
}

/** Les variables tapées que le serveur ne connaît pas : elles partiraient telles quelles. */
export function unknownVariables(text: string): string[] {
  const names = [...text.matchAll(/\{\{\s*([A-Za-z_]+)\s*\}\}/g)].map((m) => m[1]);
  return [...new Set(names.filter((n) => !NOTIFICATION_VARIABLES.some((v) => v.key === n.toLowerCase())))];
}

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENSION = '^{}\\[~]|€\f';

/**
 * Segments facturés d'un SMS — le calcul de `SmsSegments` côté serveur. Un seul caractère hors
 * GSM-7 (un « œ », un emoji) fait passer tout le message en UCS-2 : 70 caractères au lieu de 160.
 * « é » est bien en GSM-7, « ê » ne l'est pas.
 */
export function smsSegments(text: string): { segments: number; length: number; perSegment: number; unicode: boolean } {
  let septets = 0;
  let unicode = false;
  for (const char of text) {
    if (GSM7_BASIC.includes(char)) septets += 1;
    else if (GSM7_EXTENSION.includes(char)) septets += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    const units = text.length; // UTF-16 : un emoji compte pour deux
    return { segments: units <= 70 ? 1 : Math.ceil(units / 67), length: units, perSegment: units <= 70 ? 70 : 67, unicode };
  }
  return { segments: septets <= 160 ? 1 : Math.ceil(septets / 153), length: septets, perSegment: septets <= 160 ? 160 : 153, unicode };
}

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
 * Événements proposés dans la palette. `LEAD_CAPTURED` est émis par la capture, `lead.qualified`
 * par le catalogue des événements internes. L'ancien `LEAD_QUALIFIED` n'était publié par rien et le
 * serveur le refuse désormais.
 */
export const TRIGGER_PRESETS: TriggerPreset[] = [
  { eventName: 'lead.qualified', label: 'Lead qualifié (SQL)', hint: 'Passage en SQL' },
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
 * `branch`. Le moteur évalue la condition quand le dossier l'atteint et ignore les étapes de l'autre
 * branche (`ConditionStepConsumer`).
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

/**
 * Ce qui empêche de publier, vérifié avant l'appel plutôt que découvert dans un 400.
 *
 * Un circuit Projet (`Opportunity`) n'a pas besoin de déclencheur : c'est l'étape du gabarit de
 * projet qui le lance quand le projet l'atteint. L'exiger empêchait de publier tout circuit Projet.
 */
export function validateJourney(steps: WorkflowStepDto[], triggers: TriggerDto[], entityType?: string | null): JourneyIssue[] {
  const issues: JourneyIssue[] = [];
  if (!triggers.length && entityType !== 'Opportunity') issues.push({ label: 'Aucun déclencheur' });
  if (!steps.length) issues.push({ label: 'Aucune étape' });
  for (const step of steps) {
    const kind = stepKind(step);
    if (hasAssignee(kind) && !step.approverRoleCode) issues.push({ label: `« ${step.name} » n'a pas de responsable` });
    if (kind === StepKind.Form && !parseStepConfig(step.configJson).fields?.length)
      issues.push({ label: `« ${step.name} » : choisissez les champs à remplir` });
    if (kind === StepKind.Condition) {
      const condition = parseStepConfig(step.configJson).condition;
      if (!condition?.field) issues.push({ label: `« ${step.name} » n'a pas de condition` });
      else if (operatorNeedsValue(condition.operator) && !condition.value?.toString().trim())
        issues.push({ label: `« ${step.name} » compare à une valeur vide` });
    }
    if (kind === StepKind.Wait && !step.timeoutHours && !parseStepConfig(step.configJson).eventCode)
      issues.push({ label: `« ${step.name} » n'attend ni délai ni événement` });
    if (STEP_KIND_SUPPORT[kind] === 'blocked')
      issues.push({ label: `« ${step.name} » : ce type d'étape n'est pas encore exécuté par le moteur` });
    if (kind === StepKind.Notification) {
      const config = parseStepConfig(step.configJson);
      const recipients = notificationRecipients(config);
      if (!recipients.length) issues.push({ label: `« ${step.name} » n'a pas de destinataire` });
      else if (recipients.includes('role') && !config.roleCodes?.length) issues.push({ label: `« ${step.name} » : choisissez au moins un rôle` });
      if (!config.message?.trim()) issues.push({ label: `« ${step.name} » n'a pas de message` });
    }
  }
  return issues;
}
