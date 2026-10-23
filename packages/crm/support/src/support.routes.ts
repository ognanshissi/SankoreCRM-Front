import { Route } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';

const supportRoutes: Route[] = [
  {
    path: '',
    canActivate: [hasPermissionGuard('support:read')],
    loadComponent: () => import('./containers/support-list/support-list'),
  },
  {
    path: ':ticketId',
    canActivate: [hasPermissionGuard('support:read')],
    loadComponent: () => import('./containers/support-ticket/support-ticket'),
  },
];

export default supportRoutes;
