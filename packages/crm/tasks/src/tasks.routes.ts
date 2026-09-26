import { Route } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';
import { DashboardComponent } from './containers/dashboard/dashboard';

const tasksRoutes: Route[] = [
  {
    path: 'my-day',
    canActivate: [],
    component: DashboardComponent,
  },
];

export default tasksRoutes;
