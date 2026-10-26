import { HttpErrorResponse } from '@angular/common/http';
import {
  MarkDocumentSentRequestChannelEnum,
  MoveOperationRequestStatusEnum,
  RecordPremiumPaymentRequestPaymentMethodEnum,
  RecordUnderwritingRequestOutcomeEnum,
  RequestOperationRequestKindEnum,
} from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';
import { integrationErrorMessage } from '../data-access/integration-facade.service';

/**
 * Libellés et messages de l'après-vente assurance : souscriptions suivies depuis la fiche
 * client, demandes sur une police, documents de l'assureur.
 *
 * Gardés ici plutôt que dans `integration-referential.ts`, que d'autres écrans tiennent : ces
 * libellés ne servent qu'aux blocs et tiroirs de ce dossier.
 */

interface Meta {
  label: string;
  severity: Severity;
}

// ——— Souscriptions ———

const SUBSCRIPTION_STATUS: Record<string, Meta> = {
  Prepared: { label: 'Préparée, en attente d’envoi', severity: 'neutral' },
  PendingDebit: { label: 'Prélèvement de la prime en cours', severity: 'info' },
  Debited: { label: "Prime prélevée — en attente de l'assureur", severity: 'info' },
  PaymentRecorded: { label: "Prime encaissée — en attente de l'assureur", severity: 'info' },
  AwaitingPremium: { label: "Envoyée à l'assureur — prime à payer", severity: 'warning' },
  Issued: { label: 'Police émise', severity: 'success' },
  DebitFailed: { label: 'Prélèvement refusé : rien n’a été envoyé à l’assureur', severity: 'error' },
  Reversing: { label: 'Remboursement de la prime en cours', severity: 'warning' },
  Reversed: { label: 'Prime remboursée au client', severity: 'neutral' },
  PremiumRefundDue: { label: 'Prime à rembourser au client', severity: 'error' },
  Refused: { label: 'Close sans couverture', severity: 'error' },
  Cancelled: { label: 'Annulée', severity: 'neutral' },
};

export function subscriptionStatusMeta(status: string | null | undefined): Meta {
  return SUBSCRIPTION_STATUS[status ?? ''] ?? { label: status || '—', severity: 'neutral' };
}

/** Une souscription terminée ne prend plus de réponse : le serveur la refuserait. */
export const ENDED_SUBSCRIPTION_STATUSES = [
  'DebitFailed',
  'Reversing',
  'Reversed',
  'PremiumRefundDue',
  'Refused',
  'Cancelled',
];

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  CoreBankingDebit: 'Prélèvement sur le compte du client',
  RecordedByAgent: "Encaissée par l'agent",
  InsurerCollects: "Encaissée par l'assureur",
  DeferredByDerogation: 'Paiement sous 60 jours (dérogation)',
};

const UNDERWRITING: Record<string, Meta> = {
  Accepted: { label: 'Acceptée', severity: 'success' },
  AcceptedWithSurcharge: { label: 'Acceptée avec surprime', severity: 'warning' },
  AcceptedWithExclusions: { label: 'Acceptée avec exclusions', severity: 'warning' },
  MedicalExamsRequired: { label: 'Examens médicaux demandés', severity: 'info' },
  Refused: { label: 'Refusée', severity: 'error' },
  DeemedAcceptedBySilence: { label: 'Acceptée tacitement (15 jours sans réponse)', severity: 'success' },
};

export function underwritingMeta(outcome: string | null | undefined): Meta {
  return UNDERWRITING[outcome ?? ''] ?? { label: outcome || '—', severity: 'neutral' };
}

/** Ce qu'un agent peut lire dans une lettre de l'assureur ; le silence a son propre bouton. */
export const UNDERWRITING_OUTCOME_OPTIONS = [
  { value: RecordUnderwritingRequestOutcomeEnum.Accepted, label: 'Acceptée' },
  { value: RecordUnderwritingRequestOutcomeEnum.AcceptedWithSurcharge, label: 'Acceptée avec surprime' },
  { value: RecordUnderwritingRequestOutcomeEnum.AcceptedWithExclusions, label: 'Acceptée avec exclusions' },
  { value: RecordUnderwritingRequestOutcomeEnum.MedicalExamsRequired, label: 'Examens médicaux demandés' },
  { value: RecordUnderwritingRequestOutcomeEnum.Refused, label: 'Refusée' },
];

export const CLIENT_ANSWER_LABELS: Record<string, string> = {
  Accepted: 'Le client accepte les conditions',
  Declined: 'Le client refuse les conditions',
};

export const PAYMENT_METHOD_OPTIONS = [
  { value: RecordPremiumPaymentRequestPaymentMethodEnum.Cash, label: 'Espèces au guichet' },
  { value: RecordPremiumPaymentRequestPaymentMethodEnum.MobileMoney, label: 'Mobile Money' },
  { value: RecordPremiumPaymentRequestPaymentMethodEnum.BankTransfer, label: 'Virement' },
  { value: RecordPremiumPaymentRequestPaymentMethodEnum.Cheque, label: 'Chèque' },
];

/** Délai légal de réponse de l'assureur, après lequel le silence vaut acceptation. */
export const INSURER_ANSWER_DAYS = 15;

// ——— Demandes sur une police ———

export const OPERATION_KIND_LABELS: Record<string, string> = {
  Renunciation: 'Renonciation',
  Surrender: 'Rachat',
  Advance: 'Avance',
};

export const OPERATION_KIND_OPTIONS = [
  { value: RequestOperationRequestKindEnum.Renunciation, label: 'Renonciation (30 jours, assurance vie)' },
  { value: RequestOperationRequestKindEnum.Surrender, label: 'Rachat' },
  { value: RequestOperationRequestKindEnum.Advance, label: 'Avance' },
];

const OPERATION_STATUS: Record<string, Meta> = {
  Requested: { label: 'Reçue', severity: 'info' },
  SentToInsurer: { label: "Transmise à l'assureur", severity: 'info' },
  Accepted: { label: "Acceptée par l'assureur", severity: 'warning' },
  Refused: { label: "Refusée par l'assureur", severity: 'error' },
  Paid: { label: 'Payée', severity: 'success' },
  Cancelled: { label: 'Annulée', severity: 'neutral' },
};

export function operationStatusMeta(status: string | null | undefined): Meta {
  return OPERATION_STATUS[status ?? ''] ?? { label: status || '—', severity: 'neutral' };
}

export interface OperationStep {
  status: MoveOperationRequestStatusEnum;
  label: string;
}

/** Les transitions que le serveur admet ; une demande payée, refusée ou annulée est close. */
export const OPERATION_NEXT_STEPS: Record<string, OperationStep[]> = {
  Requested: [
    { status: MoveOperationRequestStatusEnum.SentToInsurer, label: "Transmise à l'assureur" },
    { status: MoveOperationRequestStatusEnum.Cancelled, label: 'Annuler la demande' },
  ],
  SentToInsurer: [
    { status: MoveOperationRequestStatusEnum.Accepted, label: 'Acceptée' },
    { status: MoveOperationRequestStatusEnum.Refused, label: 'Refusée' },
    { status: MoveOperationRequestStatusEnum.Paid, label: 'Payée' },
  ],
  Accepted: [{ status: MoveOperationRequestStatusEnum.Paid, label: 'Payée' }],
};

export const REFUND_BLOCKED_KYC_MESSAGE =
  "Remboursement bloqué : le KYC du client n'est pas complet (LBC/FT).";

// ——— Documents de l'assureur ———

export const POLICY_DOCUMENT_KIND_LABELS: Record<string, string> = {
  GeneralConditions: 'Conditions générales',
  SpecialConditions: 'Conditions particulières',
  Certificate: 'Attestation',
  Endorsement: 'Avenant',
  AnnualStatement: 'Information annuelle (art. 75)',
  Other: 'Autre document',
};

export const POLICY_DOCUMENT_KIND_OPTIONS = Object.entries(POLICY_DOCUMENT_KIND_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export const DOCUMENT_CHANNEL_OPTIONS = [
  { value: MarkDocumentSentRequestChannelEnum.HandedOnPaper, label: 'Remis en main propre (papier)' },
  { value: MarkDocumentSentRequestChannelEnum.ShownOnScreen, label: "Lu avec le client à l'écran" },
  { value: MarkDocumentSentRequestChannelEnum.SentByEmail, label: 'Envoyé par e-mail' },
  { value: MarkDocumentSentRequestChannelEnum.CustomerSpace, label: 'Mis à disposition dans son espace' },
];

export const DOCUMENT_CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  DOCUMENT_CHANNEL_OPTIONS.map((o) => [o.value, o.label]),
);

export const POLICY_DOCUMENT_MAX_SIZE_MB = 20;

// ——— Dates ———

/** Aujourd'hui en `yyyy-MM-dd` local : `toISOString()` donnerait la veille à l'est d'UTC le soir. */
export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Date locale d'un instant (`2026-10-25T23:30:00Z`). `formatContractDate` découpe la chaîne et
 * rendrait le jour UTC ; un instant se lit dans le fuseau de l'agent.
 */
export function formatInstantDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('fr-FR');
}

/** Montant saisi en texte (« 12 500,50 ») vers un nombre ; `null` si illisible. */
export function parseAmount(raw: string | null | undefined): number | null {
  const text = (raw ?? '').replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// ——— Erreurs ———

/**
 * Codes propres à l'après-vente, que `integrationErrorMessage` ne connaît pas ; le reste lui
 * est délégué.
 *
 * `INSURANCE_AFTER_SALE_INVALID: <détail>` porte une règle métier refusée, rédigée en anglais
 * par le serveur. Le détail est gardé à la suite d'un message français : le masquer laisserait
 * l'agent sans aucune piste sur ce qui bloque.
 */
export function afterSaleErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as { code?: string; error?: string } | undefined;
  const code = body?.code ?? body?.error ?? '';

  if (code.startsWith('INSURANCE_AFTER_SALE_INVALID')) {
    const detail = code.slice('INSURANCE_AFTER_SALE_INVALID'.length).replace(/^:\s*/, '').trim();
    const generic = "Cette opération n'est pas possible dans l'état actuel du dossier.";
    return detail ? `${generic} (Détail du serveur : ${detail})` : generic;
  }

  switch (code) {
    case 'INSURANCE_NO_COLLECTION_MANDATE':
      return "Cet assureur encaisse lui-même la prime : l'institution n'a pas de mandat d'encaissement, donc le paiement ne s'enregistre pas ici. Le client règle directement l'assureur.";
    case 'INSURANCE_RENUNCIATION_NOT_LIFE':
      return "Ce produit n'est pas une assurance vie : pas de renonciation.";
    case 'INSURANCE_RENUNCIATION_PERIOD_OVER':
      return 'Le délai de 30 jours est dépassé.';
    case 'INSURANCE_OPERATION_IN_PROGRESS':
      return 'Une demande du même type est déjà en cours sur ce contrat : attendez sa conclusion.';
    case 'INSURANCE_REFUND_BLOCKED_KYC':
      return REFUND_BLOCKED_KYC_MESSAGE;
    case 'INSURANCE_PAYOUT_INSTRUMENT_INVALID':
      return "Le moyen de versement choisi n'appartient pas au client, ou n'est plus actif.";
    case 'INSURANCE_OPERATION_NOT_FOUND':
      return "Cette demande n'existe pas, ou n'est pas dans votre périmètre.";
    case 'INSURANCE_SUBSCRIPTION_NOT_FOUND':
      return "Cette souscription n'existe pas, ou n'est pas dans votre périmètre.";
    case 'INSURANCE_POLICY_DOCUMENT_NOT_FOUND':
      return "Ce document n'existe pas, ou plus.";
    case 'INSURANCE_POLICY_DOCUMENT_NOT_PDF':
      return `Le document doit être un PDF de ${POLICY_DOCUMENT_MAX_SIZE_MB} Mo au plus.`;
    default:
      return integrationErrorMessage(error, fallback);
  }
}
