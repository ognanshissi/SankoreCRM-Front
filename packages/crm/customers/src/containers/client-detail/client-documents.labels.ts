import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés de l'onglet « Documents » (2026-10-26). Le serveur envoie des codes — le type d'un
 * document reste lisible même pour qui n'a pas le droit de l'ouvrir — et c'est ici qu'ils
 * deviennent des mots. Un code inconnu s'affiche tel quel plutôt que de disparaître.
 */
const KIND_LABELS: Record<string, string> = {
  IdentityDocumentFront: "Pièce d'identité — recto",
  IdentityDocumentBack: "Pièce d'identité — verso",
  Selfie: 'Selfie',
  ProofOfAddress: 'Justificatif de domicile',
  InformationSheet: "Fiche d'information",
  'PolicyDocument.GeneralConditions': 'Conditions générales',
  'PolicyDocument.SpecialConditions': 'Conditions particulières',
  'PolicyDocument.Certificate': 'Attestation',
  'PolicyDocument.Endorsement': 'Avenant',
  'PolicyDocument.AnnualStatement': 'Information annuelle',
  'PolicyDocument.Other': "Document de l'assureur",
  ClaimPiece: 'Pièce de sinistre',
  ConsentProof: 'Preuve de consentement',
  ProjectAttachment: 'Pièce jointe de projet',
  TaskAttachment: 'Pièce jointe de tâche',
  WhatsAppMedia: 'Média WhatsApp',
  'ClientDocument.Correspondence': 'Courrier',
  'ClientDocument.Proof': 'Justificatif',
  'ClientDocument.Other': 'Autre document',
  'Message.Email': 'E-mail',
  'Message.Sms': 'SMS',
};

export function documentKindLabel(kind: string | null | undefined): string {
  return (kind && KIND_LABELS[kind]) || kind || 'Document';
}

const SOURCE_LABELS: Record<string, string> = {
  Kyc: 'KYC',
  Insurance: 'Assurance',
  Project: 'Projet',
  Task: 'Tâche',
  WhatsApp: 'WhatsApp',
  Client: 'Fiche client',
  Message: 'Message envoyé',
};

export function documentSourceLabel(source: string | null | undefined): string {
  return (source && SOURCE_LABELS[source]) || source || '—';
}

export const DOCUMENT_SOURCE_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));

export const DOCUMENT_DIRECTION_OPTIONS = [
  { value: 'Collected', label: 'Reçus du client' },
  { value: 'Delivered', label: 'Remis au client' },
];

export function documentDirectionLabel(direction: string | null | undefined): string {
  return direction === 'Delivered' ? 'Remis' : 'Reçu';
}

/** Les mots de chaque source sur l'état d'un document, et leur couleur. */
const STATUS: Record<string, { label: string; severity: Severity }> = {
  // KYC : le verdict d'un validateur
  NotReviewed: { label: 'Non revu', severity: 'neutral' },
  Accepted: { label: 'Accepté', severity: 'success' },
  Refused: { label: 'Refusé', severity: 'error' },
  // Pièce de sinistre : l'antivirus
  Clean: { label: 'Contrôlé', severity: 'success' },
  Infected: { label: 'Bloqué (antivirus)', severity: 'error' },
  ScanFailed: { label: 'Contrôle impossible', severity: 'warning' },
  // Documents remis
  Delivered: { label: 'Remis', severity: 'success' },
  NotSent: { label: 'Pas encore remis', severity: 'warning' },
  // Messages
  Sending: { label: "En cours d'envoi", severity: 'info' },
  Sent: { label: 'Envoyé', severity: 'success' },
  Failed: { label: 'Échec, nouvel essai', severity: 'warning' },
  DeadLettered: { label: 'Non envoyé', severity: 'error' },
  Pending: { label: 'En attente', severity: 'info' },
};

export function documentStatus(status: string | null | undefined): { label: string; severity: Severity } | null {
  if (!status) return null;
  return STATUS[status] ?? { label: status, severity: 'neutral' };
}

/** Canaux de remise (fiche d'information, documents de police) et de consentement. */
const CHANNEL_LABELS: Record<string, string> = {
  HandedOnPaper: 'remis sur papier',
  ShownOnScreen: 'présenté à l’écran',
  SentByEmail: 'envoyé par e-mail',
  CustomerSpace: 'espace client',
  PaperAtCounter: 'papier au guichet',
  ElectronicSignaturePad: 'tablette de signature',
  OneTimeCode: 'code à usage unique',
  CustomerChannel: 'canal du client',
};

/** Les gabarits des messages qu'un client reçoit. */
const TEMPLATE_LABELS: Record<string, string> = {
  'client.welcome': 'Bienvenue',
  'kyc.remote-invitation': 'Lien KYC à distance',
  'kyc.remote-complement': 'Complément KYC demandé',
  'kyc.remote-approved': 'KYC validé',
  'kyc.remote-rejected': 'KYC refusé',
  'kyc.remote-link-expired': 'Lien KYC expiré',
  'kyc.remote-link-locked': 'Lien KYC bloqué',
  'kyc.remote-otp': 'Code de vérification',
  'insurance.follow-up': 'Relance assurance',
  'insurance.premium-payment-due': 'Échéance de prime',
};

/**
 * La précision affichée sous le type : le titre d'un document déposé, le gabarit d'un message,
 * le canal d'une remise. Le champ du serveur porte l'un ou l'autre selon la source.
 */
export function documentDetailLabel(source: string | null | undefined, detail: string | null | undefined): string {
  if (!detail) return '';
  if (source === 'Message') return TEMPLATE_LABELS[detail] ?? detail;
  return CHANNEL_LABELS[detail] ?? detail;
}

export const CLIENT_DOCUMENT_KIND_OPTIONS = [
  { value: 'Correspondence', label: 'Courrier' },
  { value: 'Proof', label: 'Justificatif' },
  { value: 'Other', label: 'Autre document' },
];

/** Ce que le serveur accepte (il relit le type dans les octets ; ceci n'est que le filtre du sélecteur). */
export const CLIENT_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.pptx,.txt,.csv';
export const CLIENT_DOCUMENT_MAX_SIZE_MB = 10;
