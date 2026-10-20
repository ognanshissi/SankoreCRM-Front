import { ActivatedRouteSnapshot } from '@angular/router';

/**
 * L'identifiant du lead pour les onglets de Suivi. Ils le reçoivent en entrée (`id`) par la liaison
 * des routes, qui ne lit que les paramètres de LEUR route : un niveau plus bas que `:id`, ils ne
 * l'auraient plus. Le résoudre ici, depuis l'ancêtre, évite de changer la stratégie d'héritage des
 * paramètres pour toute l'application.
 */
export function leadIdFromAncestors(route: ActivatedRouteSnapshot): string {
  for (let r: ActivatedRouteSnapshot | null = route; r; r = r.parent) {
    const id = r.paramMap.get('id');
    if (id) return id;
  }
  return '';
}
