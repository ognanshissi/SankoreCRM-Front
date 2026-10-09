import { Routes } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';

/**
 * Routes du module Intégration, montées sous `/settings/integrations` par
 * `settings.routes.ts` (`loadChildren`).
 *
 * Chaque route porte la permission que l'endpoint correspondant déclare dans le
 * swagger, à la lettre et en PascalCase pointé — c'est la forme que le serveur
 * accorde, pas une coquille.
 *
 * Les écrans ne sont pas exportés depuis `index.ts` : ils ne sont atteints que par
 * `loadComponent`, et les exporter depuis la barrique les ferait entrer dans le
 * paquet de `settings`, qui importe cette barrique pour ses routes.
 */
const integrationRoutes: Routes = [
  {
    // Jamais atteint avec le montage actuel : `/settings/integrations` est servi par la
    // vue d'ensemble, déclarée juste avant ce `loadChildren` dans `settings.routes.ts`.
    // Conservé pour que la lib reste utilisable seule, et pour ne pas laisser un écran
    // blanc si cette vue d'ensemble disparaît un jour.
    path: '',
    redirectTo: 'connections',
    pathMatch: 'full',
  },
  {
    path: 'connections',
    canActivate: [hasPermissionGuard('Integration.Connection.View')],
    loadComponent: () => import('./containers/connections/connections-page'),
  },
  {
    // Même écran que `connections`, monté une seconde fois sur la famille assurance
    // (ASS-13). La famille arrive par `data` et est liée à l'`input()` du composant
    // par `withComponentInputBinding()`, déjà actif dans `app.config.ts`.
    path: 'insurance-connections',
    canActivate: [hasPermissionGuard('Integration.Connection.View')],
    data: { family: 'Insurance' },
    loadComponent: () => import('./containers/connections/connections-page'),
  },
  {
    // Après les deux segments fixes : sinon le joker capturerait « insurance-connections »
    // comme identifiant de connexion.
    path: 'connections/:id',
    canActivate: [hasPermissionGuard('Integration.Connection.View')],
    loadComponent: () => import('./containers/connections/connection-detail'),
  },
  {
    path: 'insurance-products',
    canActivate: [hasPermissionGuard('Ins.Product.Manage')],
    loadComponent: () =>
      import('./containers/insurance-products/insurance-products-page'),
  },
  {
    path: 'insurance-products/:id',
    canActivate: [hasPermissionGuard('Ins.Product.Manage')],
    loadComponent: () =>
      import('./containers/insurance-products/edit-insurance-product'),
  },
  {
    path: 'mappings',
    canActivate: [hasPermissionGuard('Integration.Mapping.Manage')],
    loadComponent: () => import('./containers/mappings/mappings-page'),
  },
  {
    path: 'commands',
    canActivate: [hasPermissionGuard('Integration.Command.View')],
    loadComponent: () => import('./containers/commands/commands-homepage'),
  },
  {
    path: 'batch-files',
    canActivate: [hasPermissionGuard('Integration.Command.View')],
    loadComponent: () => import('./containers/batch-files/batch-files-homepage'),
  },
  {
    path: 'reconciliation',
    canActivate: [hasPermissionGuard('Integration.Reconciliation.View')],
    loadComponent: () => import('./containers/reconciliation/reconciliation'),
  },
  {
    path: 'insurance-statements',
    canActivate: [hasPermissionGuard('Ins.Statement.View')],
    loadComponent: () =>
      import('./containers/insurance-statements/insurance-statements'),
  },
];

export default integrationRoutes;
