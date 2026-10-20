import {
  FormField as EntityFormField,
  FormFieldTypeEnum,
  FormSection,
} from '@sankore/crm-api';

/** Le paramètre de `GET/PUT forms/{entity}`, tel que le service généré le type. */
export type FormEntityKey = 'Lead' | 'Client' | 'Product';

export interface EntityTab {
  key: FormEntityKey;
  label: string;
  /** Le champ natif qui porte le type de l'enregistrement, sur lequel les conditions s'appuient. */
  kindField: string;
}

export const ENTITY_TABS: ReadonlyArray<EntityTab> = [
  { key: 'Lead', label: 'Leads', kindField: 'prospectType' },
  { key: 'Client', label: 'Clients', kindField: 'clientType' },
  { key: 'Product', label: 'Produits', kindField: 'category' },
];

export function entityTab(key: string | null | undefined): EntityTab {
  return ENTITY_TABS.find((t) => t.key === key) ?? ENTITY_TABS[0];
}

export const FIELD_TYPES: ReadonlyArray<{ value: FormFieldTypeEnum; label: string; icon: string }> = [
  { value: FormFieldTypeEnum.Text, label: 'Texte court', icon: 'feather:type' },
  { value: FormFieldTypeEnum.LongText, label: 'Texte long', icon: 'feather:align-left' },
  { value: FormFieldTypeEnum.Integer, label: 'Nombre entier', icon: 'feather:hash' },
  { value: FormFieldTypeEnum.Decimal, label: 'Nombre décimal', icon: 'feather:hash' },
  { value: FormFieldTypeEnum.Money, label: 'Montant', icon: 'feather:dollar-sign' },
  { value: FormFieldTypeEnum.Percent, label: 'Pourcentage', icon: 'feather:percent' },
  { value: FormFieldTypeEnum.Date, label: 'Date', icon: 'feather:calendar' },
  { value: FormFieldTypeEnum.DateTime, label: 'Date et heure', icon: 'feather:clock' },
  { value: FormFieldTypeEnum.Boolean, label: 'Oui / non', icon: 'feather:toggle-left' },
  { value: FormFieldTypeEnum.SingleChoice, label: 'Choix unique', icon: 'feather:list' },
  { value: FormFieldTypeEnum.MultiChoice, label: 'Choix multiple', icon: 'feather:check-square' },
  { value: FormFieldTypeEnum.Email, label: 'E-mail', icon: 'feather:mail' },
  { value: FormFieldTypeEnum.Phone, label: 'Téléphone', icon: 'feather:phone' },
  { value: FormFieldTypeEnum.Url, label: 'Lien web', icon: 'feather:link' },
  { value: FormFieldTypeEnum.Reference, label: 'Référence', icon: 'feather:link-2' },
];

/** Les types qu'un champ personnalisé peut prendre : la référence est réservée aux champs natifs. */
export const CUSTOM_FIELD_TYPES = FIELD_TYPES.filter((t) => t.value !== FormFieldTypeEnum.Reference);

export function fieldTypeLabel(type: FormFieldTypeEnum | undefined): string {
  return FIELD_TYPES.find((t) => t.value === type)?.label ?? '—';
}

export function fieldTypeIcon(type: FormFieldTypeEnum | undefined): string {
  return FIELD_TYPES.find((t) => t.value === type)?.icon ?? 'feather:square';
}

export const CHOICE_TYPES: ReadonlyArray<FormFieldTypeEnum> = [
  FormFieldTypeEnum.SingleChoice,
  FormFieldTypeEnum.MultiChoice,
];
export const NUMERIC_TYPES: ReadonlyArray<FormFieldTypeEnum> = [
  FormFieldTypeEnum.Integer,
  FormFieldTypeEnum.Decimal,
  FormFieldTypeEnum.Percent,
  FormFieldTypeEnum.Money,
];
export const TEXT_TYPES: ReadonlyArray<FormFieldTypeEnum> = [
  FormFieldTypeEnum.Text,
  FormFieldTypeEnum.LongText,
  FormFieldTypeEnum.Phone,
];
/** Ce sur quoi une condition peut porter : une valeur qu'on peut comparer à une liste. */
export const CONDITION_TARGET_TYPES: ReadonlyArray<FormFieldTypeEnum> = [
  ...CHOICE_TYPES,
  FormFieldTypeEnum.Boolean,
];

export const CUSTOM_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{1,49}$/;
export const SECTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_-]{0,49}$/;

/**
 * Un identifiant camelCase tiré d'un libellé (« Segment client » → `segmentClient`), sans accent ni
 * séparateur, et distinct de ceux déjà pris. Le serveur refuse tout le reste, et c'est sous cette
 * clé que les valeurs sont stockées : elle ne change plus une fois enregistrée.
 */
export function keyFromLabel(label: string, taken: ReadonlySet<string>, fallback = 'champ'): string {
  const words = label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  let base = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');

  if (!/^[a-z]/.test(base)) base = fallback + base.charAt(0).toUpperCase() + base.slice(1);
  if (base.length < 2) base = fallback;
  base = base.slice(0, 46);

  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${n}`;
  return key;
}

/** Les champs d'un groupe : une section, ou `''` pour les champs hors section. */
export function fieldsOfGroup(fields: ReadonlyArray<EntityFormField>, sectionKey: string): EntityFormField[] {
  return fields
    .filter((f) => (f.sectionKey ?? '') === sectionKey && !f.isArchived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function orderedSections(sections: ReadonlyArray<FormSection>): FormSection[] {
  return [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Vrai quand la condition est satisfaite pour la valeur du type choisie dans l'aperçu. Une
 * condition sur un autre champ que le type ne peut pas être évaluée sans saisie : l'aperçu affiche
 * le champ, marqué conditionnel, plutôt que de le cacher.
 */
export function conditionHolds(
  condition: EntityFormField['visibleWhen'] | FormSection['visibleWhen'] | null | undefined,
  kindField: string,
  kindValue: string,
): boolean {
  if (!condition?.fieldKey) return true;
  if (condition.fieldKey !== kindField) return true;
  return (condition.values ?? []).includes(kindValue);
}

// ── Les refus du serveur, traduits ───────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  FORM_VERSION_CONFLICT:
    'Le formulaire a été modifié entre-temps par une autre personne. Rechargez-le avant d’enregistrer.',
  FORM_TOO_MANY_SECTIONS: 'Un formulaire compte au plus 30 sections.',
  FORM_TOO_MANY_CUSTOM_FIELDS: 'Un formulaire compte au plus 150 champs personnalisés.',
  FORM_SECTION_KEY_INVALID: 'identifiant de section invalide.',
  FORM_SECTION_KEY_DUPLICATE: 'deux sections portent le même identifiant.',
  FORM_SECTION_TITLE_INVALID: 'le titre est obligatoire (100 caractères au plus).',
  FORM_FIELD_KEY_INVALID:
    'identifiant invalide : lettres et chiffres, en commençant par une minuscule (ex. segmentClient).',
  FORM_FIELD_KEY_DUPLICATE: 'deux champs portent le même identifiant.',
  FORM_FIELD_UNKNOWN_SECTION: 'la section de ce champ n’existe plus.',
  FORM_FIELD_LABEL_INVALID: 'le libellé est obligatoire (150 caractères au plus).',
  FORM_REQUIRED_FIELD_NOT_IN_QUICK_ADD: 'un champ obligatoire doit figurer dans la création rapide.',
  FORM_REQUIRED_FIELD_NOT_SHOWN: 'un champ obligatoire ne peut être ni masqué ni archivé.',
  FORM_FIELD_LOCKED:
    'ce champ est exigé par l’application : il reste obligatoire, visible et dans la création rapide.',
  FORM_NATIVE_FIELD_CANNOT_BE_ARCHIVED: 'un champ natif se masque, il ne s’archive pas.',
  FORM_FIELD_TYPE_NOT_SUPPORTED: 'ce type n’est pas disponible pour un champ personnalisé.',
  FORM_FIELD_HIDE_ONLY_NATIVE: 'un champ personnalisé s’archive, il ne se masque pas.',
  FORM_FIELD_OPTIONS_REQUIRED: 'un champ à choix doit proposer au moins une option.',
  FORM_FIELD_TOO_MANY_OPTIONS: 'un champ à choix propose au plus 200 options.',
  FORM_FIELD_OPTION_INVALID: 'chaque option doit avoir une valeur et un libellé.',
  FORM_FIELD_OPTION_DUPLICATE: 'deux options portent la même valeur.',
  FORM_FIELD_RANGE_NOT_APPLICABLE: 'un minimum ou un maximum ne s’applique qu’à un nombre ou un montant.',
  FORM_FIELD_RANGE_INVALID: 'le minimum dépasse le maximum.',
  FORM_FIELD_LENGTH_NOT_APPLICABLE: 'une longueur maximale ne s’applique qu’à un texte.',
  FORM_FIELD_LENGTH_INVALID: 'la longueur maximale doit être comprise entre 1 et 10 000.',
  FORM_FIELD_PATTERN_NOT_APPLICABLE: 'un format ne s’applique qu’à un texte.',
  FORM_FIELD_PATTERN_INVALID: 'le format (expression régulière) n’est pas valide.',
  FORM_FIELD_DEFAULT_INVALID: 'la valeur par défaut ne respecte pas les règles du champ.',
  FORM_FIELD_CANNOT_BE_REMOVED:
    'un champ enregistré ne se supprime pas, car des fiches peuvent déjà en contenir une valeur : archivez-le.',
  FORM_FIELD_TYPE_IMMUTABLE: 'le type d’un champ enregistré ne change plus.',
  FORM_CONDITION_INVALID: 'la condition d’affichage porte sur un champ ou une valeur qui n’existe pas.',
};

/**
 * Le refus du serveur (`CODE:clé`) en une phrase qui nomme le champ ou la section concernés, pour
 * que l'administrateur sache où regarder sans lire un identifiant.
 */
export function translateFormError(
  detail: string | null | undefined,
  fields: ReadonlyArray<EntityFormField>,
  sections: ReadonlyArray<FormSection>,
): string {
  if (!detail) return 'Enregistrement impossible, réessayez plus tard.';

  const [code, key] = detail.split(':', 2);
  const message = ERROR_MESSAGES[code];
  if (!message) return `Enregistrement refusé (${detail}).`;
  if (!key) return message.charAt(0).toUpperCase() + message.slice(1);

  const name =
    fields.find((f) => f.key === key)?.label ?? sections.find((s) => s.key === key)?.title ?? key;
  return `« ${name} » : ${message}`;
}
