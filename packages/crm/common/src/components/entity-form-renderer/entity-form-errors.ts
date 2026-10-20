import { HttpErrorResponse } from '@angular/common/http';
import { EntityFormDto } from '@sankore/crm-api';

const MESSAGES: Record<string, string> = {
  FIELD_REQUIRED: 'ce champ est obligatoire.',
  CUSTOM_FIELD_REQUIRED: 'ce champ est obligatoire.',
  CUSTOM_FIELD_INVALID: 'la valeur saisie n’est pas valide.',
  CUSTOM_FIELD_UNKNOWN_OPTION: 'cette option n’existe plus, rechargez la page.',
  CUSTOM_FIELD_OUT_OF_RANGE: 'la valeur sort des limites autorisées.',
  CUSTOM_FIELD_TOO_LONG: 'le texte est trop long.',
  CUSTOM_FIELD_PATTERN_MISMATCH: 'le format n’est pas respecté.',
  CUSTOM_FIELD_UNKNOWN: 'ce champ n’existe plus, rechargez la page.',
  CUSTOM_FIELD_ARCHIVED: 'ce champ a été archivé entre-temps, rechargez la page.',
  CUSTOM_FIELDS_UNAVAILABLE: 'les réglages du formulaire sont momentanément indisponibles, réessayez.',
  // Le jeton de version d'une fiche : quelqu'un l'a modifiée depuis son chargement.
  CONFLICT: 'la fiche a été modifiée entre-temps, rechargez-la avant d’enregistrer.',
  CONCURRENCY_CONFLICT: 'la fiche a été modifiée entre-temps, rechargez-la avant d’enregistrer.',
  CLIENT_READ_ONLY: 'cette fiche n’est plus modifiable.',
};

/** Le code du refus (`CODE:clé`), où que le serveur l'ait mis dans le corps. */
export function formErrorDetail(err: HttpErrorResponse): string {
  const body = err.error;
  if (typeof body === 'string') return body;
  return body?.detail ?? body?.error ?? body?.title ?? '';
}

/**
 * Un refus lié au formulaire dynamique, en une phrase qui nomme le champ : « « Segment » : ce champ
 * est obligatoire. ». Null quand le refus est d'une autre nature — l'appelant garde alors son propre
 * message, qui connaît son endpoint (doublon, agence hors périmètre…).
 */
export function explainFormError(detail: string | null | undefined, form: EntityFormDto | null): string | null {
  if (!detail) return null;
  const [code, key] = detail.split(':', 2);
  const message = MESSAGES[code];
  if (!message) return null;
  if (!key) return message.charAt(0).toUpperCase() + message.slice(1);
  const label = (form?.fields ?? []).find((f) => f.key === key)?.label ?? key;
  return `« ${label} » : ${message}`;
}

/**
 * Une chaîne du formulaire vers une valeur d'énumération du contrat, vérifiée à l'exécution :
 * `undefined` si elle n'en fait pas partie. C'est ce qui évite un `as any` sur un champ d'énumération.
 */
export function asEnum<T extends string>(values: Record<string, T>, value: unknown): T | undefined {
  return typeof value === 'string' && (Object.values(values) as string[]).includes(value) ? (value as T) : undefined;
}
