import { Route } from '@angular/router';
import { AuthLayoutComponent, AdminLayoutComponent } from '@sankore/crm/common';

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
    component: AdminLayoutComponent,
    loadChildren: () => import('@sankore/crm/tasks')
  }
];
