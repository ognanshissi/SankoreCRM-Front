import { Route } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';

/**
 * Routes du module KYC.
 *
 * L'ordre compte : les segments fixes doivent précéder `:id`, sinon le joker les capturerait comme
 * identifiants de dossier.
 *
 * **Permission retenue : `customers:read`.** Le catalogue `PERMISSIONS` ne contient aucun code propre
 * au KYC, et les descriptions des endpoints KYC-B-08 n'en déclarent pas non plus. Un dossier KYC étant
 * la conformité d'un client, c'est le droit de lecture client qui s'en approche le plus. **À
 * remplacer** par des codes dédiés (`kyc:read`, `kyc:decide`) dès que le backend les expose : le
 * circuit de validation mérite son propre droit, distinct de la lecture d'une fiche client.
 */
export const kycRoutes: Route[] = [
  {
    path: '',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () => import('./dashboard/kyc-dashboard'),
  },
  {
    // Avant `:id`, sinon le joker capturerait « enrolment » comme identifiant de dossier.
    path: 'enrolment/:customerId',
    canActivate: [hasPermissionGuard('customers:create')],
    loadComponent: () => import('./enrolment/kyc-enrolment'),
  },
  {
    path: ':id',
    canActivate: [hasPermissionGuard('customers:read')],
    loadComponent: () => import('./detail/kyc-file-detail'),
  },
];

export default kycRoutes;
