import { Route } from '@angular/router';
import Login from './containers/login/login';

export const authRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () => Login,
  },
];
