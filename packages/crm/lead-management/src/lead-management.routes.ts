import { hasPermissionGuard } from '@sankore/crm/common';
import LeadHomepage from './containers/lead-homepage/lead-homepage';
import EditLeadNavigation from './containers/edit-lead/edit-lead-navigation';
import { LeadEditContext } from './containers/edit-lead/lead-edit-context';

export const leadManagementRoutes = [
  {
    path: '',
    canActivate: [hasPermissionGuard('lead:read')],
    component: LeadHomepage,
  },
  {
    path: 'analytics',
    canActivate: [hasPermissionGuard('lead:analytics:view')],
    loadComponent: () => import('./containers/analytics/analytics-dashboard'),
  },
  {
    // Avant `:id`, sinon le joker capturerait « import » comme identifiant de lead.
    path: 'import',
    canActivate: [hasPermissionGuard('lead:import')],
    loadComponent: () => import('./containers/import-leads-page/import-leads-page'),
  },
  {
    path: ':id',
    canActivate: [hasPermissionGuard('lead:read')],
    loadComponent: () => EditLeadNavigation,
    // Fourni au niveau de la route, et non du composant : les onglets sont des
    // routes enfants chargées en lazy, et c'est l'injecteur de la route parente
    // qu'elles héritent toutes de façon garantie.
    providers: [LeadEditContext],
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' as const },
      {
        path: 'informations',
        loadComponent: () => import('./containers/edit-lead/informations'),
      },
      {
        path: 'qualification',
        canActivate: [hasPermissionGuard('lead:qualify')],
        loadComponent: () => import('./containers/edit-lead/qualification'),
      },
      {
        path: 'score',
        canActivate: [hasPermissionGuard('lead:scoring-config:read')],
        loadComponent: () => import('./containers/edit-lead/score'),
      },
      {
        path: 'timeline',
        loadComponent: () => import('./containers/edit-lead/timeline'),
      },
      {
        path: 'taches',
        canActivate: [hasPermissionGuard('lead:task:read')],
        loadComponent: () => import('./containers/edit-lead/taches'),
      },
      {
        path: 'activites',
        loadComponent: () => import('./containers/edit-lead/activites'),
      },
      {
        path: 'opportunites',
        canActivate: [hasPermissionGuard('lead:opportunity:read')],
        loadComponent: () =>
          import('./containers/edit-lead/opportunities/opportunities'),
      },
      {
        path: 'rappels',
        canActivate: [hasPermissionGuard('lead:reminder:manage')],
        loadComponent: () => import('./containers/edit-lead/reminders'),
      },
      {
        path: 'doublons',
        canActivate: [hasPermissionGuard('lead:merge', 'lead:duplicate:dismiss')],
        loadComponent: () => import('./containers/edit-lead/doublons'),
      },
      {
        path: 'consentement',
        canActivate: [
          hasPermissionGuard('lead:consent:record', 'lead:consent:withdraw'),
        ],
        loadComponent: () => import('./containers/edit-lead/consentement'),
      },
    ],
  },
];

export default leadManagementRoutes;
