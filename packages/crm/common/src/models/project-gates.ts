import { HttpErrorResponse } from '@angular/common/http';

/**
 * Les refus des étapes marquées d'un gabarit de projet (Paramètres › Étapes des projets) : une
 * fiche client à l'étape « ouvre le dossier client », un KYC validé au niveau du produit à l'étape
 * d'approbation et pour gagner le projet. Partagé par l'onglet Projets du lead, celui du client et
 * le tableau des projets, pour que les trois écrans disent la même chose.
 */
export type ProjectGateCode = 'PROJECT_CLIENT_FILE_REQUIRED' | 'PROJECT_KYC_NOT_APPROVED' | 'PROJECT_KYC_TIER_INSUFFICIENT';

const GATE_CODES: ReadonlySet<string> = new Set<ProjectGateCode>([
  'PROJECT_CLIENT_FILE_REQUIRED',
  'PROJECT_KYC_NOT_APPROVED',
  'PROJECT_KYC_TIER_INSUFFICIENT',
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
    case 'PROJECT_CLIENT_FILE_REQUIRED':
      return `${reach}, le prospect doit d'abord devenir client : convertissez-le.`;
    case 'PROJECT_KYC_NOT_APPROVED':
      return `${reach}, le dossier KYC du client doit être validé.`;
    case 'PROJECT_KYC_TIER_INSUFFICIENT':
      return `${reach}, le dossier KYC du client doit atteindre le niveau que ce produit exige.`;
  }
}
