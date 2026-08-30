import { Route } from '@angular/router';
import Login from './containers/login/login';
import ForgotPassword from './containers/forgot-password/forgot-password';

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
  {
    path: 'forgot-password',
    loadComponent: () => ForgotPassword,
  }
];
