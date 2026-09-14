import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';
import AgenciesHomePage from './containers/agencies/agencies-homepage/agencies-homepage';
import EditRoleNavigation from './containers/roles/edit-role-navigation/edit-role-navigation';

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
    path: 'roles',
    loadComponent: () =>
      import('./containers/roles/roles-homepage/roles-homepage'),
  },
  {
    path: 'roles/:id',
    loadComponent: () => EditRoleNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' },
      { path: 'informations', loadComponent: () => import('./containers/roles/edit-role-navigation/informations') },
      { path: 'permissions', loadComponent: () => import('./containers/roles/edit-role-navigation/permissions') },
      { path: 'users', loadComponent: () => import('./containers/roles/edit-role-navigation/users') },
      { path: 'danger', loadComponent: () => import('./containers/roles/edit-role-navigation/danger') },
    ],
  },
];


export default settingsRoutes;
