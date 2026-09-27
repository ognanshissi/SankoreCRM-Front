import { Route } from '@angular/router';
import {
  AuthLayoutComponent,
  PortalLayoutComponent,
  UnknownTenantComponent,
  authorized,
  tenantGuard,
} from '@sankore/crm/common';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'tasks/my-day',
    pathMatch: 'full',
  },
  {
    path: 'tasks',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/tasks'),
  },
  {
    path: 'leads',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/lead-management')
  },
  {
    path: 'settings',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/settings'),
  },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    canActivate: [tenantGuard],
    loadChildren: () => import('@sankore/crm/auth'),
  },
  {
    // Destination de `tenantGuard`, volontairement sans garde : la protéger
    // créerait une boucle de redirection, et sans cette route le joker
    // ci-dessous renverrait vers /auth/login — lui-même gardé.
    path: 'unknown-tenant',
    component: UnknownTenantComponent,
  },
  {
    path: '**',
    redirectTo: 'auth/login',
  },
];
