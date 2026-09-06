import { Route } from '@angular/router';
import { AuthLayoutComponent, AdminLayoutComponent, PortalLayoutComponent } from '@sankore/crm/common';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'tasks/my-day',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    loadChildren: () => import('@sankore/crm/auth')
  },
  {
    path: 'tasks',
    component: PortalLayoutComponent,
    loadChildren: () => import('@sankore/crm/tasks')
  }
];
