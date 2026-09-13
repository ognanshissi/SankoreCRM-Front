import { Route } from '@angular/router';
import Login from './containers/login/login';
import ForgotPassword from './containers/forgot-password/forgot-password';
import { AccountActivationComponent } from './containers/account-activation/account-activation';
import { ResetPasswordComponent } from './containers/reset-password/reset-password';

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
  },
  {
    path: 'account-activation',
    loadComponent: () => AccountActivationComponent,
  },
  {
    path: 'reset-password',
    loadComponent: () => ResetPasswordComponent,
  },
];
