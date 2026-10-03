import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés et conversions des énumérations des groupes de clients.
 *
 * Le contrat était asymétrique : les filtres de `listClientGroups` attendaient des entiers
 * (`type?: 0 | 1 | 2`, `status?: 0 | 1 | 2 | 3`) et `AddGroupMemberRequest.officeRole` un
 * entier 0..3, alors que les DTO de lecture et `AssignOfficeRoleRequest.officeRole` donnaient
 * déjà des chaînes. La cause était côté API : `EnumSchemaFilter` testait `context.Type.IsEnum`,
 * faux pour un `Nullable<TEnum>`, donc toute énumération OPTIONNELLE restait documentée en
 * integer. Le filtre déballe désormais le nullable et les deux sens parlent la même langue.
 *
 * Les conversions de ce fichier restent le seul passage autorisé — jamais un `as any`. Elles ne
 * traduisent plus un indice : elles normalisent une valeur brute (ancien indice d'une URL mise
 * en favori, casse différente) vers le nom du contrat.
 *
 * La correspondance des statuts n'est plus une déduction : le contrat les nomme.
 */

type RawEnum = string | number | null | undefined;

/** Les noms que le contrat accepte, désormais identiques en lecture et en filtre. */
export type GroupTypeParam = 'SolidarityGroup' | 'Tontine' | 'Vsla';
export type GroupStatusParam = 'Forming' | 'Active' | 'Suspended' | 'Dissolved';
export type OfficeRoleParam = 'Member' | 'President' | 'Treasurer' | 'Secretary';

/** Ramène une valeur brute au nom canonique du contrat, ou `null` si inconnue. */
function canonical(value: RawEnum, order: string[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value);
  if (order.includes(raw)) return raw;
  const asIndex = Number(raw);
  if (Number.isInteger(asIndex) && asIndex >= 0 && asIndex < order.length) {
    return order[asIndex];
  }
  return null;
}

/**
 * Affiche la valeur brute plutôt que « — » quand le nom est inconnu : un libellé
 * inattendu se voit à l'écran et se corrige, une valeur avalée passe inaperçue.
 */
function label(value: RawEnum, byName: Record<string, string>, order: string[]): string {
  if (value === null || value === undefined || value === '') return '—';
  const name = canonical(value, order);
  return name ? (byName[name] ?? String(value)) : String(value);
}

// ——— Type de groupe ———

export const GROUP_TYPE_ORDER = ['SolidarityGroup', 'Tontine', 'Vsla'];
const GROUP_TYPE_LABELS: Record<string, string> = {
  SolidarityGroup: 'Groupe solidaire',
  Tontine: 'Tontine',
  Vsla: 'AVEC',
};
export function groupTypeLabel(value: RawEnum): string {
  return label(value, GROUP_TYPE_LABELS, GROUP_TYPE_ORDER);
}
/** Options par nom : `CreateGroupRequest.type` attend la chaîne. */
export const GROUP_TYPE_OPTIONS = GROUP_TYPE_ORDER.map((name) => ({
  label: GROUP_TYPE_LABELS[name] as string,
  value: name,
}));
/**
 * Nom -> paramètre de requête pour `listClientGroups(type)`. Renvoyait un entier tant que le
 * contrat documentait cette énumération optionnelle en integer ; elle est maintenant en chaîne,
 * donc la valeur canonique part telle quelle. `canonical` reste utile : l'appelant peut encore
 * fournir un ancien indice ou une casse différente.
 */
export function groupTypeToParam(value: RawEnum): GroupTypeParam | undefined {
  return (canonical(value, GROUP_TYPE_ORDER) as GroupTypeParam | null) ?? undefined;
}

// ——— Statut du groupe ———

/**
 * ATTENTION — ORDRE DÉDUIT, À CONFIRMER CÔTÉ API.
 *
 * Le swagger ne déclare aucune énumération nommée pour le statut : le filtre
 * `listClientGroups(status)` n'accepte que `0 | 1 | 2 | 3` et les quatre noms
 * (Forming, Active, Suspended, Dissolved) n'apparaissent que dans les
 * descriptions des opérations. L'ordre ci-dessous suit le cycle de vie décrit
 * par le contrat, sans qu'il le confirme.
 *
 * Conséquence si l'ordre réel diffère : **le filtre « Statut » de la liste
 * interroge un autre statut que celui choisi, en silence** — pas d'erreur, pas
 * de page vide suspecte, juste de mauvais groupes. Ne réordonne donc pas ce
 * tableau pour des raisons de lisibilité, et si tu touches au filtre, vérifie
 * d'abord ce que le serveur renvoie pour chacune des quatre valeurs.
 */
export const GROUP_STATUS_ORDER = ['Forming', 'Active', 'Suspended', 'Dissolved'];
const GROUP_STATUS_LABELS: Record<string, string> = {
  Forming: 'En constitution',
  Active: 'Actif',
  Suspended: 'Suspendu',
  Dissolved: 'Dissous',
};
export function groupStatusLabel(value: RawEnum): string {
  return label(value, GROUP_STATUS_LABELS, GROUP_STATUS_ORDER);
}
export function groupStatusSeverity(value: RawEnum): Severity {
  switch (canonical(value, GROUP_STATUS_ORDER)) {
    case 'Active':    return 'success';
    case 'Forming':   return 'warning';
    case 'Suspended': return 'error';
    case 'Dissolved': return 'neutral';
    default:          return 'info';
  }
}
export const GROUP_STATUS_OPTIONS = GROUP_STATUS_ORDER.map((name) => ({
  label: GROUP_STATUS_LABELS[name] as string,
  value: name,
}));
/**
 * Nom -> paramètre de requête pour `listClientGroups(status)`. Le contrat nomme désormais les
 * valeurs, ce qui lève au passage le doute signalé au-dessus de `GROUP_STATUS_ORDER` : la
 * correspondance n'est plus déduite d'un indice.
 */
export function groupStatusToParam(value: RawEnum): GroupStatusParam | undefined {
  return (canonical(value, GROUP_STATUS_ORDER) as GroupStatusParam | null) ?? undefined;
}
export function isFormingGroup(value: RawEnum): boolean {
  return canonical(value, GROUP_STATUS_ORDER) === 'Forming';
}
export function isDissolvedGroup(value: RawEnum): boolean {
  return canonical(value, GROUP_STATUS_ORDER) === 'Dissolved';
}
export function isSuspendedGroup(value: RawEnum): boolean {
  return canonical(value, GROUP_STATUS_ORDER) === 'Suspended';
}

// ——— Rôles de bureau ———

export const OFFICE_ROLE_ORDER = ['Member', 'President', 'Treasurer', 'Secretary'];
const OFFICE_ROLE_LABELS: Record<string, string> = {
  Member: 'Membre',
  President: 'Président',
  Treasurer: 'Trésorier',
  Secretary: 'Secrétaire',
};
export function officeRoleLabel(value: RawEnum): string {
  return label(value, OFFICE_ROLE_LABELS, OFFICE_ROLE_ORDER);
}
/** Options par nom : `AssignOfficeRoleRequest.officeRole` attend la chaîne. */
export const OFFICE_ROLE_OPTIONS = OFFICE_ROLE_ORDER.map((name) => ({
  label: OFFICE_ROLE_LABELS[name] as string,
  value: name,
}));
/** Nom -> entier, pour `AddGroupMemberRequest.officeRole` qui attend un entier. */
export function officeRoleToParam(value: RawEnum): OfficeRoleParam | undefined {
  return (canonical(value, OFFICE_ROLE_ORDER) as OfficeRoleParam | null) ?? undefined;
}
/** Les trois rôles uniques dans le groupe, dans l'ordre d'affichage du bureau. */
export const OFFICE_BOARD_ROLES = ['President', 'Treasurer', 'Secretary'] as const;

/** Nom canonique du rôle, pour l'afficher dans un `tas-select` qui ne lit que des chaînes. */
export function officeRoleName(value: RawEnum): string {
  return canonical(value, OFFICE_ROLE_ORDER) ?? 'Member';
}
