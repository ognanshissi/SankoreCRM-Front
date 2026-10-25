import { Severity } from '@talisoft/ui/tag';

/** Pourquoi une personne ne peut pas encore être effacée — les codes de `ErasureEligibility`. */
export function erasureBlockerLabel(code: string | null | undefined): string {
  switch (code) {
    case 'CLIENT_RELATIONSHIP_ACTIVE':
      return 'La relation client est toujours active : la conservation légale (LBC/FT) commence à sa clôture.';
    case 'RETENTION_NOT_REACHED':
      return 'Le client est encore sous sa durée de conservation légale (LBC/FT).';
    case 'KYC_RETENTION_NOT_CLEARED':
      return 'Un dossier KYC est en cours ou suspendu : ses pièces doivent être conservées.';
    default:
      return code ?? '';
  }
}

export function erasureStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'Pending':    return { label: 'À décider', severity: 'warning' };
    case 'Completed':  return { label: 'Effacé', severity: 'success' };
    case 'Restricted': return { label: 'Restreint', severity: 'accent' };
    case 'Rejected':   return { label: 'Refusé', severity: 'neutral' };
    default:           return { label: status ?? '—', severity: 'neutral' };
  }
}

/** Les refus du serveur sur une demande, en français. */
export function erasureErrorMessage(code: string | null | undefined, fallback: string): string {
  switch (code) {
    case 'ERASURE_ALREADY_REQUESTED': return 'Une demande est déjà ouverte pour cette personne.';
    case 'ERASURE_ALREADY_DONE': return 'Les données de cette personne ont déjà été effacées.';
    case 'ERASURE_FOUR_EYES': return 'Vous avez enregistré cette demande : une autre personne doit la décider.';
    case 'ERASURE_NOT_PENDING': return 'Cette demande a déjà été décidée.';
    case 'ERASURE_REQUEST_NOT_FOUND':
    case 'ERASURE_SUBJECT_NOT_FOUND': return 'Introuvable, ou hors de votre périmètre.';
    default: return fallback;
  }
}
