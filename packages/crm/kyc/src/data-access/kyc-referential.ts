import { Severity } from '@talisoft/ui/tag';
import { RunKycVerificationRequestDocumentTypeEnum } from '@sankore/crm-api';

/**
 * Référentiels d'affichage du module KYC — section 3 du cahier.
 *
 * Tout ce qui traduit une valeur d'API en texte visible par l'agent est ici, et nulle part ailleurs :
 * c'est la seule façon de rendre une traduction ultérieure possible, et d'éviter que deux écrans
 * nomment différemment le même statut.
 *
 * **Lecture en chaîne, écriture en entier.** `KycFileDto.status`, `.vigilanceLevel` et
 * `.confidenceLevel` sont des chaînes en lecture, alors que `CreateKycFileRequest.channel`,
 * `.vigilanceLevel` et `RunKycVerificationResponse.confidenceLevel` sont des entiers. Le générateur
 * nomme ces entiers `NUMBER_0..NUMBER_4`, sans indiquer ce qu'ils désignent : les correspondances
 * ci-dessous portent la mention « à confirmer » là où le contrat ne dit rien.
 */

// ——————————————————————————————————————————————————————————————————————
// Statuts du dossier
// ——————————————————————————————————————————————————————————————————————

/**
 * Valeurs renvoyées par l'API, en anglais (`RunKycVerificationResponseStatusEnum`). Le cahier les
 * présente en français (« EnCollecte », « EnVérification »…) : ce sont des libellés, pas des valeurs.
 */
export type KycStatus =
  | 'Collecting'
  | 'Verifying'
  | 'Validating'
  | 'ComplementRequired'
  | 'Simplified'
  | 'Full'
  | 'UnderReview'
  | 'Expired'
  | 'Rejected'
  | 'Suspended';

export interface KycStatusMeta {
  label: string;
  severity: Severity;
  /** Classes Tailwind pour les affichages qui ne passent pas par `tas-tag`. */
  classes: string;
}

const STATUS_META: Record<KycStatus, KycStatusMeta> = {
  Collecting:         { label: 'En cours de saisie',        severity: 'neutral',   classes: 'bg-slate-100 text-slate-600' },
  Verifying:          { label: 'Vérification en cours',     severity: 'info',      classes: 'bg-blue-50 text-blue-700' },
  Validating:         { label: 'En attente de validation',  severity: 'info',      classes: 'bg-blue-50 text-blue-700' },
  ComplementRequired: { label: 'Complément requis',         severity: 'warning',   classes: 'bg-orange-50 text-orange-700' },
  Simplified:         { label: 'KYC simplifié',             severity: 'success',   classes: 'bg-green-50 text-green-600' },
  Full:               { label: 'KYC complet',               severity: 'success',   classes: 'bg-green-100 text-green-700' },
  UnderReview:        { label: 'Revue en cours',            severity: 'warning',   classes: 'bg-orange-50 text-orange-700' },
  Expired:            { label: 'Expiré',                    severity: 'error',     classes: 'bg-red-50 text-red-700' },
  Rejected:           { label: 'Rejeté',                    severity: 'error',     classes: 'bg-red-50 text-red-700' },
  Suspended:          { label: 'Suspendu',                  severity: 'error',     classes: 'bg-red-50 text-red-700' },
};

/**
 * Un statut inconnu est rendu tel quel, en gris. Même parti que pour les flags : le serveur doit
 * pouvoir en ajouter un sans casser l'écran.
 */
export function kycStatusMeta(status: string | null | undefined): KycStatusMeta {
  return (
    STATUS_META[status as KycStatus] ?? {
      label: status ?? '—',
      severity: 'neutral' as Severity,
      classes: 'bg-slate-100 text-slate-600',
    }
  );
}

export const KYC_STATUS_FILTER_OPTIONS = (Object.keys(STATUS_META) as KycStatus[]).map((value) => ({
  value,
  label: STATUS_META[value].label,
}));

// ——————————————————————————————————————————————————————————————————————
// Flags du score de confiance
// ——————————————————————————————————————————————————————————————————————

export type KycFlagSeverity = 'blocking' | 'warning' | 'info';

export interface KycFlagMeta {
  label: string;
  severity: KycFlagSeverity;
  tagSeverity: Severity;
  icon: string;
}

const FLAG_META: Record<string, KycFlagMeta> = {
  MRZ_CHECKSUM_FAILED: {
    label: 'La zone codée de la pièce est invalide',
    severity: 'blocking', tagSeverity: 'error', icon: 'feather:alert-octagon',
  },
  VISUAL_MRZ_MISMATCH: {
    label: 'Les informations imprimées ne correspondent pas à la zone codée',
    severity: 'blocking', tagSeverity: 'error', icon: 'feather:alert-octagon',
  },
  DOCUMENT_EXPIRED: {
    label: "La pièce d'identité est expirée",
    severity: 'blocking', tagSeverity: 'error', icon: 'feather:calendar',
  },
  FACE_MISMATCH: {
    label: 'Le visage ne correspond pas à la photo de la pièce',
    severity: 'blocking', tagSeverity: 'error', icon: 'feather:user-x',
  },
  DUPLICATE_DOCUMENT_SUSPECTED: {
    label: 'Cette pièce est déjà associée à un autre client',
    severity: 'blocking', tagSeverity: 'error', icon: 'feather:copy',
  },
  LOW_FACE_QUALITY: {
    label: 'Photo du visage de mauvaise qualité',
    severity: 'warning', tagSeverity: 'warning', icon: 'feather:camera-off',
  },
  LOW_OCR_CONFIDENCE: {
    label: 'Certains champs doivent être vérifiés',
    severity: 'warning', tagSeverity: 'warning', icon: 'feather:edit-3',
  },
  IMAGE_PREPROCESSED: {
    label: 'Image corrigée automatiquement',
    severity: 'info', tagSeverity: 'info', icon: 'feather:image',
  },
};

/**
 * Règle explicite du cahier : un code inconnu s'affiche en « Point à vérifier », gravité Attention,
 * et ne bloque pas l'écran. C'est ce qui permet au service biométrique d'ajouter un flag sans
 * livraison front.
 */
export function kycFlagMeta(code: string | null | undefined): KycFlagMeta {
  return (
    FLAG_META[code ?? ''] ?? {
      label: 'Point à vérifier',
      severity: 'warning' as KycFlagSeverity,
      tagSeverity: 'warning' as Severity,
      icon: 'feather:help-circle',
    }
  );
}

export function isBlockingFlag(code: string | null | undefined): boolean {
  return kycFlagMeta(code).severity === 'blocking';
}

// ——————————————————————————————————————————————————————————————————————
// Niveau de confiance
// ——————————————————————————————————————————————————————————————————————

/** Les trois niveaux que le cahier demande d'afficher (section KYC-F-04). */
export type KycConfidenceLevel = 'Validated' | 'Review' | 'Rejected';

export interface KycConfidenceMeta {
  label: string;
  severity: Severity;
  classes: string;
  /** Le dossier peut-il être soumis ? Le serveur reste l'autorité, ceci ne pilote que l'écran. */
  canSubmit: boolean;
  warnOnSubmit: boolean;
}

const CONFIDENCE_META: Record<KycConfidenceLevel, KycConfidenceMeta> = {
  Validated: { label: 'Validé',   severity: 'success', classes: 'text-green-700',  canSubmit: true,  warnOnSubmit: false },
  Review:    { label: 'À revoir', severity: 'warning', classes: 'text-orange-700', canSubmit: true,  warnOnSubmit: true },
  Rejected:  { label: 'Rejeté',   severity: 'error',   classes: 'text-red-700',    canSubmit: false, warnOnSubmit: false },
};

/**
 * `confidenceLevel` est une chaîne en lecture, et un entier `0..3` en écriture dont le contrat ne
 * documente pas la signification. On accepte donc les deux formes, et tout ce qui n'est pas reconnu
 * tombe sur « À revoir » : le cas prudent, qui laisse soumettre avec un avertissement plutôt que de
 * bloquer ou d'autoriser à tort.
 *
 * **À confirmer côté backend** : la correspondance des entiers, déduite de l'ordre de l'énumération.
 */
export function kycConfidenceMeta(level: string | number | null | undefined): KycConfidenceMeta {
  const normalised =
    typeof level === 'number'
      ? (['Rejected', 'Review', 'Validated', 'Validated'][level] ?? 'Review')
      : (level ?? '');
  return CONFIDENCE_META[normalised as KycConfidenceLevel] ?? CONFIDENCE_META.Review;
}

/** Couleur de la jauge de score, alignée sur les trois niveaux. */
export function kycScoreBarClasses(score: number | null | undefined): string {
  const value = score ?? 0;
  if (value >= 80) return 'bg-green-500';
  if (value >= 50) return 'bg-orange-400';
  return 'bg-red-500';
}

// ——————————————————————————————————————————————————————————————————————
// Vigilance
// ——————————————————————————————————————————————————————————————————————

export interface KycVigilanceMeta {
  label: string;
  severity: Severity;
  /** Le circuit ajoute l'étape responsable conformité (KYC-F-05). */
  requiresCompliance: boolean;
}

const VIGILANCE_META: Record<string, KycVigilanceMeta> = {
  Simplified: { label: 'Vigilance allégée',  severity: 'neutral', requiresCompliance: false },
  Standard:   { label: 'Vigilance standard', severity: 'info',    requiresCompliance: false },
  Enhanced:   { label: 'Vigilance renforcée', severity: 'warning', requiresCompliance: true },
};

export function kycVigilanceMeta(level: string | null | undefined): KycVigilanceMeta {
  return (
    VIGILANCE_META[level ?? ''] ?? {
      label: level ?? '—',
      severity: 'neutral' as Severity,
      requiresCompliance: false,
    }
  );
}

/**
 * Entiers attendus par `CreateKycFileRequest.vigilanceLevel`. L'ordre est déduit de l'énumération
 * (`NUMBER_0..NUMBER_2`), le contrat ne le documente pas — **à confirmer côté backend** avant de
 * s'en servir pour autre chose qu'un affichage.
 */
export const VIGILANCE_WRITE_VALUE: Record<string, 0 | 1 | 2> = {
  Simplified: 0,
  Standard: 1,
  Enhanced: 2,
};

// ——————————————————————————————————————————————————————————————————————
// Circuit de validation
// ——————————————————————————————————————————————————————————————————————

const APPROVAL_LEVEL_LABELS: Record<string, string> = {
  Agent: 'Agent',
  BranchManager: "Chef d'agence",
  ComplianceOfficer: 'Responsable conformité',
};

export function kycApprovalLevelLabel(level: string | null | undefined): string {
  return APPROVAL_LEVEL_LABELS[level ?? ''] ?? level ?? '—';
}

const APPROVAL_DECISION_META: Record<string, { label: string; severity: Severity; icon: string }> = {
  Pending:            { label: 'En attente',         severity: 'neutral', icon: 'feather:clock' },
  Approved:           { label: 'Approuvé',           severity: 'success', icon: 'feather:check-circle' },
  Rejected:           { label: 'Rejeté',             severity: 'error',   icon: 'feather:x-circle' },
  ComplementRequired: { label: 'Complément demandé', severity: 'warning', icon: 'feather:edit-3' },
};

export function kycApprovalDecisionMeta(decision: string | null | undefined) {
  return (
    APPROVAL_DECISION_META[decision ?? ''] ?? {
      label: decision ?? 'En attente',
      severity: 'neutral' as Severity,
      icon: 'feather:clock',
    }
  );
}

/** Points proposés pour une demande de complément (KYC-F-05). */
export const KYC_COMPLEMENT_REASONS = [
  { value: 'missing_field', label: 'Champ manquant ou incorrect' },
  { value: 'retake_document', label: "Photo de la pièce à reprendre" },
  { value: 'retake_selfie', label: 'Photo du visage à reprendre' },
  { value: 'expired_document', label: 'Pièce expirée, en fournir une valide' },
  { value: 'other', label: 'Autre (préciser)' },
];

// ——————————————————————————————————————————————————————————————————————
// Types de pièce d'identité
// ——————————————————————————————————————————————————————————————————————

/**
 * Nature de la pièce, désormais exigée par `POST /kyc-files/{id}/verify`
 * (`RunKycVerificationRequest.documentType`) : le service biométrique ne sait pas la deviner, et
 * sans elle il ne peut pas choisir le gabarit de lecture.
 *
 * Le `Record` est indexé sur l'enum généré : ajouter une valeur au contrat casse la compilation
 * ici, là où le libellé manque, plutôt que de laisser l'écran afficher un code brut.
 */
const DOCUMENT_TYPE_LABELS: Record<RunKycVerificationRequestDocumentTypeEnum, string> = {
  [RunKycVerificationRequestDocumentTypeEnum.Cni]: "Carte nationale d'identité",
  [RunKycVerificationRequestDocumentTypeEnum.Passport]: 'Passeport',
  [RunKycVerificationRequestDocumentTypeEnum.Cedeao]: 'Carte CEDEAO',
  [RunKycVerificationRequestDocumentTypeEnum.Consulaire]: 'Carte consulaire',
};

export const KYC_DOCUMENT_TYPE_OPTIONS = (
  Object.keys(DOCUMENT_TYPE_LABELS) as RunKycVerificationRequestDocumentTypeEnum[]
).map((value) => ({ value, label: DOCUMENT_TYPE_LABELS[value] }));

/** Vrai si la chaîne vient bien du contrat : garde-fou avant de la poser dans la requête. */
export function isKycDocumentType(
  value: string | null | undefined,
): value is RunKycVerificationRequestDocumentTypeEnum {
  return !!value && value in DOCUMENT_TYPE_LABELS;
}

export function kycDocumentTypeLabel(value: string | null | undefined): string {
  return isKycDocumentType(value) ? DOCUMENT_TYPE_LABELS[value] : (value ?? '—');
}

// ——————————————————————————————————————————————————————————————————————
// Pièces du dossier et verdicts de validation
// ——————————————————————————————————————————————————————————————————————

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  IdentityDocumentFront: "Pièce d'identité — recto",
  IdentityDocumentBack: "Pièce d'identité — verso",
  Selfie: 'Photo du visage (selfie)',
};

export function kycDocumentKindLabel(kind: string | null | undefined): string {
  return DOCUMENT_KIND_LABELS[kind ?? ''] ?? kind ?? '—';
}

/**
 * `NotReviewed` n'est **pas** « en attente », et les deux ne portent ni le même libellé ni la même
 * couleur : « en attente » annonce une décision que quelqu'un doit prendre, alors qu'une image
 * antérieure au registre n'a pas de ligne à décider — aucun rattrapage ne peut lui en donner une.
 * Les confondre ferait chercher du travail là où il n'y en a pas, et c'est exactement la lecture que
 * ce tableau doit rendre impossible.
 */
const DOCUMENT_DECISION_META: Record<string, { label: string; severity: Severity; icon: string }> = {
  NotReviewed: { label: 'Non examinée', severity: 'neutral', icon: 'feather:help-circle' },
  Pending:     { label: 'À examiner',   severity: 'warning', icon: 'feather:clock' },
  Accepted:    { label: 'Acceptée',     severity: 'success', icon: 'feather:check-circle' },
  Refused:     { label: 'Refusée',      severity: 'error',   icon: 'feather:x-circle' },
};

export function kycDocumentDecisionMeta(decision: string | null | undefined) {
  return (
    DOCUMENT_DECISION_META[decision ?? ''] ?? {
      label: decision ?? 'Non examinée',
      severity: 'neutral' as Severity,
      icon: 'feather:help-circle',
    }
  );
}

// ——————————————————————————————————————————————————————————————————————
// Rattachement depuis les workflows
// ——————————————————————————————————————————————————————————————————————

/**
 * Une instance de workflow porte-t-elle un dossier KYC ?
 *
 * `WorkflowInstanceDto.entityType` est une **chaîne libre** : le contrat ne l'énumère nulle part,
 * et aucun schéma ne dit quelle valeur le backend émet pour un circuit KYC. Le test est donc
 * volontairement tolérant — insensible à la casse, et satisfait par toute valeur contenant « kyc ».
 * Il attrape ainsi `Kyc`, `KycFile`, `KycDossier` ou `kyc_file` sans qu'il faille livrer à chaque
 * fois que le backend change d'orthographe.
 *
 * La contrepartie est assumée : un `entityType` qui ne contiendrait pas « kyc » ne serait pas
 * reconnu, et l'affordance de consultation n'apparaîtrait pas. C'est le bon sens de l'échec —
 * l'écran de validation reste utilisable, seule la consultation rapide manque. **À remplacer par
 * une comparaison stricte le jour où le contrat énumère les valeurs.**
 */
export function isKycWorkflowEntity(entityType: string | null | undefined): boolean {
  return (entityType ?? '').toLowerCase().includes('kyc');
}
