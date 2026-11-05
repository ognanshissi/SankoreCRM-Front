import { Route } from '@angular/router';
import { hasPermissionGuard, PERMISSIONS } from '@sankore/crm/common';
import { DashboardComponent } from './containers/dashboard/dashboard';

const tasksRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [hasPermissionGuard(PERMISSIONS.LEAD_TASK_READ)],
    loadComponent: () => import('./containers/task-list/task-list'),
  },
  {
    path: 'my-day',
    canActivate: [],
    component: DashboardComponent,
  },
  {
    path: 'calendar',
    loadComponent: () => import('./containers/calendar/calendar-page'),
  },
  {
    path: 'mail',
    canActivate: [hasPermissionGuard(PERMISSIONS.CONNECTED_ACCOUNTS_USE)],
    loadComponent: () => import('./containers/mail/mailbox-page'),
  },
  {
    // Après les chemins nommés : « my-day », « calendar » et « mail » ne sont pas des identifiants de tâche.
    path: ':taskId',
    loadComponent: () => import('./containers/task/task-page'),
  },
];

export default tasksRoutes;
