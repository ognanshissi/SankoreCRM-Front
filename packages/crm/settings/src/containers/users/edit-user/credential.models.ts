import { HttpErrorResponse } from '@angular/common/http';

/** Valeurs de `DistributionCredentialCategory` côté serveur (CIMA art. 503). */
export type CredentialCategory = 'GeneralAgent' | 'Broker' | 'Proxy' | 'CounterPresenter';

const CATEGORY_LABELS: Record<CredentialCategory, string> = {
  GeneralAgent: "Agent général d'assurance",
  Broker: 'Courtier',
  Proxy: "Mandataire d'intermédiaire",
  CounterPresenter: 'Présentateur au guichet (banque, IMF)',
};

export const CREDENTIAL_CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as CredentialCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export function credentialCategoryLabel(category: string | null | undefined): string {
  return CATEGORY_LABELS[category as CredentialCategory] ?? category ?? '—';
}

/** `yyyy-MM-dd` → `dd/MM/yyyy`, sans passer par un fuseau. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : value;
}

/**
 * Message français d'un refus du serveur. Les codes métier arrivent sous `error` ; une règle de
 * validation (422) arrive sous `errors`, par champ.
 */
export function credentialErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error.error as { error?: string; errors?: Record<string, string[]> } | undefined;
  switch (body?.error) {
    case 'CREDENTIAL_CARD_NUMBER_ALREADY_RECORDED':
      return 'Ce numéro de carte est déjà enregistré pour un utilisateur de l’institution.';
    case 'CREDENTIAL_SUPERSEDE_REASON_REQUIRED':
      return 'Une carte est déjà en vigueur : indiquez pourquoi elle est remplacée.';
    case 'CREDENTIAL_USER_NOT_FOUND':
      return 'Cet utilisateur est introuvable.';
    case 'CREDENTIAL_NOT_FOUND':
      return 'Aucune carte en vigueur à retirer.';
    case 'CREDENTIAL_ALREADY_CLOSED':
      return 'Cette carte est déjà retirée.';
    case 'CREDENTIAL_CLOSE_REASON_REQUIRED':
      return 'Indiquez le motif du retrait.';
  }
  if (body?.errors && Object.keys(body.errors).length) {
    if (body.errors['ExpiresOn']) return 'L’échéance doit être postérieure à la date de délivrance.';
    return 'Vérifiez les champs saisis : le serveur a refusé la carte.';
  }
  if (error.status === 403) return 'Vous n’avez pas le droit de gérer les cartes professionnelles.';
  return fallback;
}
