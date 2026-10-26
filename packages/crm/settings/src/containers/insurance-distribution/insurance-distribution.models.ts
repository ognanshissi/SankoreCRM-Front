import { DistributorDocumentDto, UpdateInsuranceDistributorRequestStatusEnum } from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';

export type DistributorKind = 'Approval' | 'FinancialGuarantee' | 'ProfessionalLiability';

/** Au-delà de 60 jours, une échéance n'appelle aucune action : en deçà, on prévient. */
export const EXPIRY_WARNING_DAYS = 60;

/** Le seuil de dérogation est fixé par le texte à 80 fois le SMIG annuel. */
export const DEROGATION_SMIG_FACTOR = 80;

export const DISTRIBUTOR_STATUS_OPTIONS: { label: string; value: UpdateInsuranceDistributorRequestStatusEnum }[] = [
  { label: 'Courtier', value: UpdateInsuranceDistributorRequestStatusEnum.Broker },
  { label: 'Agent général', value: UpdateInsuranceDistributorRequestStatusEnum.GeneralAgent },
  { label: 'Partenaire bancassurance', value: UpdateInsuranceDistributorRequestStatusEnum.BancassurancePartner },
];

/** `expired` porte l'accord : « Agrément échu », « Garantie financière échue ». */
export const DISTRIBUTOR_KIND_META: Record<DistributorKind, { label: string; missing: string; expired: string; hint: string }> = {
  Approval: {
    label: 'Agrément',
    missing: 'manquant',
    expired: 'échu',
    hint: 'Agrément de courtier ou mandat d’agent général.',
  },
  FinancialGuarantee: {
    label: 'Garantie financière',
    missing: 'manquante',
    expired: 'échue',
    hint: 'Exigée du courtier, qui manie les primes.',
  },
  ProfessionalLiability: {
    label: 'Attestation RC professionnelle',
    missing: 'manquante',
    expired: 'échue',
    hint: 'Assurance de responsabilité civile professionnelle.',
  },
};

export const DISTRIBUTOR_KIND_OPTIONS = (Object.keys(DISTRIBUTOR_KIND_META) as DistributorKind[]).map((value) => ({
  label: DISTRIBUTOR_KIND_META[value].label,
  value,
}));

export function distributorStatusLabel(status: string | null | undefined): string {
  return DISTRIBUTOR_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'Non renseigné';
}

export function distributorKindLabel(kind: string | null | undefined): string {
  return DISTRIBUTOR_KIND_META[kind as DistributorKind]?.label ?? kind ?? '—';
}

/**
 * Copie de `InsuranceDistributorProfile.RequiredKinds` côté serveur : le courtier répond des primes
 * qu'il encaisse et doit les trois pièces, l'agent et le partenaire travaillent sous la garantie de
 * l'assureur. Recopiée pour que la liste suive le statut choisi AVANT l'enregistrement ; la
 * situation qui bloque les souscriptions, elle, vient toujours du serveur.
 */
export function requiredKindsFor(status: string | null | undefined): DistributorKind[] {
  if (!status) return [];
  return status === 'Broker'
    ? ['Approval', 'FinancialGuarantee', 'ProfessionalLiability']
    : ['Approval', 'ProfessionalLiability'];
}

export interface ExpiryMeta {
  label: string;
  severity: Severity;
}

export function expiryMeta(doc: DistributorDocumentDto): ExpiryMeta {
  const days = doc.daysLeft;
  if (days === null || days === undefined) return { label: 'Sans échéance', severity: 'neutral' };
  if (days < 0) return { label: 'Échue', severity: 'error' };
  if (days === 0) return { label: 'Expire aujourd’hui', severity: 'warning' };
  if (days <= EXPIRY_WARNING_DAYS) return { label: `Expire dans ${days} j`, severity: 'warning' };
  return { label: 'Valide', severity: 'success' };
}

export function distributorErrorMessage(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case 'INSURANCE_DISTRIBUTOR_LEGAL_MENTION_REQUIRED':
      return 'Un courtier doit renseigner la mention légale (art. 540).';
    case 'INSURANCE_DISTRIBUTOR_SMIG_INVALID':
      return 'Le SMIG annuel doit être supérieur à zéro, ou laissé vide.';
    case 'INSURANCE_DISTRIBUTOR_DOCUMENT_TOO_LARGE':
      return 'Le fichier dépasse 10 Mo.';
    case 'INSURANCE_DISTRIBUTOR_DOCUMENT_TYPE_NOT_ALLOWED':
      return 'Seuls les fichiers PDF, JPEG et PNG sont acceptés.';
    case 'INSURANCE_DISTRIBUTOR_DOCUMENT_NOT_FOUND':
      return 'Cette pièce est introuvable.';
    // Codes de `DistributorDocument.Record`.
    case 'INSURANCE_DISTRIBUTOR_DOCUMENT_REFERENCE_REQUIRED':
      return 'La référence de la pièce est obligatoire.';
    case 'INSURANCE_DISTRIBUTOR_DOCUMENT_EXPIRY_BEFORE_ISSUE':
      return 'La date d’échéance précède la date de délivrance.';
    default:
      return fallback;
  }
}

export const DISTRIBUTOR_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const DISTRIBUTOR_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
