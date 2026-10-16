import { HttpErrorResponse } from '@angular/common/http';
import { MissedCallDto, TelephonyCallContext } from '@sankore/crm-api';
import {
  TEL_EMPTY_LABEL,
  telephonyErrorMessage,
} from '../../data-access/telephony-referential';

/**
 * Vocabulaire et mises en forme de l'écran Appels manqués (TEL-F-09).
 *
 * Les libellés d'état, de sens et de rattachement viennent du référentiel
 * (`data-access/telephony-referential.ts`) et ne sont pas recopiés ici. Ce fichier ne
 * porte que ce qui est propre à cet écran : les fenêtres de temps, la lecture d'un
 * regroupement de tentatives, et la phrase qui remplace le nom que le contrat ne renvoie
 * pas.
 */

export type MissedSelectOption = { label: string; value: string };

/**
 * `since` est un `date-time` et le serveur retient 7 jours par défaut. L'écran propose
 * trois fenêtres plutôt qu'un couple de dates : la liste n'est pas paginée, donc une
 * période large n'est pas une page de plus mais une réponse plus lourde, et une file de
 * rappels au-delà de trois mois n'est plus une file.
 */
export const MISSED_SINCE_DAYS = ['7', '30', '90'] as const;

export type MissedSinceDays = (typeof MISSED_SINCE_DAYS)[number];

export const MISSED_DEFAULT_SINCE: MissedSinceDays = '7';

export const MISSED_SINCE_OPTIONS: MissedSelectOption[] = [
  { label: '7 derniers jours', value: '7' },
  { label: '30 derniers jours', value: '30' },
  { label: '90 derniers jours', value: '90' },
];

export const MISSED_PAGE_SIZE_OPTIONS = [10, 20, 50];
export const MISSED_DEFAULT_PAGE_SIZE = 20;

/** Borne basse de la fenêtre. `undefined` sur 7 jours : c'est déjà le défaut du serveur. */
export function missedSinceIso(days: string | null): string | undefined {
  if (!days || days === MISSED_DEFAULT_SINCE) return undefined;

  const count = Number(days);
  if (!Number.isFinite(count) || count <= 0) return undefined;

  const since = new Date(Date.now() - count * 24 * 60 * 60 * 1000);
  return since.toISOString();
}

export function knownSinceDays(raw: string | null | undefined): MissedSinceDays {
  const value = (raw ?? '').trim();
  return (MISSED_SINCE_DAYS as ReadonlyArray<string>).includes(value)
    ? (value as MissedSinceDays)
    : MISSED_DEFAULT_SINCE;
}

// ——— Lecture d'un regroupement ———

/**
 * Le nombre de tentatives, en clair.
 *
 * Le serveur regroupe les tentatives consécutives séparées de moins de trente minutes :
 * une ligne n'est donc pas un appel mais une PERSONNE qui a essayé de joindre
 * l'établissement. Afficher « 3 » tout seul ferait lire trois lignes là où il y en a une,
 * et afficher « 1 tentative » sur chaque ligne solitaire noierait les insistants, qui sont
 * exactement ceux à rappeler d'abord.
 */
export function attemptCountLabel(attemptCount: number | null | undefined): string {
  const count = attemptCount ?? 0;
  if (count <= 1) return '1 tentative';
  return `${count} tentatives`;
}

/**
 * L'étalement du groupe, quand il y en a un.
 *
 * Trois tentatives en quatre minutes et trois tentatives en deux jours ne demandent pas la
 * même réaction : la première est quelqu'un qui attend maintenant, la seconde quelqu'un
 * qui a renoncé. La chaîne est vide pour une tentative unique — il n'y a pas de fenêtre à
 * décrire — et l'appelant n'affiche alors rien plutôt qu'un tiret de plus.
 */
export function attemptWindowLabel(
  call: Pick<MissedCallDto, 'attemptCount' | 'firstAttemptAt' | 'lastAttemptAt'>,
): string {
  if ((call.attemptCount ?? 0) <= 1) return '';

  const first = Date.parse(call.firstAttemptAt ?? '');
  const last = Date.parse(call.lastAttemptAt ?? '');
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return '';

  const minutes = Math.round((last - first) / 60_000);
  if (minutes < 1) return 'en moins d’une minute';
  if (minutes < 60) return `sur ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `sur ${hours} h`;

  return `sur ${Math.round(hours / 24)} j`;
}

// ——— Le nom que la liste ne porte pas ———

export type MissedContextState = 'pending' | 'loading' | 'loaded' | 'error';

export interface MissedContext {
  state: MissedContextState;
  /** Qui a appelé, en une ligne : un nom, une ambiguïté, ou l'absence de fiche. */
  label: string;
  /** Les candidats nommés et visibles, pour le détail de la ligne. */
  names: string[];
  /** Vrai quand au moins un candidat existe mais hors périmètre : il n'a pas de nom. */
  hasHiddenCandidate: boolean;
}

export const MISSED_CONTEXT_PENDING: MissedContext = {
  state: 'pending',
  label: '…',
  names: [],
  hasHiddenCandidate: false,
};

/**
 * Qui a appelé, lu sur `GET calls/{id}/context`.
 *
 * Ni la liste des manqués ni le contexte ne renvoient de numéro, et un candidat
 * `outOfPerimeter` ne porte délibérément AUCUN nom : la personne est connue de
 * l'établissement ailleurs, mais la fiche reste cachée. On le dit, plutôt que de rendre
 * une ligne vide qui ferait chercher un défaut de chargement.
 */
export function missedContextOf(context: TelephonyCallContext): MissedContext {
  const candidates = context.candidates ?? [];
  const named = candidates
    .filter((candidate) => !candidate.outOfPerimeter && !!candidate.displayName)
    .map((candidate) => candidate.displayName as string);
  const hasHiddenCandidate = candidates.some((candidate) => candidate.outOfPerimeter);

  if (named.length === 1) {
    return { state: 'loaded', label: named[0], names: named, hasHiddenCandidate };
  }

  if (named.length > 1) {
    return {
      state: 'loaded',
      label: `${named.length} fiches possibles`,
      names: named,
      hasHiddenCandidate,
    };
  }

  if (hasHiddenCandidate) {
    return {
      state: 'loaded',
      label: 'Fiche hors de votre périmètre',
      names: [],
      hasHiddenCandidate,
    };
  }

  return { state: 'loaded', label: 'Appelant non identifié', names: [], hasHiddenCandidate };
}

export const MISSED_CONTEXT_FAILED: MissedContext = {
  state: 'error',
  label: TEL_EMPTY_LABEL,
  names: [],
  hasHiddenCandidate: false,
};

// ——— Textes ———

export const DISMISS_REASON_HINT =
  "Le motif est obligatoire et reste au journal d'audit, pas sur l'appel : celui qui relira a besoin de la suite des décisions, pas seulement de la dernière.";

export const DISMISS_NOTICE =
  "Clôturer n'est pas qualifier. Une qualification décrit une conversation, crée une activité sur la fiche et peut arrêter une horloge de SLA ; ici, vous dites seulement que personne n'a besoin d'être rappelé.";

export const CREATE_LEAD_CONFIRMATION = {
  title: 'Créer un lead depuis cet appel ?',
  message:
    "Le serveur crée la fiche à partir du numéro de l'appelant — que cet écran ne détient pas — et rattache l'appel à ce nouveau lead. Si le numéro est déjà celui d'un client, aucun lead n'est créé et l'appel est rattaché à sa fiche.",
  acceptLabel: 'Créer le lead',
} as const;

/** Rappel impossible : il n'y a rien à composer, et l'écran le dit au lieu de griser sans raison. */
export const CALLBACK_IMPOSSIBLE_HINT =
  "Aucune fiche n'est rattachée à cet appel. Le rappel part d'une fiche et d'un de ses numéros — le front n'envoie jamais de numéro — donc il faut d'abord créer le lead ou rattacher l'appel à une fiche existante.";

/**
 * Message d'erreur de l'écran.
 *
 * Délègue à `telephonyErrorMessage`, qui détient les refus de la famille téléphonie, et
 * n'ajoute QUE les codes qu'il ne connaît pas encore parce qu'ils n'existent que sur les
 * endpoints de cet écran. Ces `case` disparaissent dès que le référentiel les porte.
 */
export function missedErrorMessage(error: HttpErrorResponse, fallback: string): string {
  const body = error?.error as { error?: string; code?: string } | undefined;

  switch (body?.error ?? body?.code) {
    case 'TELEPHONY_CALL_NOT_MISSED':
      return "Cet appel n'est pas un appel manqué : une conversation qui a eu lieu se qualifie, elle ne se clôture pas. Rechargez la liste.";
    case 'LEAD_PHONE_SLOT_EMPTY':
    case 'UNKNOWN_SENSITIVE_FIELD':
      return "Ce numéro n'est pas renseigné sur la fiche. Essayez l'autre numéro, ou complétez la fiche avant de rappeler.";
    default:
      break;
  }

  return telephonyErrorMessage(error, fallback);
}
