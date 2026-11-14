import { DestroyRef, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { filter, Observable, Subject } from 'rxjs';
import { TenantContextResponse } from '@sankore/crm-api';

/**
 * Messages échangés entre les onglets ouverts sur la même institution.
 *
 * - `tenant-context-changed` : l'administrateur a enregistré Paramétrage › Entreprise. Le contexte
 *   complet voyage, pas un signal « recharge-toi » : l'onglet qui reçoit n'a pas à refaire un appel
 *   et ne peut pas tomber sur une réponse d'avant l'enregistrement.
 * - `logout` : un onglet s'est déconnecté. Les autres partagent le même `localStorage`, donc
 *   n'ont déjà plus de jeton ; sans ce message ils restaient affichés jusqu'au premier 401.
 */
export type CrossTabMessage =
  | { type: 'tenant-context-changed'; context: TenantContextResponse }
  | { type: 'logout' };

/** Une origine = une institution (`*.talisoftcrm.com`) : un nom fixe suffit. */
const CHANNEL_NAME = 'sankore.session';

/**
 * Canal de diffusion entre onglets.
 *
 * `BroadcastChannel` plutôt que l'évènement `storage` : il ne demande pas d'écrire dans le stockage
 * pour transporter un message, et il ne revient pas à l'onglet émetteur — ce qui est voulu ici,
 * l'émetteur ayant déjà appliqué le changement chez lui. Les services métier (`TenantProvider`,
 * `AuthenticationService`) s'abonnent ; ce service ne connaît ni l'un ni l'autre, ce qui évite une
 * dépendance circulaire avec l'authentification.
 */
@Injectable({ providedIn: 'root' })
export class CrossTabChannel {
  private readonly _messages = new Subject<CrossTabMessage>();
  private readonly _channel: BroadcastChannel | null = null;

  public constructor() {
    // Ni rendu serveur ni vieux navigateur : sans canal, chaque onglet vit sa vie comme avant.
    if (!isPlatformBrowser(inject(PLATFORM_ID)) || typeof BroadcastChannel === 'undefined') return;
    try {
      this._channel = new BroadcastChannel(CHANNEL_NAME);
      this._channel.onmessage = (event: MessageEvent<CrossTabMessage>) => {
        if (event.data && typeof event.data.type === 'string') this._messages.next(event.data);
      };
    } catch {
      this._channel = null;
    }
    inject(DestroyRef).onDestroy(() => {
      this._channel?.close();
      this._messages.complete();
    });
  }

  /** Prévient les AUTRES onglets. L'onglet courant applique le changement lui-même. */
  public post(message: CrossTabMessage): void {
    try {
      this._channel?.postMessage(message);
    } catch {
      // Canal fermé ou message non clonable : les autres onglets se resynchroniseront au rechargement.
    }
  }

  public on<T extends CrossTabMessage['type']>(type: T): Observable<Extract<CrossTabMessage, { type: T }>> {
    return this._messages.pipe(
      filter((m): m is Extract<CrossTabMessage, { type: T }> => m.type === type),
    );
  }
}
