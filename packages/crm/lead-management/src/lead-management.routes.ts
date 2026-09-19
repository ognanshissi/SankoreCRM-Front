import LeadHomepage from './containers/lead-homepage/lead-homepage';
import EditLeadNavigation from './containers/edit-lead/edit-lead-navigation';

export const leadManagementRoutes = [
  {
    path: '',
    component: LeadHomepage,
  },
  {
    path: ':id',
    loadComponent: () => EditLeadNavigation,
    children: [
      { path: '', redirectTo: 'informations', pathMatch: 'full' as const },
      { path: 'informations', loadComponent: () => import('./containers/edit-lead/informations') },
      { path: 'qualification', loadComponent: () => import('./containers/edit-lead/qualification') },
      { path: 'score', loadComponent: () => import('./containers/edit-lead/score') },
      { path: 'timeline', loadComponent: () => import('./containers/edit-lead/timeline') },
      { path: 'taches', loadComponent: () => import('./containers/edit-lead/taches') },
      { path: 'activites', loadComponent: () => import('./containers/edit-lead/activites') },
      { path: 'doublons', loadComponent: () => import('./containers/edit-lead/doublons') },
      { path: 'consentement', loadComponent: () => import('./containers/edit-lead/consentement') },
    ],
  },
];

export default leadManagementRoutes;
