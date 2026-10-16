import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import {
  AuthenticationService,
  ENVIRONMENT_CONFIG,
  PermissionsService,
} from '@sankore/crm/common';
import { firstValueFrom } from 'rxjs';

/**
 * Client temps réel du hub `/hubs/realtime` (TEL-F-05, TEL-F-11).
 *
 * Ce que le contrat du hub impose, et qu'il ne faut pas « améliorer » :
 *
 * 1. **Le hub n'a AUCUNE méthode appelable par le client.** Tout va du serveur vers le
 *    navigateur, délibérément : une méthode de hub est une surface RPC authentifiée sans
 *    route, sans politique de débit et sans entrée OpenAPI. On n'écrit donc jamais
 *    `invoke` ni `send` ici — un écran qui a une question à poser passe par l'API HTTP,
 *    où vivent déjà la permission, le périmètre et l'audit.
 *
 * 2. **Chaque évènement ne porte qu'un `callId`.** Pas de numéro, pas de nom, pas même la
 *    direction. Une trame websocket est livrée à qui détient la connexion, sans contrôle
 *    de permission ni de périmètre d'agence par trame : un nom qui voyagerait ici serait
 *    une donnée personnelle sortie sur la foi d'une connexion que personne ne
 *    réautorise. L'écran appelle ensuite `GET telephony/calls/{callId}/context`, qui
 *    applique les deux. **Ne pas enrichir ce payload** : c'est exactement la « bonne
 *    idée » que le back a refusée, et chaque champ ajouté devient un champ dont un front
 *    dépend.
 *
 * 3. **La livraison est au mieux (best-effort) : ni file d'attente, ni réessai, ni
 *    rejeu.** Un navigateur non connecté au moment de la sonnerie ne recevra jamais rien,
 *    et un rechargement de page perd l'évènement. Un écran ne doit donc JAMAIS se
 *    construire depuis le flux temps réel seul : le journal reste la source de vérité, le
 *    temps réel n'est qu'une accélération.
 *
 * 4. **Le serveur diffuse à TOUTES les connexions de l'utilisateur.** N open tablets =
 *    N trames pour le même appel. D'où l'élection de leader plus bas.
 *
 * Rien de ce qui arrive par le socket n'est persisté : ni `localStorage`, ni
 * `sessionStorage`, ni IndexedDB. Aucun numéro, aucune note, aucun média ne doit rester
 * dans le navigateur. Un `callId` en mémoire vive est admis — c'est tout ce qui circule.
 */

/** État de la connexion, tel que l'écran l'affiche (TEL-F-11). */
export type TelephonyRealtimeState =
  | 'Disconnected'
  | 'Connecting'
  | 'Connected'
  | 'Reconnecting';

/** Les trois évènements du hub. Dotés, stables, et un contrat avec le serveur. */
export type TelephonyRealtimeEventName =
  | 'telephony.call.ringing'
  | 'telephony.call.answered'
  | 'telephony.call.ended';

export const TELEPHONY_REALTIME_EVENTS: readonly TelephonyRealtimeEventName[] = [
  'telephony.call.ringing',
  // Ces deux-là sont en cours d'ajout côté serveur. On s'abonne dès maintenant : un
  // `connection.on` sur un évènement que personne n'émet ne coûte rien, alors qu'un
  // abonnement manquant à la livraison se traduit par un panneau qui ne se ferme jamais.
  'telephony.call.answered',
  'telephony.call.ended',
];

/** Le payload entier, côté serveur comme ici : un champ. */
export interface TelephonyRealtimeEvent {
  readonly name: TelephonyRealtimeEventName;
  readonly callId: string;
  /** Horodatage LOCAL de réception. Le serveur n'en envoie pas. */
  readonly receivedAt: number;
}

/**
 * Préfixe du canal d'élection. Le nom RÉEL est suffixé par l'identifiant de l'utilisateur
 * connecté — voir `_panelChannelName`.
 *
 * Un canal unique pour l'origine était un vrai défaut : `BroadcastChannel` porte sur
 * l'origine, pas sur la session, donc deux comptes ouverts dans le même profil de navigateur
 * se disputaient UN panneau. Le perdant ne recevait jamais son appel entrant, et rien à
 * l'écran ne l'expliquait — l'onglet semblait simplement ne pas sonner.
 */
const PANEL_CHANNEL_PREFIX = 'sankore.telephony.panel';

/**
 * Délais de l'élection. Le battement doit rester nettement plus court que le délai
 * d'expiration, sinon un leader vivant mais occupé (un onglet qui rend une grosse liste)
 * se fait déposer pour rien.
 */
const HEARTBEAT_MS = 2000;
const LEADER_TIMEOUT_MS = 7000;

type PanelMessage =
  | { kind: 'heartbeat'; tabId: string; since: number }
  | { kind: 'claim'; tabId: string; since: number }
  | { kind: 'resign'; tabId: string };

@Injectable({ providedIn: 'root' })
export class TelephonyRealtimeService {
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _environment = inject(ENVIRONMENT_CONFIG);
  private readonly _auth = inject(AuthenticationService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  // ——— État exposé aux écrans ———

  private readonly _state = signal<TelephonyRealtimeState>('Disconnected');
  /** TEL-F-11 lit ceci pour afficher « Connexion temps réel perdue ». */
  public readonly state = this._state.asReadonly();

  private readonly _lastEvent = signal<TelephonyRealtimeEvent | null>(null);
  /**
   * Dernier évènement reçu. Un signal et non un flux : le repo tient son état en
   * signaux, et un écran qui réagit à « l'appel courant » veut la dernière valeur, pas
   * l'historique. Les trois noms passent par le même signal pour qu'un écran traite la
   * séquence sonnerie → décroché → raccroché en un seul endroit.
   */
  public readonly lastEvent = this._lastEvent.asReadonly();

  private readonly _isPanelOwner = signal(false);
  /**
   * Vrai dans l'onglet — un seul — qui doit afficher le panneau d'appel (TEL-F-05). Les
   * autres se contentent d'un badge. Faux tant que rien n'est connecté, et faux pendant
   * le SSR.
   */
  public readonly isPanelOwner = this._isPanelOwner.asReadonly();

  // ——— Interne ———

  private _connection: HubConnection | null = null;
  private readonly _tabId = this._newTabId();
  private _channel: BroadcastChannel | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** Date de prise de fonction de CET onglet. Sert à départager les prétendants. */
  private _since = 0;
  /**
   * Onglets pairs entendus récemment. Une TABLE et pas un simple « leader connu » : avec
   * une comparaison deux à deux, un onglet du milieu qui entend un onglet plus récent se
   * déclarerait gagnant sans savoir qu'un onglet plus ancien existe — et deux panneaux
   * s'ouvriraient. On ne prend le panneau que si l'on bat TOUT le monde.
   */
  private readonly _peers = new Map<string, { since: number; seenAt: number }>();

  /** Gardé pour pouvoir se désabonner : un écouteur orphelin survivrait au service. */
  private _onPageHide: (() => void) | null = null;
  /** Faux hors connexion : un onglet sans socket ne doit jamais reprendre le panneau. */
  private _eligible = false;

  public constructor() {
    // Le service est détruit avec l'application : on ferme socket, canal et minuterie,
    // sinon un test ou un rechargement à chaud laisse un battement orphelin qui continue
    // de réclamer le panneau.
    this._destroyRef.onDestroy(() => this.disconnect());

    if (this._isBrowser) {
      // Fermeture automatique à la déconnexion. `logout()` remet `accessToken` à null :
      // c'est le seul signal fiable de la fin de session — `connectedUser` repasse aussi
      // par null pendant chaque `getCurrentUserInfo()`, donc l'écouter couperait le
      // socket à chaque rafraîchissement du profil. On ne RECONNECTE pas tout seul en
      // retour : c'est à l'écran de rappeler `connect()`, pour que la permission soit
      // réévaluée sur le nouvel utilisateur et non sur le précédent.
      effect(() => {
        if (!this._auth.accessToken() && this._connection) this.disconnect();
      });
    }
  }

  /**
   * Ouvre la connexion si — et seulement si — on est dans un navigateur, authentifié, et
   * détenteur de `Telephony.Call.View`.
   *
   * Idempotent : appelé depuis plusieurs écrans, il ne construit qu'une connexion.
   */
  public async connect(): Promise<void> {
    if (!this._isBrowser) return;
    if (this._connection) return;
    if (!this._permissions.has('Telephony.Call.View')) return;

    // `accessToken()` et non `loadAccessToken()` : ce dernier déclenche aussi un
    // `getCurrentUserInfo().subscribe()` et remet `connectedUser` à null le temps de
    // l'aller-retour, ce qui ferait clignoter toutes les permissions de l'application —
    // dont celle qu'on vient de tester. On se contente donc de lire le signal, amorcé
    // par la connexion ou par l'intercepteur, et on sort sans bruit s'il est vide : il
    // n'y a pas de session à écouter.
    if (!this._auth.accessToken()) return;

    this._state.set('Connecting');

    const connection = new HubConnectionBuilder()
      .withUrl(`${this._environment.apiUrl}/hubs/realtime`, {
        // Le jeton voyage en paramètre de requête `access_token` : un websocket ne peut
        // pas porter d'en-tête `Authorization`. C'est la forme que le handler JWT du
        // serveur attend, et uniquement sur la route du hub.
        accessTokenFactory: () => this._freshAccessToken(),
      })
      // Dégressif par défaut (0, 2, 10, 30 s) puis abandon. Suffisant ici : le journal
      // reste lisible sans socket, et `state` dit à l'écran de le signaler.
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this._connection = connection;

    for (const name of TELEPHONY_REALTIME_EVENTS) {
      connection.on(name, (payload: unknown) => this._onPush(name, payload));
    }

    connection.onreconnecting(() => this._state.set('Reconnecting'));
    connection.onreconnected(() => this._state.set('Connected'));
    connection.onclose(() => {
      this._state.set('Disconnected');
      // Un onglet sans socket n'a rien à afficher dans le panneau : il démissionne pour
      // qu'un onglet encore connecté reprenne, au lieu de garder un panneau muet.
      this._resignPanel();
    });

    try {
      await connection.start();
      this._state.set('Connected');
      this._startPanelElection();
    } catch {
      // Pas de snackbar : l'échec d'un confort ne doit pas interrompre l'agent. L'écran
      // lit `state` et dit « Connexion temps réel perdue » là où c'est utile.
      this._state.set('Disconnected');
      this._connection = null;
    }
  }

  /** Ferme tout. À appeler à la déconnexion. */
  public disconnect(): void {
    this._resignPanel();
    this._stopPanelElection();

    const connection = this._connection;
    this._connection = null;
    this._lastEvent.set(null);
    this._state.set('Disconnected');

    if (connection) {
      // `stop()` déclenche `onclose` : on l'a déjà neutralisé en vidant `_connection`.
      void connection.stop().catch(() => undefined);
    }
  }

  /**
   * Jeton à jour pour la poignée de main.
   *
   * SignalR contourne entièrement le `HttpClient` d'Angular : l'intercepteur qui
   * rafraîchit sur un 401 ne couvre donc PAS le socket. Sans ce rafraîchissement ici, une
   * reconnexion après une mise en veille échouerait à la poignée de main avec un jeton
   * expiré, et rien dans l'application ne viendrait la réparer.
   */
  private async _freshAccessToken(): Promise<string> {
    if (this._auth.isTokenExpired()) {
      await firstValueFrom(this._auth.refreshAccessToken()).catch(() => null);
    }
    return this._auth.accessToken() ?? '';
  }

  private _onPush(name: TelephonyRealtimeEventName, payload: unknown): void {
    const callId = (payload as { callId?: unknown } | null)?.callId;
    // Une trame mal formée est ignorée : le journal reste la source de vérité, et on ne
    // veut pas qu'un évènement douteux ouvre un panneau sur un identifiant vide.
    if (typeof callId !== 'string' || !callId) return;

    this._lastEvent.set({ name, callId, receivedAt: Date.now() });
  }

  // ——————————————————————————————————————————————————————————————————————
  // Élection de leader : exactement UN onglet affiche le panneau (TEL-F-05)
  //
  // Le serveur diffuse à toutes les connexions de l'utilisateur, donc les cinq onglets
  // d'un agent reçoivent la même sonnerie. Sans coordination, cinq panneaux s'ouvrent et
  // l'agent en ferme quatre à chaque appel.
  //
  // `BroadcastChannel` et pas `localStorage` comme canal : un évènement `storage` n'est
  // PAS reçu par l'onglet qui écrit, ce qui oblige à dupliquer la logique locale, et il
  // faudrait écrire dans le stockage — ce que ce module s'interdit par ailleurs.
  // `navigator.locks` donnerait une exclusivité garantie par le navigateur et serait
  // l'outil idéal, mais le verrou n'est pas libéré de façon observable par les autres
  // onglets sans une attente permanente par onglet, et il n'est pas disponible en
  // contexte non sécurisé : on garde donc l'élection applicative, qui n'a besoin que
  // d'un canal de diffusion.
  //
  // Le protocole, en trois règles :
  //
  // 1. Chaque onglet connecté annonce un battement, propriétaire ou non. Symétrique, et
  //    c'est ce qui permet à chacun de connaître TOUS les autres plutôt que le seul
  //    leader — voir `_peers`.
  // 2. Le plus ancien gagne ; à égalité de milliseconde, le plus petit identifiant
  //    tranche. La comparaison est la même partout sur les mêmes valeurs, donc tous les
  //    onglets concluent la même chose : ni « personne ne prend », ni « tout le monde
  //    prend ».
  // 3. Un onglet qui se taît plus de `LEADER_TIMEOUT_MS` est oublié — c'est ce qui couvre
  //    la fermeture BRUTALE, où aucune démission n'est envoyée.
  //
  // À l'ouverture, l'onglet prend le panneau de façon optimiste puis le rend dès qu'il
  // entend plus ancien que lui. L'inverse — attendre un battement avant de prendre —
  // ferait patienter l'onglet unique, le cas le plus courant, deux secondes avant de
  // pouvoir afficher quoi que ce soit. Le prix est un clignotement d'un aller-retour de
  // canal à l'ouverture d'un second onglet, et il est payé sciemment : un `claim` reçu
  // déclenche une réponse immédiate, donc la convergence ne dépend pas du battement.
  // ——————————————————————————————————————————————————————————————————————

  private _startPanelElection(): void {
    if (!this._isBrowser || this._heartbeatTimer) return;

    this._since = this._monotonicNow();
    this._eligible = true;
    this._peers.clear();

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this._channel = new BroadcastChannel(this._panelChannelName());
        this._channel.onmessage = (event: MessageEvent<PanelMessage>) =>
          this._onPanelMessage(event.data);
      } catch {
        this._channel = null;
      }
    }

    if (!this._channel) {
      // Dégradation assumée : sans canal, l'onglet se déclare propriétaire. Afficher le
      // panneau en double est désagréable, ne pas l'afficher du tout fait rater l'appel.
      this._isPanelOwner.set(true);
      return;
    }

    this._post({ kind: 'claim', tabId: this._tabId, since: this._since });
    this._reconcile();
    this._heartbeatTimer = setInterval(() => this._tick(), HEARTBEAT_MS);

    // Céder le panneau à la fermeture, pour que la reprise soit immédiate au lieu d'attendre
    // l'expiration de sept secondes. `pagehide` et pas `beforeunload` : c'est celui qui part
    // aussi quand l'onglet est mis en cache de navigation, et le seul des deux qui se
    // déclenche sur mobile. Il reste un filet, pas une garantie — un onglet tué de force ne
    // prévient personne, et c'est précisément ce que l'expiration couvre.
    this._onPageHide = () => this._post({ kind: 'resign', tabId: this._tabId });
    globalThis.addEventListener?.('pagehide', this._onPageHide);
  }

  private _stopPanelElection(): void {
    this._eligible = false;

    if (this._onPageHide) {
      globalThis.removeEventListener?.('pagehide', this._onPageHide);
      this._onPageHide = null;
    }

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this._channel) {
      this._channel.onmessage = null;
      try {
        this._channel.close();
      } catch {
        /* un canal déjà fermé n'est pas une erreur à remonter */
      }
      this._channel = null;
    }
    this._peers.clear();
  }

  private _tick(): void {
    this._post({ kind: 'heartbeat', tabId: this._tabId, since: this._since });
    this._reconcile();
  }

  private _onPanelMessage(message: PanelMessage | null | undefined): void {
    if (!message || message.tabId === this._tabId) return;

    if (message.kind === 'resign') {
      // Une démission est propre : on oublie le pair sans attendre son expiration.
      this._peers.delete(message.tabId);
      this._reconcile();
      return;
    }

    this._peers.set(message.tabId, { since: message.since, seenAt: Date.now() });

    // Un nouvel arrivant ne connaît personne : on se signale tout de suite, sinon il
    // garderait le panneau jusqu'au prochain battement.
    if (message.kind === 'claim') {
      this._post({ kind: 'heartbeat', tabId: this._tabId, since: this._since });
    }

    this._reconcile();
  }

  /**
   * Recalcule la propriété du panneau à partir de tout ce qu'on sait : on la détient si
   * l'on bat chacun des pairs encore vivants. Les pairs silencieux depuis plus de
   * `LEADER_TIMEOUT_MS` sont oubliés ici — c'est le seul endroit où l'expiration joue.
   */
  private _reconcile(): void {
    const now = Date.now();

    for (const [tabId, peer] of this._peers) {
      if (now - peer.seenAt > LEADER_TIMEOUT_MS) this._peers.delete(tabId);
    }

    if (!this._eligible) {
      if (this._isPanelOwner()) this._isPanelOwner.set(false);
      return;
    }

    let owner = true;
    for (const [tabId, peer] of this._peers) {
      if (!this._wins({ tabId, since: peer.since })) {
        owner = false;
        break;
      }
    }

    if (this._isPanelOwner() !== owner) this._isPanelOwner.set(owner);
  }

  /** Le plus ancien gagne ; à égalité, le plus petit identifiant. */
  /**
   * Le nom du canal pour l'utilisateur courant.
   *
   * Cloisonné par utilisateur, et pas seulement par origine : sans ça, deux comptes dans le
   * même profil de navigateur se disputent un seul panneau.
   *
   * Le repli sur `anonymous` est purement défensif et n'est atteint par aucun chemin réel :
   * `connect()` sort si la permission `Telephony.Call.View` n'est pas détenue, et
   * `PermissionsService` la lit sur `connectedUser()`. Un profil non chargé signifie donc
   * aucune permission, donc aucune connexion, donc aucun canal. Il est conservé pour qu'un
   * appel direct depuis un test ou un futur chemin ne produise pas `undefined` dans un nom
   * de canal.
   */
  private _panelChannelName(): string {
    const userId = this._auth.connectedUser()?.id ?? 'anonymous';

    return `${PANEL_CHANNEL_PREFIX}.${userId}`;
  }

  /**
   * Une horloge qui ne recule pas, pour l'ancienneté d'un onglet.
   *
   * `Date.now()` n'est pas monotone : un ajustement NTP ou un utilisateur qui change l'heure
   * de sa machine réordonne les `since` entre onglets, et deux onglets peuvent alors chacun
   * se croire l'aîné. `timeOrigin + now()` est monotone au sein d'un onglet et comparable
   * entre onglets de la même origine, parce que `timeOrigin` est un instant absolu. Le repli
   * sur `Date.now()` ne concerne que les environnements sans `performance`.
   */
  private _monotonicNow(): number {
    return typeof performance !== 'undefined' && typeof performance.timeOrigin === 'number'
      ? performance.timeOrigin + performance.now()
      : Date.now();
  }

  private _wins(other: { tabId: string; since: number }): boolean {
    if (this._since !== other.since) return this._since < other.since;
    return this._tabId < other.tabId;
  }

  private _resignPanel(): void {
    this._eligible = false;
    if (this._isPanelOwner()) {
      this._isPanelOwner.set(false);
      this._post({ kind: 'resign', tabId: this._tabId });
    }
  }

  private _post(message: PanelMessage): void {
    try {
      this._channel?.postMessage(message);
    } catch {
      /* canal fermé entre-temps : l'expiration côté pairs fait le travail */
    }
  }

  private _newTabId(): string {
    // `crypto.randomUUID` n'existe pas en contexte non sécurisé ni côté serveur : repli
    // sur un identifiant quelconque, il ne sert qu'à départager localement.
    const uuid = globalThis.crypto?.randomUUID?.();
    return uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /** Exposé pour que l'écran puisse corréler ses journaux ; sans valeur métier. */
  public get tabId(): string {
    return this._tabId;
  }

  /** `HubConnectionState` brut, pour un diagnostic. Les écrans lisent `state`. */
  public get rawConnectionState(): HubConnectionState {
    return this._connection?.state ?? HubConnectionState.Disconnected;
  }
}
