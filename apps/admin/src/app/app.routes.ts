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
    loadComponent: () => import('./home'),
  },
  { path: '**', redirectTo: '' },
];
