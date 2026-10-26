import { HttpErrorResponse } from '@angular/common/http';

/**
 * Les refus des étapes marquées d'un gabarit de projet (Paramètres › Étapes des projets) : les
 * questionnaires du produit à l'étape « questionnaires complets » (et ceux des personnes pour
 * gagner le projet), une fiche client à l'étape « ouvre le dossier client », un KYC validé au niveau du produit à l'étape
 * d'approbation et pour gagner le projet. Partagé par l'onglet Projets du lead, celui du client et
 * le tableau des projets, pour que les trois écrans disent la même chose.
 */
export type ProjectGateCode =
  | 'PROJECT_QUESTIONNAIRES_INCOMPLETE'
  | 'PROJECT_CLIENT_FILE_REQUIRED'
  | 'PROJECT_KYC_NOT_APPROVED'
  | 'PROJECT_KYC_TIER_INSUFFICIENT'
  // Conditions de passage d'une étape (montant, date, points à cocher) et circuit de validation lié.
  | 'PROJECT_AMOUNT_REQUIRED'
  | 'PROJECT_CLOSE_DATE_REQUIRED'
  | 'PROJECT_CHECKLIST_INCOMPLETE'
  // Les champs du gabarit qu'une étape exige (propriétaire, 2026-10-26).
  | 'PROJECT_FIELDS_REQUIRED'
  | 'PROJECT_WORKFLOW_PENDING'
  | 'PROJECT_WORKFLOW_REJECTED'
  | 'PROJECT_WORKFLOW_UNAVAILABLE';

const GATE_CODES: ReadonlySet<string> = new Set<ProjectGateCode>([
  'PROJECT_QUESTIONNAIRES_INCOMPLETE',
  'PROJECT_CLIENT_FILE_REQUIRED',
  'PROJECT_KYC_NOT_APPROVED',
  'PROJECT_KYC_TIER_INSUFFICIENT',
  'PROJECT_AMOUNT_REQUIRED',
  'PROJECT_CLOSE_DATE_REQUIRED',
  'PROJECT_CHECKLIST_INCOMPLETE',
  'PROJECT_FIELDS_REQUIRED',
  'PROJECT_WORKFLOW_PENDING',
  'PROJECT_WORKFLOW_REJECTED',
  'PROJECT_WORKFLOW_UNAVAILABLE',
]);

/** Le code de garde que porte une erreur, ou null si c'en est une autre. */
export function projectGateCode(error: HttpErrorResponse): ProjectGateCode | null {
  const detail = (error.error as { detail?: string } | null)?.detail;
  return detail && GATE_CODES.has(detail) ? (detail as ProjectGateCode) : null;
}

/** « Pour passer à « Comité », … » — `target` est l'étape visée, ou null pour « gagner ». */
export function projectGateMessage(code: ProjectGateCode, target: string | null): string {
  const reach = target ? `Pour passer à « ${target} »` : 'Pour gagner ce projet';
  switch (code) {
    case 'PROJECT_QUESTIONNAIRES_INCOMPLETE':
      return `${reach}, les questionnaires que ce produit demande doivent être remplis.`;
    case 'PROJECT_CLIENT_FILE_REQUIRED':
      return `${reach}, son dossier client doit d'abord être ouvert.`;
    case 'PROJECT_KYC_NOT_APPROVED':
      return `${reach}, le dossier KYC du client doit être validé.`;
    case 'PROJECT_KYC_TIER_INSUFFICIENT':
      return `${reach}, le dossier KYC du client doit atteindre le niveau que ce produit exige.`;
    case 'PROJECT_AMOUNT_REQUIRED':
      return `${reach}, le montant du projet doit être renseigné.`;
    case 'PROJECT_CLOSE_DATE_REQUIRED':
      return `${reach}, la date de clôture prévue doit être renseignée.`;
    case 'PROJECT_CHECKLIST_INCOMPLETE':
      return `${reach}, tous les points à vérifier de l'étape en cours doivent être cochés.`;
    case 'PROJECT_FIELDS_REQUIRED':
      return `${reach}, les champs du projet que cette étape exige doivent être renseignés.`;
    case 'PROJECT_WORKFLOW_PENDING':
      return `${reach}, le circuit de validation de l'étape doit être approuvé — il est en attente.`;
    case 'PROJECT_WORKFLOW_REJECTED':
      return `${reach}, le circuit de validation doit être approuvé : il a été refusé. Relancez-le ou marquez le projet perdu.`;
    case 'PROJECT_WORKFLOW_UNAVAILABLE':
      return `${reach}, le circuit de validation doit pouvoir être lu ou lancé : il n'est pas actif ou ne répond pas. Prévenez un administrateur.`;
  }
}
