import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';
import AgenciesHomePage from './containers/agencies/agencies-homepage/agencies-homepage';
import EditRoleNavigation from './containers/roles/edit-role/edit-role-navigation';
import EditUserNavigation from './containers/users/edit-user/edit-user-navigation';
import EditWorkflowTemplateNavigation from './containers/workflows/edit-workflow-template/edit-workflow-template-navigation';
import AccountSettings from './containers/account/account-settings';
import { hasPermissionGuard } from '@sankore/crm/common';

const settingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () => OverviewComponent,
  },
  {
    path: 'account',
    loadComponent: () => import('./containers/account/account-navigation'),
    children: [
      { path: '', redirectTo: 'profil', pathMatch: 'full' as const },
      {
        path: 'profil',
        loadComponent: () => import('./containers/account/account-profile'),
      },
      {
        path: 'securite',
        loadComponent: () => import('./containers/account/account-security'),
      },
      { path: 'account-settings', loadComponent: () => AccountSettings },
    ],
  },
  {
    path: 'agencies',
    canActivate: [hasPermissionGuard('agency:read')],
    loadComponent: () => AgenciesHomePage,
  },
  {
    path: 'agencies/:id/edit',
    canActivate: [hasPermissionGuard('agency:read')],
    loadComponent: () =>
      import('./containers/agencies/edit-agency/edit-agency'),
  },
  {
    path: 'users',
    canActivate: [hasPermissionGuard('user:read')],
    loadComponent: () =>
      import('./containers/users/users-homepage/users-homepage'),
  },
  {
    path: 'users/:id',
    canActivate: [hasPermissionGuard('user:read')],
    loadComponent: () => EditUserNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' },
      {
        path: 'informations',
        loadComponent: () =>
          import('./containers/users/edit-user/informations'),
      },
      {
        path: 'roles',
        canActivate: [hasPermissionGuard('user:assign-role', 'user:revoke-role')],
        loadComponent: () => import('./containers/users/edit-user/roles'),
      },
      {
        path: 'parametrage',
        canActivate: [hasPermissionGuard('user:assign-permission', 'user:revoke-permission')],
        loadComponent: () => import('./containers/users/edit-user/parametrage'),
      },
      {
        path: 'danger',
        canActivate: [hasPermissionGuard('user:deactivate', 'user:reactivate', 'user:reset-password')],
        loadComponent: () => import('./containers/users/edit-user/danger'),
      },
    ],
  },
  {
    path: 'territories',
    canActivate: [hasPermissionGuard('territory:read')],
    loadComponent: () =>
      import('./containers/territories/territories-homepage/territories-homepage'),
  },
  {
    path: 'territories/:id/edit',
    canActivate: [hasPermissionGuard('territory:read')],
    loadComponent: () =>
      import('./containers/territories/edit-territory/edit-territory'),
  },
  {
    path: 'products',
    canActivate: [hasPermissionGuard('product:read')],
    loadComponent: () =>
      import('./containers/products/products-homepage/products-homepage'),
  },
  {
    path: 'products/:id/edit',
    canActivate: [hasPermissionGuard('product:read')],
    loadComponent: () =>
      import('./containers/products/edit-product/edit-product'),
  },
  {
    path: 'company',
    canActivate: [hasPermissionGuard('company:read')],
    loadComponent: () => import('./containers/company/company'),
  },
  {
    path: 'workflows',
    canActivate: [hasPermissionGuard('workflow:read')],
    loadComponent: () =>
      import('./containers/workflows/workflows-homepage/workflows-homepage'),
  },
  {
    path: 'workflows/ma-file',
    canActivate: [hasPermissionGuard('workflow:task:complete', 'workflow:approve')],
    loadComponent: () =>
      import('./containers/workflows/edit-workflow-template/my-queue'),
  },
  {
    path: 'workflows/analytiques',
    canActivate: [hasPermissionGuard('workflow:analytics:view')],
    loadComponent: () =>
      import('./containers/workflows/workflow-analytics/workflow-analytics'),
  },
  {
    path: 'workflows/:id',
    canActivate: [hasPermissionGuard('workflow:read')],
    loadComponent: () => EditWorkflowTemplateNavigation,
    children: [
      { path: '', redirectTo: 'builder', pathMatch: 'full' },
      {
        path: 'builder',
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/builder'),
      },
      {
        path: 'informations',
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/informations'),
      },
      {
        path: 'etapes',
        canActivate: [hasPermissionGuard('workflow:manage-steps')],
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/steps'),
      },
      {
        path: 'declencheurs',
        canActivate: [hasPermissionGuard('workflow:trigger:manage')],
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/triggers'),
      },
      {
        path: 'instances',
        canActivate: [hasPermissionGuard('workflow:instance:view')],
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/instances'),
      },
      {
        path: 'instances/:instanceId',
        canActivate: [hasPermissionGuard('workflow:instance:view')],
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/instance-detail'),
      },
      {
        path: 'analytiques',
        canActivate: [hasPermissionGuard('workflow:analytics:view')],
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/analytics'),
      },
      {
        path: 'comparer',
        loadComponent: () =>
          import('./containers/workflows/edit-workflow-template/compare'),
      },
    ],
  },
  {
    path: 'qualification-templates',
    canActivate: [hasPermissionGuard('lead:qualification-template:manage')],
    loadComponent: () =>
      import('./containers/qualification-templates/qualification-templates'),
  },
  {
    path: 'qualification-templates/:id/edit',
    canActivate: [hasPermissionGuard('lead:qualification-template:manage')],
    loadComponent: () =>
      import('./containers/qualification-templates/edit-qualification-template/edit-qualification-template'),
  },
  {
    path: 'import-users',
    canActivate: [hasPermissionGuard('user:create')],
    loadComponent: () => import('./containers/import-users/import-users'),
  },
  {
    path: 'lead-sources',
    canActivate: [hasPermissionGuard('lead:source:read')],
    loadComponent: () => import('./containers/lead-sources/lead-sources'),
  },
  {
    path: 'lead-sources/create',
    canActivate: [hasPermissionGuard('lead:source:manage')],
    loadComponent: () => import('./containers/lead-sources/create-lead-source'),
  },
  {
    path: 'lead-sources/quality',
    canActivate: [hasPermissionGuard('lead:source:read')],
    loadComponent: () => import('./containers/lead-sources/source-quality'),
  },
  {
    path: 'lead-sources/:id',
    canActivate: [hasPermissionGuard('lead:source:read')],
    loadComponent: () => import('./containers/lead-sources/edit-lead-source/edit-lead-source'),
  },
  {
    path: 'sla-configs',
    canActivate: [hasPermissionGuard('lead:sla-config:read')],
    loadComponent: () => import('./containers/sla-configs/sla-configs'),
  },
  {
    path: 'sla-configs/create',
    canActivate: [hasPermissionGuard('lead:sla-config:manage')],
    loadComponent: () => import('./containers/sla-configs/create-sla-config'),
  },
  {
    path: 'scoring-configs',
    canActivate: [hasPermissionGuard('lead:scoring-config:read')],
    loadComponent: () => import('./containers/scoring-configs/scoring-configs'),
  },
  {
    path: 'task-types',
    canActivate: [hasPermissionGuard('lead:task-type:read')],
    loadComponent: () => import('./containers/task-types/task-types'),
  },
  {
    path: 'dispatch-rules',
    canActivate: [hasPermissionGuard('lead:dispatching-rule:read')],
    loadComponent: () => import('./containers/dispatch-rules/dispatch-rules'),
  },
  {
    path: 'dispatch-rules/create',
    canActivate: [hasPermissionGuard('lead:dispatching-rule:manage')],
    loadComponent: () =>
      import('./containers/dispatch-rules/create-dispatch-rule'),
  },
  {
    path: 'dispatch-rules/:id/edit',
    canActivate: [hasPermissionGuard('lead:dispatching-rule:manage')],
    loadComponent: () =>
      import('./containers/dispatch-rules/edit-dispatch-rule'),
  },
  {
    path: 'pipeline-stages',
    canActivate: [hasPermissionGuard('lead:pipeline-stage:read')],
    loadComponent: () => import('./containers/pipeline-stages/pipeline-stages'),
  },
  {
    path: 'notifications',
    canActivate: [hasPermissionGuard('notification:settings:read', 'notification:outbox:read', 'notification:delivery-log:read')],
    loadComponent: () =>
      import('./containers/notifications/notification-navigation'),
    children: [
      { path: '', redirectTo: 'journal', pathMatch: 'full' as const },
      {
        path: 'parametrage',
        canActivate: [hasPermissionGuard('notification:settings:read')],
        loadComponent: () =>
          import('./containers/notifications/notification-parametrage'),
      },
      {
        path: 'journal',
        canActivate: [hasPermissionGuard('notification:outbox:read', 'notification:delivery-log:read')],
        loadComponent: () =>
          import('./containers/notifications/notification-journal'),
      },
    ],
  },
  {
    path: 'email-templates',
    canActivate: [hasPermissionGuard('notification:template:read')],
    loadComponent: () => import('./containers/email-templates/email-templates'),
  },
  {
    path: 'email-templates/create',
    canActivate: [hasPermissionGuard('notification:template:manage')],
    loadComponent: () =>
      import('./containers/email-templates/edit-email-template'),
  },
  {
    path: 'email-templates/:id/edit',
    canActivate: [hasPermissionGuard('notification:template:manage')],
    loadComponent: () =>
      import('./containers/email-templates/edit-email-template'),
  },
  {
    path: 'integrations',
    canActivate: [hasPermissionGuard('lead:source:read')],
    loadComponent: () => import('./containers/integrations/integrations-hub'),
  },
  {
    path: 'audit',
    canActivate: [hasPermissionGuard('audit:read')],
    loadComponent: () =>
      import('./containers/audit/audit-homepage/audit-homepage'),
  },
  {
    path: 'roles',
    canActivate: [hasPermissionGuard('role:read')],
    loadComponent: () =>
      import('./containers/roles/roles-homepage/roles-homepage'),
  },
  {
    path: 'roles/:id',
    canActivate: [hasPermissionGuard('role:read')],
    loadComponent: () => EditRoleNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' },
      {
        path: 'informations',
        loadComponent: () =>
          import('./containers/roles/edit-role/informations'),
      },
      {
        path: 'permissions',
        canActivate: [hasPermissionGuard('role:manage-permissions')],
        loadComponent: () => import('./containers/roles/edit-role/permissions'),
      },
      {
        path: 'users',
        loadComponent: () => import('./containers/roles/edit-role/users'),
      },
      {
        path: 'danger',
        canActivate: [hasPermissionGuard('role:delete')],
        loadComponent: () => import('./containers/roles/edit-role/danger'),
      },
    ],
  },
];


export default settingsRoutes;
