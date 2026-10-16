import { HttpErrorResponse } from '@angular/common/http';
import { TelephonyCallListItemDto } from '@sankore/crm-api';
import {
  TEL_CALL_DIRECTIONS,
  TEL_CALL_DIRECTION_LABELS,
  TEL_CALL_STATUSES,
  TEL_CALL_STATUS_LABELS,
  TEL_EMPTY_LABEL,
  TEL_MATCH_STATUSES,
  TEL_MATCH_STATUS_LABELS,
  TELEPHONY_ENTITY_TYPES,
  TELEPHONY_ENTITY_TYPE_LABELS,
  telephonyErrorMessage,
  telDurationLabel,
} from '../../data-access/telephony-referential';

/**
 * Vocabulaire, bornes et textes de l'écran Journal des appels (TEL-F-08).
 *
 * Tout ce qui est une table de correspondance vit dans
 * `data-access/telephony-referential.ts` et RIEN n'est recopié ici : ce fichier ne fait
 * que dériver des listes d'options de ces tables, pour qu'un renommage de libellé n'ait
 * qu'un seul endroit à toucher. Les fonctions de mise en forme qui n'ont pas de place
 * dans le référentiel — durées, bornes de journée, noms de fichier — sont ici plutôt que
 * dans le composant, parce que ce sont les seules parties de l'écran qui se testent
 * vraiment.
 */

export type JournalSelectOption = { label: string; value: string };

// ——— Les trois files du serveur ———

/**
 * `TelephonyCallQueue` : trois RÈGLES du serveur, pas trois combinaisons de filtres.
 * `ToQualify` est « terminé ET non qualifié ET non clôturé », et le jour où une quatrième
 * condition s'y ajoute, un front qui aurait reconstruit la règle serait celui qui se
 * tromperait. L'onglet envoie donc `queue` et ne filtre rien lui-même.
 */
export const JOURNAL_QUEUES = ['ToAttach', 'ToQualify', 'ToAssign'] as const;

export type JournalQueue = (typeof JOURNAL_QUEUES)[number];

/** `''` est l'onglet « Tous les appels » : aucun `queue` n'est envoyé. */
export type JournalTabValue = '' | JournalQueue;

export interface JournalTab {
  readonly value: JournalTabValue;
  readonly label: string;
  /** Ce que la file est, en une phrase, affiché sous les onglets. */
  readonly hint: string;
  readonly emptyTitle: string;
  readonly emptyHint: string;
}

export const JOURNAL_TABS: readonly JournalTab[] = [
  {
    value: '',
    label: 'Tous les appels',
    hint: 'Les appels de votre périmètre : les vôtres, ceux attribués à personne et ceux des agences que vous couvrez.',
    emptyTitle: 'Aucun appel sur cette période.',
    emptyHint: 'Élargissez la période ou retirez un filtre.',
  },
  {
    value: 'ToAttach',
    label: 'À rattacher',
    hint: "Les appels dont la fiche n'est pas tranchée : numéro inconnu, ou plusieurs fiches possibles. Rattachez-les pour que la conversation apparaisse dans l'historique du client.",
    emptyTitle: 'Rien à rattacher.',
    emptyHint: 'Tous les appels de cette période sont rattachés à une fiche.',
  },
  {
    value: 'ToQualify',
    label: 'À qualifier',
    hint: "Les appels terminés qui n'ont ni qualification ni clôture. Le serveur tient cette règle : l'écran ne la recalcule pas.",
    emptyTitle: 'Rien à qualifier.',
    emptyHint: 'Chaque appel terminé de cette période a été qualifié ou clôturé.',
  },
  {
    value: 'ToAssign',
    label: 'À attribuer',
    hint: "Vue d'administration : ces appels ne sont attribués à personne, le plus souvent parce que le poste du fournisseur n'est rattaché à aucun utilisateur. La réparation n'est pas un rattachement d'appel mais un rattachement de poste, dans « Rattachement des postes ».",
    emptyTitle: 'Aucun appel sans agent.',
    emptyHint: 'Tous les appels de cette période portent un agent identifié.',
  },
];

// ——— Options des listes déroulantes, dérivées du référentiel ———

export const JOURNAL_DIRECTION_OPTIONS: JournalSelectOption[] = TEL_CALL_DIRECTIONS.map(
  (direction) => ({ label: TEL_CALL_DIRECTION_LABELS[direction], value: direction }),
);

export const JOURNAL_STATUS_OPTIONS: JournalSelectOption[] = TEL_CALL_STATUSES.map((status) => ({
  label: TEL_CALL_STATUS_LABELS[status],
  value: status,
}));

/**
 * Le filtre s'appelle `attachment` côté serveur et prend les valeurs de `TelMatchStatus` :
 * c'est bien l'état du rattachement, pas un booléen.
 */
export const JOURNAL_ATTACHMENT_OPTIONS: JournalSelectOption[] = TEL_MATCH_STATUSES.map(
  (matchStatus) => ({ label: TEL_MATCH_STATUS_LABELS[matchStatus], value: matchStatus }),
);

export const JOURNAL_ENTITY_TYPE_OPTIONS: JournalSelectOption[] = TELEPHONY_ENTITY_TYPES.map(
  (entityType) => ({ label: TELEPHONY_ENTITY_TYPE_LABELS[entityType], value: entityType }),
);

export const JOURNAL_DIRECTIONS = TEL_CALL_DIRECTIONS;
export const JOURNAL_STATUSES = TEL_CALL_STATUSES;
export const JOURNAL_ATTACHMENTS = TEL_MATCH_STATUSES;
export const JOURNAL_ENTITY_TYPES = TELEPHONY_ENTITY_TYPES;

/** 100 lignes est le plafond du serveur ; 50 reste sous la barre sans la frôler. */
export const JOURNAL_PAGE_SIZE_OPTIONS = [10, 20, 50];
export const JOURNAL_DEFAULT_PAGE_SIZE = 20;

/**
 * Un paramètre d'URL est saisi à la main aussi souvent qu'il est partagé. Une valeur hors
 * vocabulaire est ignorée plutôt que renvoyée au serveur, qui refuserait la requête
 * entière — et le filtre paraîtrait actif sans l'être.
 */
export function knownFilterValue(
  raw: string | null | undefined,
  allowed: ReadonlyArray<string>,
): string | null {
  if (!raw) return null;
  return allowed.includes(raw) ? raw : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `entityId`, `crmUserId` et `agencyId` sont déclarés `format: uuid` : un identifiant mal collé reviendrait en 400 sans dire quel champ était fautif. */
export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_PATTERN.test(value.trim());
}

/**
 * Bornes de la période. `from` et `to` sont des `date-time` alors que l'écran se saisit au
 * jour : sans ces bornes, « au 12 mars » exclurait toute la journée du 12.
 */
export function startOfDayIso(day: string | null): string | undefined {
  if (!day) return undefined;
  const parsed = new Date(`${day}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function endOfDayIso(day: string | null): string | undefined {
  if (!day) return undefined;
  const parsed = new Date(`${day}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

// ——— Durées ———

/**
 * Une durée en secondes, en clair.
 *
 * Trois paliers parce qu'un seul format se lit mal : `04:30` pour une sonnerie de quatre
 * secondes se lit « quatre minutes trente » au premier coup d'œil, et `1830 s` pour une
 * demi-heure ne se compare à rien. Les secondes restent affichées sous l'heure, parce que
 * la différence entre un appel de 58 s et un de 3 s est exactement ce qu'on lit dans un
 * journal.
 */
export function secondsLabel(total: number | null | undefined): string {
  // Déléguée au référentiel : trois écrans avaient leur propre version et la troisième ne
  // rendait pas comme les deux autres (« 2 min » contre « 2 min 00 s » pour la même durée).
  // Le nom local est conservé parce qu'il est lu partout dans ce fichier.
  return telDurationLabel(total);
}

/**
 * La durée qui compte sur une ligne de journal.
 *
 * `talkSeconds` est la conversation et `ringSeconds` l'attente : les additionner les
 * confondrait, et n'afficher que la conversation ferait rendre « — » sur un appel manqué
 * alors que « a sonné 22 s » est précisément l'information qui dit s'il valait un rappel.
 * On affiche donc la conversation quand il y en a eu une, et la sonnerie sinon.
 */
export function callDurationLabel(
  item: Pick<TelephonyCallListItemDto, 'talkSeconds' | 'ringSeconds'>,
): string {
  const talk = item.talkSeconds ?? null;
  if (talk !== null && talk > 0) return secondsLabel(talk);

  const ring = item.ringSeconds ?? null;
  if (ring !== null && ring >= 0) return `sonnerie ${secondsLabel(ring)}`;

  return TEL_EMPTY_LABEL;
}

// ——— Ce que la ligne permet de faire ———

/**
 * Rattachement tranché, du point de vue de l'écran.
 *
 * `Internal` est un appel entre deux postes de la maison : il n'a aucune fiche à recevoir.
 * `Matched` AVEC une fiche est tranché. Tout le reste — numéro inconnu, plusieurs fiches
 * possibles, ou un `Matched` dont le serveur n'a pas renvoyé d'identifiant — est à régler.
 *
 * La file autoritaire reste `queue=ToAttach` : cette fonction ne décide pas d'un onglet,
 * elle décide seulement d'afficher un bouton. Le serveur garde le dernier mot.
 */
export function isAttachmentSettled(item: TelephonyCallListItemDto): boolean {
  if (item.matchStatus === 'Internal') return true;
  return item.matchStatus === 'Matched' && !!item.entityId;
}

/**
 * Ligne qui ressemble à une qualification en attente.
 *
 * Volontairement une HEURISTIQUE D'AFFICHAGE et non la règle : la règle est
 * `queue=ToQualify` et elle appartient au serveur. Ce test ne sert qu'à ne pas proposer
 * « Qualifier » sur un appel qui sonne encore ; si le serveur refuse ensuite en 422
 * `TELEPHONY_CALL_NOT_ENDED`, c'est son message qui s'affiche.
 */
export function looksQualifiable(item: TelephonyCallListItemDto): boolean {
  return !!item.endedAt && !item.wrappedUpAt && !item.dismissedAt;
}

// ——— Textes ———

export const LINK_REASON_HINT =
  "Le motif est obligatoire et reste au journal d'audit : un rattachement manuel écrase le rattachement automatique et ne sera plus corrigé par le serveur.";

export const LINK_CORRECTION_NOTICE =
  'Cet appel est déjà rattaché. Un nouveau rattachement remplace le précédent et le motif expliquera pourquoi à celui qui relira.';

/** Nom du fichier exporté : la période rend deux exports distinguables dans un dossier de téléchargements. */
export function csvFileName(from: string | null, to: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  if (from && to) return `journal-appels_${from}_${to}.csv`;
  if (from) return `journal-appels_depuis-${from}.csv`;
  if (to) return `journal-appels_jusqu-${to}.csv`;
  return `journal-appels_${today}.csv`;
}

/**
 * Corps d'erreur relu quand la réponse n'était pas du JSON.
 *
 * L'export CSV est annoncé `text/csv` dans le contrat, donc le client généré pose
 * `responseType: 'text'` — y compris sur un refus. `HttpErrorResponse.error` est alors la
 * CHAÎNE du `ProblemDetails` et non l'objet : sans cette relecture, chaque refus de
 * l'export tomberait dans le message de repli alors que le serveur nommait le problème.
 */
export function parsedErrorBody(error: HttpErrorResponse): HttpErrorResponse {
  if (typeof error?.error !== 'string') return error;
  try {
    return { ...error, error: JSON.parse(error.error) } as HttpErrorResponse;
  } catch {
    return error;
  }
}

/**
 * Message d'erreur du journal.
 *
 * Délègue à `telephonyErrorMessage` — c'est lui qui détient les 44 refus de la famille
 * téléphonie — et n'ajoute QUE les deux codes que le référentiel ne connaît pas encore,
 * parce qu'ils n'existent que sur les deux endpoints de ces écrans. Dès que le
 * référentiel les porte, ces deux `case` disparaissent.
 */
export function isExportTooLarge(error: HttpErrorResponse): boolean {
  const body = parsedErrorBody(error)?.error as { error?: string; code?: string } | undefined;
  return (body?.error ?? body?.code) === 'TELEPHONY_EXPORT_TOO_LARGE';
}

export function journalErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const parsed = parsedErrorBody(error);
  const body = parsed?.error as { error?: string; code?: string } | undefined;

  switch (body?.error ?? body?.code) {
    case 'TELEPHONY_EXPORT_TOO_LARGE':
      // Ce n'est pas une panne : le serveur refuse plutôt que de tronquer un trimestre.
      return 'La période demandée dépasse 20 000 appels. Resserrez les dates ou ajoutez un filtre : rien n’a été tronqué, la demande a été refusée.';
    default:
      break;
  }

  return telephonyErrorMessage(parsed, fallback);
}
