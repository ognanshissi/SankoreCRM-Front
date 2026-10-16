import {
  telDurationLabel, TEL_EMPTY_LABEL } from '../../data-access/telephony-referential';

/**
 * Durée d'un appel, telle qu'une ligne d'historique l'affiche.
 *
 * `null` et `0` ne sont pas la même chose et ne s'écrivent pas pareil : le serveur laisse
 * `talkSeconds` à `null` pour un appel que personne n'a décroché — il n'y a pas eu de
 * conversation, ce n'est pas une conversation de zéro seconde. Écrire « 0 s » dans ce cas
 * ferait lire « appel éclair » là où il faut lire « pas de réponse ».
 */
export function callDurationLabel(seconds: number | null | undefined): string {
  // Déléguée au référentiel, qui porte la seule mise en forme de durée de la famille : trois
  // écrans en avaient écrit une chacun et elles ne rendaient pas tout à fait pareil.
  return telDurationLabel(seconds);
}

/**
 * Chronomètre du panneau d'appel, en `mm:ss` (et `h:mm:ss` au-delà de l'heure).
 *
 * Il part de la réception du push « décroché » par CE navigateur, pas d'un horodatage
 * serveur : le contrat n'en envoie aucun dans la trame. C'est donc une mesure de l'écran,
 * pas la durée facturée de l'appel — l'écart est le temps de livraison du push.
 */
export function callClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;

  const mmss = `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;

  return hours > 0 ? `${hours}:${mmss}` : mmss;
}
