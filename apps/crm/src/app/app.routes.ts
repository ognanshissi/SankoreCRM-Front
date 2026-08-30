import { Route } from '@angular/router';
import { AuthLayoutComponent } from '@sankore/common';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: '/auth/login',
    pathMatch: 'full',
  },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    loadChildren: () => import('@sankore/auth')
  }
];
