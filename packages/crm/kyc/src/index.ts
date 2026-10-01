import kycRoutes from './kyc.routes';

/**
 * Surface publique du module KYC.
 *
 * Les écrans routés ne sont pas exportés : ils sont chargés en lazy par `kyc.routes.ts`. On n'expose
 * que ce que les autres modules consomment réellement — l'encart de plafonds, à poser sur la fiche
 * client et au guichet, et de quoi afficher un statut KYC hors du module.
 */
export { KycCapsPanel } from './caps/kyc-caps-panel';
export { KycStatusBadge } from './ui/kyc-status-badge';
export { KycScoreGauge } from './ui/kyc-score-gauge';

export { KycFacadeService } from './data-access/kyc-facade.service';
export { KycDraftStore } from './data-access/kyc-draft.store';
export * from './data-access/kyc-referential';
export * from './data-access/kyc.types';

export default kycRoutes;
