import OverviewComponent from './containers/overview/overview.component';
import { Routes } from '@angular/router';
import AgenciesHomePage from './containers/agencies/agencies-homepage/agencies-homepage';
import EditRoleNavigation from './containers/roles/edit-role/edit-role-navigation';
import EditUserNavigation from './containers/users/edit-user/edit-user-navigation';
import EditWorkflowTemplateNavigation from './containers/workflows/edit-workflow-template/edit-workflow-template-navigation';
import { hasPermissionGuard } from '@sankore/crm/common';

const paneRoutes: Routes = [
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
      {
        path: 'agent',
        loadComponent: () => import('./containers/account/account-agent-settings'),
      },
      {
        path: 'performance',
        loadComponent: () => import('./containers/account/account-performance'),
      },
      // Ancien onglet « Préférences » : la langue et les formats sont passés dans Informations.
      { path: 'account-settings', redirectTo: 'profil' },
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
        // Lecture pour toute personne qui voit la fiche ; les deux réglages exigent user:update,
        // vérifié par l'écran et par le serveur.
        canActivate: [hasPermissionGuard('user:read')],
        loadComponent: () => import('./containers/users/edit-user/parametrage'),
      },
      {
        // `GET /api/v1/users/{userId}/login-history` ne déclare aucune
        // permission : la garde reprend `user:read`, le droit déjà exigé par la
        // fiche utilisateur, au lieu d'un code inventé.
        path: 'connexions',
        canActivate: [hasPermissionGuard('user:read')],
        loadComponent: () => import('./containers/users/edit-user/connexions'),
      },
      {
        path: 'journal',
        canActivate: [hasPermissionGuard('audit:read')],
        loadComponent: () => import('./containers/users/edit-user/journal'),
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
  // Formulaires dynamiques (lot 2) : un onglet par entité, dans l'adresse pour qu'un lien mène au bon.
  { path: 'forms', redirectTo: 'forms/Lead', pathMatch: 'full' },
  {
    path: 'forms/:entity',
    canActivate: [hasPermissionGuard('form:manage')],
    loadComponent: () => import('./containers/entity-forms/entity-forms'),
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
  // Redirections déclarées ici et non dans les enfants de `workflows/:id` : une redirection enfant ne
  // voit pas le `:id` de la route parente (« Cannot redirect … Cannot find ':id' »).
  { path: 'workflows/:id', redirectTo: '/settings/workflows/:id/parcours', pathMatch: 'full' },
  // Ancienne adresse du canevas libre : les liens existants mènent au nouveau constructeur.
  { path: 'workflows/:id/builder', redirectTo: '/settings/workflows/:id/parcours', pathMatch: 'full' },
  {
    path: 'workflows/:id',
    canActivate: [hasPermissionGuard('workflow:read')],
    loadComponent: () => EditWorkflowTemplateNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' },
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
    // US-M01-FE-18. `PUT /api/v1/clients/segments/rules` exige
    // `customers:update_sensitive` : la garde reprend ce droit pour ne pas
    // ouvrir un écran d'écriture que le serveur refuserait.
    path: 'client-segments',
    canActivate: [hasPermissionGuard('customers:update_sensitive')],
    loadComponent: () =>
      import('./containers/client-segments/client-segment-rules'),
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
    // Lecture sur `kyc:read` comme l'écran KYC voisin, pour la même raison : consulter
    // le régime FATCA en vigueur est légitime pour qui lit déjà les dossiers, et
    // `GET /api/v1/compliance-settings` ne déclare aucune permission propre au contrat.
    // L'écran vérifie `kyc:settings:manage` avant toute écriture.
    path: 'conformite',
    canActivate: [hasPermissionGuard('kyc:read')],
    loadComponent: () => import('./containers/compliance/compliance-settings'),
  },
  {
    // Lecture sur `kyc:read`, comme `GET /kyc-settings` : la modification, elle, exige
    // `kyc:settings:manage`, vérifié dans l'écran et non par le garde — consulter les plafonds en
    // vigueur est légitime pour qui lit déjà les dossiers.
    path: 'kyc',
    canActivate: [hasPermissionGuard('kyc:read')],
    loadComponent: () => import('./containers/kyc-settings/kyc-settings'),
  },
  {
    path: 'task-types',
    canActivate: [hasPermissionGuard('lead:task-type:read')],
    loadComponent: () => import('./containers/task-types/task-types'),
  },
  {
    // La liste des règles est désormais l'écran Dispatching des leads, qui montre aussi ce que
    // chacune a distribué. L'ancienne adresse y mène, pour les favoris et les liens envoyés ;
    // la création et l'édition d'une règle restent ici.
    path: 'dispatch-rules',
    pathMatch: 'full' as const,
    redirectTo: '/leads/dispatching',
  },
  {
    path: 'dispatch-rules/create',
    canActivate: [hasPermissionGuard('lead:dispatching-rule:manage')],
    loadComponent: () =>
      import('./containers/dispatch-rules/dispatch-rule-editor/dispatch-rule-editor'),
  },
  {
    path: 'dispatch-rules/:id/edit',
    canActivate: [hasPermissionGuard('lead:dispatching-rule:manage')],
    loadComponent: () =>
      import('./containers/dispatch-rules/dispatch-rule-editor/dispatch-rule-editor'),
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
      {
        // Son propre écran et non une section de « parametrage » : les deux canaux ne partagent
        // ni fournisseur, ni secret, ni plafond, et un tenant fait tourner l'un sans l'autre.
        path: 'sms',
        canActivate: [hasPermissionGuard('notification:settings:read')],
        loadComponent: () => import('./containers/notifications/sms-parametrage'),
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
    // Deuxième entrée sur le même segment, volontairement. La précédente n'a pas
    // d'enfants : Angular exige qu'une route consomme toute l'URL, donc elle ne
    // matche que `/settings/integrations` exactement, et tout ce qui est plus
    // profond retombe ici. Fusionner les deux obligerait à déplacer la vue
    // d'ensemble dans la lib `integration`, où elle n'a rien à faire : elle
    // renvoie vers des écrans de `settings` (e-mail, webhooks, import).
    path: 'integrations',
    loadChildren: () => import('@sankore/crm/integration'),
  },
  {
    path: 'telephony',
    loadChildren: () => import('@sankore/crm/telephony'),
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

const settingsRoutes: Routes = [
  {
    // Constructeur de parcours en pleine page, hors de la navigation du modèle : il porte son propre
    // en-tête (version, publication) et a besoin de toute la largeur pour ses trois colonnes.
    // Déclaré avant `workflows/:id` pour ne pas être capturé par cette route.
    path: 'workflows/:id/parcours',
    canActivate: [hasPermissionGuard('workflow:read')],
    loadComponent: () =>
      import('./containers/workflows/journey-builder/journey-builder'),
  },
  ...paneRoutes,
];

export default settingsRoutes;
