import { Routes } from '@angular/router';
import { canReadModuleGuard, hasPermissionGuard, TENANT_MODULES, TenantModule } from '@sankore/crm/common';

/**
 * Correspondances, écritures, fichiers et réconciliation servent le core banking ET les assureurs :
 * ouverts avec l'un ou l'autre module payant. Les connexions restent sans garde de module, la
 * téléphonie y vit aussi. Toutes ces routes sont des écrans de consultation : elles s'ouvrent aussi
 * pour un module désactivé, en lecture seule.
 */
const BANKING_OR_INSURANCE: TenantModule[] = [TENANT_MODULES.BANKING_MICROFINANCE, TENANT_MODULES.INSURANCE];

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
    canActivate: [hasPermissionGuard('Integration.Connection.View'), canReadModuleGuard(TENANT_MODULES.INSURANCE)],
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
    canActivate: [hasPermissionGuard('Ins.Product.Manage'), canReadModuleGuard(TENANT_MODULES.INSURANCE)],
    loadComponent: () =>
      import('./containers/insurance-products/insurance-products-page'),
  },
  {
    path: 'insurance-products/:id',
    canActivate: [hasPermissionGuard('Ins.Product.Manage'), canReadModuleGuard(TENANT_MODULES.INSURANCE)],
    loadComponent: () =>
      import('./containers/insurance-products/edit-insurance-product'),
  },
  {
    path: 'mappings',
    canActivate: [hasPermissionGuard('Integration.Mapping.Manage'), canReadModuleGuard(...BANKING_OR_INSURANCE)],
    loadComponent: () => import('./containers/mappings/mappings-page'),
  },
  {
    path: 'commands',
    canActivate: [hasPermissionGuard('Integration.Command.View'), canReadModuleGuard(...BANKING_OR_INSURANCE)],
    loadComponent: () => import('./containers/commands/commands-homepage'),
  },
  {
    path: 'batch-files',
    canActivate: [hasPermissionGuard('Integration.Command.View'), canReadModuleGuard(...BANKING_OR_INSURANCE)],
    loadComponent: () => import('./containers/batch-files/batch-files-homepage'),
  },
  {
    path: 'reconciliation',
    canActivate: [hasPermissionGuard('Integration.Reconciliation.View'), canReadModuleGuard(...BANKING_OR_INSURANCE)],
    loadComponent: () => import('./containers/reconciliation/reconciliation'),
  },
  {
    path: 'insurance-statements',
    canActivate: [hasPermissionGuard('Ins.Statement.View'), canReadModuleGuard(TENANT_MODULES.INSURANCE)],
    loadComponent: () =>
      import('./containers/insurance-statements/insurance-statements'),
  },
  {
    // Le registre des réclamations du règlement 01/CIMA/2024. Gardé sur la LECTURE :
    // déposer et faire avancer demandent `Ins.Complaint.Handle`, et l'écran masque ces
    // boutons lui-même — une route gardée sur l'écriture cacherait le registre aux gens
    // dont le métier est de le lire.
    path: 'insurance-complaints',
    canActivate: [hasPermissionGuard('Ins.Complaint.View'), canReadModuleGuard(TENANT_MODULES.INSURANCE)],
    loadComponent: () => import('./containers/complaints/complaints-register'),
  },
];

export default integrationRoutes;
