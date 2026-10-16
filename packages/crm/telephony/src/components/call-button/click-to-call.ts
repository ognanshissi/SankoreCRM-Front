import { RequestClickToCallRequestSlotEnum } from '@sankore/crm-api';
import { TelephonyRealtimeEvent } from '../../data-access/telephony-realtime.service';
import { telLabel } from '../../data-access/telephony-referential';

/** Les deux emplacements que le contrat accepte. Rien ne dit lequel est rempli. */
export const TEL_CALL_SLOTS: readonly RequestClickToCallRequestSlotEnum[] = [
  RequestClickToCallRequestSlotEnum.Primary,
  RequestClickToCallRequestSlotEnum.Secondary,
];

export const TEL_CALL_SLOT_LABELS: Readonly<Record<string, string>> = {
  Primary: 'Principal',
  Secondary: 'Secondaire',
};

export function telCallSlotLabel(value: string | null | undefined): string {
  return telLabel(TEL_CALL_SLOT_LABELS, value);
}

/**
 * Où en est la demande d'appel sortant de CE bouton.
 *
 * `Expired` n'est pas `Failed` : l'appel a peut-être bien eu lieu, c'est le SUIVI qui a
 * échoué faute d'évènement temps réel. Les confondre ferait redire à l'agent qu'un appel
 * a échoué alors que son correspondant a décroché.
 */
export type ClickToCallPhase =
  | 'Idle'
  | 'Requesting'
  | 'Ringing'
  | 'Connected'
  | 'Failed'
  | 'Expired';

export interface ClickToCallState {
  readonly phase: ClickToCallPhase;
  /** Rendu par le 202. Rien, côté serveur comme côté client, ne le relie à un `callId`. */
  readonly requestId: string | null;
  /** Horloge locale du clic. Sert à écarter les évènements d'un appel antérieur. */
  readonly requestedAt: number;
  /** Identifiant de l'appel, UNIQUEMENT s'il a pu être adopté sur une sonnerie. */
  readonly callId: string | null;
  readonly slot: RequestClickToCallRequestSlotEnum | null;
}

export const IDLE_CLICK_TO_CALL: ClickToCallState = {
  phase: 'Idle',
  requestId: null,
  requestedAt: 0,
  callId: null,
  slot: null,
};

export function clickToCallRequested(
  slot: RequestClickToCallRequestSlotEnum,
  now: number,
): ClickToCallState {
  return { phase: 'Requesting', requestId: null, requestedAt: now, callId: null, slot };
}

/** 202 accepté : le serveur a demandé au fournisseur de faire sonner notre poste. */
export function clickToCallAccepted(
  state: ClickToCallState,
  requestId: string | null,
): ClickToCallState {
  // Une sonnerie peut arriver AVANT la réponse HTTP — le push est plus court que
  // l'aller-retour. On ne redescend donc jamais d'un état déjà avancé.
  if (state.phase !== 'Requesting') return { ...state, requestId };

  return { ...state, phase: 'Ringing', requestId };
}

/**
 * Suite d'un évènement temps réel.
 *
 * **Le point dur de TEL-F-04 est ici** : le 202 rend un `requestId` et AUCUN endpoint ne
 * le relie à un `callId`. Le seul lien possible est chronologique — la première sonnerie
 * reçue après notre clic est tenue pour la nôtre. C'est une heuristique, assumée, et
 * c'est le mieux que l'API permette :
 *
 * - un `answered` ou un `ended` reçu avant toute sonnerie adoptée est IGNORÉ : il
 *   appartient à un appel dont on ne sait pas s'il est le nôtre, et s'en servir
 *   afficherait « Connecté » sur l'appel d'un collègue reçu dans le même onglet ;
 * - un évènement antérieur au clic est écarté, sinon le panneau d'un appel précédent
 *   serait relu comme la réponse à notre demande.
 */
export function clickToCallEvent(
  state: ClickToCallState,
  event: TelephonyRealtimeEvent,
): ClickToCallState {
  if (state.phase !== 'Requesting' && state.phase !== 'Ringing' && state.phase !== 'Connected') {
    return state;
  }

  if (event.receivedAt < state.requestedAt) return state;

  if (!state.callId) {
    if (event.name !== 'telephony.call.ringing') return state;

    return { ...state, phase: 'Ringing', callId: event.callId };
  }

  if (event.callId !== state.callId) return state;

  if (event.name === 'telephony.call.answered') {
    return { ...state, phase: 'Connected' };
  }

  if (event.name === 'telephony.call.ended') {
    // Raccroché après le décroché : l'appel a eu lieu, le bouton redevient disponible et
    // c'est le panneau d'appel qui prend la suite avec la qualification. Raccroché AVANT
    // le décroché : personne n'a répondu, et c'est un échec à dire.
    return state.phase === 'Connected' ? IDLE_CLICK_TO_CALL : { ...state, phase: 'Failed' };
  }

  return state;
}

/**
 * Expiration de l'attente.
 *
 * Elle ne frappe que l'état où aucune sonnerie n'a été adoptée. Un appel dont on tient le
 * `callId` est suivi par le panneau : l'expirer effacerait un suivi qui fonctionne.
 */
export function clickToCallTimedOut(
  state: ClickToCallState,
  now: number,
  timeoutMs: number,
): ClickToCallState {
  if (state.phase !== 'Requesting' && state.phase !== 'Ringing') return state;
  if (state.callId) return state;
  if (now - state.requestedAt < timeoutMs) return state;

  return { ...state, phase: 'Expired' };
}
