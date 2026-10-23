import { Route } from '@angular/router';

export const moduleRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'demandes' },
  {
    path: 'demandes',
    title: 'Demandes de modules · Sankore Admin',
    loadComponent: () => import('./containers/modules/module-requests/module-requests'),
  },
  {
    path: 'catalogue',
    title: 'Catalogue des modules · Sankore Admin',
    loadComponent: () => import('./containers/modules/module-catalog/module-catalog'),
  },
];
