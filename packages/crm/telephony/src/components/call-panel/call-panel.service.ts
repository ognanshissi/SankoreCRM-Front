import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { TelephonyRealtimeService } from '../../data-access/telephony-realtime.service';

/**
 * Où en est l'appel que le panneau suit.
 *
 * Les quatre statuts terminaux du serveur partagent un seul évènement `ended` : le
 * panneau ne les distingue pas ici, il relit le contexte pour savoir lequel c'est — et
 * c'est le statut ainsi relu qui oriente la qualification.
 */
export type CallPanelPhase = 'Ringing' | 'InProgress' | 'Ended';

export interface ActiveCall {
  readonly callId: string;
  readonly phase: CallPanelPhase;
  /** Horloges LOCALES de réception des pushs. Le serveur n'envoie aucun horodatage. */
  readonly openedAt: number;
  readonly answeredAt: number | null;
  readonly endedAt: number | null;
}

/** Au-delà, le plus ancien identifiant fermé est oublié. Rien n'a besoin d'être durable. */
const CLOSED_MEMORY = 20;

/**
 * L'appel que le panneau d'appel affiche (TEL-F-05).
 *
 * Même forme que `AccessDeniedService` : un état en signal dans un service racine, lu par
 * un composant monté une seule fois dans la coquille de l'application. C'est la façon
 * dont cette application fait son habillage global, et un panneau par écran rouvrirait le
 * même appel autant de fois qu'il y a d'écrans montés.
 *
 * Ce service est le SEUL endroit qui traduit les trois évènements du hub en état d'écran.
 * Deux décisions y sont volontaires :
 *
 * 1. **Un `answered` ou un `ended` sur un appel inconnu OUVRE le panneau.** La livraison
 *    est au mieux — ni file, ni réessai, ni rejeu : la sonnerie peut n'être jamais
 *    arrivée (onglet ouvert entre-temps, push perdu). Attendre une sonnerie qu'on n'aura
 *    pas priverait l'agent de la qualification juste après la conversation, qui est le
 *    moment où il se souvient de ce qui s'est dit.
 * 2. **Un appel fermé à la main ne se rouvre pas.** Les pushs ne partent que sur un
 *    CHANGEMENT de statut, mais un évènement redélivré rouvrirait un panneau que l'agent
 *    vient d'écarter. Les derniers identifiants fermés sont donc retenus — en mémoire, et
 *    jamais ailleurs.
 */
@Injectable({ providedIn: 'root' })
export class CallPanelService {
  private readonly _realtime = inject(TelephonyRealtimeService);

  private readonly _call = signal<ActiveCall | null>(null);
  public readonly call = this._call.asReadonly();

  public readonly callId = computed(() => this._call()?.callId ?? null);

  /** Identifiants écartés par l'agent, en mémoire vive uniquement. */
  private readonly _closed: string[] = [];

  public constructor() {
    effect(() => {
      const event = this._realtime.lastEvent();

      if (!event) return;

      this._apply(event.name, event.callId, event.receivedAt);
    });
  }

  /** Fermeture par l'agent, ou après une qualification enregistrée. */
  public close(): void {
    const current = this._call();

    if (current) this._remember(current.callId);

    this._call.set(null);
  }

  private _apply(
    name: 'telephony.call.ringing' | 'telephony.call.answered' | 'telephony.call.ended',
    callId: string,
    at: number,
  ): void {
    if (this._closed.includes(callId)) return;

    const current = this._call();
    const same = current?.callId === callId ? current : null;

    if (name === 'telephony.call.ringing') {
      // Un nouvel appel remplace l'affichage : l'agent n'a qu'un poste, donc deux
      // sonneries simultanées ne sont pas deux conversations à mener de front.
      if (!same) {
        this._call.set({
          callId,
          phase: 'Ringing',
          openedAt: at,
          answeredAt: null,
          endedAt: null,
        });
      }

      return;
    }

    if (name === 'telephony.call.answered') {
      this._call.set({
        callId,
        phase: 'InProgress',
        openedAt: same?.openedAt ?? at,
        answeredAt: at,
        endedAt: null,
      });

      return;
    }

    this._call.set({
      callId,
      phase: 'Ended',
      openedAt: same?.openedAt ?? at,
      answeredAt: same?.answeredAt ?? null,
      endedAt: at,
    });
  }

  private _remember(callId: string): void {
    this._closed.push(callId);

    if (this._closed.length > CLOSED_MEMORY) this._closed.shift();
  }
}
