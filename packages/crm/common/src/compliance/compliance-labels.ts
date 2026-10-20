import { Severity } from '@talisoft/ui/tag';

/**
 * Référentiels d'affichage de l'évolution « foyer, bénéficiaires et conformité ».
 *
 * Le front ne porte aucune règle métier : il traduit les codes que l'API renvoie.
 * La règle commune, posée par le cahier des charges, est qu'un **code inconnu ne
 * bloque jamais l'écran** : il s'affiche « Point à vérifier » en neutre. C'est la
 * raison d'être de ce fichier unique — un `switch` recopié écran par écran finit
 * toujours par renvoyer `undefined` quelque part, et c'est l'écran qui casse.
 */
export const UNKNOWN_CODE_LABEL = 'Point à vérifier';

interface CodeMeta {
  label: string;
  severity: Severity;
}

const UNKNOWN_META: CodeMeta = { label: UNKNOWN_CODE_LABEL, severity: 'neutral' };

function meta(table: Record<string, CodeMeta>, code: string | null | undefined): CodeMeta {
  if (!code) return UNKNOWN_META;
  return table[code] ?? UNKNOWN_META;
}

// ——— Statut FATCA ———

/**
 * `IndiciaCured` est « vert clair » au cahier des charges, nuance que `Severity`
 * ne distingue pas de `success` — les deux sont des états conformes.
 */
const FATCA_STATUS: Record<string, CodeMeta> = {
  NotApplicable:   { label: 'Non applicable',          severity: 'neutral' },
  NonUsPerson:     { label: 'Non US',                  severity: 'success' },
  IndiciaPending:  { label: 'Documentation attendue',  severity: 'warning' },
  UsPerson:        { label: 'Personne américaine',     severity: 'info' },
  IndiciaCured:    { label: 'Indices levés',           severity: 'success' },
  Recalcitrant:    { label: 'Récalcitrant',            severity: 'error' },
};

export function fatcaStatusLabel(code: string | null | undefined): string {
  return meta(FATCA_STATUS, code).label;
}

export function fatcaStatusSeverity(code: string | null | undefined): Severity {
  return meta(FATCA_STATUS, code).severity;
}

/** Un statut qui demande encore une action de l'agent. */
export function isFatcaActionable(code: string | null | undefined): boolean {
  return code === 'IndiciaPending' || code === 'Recalcitrant';
}

// ——— Statut des produits détenus ———

const HOLDING_STATUS: Record<string, CodeMeta> = {
  Draft:            { label: 'Brouillon',          severity: 'neutral' },
  PendingSignature: { label: 'À signer',           severity: 'warning' },
  PendingSync:      { label: 'En synchronisation', severity: 'info' },
  Active:           { label: 'Actif',              severity: 'success' },
  Rejected:         { label: 'Rejeté',             severity: 'error' },
  Closed:           { label: 'Clôturé',            severity: 'neutral' },
};

export function holdingStatusLabel(code: string | null | undefined): string {
  return meta(HOLDING_STATUS, code).label;
}

export function holdingStatusSeverity(code: string | null | undefined): Severity {
  return meta(HOLDING_STATUS, code).severity;
}

// ——— Catégories de produit ———
//
// Pas de table ici : le référentiel des catégories existe déjà dans
// `services/product-config.service.ts` (`productCategoryLabel`,
// `PRODUCT_CATEGORY_OPTIONS`), aligné sur `ProductDtoCategoryEnum`. Les produits
// détenus (BNF-F-10) s'en servent pour leurs groupes.

// ——— Membres du foyer ———

const MEMBER_TYPE: Record<string, string> = {
  Spouse:    'Conjoint',
  Child:     'Enfant',
  Dependent: 'Personne à charge',
  Principal: 'Principal',
};

export function householdMemberTypeLabel(code: string | null | undefined): string {
  if (!code) return UNKNOWN_CODE_LABEL;
  return MEMBER_TYPE[code] ?? UNKNOWN_CODE_LABEL;
}

const UNION_TYPE: Record<string, string> = {
  Married:     'Marié',
  CivilUnion:  'Pacsé',
  Cohabiting:  'Concubinage',
};

export function spouseUnionTypeLabel(code: string | null | undefined): string {
  if (!code) return UNKNOWN_CODE_LABEL;
  return UNION_TYPE[code] ?? UNKNOWN_CODE_LABEL;
}

/** Les seuls types d'union que le cahier des charges rend obligatoires au choix. */
export const SPOUSE_UNION_OPTIONS = [
  { label: 'Marié', value: 'Married' },
  { label: 'Pacsé', value: 'CivilUnion' },
];

export function genderLabel(code: string | null | undefined): string {
  switch (code) {
    case 'Male':
    case 'M':
    case '0':
      return 'Homme';
    case 'Female':
    case 'F':
    case '1':
      return 'Femme';
    default:
      return code ? UNKNOWN_CODE_LABEL : '—';
  }
}

export const GENDER_OPTIONS = [
  { label: 'Homme', value: 'Male' },
  { label: 'Femme', value: 'Female' },
];

// ——— PPE ———

const PEP_LINK: Record<string, string> = {
  Self:     'Lui-même',
  Family:   'Famille',
  Associate: 'Proche',
  CloseAssociate: 'Proche',
};

export function pepLinkLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return PEP_LINK[code] ?? UNKNOWN_CODE_LABEL;
}

export const PEP_LINK_OPTIONS = [
  { label: 'Lui-même', value: 'Self' },
  { label: 'Famille', value: 'Family' },
  { label: 'Proche', value: 'Associate' },
];

// ——— FATCA : documentation et indices ———

const FATCA_DOCUMENTATION: Record<string, string> = {
  None:             'Aucune',
  UsPerson:         'Personne américaine (W-9)',
  NonUsPerson:      'Personne non américaine (W-8BEN)',
  RefusedToDocument: 'Refus de documenter',
};

export function fatcaDocumentationLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return FATCA_DOCUMENTATION[code] ?? UNKNOWN_CODE_LABEL;
}

/**
 * Les sept questions d'américanité, dans l'ordre du cahier des charges. Les clés
 * sont celles de `FatcaIndiciaInput` ; le libellé est posé une fois ici pour que
 * l'écran de saisie et le récapitulatif de conversion disent la même chose.
 */
export const FATCA_INDICIA_QUESTIONS = [
  { key: 'usNationalityOrResidence',            label: 'Nationalité ou résidence fiscale américaine' },
  { key: 'bornInTheUnitedStates',               label: 'Naissance aux États-Unis' },
  { key: 'usAddressOrPoBox',                    label: 'Adresse ou boîte postale aux États-Unis' },
  { key: 'usPhoneNumber',                       label: 'Numéro de téléphone américain' },
  { key: 'standingOrderToUsAccount',            label: 'Virement permanent vers un compte aux États-Unis' },
  { key: 'powerOfAttorneyWithUsAddress',        label: "Procuration donnée à une personne ayant une adresse aux États-Unis" },
  { key: 'careOfOrPosteRestanteAsSoleAddress',  label: "Adresse « aux bons soins de » ou poste restante comme seule adresse" },
] as const;

export type FatcaIndiciaKey = (typeof FATCA_INDICIA_QUESTIONS)[number]['key'];

export function fatcaIndiciaLabel(key: string | null | undefined): string {
  const found = FATCA_INDICIA_QUESTIONS.find((q) => q.key === key);
  return found?.label ?? UNKNOWN_CODE_LABEL;
}

export const FATCA_REGIME_OPTIONS = [
  { label: 'IGA modèle 1', value: 'Iga1' },
  { label: 'IGA modèle 2', value: 'Iga2' },
  { label: 'Accord FFI direct', value: 'DirectFfi' },
];

export function fatcaRegimeLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return FATCA_REGIME_OPTIONS.find((o) => o.value === code)?.label ?? UNKNOWN_CODE_LABEL;
}

/**
 * Format d'un GIIN : `XXXXXX.XXXXX.XX.XXX`, soit 19 caractères alphanumériques
 * majuscules séparés par des points. Contrôlé à la saisie plutôt qu'au serveur,
 * parce qu'une faute de frappe n'est visible nulle part ailleurs.
 */
export const GIIN_PATTERN = /^[A-Z0-9]{6}\.[A-Z0-9]{5}\.[A-Z]{2}\.[0-9]{3}$/;

export const FATCA_REQUIREMENT_MOMENT_OPTIONS = [
  { label: "À l'enrichissement", value: 'Enrichment' },
  { label: 'À la conversion', value: 'Conversion' },
];

// ——— Désignations de bénéficiaires ———

const DESIGNATION_ROLE: Record<string, string> = {
  Beneficiary:        'Bénéficiaire',
  PrimaryBeneficiary: 'Bénéficiaire principal',
  ContingentBeneficiary: 'Bénéficiaire subsidiaire',
  Insured:            'Assuré',
  CoInsured:          'Co-assuré',
  CoHolder:           'Co-titulaire',
  Guarantor:          'Caution',
  LegalRepresentative: 'Représentant légal',
  Subscriber:         'Souscripteur',
};

export function designationRoleLabel(code: string | null | undefined): string {
  if (!code) return UNKNOWN_CODE_LABEL;
  return DESIGNATION_ROLE[code] ?? UNKNOWN_CODE_LABEL;
}

const DESIGNATION_STATUS: Record<string, CodeMeta> = {
  Active:   { label: 'Active',    severity: 'success' },
  ToReview: { label: 'À revoir',  severity: 'warning' },
  Closed:   { label: 'Clôturée',  severity: 'neutral' },
  Superseded: { label: 'Remplacée', severity: 'neutral' },
};

export function designationStatusLabel(code: string | null | undefined): string {
  return meta(DESIGNATION_STATUS, code).label;
}

export function designationStatusSeverity(code: string | null | undefined): Severity {
  return meta(DESIGNATION_STATUS, code).severity;
}

/** Une désignation « à revoir » est signalée en orange avec l'action attendue (BNF-F-12). */
export function isDesignationToReview(code: string | null | undefined): boolean {
  return code === 'ToReview';
}

// ——— Consentements ———

const CONSENT_PROOF: Record<string, string> = {
  CheckboxWithSignature: 'Case cochée avec signature',
  SmsReply:              'Réponse SMS',
  Document:              'Document signé',
  Verbal:                'Accord verbal',
};

export function consentProofLabel(code: string | null | undefined): string {
  if (!code) return UNKNOWN_CODE_LABEL;
  return CONSENT_PROOF[code] ?? UNKNOWN_CODE_LABEL;
}

export const CONSENT_PROOF_OPTIONS = [
  { label: 'Case cochée avec signature', value: 'CheckboxWithSignature' },
  { label: 'Réponse SMS', value: 'SmsReply' },
  { label: 'Document signé', value: 'Document' },
];

// ——— Éléments manquants de la jauge de complétude ———

/**
 * Libellés des codes de `CompletenessGap.code`. L'API fournit déjà `detail` et
 * `actionHint` en clair : ce tableau ne sert qu'à titrer la ligne. Un code absent
 * retombe sur « Point à vérifier », jamais sur le code brut — un agent n'a rien à
 * faire de `FATCA_SELF_CERTIFICATION_MISSING` à l'écran.
 */
const GAP_CODE: Record<string, string> = {
  IDENTITY_INCOMPLETE:            "Identité à compléter",
  BIRTHDATE_MISSING:              'Date de naissance manquante',
  ADDRESS_MISSING:                'Adresse manquante',
  SPOUSE_UNION_TYPE_MISSING:      "Type d'union du conjoint manquant",
  PEP_FUNCTION_MISSING:           'Fonction PPE manquante',
  PEP_STATUS_MISSING:             'Statut PPE non renseigné',
  FATCA_DECLARATION_MISSING:      'Déclaration FATCA manquante',
  FATCA_SELF_CERTIFICATION_MISSING: 'Auto-certification FATCA non signée',
  FATCA_EVIDENCE_MISSING:         'Justificatif FATCA manquant',
  FATCA_TIN_MISSING:              'Numéro fiscal américain (TIN) manquant',
  QUESTIONNAIRE_MISSING:          'Questionnaire à compléter',
  HEALTH_CONSENT_MISSING:         'Consentement santé non recueilli',
  CONSENT_MISSING:                'Consentement manquant',
  KYC_INVALID:                    'KYC non valide',
  KYC_TIER_INSUFFICIENT:          'Niveau KYC insuffisant',
  REQUIRED_FIELD_MISSING:         'Champ obligatoire manquant',
  // Les codes que le serveur produit réellement (`CompletenessCodes`) : sans eux, la plupart des
  // lignes de la jauge s'affichaient « Point à vérifier ».
  PRODUCT_LINE_NOT_RESOLVED:      'Produit à rattacher au catalogue',
  MISSING_QUESTIONNAIRE:          'Questionnaire à compléter',
  MISSING_REQUIRED_FIELD:         'Champ obligatoire manquant',
  PEP_NOT_DECLARED:               'Statut PPE non déclaré',
  FATCA_DOCUMENTATION_OUTSTANDING: 'Justificatif FATCA manquant',
  CUSTOMER_KYC_NOT_APPROVED:      'KYC du client non validé',
  CUSTOMER_KYC_EXPIRED:           'KYC du client expiré',
  CUSTOMER_KYC_REJECTED:          'KYC du client refusé',
  CUSTOMER_KYC_TIER_INSUFFICIENT: 'Niveau KYC insuffisant',
  CUSTOMER_NOT_ACTIVE:            'Fiche client inactive',
  CUSTOMER_NOT_FOUND:             'Fiche client introuvable',
  COMPLETENESS_CHECK_UNAVAILABLE: 'Vérification indisponible',
};

export function completenessGapLabel(code: string | null | undefined): string {
  if (!code) return UNKNOWN_CODE_LABEL;
  return GAP_CODE[code] ?? UNKNOWN_CODE_LABEL;
}

/**
 * Les codes de champs requis (`PersonFieldCode` côté serveur), tels que les porte le `detail` d'un
 * écart `MISSING_REQUIRED_FIELD` ou `CONSENT_MISSING`. Affichés tels quels, ils donnaient
 * « CONSENT_CREDIT_BUREAU » à lire à l'agent.
 */
const REQUIRED_FIELD_LABEL: Record<string, string> = {
  LAST_NAME:      'Nom',
  FIRST_NAME:     'Prénom',
  USAGE_NAME:     "Nom d'usage",
  BIRTH_DATE:     'Date de naissance',
  GENDER:         'Sexe',
  ADDRESS:        'Adresse',
  POSTAL_CODE:    'Boîte postale',
  CITY:           'Ville',
  COUNTRY:        'Pays',
  PHONE:          'Téléphone',
  EMAIL:          'E-mail',
  NATIONAL_ID:    "Pièce d'identité",
  DESIRED_AMOUNT: 'Montant demandé',
  PEP_STATUS:     'Statut PPE',
  CONSENT_DATA_PROCESSING:     'Consentement : traitement des données personnelles',
  CONSENT_CREDIT_BUREAU:       "Consentement : Bureau d'Information sur le Crédit",
  CONSENT_THIRD_PARTY_SHARING: 'Consentement : partage avec un partenaire',
};

/** Le titre d'une ligne de la jauge : le champ ou le consentement nommé, sinon le libellé du code. */
export function completenessGapTitle(gap: { code?: string | null; detail?: string | null }): string {
  const detail = gap.detail?.trim();
  if (detail && REQUIRED_FIELD_LABEL[detail]) return REQUIRED_FIELD_LABEL[detail];
  return detail || completenessGapLabel(gap.code);
}

// ——— Écarts de réconciliation (BNF-F-13) ———

const GAP_TYPE: Record<string, string> = {
  MissingInExternal: 'Absent du back-office',
  MissingInCrm:      'Absent du CRM',
  StatusMismatch:    'Statut divergent',
  KycTierMismatch:   'Niveau KYC divergent',
  BalanceMismatch:   'Solde divergent',
  DesignationMismatch: 'Désignations divergentes',
};

export function reconciliationGapTypeLabel(code: string | null | undefined): string {
  if (!code) return UNKNOWN_CODE_LABEL;
  return GAP_TYPE[code] ?? UNKNOWN_CODE_LABEL;
}
