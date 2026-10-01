import { Route } from '@angular/router';
import { hasPermissionGuard } from '@sankore/crm/common';

/**
 * Routes du module KYC.
 *
 * L'ordre compte : les segments fixes doivent précéder `:id`, sinon le joker les capturerait comme
 * identifiants de dossier.
 *
 * **Permissions : les codes propres au KYC**, désormais exposés par le backend et présents au
 * catalogue. `kyc:read` pour consulter — c'est ce que le swagger exige sur `GET /kyc-files` et sur
 * les plafonds — et `kyc:manage` pour enrôler, le droit d'écriture du module (swagger :
 * `POST /kyc-files/{id}/documents`). Les gardes étaient jusqu'ici sur `customers:read` /
 * `customers:create`, faute de codes KYC : un simple droit de lecture client ouvrait la conformité,
 * et le droit de créer une fiche suffisait à enrôler.
 *
 * Reste à traiter : le circuit de validation. `kyc:approve` existe au catalogue, mais décider se
 * fait depuis l'écran de détail, pas depuis une route dédiée — c'est donc le composant de décision
 * qui doit le porter, pas un garde.
 */
export const kycRoutes: Route[] = [
  {
    path: '',
    canActivate: [hasPermissionGuard('kyc:read')],
    loadComponent: () => import('./dashboard/kyc-dashboard'),
  },
  {
    // Avant `:id`, sinon le joker capturerait « enrolment » comme identifiant de dossier.
    path: 'enrolment/:customerId',
    canActivate: [hasPermissionGuard('kyc:manage')],
    loadComponent: () => import('./enrolment/kyc-enrolment'),
  },
  {
    path: ':id',
    canActivate: [hasPermissionGuard('kyc:read')],
    loadComponent: () => import('./detail/kyc-file-detail'),
  },
];

export default kycRoutes;
