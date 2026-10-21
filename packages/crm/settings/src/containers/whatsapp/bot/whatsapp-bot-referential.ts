import { HttpErrorResponse } from '@angular/common/http';

/** Lundi d'abord, comme un agenda ; la valeur est celle du serveur (0 = dimanche). */
export const BOT_DAYS: { day: number; label: string }[] = [
  { day: 1, label: 'Lundi' },
  { day: 2, label: 'Mardi' },
  { day: 3, label: 'Mercredi' },
  { day: 4, label: 'Jeudi' },
  { day: 5, label: 'Vendredi' },
  { day: 6, label: 'Samedi' },
  { day: 0, label: 'Dimanche' },
];

/**
 * Les fuseaux de la zone, nommés par leurs villes. L'institution n'a pas de fuseau à elle : le
 * profil porte celui dans lequel ses horaires sont écrits.
 */
export const BOT_TIME_ZONES = [
  { value: 'Africa/Abidjan', label: 'Abidjan (UTC)' },
  { value: 'Africa/Dakar', label: 'Dakar (UTC)' },
  { value: 'Africa/Bamako', label: 'Bamako (UTC)' },
  { value: 'Africa/Ouagadougou', label: 'Ouagadougou (UTC)' },
  { value: 'Africa/Lome', label: 'Lomé (UTC)' },
  { value: 'Africa/Conakry', label: 'Conakry (UTC)' },
  { value: 'Africa/Porto-Novo', label: 'Porto-Novo (UTC+1)' },
  { value: 'Africa/Niamey', label: 'Niamey (UTC+1)' },
  { value: 'Africa/Douala', label: 'Douala (UTC+1)' },
  { value: 'Africa/Lagos', label: 'Lagos (UTC+1)' },
  { value: 'Europe/Paris', label: 'Paris (UTC+1/+2)' },
];

const ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_BOT_PROFILE_CONFLICT:
    'Ce profil a été modifié entre-temps. Rechargez la page pour repartir de la dernière version.',
  WHATSAPP_BOT_PRODUCT_UNKNOWN: 'Ce produit n’existe pas (ou plus) dans le catalogue.',
  WHATSAPP_BOT_VERSION_NOT_FOUND: 'Cette version n’existe pas.',
  WHATSAPP_BOT_CATALOGUE_UNAVAILABLE: 'Le catalogue produits est momentanément indisponible.',
  WHATSAPP_BOT_INSTRUCTIONS_TOO_LONG: 'Les consignes dépassent 4 000 caractères.',
  WHATSAPP_BOT_MESSAGE_TOO_LONG: 'Un message dépasse 1 000 caractères.',
  WHATSAPP_BOT_FAQ_TOO_LONG: 'La FAQ est trop longue (40 questions, 1 000 caractères chacune au plus).',
  WHATSAPP_BOT_FAQ_INCOMPLETE: 'Chaque question de la FAQ doit avoir sa réponse.',
  WHATSAPP_BOT_FIELD_UNKNOWN: 'Un champ à recueillir n’est pas reconnu.',
  WHATSAPP_BOT_HOURS_INVALID: 'Un créneau horaire est invalide : la fin doit suivre le début.',
  WHATSAPP_BOT_TIMEZONE_UNKNOWN: 'Ce fuseau horaire n’est pas reconnu par le serveur.',
  WHATSAPP_BOT_KEYWORDS_TOO_LONG: 'Trop de mots-clés (40 au plus, 60 caractères chacun).',
  WHATSAPP_BOT_MAX_TURNS_INVALID: 'Le nombre de tours sans réponse doit être compris entre 0 et 10.',
  WHATSAPP_BOT_WINDOW_THRESHOLD_INVALID: 'Le seuil avant fermeture doit être compris entre 0 et 23 h.',
};

/** Le code d'erreur du serveur, traduit ; un code inconnu est rendu tel quel, il sert à chercher la cause. */
export function botErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;
  const code = typeof error.error?.detail === 'string' ? error.error.detail : null;
  if (code) return ERROR_MESSAGES[code] ?? code;
  if (error.status === 403) return 'Vous n’avez pas le droit de paramétrer le chatbot.';
  return fallback;
}
