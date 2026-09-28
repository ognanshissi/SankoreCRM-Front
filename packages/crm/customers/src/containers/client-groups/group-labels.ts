import { Severity } from '@talisoft/ui/tag';

/**
 * Libellés et conversions des énumérations des groupes de clients.
 *
 * Le contrat est asymétrique, comme ailleurs dans cette API : les DTO de lecture
 * (`GroupListItemDto.type`, `GroupDetailDto.status`, `GroupMemberDto.officeRole`)
 * renvoient des chaînes sans énumération déclarée, tandis que les filtres de
 * `listClientGroups` attendent des entiers (`type?: 0 | 1 | 2`,
 * `status?: 0 | 1 | 2 | 3`) et que `AddGroupMemberRequest.officeRole` est un
 * entier 0..3 là où `AssignOfficeRoleRequest.officeRole` est la chaîne
 * `'Member' | 'President' | 'Treasurer' | 'Secretary'`.
 *
 * Toute conversion passe donc par les fonctions de ce fichier, jamais par un
 * `as any` : c'est exactement le décalage qu'un cast masquerait.
 *
 * Les correspondances nom <-> entier de `type` et `officeRole` suivent l'ordre
 * déclaré dans le contrat. **Celle des statuts est une déduction** : le swagger
 * n'énumère les statuts que dans ses descriptions (Forming à la création, Active
 * après activation automatique, Suspended, Dissolved) et le filtre ne connaît
 * que 0..3. À confirmer côté API.
 */

type RawEnum = string | number | null | undefined;

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
/** Nom -> entier, pour le filtre `listClientGroups(type)`. */
export function groupTypeToNumeric(value: RawEnum): 0 | 1 | 2 | undefined {
  switch (canonical(value, GROUP_TYPE_ORDER)) {
    case 'SolidarityGroup': return 0;
    case 'Tontine': return 1;
    case 'Vsla': return 2;
    default: return undefined;
  }
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
 * Nom -> entier, pour le filtre `listClientGroups(status)`. Correspondance
 * déduite : voir l'avertissement au-dessus de `GROUP_STATUS_ORDER`.
 */
export function groupStatusToNumeric(value: RawEnum): 0 | 1 | 2 | 3 | undefined {
  switch (canonical(value, GROUP_STATUS_ORDER)) {
    case 'Forming':   return 0;
    case 'Active':    return 1;
    case 'Suspended': return 2;
    case 'Dissolved': return 3;
    default:          return undefined;
  }
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
export function officeRoleToNumeric(value: RawEnum): 0 | 1 | 2 | 3 | undefined {
  switch (canonical(value, OFFICE_ROLE_ORDER)) {
    case 'Member':    return 0;
    case 'President': return 1;
    case 'Treasurer': return 2;
    case 'Secretary': return 3;
    default:          return undefined;
  }
}
/** Les trois rôles uniques dans le groupe, dans l'ordre d'affichage du bureau. */
export const OFFICE_BOARD_ROLES = ['President', 'Treasurer', 'Secretary'] as const;

/** Nom canonique du rôle, pour l'afficher dans un `tas-select` qui ne lit que des chaînes. */
export function officeRoleName(value: RawEnum): string {
  return canonical(value, OFFICE_ROLE_ORDER) ?? 'Member';
}
