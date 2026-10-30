import { inject } from '@angular/core';
import { CanActivateChildFn, Router } from '@angular/router';
import { PermissionsService } from '../services/permissions.service';
import { afterUserLoaded } from './after-user-loaded';

/**
 * Les écrans de `/settings` qui sont du travail et non du paramétrage : ils restent ouverts aux
 * rôles sans Paramétrage, chacun derrière ses propres permissions.
 */
const WORK_PAGES_UNDER_SETTINGS: readonly RegExp[] = [
  /^\/settings\/account(\/|$)/,
  /^\/settings\/workflows\/ma-file$/,
  /^\/settings\/workflows\/instances\/[^/]+$/,
  /^\/settings\/workflows\/[^/]+\/instances(\/|$)/,
  /^\/settings\/telephony\/(journal|missed)$/,
  /^\/settings\/distribution-assurance$/,
];

/** Vrai pour un écran de travail sous `/settings`, que les rôles sans Paramétrage gardent. */
export function isWorkPageUnderSettings(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return WORK_PAGES_UNDER_SETTINGS.some((p) => p.test(path));
}

/**
 * Le Paramétrage, fermé aux rôles qui n'en ont pas l'entrée (`ROLES_WITHOUT_SETTINGS`,
 * propriétaire, 2026-10-30) : une URL tapée, un favori ou un lien « Paramétrage » d'un fil
 * d'Ariane renvoient à « Ma journée ». Une règle par rôle, comme le menu : les droits de lecture
 * d'un agent (agences, produits, sources…) servent ses écrans de travail et ouvraient aussi les
 * rubriques correspondantes. Posé en `canActivateChild` sur `settings` : un écran ajouté est
 * couvert sans y penser.
 */
export const settingsAreaGuard: CanActivateChildFn = (_route, state) => {
  const permissions = inject(PermissionsService);
  const router = inject(Router);
  return afterUserLoaded(() =>
    permissions.seesSettings() || isWorkPageUnderSettings(state.url)
      ? true
      : router.createUrlTree(['/tasks/my-day']),
  );
};
