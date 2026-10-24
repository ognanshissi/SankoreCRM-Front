import { HttpErrorResponse } from '@angular/common/http';

/**
 * Ce que le montant d'un projet représente, fixé par son gabarit (Paramètres › Étapes des
 * projets). La prévision ne les additionne jamais : un décaissement de crédit et une collecte
 * d'épargne sont des flux de sens opposé.
 */
export type ProjectAmountKind = 'Generic' | 'Loan' | 'Premium' | 'Deposit';

export const PROJECT_AMOUNT_KINDS: { value: ProjectAmountKind; label: string; amountLabel: string; flowLabel: string }[] = [
  { value: 'Generic', label: 'Un montant estimé', amountLabel: 'Montant estimé', flowLabel: 'Montant estimé' },
  { value: 'Loan', label: 'Le montant du crédit, à décaisser', amountLabel: 'Montant du crédit', flowLabel: 'Décaissements (crédit)' },
  { value: 'Premium', label: 'La prime annuelle, à encaisser', amountLabel: 'Prime annuelle', flowLabel: 'Primes (assurance)' },
  { value: 'Deposit', label: 'Le montant du dépôt, à collecter', amountLabel: 'Montant du dépôt', flowLabel: 'Collecte (épargne, dépôts)' },
];

function kindOf(kind: string | null | undefined) {
  return PROJECT_AMOUNT_KINDS.find((k) => k.value === kind) ?? PROJECT_AMOUNT_KINDS[0];
}

/** « Montant du crédit », « Prime annuelle »… : le nom du champ montant d'un projet. */
export function projectAmountLabel(kind: string | null | undefined): string {
  return kindOf(kind).amountLabel;
}

/** « Décaissements (crédit) »… : le nom d'une ligne de la prévision. */
export function projectFlowLabel(kind: string | null | undefined): string {
  return kindOf(kind).flowLabel;
}

/**
 * Le message d'un refus de création ou de modification de projet : la date de clôture d'un
 * produit à date critique (crédit de campagne) est obligatoire, sinon le texte du serveur.
 */
export function projectSaveErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error.error as { detail?: string; title?: string } | null;
  if (body?.detail === 'PROJECT_CLOSE_DATE_REQUIRED') {
    return 'La date de clôture est obligatoire pour ce produit : au-delà, l’accord ne sert plus au client.';
  }
  return body?.detail ?? body?.title ?? fallback;
}
