import { Route } from '@angular/router';

export const trialSignupRoutes: Route[] = [
  {
    path: '',
    title: 'Demandes d’essai · Sankore Admin',
    loadComponent: () => import('./containers/trial-signups/trial-signup-queue/trial-signup-queue'),
  },
  {
    path: ':signupId',
    title: 'Demande d’essai · Sankore Admin',
    loadComponent: () => import('./containers/trial-signups/trial-signup-detail/trial-signup-detail'),
  },
];
