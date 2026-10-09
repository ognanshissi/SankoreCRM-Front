import integrationRoutes from './integration.routes';

/**
 * Surface publique de la lib `integration`.
 *
 * On n'exporte ici QUE ce qui est consommé depuis une autre lib : les routes (par
 * `settings`), et les blocs réutilisables insérés dans des écrans hôtes (par `kyc` et
 * `customers`). Les écrans routés restent hors de cette barrique : `settings` l'importe
 * pour ses routes, et les exporter les tirerait dans son paquet alors qu'ils doivent
 * rester chargés à la demande.
 */

// ——— Données et libellés, partagés avec les écrans hôtes ———
export * from './data-access/integration-referential';
export {
  IntegrationFacadeService,
  defaultConnectionSettings,
  integrationErrorMessage,
} from './data-access/integration-facade.service';

export {
  CbsProvisioningService,
  cbsCapabilities,
  cbsProvisioningMeta,
  cbsBatchDelayLabel,
} from './data-access/cbs-provisioning.service';
export type {
  CbsProvisioningState,
  CbsProvisioningStatus,
  CbsBatchNotice,
  CbsCapabilities,
} from './data-access/cbs-provisioning.service';

// ——— Blocs insérés dans les écrans hôtes (kyc, customers) ———
export {
  CbsProvisioningStatusComponent,
  CbsBatchNoticeComponent,
} from './components/cbs-provisioning-status';
export type { CbsProvisioningAppearance } from './components/cbs-provisioning-status';
export { CoreBankingBlockComponent } from './components/core-banking-block';
export type {
  CbsAccountRow,
  CbsLoanRow,
  CbsMonthlyFlow,
} from './components/core-banking-block';

export {
  InsurancePoliciesBlock,
  isPolicyAtRisk,
} from './components/insurance-policies-block';
export { CustomerClaimsList } from './containers/claims/customer-claims-list';

/**
 * Exception à la règle « pas d'écran dans la barrique » : le parcours de souscription
 * est lancé depuis la fiche client (lib `customers`), pas depuis une route de ce
 * module. La fiche charge déjà cette barrique pour ses blocs Core banking et
 * Assurances, donc l'écran n'ajoute pas de téléchargement.
 */
export { SubscribePolicyPage } from './containers/subscription/subscribe-policy';
export {
  DeclareClaimDrawer,
  type DeclareClaimDrawerData,
} from './components/declare-claim-drawer';
export {
  ClaimDetailDrawer,
  type ClaimDetailDrawerData,
} from './components/claim-detail-drawer';

export default integrationRoutes;
