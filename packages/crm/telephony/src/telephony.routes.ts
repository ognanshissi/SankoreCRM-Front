import { Routes } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';

/**
 * Routes du module Téléphonie, montées sous `/settings/telephony` par
 * `settings.routes.ts` (`loadChildren`).
 *
 * Chaque route porte la permission que l'endpoint correspondant déclare dans le
 * swagger, à la lettre et en PascalCase pointé — c'est la forme que le serveur
 * accorde, pas une coquille.
 *
 * Les écrans ne sont pas exportés depuis `index.ts` : ils ne sont atteints que par
 * `loadComponent`, et les exporter depuis la barrique les ferait entrer dans le
 * paquet de `settings`, qui importe cette barrique pour ses routes.
 */
const telephonyRoutes: Routes = [
  {
    path: '',
    redirectTo: 'journal',
    pathMatch: 'full',
  },
  {
    // Gardé sur la LECTURE, pas sur `Telephony.Call.Link` ni `Telephony.Call.Make` :
    // rattacher un appel et passer un appel sont des écritures, et l'écran masque
    // lui-même ces boutons. Une route gardée sur l'écriture cacherait le journal aux
    // gens dont le métier est de le lire.
    path: 'journal',
    canActivate: [hasPermissionGuard('Telephony.Call.View')],
    loadComponent: () => import('./containers/journal/journal-page'),
  },
  {
    path: 'missed',
    canActivate: [hasPermissionGuard('Telephony.Call.View')],
    loadComponent: () => import('./containers/missed/missed-calls-page'),
  },
  {
    path: 'dashboard',
    canActivate: [hasPermissionGuard('Telephony.Stats.View')],
    loadComponent: () =>
      import('./containers/dashboard/telephony-dashboard-page'),
  },
  {
    // La politique d'enregistrement vit aussi sur cet écran, mais elle est accordée par
    // `admin:compliance:manage` : la garde reste sur le droit de la famille, et c'est
    // l'écran qui masque le bloc conformité. Garder la route sur les deux fermerait les
    // réglages téléphoniques à un administrateur téléphonie qui n'est pas conformité.
    path: 'settings',
    canActivate: [hasPermissionGuard('Telephony.Settings.Manage')],
    loadComponent: () =>
      import('./containers/settings/telephony-settings-page'),
  },
  {
    path: 'user-links',
    canActivate: [hasPermissionGuard('Telephony.Settings.Manage')],
    loadComponent: () => import('./containers/user-links/user-links-page'),
  },
];

export default telephonyRoutes;
