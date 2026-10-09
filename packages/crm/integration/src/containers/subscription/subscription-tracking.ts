import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { IntegrationCommandListItem } from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { catchError, EMPTY } from 'rxjs';
import { IntegrationFacadeService } from '../../data-access/integration-facade.service';
import { errorFamilyMessage } from '../../data-access/integration-referential';

type TrackingState = 'Waiting' | 'InProgress' | 'Done' | 'Failed';

interface TrackingStep {
  key: string;
  label: string;
  state: TrackingState;
  /** Phrase destinée à un agent : jamais un code d'erreur, jamais un identifiant. */
  detail: string | null;
}

/**
 * Suivi en direct d'une souscription — ASS-15, dernier critère d'acceptation.
 *
 * La séquence est celle que le back annonce : prélèvement de la prime, envoi à
 * l'assureur, contrat émis, ou rejet suivi d'une contre-passation. Elle est **dérivée**
 * de `GET integration/commands` filtré sur l'entité `Policy`, qui existe aujourd'hui et
 * dont `commandTypeLabel()` traduit déjà les trois types (`CollectPremium`,
 * `CreatePolicy`, `CancelPolicy`).
 *
 * Conséquence du contrat actuel : **il n'existe aucun endpoint de souscription**, donc
 * aucun `policyId` n'est jamais produit, donc ce composant n'est jamais monté. Il est
 * écrit et branché pour que l'arrivée d'ASS-04/ASS-05 n'oblige à rien d'autre qu'à
 * passer l'identifiant renvoyé par la souscription.
 *
 * Les quatre étapes ne sont pas une collection d'entités mais un état d'avancement à
 * quatre positions, reconstruit à chaque chargement : elles ne passent donc pas par
 * `tas-table`.
 */
@Component({
  selector: 'lib-subscription-tracking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasAlert, TasIcon, TasSpinner, Button],
  template: `
    <div class="rounded-lg border border-slate-200 bg-white p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm font-semibold text-slate-800">Avancement de la souscription</p>
          <p class="mt-0.5 text-xs text-slate-500">
            Chaque étape est confirmée par le système concerné, pas par cet écran.
          </p>
        </div>
        @if (isPolling()) {
          <tas-spinner size="6" class="text-primary"></tas-spinner>
        }
      </div>

      <ol class="mt-4 divide-y divide-slate-100">
        @for (step of steps(); track step.key) {
          <li class="flex items-start gap-3 py-3">
            <tas-icon
              [iconName]="iconFor(step.state)"
              [class]="colorFor(step.state)"
              style="font-size:16px"
              class="mt-0.5"
            ></tas-icon>
            <div class="min-w-0">
              <p class="text-sm font-medium text-slate-800">{{ step.label }}</p>
              <p class="mt-0.5 text-xs" [class]="colorFor(step.state)">
                {{ stateLabel(step.state) }}
              </p>
              @if (step.detail) {
                <p class="mt-1 text-sm text-slate-600">{{ step.detail }}</p>
              }
            </div>
          </li>
        }
      </ol>

      @if (trackingStopped()) {
        <tas-alert type="info" class="mt-4">
          <p class="text-sm">
            Le suivi automatique s'est arrêté. Le traitement se poursuit côté serveur.
          </p>
        </tas-alert>
        <button tas-outlined-button color="primary" type="button" class="mt-3" (click)="restart()">
          Relancer le suivi
        </button>
      }
    </div>
  `,
})
export class SubscriptionTracking implements OnInit, OnDestroy {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly policyId = input.required<string>();

  public readonly commands = signal<IntegrationCommandListItem[]>([]);
  public readonly isPolling = signal(false);
  public readonly trackingStopped = signal(false);

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollDeadline: ReturnType<typeof setTimeout> | null = null;

  public readonly steps = computed<TrackingStep[]>(() => {
    const rows = this.commands();
    const collect = rows.find((row) => row.commandType === 'CollectPremium');
    const create = rows.find((row) => row.commandType === 'CreatePolicy');
    const cancel = rows.find((row) => row.commandType === 'CancelPolicy');

    const steps: TrackingStep[] = [
      {
        key: 'premium',
        label: 'Prélèvement de la prime',
        state: stateOf(collect?.status),
        detail: failureDetail(collect),
      },
      {
        key: 'sent',
        label: "Envoi du dossier à l'assureur",
        state: sentState(create?.status),
        detail: failureDetail(create),
      },
      {
        key: 'issued',
        label: 'Contrat émis par l’assureur',
        state: create?.status === 'Succeeded' ? 'Done' : stateOf(create?.status) === 'Failed' ? 'Failed' : 'Waiting',
        detail: null,
      },
    ];

    // La contre-passation n'est une étape que s'il y a eu un rejet : l'afficher
    // d'office ferait craindre un remboursement là où tout s'est bien passé.
    if (cancel || create?.status === 'Rejected' || collect?.status === 'Rejected') {
      steps.push({
        key: 'reversal',
        label: 'Contre-passation du prélèvement',
        state: cancel ? stateOf(cancel.status) : 'Waiting',
        detail: cancel ? failureDetail(cancel) : 'La prime prélevée est remboursée au client.',
      });
    }

    return steps;
  });

  public ngOnInit(): void {
    this._load();
    this._startPolling();
  }

  public ngOnDestroy(): void {
    this._stopPolling();
  }

  public restart(): void {
    this.trackingStopped.set(false);
    this._load();
    this._startPolling();
  }

  public iconFor(state: TrackingState): string {
    switch (state) {
      case 'Done':
        return 'feather:check-circle';
      case 'Failed':
        return 'feather:alert-triangle';
      case 'InProgress':
        return 'feather:loader';
      default:
        return 'feather:circle';
    }
  }

  public colorFor(state: TrackingState): string {
    switch (state) {
      case 'Done':
        return 'text-functional-success';
      case 'Failed':
        return 'text-functional-error';
      case 'InProgress':
        return 'text-primary';
      default:
        return 'text-slate-400';
    }
  }

  public stateLabel(state: TrackingState): string {
    switch (state) {
      case 'Done':
        return 'Terminé';
      case 'Failed':
        return 'Bloqué';
      case 'InProgress':
        return 'En cours';
      default:
        return 'En attente';
    }
  }

  private _load(): void {
    this._facade
      .listCommands({ entityType: 'Policy', crmId: this.policyId(), page: 1, pageSize: 50 })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // Un 404 ne se sonde pas indéfiniment : la ressource n'existe pas.
          if (err.status === 404) this._stopPolling();
          return EMPTY;
        }),
      )
      .subscribe((page) => {
        this.commands.set(page.rows ?? []);
        if (this._isSettled()) this._stopPolling();
      });
  }

  private _isSettled(): boolean {
    const create = this.commands().find((row) => row.commandType === 'CreatePolicy');
    return create?.status === 'Succeeded' || create?.status === 'Rejected';
  }

  private _startPolling(): void {
    this._stopPolling();
    this.isPolling.set(true);
    this._pollTimer = setInterval(() => this._load(), 5000);

    // Le sondage s'arrête au bout de deux minutes : on le dit et on laisse relancer,
    // plutôt que de laisser l'agent devant un spinner sans fin.
    this._pollDeadline = setTimeout(() => {
      if (!this._pollTimer) return;
      this._stopPolling();
      this.trackingStopped.set(true);
      this._snackbar.info(
        'Suivi suspendu',
        'Le traitement se poursuit. Relancez le suivi pour connaître son état.',
      );
    }, 120_000);
  }

  private _stopPolling(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._pollDeadline) clearTimeout(this._pollDeadline);
    this._pollTimer = null;
    this._pollDeadline = null;
    this.isPolling.set(false);
  }
}

function stateOf(status: string | null | undefined): TrackingState {
  switch (status) {
    case 'Succeeded':
      return 'Done';
    case 'Sent':
      return 'InProgress';
    case 'Pending':
      return 'Waiting';
    case 'Rejected':
    case 'Cancelled':
      return 'Failed';
    default:
      return 'Waiting';
  }
}

/** « Envoyé » est acquis dès que la commande est partie, même si l'assureur n'a pas répondu. */
function sentState(status: string | null | undefined): TrackingState {
  if (status === 'Sent' || status === 'Succeeded') return 'Done';
  return stateOf(status);
}

function failureDetail(command: IntegrationCommandListItem | undefined): string | null {
  if (!command) return null;
  if (command.status !== 'Rejected' && command.status !== 'Cancelled') return null;
  // `errorCode` et `errorDetail` restent sur l'écran Commandes : au guichet, ils ne
  // disent rien à l'agent et l'empêchent de voir ce qu'il peut faire.
  return errorFamilyMessage(command.errorFamily);
}
