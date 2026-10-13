import kycRoutes from './kyc.routes';

/**
 * Surface publique du module KYC.
 *
 * Les écrans routés ne sont pas exportés : ils sont chargés en lazy par `kyc.routes.ts`. On n'expose
 * que ce que les autres modules consomment réellement — l'encart de plafonds, à poser sur la fiche
 * client et au guichet, et de quoi afficher un statut KYC hors du module.
 */
export { KycCapsPanel } from './caps/kyc-caps-panel';
/** Suivi du lien de collecte à distance (KRM-F-07), posé aussi sur la fiche client de M01. */
export { KycRemoteInvitationsPanel } from './remote/kyc-remote-invitations-panel';
export { KycFilePreviewDrawer } from './preview/kyc-file-preview-drawer';
export type { KycFilePreviewDrawerData } from './preview/kyc-file-preview-drawer';
export { isKycWorkflowEntity } from './data-access/kyc-referential';
export { KycStatusBadge } from './ui/kyc-status-badge';
export { KycScoreGauge } from './ui/kyc-score-gauge';

/**
 * Le parcours client du KYC à distance (KRM-F-02 à F-05). Exporté parce que l'HÔTE en a
 * besoin : la route est déclarée au niveau de l'application, avant la route `kyc` gardée,
 * et l'intercepteur de session est enregistré avec les autres dans `app.config.ts`.
 */
export { KycRemoteVerificationPage } from './public/kyc-remote-verification';
export {
  KycRemoteSessionStore,
  kycRemoteSessionInterceptor,
} from './public/kyc-remote-session.store';

export { KycFacadeService } from './data-access/kyc-facade.service';
export { KycDraftStore } from './data-access/kyc-draft.store';
export * from './data-access/kyc-referential';
export * from './data-access/kyc.types';

export default kycRoutes;
