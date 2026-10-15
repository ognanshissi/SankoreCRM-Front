/**
 * Avancement d'un dossier KYC en cinq étapes, partagé par la fiche du dossier et l'aperçu de la
 * liste : deux écrans qui calculeraient chacun le leur finiraient par se contredire sur le même
 * dossier.
 *
 * Déduit du statut, du score et des pièces : aucun champ du contrat ne le dit à lui seul, et le
 * statut seul confond « pas de pièce » et « pas de score ».
 */

/** Statuts où le palier est accordé : le dossier a passé le circuit. */
export const KYC_VALIDATED_STATUSES = ['Simplified', 'Full', 'UnderReview'];

export type KycStepState = 'done' | 'current' | 'todo';

export interface KycProgressInput {
  status: string | null | undefined;
  confidenceScore: number | null | undefined;
  validatedAt: string | null | undefined;
  /** Nombre de pièces, ou `null` tant que la liste n'est pas lue. */
  documentCount: number | null;
}

/** États des cinq étapes : ouvert, pièces, score, validation, validé. */
export function kycProgressStates(input: KycProgressInput): KycStepState[] {
  const status = input.status ?? '';
  const validated = KYC_VALIDATED_STATUSES.includes(status) || !!input.validatedAt;
  const hasScore = input.confidenceScore !== null && input.confidenceScore !== undefined;
  // Pièces pas encore relues : on s'en tient au statut plutôt que d'afficher « aucune pièce ».
  const hasDocs =
    input.documentCount === null ? status !== 'Collecting' : input.documentCount > 0;

  const done = [true, hasDocs || hasScore || validated, hasScore || validated, validated, validated];
  const current = done.indexOf(false);
  return done.map((d, i) => (d ? 'done' : i === current ? 'current' : 'todo'));
}
