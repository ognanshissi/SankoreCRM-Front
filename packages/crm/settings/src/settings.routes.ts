import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';
import AgenciesHomePage from './containers/agencies/agencies-homepage/agencies-homepage';
import EditRoleNavigation from './containers/roles/edit-role/edit-role-navigation';
import EditUserNavigation from './containers/users/edit-user/edit-user-navigation';
import EditWorkflowTemplateNavigation from './containers/workflows/edit-workflow-template/edit-workflow-template-navigation';

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
    path: 'company',
    loadComponent: () =>
      import('./containers/company/company'),
  },
  {
    path: 'workflows',
    loadComponent: () =>
      import('./containers/workflows/workflows-homepage/workflows-homepage'),
  },
  {
    path: 'workflows/ma-file',
    loadComponent: () => import('./containers/workflows/edit-workflow-template/my-queue'),
  },
  {
    path: 'workflows/analytiques',
    loadComponent: () => import('./containers/workflows/workflow-analytics/workflow-analytics'),
  },
  {
    path: 'workflows/:id',
    loadComponent: () => EditWorkflowTemplateNavigation,
    children: [
      { path: '', redirectTo: 'builder', pathMatch: 'full' },
      { path: 'builder', loadComponent: () => import('./containers/workflows/edit-workflow-template/builder') },
      { path: 'informations', loadComponent: () => import('./containers/workflows/edit-workflow-template/informations') },
      { path: 'etapes', loadComponent: () => import('./containers/workflows/edit-workflow-template/steps') },
      { path: 'declencheurs', loadComponent: () => import('./containers/workflows/edit-workflow-template/triggers') },
      { path: 'instances', loadComponent: () => import('./containers/workflows/edit-workflow-template/instances') },
      { path: 'instances/:instanceId', loadComponent: () => import('./containers/workflows/edit-workflow-template/instance-detail') },
      { path: 'analytiques', loadComponent: () => import('./containers/workflows/edit-workflow-template/analytics') },
      { path: 'comparer', loadComponent: () => import('./containers/workflows/edit-workflow-template/compare') },
    ],
  },
  {
    path: 'lead-sources',
    loadComponent: () =>
      import('./containers/lead-sources/lead-sources'),
  },
  {
    path: 'sla-configs',
    loadComponent: () =>
      import('./containers/sla-configs/sla-configs'),
  },
  {
    path: 'scoring-configs',
    loadComponent: () =>
      import('./containers/scoring-configs/scoring-configs'),
  },
  {
    path: 'task-types',
    loadComponent: () =>
      import('./containers/task-types/task-types'),
  },
  {
    path: 'dispatch-rules',
    loadComponent: () =>
      import('./containers/dispatch-rules/dispatch-rules'),
  },
  {
    path: 'pipeline-stages',
    loadComponent: () =>
      import('./containers/pipeline-stages/pipeline-stages'),
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
