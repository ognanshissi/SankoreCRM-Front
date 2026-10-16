import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { Router } from '@angular/router';
import {
  CallOutcomeDto,
  TelephonyApiService,
  TelephonyCallContext,
  TelephonyCandidate,
} from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { EMPTY, catchError, firstValueFrom } from 'rxjs';
import { TelephonyRealtimeService } from '../../data-access/telephony-realtime.service';
import {
  TelephonyEntityType,
  telCallDirectionLabel,
  telCallStatusLabel,
  telCallStatusSeverity,
  telMatchStatusLabel,
  telMatchStatusSeverity,
  telephonyEntityTypeLabel,
  telephonyErrorMessage,
} from '../../data-access/telephony-referential';
import { WrapUpForm } from '../wrap-up-form/wrap-up-form';
import { callClock } from '../call-history/call-presentation';
import { TelephonyStatusService } from '../telephony-status-indicator/telephony-status.service';
import { CallPanelService } from './call-panel.service';
import { CallRecordPicker, PickedRecord } from './call-record-picker';

class LinkReasonFormModel {
  public reason!: string;

  public static instantiate(): LinkReasonFormModel {
    const model = new LinkReasonFormModel();
    model.reason = '';

    return model;
  }
}

/**
 * Panneau d'appel, monté UNE SEULE FOIS dans la coquille de l'application (TEL-F-05).
 *
 * L'architecture est celle de `access-denied` : un service racine qui tient l'état en
 * signal, un composant `OnPush` posé à côté de `<access-denied-banner />` dans
 * `app.html`. C'est la façon dont cette application fait son habillage global, et c'est
 * la seule qui garantisse qu'un appel n'ouvre pas un panneau par écran monté.
 *
 * Ce qui est imposé par le contrat, et qu'il ne faut pas « améliorer » :
 *
 * 1. **La trame temps réel ne porte qu'un `callId`** — ni numéro, ni nom, ni direction.
 *    Le panneau s'affiche donc immédiatement avec « Appel entrant » puis demande
 *    `GET telephony/calls/{callId}/context`, qui applique la permission et le périmètre
 *    d'agence qu'un websocket ne peut pas appliquer.
 * 2. **Un candidat hors périmètre n'a PAS de nom** (`displayName: null`). On affiche
 *    « Contact connu d'une autre agence » et rien de plus : la fiche reste cachée, et
 *    c'est ce qui évite de chercher pendant dix minutes quelqu'un qu'on ne peut pas voir.
 * 3. **Aucun numéro n'est jamais renvoyé.** Un appel inconnu se décrit par ce qu'on sait
 *    de lui — le moment, la direction — pas par un numéro masqué qu'on n'a pas.
 * 4. **Un seul onglet affiche le panneau** (`isPanelOwner`). Le serveur diffuse à toutes
 *    les connexions de l'utilisateur ; l'élection est déjà écrite dans le client temps
 *    réel, les autres onglets se contentent d'un badge discret.
 *
 * Rien n'est persisté : ni identifiant d'appel, ni nom, ni note, ni média.
 */
@Component({
  selector: 'lib-call-panel',
  imports: [
    FormRoot,
    FormField,
    Button,
    TasIcon,
    TasSpinner,
    TasTag,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    WrapUpForm,
    CallRecordPicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-panel.html',
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class CallPanel {
  private readonly _panel = inject(CallPanelService);
  private readonly _realtime = inject(TelephonyRealtimeService);
  /**
   * Injecté ici, et c'est ce qui le met en service : ce composant est monté une seule
   * fois pour toute l'application, donc c'est le seul endroit qui garantisse que l'état
   * de la téléphonie est lu et la connexion temps réel ouverte — y compris pour un agent
   * qui n'ouvre jamais une fiche et n'affiche donc jamais de bouton « Appeler ».
   */
  private readonly _status = inject(TelephonyStatusService);
  private readonly _telephonyApi = inject(TelephonyApiService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _isBrowser = isPlatformBrowser(this._platformId);

  public readonly call = this._panel.call;
  public readonly isPanelOwner = this._realtime.isPanelOwner;

  public readonly canView = this._permissions.can('Telephony.Call.View');
  public readonly canLink = this._permissions.can('Telephony.Call.Link');

  public readonly context = signal<TelephonyCallContext | null>(null);
  public readonly isLoadingContext = signal(false);
  public readonly contextError = signal<string | null>(null);

  public readonly outcomes = signal<CallOutcomeDto[]>([]);

  public readonly isLinking = signal(false);
  public readonly isCreatingLead = signal(false);
  public readonly showPicker = signal(false);

  /** Fiche choisie, en attente du motif obligatoire. */
  public readonly pendingLink = signal<PickedRecord | null>(null);

  public readonly directionLabel = telCallDirectionLabel;
  public readonly statusLabel = telCallStatusLabel;
  public readonly statusSeverity = telCallStatusSeverity;
  public readonly matchLabel = telMatchStatusLabel;
  public readonly matchSeverity = telMatchStatusSeverity;
  public readonly entityTypeLabel = telephonyEntityTypeLabel;

  public readonly matchStatus = computed(() => this.context()?.matchStatus ?? null);

  public readonly candidates = computed<TelephonyCandidate[]>(
    () => this.context()?.candidates ?? [],
  );

  /** Le seul candidat exploitable d'un appel `Matched`, s'il est dans le périmètre. */
  public readonly matchedCandidate = computed(() => {
    const first = this.candidates()[0];

    return first && !first.outOfPerimeter ? first : null;
  });

  public readonly isEnded = computed(() => this.call()?.phase === 'Ended');
  public readonly isInProgress = computed(() => this.call()?.phase === 'InProgress');

  /**
   * Titre du panneau. Il dépend de la phase ET de la direction, parce que le même panneau
   * sert les deux : un appel sortant qui « sonne » fait sonner le poste de l'AGENT, pas
   * celui du client, et annoncer « Appel entrant » dans ce cas ferait chercher un
   * appelant qui n'existe pas.
   */
  public readonly panelTitle = computed(() => {
    const phase = this.call()?.phase;

    if (phase === 'Ended') return "Appel terminé — à qualifier";
    if (phase === 'InProgress') return 'Appel en cours';

    return this.context()?.direction === 'Outbound'
      ? 'Votre poste sonne — décrochez pour lancer l’appel'
      : 'Appel entrant';
  });

  /** Heure de début, telle que le contexte la donne. Jamais un numéro : il n'y en a pas. */
  public readonly startedAtLabel = computed(() => {
    const startedAt = this.context()?.startedAt;

    if (!startedAt) return null;

    const date = new Date(startedAt);

    if (Number.isNaN(date.getTime())) return null;

    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  });

  /**
   * Statut passé au formulaire de qualification, relu sur le contexte : les quatre
   * statuts terminaux partagent un seul évènement `ended`, donc le flux temps réel ne dit
   * pas lequel c'est, et c'est lui qui décide de l'issue proposée par défaut.
   */
  public readonly wrapUpStatus = computed(() => this.context()?.status ?? null);

  /** Horloge du chronomètre : ne bat QUE pendant la conversation. */
  private readonly _now = signal(Date.now());

  public readonly clock = computed(() => {
    const call = this.call();

    if (!call?.answeredAt) return null;

    const until = call.endedAt ?? this._now();

    return callClock((until - call.answeredAt) / 1000);
  });

  public model = signal(LinkReasonFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.reason, {
      message: 'Le motif est obligatoire : il est conservé au journal d’audit.',
    });
  });

  private readonly _dialog = viewChild<ElementRef<HTMLElement>>('dialog');

  /** Élément à qui rendre le focus à la fermeture. */
  private _previouslyFocused: HTMLElement | null = null;

  private _ticker: ReturnType<typeof setInterval> | null = null;

  public constructor() {
    this._status.load();

    // Chargement du contexte : une fois par appel, et de nouveau au raccroché — c'est le
    // seul moyen de connaître le statut terminal (Terminé, Manqué, Messagerie, Échec),
    // que l'évènement `ended` ne porte pas et dont la qualification a besoin.
    effect(() => {
      const call = this.call();

      if (!call || !this.canView()) {
        this.context.set(null);

        return;
      }

      this._loadContext(call.callId, call.phase);
    });

    // Chronomètre. Démarré sur la conversation seulement : une minuterie qui tourne hors
    // appel réveille le navigateur une fois par seconde pour rien.
    effect(() => {
      const running = this.isInProgress();

      if (running && !this._ticker) {
        this._now.set(Date.now());
        this._ticker = setInterval(() => this._now.set(Date.now()), 1000);
      } else if (!running && this._ticker) {
        clearInterval(this._ticker);
        this._ticker = null;
      }
    });

    // Référentiel des issues, chargé quand la qualification devient nécessaire. Pas au
    // démarrage : la majorité des sessions n'ouvrira jamais le panneau.
    effect(() => {
      if (!this.isEnded() || !this.canView()) return;
      if (this.outcomes().length > 0) return;

      this._loadOutcomes();
    });

    // Accessibilité : le panneau prend le focus à l'ouverture et le rend à la fermeture.
    effect(() => {
      const call = this.call();
      const dialog = this._dialog()?.nativeElement;

      if (!this._isBrowser) return;

      if (call && dialog) {
        if (!dialog.contains(document.activeElement)) {
          this._previouslyFocused = document.activeElement as HTMLElement | null;
          dialog.focus();
        }

        return;
      }

      if (!call && this._previouslyFocused) {
        this._previouslyFocused.focus?.();
        this._previouslyFocused = null;
      }
    });

    // Notification navigateur, UNIQUEMENT si l'autorisation est déjà accordée. On
    // n'appelle jamais `Notification.requestPermission()` : une invite surgie d'un appel
    // entrant est exactement ce qui fait refuser l'autorisation pour toujours.
    effect(() => {
      const call = this.call();

      if (!this._isBrowser || !call || call.phase !== 'Ringing') return;
      if (!this.isPanelOwner()) return;

      this._notify();
    });

    // Réinitialisation des formulaires d'un appel à l'autre : un motif saisi pour l'appel
    // précédent ne doit pas se retrouver dans l'audit du suivant.
    effect(() => {
      this._resetLinkForms(this.call()?.callId ?? null);
    });

    this._destroyRef.onDestroy(() => {
      if (this._ticker) clearInterval(this._ticker);
      // Le socket est ouvert par `TelephonyStatusService` et fermé ici : le panneau est
      // monté pour la durée de l'application, sa destruction est donc la fin de session.
      this._realtime.disconnect();
    });
  }

  public close(): void {
    this._panel.close();
  }

  public onEscape(): void {
    if (this.call() && this.isPanelOwner()) this.close();
  }

  public candidateName(candidate: TelephonyCandidate): string {
    // Hors périmètre : le serveur ne renvoie PAS de nom, et il ne faut rien inventer.
    if (candidate.outOfPerimeter) return "Contact connu d'une autre agence";

    return candidate.displayName || 'Fiche sans nom';
  }

  public openRecord(candidate: TelephonyCandidate): void {
    if (candidate.outOfPerimeter || !candidate.entityId) return;

    const path =
      candidate.entityType === 'Customer'
        ? ['/customers', candidate.entityId]
        : ['/leads', candidate.entityId];

    void this._router.navigate(path);
  }

  public choose(candidate: TelephonyCandidate): void {
    if (candidate.outOfPerimeter || !candidate.entityId) return;

    this.showPicker.set(false);
    this.model.set(LinkReasonFormModel.instantiate());
    this.pendingLink.set({
      entityType: (candidate.entityType as TelephonyEntityType) ?? 'Lead',
      entityId: candidate.entityId,
      displayName: this.candidateName(candidate),
    });
  }

  public onPicked(record: PickedRecord): void {
    this.showPicker.set(false);
    this.model.set(LinkReasonFormModel.instantiate());
    this.pendingLink.set(record);
  }

  public cancelLink(): void {
    this.pendingLink.set(null);
  }

  public togglePicker(): void {
    this.pendingLink.set(null);
    this.showPicker.update((open) => !open);
  }

  public handleLink(): void {
    const target = this.pendingLink();
    const callId = this.call()?.callId;

    if (!target || !callId) return;

    submit(this.formSchema, async (field) => {
      const value = field()?.value();

      if (!value) return;

      this.isLinking.set(true);

      const linked = await firstValueFrom(
        this._telephonyApi
          .linkTelephonyCall(callId, {
            entityType: target.entityType,
            entityId: target.entityId,
            reason: value.reason.trim(),
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Rattachement impossible',
                telephonyErrorMessage(error, "L'appel n'a pas pu être rattaché."),
              );

              return EMPTY;
            }),
          ),
      ).then(
        () => true,
        () => false,
      );

      this.isLinking.set(false);

      if (!linked) return;

      this._snackbar.success('Appel rattaché', 'Le motif a été consigné au journal d’audit.');
      this.pendingLink.set(null);
      this._loadContext(callId, this.call()?.phase ?? 'Ringing', true);
    });
  }

  public createLead(): void {
    const callId = this.call()?.callId;

    if (!callId || this.isCreatingLead()) return;

    this.isCreatingLead.set(true);

    this._telephonyApi
      .createLeadFromTelephonyCall(callId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isCreatingLead.set(false);

          // Les deux 409 ne sont pas des pannes : le référentiel les traduit en phrases
          // qui disent ce qui s'est réellement passé (l'appelant est déjà client, l'appel
          // est déjà rattaché). On relit donc le contexte pour montrer la bonne fiche.
          this._snackbar.error(
            'Lead non créé',
            telephonyErrorMessage(error, "Le lead n'a pas pu être créé."),
          );
          this._loadContext(callId, this.call()?.phase ?? 'Ringing', true);

          return EMPTY;
        }),
      )
      .subscribe((response) => {
        this.isCreatingLead.set(false);
        this._snackbar.success('Lead créé', "L'appel est rattaché au nouveau lead.");

        if (response?.leadId) void this._router.navigate(['/leads', response.leadId]);

        this._loadContext(callId, this.call()?.phase ?? 'Ringing', true);
      });
  }

  public onWrapUpSaved(): void {
    this.close();
  }

  /**
   * Remise à zéro des formulaires de rattachement. Prend l'identifiant en paramètre sans
   * s'en servir : c'est lui qui fait la dépendance de l'effet appelant, et le nommer ici
   * évite qu'un « nettoyage » retire la lecture et laisse un motif d'un appel sur le
   * suivant.
   */
  private _resetLinkForms(callId: string | null): void {
    void callId;

    this.pendingLink.set(null);
    this.showPicker.set(false);
    this.model.set(LinkReasonFormModel.instantiate());
  }

  private _loadContext(callId: string, phase: string, force = false): void {
    const current = this.context();

    if (!force && current?.callId === callId && phase !== 'Ended') return;

    this.isLoadingContext.set(true);
    this.contextError.set(null);

    this._telephonyApi
      .getTelephonyCallContext(callId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isLoadingContext.set(false);
          this.contextError.set(
            telephonyErrorMessage(
              error,
              "Le correspondant n'a pas pu être identifié. L'appel reste visible dans le journal.",
            ),
          );

          return EMPTY;
        }),
      )
      .subscribe((context) => {
        this.context.set(context);
        this.isLoadingContext.set(false);
      });
  }

  private _loadOutcomes(): void {
    this._telephonyApi
      .listTelephonyCallOutcomes()
      .pipe(catchError(() => EMPTY))
      .subscribe((outcomes) => this.outcomes.set(outcomes ?? []));
  }

  private _notify(): void {
    try {
      if (typeof Notification === 'undefined') return;
      if (Notification.permission !== 'granted') return;

      // Aucun nom ni numéro dans la notification : elle sort du contexte authentifié de
      // l'onglet et peut s'afficher sur un écran verrouillé devant n'importe qui.
      new Notification('Appel entrant', {
        body: 'Un appel sonne. Ouvrez le CRM pour voir la fiche.',
        tag: 'sankore-telephony-call',
      });
    } catch {
      /* une notification refusée par le navigateur n'est pas une erreur à remonter */
    }
  }
}
