import {
  COMMAND_STATUSES,
  commandStatusMeta,
  commandTypeLabel,
  entityTypeLabel,
  errorFamilyLabel,
} from '../../data-access/integration-referential';

export type CommandSelectOption = { label: string; value: string };

/**
 * Vocabulaire des filtres de l'écran Commandes.
 *
 * `GET /commands` déclare `status`, `commandType`, `entityType` et `errorFamily` en
 * `string` nue, sans énumération, et précise qu'« une valeur de filtre inconnue est
 * refusée par son nom plutôt qu'ignorée » : un champ libre produirait donc des 400 au
 * lieu de filtrer. Les valeurs listées ici sont exactement celles que
 * `integration-referential.ts` sait traduire — le vocabulaire que les descriptions du
 * contrat documentent — et les libellés viennent de ses fonctions, pour qu'un renommage
 * n'ait qu'un seul endroit à toucher.
 *
 * Ces listes vivent à côté de l'écran et non dans `data-access/` parce que seul le
 * référentiel y est propriétaire : si le serveur publie un jour ces énumérations dans le
 * swagger, elles disparaissent au profit des types générés.
 */
export const COMMAND_TYPES = [
  'CreateCustomer',
  'UpdateCustomer',
  'OpenAccount',
  'CreatePolicy',
  'CollectPremium',
  'CancelPolicy',
  'DeclareClaim',
] as const;

export const COMMAND_ENTITY_TYPES = ['Customer', 'Account', 'Loan', 'Policy', 'Claim'] as const;

export const COMMAND_ERROR_FAMILIES = [
  'Mapping',
  'Validation',
  'Auth',
  'Network',
  'Timeout',
  'Duplicate',
  'Configuration',
] as const;

export const COMMAND_STATUS_OPTIONS: CommandSelectOption[] = COMMAND_STATUSES.map((status) => ({
  label: commandStatusMeta(status).label,
  value: status,
}));

export const COMMAND_TYPE_OPTIONS: CommandSelectOption[] = COMMAND_TYPES.map((type) => ({
  label: commandTypeLabel(type),
  value: type,
}));

export const COMMAND_ENTITY_TYPE_OPTIONS: CommandSelectOption[] = COMMAND_ENTITY_TYPES.map(
  (entityType) => ({ label: entityTypeLabel(entityType), value: entityType }),
);

export const COMMAND_ERROR_FAMILY_OPTIONS: CommandSelectOption[] = COMMAND_ERROR_FAMILIES.map(
  (family) => ({ label: errorFamilyLabel(family), value: family }),
);

/** Valeurs acceptées par le serveur, pour ne restaurer de l'URL que ce qu'il reconnaît. */
const KNOWN_FILTER_VALUES: ReadonlySet<string> = new Set<string>([
  ...COMMAND_STATUSES,
  ...COMMAND_TYPES,
  ...COMMAND_ENTITY_TYPES,
  ...COMMAND_ERROR_FAMILIES,
]);

/**
 * Un paramètre d'URL est saisi à la main aussi souvent qu'il est partagé. Une valeur
 * hors vocabulaire est donc ignorée au lieu d'être renvoyée au serveur, qui la refuserait
 * par son nom en 400.
 */
export function knownFilterValue(
  raw: string | null | undefined,
  allowed: ReadonlyArray<string>,
): string | null {
  if (!raw) return null;
  return allowed.includes(raw) && KNOWN_FILTER_VALUES.has(raw) ? raw : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `crmId` est déclaré `format: uuid`. Valider la forme ici évite d'envoyer au serveur une
 * référence collée depuis un tableur, qui reviendrait en 400 sans dire quel champ était
 * fautif.
 */
export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_PATTERN.test(value.trim());
}

/**
 * Bornes de la période. Les deux paramètres sont en `date-time` alors que l'écran se
 * saisit au jour : sans ces bornes, « au 12 mars » exclurait toute la journée du 12.
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

/**
 * Âge d'une commande, en clair. Dans une file de rejet, la question qui déclenche une
 * action n'est pas « quand » mais « depuis combien de temps » : `dateTimeAgo` répond
 * « hier à 14:32 », ce qui ne hiérarchise pas deux lignes à l'œil.
 */
export function commandAgeLabel(createdAt: string | null | undefined, now = Date.now()): string {
  if (!createdAt) return '—';
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return '—';

  const minutes = Math.max(0, Math.floor((now - created) / 60_000));
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;

  return `${Math.floor(hours / 24)} j`;
}

/** Au-delà d'une journée, un rejet n'attend plus une relance automatique : il attend quelqu'un. */
export const COMMAND_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function isCommandStuck(
  status: string | null | undefined,
  createdAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (status !== 'Rejected' || !createdAt) return false;
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created > COMMAND_STALE_AFTER_MS;
}

/** Identifiant technique raccourci : la ligne doit rester lisible, le détail porte la valeur entière. */
export function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

/**
 * Texte de la confirmation de rejeu, partagé entre la ligne de la liste et le détail.
 *
 * Il dit ce que l'administrateur a besoin de savoir et qui ne se devine pas : le contenu
 * de la commande n'est ni fourni ni modifiable ici (« the payload cannot be supplied or
 * edited by the caller »), donc une valeur fausse se corrige dans la fiche du client, que
 * le répartiteur relit au moment de l'envoi.
 */
export const REPLAY_CONFIRMATION = {
  title: 'Rejouer cette commande ?',
  message:
    "La commande sera renvoyée au système externe telle qu'elle a été enregistrée : son contenu ne se modifie pas ici. Le compteur de tentatives repart de zéro. Si une donnée est fausse, corrigez-la dans la fiche du client — elle est relue au moment de l'envoi.",
  acceptLabel: 'Rejouer',
} as const;

/** L'annulation est définitive (« Final. ») : la confirmation le dit avant, pas après. */
export const CANCEL_WARNING =
  "L'annulation est définitive : la commande ne sera jamais envoyée au système externe et ne pourra pas être rejouée.";
