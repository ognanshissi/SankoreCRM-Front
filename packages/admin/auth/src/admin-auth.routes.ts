import { Route } from '@angular/router';
import { adminGuest } from './guards/admin-auth.guards';

export const adminAuthRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    canActivate: [adminGuest],
    title: 'Connexion · Sankore Admin',
    loadComponent: () => import('./containers/login/login'),
  },
];

export default adminAuthRoutes;
