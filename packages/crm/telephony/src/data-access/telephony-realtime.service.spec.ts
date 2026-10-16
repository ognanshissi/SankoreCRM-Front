import {
  createEnvironmentInjector,
  EnvironmentInjector,
  PLATFORM_ID,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  AuthenticationService,
  ENVIRONMENT_CONFIG,
  PermissionsService,
} from '@sankore/crm/common';
import { of } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Ce qui est testé ici, et pourquoi seulement cela :
 *
 * - **L'élection de leader** (TEL-F-05 : un seul onglet affiche le panneau). Elle n'a aucun
 *   précédent dans ce repo et c'est la pièce la plus subtile de la livraison : un bug y
 *   produit soit cinq panneaux par appel, soit aucun.
 * - **Les transitions d'état de connexion**, que TEL-F-11 affiche.
 * - **L'inertie hors navigateur** : l'application est en SSR (`provideClientHydration`), et
 *   `AuthenticationService.loadAccessToken()` touche `localStorage` sans garde — une
 *   connexion pendant le rendu serveur planterait la page.
 *
 * SignalR lui-même n'est PAS testé : `HubConnectionBuilder` est remplacé par un double,
 * parce que tester la bibliothèque reviendrait à tester le réseau.
 */

// ——— Double de @microsoft/signalr ———

interface FakeConnection {
  state: string;
  handlers: Map<string, (payload: unknown) => void>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  on: (name: string, handler: (payload: unknown) => void) => void;
  onreconnecting: (cb: () => void) => void;
  onreconnected: (cb: () => void) => void;
  onclose: (cb: () => void) => void;
  fire: (name: string, payload: unknown) => void;
  triggerReconnecting: () => void;
  triggerReconnected: () => void;
  triggerClose: () => void;
  accessTokenFactory?: () => string | Promise<string>;
  url?: string;
}

const connections: FakeConnection[] = [];
let startShouldFail = false;

function newFakeConnection(): FakeConnection {
  const callbacks: Record<string, (() => void)[]> = {
    reconnecting: [],
    reconnected: [],
    close: [],
  };
  const conn: FakeConnection = {
    state: 'Disconnected',
    handlers: new Map(),
    start: vi.fn(async () => {
      if (startShouldFail) throw new Error('handshake refusée');
      conn.state = 'Connected';
    }),
    stop: vi.fn(async () => {
      conn.state = 'Disconnected';
    }),
    on: (name, handler) => void conn.handlers.set(name, handler),
    onreconnecting: (cb) => void callbacks['reconnecting'].push(cb),
    onreconnected: (cb) => void callbacks['reconnected'].push(cb),
    onclose: (cb) => void callbacks['close'].push(cb),
    fire: (name, payload) => conn.handlers.get(name)?.(payload),
    triggerReconnecting: () => callbacks['reconnecting'].forEach((cb) => cb()),
    triggerReconnected: () => callbacks['reconnected'].forEach((cb) => cb()),
    triggerClose: () => callbacks['close'].forEach((cb) => cb()),
  };
  return conn;
}

vi.mock('@microsoft/signalr', () => {
  class HubConnectionBuilder {
    private readonly _conn = newFakeConnection();

    public withUrl(
      url: string,
      options?: { accessTokenFactory?: () => string | Promise<string> },
    ): this {
      this._conn.url = url;
      this._conn.accessTokenFactory = options?.accessTokenFactory;
      return this;
    }
    public withAutomaticReconnect(): this {
      return this;
    }
    public configureLogging(): this {
      return this;
    }
    public build(): FakeConnection {
      connections.push(this._conn);
      return this._conn;
    }
  }

  return {
    HubConnectionBuilder,
    HubConnectionState: {
      Disconnected: 'Disconnected',
      Connecting: 'Connecting',
      Connected: 'Connected',
      Reconnecting: 'Reconnecting',
    },
    LogLevel: { Warning: 3 },
  };
});

// L'import vient APRÈS `vi.mock`, qui est remonté en tête de fichier par Vitest.
import { TelephonyRealtimeService } from './telephony-realtime.service';

// ——— Doubles d'injection ———

class FakeAuth {
  public readonly accessTokenSignal = signal<string | null>('un-jeton');
  public accessToken = this.accessTokenSignal.asReadonly();
  public expired = false;
  public refreshCount = 0;

  /**
   * L'identifiant sert à CLOISONNER le canal d'élection par utilisateur. Deux onglets du
   * même compte doivent se voir ; deux comptes différents dans le même profil de navigateur
   * ne doivent pas se disputer un panneau.
   */
  public readonly connectedUserSignal = signal<{ id: string } | null>({ id: 'agent-1' });
  public connectedUser = this.connectedUserSignal.asReadonly();

  public isTokenExpired(): boolean {
    return this.expired;
  }
  public refreshAccessToken() {
    this.refreshCount += 1;
    this.accessTokenSignal.set('un-jeton-neuf');
    return of(null);
  }
  public loadAccessToken(): string | null {
    throw new Error(
      "loadAccessToken ne doit pas être appelé : il touche localStorage sans garde et " +
        'relance getCurrentUserInfo, ce qui ferait clignoter les permissions.',
    );
  }
}

class FakePermissions {
  public granted = new Set<string>(['Telephony.Call.View']);
  public has(...codes: string[]): boolean {
    return codes.some((c) => this.granted.has(c));
  }
}

/**
 * Un injecteur d'environnement ENFANT par « onglet ».
 *
 * Enfant du `TestBed` et pas un `Injector.create` nu : le service déclare un `effect()`
 * pour couper le socket à la déconnexion, et un effet exige le `ChangeDetectionScheduler`
 * qu'un injecteur nu ne fournit pas. Enfant et pas le TestBed lui-même : réinitialiser le
 * TestBed détruirait l'injecteur des onglets déjà créés — exactement ce qu'un test
 * multi-onglets ne doit pas faire. Ici chaque onglet se détruit quand le test le dit.
 */
function configure(
  platform: 'browser' | 'server' = 'browser',
  userId = 'agent-1',
): {
  auth: FakeAuth;
  permissions: FakePermissions;
  injector: EnvironmentInjector;
} {
  const auth = new FakeAuth();
  auth.connectedUserSignal.set({ id: userId });
  const permissions = new FakePermissions();

  const injector = createEnvironmentInjector(
    [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: ENVIRONMENT_CONFIG, useValue: { apiUrl: 'http://api.test' } },
      { provide: AuthenticationService, useValue: auth },
      { provide: PermissionsService, useValue: permissions },
    ],
    TestBed.inject(EnvironmentInjector),
  );
  openInjectors.push(injector);

  return { auth, permissions, injector };
}

/**
 * Une instance par « onglet ». Les instances partagent le `BroadcastChannel` de jsdom —
 * exactement la situation de plusieurs onglets d'un même navigateur.
 */
function newTab(injector: EnvironmentInjector): TelephonyRealtimeService {
  const service = runInInjectionContext(
    injector,
    () => new TelephonyRealtimeService(),
  );
  openTabs.push(service);
  return service;
}

/** Laisse les messages du canal, les effets et les promesses en attente se résoudre. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

const openInjectors: EnvironmentInjector[] = [];
const openTabs: TelephonyRealtimeService[] = [];

beforeEach(() => {
  connections.length = 0;
  startShouldFail = false;
  openTabs.length = 0;
  openInjectors.length = 0;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
});

afterEach(() => {
  // Sans cela, un onglet laissé ouvert continue de battre sur le canal partagé et fait
  // échouer le test suivant pour une raison invisible.
  for (const service of openTabs) service.disconnect();
  for (const injector of openInjectors) injector.destroy();
  openTabs.length = 0;
  openInjectors.length = 0;
  vi.useRealTimers();
});

describe('TelephonyRealtimeService — inertie hors navigateur (SSR)', () => {
  it('ne construit aucune connexion et n’expose rien côté serveur', async () => {
    const { injector } = configure('server');
    const service = newTab(injector);

    await service.connect();

    expect(connections).toHaveLength(0);
    expect(service.state()).toBe('Disconnected');
    expect(service.isPanelOwner()).toBe(false);
    expect(service.lastEvent()).toBeNull();
  });
});

describe('TelephonyRealtimeService — conditions de connexion', () => {
  it('ne se connecte pas sans la permission de lecture des appels', async () => {
    const { permissions, injector } = configure();
    permissions.granted = new Set();
    const service = newTab(injector);

    await service.connect();

    expect(connections).toHaveLength(0);
    expect(service.state()).toBe('Disconnected');
  });

  it('ne se connecte pas sans jeton, et n’appelle jamais loadAccessToken', async () => {
    const { auth, injector } = configure();
    auth.accessTokenSignal.set(null);
    const service = newTab(injector);

    await expect(service.connect()).resolves.toBeUndefined();
    expect(connections).toHaveLength(0);
  });

  it('est idempotent : deux appels ne construisent qu’une connexion', async () => {
    const { injector } = configure();
    const service = newTab(injector);

    await service.connect();
    await service.connect();

    expect(connections).toHaveLength(1);
  });

  it('compose l’URL du hub à partir de l’apiUrl injectée', async () => {
    const { injector } = configure();
    await newTab(injector).connect();

    expect(connections[0].url).toBe('http://api.test/hubs/realtime');
  });

  it('rafraîchit le jeton expiré dans accessTokenFactory, que l’intercepteur HTTP ne couvre pas', async () => {
    const { auth, injector } = configure();
    const service = newTab(injector);
    await service.connect();

    auth.expired = true;
    const token = await connections[0].accessTokenFactory?.();

    expect(auth.refreshCount).toBe(1);
    expect(token).toBe('un-jeton-neuf');
  });

  it('n’abonne aucune méthode appelable côté client, seulement les trois évènements', async () => {
    const { injector } = configure();
    await newTab(injector).connect();

    expect([...connections[0].handlers.keys()].sort()).toEqual([
      'telephony.call.answered',
      'telephony.call.ended',
      'telephony.call.ringing',
    ]);
  });
});

describe('TelephonyRealtimeService — transitions d’état', () => {
  it('passe Disconnected → Connected au démarrage', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    expect(service.state()).toBe('Disconnected');

    await service.connect();

    expect(service.state()).toBe('Connected');
  });

  it('passe Reconnecting puis Connected sur une coupure réparée', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    await service.connect();

    connections[0].triggerReconnecting();
    expect(service.state()).toBe('Reconnecting');

    connections[0].triggerReconnected();
    expect(service.state()).toBe('Connected');
  });

  it('retombe Disconnected à la fermeture, et rend le panneau', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    await service.connect();
    await settle();
    expect(service.isPanelOwner()).toBe(true);

    connections[0].triggerClose();

    expect(service.state()).toBe('Disconnected');
    expect(service.isPanelOwner()).toBe(false);
  });

  it('reste Disconnected quand la poignée de main échoue, sans lever', async () => {
    const { injector } = configure();
    startShouldFail = true;
    const service = newTab(injector);

    await expect(service.connect()).resolves.toBeUndefined();

    expect(service.state()).toBe('Disconnected');
    expect(service.isPanelOwner()).toBe(false);
  });

  it('coupe le socket tout seul à la déconnexion, quand le jeton disparaît', async () => {
    const { auth, injector } = configure();
    const service = newTab(injector);
    await service.connect();
    await settle();
    expect(service.state()).toBe('Connected');

    // Ce que fait `AuthenticationService.logout()`.
    auth.accessTokenSignal.set(null);
    await settle();

    expect(service.state()).toBe('Disconnected');
    expect(service.isPanelOwner()).toBe(false);
    expect(connections[0].stop).toHaveBeenCalled();
  });

  it('revient Disconnected et oublie l’évènement courant après disconnect()', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    await service.connect();
    connections[0].fire('telephony.call.ringing', { callId: 'c-1' });
    expect(service.lastEvent()?.callId).toBe('c-1');

    service.disconnect();

    expect(service.state()).toBe('Disconnected');
    expect(service.lastEvent()).toBeNull();
    expect(connections[0].stop).toHaveBeenCalled();
  });
});

describe('TelephonyRealtimeService — évènements reçus', () => {
  it('expose le callId des trois évènements', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    await service.connect();

    connections[0].fire('telephony.call.ringing', { callId: 'c-1' });
    expect(service.lastEvent()).toMatchObject({
      name: 'telephony.call.ringing',
      callId: 'c-1',
    });

    connections[0].fire('telephony.call.answered', { callId: 'c-1' });
    expect(service.lastEvent()?.name).toBe('telephony.call.answered');

    connections[0].fire('telephony.call.ended', { callId: 'c-1' });
    expect(service.lastEvent()?.name).toBe('telephony.call.ended');
  });

  it('ignore une trame sans callId utilisable plutôt que d’ouvrir un panneau vide', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    await service.connect();

    connections[0].fire('telephony.call.ringing', {});
    connections[0].fire('telephony.call.ringing', null);
    connections[0].fire('telephony.call.ringing', { callId: '' });
    connections[0].fire('telephony.call.ringing', { callId: 42 });

    expect(service.lastEvent()).toBeNull();
  });

  it('ne persiste rien de l’évènement dans le stockage du navigateur', async () => {
    const { injector } = configure();
    const service = newTab(injector);
    await service.connect();
    localStorage.clear();
    sessionStorage.clear();

    connections[0].fire('telephony.call.ringing', { callId: 'c-secret' });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('TelephonyRealtimeService — élection du panneau (TEL-F-05)', () => {
  it('désigne exactement un propriétaire parmi plusieurs onglets', async () => {
    const tabs: TelephonyRealtimeService[] = [];
    for (let i = 0; i < 4; i += 1) {
        const { injector } = configure();
      const tab = newTab(injector);
      await tab.connect();
      tabs.push(tab);
      // Un petit décalage pour que les dates de prise de fonction diffèrent, comme des
      // onglets ouverts l'un après l'autre.
      await settle();
    }

    await settle();

    const owners = tabs.filter((t) => t.isPanelOwner());
    expect(owners).toHaveLength(1);
    // Le premier ouvert gagne : c'est celui dont la prise de fonction est la plus ancienne.
    expect(tabs[0].isPanelOwner()).toBe(true);
  });

  it('passe la main quand le propriétaire démissionne proprement', async () => {
    const first = newTab(configure().injector);
    await first.connect();
    await settle();

    const second = newTab(configure().injector);
    await second.connect();
    await settle();

    expect(first.isPanelOwner()).toBe(true);
    expect(second.isPanelOwner()).toBe(false);

    // L'onglet propriétaire se ferme.
    first.disconnect();
    await settle();

    expect(first.isPanelOwner()).toBe(false);
    expect(second.isPanelOwner()).toBe(true);
  });

  it('reprend le panneau quand le propriétaire disparaît sans démissionner', async () => {
    vi.useFakeTimers();
    try {
        const first = newTab(configure().injector);
      await first.connect();
      await vi.advanceTimersByTimeAsync(1);

        const second = newTab(configure().injector);
      await second.connect();
      await vi.advanceTimersByTimeAsync(1);

      // Un battement passe : le second entend le premier et se range.
      await vi.advanceTimersByTimeAsync(2500);
      expect(second.isPanelOwner()).toBe(false);

      // Fermeture brutale : on coupe le canal du premier sans envoyer de démission,
      // comme un onglet tué par le système ou un navigateur fermé.
      (first as unknown as { _channel: BroadcastChannel | null })._channel?.close();
      (first as unknown as { _channel: BroadcastChannel | null })._channel = null;
      const timer = (first as unknown as { _heartbeatTimer: unknown })._heartbeatTimer;
      clearInterval(timer as ReturnType<typeof setInterval>);

      // Au-delà de l'expiration du leader, le second reprend de lui-même.
      await vi.advanceTimersByTimeAsync(9000);

      expect(second.isPanelOwner()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cloisonne le canal par utilisateur : deux comptes ne se disputent pas le panneau', async () => {
    const alice = configure('browser', 'agent-alice');
    const bob = configure('browser', 'agent-bob');

    const aliceTab = newTab(alice.injector);
    const bobTab = newTab(bob.injector);

    await aliceTab.connect();
    await bobTab.connect();
    await settle();

    // `BroadcastChannel` porte sur l'ORIGINE, pas sur la session : avec un canal unique, deux
    // comptes ouverts dans le même profil de navigateur se disputaient UN panneau, et le
    // perdant ne recevait jamais son appel entrant sans que rien à l'écran l'explique. Chacun
    // est propriétaire du sien.
    expect(aliceTab.isPanelOwner()).toBe(true);
    expect(bobTab.isPanelOwner()).toBe(true);
  });

  it("l'ancienneté d'un onglet ne recule pas quand l'horloge système change", async () => {
    const { injector } = configure();
    const tab = newTab(injector);

    const realNow = Date.now;

    try {
      // Un ajustement NTP, ou un utilisateur qui recule l'heure de sa machine. Avec
      // `Date.now()` comme ancienneté, deux onglets pouvaient alors chacun se croire l'aîné.
      Date.now = () => realNow() - 3_600_000;

      await tab.connect();
      await settle();

      const since = (tab as unknown as { _since: number })._since;

      // Lu sur `performance.timeOrigin + performance.now()`, que reculer l'horloge système
      // n'affecte pas — donc l'ancienneté reste proche du temps réel et non une heure avant.
      expect(since).toBeGreaterThan(realNow() - 60_000);
    } finally {
      Date.now = realNow;
    }
  });

  it('se déclare propriétaire quand BroadcastChannel est indisponible', async () => {
    const original = globalThis.BroadcastChannel;
    // @ts-expect-error — on simule un navigateur qui ne l'implémente pas (dégradation).
    delete globalThis.BroadcastChannel;
    try {
        const service = newTab(configure().injector);
      await service.connect();
      await settle();

      // Afficher le panneau en double est désagréable ; ne pas l'afficher fait rater
      // l'appel. La dégradation choisit donc de l'afficher.
      expect(service.isPanelOwner()).toBe(true);
    } finally {
      globalThis.BroadcastChannel = original;
    }
  });
});
