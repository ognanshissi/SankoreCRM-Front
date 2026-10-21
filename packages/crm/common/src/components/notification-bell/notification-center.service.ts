import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  PLATFORM_ID,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from '@microsoft/signalr';
import { MyNotificationDto, NotificationsApiService, UsersApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { catchError, EMPTY, firstValueFrom, Subject, switchMap } from 'rxjs';
import { AuthenticationService } from '../../services/authentification.service';
import { ENVIRONMENT_CONFIG } from '../../utils/environment-config.token';
import { playNotificationSound } from './notification-sound';

/** Taille de l'aperçu de la cloche : les 20 dernières, pas d'historique paginé. */
const PREVIEW_LIMIT = 20;
/** Filet de sécurité quand le hub n'est pas connecté (WA-FE-10). */
const FALLBACK_POLL_MS = 2 * 60 * 1000;

export type NotificationRealtimeState = 'Disconnected' | 'Connecting' | 'Connected' | 'Reconnecting';

/**
 * État de la cloche de notifications in-app (WA-FE-10) : liste, compteur de non-lues,
 * connexion temps réel et préférence de son.
 *
 * Le hub `/hubs/realtime` est celui de la téléphonie, mais cette connexion est la SIENNE : le
 * service téléphonie vit dans `telephony`, que `common` ne peut pas importer (cycle d'imports,
 * cf. `telephony-top-bar-state.ts`), et il ne se connecte que pour les détenteurs de
 * `Telephony.Call.View`, alors que la cloche concerne tous les utilisateurs.
 *
 * Comme pour la téléphonie, le serveur ne pousse qu'un identifiant (`{ notificationId }`) et le
 * client n'invoque aucune méthode du hub : le contenu est relu par l'API HTTP, et la livraison
 * temps réel n'est qu'une accélération. D'où le rechargement à la reconnexion (rattrapage) et la
 * relecture périodique tant que le socket est coupé.
 */
@Injectable({ providedIn: 'root' })
export class NotificationCenterService {
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _environment = inject(ENVIRONMENT_CONFIG);
  private readonly _auth = inject(AuthenticationService);
  private readonly _notificationsApi = inject(NotificationsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  private readonly _items = signal<MyNotificationDto[]>([]);
  public readonly items = this._items.asReadonly();

  private readonly _unreadCount = signal(0);
  public readonly unreadCount = this._unreadCount.asReadonly();

  private readonly _isLoading = signal(false);
  public readonly isLoading = this._isLoading.asReadonly();

  private readonly _soundEnabled = signal(true);
  public readonly soundEnabled = this._soundEnabled.asReadonly();

  private readonly _state = signal<NotificationRealtimeState>('Disconnected');
  public readonly realtimeState = this._state.asReadonly();

  /**
   * Sur la PRÉSENCE du jeton, pas sur sa valeur : le rafraîchissement remplace le jeton, et
   * suivre la valeur couperait puis rouvrirait le socket à chaque renouvellement. Pas sur
   * `connectedUser` non plus : il repasse par null à chaque `getCurrentUserInfo()`.
   */
  private readonly _isAuthenticated = computed(() => !!this._auth.accessToken());

  private _connection: HubConnection | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _started = false;
  /** Notifications poussées dont on attend le contenu (relu par l'API) pour afficher le toast. */
  private readonly _pendingToasts = new Set<string>();
  private readonly _reload$ = new Subject<void>();

  public constructor() {
    // `switchMap` : un rechargement plus récent annule le précédent, pour qu'une réponse
    // tardive n'écrase pas un état déjà plus frais (rafale de notifications).
    this._reload$
      .pipe(
        switchMap(() => {
          this._isLoading.set(true);
          return this._notificationsApi.listMyNotifications(PREVIEW_LIMIT).pipe(
            catchError(() => {
              this._isLoading.set(false);
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        this._isLoading.set(false);
        this._items.set(result.items ?? []);
        this._unreadCount.set(result.unreadCount ?? 0);
        this._flushPendingToasts();
      });

    this._destroyRef.onDestroy(() => this._stop());

    if (this._isBrowser) {
      effect(() => {
        const authenticated = this._isAuthenticated();
        untracked(() => (authenticated ? this._start() : this._stop()));
      });
    }
  }

  /** Relit la liste et le compteur. */
  public reload(): void {
    if (!this._auth.accessToken()) return;
    this._reload$.next();
  }

  /**
   * À appeler après l'enregistrement de « Paramétrage agent » : la préférence n'est lue qu'au
   * démarrage, et relire les réglages à chaque notification serait un appel de trop.
   */
  public setSoundEnabled(enabled: boolean): void {
    this._soundEnabled.set(enabled);
  }

  public markRead(notification: MyNotificationDto): void {
    const id = notification.id;
    if (!id || notification.readAt) return;

    // Optimiste : la cloche réagit au clic, et on relit en cas d'échec.
    const now = new Date().toISOString();
    this._items.update((items) => items.map((n) => (n.id === id ? { ...n, readAt: now } : n)));
    this._unreadCount.update((count) => Math.max(0, count - 1));
    this._notificationsApi
      .markMyNotificationRead(id)
      .pipe(catchError(() => (this.reload(), EMPTY)))
      .subscribe();
  }

  public markAllRead(): void {
    if (this._unreadCount() === 0) return;
    const now = new Date().toISOString();
    this._items.update((items) => items.map((n) => (n.readAt ? n : { ...n, readAt: now })));
    this._unreadCount.set(0);
    this._notificationsApi
      .markAllMyNotificationsRead()
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de marquer les notifications comme lues.');
          this.reload();
          return EMPTY;
        }),
      )
      .subscribe();
  }

  // ——— Cycle de vie de la session ———

  private _start(): void {
    if (this._started) return;
    this._started = true;

    this.reload();
    this._loadSoundPreference();
    void this._connect();

    this._pollTimer = setInterval(() => {
      if (this._state() === 'Connected') return;
      this.reload();
      // `withAutomaticReconnect` abandonne après ~40 s : sans nouvelle tentative ici, une
      // coupure un peu longue (veille du poste) laisserait la session en relecture seule.
      if (this._state() === 'Disconnected') void this._connect();
    }, FALLBACK_POLL_MS);
  }

  private _stop(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    const connection = this._connection;
    this._connection = null;
    this._state.set('Disconnected');
    if (connection) void connection.stop().catch(() => undefined);

    this._started = false;
    this._pendingToasts.clear();
    this._items.set([]);
    this._unreadCount.set(0);
    this._soundEnabled.set(true);
  }

  private _loadSoundPreference(): void {
    this._usersApi
      .getMyAgentSettings()
      .pipe(catchError(() => EMPTY))
      .subscribe((settings) => this._soundEnabled.set(settings.notificationSound ?? true));
  }

  private async _connect(): Promise<void> {
    if (!this._isBrowser || this._connection || !this._auth.accessToken()) return;

    this._state.set('Connecting');

    const connection = new HubConnectionBuilder()
      .withUrl(`${this._environment.apiUrl}/hubs/realtime`, {
        // Le websocket ne passe pas par `HttpClient` : l'intercepteur qui rafraîchit sur 401
        // ne le couvre pas, d'où le rafraîchissement explicite avant chaque poignée de main.
        accessTokenFactory: () => this._freshAccessToken(),
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();

    this._connection = connection;

    connection.on('notification.created', (payload: unknown) => this._onCreated(payload));
    connection.onreconnecting(() => this._state.set('Reconnecting'));
    connection.onreconnected(() => {
      this._state.set('Connected');
      // Rattrapage : rien n'est rejoué pendant la coupure.
      this.reload();
    });
    connection.onclose(() => {
      if (this._connection !== connection) return;
      this._connection = null;
      this._state.set('Disconnected');
    });

    try {
      await connection.start();
      if (this._connection === connection) this._state.set('Connected');
    } catch {
      // Pas de toast : la relecture périodique prend le relais sans déranger l'agent.
      if (this._connection === connection) {
        this._connection = null;
        this._state.set('Disconnected');
      }
    }
  }

  private async _freshAccessToken(): Promise<string> {
    if (this._auth.isTokenExpired()) {
      await firstValueFrom(this._auth.refreshAccessToken()).catch(() => null);
    }
    return this._auth.accessToken() ?? '';
  }

  private _onCreated(payload: unknown): void {
    const notificationId = (payload as { notificationId?: unknown } | null)?.notificationId;
    if (typeof notificationId === 'string' && notificationId) {
      this._pendingToasts.add(notificationId);
    }
    if (this._soundEnabled()) playNotificationSound();
    this.reload();
  }

  private _flushPendingToasts(): void {
    if (this._pendingToasts.size === 0) return;
    for (const id of this._pendingToasts) {
      const notification = this._items().find((n) => n.id === id);
      if (notification) {
        this._snackbar.info(notification.title || 'Nouvelle notification', notification.body ?? '');
      } else {
        this._snackbar.info('Nouvelle notification', 'Ouvrez la cloche pour la consulter.');
      }
    }
    this._pendingToasts.clear();
  }

  /** `HubConnectionState` brut, pour un diagnostic. */
  public get rawConnectionState(): HubConnectionState {
    return this._connection?.state ?? HubConnectionState.Disconnected;
  }
}
