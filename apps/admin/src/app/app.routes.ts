import { Route } from '@angular/router';
import { adminAuthorized } from '@sankore/admin/auth';

export const appRoutes: Route[] = [
  {
    path: 'auth',
    loadChildren: () => import('@sankore/admin/auth'),
  },
  {
    path: '',
    canActivate: [adminAuthorized],
    loadComponent: () => import('./shell'),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tenants' },
      { path: 'tenants', loadChildren: () => import('@sankore/admin/tenant') },
      { path: 'modules', loadChildren: () => import('@sankore/admin/tenant').then((m) => m.moduleRoutes) },
      { path: 'support', loadChildren: () => import('@sankore/admin/tenant').then((m) => m.supportRoutes) },
    ],
  },
  { path: '**', redirectTo: '' },
];
