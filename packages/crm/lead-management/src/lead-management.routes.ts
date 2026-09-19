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
      { path: 'doublons', loadComponent: () => import('./containers/edit-lead/doublons') },
      { path: 'consentement', loadComponent: () => import('./containers/edit-lead/consentement') },
      { path: 'score', loadComponent: () => import('./containers/edit-lead/score') },
      { path: 'activites', loadComponent: () => import('./containers/edit-lead/activites') },
    ],
  },
];

export default leadManagementRoutes;
