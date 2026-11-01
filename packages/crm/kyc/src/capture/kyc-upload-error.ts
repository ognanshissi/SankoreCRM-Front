import { HttpErrorResponse } from '@angular/common/http';

/**
 * Pourquoi `POST kyc-files/{id}/documents` a refusé une image.
 *
 * Le serveur répond `{ error: CODE }` et jamais de `title` : lire `title`, comme le faisaient les
 * deux écrans de capture, affichait « Réessayez » pour un refus qu'aucun nouvel essai ne lèvera
 * (recette du 2026-10-31). Les erreurs de stockage arrivent en « CODE: détail », d'où le préfixe.
 */
export function kycUploadErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const code = typeof error.error?.error === 'string' ? error.error.error.split(':')[0] : null;

  switch (code) {
    // Un dossier en validation accepte une nouvelle pièce tant que personne n'a signé.
    case 'KYC_APPROVAL_ALREADY_SIGNED':
      return 'Un valideur a déjà signé ce dossier : ses pièces ne peuvent plus être changées. '
        + 'Pour en déposer une autre, il doit demander un complément.';
    case 'KYC_INVALID_TRANSITION':
      return "Le dossier est clos : il n'accepte plus de pièce.";
    case 'KYC_DOCUMENT_TOO_LARGE':
      return "L'image dépasse la taille autorisée. Reprenez-la en plus basse résolution.";
    case 'KYC_DOCUMENT_CONTENT_TYPE_NOT_ALLOWED':
      return "Ce format n'est pas accepté : déposez une image JPEG ou PNG, ou un PDF.";
    case 'KYC_DOCUMENT_EMPTY':
      return "L'image reçue est vide. Reprenez la photo.";
    case 'KYC_FILE_NOT_FOUND':
      return "Ce dossier KYC est introuvable ou n'est pas dans votre périmètre.";
  }

  if (error.status === 403) return "Vous n'avez pas le droit de déposer des pièces sur ce dossier.";
  if (error.status === 413) return "L'image dépasse la taille autorisée. Reprenez-la en plus basse résolution.";
  return error.error?.title ?? fallback;
}
