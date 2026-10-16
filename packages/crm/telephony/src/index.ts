import telephonyRoutes from './telephony.routes';

/**
 * Surface publique de la lib `telephony`.
 *
 * On n'exporte ici QUE ce qui est consommé depuis une autre lib : les routes (par
 * `settings`), le référentiel de libellés et le client temps réel, que la coquille de
 * l'application et les fiches lead/client utiliseront pour le panneau d'appel et le badge
 * de connexion. Les écrans routés restent hors de cette barrique : ils ne sont atteints
 * que par `loadComponent`, et les exporter les tirerait dans le paquet de `settings`,
 * qui importe cette barrique pour ses routes alors qu'ils doivent rester chargés à la
 * demande.
 */

// ——— Libellés et messages, partagés avec les écrans hôtes ———
export * from './data-access/telephony-referential';

// ——— Client temps réel ———
export { TelephonyRealtimeService, TELEPHONY_REALTIME_EVENTS } from './data-access/telephony-realtime.service';
export type {
  TelephonyRealtimeState,
  TelephonyRealtimeEvent,
  TelephonyRealtimeEventName,
} from './data-access/telephony-realtime.service';

// ——— Blocs insérés dans les écrans hôtes (fiches lead et client) ———
// Le lecteur est ici parce que le journal, l'historique d'une fiche et le tableau de bord
// le consomment tous les trois : une copie par écran serait trois opinions sur la révocation
// de l'object URL, et c'est précisément la ligne qui rend vraie la promesse « aucun média
// conservé dans le navigateur ».
export { RecordingPlayer } from './components/recording-player/recording-player';

// Le formulaire de qualification est partagé par le panneau d'appel et par l'onglet
// « À qualifier » du journal, pour la même raison que le lecteur : deux copies seraient deux
// opinions sur la date de rappel obligatoire et sur la case d'enregistrement.
export { WrapUpForm } from './components/wrap-up-form/wrap-up-form';

// Le bouton « Appeler » est inséré dans les en-têtes de fiche lead et client, dans leurs
// listes, et dans le panneau d'appel lui-même. Une copie par hôte serait autant d'avis
// différents sur ce qu'il faut dire quand aucune sonnerie n'arrive.
export { CallButton } from './components/call-button/call-button';
export {
  TEL_CALL_SLOTS,
  TEL_CALL_SLOT_LABELS,
  telCallSlotLabel,
} from './components/call-button/click-to-call';
export type { ClickToCallPhase, ClickToCallState } from './components/call-button/click-to-call';

// Historique téléphonique d'une fiche, inséré dans la fiche lead et dans la fiche client.
export { CallHistory } from './components/call-history/call-history';
export { callClock, callDurationLabel } from './components/call-history/call-presentation';

// Panneau d'appel : monté UNE fois dans `app.html`, à côté de `<access-denied-banner />`.
// Le service est exporté avec lui parce que c'est lui qui porte l'état, exactement comme
// `AccessDeniedService` accompagne sa bannière.
export { CallPanel } from './components/call-panel/call-panel';
export { CallPanelService } from './components/call-panel/call-panel.service';
export type { ActiveCall, CallPanelPhase } from './components/call-panel/call-panel.service';

// État de la téléphonie de l'agent. Ce service fait trois choses et c'est voulu : il lit
// `GET telephony/me`, il ouvre la connexion temps réel, et il pose la pastille de la barre
// supérieure dans `TelephonyTopBarState`, que `common` rend. Le RENDU de la pastille vit
// dans `common` et non ici : une dépendance de `common` vers cette lib fermerait un cycle
// d'imports qui empêchait des modules de s'évaluer.
export { TelephonyStatusService } from './components/telephony-status-indicator/telephony-status.service';
export {
  TEL_LINK_STATUS_LABELS,
  telephonyIndicatorPill,
} from './components/telephony-status-indicator/telephony-pill';
export type {
  TelephonyPill,
  TelephonyPillInput,
  TelephonyPillTone,
} from './components/telephony-status-indicator/telephony-pill';

// Le compteur de liaisons cassées, pour le badge du menu Administration.
//
// Exporté bien qu'il vive sous `containers/` : il n'importe que le client généré et une aide
// pure, donc il ne tire AUCUN écran dans le paquet de `settings` — ce que la règle de cette
// barrique protège. Il répond `null` et non `0` quand la lecture échoue : un badge à zéro
// affirme qu'il n'y a rien à réparer, ce qu'une lecture ratée ne sait pas.
export { TelephonyUserLinksBadgeService } from './containers/user-links/telephony-user-links-badge.service';

export default telephonyRoutes;
