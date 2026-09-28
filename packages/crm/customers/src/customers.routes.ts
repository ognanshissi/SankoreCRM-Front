import { Route } from '@angular/router';
import { hasAllPermissionsGuard, hasPermissionGuard } from '@sankore/crm/common';

/**
 * Routes du module Clients.
 *
 * L'ordre compte : les segments fixes (`nouveau`, `groupes`, `doublons`, `fusions`)
 * doivent précéder `:id`, sinon le joker les capturerait comme identifiants.
 */
export const customersRoutes: Route[] = [
  {
    path: '',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () => import('./containers/clients-list/clients-list'),
  },
  {
    path: 'nouveau',
    canActivate: [hasPermissionGuard('customers:create')],
    // Le type est structurel plutôt qu'importé : importer la classe ici ferait entrer
    // l'assistant dans le lot initial, alors qu'il est justement chargé à la demande.
    canDeactivate: [
      (component: { canLeave(): boolean | Promise<boolean> }) => component.canLeave(),
    ],
    loadComponent: () => import('./containers/create-client/create-client'),
  },
  {
    path: 'groupes',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () => import('./containers/client-groups/client-groups-list'),
  },
  {
    path: 'groupes/:groupId',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () => import('./containers/client-groups/client-group-detail'),
  },
  // Garde conjonctive et non « au moins un » : ces deux écrans écrivent avec
  // `customers:merge` mais lisent avec `customers:read` (`GET /clients/duplicates`,
  // `GET /clients/merges/{id}`, `GET /clients/{id}`). Un profil porteur de `merge`
  // sans `read` franchirait un `hasPermissionGuard` puis se heurterait à un 403 au
  // premier chargement, sans que rien à l'écran n'explique pourquoi.
  {
    path: 'doublons',
    canActivate: [hasAllPermissionsGuard('customers:read', 'customers:merge')],
    loadComponent: () => import('./containers/duplicates/duplicates-queue'),
  },
  {
    path: 'fusions/:mergeRequestId',
    canActivate: [hasAllPermissionsGuard('customers:read', 'customers:merge')],
    loadComponent: () => import('./containers/duplicates/merge-compare'),
  },
  {
    path: ':id',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () =>
      import('./containers/client-detail/client-detail-navigation'),
    children: [
      { path: '', redirectTo: 'identite', pathMatch: 'full' },
      { path: 'identite', loadComponent: () => import('./containers/client-detail/identite') },
      { path: 'coordonnees', loadComponent: () => import('./containers/client-detail/coordonnees') },
      { path: 'relations', loadComponent: () => import('./containers/client-detail/relations') },
      { path: 'groupes', loadComponent: () => import('./containers/client-detail/groupes') },
      { path: 'beneficiaires', loadComponent: () => import('./containers/client-detail/beneficiaires') },
      { path: 'kyc', loadComponent: () => import('./containers/client-detail/kyc') },
      { path: 'historique', loadComponent: () => import('./containers/client-detail/historique') },
    ],
  },
];

export default customersRoutes;
