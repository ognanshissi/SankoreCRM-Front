import { HttpErrorResponse } from '@angular/common/http';
import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés et métadonnées du module Téléphonie.
 *
 * Le contrat type en `string` nue tout ce qui est une énumération côté serveur
 * (`TelephonyCallContext.direction`, `.status`, `.matchStatus`, le `entityType` des
 * candidats) : sans table de correspondance ici, chaque écran réinvente ses libellés et
 * ses couleurs, et deux écrans finissent par appeler le même état autrement. Tout ce qui
 * est affiché à l'utilisateur part donc d'ici.
 */

/**
 * Libellé générique d'un code que le front ne connaît pas.
 *
 * Les énumérations du back grandissent — un nouveau fournisseur de téléphonie apporte
 * ses propres statuts, et `TelCallDirection.Internal` est déjà documenté comme « une
 * valeur qu'un fournisseur peut ne jamais produire ». Un accès direct `MAP[value]`
 * rendrait un nouveau code en cellule vide (`undefined` interpolé), et un accès
 * indexé strict le ferait planter. On passe donc TOUJOURS par `telLabel`.
 */
export const TEL_UNKNOWN_LABEL = 'Point à vérifier';

/** Valeur affichée quand le serveur n'a rien renvoyé du tout — distinct d'un code inconnu. */
export const TEL_EMPTY_LABEL = '—';

/**
 * Lecture d'une table de libellés, tolérante au code inconnu.
 *
 * Ne lève jamais et ne bloque jamais l'écran : un statut ajouté côté serveur s'affiche
 * « Point à vérifier » et la ligne reste lisible, au lieu de disparaître ou de casser la
 * liste entière.
 */
export function telLabel(
  map: Readonly<Record<string, string | undefined>>,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return TEL_EMPTY_LABEL;
  // Test de propriété PROPRE, et pas seulement `?? ` : un code qui s'appellerait
  // « toString » ou « constructor » remonterait la propriété du prototype et afficherait
  // une fonction au lieu d'un libellé.
  if (!Object.prototype.hasOwnProperty.call(map, value)) return TEL_UNKNOWN_LABEL;
  return map[value] ?? TEL_UNKNOWN_LABEL;
}

/** Même tolérance pour les gravités de `<tas-tag [severity]>` : un code inconnu reste neutre. */
export function telSeverity(
  map: Readonly<Record<string, Severity | undefined>>,
  value: string | null | undefined,
): Severity {
  if (value === null || value === undefined || value === '') return 'neutral';
  if (!Object.prototype.hasOwnProperty.call(map, value)) return 'neutral';
  return map[value] ?? 'neutral';
}

// ——— Statut de l'appel ———

/**
 * `TelCallStatus` du back : six valeurs, et pas une paire de booléens — un appel qui a
 * sonné sans décroché est un client qui peut rappeler, un renvoi messagerie est un
 * message en attente, un échec est un refus opérateur. Trois actions différentes.
 *
 * `Internal` N'EST PAS un statut : c'est une DIRECTION (`TelCallDirection.Internal`) et
 * accessoirement un `TelMatchStatus`. Il est donc déclaré plus bas, pas ici.
 */
export const TEL_CALL_STATUSES = [
  'Ringing',
  'InProgress',
  'Completed',
  'Missed',
  'Voicemail',
  'Failed',
] as const;

export type TelCallStatus = (typeof TEL_CALL_STATUSES)[number];

export const TEL_CALL_STATUS_LABELS: Readonly<Record<TelCallStatus, string>> = {
  Ringing: 'Sonne',
  InProgress: 'En cours',
  Completed: 'Terminé',
  Missed: 'Manqué',
  Voicemail: 'Messagerie',
  Failed: 'Échec',
};

export const TEL_CALL_STATUS_SEVERITIES: Readonly<Record<TelCallStatus, Severity>> = {
  Ringing: 'info',
  InProgress: 'primary',
  Completed: 'success',
  Missed: 'warning',
  Voicemail: 'warning',
  Failed: 'error',
};

export function telCallStatusLabel(value: string | null | undefined): string {
  return telLabel(TEL_CALL_STATUS_LABELS, value);
}

export function telCallStatusSeverity(value: string | null | undefined): Severity {
  return telSeverity(TEL_CALL_STATUS_SEVERITIES, value);
}

// ——— Direction ———

export const TEL_CALL_DIRECTIONS = ['Inbound', 'Outbound', 'Internal'] as const;

export type TelCallDirection = (typeof TEL_CALL_DIRECTIONS)[number];

export const TEL_CALL_DIRECTION_LABELS: Readonly<Record<TelCallDirection, string>> = {
  Inbound: 'Entrant',
  Outbound: 'Sortant',
  Internal: 'Appel interne',
};

export function telCallDirectionLabel(value: string | null | undefined): string {
  return telLabel(TEL_CALL_DIRECTION_LABELS, value);
}

// ——— Rattachement ———

/**
 * `TelMatchStatus` du back. Il porte QUATRE valeurs et non trois : `Internal` y figure
 * aussi (les deux bouts sont des postes de la maison), et il est exclu du SLA et des
 * indicateurs. Sans lui ici, un appel interne s'afficherait « Point à vérifier » alors
 * que le serveur a parfaitement répondu — le repli générique est un filet pour l'inédit,
 * pas pour une valeur déjà documentée.
 */
export const TEL_MATCH_STATUSES = [
  'Matched',
  'Ambiguous',
  'Unknown',
  'Internal',
] as const;

export type TelMatchStatus = (typeof TEL_MATCH_STATUSES)[number];

export const TEL_MATCH_STATUS_LABELS: Readonly<Record<TelMatchStatus, string>> = {
  Matched: 'Rattaché',
  Ambiguous: 'Plusieurs fiches possibles',
  Unknown: 'Numéro inconnu',
  Internal: 'Appel interne',
};

export const TEL_MATCH_STATUS_SEVERITIES: Readonly<Record<TelMatchStatus, Severity>> = {
  Matched: 'success',
  Ambiguous: 'warning',
  Unknown: 'neutral',
  Internal: 'info',
};

export function telMatchStatusLabel(value: string | null | undefined): string {
  return telLabel(TEL_MATCH_STATUS_LABELS, value);
}

export function telMatchStatusSeverity(value: string | null | undefined): Severity {
  return telSeverity(TEL_MATCH_STATUS_SEVERITIES, value);
}

// ——— Enregistrement ———

export const TEL_RECORDING_STATUSES = [
  'Pending',
  'Available',
  'Failed',
  'Purged',
  'NotRecorded',
] as const;

export type TelRecordingStatus = (typeof TEL_RECORDING_STATUSES)[number];

export const TEL_RECORDING_STATUS_LABELS: Readonly<
  Record<TelRecordingStatus, string>
> = {
  Pending: 'Récupération en cours',
  Available: 'Disponible',
  Failed: 'Indisponible',
  Purged: 'Supprimé (fin de conservation)',
  NotRecorded: 'Non enregistré',
};

export const TEL_RECORDING_STATUS_SEVERITIES: Readonly<
  Record<TelRecordingStatus, Severity>
> = {
  Pending: 'info',
  Available: 'success',
  Failed: 'error',
  Purged: 'neutral',
  NotRecorded: 'neutral',
};

export function telRecordingStatusLabel(value: string | null | undefined): string {
  return telLabel(TEL_RECORDING_STATUS_LABELS, value);
}

export function telRecordingStatusSeverity(value: string | null | undefined): Severity {
  return telSeverity(TEL_RECORDING_STATUS_SEVERITIES, value);
}

/** Seul `Available` donne quelque chose à écouter ou à exporter. */
export function isRecordingPlayable(value: string | null | undefined): boolean {
  return value === 'Available';
}

// ——— Entité rattachée ———

/**
 * Le contrat type `entityType` en `string` nue (candidats, requête de rattachement) :
 * l'union est donc déclarée ici, et les écrans transtypent à travers elle plutôt que de
 * comparer des littéraux libres dans chaque template.
 */
export const TELEPHONY_ENTITY_TYPES = ['Lead', 'Customer'] as const;

export type TelephonyEntityType = (typeof TELEPHONY_ENTITY_TYPES)[number];

export const TELEPHONY_ENTITY_TYPE_LABELS: Readonly<
  Record<TelephonyEntityType, string>
> = {
  Lead: 'Lead',
  Customer: 'Client',
};

export function telephonyEntityTypeLabel(value: string | null | undefined): string {
  return telLabel(TELEPHONY_ENTITY_TYPE_LABELS, value);
}

// ——— Numéro masqué ———

/**
 * Numéro masqué : ne rend que les quatre derniers caractères.
 *
 * Aucune lecture téléphonique du serveur ne renvoie de numéro — ni le contexte d'appel,
 * ni le journal, ni les candidats : c'est le choix du back, et il n'est pas à contourner.
 * Cette fonction n'existe donc que pour les rares endroits où le FRONT détient lui-même
 * un numéro, en pratique le numéro d'appelant qu'un administrateur saisit dans les
 * réglages (`SetTelephonyCallerNumberRequest`), et qu'on réaffiche ensuite sans le
 * réétaler en clair dans une liste.
 *
 * Contrairement à `shortId()` côté intégrations, c'est la TÊTE qui est cachée : les
 * quatre derniers chiffres suffisent à reconnaître son propre poste, l'indicatif pays et
 * l'opérateur ne servent qu'à identifier quelqu'un d'autre.
 */
export function maskedPhone(value: string | null | undefined): string {
  if (!value) return TEL_EMPTY_LABEL;
  const trimmed = value.trim();
  if (!trimmed) return TEL_EMPTY_LABEL;
  // Un numéro plus court que le masque ne doit pas se retrouver affiché en entier :
  // on masque la totalité plutôt que de laisser fuir une valeur de trois caractères.
  if (trimmed.length <= 4) return '••••';
  return `•••• ${trimmed.slice(-4)}`;
}

// ——— Messages d'erreur ———

/**
 * Une durée d'appel en français, et la SEULE de la famille.
 *
 * Elle est ici parce que trois écrans l'avaient écrite chacun de leur côté et que la
 * troisième ne rendait pas comme les deux autres : 120 secondes s'affichait « 2 min » sur le
 * tableau de bord et « 2 min 00 s » sur le journal. C'est précisément l'écart que ce fichier
 * existe pour empêcher — deux écrans qui nomment le même état autrement — et il est d'autant
 * plus désagréable ici qu'un superviseur compare justement un chiffre du tableau de bord avec
 * la ligne du journal qui le produit.
 *
 * La forme retenue est celle du tableau de bord, la plus lisible : un reste de zéro seconde
 * est élidé, donc « 2 min » et non « 2 min 00 s », mais « 2 min 05 s » garde ses deux
 * chiffres pour que la colonne reste alignée.
 *
 * `null`, une valeur négative, `NaN` et `Infinity` donnent tous le tiret : aucun n'est une
 * durée, et afficher « 0 s » pour une durée absente serait une affirmation.
 */
export function telDurationLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return TEL_EMPTY_LABEL;
  }

  const total = Math.round(seconds);

  if (total < 60) return `${total} s`;

  const minutes = Math.floor(total / 60);

  if (minutes < 60) {
    const rest = total % 60;

    return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')} s`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;

  return restMinutes === 0
    ? `${hours} h`
    : `${hours} h ${String(restMinutes).padStart(2, '0')} min`;
}

interface TelephonyRefusalBody {
  error?: string;
  code?: string;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
}

/**
 * Le corps d'un refus, qu'il arrive en objet ou en TEXTE.
 *
 * Angular ne désérialise `HttpErrorResponse.error` en objet que si la requête attendait du
 * JSON. Les deux routes `text/csv` de la famille — l'export du journal — forcent
 * `responseType: 'text'`, donc leur refus arrive en CHAÎNE : le `ProblemDetails` sérialisé,
 * non analysé. Lire `.error` dessus donnait `undefined`, et CHAQUE refus d'export tombait
 * dans le message de repli — y compris « période trop large », qui est précisément celui qui
 * dit à l'utilisateur quoi faire.
 *
 * On analyse donc la chaîne quand c'en est une, et on l'ignore sans bruit si ce n'est pas du
 * JSON : un corps d'erreur illisible ne doit pas faire échouer l'affichage d'un message.
 */
function refusalBody(error: HttpErrorResponse): TelephonyRefusalBody | undefined {
  const raw = error?.error;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as TelephonyRefusalBody;
    } catch {
      return undefined;
    }
  }

  return (raw ?? undefined) as TelephonyRefusalBody | undefined;
}

/**
 * Message d'erreur serveur, tel que le reste du repo le remonte : un message générique
 * masque exactement l'information qui fait gagner une heure. Les codes de refus que
 * `TelephonyErrors` déclare sont traduits et disent ce que l'UTILISATEUR doit faire ; le
 * reste retombe sur `errors` puis `title` de `ProblemDetails`, puis `fallback`.
 */
export function telephonyErrorMessage(
  error: HttpErrorResponse,
  fallback: string,
): string {
  const body = refusalBody(error);

  // Le champ s'appelle `error`, pas `code`. Les 44 refus de la famille téléphonie répondent
  // tous `new { error = ... }` côté .NET — vérifié sur l'ensemble des endpoints — et lire
  // `code` faisait tomber CHAQUE refus dans le message de repli : l'agent voyait « une erreur
  // est survenue » là où le serveur nommait précisément le problème et l'action attendue.
  // `code` est conservé en second parce que d'autres modules l'utilisent et que ce helper
  // finira par voir leurs réponses.
  switch (body?.error ?? body?.code) {
    // ——— Famille et rattachement du poste ———
    case 'TELEPHONY_DISABLED':
      return "La téléphonie est désactivée pour votre établissement. Demandez son activation dans les réglages de téléphonie : ce n'est pas une panne.";
    case 'TELEPHONY_USER_NOT_LINKED':
      return "Votre poste n'est pas rattaché au système de téléphonie. Demandez à un administrateur de faire le rattachement dans « Rattachement des postes ».";
    case 'TELEPHONY_USER_LINK_ALREADY_TAKEN':
      return 'Ce compte du fournisseur est déjà rattaché à un autre utilisateur. Détachez-le d’abord, ou choisissez un autre compte.';
    case 'TELEPHONY_USER_LINK_NOT_FOUND':
      return "Ce rattachement n'existe pas, ou plus. Rechargez la liste des postes.";
    case 'TELEPHONY_UNLINK_REASON_REQUIRED':
      return 'Indiquez le motif du détachement : il est conservé au journal.';

    // ——— Appel ———
    case 'TELEPHONY_CALL_NOT_FOUND':
      return "Cet appel n'existe pas, ou plus — ou il n'est pas dans votre périmètre. Rechargez le journal.";
    case 'TELEPHONY_CALL_NOT_ENDED':
      return "L'appel n'est pas terminé : attendez le raccroché avant de le qualifier.";
    case 'TELEPHONY_NUMBER_UNAVAILABLE':
      return "Le numéro n'a pas pu être lu pour cette fiche. Réessayez dans un instant — la fiche n'est pas en cause.";
    case 'TELEPHONY_PROVIDER_REFUSED':
      return "Le fournisseur a refusé l'appel. Vérifiez le numéro de la fiche, puis relancez vous-même : l'appel n'a pas été réessayé automatiquement.";
    case 'TELEPHONY_TEST_NUMBER':
      return "Mode test : seuls les numéros des utilisateurs de l'institution peuvent être appelés. Aucun appel n'a été passé.";

    // ——— Rattachement de l'appel à une fiche ———
    case 'TELEPHONY_ENTITY_NOT_YOURS':
      return "Cette fiche n'est pas dans votre périmètre : vous ne pouvez pas y rattacher l'appel. Passez par un collègue de l'agence concernée.";
    case 'TELEPHONY_ENTITY_REFERENCE_INCOMPLETE':
      return 'Choisissez à la fois le type de fiche et la fiche : les deux vont ensemble.';
    case 'TELEPHONY_ENTITY_TYPE_UNKNOWN':
      return "Ce type de fiche n'est pas accepté ici.";
    case 'TELEPHONY_MANUAL_ATTACHMENT_WINS':
      return "Cet appel a déjà été rattaché à la main : le rattachement automatique ne l'écrase pas. Corrigez-le manuellement si besoin.";
    case 'TELEPHONY_CALL_ALREADY_ATTACHED':
      return 'Cet appel est déjà rattaché à une fiche. Ouvrez-la plutôt que de créer un doublon.';
    case 'TELEPHONY_CALLER_IS_ALREADY_A_CLIENT':
      return "Ce numéro est celui d'un client : l'appel a été rattaché à sa fiche, et aucun lead n'a été créé.";
    case 'TELEPHONY_NOT_AN_INBOUND_CALL':
      return "On ne crée pas de lead depuis un appel sortant : la fiche d'où vous avez appelé est déjà la bonne.";
    case 'TELEPHONY_LEAD_CREATION_FAILED':
      return "La création du lead a échoué. L'appel est inchangé : réessayez, ou créez le lead à la main puis rattachez l'appel.";

    // ——— Qualification ———
    case 'TELEPHONY_OUTCOME_REQUIRED':
      return 'Choisissez un résultat d’appel : la qualification ne se valide pas sans.';
    case 'TELEPHONY_OUTCOME_UNKNOWN':
      return "Ce résultat d'appel n'existe pas ou a été désactivé. Rechargez la liste et choisissez-en un autre.";
    case 'TELEPHONY_OUTCOME_NOT_FOUND':
      return "Ce résultat d'appel n'existe pas dans votre référentiel, ou plus.";
    case 'TELEPHONY_OUTCOME_CODE_ALREADY_USED':
      return 'Ce code existe déjà dans le référentiel, éventuellement désactivé. Réactivez la ligne existante au lieu d’en créer une seconde.';
    case 'TELEPHONY_CALLBACK_DATE_REQUIRED':
      return 'Ce résultat impose une date de rappel : renseignez-la avant d’enregistrer.';

    // ——— Enregistrements ———
    case 'TELEPHONY_RECORDING_NOT_FOUND':
      return "Aucun enregistrement n'est conservé pour cet appel. C'est le cas ordinaire : la plupart des appels n'en ont pas.";
    case 'TELEPHONY_RECORDING_NOT_AVAILABLE':
      return "L'enregistrement n'est pas lisible : il est en cours de récupération, sa récupération a échoué, ou il a été supprimé en fin de conservation. Vérifiez son état dans le journal.";
    case 'TELEPHONY_RECORDING_EXPORT_REASON_REQUIRED':
      return "Indiquez le motif de l'export : il sort l'enregistrement de la plateforme et reste consigné à votre nom.";
    case 'TELEPHONY_RECORDING_DISABLED':
      return "L'enregistrement des appels est désactivé pour votre établissement : il n'y a rien à paramétrer autour.";
    case 'TELEPHONY_RECORDING_LEGAL_BASIS_REQUIRED':
      return "Indiquez la base légale de l'enregistrement : sans elle, les fichiers conservés seraient injustifiables.";
    case 'TELEPHONY_RECORDING_PURPOSE_REQUIRED':
      return 'Indiquez aussi la finalité : « nous pouvons » et « nous avons besoin de » sont deux questions distinctes.';
    case 'TELEPHONY_RECORDING_RETENTION_INVALID':
      return 'La durée de conservation saisie est hors des bornes acceptées.';
    case 'TELEPHONY_RECORDING_DURATION_CEILING_INVALID':
      return 'La durée maximale d’enregistrement saisie est hors des bornes acceptées.';
    case 'TELEPHONY_RECORDING_HOLD_REASON_REQUIRED':
      return 'Indiquez le motif de la conservation exceptionnelle : il devra être relu dans plusieurs années.';

    // ——— Indicateurs ———
    case 'TELEPHONY_STATS_PERIOD_TOO_LONG':
      return 'La période demandée dépasse le maximum autorisé. Resserrez les dates : les chiffres n’ont pas été tronqués, la demande a été refusée.';

    case 'TELEPHONY_EXPORT_TOO_LARGE':
      return 'La période demandée contient trop d’appels pour un seul fichier. Resserrez les dates : rien n’a été tronqué, l’export a été refusé — un fichier incomplet pris pour complet est pire que pas de fichier.';

    // ——— Appels manqués ———
    case 'TELEPHONY_CALL_NOT_MISSED':
      return 'Cet appel n’a pas été manqué : il n’y a donc rien à clôturer. Un appel qui a eu lieu se qualifie avec une issue, il ne se clôture pas.';

    // ——— Emplacements de numéro (click-to-call) ———
    //
    // Les deux codes viennent d'ailleurs — M13 pour un lead, M01 pour un client — et ils
    // arrivent ici parce que le click-to-call relaie le refus du module propriétaire. Les
    // traduire ICI transforme un « peut-être qu'il n'y a pas de numéro » en un fait : aucun
    // endpoint ne dit quels emplacements sont remplis, donc c'est la seule façon pour l'agent
    // de l'apprendre.
    case 'LEAD_PHONE_SLOT_EMPTY':
      return 'Aucun numéro n’est enregistré dans cet emplacement de la fiche. Essayez l’autre emplacement, ou complétez la fiche.';

    case 'UNKNOWN_SENSITIVE_FIELD':
      return 'Aucun numéro n’est enregistré dans cet emplacement de la fiche client. Essayez l’autre emplacement, ou complétez la fiche.';

    // Purge de données, lot 3 : la personne a demandé l'effacement de ses données.
    case 'CLIENT_PROCESSING_RESTRICTED':
      return 'La personne a demandé l’effacement de ses données : nous ne l’appelons plus à notre initiative.';

    default:
      break;
  }

  if (body?.errors) {
    const first = Object.values(body.errors).flat()[0];
    if (first) return first;
  }

  if (error?.status === 403) {
    return "Vous n'avez pas le droit d'effectuer cette action.";
  }

  return body?.detail || body?.title || fallback;
}
