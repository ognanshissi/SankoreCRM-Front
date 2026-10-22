import { Route } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';
import { DashboardComponent } from './containers/dashboard/dashboard';

const tasksRoutes: Route[] = [
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
    // Après les chemins nommés : « my-day » et « calendar » ne sont pas des identifiants de tâche.
    path: ':taskId',
    loadComponent: () => import('./containers/task/task-page'),
  },
];

export default tasksRoutes;
