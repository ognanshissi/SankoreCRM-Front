import { Route } from '@angular/router';
import { canReadModuleGuard, hasAllPermissionsGuard, hasModuleGuard, hasPermissionGuard, TENANT_MODULES } from '@sankore/crm/common';
import ImportClientsPage from './containers/import-clients/import-clients';

/**
 * Routes du module Clients.
 *
 * L'ordre compte : les segments fixes (`nouveau`, `groupes`, `doublons`, `fusions`)
 * doivent précéder `:id`, sinon le joker les capturerait comme identifiants.
 *
 * Groupes et core banking relèvent du module payant « Banking - Microfinance », assurances et
 * souscription du module « Assurance » : sans le module, le serveur répond 403 et ces écrans
 * n'auraient que des erreurs à montrer. Un module désactivé garde ses écrans en consultation
 * (`canReadModuleGuard`) ; la souscription, qui crée, exige le module actif.
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
      (component: { canLeave(): boolean | Promise<boolean> }) =>
        component.canLeave(),
    ],
    loadComponent: () => import('./containers/create-client/create-client'),
  },
  {
    path: 'groupes',
    canActivate: [hasPermissionGuard('customers:read'), canReadModuleGuard(TENANT_MODULES.BANKING_MICROFINANCE)],
    loadComponent: () =>
      import('./containers/client-groups/client-groups-list'),
  },
  {
    path: 'groupes/:groupId',
    canActivate: [hasPermissionGuard('customers:read'), canReadModuleGuard(TENANT_MODULES.BANKING_MICROFINANCE)],
    loadComponent: () =>
      import('./containers/client-groups/client-group-detail'),
  },
  {
    path: 'import-clients',
    // Les trois opérations d'import client déclarent `customers:create` dans leur description.
    canActivate: [hasPermissionGuard('customers:create')],
    loadComponent: () => ImportClientsPage,
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
    // Avant `:id` : le parcours est un écran plein, pas un onglet de la fiche. Le
    // paramètre s'appelle `customerId` parce que c'est le nom de l'`input()` du
    // composant, lié par `withComponentInputBinding()`.
    path: ':customerId/souscrire-assurance',
    canActivate: [hasPermissionGuard('Ins.Policy.Subscribe'), hasModuleGuard(TENANT_MODULES.INSURANCE)],
    loadComponent: () =>
      // Chargé depuis la barrique de la lib `integration`, qui porte déjà les blocs
      // Core banking et Assurances de cette fiche : l'écran arrive donc dans un
      // morceau déjà téléchargé, sans alias profond à déclarer.
      // eslint-disable-next-line @nx/enforce-module-boundaries
      import('@sankore/crm/integration').then((m) => m.SubscribePolicyPage),
  },
  {
    path: ':id',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () =>
      import('./containers/client-detail/client-detail-navigation'),
    children: [
      { path: '', redirectTo: 'identite', pathMatch: 'full' },
      {
        path: 'identite',
        loadComponent: () => import('./containers/client-detail/identite'),
      },
      {
        path: 'coordonnees',
        loadComponent: () => import('./containers/client-detail/coordonnees'),
      },
      {
        path: 'foyer',
        loadComponent: () => import('./containers/client-detail/foyer'),
      },
      {
        path: 'produits',
        loadComponent: () => import('./containers/client-detail/produits'),
      },
      {
        path: 'projets',
        loadComponent: () => import('./containers/client-detail/demandes'),
      },
      // L'ancienne adresse de l'onglet, avant que « Demandes » ne devienne « Projets ».
      { path: 'demandes', redirectTo: 'projets', pathMatch: 'full' as const },
      {
        path: 'relations',
        loadComponent: () => import('./containers/client-detail/relations'),
      },
      {
        path: 'groupes',
        canActivate: [canReadModuleGuard(TENANT_MODULES.BANKING_MICROFINANCE)],
        loadComponent: () => import('./containers/client-detail/groupes'),
      },
      {
        path: 'beneficiaires',
        loadComponent: () => import('./containers/client-detail/beneficiaires'),
      },
      {
        path: 'kyc',
        loadComponent: () => import('./containers/client-detail/kyc'),
      },
      {
        path: 'core-banking',
        canActivate: [canReadModuleGuard(TENANT_MODULES.BANKING_MICROFINANCE)],
        loadComponent: () => import('./containers/client-detail/core-banking'),
      },
      {
        path: 'assurances',
        canActivate: [canReadModuleGuard(TENANT_MODULES.INSURANCE)],
        loadComponent: () => import('./containers/client-detail/assurances'),
      },
      {
        path: 'historique',
        loadComponent: () => import('./containers/client-detail/historique'),
      },
    ],
  },
];

export default customersRoutes;
