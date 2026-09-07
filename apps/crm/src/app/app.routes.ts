import { Route } from '@angular/router';
import { AuthLayoutComponent, AdminLayoutComponent, PortalLayoutComponent, authorized } from '@sankore/crm/common';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'tasks/my-day',
    pathMatch: 'full',
  },
  {
    path: 'tasks',
    component: PortalLayoutComponent,
    canActivate: [authorized],
    loadChildren: () => import('@sankore/crm/tasks'),
  },
  {
    path: 'settings',
    component: PortalLayoutComponent,
    canActivate: [authorized],
    loadChildren: () => import('@sankore/crm/settings'),
  },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    loadChildren: () => import('@sankore/crm/auth'),
  },
  {
    path: '**',
    redirectTo: 'auth/login',
  },
];
