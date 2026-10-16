import { describe, expect, it } from 'vitest';
import { TelephonyRealtimeEvent } from '../../data-access/telephony-realtime.service';
import {
  IDLE_CLICK_TO_CALL,
  clickToCallAccepted,
  clickToCallEvent,
  clickToCallRequested,
  clickToCallTimedOut,
} from './click-to-call';
import { RequestClickToCallRequestSlotEnum } from '@sankore/crm-api';

/**
 * Le suivi d'un appel sortant est la partie la plus fragile de TEL-F-04, parce que l'API
 * ne la rend pas possible proprement : le 202 renvoie un `requestId` et AUCUN endpoint ne
 * le relie à un `callId`. La corrélation est donc chronologique, et c'est précisément le
 * genre de règle qui se casse en silence à la première « simplification ».
 */
function event(
  name: TelephonyRealtimeEvent['name'],
  callId: string,
  receivedAt: number,
): TelephonyRealtimeEvent {
  return { name, callId, receivedAt };
}

const SLOT = RequestClickToCallRequestSlotEnum.Primary;

describe('click-to-call', () => {
  it('passe en attente de sonnerie dès que le serveur a accepté', () => {
    const requested = clickToCallRequested(SLOT, 1_000);

    expect(requested.phase).toBe('Requesting');

    const accepted = clickToCallAccepted(requested, 'req-1');

    expect(accepted.phase).toBe('Ringing');
    expect(accepted.requestId).toBe('req-1');
    expect(accepted.callId).toBeNull();
  });

  it('adopte la première sonnerie reçue après le clic', () => {
    const state = clickToCallAccepted(clickToCallRequested(SLOT, 1_000), 'req-1');
    const adopted = clickToCallEvent(state, event('telephony.call.ringing', 'call-1', 1_200));

    expect(adopted.callId).toBe('call-1');
    expect(adopted.phase).toBe('Ringing');
  });

  it('adopte une sonnerie arrivée AVANT la réponse HTTP', () => {
    // Le push est plus court que l'aller-retour : l'ordre inverse est le cas courant, pas
    // une anomalie. Sans ce cas, le suivi expirait sur les réseaux rapides.
    const requested = clickToCallRequested(SLOT, 1_000);
    const ringing = clickToCallEvent(requested, event('telephony.call.ringing', 'call-1', 1_050));

    expect(ringing.callId).toBe('call-1');

    const accepted = clickToCallAccepted(ringing, 'req-1');

    expect(accepted.phase).toBe('Ringing');
    expect(accepted.callId).toBe('call-1');
  });

  it('écarte un évènement antérieur au clic', () => {
    const state = clickToCallAccepted(clickToCallRequested(SLOT, 2_000), 'req-1');
    const next = clickToCallEvent(state, event('telephony.call.ringing', 'vieux', 1_500));

    expect(next.callId).toBeNull();
  });

  it("ignore un décroché tant qu'aucune sonnerie n'a été adoptée", () => {
    // Celui-là appartient peut-être à l'appel d'un collègue reçu dans le même onglet :
    // l'adopter afficherait « Connecté » sur une conversation qui n'est pas la nôtre.
    const state = clickToCallAccepted(clickToCallRequested(SLOT, 1_000), 'req-1');
    const next = clickToCallEvent(state, event('telephony.call.answered', 'call-9', 1_200));

    expect(next.phase).toBe('Ringing');
    expect(next.callId).toBeNull();
  });

  it('passe à Connecté au décroché de NOTRE appel', () => {
    let state = clickToCallAccepted(clickToCallRequested(SLOT, 1_000), 'req-1');
    state = clickToCallEvent(state, event('telephony.call.ringing', 'call-1', 1_100));
    state = clickToCallEvent(state, event('telephony.call.answered', 'call-1', 1_300));

    expect(state.phase).toBe('Connected');
  });

  it('ignore les évènements d’un autre appel une fois le nôtre adopté', () => {
    let state = clickToCallAccepted(clickToCallRequested(SLOT, 1_000), 'req-1');
    state = clickToCallEvent(state, event('telephony.call.ringing', 'call-1', 1_100));
    state = clickToCallEvent(state, event('telephony.call.ended', 'call-2', 1_200));

    expect(state.phase).toBe('Ringing');
  });

  it('distingue un raccroché après décroché d’un raccroché avant', () => {
    let connected = clickToCallAccepted(clickToCallRequested(SLOT, 1_000), 'req-1');
    connected = clickToCallEvent(connected, event('telephony.call.ringing', 'call-1', 1_100));
    connected = clickToCallEvent(connected, event('telephony.call.answered', 'call-1', 1_200));
    connected = clickToCallEvent(connected, event('telephony.call.ended', 'call-1', 1_500));

    // La conversation a eu lieu : le bouton redevient disponible, le panneau prend la suite.
    expect(connected).toEqual(IDLE_CLICK_TO_CALL);

    let unanswered = clickToCallAccepted(clickToCallRequested(SLOT, 1_000), 'req-1');
    unanswered = clickToCallEvent(unanswered, event('telephony.call.ringing', 'call-1', 1_100));
    unanswered = clickToCallEvent(unanswered, event('telephony.call.ended', 'call-1', 1_400));

    expect(unanswered.phase).toBe('Failed');
  });

  it('expire une attente sans sonnerie, et seulement celle-là', () => {
    const waiting = clickToCallAccepted(clickToCallRequested(SLOT, 0), 'req-1');

    expect(clickToCallTimedOut(waiting, 10_000, 25_000).phase).toBe('Ringing');
    expect(clickToCallTimedOut(waiting, 30_000, 25_000).phase).toBe('Expired');

    // Un appel dont on tient le `callId` est suivi par le panneau : l'expirer effacerait
    // un suivi qui fonctionne.
    const followed = clickToCallEvent(waiting, event('telephony.call.ringing', 'call-1', 100));

    expect(clickToCallTimedOut(followed, 30_000, 25_000).phase).toBe('Ringing');
  });

  it('ne réagit plus une fois l’attente expirée', () => {
    const expired = clickToCallTimedOut(
      clickToCallAccepted(clickToCallRequested(SLOT, 0), 'req-1'),
      30_000,
      25_000,
    );

    expect(
      clickToCallEvent(expired, event('telephony.call.ringing', 'call-1', 31_000)).phase,
    ).toBe('Expired');
  });
});
