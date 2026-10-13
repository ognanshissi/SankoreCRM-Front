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
  GeneralManagement: 'Direction générale',
  // KRM-B-08 : le niveau « Automatic » n'est pas un échelon du circuit, c'est l'absence
  // d'échelon — le libellé doit donc dire « automatiquement » et non nommer un validateur, sinon
  // l'historique laisse croire qu'une personne a signé.
  Automatic: 'Validé automatiquement',
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
  // Ajouté avec KRM-B-08 : c'est une pièce que le produit peut exiger, que l'article 13.6 de la
  // CIMA exige sur une vente à distance, et qu'un validateur peut demander de reprendre. Sans
  // libellé, l'écran de décision affichait « ProofOfAddress ».
  ProofOfAddress: 'Justificatif de domicile',
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

// ——————————————————————————————————————————————————————————————————————
// Liens de collecte à distance (KRM-F-07)
// ——————————————————————————————————————————————————————————————————————

export interface KycRemoteInvitationStatusMeta {
  label: string;
  severity: Severity;
  /** Ce que l'agent peut faire, en une phrase. Vide quand il n'y a rien à faire. */
  hint: string;
}

/**
 * Les huit états d'un lien.
 *
 * Huit et pas deux, parce qu'un agent qui regarde un client qui n'a pas fini a besoin de savoir
 * **où** il s'est arrêté : un lien que personne n'a ouvert est un problème de délivrabilité, un
 * lien ouvert mais jamais identifié est un client qui n'a pas son email de bienvenue sous les yeux,
 * et un lien verrouillé après cinq essais est quelqu'un d'autre qui le détient. Trois situations,
 * trois actions différentes — c'est tout l'intérêt de ne pas afficher « en cours ».
 */
const REMOTE_INVITATION_STATUS_META: Record<string, KycRemoteInvitationStatusMeta> = {
  Scheduled: {
    label: 'Programmé',
    severity: 'neutral',
    hint: "L'email part dans quelques minutes, après celui de bienvenue qui porte le numéro client.",
  },
  Sent: {
    label: 'Envoyé',
    severity: 'info',
    hint: "Remis au service d'envoi. Rien ici ne prouve la réception.",
  },
  Opened: {
    label: 'Ouvert',
    severity: 'info',
    hint: 'Le lien a été ouvert, sans identification pour le moment.',
  },
  Identified: {
    label: 'Identifié',
    severity: 'info',
    hint: 'Le client est entré dans son dossier et dépose ses pièces.',
  },
  Submitted: {
    label: 'Dossier transmis',
    severity: 'success',
    hint: 'Les pièces sont arrivées : le lien est consommé.',
  },
  Expired: {
    label: 'Expiré',
    severity: 'warning',
    hint: 'La durée de validité est écoulée. Renvoyez un lien ou proposez un passage en agence.',
  },
  Revoked: {
    label: 'Révoqué',
    severity: 'neutral',
    hint: 'Ce lien a été retiré ; le motif est indiqué.',
  },
  Locked: {
    label: 'Verrouillé',
    severity: 'warning',
    hint: "Trop d'échecs d'identification. Seul un nouveau lien remet le client en route.",
  },
};

export function kycRemoteInvitationStatusMeta(
  status: string | null | undefined,
): KycRemoteInvitationStatusMeta {
  return (
    REMOTE_INVITATION_STATUS_META[status ?? ''] ?? {
      label: status ?? '—',
      severity: 'neutral' as Severity,
      hint: '',
    }
  );
}

const REMOTE_INVITATION_PURPOSE_LABELS: Record<string, string> = {
  Initial: 'Collecte initiale',
  Complement: 'Complément demandé',
};

export function kycRemoteInvitationPurposeLabel(purpose: string | null | undefined): string {
  return REMOTE_INVITATION_PURPOSE_LABELS[purpose ?? ''] ?? purpose ?? '—';
}

/**
 * Pourquoi aucun lien ne peut être envoyé.
 *
 * Le serveur réévalue ces trois causes à chaque lecture plutôt que de les stocker : elles changent
 * toutes seules — un agent ajoute l'email manquant, un administrateur active le KYC à distance sur
 * le produit, le dossier avance. Un motif figé continuerait d'annoncer « pas d'email » des minutes
 * après qu'on en a saisi un.
 */
const REMOTE_INVITATION_UNAVAILABLE_LABELS: Record<string, string> = {
  KYC_REMOTE_INVITATION_NO_EMAIL:
    "Ce client n'a pas d'adresse email : ajoutez-en une sur sa fiche pour pouvoir lui envoyer un lien.",
  KYC_REMOTE_INVITATION_PRODUCT_NOT_ELIGIBLE:
    "Le produit souscrit n'autorise pas le dépôt des pièces à distance. Un administrateur peut l'activer sur la fiche du produit.",
  KYC_REMOTE_INVITATION_FILE_NOT_COLLECTING:
    "Ce dossier n'est plus en collecte : la vérification ou la validation est en cours.",
  KYC_FILE_NOT_FOUND: "Ce dossier n'est pas accessible.",
};

export function kycRemoteUnavailableLabel(code: string | null | undefined): string {
  if (!code) return '';
  return (
    REMOTE_INVITATION_UNAVAILABLE_LABELS[code]
    ?? "Aucun lien ne peut être envoyé pour ce dossier pour le moment."
  );
}

// ——————————————————————————————————————————————————————————————————————
// Routage des dossiers à distance (KRM-B-08, affiché par KRM-F-08)
// ——————————————————————————————————————————————————————————————————————

/**
 * Pourquoi un dossier collecté à distance arrive devant un humain.
 *
 * Le serveur renvoie un **code** (`KycRoutingReasons`) et jamais une phrase : il est compté dans
 * le reporting conformité et il voyage dans l'email envoyé à l'agent. La phrase est ici, une seule
 * fois, et c'est aussi ce qui permet de la changer sans toucher au backend.
 *
 * **Un code inconnu ne s'affiche jamais tel quel.** Le repli dit la seule chose qui soit vraie
 * dans tous les cas — un humain doit regarder le dossier — au lieu de montrer
 * « QUALITY_RETRIES_EXCEEDED » à un chef d'agence. Même règle que `kycQualityCauseLabel` côté
 * client.
 */
const ROUTING_REASON_LABELS: Record<string, string> = {
  PRODUCT_POLICY: 'Le produit souscrit demande une validation humaine.',
  AUTO_APPROVAL_DISABLED:
    "L'établissement n'autorise pas l'approbation sans intervention humaine.",
  TIER_ABOVE_AUTO_LIMIT:
    "Le niveau exigé par le produit dépasse le plafond accordé sans validation humaine.",
  SCORE_BELOW_THRESHOLD: 'Score de confiance inférieur au seuil du produit.',
  BLOCKING_FLAG: 'Un contrôle automatique a signalé une anomalie sur la pièce.',
  IDENTITY_MISMATCH:
    "Le nom, les prénoms ou la date de naissance lus sur la pièce ne correspondent pas à la fiche client.",
  PEP: "Personne politiquement exposée : l'autorisation relève de la direction générale.",
  HIGH_VIGILANCE: 'Vigilance renforcée ou revue en cours sur ce dossier.',
  FACE_RETRY: "La comparaison faciale n'a pas abouti dès la première tentative.",
  MISSING_DOCUMENT: 'Une pièce exigée par le produit manque au dossier.',
  QUALITY_RETRIES_EXCEEDED:
    'Le client a reprises ses photos plus de fois que le paramétrage ne le prévoit.',
  PROOF_OF_ADDRESS_REQUIRED:
    "Aucun justificatif de domicile accepté et récent au dossier (CIMA LBC/FT article 13.6).",
};

const ROUTING_REASON_FALLBACK =
  'Ce dossier demande une décision humaine. Vérifiez la pièce, le selfie et le score ci-dessous.';

export function kycRoutingReasonLabel(reason: string | null | undefined): string {
  if (!reason) return ROUTING_REASON_FALLBACK;
  return ROUTING_REASON_LABELS[reason.trim().toUpperCase()] ?? ROUTING_REASON_FALLBACK;
}

/**
 * Les pièces qu'un validateur peut demander au client de reprendre (KRM-B-10).
 *
 * Les valeurs sont les noms de `KycDocumentKind` côté serveur, parce qu'elles partent telles
 * quelles dans `DecideKycApprovalRequest.requestedDocuments` et deviennent la portée du nouveau
 * lien. Le serveur refuse une pièce que la politique du produit ne collecte pas — l'écran propose
 * donc la liste complète et laisse le serveur trancher, plutôt que de recopier ici une règle qui
 * dépend du produit.
 */
export const KYC_RETAKABLE_DOCUMENTS = [
  'IdentityDocumentFront',
  'IdentityDocumentBack',
  'Selfie',
  'ProofOfAddress',
].map((value) => ({ value, label: kycDocumentKindLabel(value) }));
