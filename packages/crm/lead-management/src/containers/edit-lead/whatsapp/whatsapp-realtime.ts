import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';
import { AuthenticationService, ENVIRONMENT_CONFIG } from '@sankore/crm/common';
import { firstValueFrom } from 'rxjs';

/** Ce que pousse le serveur : des identifiants, jamais le texte d'un message. */
export interface WhatsAppPush {
  leadId?: string | null;
  conversationId?: string;
  messageId?: string;
}

/** Les événements du hub pour WhatsApp — un contrat avec le serveur (`WhatsAppRealtime`). */
const EVENTS = ['whatsapp.message.received', 'whatsapp.message.status', 'whatsapp.conversation.updated'] as const;

/**
 * Le temps réel du fil WhatsApp (WA-FE-13), le temps que l'onglet est ouvert.
 *
 * Une connexion propre à l'onglet plutôt qu'un branchement sur le service de la téléphonie : celui-ci
 * n'écoute que ses événements, ne se connecte qu'avec `Telephony.Call.View` et élit un onglet
 * propriétaire du panneau d'appel — trois choix justes pour la téléphonie et faux ici, où chaque
 * onglet qui affiche un fil doit le voir bouger. Le hub n'a aucune méthode appelable : on ne fait
 * qu'écouter, et le poussé n'est qu'un signal pour relire le fil sous ses propres droits.
 *
 * Reconnexion automatique ; à la reconnexion, l'écran relit le fil, ce qui rattrape ce qui a été
 * manqué. Le fil a aussi un relevé périodique de secours : un poussé perdu coûte un délai, jamais un
 * message.
 */
@Injectable()
export class WhatsAppRealtime {
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _environment = inject(ENVIRONMENT_CONFIG);
  private readonly _auth = inject(AuthenticationService);

  private _connection: HubConnection | null = null;

  /** Connecté, ou non — l'écran signale un fil qui ne se met plus à jour seul. */
  public readonly connected = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  public async connect(onPush: (push: WhatsAppPush) => void, onReconnected: () => void): Promise<void> {
    if (!isPlatformBrowser(this._platformId) || this._connection || !this._auth.accessToken()) return;

    const connection = new HubConnectionBuilder()
      .withUrl(`${this._environment.apiUrl}/hubs/realtime`, {
        // Un websocket ne porte pas d'en-tête Authorization : le jeton passe en paramètre
        // `access_token`, la forme que le serveur accepte sur la seule route du hub.
        accessTokenFactory: () => this._freshAccessToken(),
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this._connection = connection;

    for (const name of EVENTS) {
      connection.on(name, (payload: unknown) => onPush((payload ?? {}) as WhatsAppPush));
    }

    connection.onreconnecting(() => this.connected.set(false));
    connection.onreconnected(() => {
      this.connected.set(true);
      onReconnected();
    });
    connection.onclose(() => this.connected.set(false));

    try {
      await connection.start();
      this.connected.set(connection.state === HubConnectionState.Connected);
    } catch {
      // Hub injoignable : le relevé périodique prend le relais, l'écran le dit.
      this.connected.set(false);
    }
  }

  public disconnect(): void {
    const connection = this._connection;
    this._connection = null;
    this.connected.set(false);
    connection?.stop().catch(() => undefined);
  }

  private async _freshAccessToken(): Promise<string> {
    if (this._auth.isTokenExpired()) {
      await firstValueFrom(this._auth.refreshAccessToken()).catch(() => null);
    }
    return this._auth.accessToken() ?? '';
  }
}
