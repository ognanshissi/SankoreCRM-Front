/**
 * FE-07 — Types pour la correspondance des champs source → lead.
 */

// ——— Lead target fields (closed list) ———

export interface LeadTargetField {
  key: string;
  label: string;
  required: boolean;
}

export const LEAD_TARGET_FIELDS: LeadTargetField[] = [
  { key: 'fullName',        label: 'Nom complet',        required: false },
  { key: 'firstName',       label: 'Prénom',             required: true },
  { key: 'lastName',        label: 'Nom',                required: true },
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

let _uid = 0;
export function uid(): string {
  return '__mr' + (++_uid);
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

/** Check which required lead fields are not mapped */
export function missingRequiredFields(rules: MappingRule[]): LeadTargetField[] {
  const mapped = new Set(rules.map((r) => r.targetField).filter(Boolean));
  return LEAD_TARGET_FIELDS.filter((f) => f.required && !mapped.has(f.key));
}
