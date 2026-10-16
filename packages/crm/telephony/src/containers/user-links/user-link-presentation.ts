import {
  TelephonyDirectoryDto,
  TelephonyUserLinkDto,
  UserDto,
} from '@sankore/crm-api';
import { Severity } from '@talisoft/ui/tag';
import {
  maskedPhone,
  TEL_EMPTY_LABEL,
  telLabel,
  telSeverity,
} from '../../data-access/telephony-referential';

/**
 * Construction des lignes de l'écran « Rattachement des postes ».
 *
 * Toute la logique est ici, pure, parce qu'elle est la seule chose subtile de l'écran :
 * elle recoupe DEUX sources qui ne disent pas la même chose.
 *
 * - `GET telephony/user-links` lit les lignes de ce module et n'appelle jamais le
 *   fournisseur : elle répond normalement même fournisseur à terre. C'est la source de
 *   vérité des rattachements.
 * - `GET telephony/directory` lit l'annuaire du fournisseur EN DIRECT et propose un
 *   appariement par e-mail. C'est à la fois « importer l'annuaire » et « proposer par
 *   e-mail » : les propositions SONT les champs `proposed*`, et `ambiguousEmails` est ce
 *   sur quoi le serveur a refusé de deviner.
 *
 * D'où la règle de composition : les rattachements existent sans annuaire, les
 * propositions n'existent qu'avec. Un annuaire absent (503 fournisseur injoignable) ne
 * doit donc JAMAIS vider la liste — c'est ce que faisait une liste construite depuis
 * l'annuaire seul, et l'administrateur en concluait que tous les postes étaient détachés.
 */

export const USER_LINK_STATES = [
  'Linked',
  'Broken',
  'Disabled',
  'Proposed',
  'Unlinked',
] as const;

export type UserLinkState = (typeof USER_LINK_STATES)[number];

/**
 * Cinq états affichés pour trois valeurs serveur. `Active | Broken | Disabled` viennent
 * de `TelephonyUserLinkDto.status` ; « Proposé » et « Non lié » n'existent pas côté
 * serveur — ce sont des comptes de l'annuaire SANS ligne de rattachement, selon qu'une
 * proposition exploitable accompagne le compte ou non.
 */
export const USER_LINK_STATE_LABELS: Readonly<Record<UserLinkState, string>> = {
  Linked: 'Lié',
  Broken: 'Cassé',
  Disabled: 'Détaché',
  Proposed: 'Proposé',
  Unlinked: 'Non lié',
};

export const USER_LINK_STATE_SEVERITIES: Readonly<Record<UserLinkState, Severity>> = {
  Linked: 'success',
  Broken: 'error',
  Disabled: 'neutral',
  Proposed: 'info',
  Unlinked: 'warning',
};

export function userLinkStateLabel(value: string | null | undefined): string {
  return telLabel(USER_LINK_STATE_LABELS, value);
}

export function userLinkStateSeverity(value: string | null | undefined): Severity {
  return telSeverity(USER_LINK_STATE_SEVERITIES, value);
}

/** Les quatre filtres d'état proposés, dans l'ordre où ils demandent une action. */
export const USER_LINK_STATE_FILTER_OPTIONS: ReadonlyArray<{
  value: UserLinkState;
  label: string;
}> = USER_LINK_STATES.map((state) => ({
  value: state,
  label: USER_LINK_STATE_LABELS[state],
}));

export interface UserLinkRow {
  /**
   * Identité de ligne pour `tas-table`. Le `linkId` quand il y a un rattachement, sinon
   * le compte fournisseur : une ligne « Non lié » n'a pas d'id serveur, et deux lignes
   * partageant la même clé de `track` se recopieraient l'une l'autre au rechargement.
   */
  id: string;
  state: UserLinkState;
  stateLabel: string;
  stateSeverity: Severity;

  linkId: string | null;
  linkVersion: number | null;
  crmUserId: string | null;
  crmUserName: string;
  agencyName: string;

  externalUserId: string;
  externalEmail: string;
  externalDisplayName: string;

  /** Déjà masqué : l'écran ne réétale pas un numéro en clair dans une liste. */
  callerNumber: string;
  /** La valeur brute, pour pré-remplir le formulaire de saisie. */
  rawCallerNumber: string | null;
  statusReason: string | null;
  linkedAt: string | null;

  /**
   * `null` quand l'annuaire n'a pas pu être lu : « le fournisseur ne liste pas ce
   * compte » et « on n'a pas pu demander au fournisseur » n'appellent pas la même
   * réaction, et les confondre fait réparer un rattachement qui n'a rien.
   */
  isActiveAtProvider: boolean | null;
  knownAtProvider: boolean | null;

  proposedCrmUserId: string | null;
  proposedCrmUserName: string | null;
  /** Une proposition vers un compte CRM désactivé est affichée mais jamais validable. */
  proposedCrmUserIsDisabled: boolean;
  /** L'e-mail répond à plusieurs comptes CRM : le serveur a refusé de choisir. */
  isAmbiguous: boolean;
}

export interface BuildUserLinkRowsInput {
  links: TelephonyUserLinkDto[];
  /** `null` quand l'annuaire n'a pas été lu (panne fournisseur, droit, ou pas encore demandé). */
  directory: TelephonyDirectoryDto | null;
  /** Les utilisateurs CRM connus, pour l'agence et le nom. Peut être vide. */
  usersById: Readonly<Record<string, UserDto>>;
}

export function buildUserLinkRows(input: BuildUserLinkRowsInput): UserLinkRow[] {
  const { links, directory, usersById } = input;

  const entries = directory?.entries ?? [];
  const ambiguous = new Set(
    (directory?.ambiguousEmails ?? [])
      .filter((mail): mail is string => !!mail)
      .map((mail) => mail.toLowerCase()),
  );
  const entriesByExternalId = new Map(
    entries
      .filter((entry) => !!entry.externalUserId)
      .map((entry) => [entry.externalUserId as string, entry]),
  );

  const rows: UserLinkRow[] = links.map((link) => {
    const entry = link.externalUserId
      ? entriesByExternalId.get(link.externalUserId)
      : undefined;
    const user = link.crmUserId ? usersById[link.crmUserId] : undefined;
    const state = linkState(link.status);
    const email = link.externalEmail ?? entry?.email ?? '';

    return {
      // Le `linkId` est l'identité de la ligne, pas le compte fournisseur : c'est lui que
      // prennent les trois écritures (numéro d'appelant, détachement).
      id: link.id ?? link.externalUserId ?? email,
      state,
      stateLabel: USER_LINK_STATE_LABELS[state],
      stateSeverity: USER_LINK_STATE_SEVERITIES[state],
      linkId: link.id ?? null,
      linkVersion: link.version ?? null,
      crmUserId: link.crmUserId ?? null,
      crmUserName: link.crmUserName || user?.fullName || user?.email || TEL_EMPTY_LABEL,
      agencyName: user?.agencyName || TEL_EMPTY_LABEL,
      externalUserId: link.externalUserId ?? '',
      externalEmail: email || TEL_EMPTY_LABEL,
      externalDisplayName: entry?.displayName || email || TEL_EMPTY_LABEL,
      callerNumber: maskedPhone(link.defaultCallerNumber),
      rawCallerNumber: link.defaultCallerNumber ?? null,
      statusReason: link.statusReason ?? null,
      linkedAt: link.linkedAt ?? null,
      isActiveAtProvider: directory ? (entry?.isActiveAtProvider ?? false) : null,
      knownAtProvider: directory ? !!entry : null,
      proposedCrmUserId: null,
      proposedCrmUserName: null,
      proposedCrmUserIsDisabled: false,
      isAmbiguous: email ? ambiguous.has(email.toLowerCase()) : false,
    };
  });

  const linkedExternalIds = new Set(
    links.map((link) => link.externalUserId).filter((id): id is string => !!id),
  );

  for (const entry of entries) {
    const externalUserId = entry.externalUserId ?? '';
    // Un compte déjà rattaché est DÉJÀ une ligne : `linkedCrmUserId` et notre propre
    // liste disent la même chose, et le dédoublonner ici évitait deux lignes pour un
    // poste — celle du rattachement et celle de l'annuaire.
    if (externalUserId && linkedExternalIds.has(externalUserId)) continue;
    if (entry.linkedCrmUserId) continue;

    const email = entry.email ?? '';
    const proposedId = entry.proposedCrmUserId ?? null;
    const user = proposedId ? usersById[proposedId] : undefined;
    const state: UserLinkState = proposedId ? 'Proposed' : 'Unlinked';

    rows.push({
      id: externalUserId || email,
      state,
      stateLabel: USER_LINK_STATE_LABELS[state],
      stateSeverity: USER_LINK_STATE_SEVERITIES[state],
      linkId: null,
      linkVersion: null,
      crmUserId: null,
      crmUserName: TEL_EMPTY_LABEL,
      agencyName: user?.agencyName || TEL_EMPTY_LABEL,
      externalUserId,
      externalEmail: email || TEL_EMPTY_LABEL,
      externalDisplayName: entry.displayName || email || TEL_EMPTY_LABEL,
      callerNumber: TEL_EMPTY_LABEL,
      rawCallerNumber: null,
      statusReason: null,
      linkedAt: null,
      isActiveAtProvider: entry.isActiveAtProvider ?? false,
      knownAtProvider: true,
      proposedCrmUserId: proposedId,
      proposedCrmUserName:
        entry.proposedCrmUserName || user?.fullName || user?.email || null,
      proposedCrmUserIsDisabled: entry.proposedCrmUserIsDisabled ?? false,
      isAmbiguous: email ? ambiguous.has(email.toLowerCase()) : false,
    });
  }

  return rows;
}

function linkState(status: string | null | undefined): UserLinkState {
  switch (status) {
    case 'Active':
      return 'Linked';
    case 'Broken':
      return 'Broken';
    case 'Disabled':
      return 'Disabled';
    default:
      // Un statut inédit ne disparaît pas de la liste : la ligne s'affiche comme un
      // rattachement cassé, ce qui est l'état qui demande une vérification humaine.
      return 'Broken';
  }
}

/**
 * Une proposition n'est validable que si elle désigne un compte CRM utilisable : le
 * serveur refuse d'apparier un compte désactivé, et proposer le bouton quand même
 * échangerait une erreur 422 contre une explication.
 */
export function isProposalApplicable(row: UserLinkRow): boolean {
  return (
    row.state === 'Proposed' &&
    !!row.proposedCrmUserId &&
    !row.proposedCrmUserIsDisabled &&
    !!row.externalUserId
  );
}

/**
 * Le nombre de rattachements cassés, pour le badge du menu. Compté sur les LIGNES DE
 * RATTACHEMENT et jamais sur l'annuaire : un fournisseur injoignable ne doit pas faire
 * clignoter un badge à zéro problème réel.
 */
export function brokenLinkCount(links: TelephonyUserLinkDto[]): number {
  return links.filter((link) => link.status === 'Broken').length;
}

/**
 * E.164, tel que le contrat le définit : « a leading + and 8 to 15 digits ». La valeur
 * est remise VERBATIM à l'API du fournisseur, qui refuse un format local — autant le
 * dire ici plutôt que de laisser l'administrateur découvrir le refus après coup. Vide
 * est valide : il EFFACE la surcharge et fait retomber l'agent sur le numéro de la
 * connexion, ce qui est l'état ordinaire.
 */
export function isValidCallerNumber(value: string | null | undefined): boolean {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return true;
  return /^\+[1-9]\d{7,14}$/.test(trimmed);
}

/** Filtre local : les deux listes déroulantes et la recherche texte de l'écran. */
export function filterUserLinkRows(
  rows: UserLinkRow[],
  filters: { state: string | null; agency: string | null; search: string },
): UserLinkRow[] {
  const search = filters.search.trim().toLowerCase();

  return rows.filter((row) => {
    if (filters.state && row.state !== filters.state) return false;
    if (filters.agency && row.agencyName !== filters.agency) return false;
    if (!search) return true;

    return [
      row.crmUserName,
      row.externalEmail,
      row.externalDisplayName,
      row.externalUserId,
      row.proposedCrmUserName ?? '',
      row.agencyName,
    ].some((field) => field.toLowerCase().includes(search));
  });
}

/**
 * Les agences présentes dans les lignes : inutile de demander la liste complète.
 *
 * Le tableau rendu est MUTABLE à dessein : l'entrée `options` de `tas-select` est typée
 * `{ [key: string]: any }[]`, et un `ReadonlyArray` y est refusé à la compilation du
 * template (TS4104), pas à celle du TypeScript.
 */
export function agencyOptions(rows: UserLinkRow[]): Array<{ label: string; value: string }> {
  const names = new Set(
    rows.map((row) => row.agencyName).filter((name) => name !== TEL_EMPTY_LABEL),
  );
  return [...names]
    .sort((a, b) => a.localeCompare(b, 'fr'))
    .map((name) => ({ label: name, value: name }));
}
