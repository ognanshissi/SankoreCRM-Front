import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';
import AgenciesHomePage from './containers/agencies/agencies-homepage/agencies-homepage';
import EditRoleNavigation from './containers/roles/edit-role/edit-role-navigation';
import EditUserNavigation from './containers/users/edit-user/edit-user-navigation';

const settingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => OverviewComponent,
  },
  {
    path: 'agencies',
    loadComponent: () => AgenciesHomePage,
  },
  {
    path: 'agencies/:id/edit',
    loadComponent: () =>
      import('./containers/agencies/edit-agency/edit-agency'),
  },
  {
    path: 'users',
    loadComponent: () =>
      import('./containers/users/users-homepage/users-homepage'),
  },
  {
    path: 'users/:id',
    loadComponent: () => EditUserNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' },
      { path: 'informations', loadComponent: () => import('./containers/users/edit-user/informations') },
      { path: 'roles', loadComponent: () => import('./containers/users/edit-user/roles') },
      { path: 'parametrage', loadComponent: () => import('./containers/users/edit-user/parametrage') },
      { path: 'danger', loadComponent: () => import('./containers/users/edit-user/danger') },
    ],
  },
  {
    path: 'territories',
    loadComponent: () =>
      import('./containers/territories/territories-homepage/territories-homepage'),
  },
  {
    path: 'territories/:id/edit',
    loadComponent: () =>
      import('./containers/territories/edit-territory/edit-territory'),
  },
  {
    path: 'products',
    loadComponent: () =>
      import('./containers/products/products-homepage/products-homepage'),
  },
  {
    path: 'products/:id/edit',
    loadComponent: () =>
      import('./containers/products/edit-product/edit-product'),
  },
  {
    path: 'audit',
    loadComponent: () =>
      import('./containers/audit/audit-homepage/audit-homepage'),
  },
  {
    path: 'roles',
    loadComponent: () =>
      import('./containers/roles/roles-homepage/roles-homepage'),
  },
  {
    path: 'roles/:id',
    loadComponent: () => EditRoleNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' },
      { path: 'informations', loadComponent: () => import('./containers/roles/edit-role/informations') },
      { path: 'permissions', loadComponent: () => import('./containers/roles/edit-role/permissions') },
      { path: 'users', loadComponent: () => import('./containers/roles/edit-role/users') },
      { path: 'danger', loadComponent: () => import('./containers/roles/edit-role/danger') },
    ],
  },
];


export default settingsRoutes;
