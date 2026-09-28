import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés des énumérations du module Clients.
 *
 * Le contrat OpenAPI est ambigu sur ces valeurs : `ClientDetailDto.status`,
 * `kycStatus`, `riskLevel` et `clientType` sont déclarés `type: string` sans
 * énumération, alors que les requêtes d'écriture utilisent tantôt des noms
 * (`CreateIndividualClientRequest.identityDocumentType`) tantôt des entiers
 * (`UpdateClientSensitiveRequest.identityDocumentType`). Le précédent du module
 * Leads montre que le serveur renvoie parfois la valeur numérique sous forme de
 * chaîne (`LeadDto.gender` vaut '1').
 *
 * Ces fonctions acceptent donc les deux formes et retombent sur la valeur brute
 * plutôt que d'afficher « — » : un libellé inattendu se voit à l'écran et se
 * corrige, une valeur avalée passe inaperçue.
 */

type RawEnum = string | number | null | undefined;

/** Ramène une valeur brute au nom canonique du contrat, ou `null` si inconnue. */
function canonical(value: RawEnum, order: string[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value);
  if (order.includes(raw)) return raw;
  const asIndex = Number(raw);
  if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < order.length) {
    return order[asIndex];
  }
  return null;
}

function label(value: RawEnum, byName: Record<string, string>, order: string[]): string {
  if (value === null || value === undefined || value === '') return '—';
  const name = canonical(value, order);
  return name ? (byName[name] ?? String(value)) : String(value);
}

// ——— Type de client ———

export const CLIENT_TYPE_ORDER = ['Individual', 'Legal'];
const CLIENT_TYPE_LABELS: Record<string, string> = {
  Individual: 'Personne physique',
  Legal: 'Personne morale',
};
export function clientTypeLabel(value: RawEnum): string {
  return label(value, CLIENT_TYPE_LABELS, CLIENT_TYPE_ORDER);
}
export function isLegalClient(value: RawEnum): boolean {
  return canonical(value, CLIENT_TYPE_ORDER) === 'Legal';
}

// ——— Statut du client ———

/**
 * Les six statuts du module, dans l'ordre du domaine. **L'ordre fait foi** : il sert à
 * convertir un statut numérique en nom (`canonical`) et, dans l'autre sens, à construire
 * le filtre de la liste. Se tromper ne provoque ni erreur ni page vide suspecte — l'écran
 * interroge simplement un autre statut que celui demandé.
 *
 * Ni `Draft` ni « mise en veille » n'en font partie : la mise en veille est un segment,
 * pas un statut.
 */
export const CLIENT_STATUS_ORDER = [
  'PendingKyc',
  'Active',
  'Suspended',
  'KycRejected',
  'Archived',
  'Merged',
];
const CLIENT_STATUS_LABELS: Record<string, string> = {
  PendingKyc: 'KYC en attente',
  Active: 'Actif',
  Suspended: 'Suspendu',
  KycRejected: 'KYC rejeté',
  Archived: 'Archivé',
  Merged: 'Fusionné',
};
export function clientStatusLabel(value: RawEnum): string {
  return label(value, CLIENT_STATUS_LABELS, CLIENT_STATUS_ORDER);
}
export function clientStatusSeverity(value: RawEnum): Severity {
  switch (canonical(value, CLIENT_STATUS_ORDER)) {
    case 'Active':      return 'success';
    case 'PendingKyc':  return 'warning';
    case 'Suspended':   return 'error';
    case 'KycRejected': return 'error';
    case 'Archived':    return 'neutral';
    case 'Merged':      return 'secondary';
    default:            return 'info';
  }
}
/**
 * Un client fusionné ou archivé ne se modifie plus : la fiche passe en lecture seule.
 * `KycRejected` n'en fait pas partie — c'est un état à corriger, donc la fiche doit
 * rester modifiable pour qu'on puisse reprendre l'identité déclarée.
 */
export function isReadOnlyStatus(value: RawEnum): boolean {
  const name = canonical(value, CLIENT_STATUS_ORDER);
  return name === 'Archived' || name === 'Merged';
}
export function isMergedStatus(value: RawEnum): boolean {
  return canonical(value, CLIENT_STATUS_ORDER) === 'Merged';
}
export function isArchivedStatus(value: RawEnum): boolean {
  return canonical(value, CLIENT_STATUS_ORDER) === 'Archived';
}
export function isPendingKycStatus(value: RawEnum): boolean {
  return canonical(value, CLIENT_STATUS_ORDER) === 'PendingKyc';
}
export function isKycRejectedStatus(value: RawEnum): boolean {
  return canonical(value, CLIENT_STATUS_ORDER) === 'KycRejected';
}

// ——— Statut KYC ———

export const KYC_STATUS_ORDER = ['NotStarted', 'Pending', 'Validated', 'Rejected', 'Expired'];
const KYC_STATUS_LABELS: Record<string, string> = {
  NotStarted: 'Non démarré',
  Pending: 'En attente',
  Validated: 'Validé',
  Rejected: 'Rejeté',
  Expired: 'Expiré',
};
export function kycStatusLabel(value: RawEnum): string {
  return label(value, KYC_STATUS_LABELS, KYC_STATUS_ORDER);
}
export function kycStatusSeverity(value: RawEnum): Severity {
  switch (canonical(value, KYC_STATUS_ORDER)) {
    case 'Validated': return 'success';
    case 'Pending':   return 'warning';
    case 'Rejected':  return 'error';
    case 'Expired':   return 'error';
    default:          return 'neutral';
  }
}

// ——— Niveau de risque ———

/**
 * `Unknown` est le niveau d'un client dont le risque n'a pas encore été évalué — c'est
 * l'état d'un client fraîchement créé, et donc le cas le plus fréquent à l'écran. Il
 * manquait ici, si bien que la fiche et la liste affichaient la valeur brute « Unknown »
 * en anglais.
 *
 * L'ordre n'a pas d'effet de bord pour ce champ : `riskLevel` est une chaîne partout dans
 * le contrat, n'apparaît dans aucune requête et n'est jamais converti en entier.
 */
export const RISK_LEVEL_ORDER = ['Unknown', 'Low', 'Medium', 'High'];
const RISK_LEVEL_LABELS: Record<string, string> = {
  Unknown: 'Non évalué',
  Low: 'Faible',
  Medium: 'Moyen',
  High: 'Élevé',
};
export function riskLevelLabel(value: RawEnum): string {
  return label(value, RISK_LEVEL_LABELS, RISK_LEVEL_ORDER);
}
export function riskLevelSeverity(value: RawEnum): Severity {
  switch (canonical(value, RISK_LEVEL_ORDER)) {
    case 'Low':    return 'success';
    case 'Medium': return 'warning';
    case 'High':   return 'error';
    default:       return 'neutral';
  }
}

/** Vrai tant que le risque n'a pas été évalué : l'écran peut le signaler autrement. */
export function isRiskUnknown(value: RawEnum): boolean {
  return value === null || value === undefined || value === ''
    || canonical(value, RISK_LEVEL_ORDER) === 'Unknown';
}

// ——— Genre ———

export const GENDER_ORDER = ['Male', 'Female', 'Other'];
const GENDER_LABELS: Record<string, string> = {
  Male: 'Masculin',
  Female: 'Féminin',
  Other: 'Autre',
};
export function genderLabel(value: RawEnum): string {
  return label(value, GENDER_LABELS, GENDER_ORDER);
}
/** Les options se lisent en chaîne : `tas-select` ne travaille qu'avec des chaînes. */
export const GENDER_OPTIONS = GENDER_ORDER.map((name) => ({
  label: GENDER_LABELS[name] as string,
  value: name,
}));

// ——— Situation familiale ———

/**
 * `maritalStatus` est un entier 0..4 dans les deux sens et le contrat ne nomme
 * aucune de ses valeurs : ces libellés sont une convention à confirmer côté API.
 */
export const MARITAL_STATUS_OPTIONS = [
  { label: 'Célibataire', value: '0' },
  { label: 'Marié(e)', value: '1' },
  { label: 'Divorcé(e)', value: '2' },
  { label: 'Veuf / Veuve', value: '3' },
  { label: 'Union libre', value: '4' },
];
export function maritalStatusLabel(value: RawEnum): string {
  if (value === null || value === undefined || value === '') return '—';
  return MARITAL_STATUS_OPTIONS.find((o) => o.value === String(value))?.label ?? String(value);
}

// ——— Pièce d'identité ———

/**
 * L'ordre est celui du contrat : il fait foi, car la création attend le nom
 * (`'Passport'`) et la modification sensible l'index (`1`). Toute conversion
 * entre les deux passe par ces deux fonctions, jamais par un `as any`.
 */
export const IDENTITY_DOCUMENT_ORDER = [
  'NationalIdCard',
  'Passport',
  'DriverLicense',
  'ConsularCard',
  'VoterCard',
  'ResidencePermit',
  'Other',
];
const IDENTITY_DOCUMENT_LABELS: Record<string, string> = {
  NationalIdCard: "Carte nationale d'identité",
  Passport: 'Passeport',
  DriverLicense: 'Permis de conduire',
  ConsularCard: 'Carte consulaire',
  VoterCard: "Carte d'électeur",
  ResidencePermit: 'Titre de séjour',
  Other: 'Autre',
};
export function identityDocumentLabel(value: RawEnum): string {
  return label(value, IDENTITY_DOCUMENT_LABELS, IDENTITY_DOCUMENT_ORDER);
}
/** Options par nom, pour la création (`CreateIndividualClientRequest`). */
export const IDENTITY_DOCUMENT_OPTIONS = IDENTITY_DOCUMENT_ORDER.map((name) => ({
  label: IDENTITY_DOCUMENT_LABELS[name] as string,
  value: name,
}));
/** Nom -> index, pour `UpdateClientSensitiveRequest` qui attend un entier. */
export function identityDocumentToIndex(name: string | null | undefined): number | null {
  if (!name) return null;
  const index = IDENTITY_DOCUMENT_ORDER.indexOf(name);
  return index >= 0 ? index : null;
}

// ——— Type de contrôle d'un bénéficiaire effectif ———

export const CONTROL_TYPE_ORDER = ['Ownership', 'VotingRights', 'Manager', 'Other'];
const CONTROL_TYPE_LABELS: Record<string, string> = {
  Ownership: 'Détention du capital',
  VotingRights: 'Droits de vote',
  Manager: 'Dirigeant',
  Other: 'Autre',
};
export function controlTypeLabel(value: RawEnum): string {
  return label(value, CONTROL_TYPE_LABELS, CONTROL_TYPE_ORDER);
}
export const CONTROL_TYPE_OPTIONS = CONTROL_TYPE_ORDER.map((name) => ({
  label: CONTROL_TYPE_LABELS[name] as string,
  value: name,
}));

// ——— Pays, indicatifs téléphoniques ———

/**
 * Les pays de l'UEMOA d'abord : c'est la zone d'exercice de l'institution, et
 * US-M01-FE-06 demande explicitement qu'ils soient proposés en premier.
 */
export const UEMOA_COUNTRIES = [
  { code: 'CI', label: "Côte d'Ivoire", dial: '+225' },
  { code: 'SN', label: 'Sénégal', dial: '+221' },
  { code: 'BF', label: 'Burkina Faso', dial: '+226' },
  { code: 'ML', label: 'Mali', dial: '+223' },
  { code: 'BJ', label: 'Bénin', dial: '+229' },
  { code: 'TG', label: 'Togo', dial: '+228' },
  { code: 'NE', label: 'Niger', dial: '+227' },
  { code: 'GW', label: 'Guinée-Bissau', dial: '+245' },
];
