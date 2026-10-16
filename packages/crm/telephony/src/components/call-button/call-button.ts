import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  RequestClickToCallRequestSlotEnum,
  TelephonyApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { Menu, MenuItem, TasMenuTrigger } from '@talisoft/ui/menu';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { EMPTY, catchError } from 'rxjs';
import { TelephonyRealtimeService } from '../../data-access/telephony-realtime.service';
import {
  TelephonyEntityType,
  telephonyErrorMessage,
} from '../../data-access/telephony-referential';
import { TelephonyStatusService } from '../telephony-status-indicator/telephony-status.service';
import {
  ClickToCallState,
  IDLE_CLICK_TO_CALL,
  TEL_CALL_SLOTS,
  clickToCallAccepted,
  clickToCallEvent,
  clickToCallRequested,
  clickToCallTimedOut,
  telCallSlotLabel,
} from './click-to-call';

/**
 * Délai au bout duquel on cesse d'attendre une sonnerie.
 *
 * Généreux à dessein : la demande traverse le serveur puis le fournisseur avant que le
 * poste sonne. Ce qui l'expire n'est pas l'appel, c'est le SUIVI — voir `ClickToCallPhase`.
 */
const FOLLOW_TIMEOUT_MS = 25_000;

/**
 * Bouton « Appeler » (TEL-F-04), réutilisable : en-tête de fiche lead, en-tête de fiche
 * client, ligne de liste, et à l'intérieur du panneau d'appel.
 *
 * Trois contraintes de l'API gouvernent ce composant, et aucune n'est contournable :
 *
 * 1. **Le front n'envoie JAMAIS de numéro.** Il envoie la fiche et l'emplacement
 *    (`Primary` / `Secondary`) ; le serveur déchiffre et compose. Il n'affiche donc aucun
 *    numéro non plus — il n'en détient aucun.
 * 2. **Aucun endpoint ne dit quels emplacements contiennent un numéro.** Les deux sont
 *    proposés à l'aveugle, et c'est le refus du serveur qui apprend qu'un emplacement est
 *    vide. Une « vérification de présence » inventée ici masquerait le second numéro de
 *    toutes les fiches qui en ont un. L'hôte qui SAIT n'en avoir qu'un peut passer
 *    `[slots]="['Primary']"` et retrouver un bouton simple.
 * 3. **Le 202 rend un `requestId` que rien ne relie à un `callId`.** Le suivi passe donc
 *    par la sonnerie temps réel, qui est livrée au mieux : sans elle, l'attente expire et
 *    le dit franchement au lieu de laisser un bouton tourner indéfiniment.
 *
 * Rien n'est persisté : l'identifiant d'appel vit en mémoire et meurt avec le composant.
 */
@Component({
  selector: 'lib-call-button',
  imports: [Button, TasIcon, Menu, MenuItem, TasMenuTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-button.html',
})
export class CallButton {
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _realtime = inject(TelephonyRealtimeService);
  private readonly _status = inject(TelephonyStatusService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly entityType = input.required<TelephonyEntityType>();
  public readonly entityId = input.required<string>();

  /**
   * Emplacements proposés. Les deux par défaut, parce que rien ne permet de savoir
   * lesquels sont remplis ; un hôte qui ne gère qu'un numéro passe `['Primary']` et
   * obtient un bouton unique au lieu d'un menu.
   */
  public readonly slots = input<readonly RequestClickToCallRequestSlotEnum[]>(
    TEL_CALL_SLOTS,
  );

  /** Ligne de liste : bouton icône seul, et le suivi passe par le bandeau du panneau. */
  public readonly compact = input(false);

  public readonly label = input('Appeler');

  /** Masqué tant que le serveur n'a pas dit que cet agent peut appeler. */
  public readonly canCall = this._status.canMakeCalls;

  private readonly _state = signal<ClickToCallState>(IDLE_CLICK_TO_CALL);
  public readonly state = this._state.asReadonly();

  public readonly isBusy = computed(() => {
    const phase = this._state().phase;

    return phase === 'Requesting' || phase === 'Ringing';
  });

  public readonly hasMenu = computed(() => this.slots().length > 1);

  /** Message du bandeau, ou `null` quand il n'y a rien à annoncer. */
  public readonly notice = computed(() => {
    const state = this._state();

    switch (state.phase) {
      case 'Requesting':
        return 'Demande envoyée au système de téléphonie…';
      case 'Ringing':
        return 'Votre téléphone sonne, décrochez pour lancer l’appel';
      case 'Connected':
        return 'Connecté';
      case 'Failed':
        return 'Échec : personne n’a décroché, ou l’appel a été interrompu.';
      case 'Expired':
        return "Expiré : l'appel n'a pas pu être suivi. Vérifiez votre poste — s'il a sonné, l'appel a bien été lancé ; le journal des appels le dira.";
      default:
        return null;
    }
  });

  public readonly noticeTone = computed(() => {
    switch (this._state().phase) {
      case 'Connected':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'Failed':
        return 'bg-red-50 text-red-800 border-red-200';
      case 'Expired':
        return 'bg-amber-50 text-amber-900 border-amber-200';
      default:
        return 'bg-primary/5 text-slate-700 border-primary/30';
    }
  });

  private _timer: ReturnType<typeof setTimeout> | null = null;

  public constructor() {
    this._status.load();

    // Suivi de notre propre appel. Le flux temps réel ne porte qu'un `callId` : toute la
    // corrélation est dans `clickToCallEvent`, qui porte aussi ses limites.
    effect(() => {
      const event = this._realtime.lastEvent();

      if (!event) return;

      this._state.update((state) => clickToCallEvent(state, event));
    });

    this._destroyRef.onDestroy(() => this._clearTimer());
  }

  public slotLabel(slot: string): string {
    return telCallSlotLabel(slot);
  }

  public call(slot: RequestClickToCallRequestSlotEnum): void {
    if (this.isBusy()) return;

    const requestedAt = Date.now();

    this._state.set(clickToCallRequested(slot, requestedAt));
    this._armTimer();

    this._telephonyApi
      .requestTelephonyClickToCall({
        // `entityType` est une chaîne nue au contrat : l'union du référentiel est la
        // seule garde côté front, d'où le transtypage à travers elle plutôt qu'un
        // littéral libre.
        entityType: this.entityType(),
        entityId: this.entityId(),
        slot,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._clearTimer();
          this._state.set(IDLE_CLICK_TO_CALL);

          // Le refus « cet emplacement est vide » répond `UNKNOWN_SENSITIVE_FIELD` ou
          // `LEAD_PHONE_SLOT_EMPTY`, que le référentiel ne traduit pas : la phrase de
          // repli nomme donc l'emplacement, parce que c'est l'information qui dit quoi
          // faire. On ne prétend pas savoir ce que la fiche contient.
          this._snackbar.error(
            'Appel impossible',
            telephonyErrorMessage(
              error,
              `L'appel n'a pas pu être lancé. Aucun numéro n'est peut-être enregistré dans l'emplacement « ${telCallSlotLabel(slot)} » de cette fiche.`,
            ),
          );

          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this._state.update((state) =>
          clickToCallAccepted(state, response?.requestId ?? null),
        );
      });
  }

  /** Le seul bouton du bandeau : l'agent reconnaît avoir lu, l'état repart de zéro. */
  public dismissNotice(): void {
    this._clearTimer();
    this._state.set(IDLE_CLICK_TO_CALL);
  }

  private _armTimer(): void {
    this._clearTimer();
    this._timer = setTimeout(() => {
      this._state.update((state) =>
        clickToCallTimedOut(state, Date.now(), FOLLOW_TIMEOUT_MS),
      );
    }, FOLLOW_TIMEOUT_MS);
  }

  private _clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
