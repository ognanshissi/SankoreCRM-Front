import { Route } from '@angular/router';

export const supportRoutes: Route[] = [
  {
    path: '',
    title: 'Support · Sankore Admin',
    loadComponent: () => import('./containers/support/support-queue/support-queue'),
  },
  {
    path: ':ticketId',
    title: 'Ticket de support · Sankore Admin',
    loadComponent: () => import('./containers/support/support-ticket/platform-support-ticket'),
  },
];
