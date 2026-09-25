/**
 * FE-07 — Types pour la correspondance des champs source → lead.
 */

// ——— Lead target fields (closed list) ———

export interface LeadTargetField {
  key: string;
  label: string;
  /** Obligatoire a lui seul. */
  required: boolean;
  /** Appartient a un groupe dont UN membre au moins doit etre mappe. */
  requiredGroup?: string;
}

export const LEAD_TARGET_FIELDS: LeadTargetField[] = [
  { key: 'fullName',        label: 'Nom complet',        required: false, requiredGroup: 'identity' },
  { key: 'firstName',       label: 'Prénom',             required: false, requiredGroup: 'identity' },
  { key: 'lastName',        label: 'Nom',                required: false, requiredGroup: 'identity' },
  { key: 'phoneNumber',     label: 'Téléphone',          required: true },
  { key: 'email',           label: 'E-mail',             required: false },
  { key: 'city',            label: 'Ville',              required: false },
  { key: 'address',         label: 'Adresse',            required: false },
  { key: 'company',         label: 'Entreprise',         required: false },
  { key: 'jobTitle',        label: 'Fonction',           required: false },
  { key: 'productCode',     label: 'Code produit',       required: false },
  { key: 'message',         label: 'Message',            required: false },
  { key: 'externalId',      label: 'ID externe',         required: false },
  { key: 'consentGiven',    label: 'Consentement',       required: false },
  { key: 'utm_source',      label: 'UTM Source',         required: false },
  { key: 'utm_medium',      label: 'UTM Medium',         required: false },
  { key: 'utm_campaign',    label: 'UTM Campaign',       required: false },
];

// ——— Transformations ———

export type TransformationType = 'none' | 'trim' | 'e164' | 'map' | 'concat' | 'uppercase' | 'lowercase';

export interface TransformationOption {
  value: TransformationType;
  label: string;
}

export const TRANSFORMATION_OPTIONS: TransformationOption[] = [
  { value: 'none',      label: 'Aucune' },
  { value: 'trim',      label: 'Supprimer les espaces (trim)' },
  { value: 'e164',      label: 'Format téléphone E.164' },
  { value: 'map',       label: 'Table de correspondance (map)' },
  { value: 'concat',    label: 'Concaténer' },
  { value: 'uppercase', label: 'Majuscules' },
  { value: 'lowercase', label: 'Minuscules' },
];

export const E164_COUNTRY_OPTIONS = [
  { value: '+225', label: 'Côte d\'Ivoire (+225)' },
  { value: '+221', label: 'Sénégal (+221)' },
  { value: '+223', label: 'Mali (+223)' },
  { value: '+226', label: 'Burkina Faso (+226)' },
  { value: '+229', label: 'Bénin (+229)' },
  { value: '+228', label: 'Togo (+228)' },
  { value: '+227', label: 'Niger (+227)' },
  { value: '+245', label: 'Guinée-Bissau (+245)' },
];

// ——— Mapping rule ———

export interface MappingRule {
  _uid: string;
  sourceField: string;
  targetField: string;
  transformation: TransformationType;
  defaultValue: string;
  e164Country: string;
  mapEntries: MapEntry[];
  concatSeparator: string;
}

export interface MapEntry {
  source: string;
  target: string;
}

export function uid(): string {
  return '__mr_' + (crypto.randomUUID());
}

export function emptyRule(): MappingRule {
  return {
    _uid: uid(),
    sourceField: '',
    targetField: '',
    transformation: 'none',
    defaultValue: '',
    e164Country: '+225',
    mapEntries: [],
    concatSeparator: ' ',
  };
}

/**
 * Obligations de mapping, exprimees en groupes.
 *
 * L'AC de FE-07 dit « nom OU prenom, telephone » : exiger `firstName` ET
 * `lastName` separement bloquait a tort. Cette liste est l'unique source de
 * verite — l'editeur de correspondance ET la checklist d'activation (FE-09)
 * la consomment, elles ne peuvent donc plus diverger.
 */
export interface RequiredFieldGroup {
  /** Libelle affiche quand le groupe n'est pas satisfait. */
  label: string;
  /** Au moins une de ces cles doit etre mappee. */
  keys: string[];
}

export const REQUIRED_FIELD_GROUPS: RequiredFieldGroup[] = [
  { label: 'Nom ou prénom', keys: ['firstName', 'lastName', 'fullName'] },
  { label: 'Téléphone', keys: ['phoneNumber'] },
];

/** Groupes d'obligation non satisfaits par les regles fournies. */
export function missingRequiredFields(rules: MappingRule[]): RequiredFieldGroup[] {
  const mapped = new Set(rules.map((r) => r.targetField).filter(Boolean));
  return REQUIRED_FIELD_GROUPS.filter((g) => !g.keys.some((k) => mapped.has(k)));
}

/** Vrai si ce champ cible participe a une obligation (seul ou en groupe). */
export function isRequiredTargetField(key: string): boolean {
  return LEAD_TARGET_FIELDS.some(
    (f) => f.key === key && (f.required || !!f.requiredGroup),
  );
}
