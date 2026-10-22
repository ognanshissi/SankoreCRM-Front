import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MyTelephonyStatusDto, TelephonyApiService } from '@sankore/crm-api';
import { AuthenticationService, PermissionsService } from '@sankore/crm/common';
import { HttpErrorResponse } from '@angular/common/http';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EMPTY, catchError, finalize } from 'rxjs';
// Import PROFOND et non par la barrique de `common` : la flèche
// `telephony -> common` est la bonne (toutes les libs métier importent `common`), mais
// elle doit viser une FEUILLE. Passer par `@sankore/crm/common` conviendrait aussi ; le
// chemin direct évite d'avoir à exporter cet état technique dans la surface publique de
// `common`, que ce lot ne possède pas.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { TelephonyTopBarState } from '@sankore/crm/common';
import { TelephonyRealtimeService } from '../../data-access/telephony-realtime.service';
import { telephonyIndicatorPill } from './telephony-pill';

/**
 * Ce que la téléphonie de CET agent peut faire, lu une seule fois pour toute
 * l'application (TEL-F-04, TEL-F-05, TEL-F-11).
 *
 * `GET telephony/me` est la seule lecture téléphonique qu'un agent ordinaire peut faire
 * sur lui-même — tout le reste est derrière une permission d'administrateur. Trois
 * surfaces en dépendent (la pastille de la barre, chaque bouton « Appeler », le panneau
 * d'appel) et elles sont montées en même temps : sans ce service, la même réponse serait
 * demandée trois fois par chargement de page, et les trois pourraient se contredire le
 * temps des allers-retours.
 *
 * Deux règles viennent du contrat et ne sont pas à réinventer :
 *
 * 1. **`canMakeCalls` est déjà la conjonction des trois conditions** (téléphonie active,
 *    poste rattaché, `Telephony.Call.Make`). On lit ce drapeau ; on ne recombine pas
 *    `telephonyEnabled`, `linkStatus` et la permission, parce qu'une quatrième condition
 *    ajoutée côté serveur ferait alors mentir le front.
 * 2. **`telephonyEnabled` à faux veut dire « cacher toute la zone »**, pas « afficher
 *    désactivé » : c'est le cas de la majorité des établissements, et une pastille grise
 *    permanente chez tous ceux qui n'ont jamais acheté de téléphonie serait du bruit.
 *
 * Un échec de cette lecture ne lève aucune alerte : la téléphonie est un confort, et une
 * notification d'erreur à chaque chargement de page pour un module que l'établissement
 * n'utilise peut-être pas est pire que l'absence de pastille. La zone reste simplement
 * masquée.
 *
 * Rien n'est persisté : ni `localStorage`, ni `sessionStorage`, ni IndexedDB.
 */
@Injectable({ providedIn: 'root' })
export class TelephonyStatusService {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _realtime = inject(TelephonyRealtimeService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _topBar = inject(TelephonyTopBarState);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  private readonly _status = signal<MyTelephonyStatusDto | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _hasLoaded = signal(false);
  private readonly _loadFailed = signal(false);

  public readonly status = this._status.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly hasLoaded = this._hasLoaded.asReadonly();
  public readonly loadFailed = this._loadFailed.asReadonly();

  /** Vrai seulement quand le serveur l'a dit. Avant la réponse, on ne propose rien. */
  public readonly canMakeCalls = computed(() => this._status()?.canMakeCalls === true);

  /** Faux ferme la zone entière, pastille comprise. */
  public readonly telephonyEnabled = computed(
    () => this._status()?.telephonyEnabled === true,
  );

  public readonly linkStatus = computed(() => this._status()?.linkStatus ?? null);

  public readonly canView = this._permissions.can('Telephony.Call.View');

  private readonly _realtimeAttempted = signal(false);
  /**
   * Vrai une fois que `connect()` a rendu la main — succès ou échec.
   *
   * La pastille s'en sert pour ne PAS annoncer « Connexion temps réel perdue » avant la
   * première tentative : l'état initial du client temps réel est `Disconnected`, qui au
   * démarrage veut dire « pas encore essayé » et non « tombé ».
   */
  public readonly realtimeAttempted = this._realtimeAttempted.asReadonly();

  public readonly realtimeState = this._realtime.state;
  public readonly isPanelOwner = this._realtime.isPanelOwner;

  /** Une seule tentative par session : `connect()` est idempotent, pas gratuit. */
  private _realtimeRequested = false;

  public constructor() {
    // Ouverture du socket (TEL-F-05/TEL-F-11) : c'est ici qu'elle est câblée, et nulle
    // part ailleurs. Conditionnée au navigateur, à la permission de LECTURE et à une
    // téléphonie active — ouvrir un websocket chez un établissement sans téléphonie
    // consommerait une connexion par onglet pour des évènements que personne n'émettra.
    effect(() => {
      if (!this._isBrowser) return;

      if (!this._auth.accessToken()) {
        // Fin de session : le client temps réel se ferme tout seul, mais il faut
        // réautoriser une tentative, sinon l'utilisateur suivant de cet onglet
        // n'aurait jamais de panneau d'appel.
        this._realtimeRequested = false;
        this._realtimeAttempted.set(false);
        this._hasLoaded.set(false);
        this._status.set(null);
        return;
      }

      if (this._realtimeRequested) return;
      if (!this.telephonyEnabled() || !this.canView()) return;

      this._realtimeRequested = true;
      void this._realtime
        .connect()
        .finally(() => this._realtimeAttempted.set(true));
    });

    // Publication de la pastille de la barre supérieure (TEL-F-11). C'est ici et non dans
    // un composant, parce que `common` ne doit RIEN savoir de la téléphonie : il possède
    // le contrat et le rendu, ce module possède la logique et les libellés.
    effect(() => {
      this._topBar.set(
        telephonyIndicatorPill({
          telephonyEnabled: this.telephonyEnabled(),
          linkStatus: this.linkStatus(),
          realtimeState: this.realtimeState(),
          realtimeAttempted: this._realtimeAttempted(),
          canViewCalls: this.canView(),
        }),
      );
    });

    // « Lier mon compte » dans le menu du profil : proposé tant que le poste n'est pas
    // rattaché (ou ne l'est plus chez le fournisseur). Le serveur trouve le compte par
    // l'adresse e-mail de l'agent ; à défaut, il le dit et un administrateur reprend la main.
    effect(() => {
      const link = this.linkStatus();
      const repairable = this.telephonyEnabled() && (link === 'NotLinked' || link === 'Broken');
      this._topBar.setAction(
        repairable
          ? { label: link === 'Broken' ? 'Relier mon compte' : 'Lier mon compte', run: () => this.linkMyAccount() }
          : null,
      );
    });

    this._destroyRef.onDestroy(() => {
      this._topBar.setAction(null);
      this._topBar.set(null);
      this.stopRealtime();
    });
  }

  /** Idempotent : les trois surfaces l'appellent, une seule requête part. */
  public load(): void {
    if (this._hasLoaded() || this._isLoading()) return;
    this.reload();
  }

  public reload(): void {
    this._isLoading.set(true);

    this._telephonyApi
      .getMyTelephonyStatus()
      .pipe(
        catchError(() => {
          // Volontairement muet : voir l'en-tête de classe.
          this._isLoading.set(false);
          this._hasLoaded.set(true);
          this._loadFailed.set(true);
          this._status.set(null);

          return EMPTY;
        }),
      )
      .subscribe((status) => {
        this._status.set(status);
        this._loadFailed.set(false);
        this._hasLoaded.set(true);
        this._isLoading.set(false);
      });
  }

  /** Rattache l'agent à SON compte chez le fournisseur, retrouvé par son adresse e-mail. */
  public linkMyAccount(): void {
    if (this._topBar.actionBusy()) return;
    this._topBar.setActionBusy(true);

    this._telephonyApi
      .linkMyTelephonyAccount()
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Compte non lié', SELF_LINK_ERRORS[err.error?.error] ?? SELF_LINK_ERRORS['default']);
          return EMPTY;
        }),
        finalize(() => this._topBar.setActionBusy(false)),
      )
      .subscribe((linked) => {
        this._snackbar.success(
          'Compte téléphonique lié',
          linked.displayName ? `Vous appelez désormais depuis le compte « ${linked.displayName} ».` : 'Vous pouvez appeler depuis le CRM.',
        );
        this.reload();
      });
  }

  public stopRealtime(): void {
    this._realtimeRequested = false;
    this._realtimeAttempted.set(false);
    this._realtime.disconnect();
  }
}

/** Les refus du rattachement en libre-service, dits avec ce que l'agent peut faire ensuite. */
const SELF_LINK_ERRORS: Record<string, string> = {
  TELEPHONY_SELF_LINK_NO_MATCH:
    'Aucun compte chez votre fournisseur de téléphonie ne porte votre adresse e-mail. Demandez à un administrateur de vous rattacher.',
  TELEPHONY_SELF_LINK_AMBIGUOUS:
    'Plusieurs comptes ou utilisateurs partagent votre adresse e-mail : un administrateur doit choisir le bon.',
  TELEPHONY_USER_LINK_ALREADY_TAKEN: 'Ce compte est déjà rattaché à un collègue. Contactez un administrateur.',
  INTEGRATION_UNAVAILABLE: 'Le fournisseur de téléphonie ne répond pas. Réessayez dans un instant.',
  default: 'Le rattachement a échoué. Réessayez, ou demandez à un administrateur.',
};
