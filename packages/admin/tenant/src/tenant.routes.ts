import { Route } from '@angular/router';

export const tenantRoutes: Route[] = [
  {
    path: '',
    title: 'Tenants · Sankore Admin',
    loadComponent: () => import('./containers/tenants-list/tenants-list'),
  },
  {
    path: ':id',
    title: 'Tenant · Sankore Admin',
    loadComponent: () => import('./containers/tenant-detail/tenant-detail'),
  },
];

export default tenantRoutes;
