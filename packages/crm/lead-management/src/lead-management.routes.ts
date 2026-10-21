import { hasPermissionGuard } from '@sankore/crm/common';
import LeadHomepage from './containers/lead-homepage/lead-homepage';
import EditLeadNavigation from './containers/edit-lead/edit-lead-navigation';
import { LeadEditContext } from './containers/edit-lead/lead-edit-context';
import { LeadComplianceStore } from './containers/edit-lead/lead-compliance-store';
import { leadIdFromAncestors } from './containers/edit-lead/suivi/lead-id.resolver';

export const leadManagementRoutes = [
  {
    path: '',
    canActivate: [hasPermissionGuard('lead:read')],
    component: LeadHomepage,
  },
  {
    path: 'reports',
    canActivate: [hasPermissionGuard('lead:report:view')],
    title: 'Rapports',
    loadComponent: () => import('./containers/reports/reports-page'),
  },
  {
    path: 'dispatching',
    canActivate: [hasPermissionGuard('lead:dispatching-rule:read')],
    title: 'Dispatching',
    loadComponent: () => import('./containers/dispatching/dispatching-page'),
  },
  {
    path: 'analytics',
    canActivate: [hasPermissionGuard('lead:analytics:view')],
    loadComponent: () => import('./containers/analytics/analytics-dashboard'),
  },
  {
    // WA-FE-09 — l'inbox WhatsApp. Avant `:id`, comme « import ».
    path: 'whatsapp',
    canActivate: [hasPermissionGuard('WhatsApp.Send', 'WhatsApp.Reply', 'WhatsApp.Supervise')],
    title: 'WhatsApp',
    loadComponent: () => import('./containers/whatsapp-inbox/whatsapp-inbox-page'),
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
    providers: [LeadEditContext, LeadComplianceStore],
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' as const },
      {
        path: 'informations',
        loadComponent: () => import('./containers/edit-lead/informations'),
      },
      {
        path: 'identite',
        loadComponent: () => import('./containers/edit-lead/identite'),
      },
      {
        path: 'foyer',
        loadComponent: () => import('./containers/edit-lead/foyer'),
      },
      {
        path: 'conformite',
        loadComponent: () => import('./containers/edit-lead/conformite'),
      },
      {
        path: 'questionnaires',
        loadComponent: () => import('./containers/edit-lead/questionnaires'),
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
        // Activités, rappels, tâches et chronologie : une page, quatre onglets.
        path: 'suivi',
        loadComponent: () => import('./containers/edit-lead/suivi/suivi'),
        children: [
          { path: '', redirectTo: 'activites', pathMatch: 'full' as const },
          {
            path: 'activites',
            resolve: { id: leadIdFromAncestors },
            loadComponent: () => import('./containers/edit-lead/activites'),
          },
          {
            path: 'rappels',
            canActivate: [hasPermissionGuard('lead:reminder:manage')],
            resolve: { id: leadIdFromAncestors },
            loadComponent: () => import('./containers/edit-lead/reminders'),
          },
          {
            path: 'taches',
            canActivate: [hasPermissionGuard('lead:task:read')],
            resolve: { id: leadIdFromAncestors },
            loadComponent: () => import('./containers/edit-lead/taches'),
          },
          {
            path: 'timeline',
            resolve: { id: leadIdFromAncestors },
            loadComponent: () => import('./containers/edit-lead/timeline'),
          },
          {
            // WA-FE-05 : le fil WhatsApp. Lire un fil demande d'envoyer ou de superviser ; le
            // serveur ajoute la règle de propriété du lead.
            path: 'whatsapp',
            canActivate: [hasPermissionGuard('WhatsApp.Send', 'WhatsApp.Supervise')],
            resolve: { id: leadIdFromAncestors },
            loadComponent: () => import('./containers/edit-lead/whatsapp/whatsapp-conversation'),
          },
        ],
      },
      // Les anciennes adresses mènent toujours quelque part : un lien envoyé ou un favori.
      { path: 'activites', redirectTo: 'suivi/activites', pathMatch: 'full' as const },
      { path: 'rappels', redirectTo: 'suivi/rappels', pathMatch: 'full' as const },
      { path: 'taches', redirectTo: 'suivi/taches', pathMatch: 'full' as const },
      { path: 'timeline', redirectTo: 'suivi/timeline', pathMatch: 'full' as const },
      {
        path: 'opportunites',
        canActivate: [hasPermissionGuard('lead:opportunity:read')],
        loadComponent: () =>
          import('./containers/edit-lead/opportunities/opportunities'),
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
