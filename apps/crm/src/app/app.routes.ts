import { Route } from '@angular/router';
import {
  AuthLayoutComponent,
  PortalLayoutComponent,
  UnknownTenantComponent,
  TenantSuspendedComponent,
  authorized,
  tenantGuard,
} from '@sankore/crm/common';

export const appRoutes: Route[] = [
  {
    path: '',
    redirectTo: 'tasks/my-day',
    pathMatch: 'full',
  },
  {
    path: 'tasks',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/tasks'),
  },
  {
    path: 'leads',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/lead-management')
  },
  {
    path: 'customers',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/customers'),
  },
  {
    // AVANT `kyc`, et c'est structurel : Angular résout dans l'ordre, et la route `kyc`
    // ci-dessous est gardée par `authorized`. Déclarée après, la page publique serait
    // capturée par elle et renverrait le client vers l'écran de connexion — c'est-à-dire
    // que le lien reçu par email n'aurait jamais fonctionné.
    //
    // Pas de `PortalLayoutComponent` : la page a sa propre mise en page, aux couleurs de
    // l'institution et sans aucun élément du back-office (KRM-F-02). Pas de `authorized`
    // non plus : le client n'a pas de compte, son jeton est dans le fragment de l'URL.
    // `tenantGuard` reste, parce que la page a besoin du contexte du tenant pour son logo
    // et parce que `tenantInterceptor` estampille les appels du FQDN que le serveur
    // compare au tenant du lien.
    path: 'kyc/verification',
    canActivate: [tenantGuard],
    loadComponent: () =>
      import('@sankore/crm/kyc').then((m) => m.KycRemoteVerificationPage),
  },
  {
    path: 'kyc',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/kyc'),
  },
  {
    path: 'settings',
    component: PortalLayoutComponent,
    canActivate: [tenantGuard, authorized],
    loadChildren: () => import('@sankore/crm/settings'),
  },
  {
    path: 'auth',
    component: AuthLayoutComponent,
    canActivate: [tenantGuard],
    loadChildren: () => import('@sankore/crm/auth'),
  },
  {
    // Destination de `tenantGuard`, volontairement sans garde : la protéger
    // créerait une boucle de redirection, et sans cette route le joker
    // ci-dessous renverrait vers /auth/login — lui-même gardé.
    path: 'unknown-tenant',
    component: UnknownTenantComponent,
  },
  {
    // Même raison d'être sans garde que `unknown-tenant` : c'est la destination de `tenantGuard`.
    path: 'tenant-suspended',
    component: TenantSuspendedComponent,
  },
  {
    path: '**',
    redirectTo: 'auth/login',
  },
];
