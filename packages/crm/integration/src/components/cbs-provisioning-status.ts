import { NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { EMPTY, catchError } from 'rxjs';
import {
  CbsProvisioningService,
  CbsProvisioningStatus,
  cbsBatchDelayLabel,
  cbsProvisioningMeta,
} from '../data-access/cbs-provisioning.service';

/** Carte dans le dossier KYC, ligne d'en-tête dans le bloc Core banking. */
export type CbsProvisioningAppearance = 'card' | 'inline';

/** Période de sondage et échéance, selon le patron du repo (import-clients). */
const POLL_PERIOD_MS = 5_000;
const POLL_DEADLINE_MS = 120_000;

/**
 * Où en est la création du client dans le core banking — INT-19, réutilisé par INT-23.
 *
 * Composant autonome : il ne dépend ni du module KYC ni du module Clients, il reçoit un
 * identifiant de client et lit tout le reste lui-même.
 *
 * **Aucun détail technique n'est affiché ici** — ni code d'erreur, ni famille d'erreur brute,
 * ni identifiant de commande. Le critère d'acceptation d'INT-19 les réserve à l'écran
 * Commandes : un agent doit savoir si son client peut opérer et qui appeler sinon, pas lire une
 * trace. `businessMessage` est déjà la phrase métier ; ne l'« enrichis » pas.
 */
@Component({
  selector: 'cbs-provisioning-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, TasCard, TasIcon, TasSpinner, TasTag, Button],
  template: `
    @if (appearance() === 'card') {
      <tas-card class="block">
        <div class="p-4">
          <p class="mb-2 text-sm font-medium text-slate-800">Création dans le système bancaire</p>
          <ng-container *ngTemplateOutlet="content"></ng-container>
        </div>
      </tas-card>
    } @else {
      <ng-container *ngTemplateOutlet="content"></ng-container>
    }

    <ng-template #content>
      @if (isLoading() && !status()) {
        <div class="flex items-center gap-2 text-sm text-slate-500">
          <tas-spinner size="4" class="text-primary"></tas-spinner>
          Lecture de l'état de création...
        </div>
      } @else if (showLoadError()) {
        <p class="text-sm text-slate-500">{{ loadError() }}</p>
      } @else if (status(); as s) {
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <tas-tag [severity]="meta().severity">{{ meta().label }}</tas-tag>
          <span class="text-sm text-slate-600">{{ description() }}</span>
        </div>

        @if (loadError()) {
          <!-- Un sondage en échec n'efface pas l'état déjà connu : il dit qu'il a vieilli. -->
          <p class="mt-1 text-xs text-slate-400">{{ loadError() }}</p>
        }

        @if (s.externalCustomerNumber || s.externalAccountNumber) {
          <div class="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            @if (s.externalCustomerNumber) {
              <span class="text-xs text-slate-400">
                Numéro client
                <span class="ml-1 font-mono text-xs text-slate-700">{{
                  s.externalCustomerNumber
                }}</span>
              </span>
            }
            @if (s.externalAccountNumber) {
              <span class="text-xs text-slate-400">
                Numéro de compte
                <span class="ml-1 font-mono text-xs text-slate-700">{{
                  s.externalAccountNumber
                }}</span>
              </span>
            }
          </div>
        }

        @if (s.businessMessage) {
          <div class="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <tas-icon
              iconName="feather:x-circle"
              class="mt-0.5 shrink-0 text-functional-error"
              style="font-size:14px"
            ></tas-icon>
            <p class="max-w-prose text-sm text-red-800">{{ s.businessMessage }}</p>
          </div>
        }

        @if (trackingStopped()) {
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <p class="text-xs text-slate-500">
              Suivi suspendu. La création se poursuit dans le système bancaire.
            </p>
            <button tas-text-button color="primary" type="button" (click)="resumeTracking()">
              Relancer le suivi
            </button>
          </div>
        }
      }
    </ng-template>
  `,
})
export class CbsProvisioningStatusComponent implements OnDestroy {
  private readonly _service = inject(CbsProvisioningService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly customerId = input.required<string>();
  public readonly appearance = input<CbsProvisioningAppearance>('card');

  public readonly status = signal<CbsProvisioningStatus | null>(null);
  public readonly isLoading = signal(true);
  /** Panne de lecture : dite sans alarme, jamais en remplacement de l'état connu. */
  public readonly loadError = signal<string | null>(null);
  public readonly trackingStopped = signal(false);
  public readonly batchDelayMinutes = signal<number | null>(null);

  public readonly meta = computed(() => cbsProvisioningMeta(this.status()?.state ?? 'NotRequested'));

  /** Une panne ne remplace l'état que si aucun état n'a encore été lu. */
  public readonly showLoadError = computed(() => !!this.loadError() && !this.status());

  public readonly description = computed(() => {
    const status = this.status();
    if (!status) return '';
    // Pas de connexion core banking active : l'intégration n'est pas configurée. Dire
    // « aucune création demandée » laisserait croire qu'il suffit d'attendre.
    if (!status.connectionId) {
      return "L'intégration au système bancaire n'est pas configurée pour votre institution.";
    }
    const base = this.meta().description;
    if (status.state !== 'Batched') return base;
    return `${base} Envoi prévu ${cbsBatchDelayLabel(this.batchDelayMinutes())}.`;
  });

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollDeadline: ReturnType<typeof setTimeout> | null = null;

  /** La carte est montée une fois dans un écran qui change de client sans être détruit. */
  private readonly _reload = effect(() => {
    const customerId = this.customerId();
    this._stopPolling();
    this.trackingStopped.set(false);
    this.batchDelayMinutes.set(null);
    this.status.set(null);
    if (customerId) this._load(customerId, true);
  });

  public resumeTracking(): void {
    this.trackingStopped.set(false);
    this._load(this.customerId(), true);
  }

  public ngOnDestroy(): void {
    this._stopPolling();
  }

  private _load(customerId: string, showSpinner: boolean): void {
    if (showSpinner) this.isLoading.set(true);
    this.loadError.set(null);

    this._service
      .getStatus(customerId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          // Un 404 ne devient pas vrai en insistant : on arrête le sondage. Les autres pannes
          // sont dites sans bloquer l'écran — le dossier KYC reste utilisable sans cet état.
          if (error?.status === 404) this._stopPolling();
          this.loadError.set(
            "L'état de la création dans le système bancaire n'a pas pu être lu. Réessayez dans un instant.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((status) => {
        this.status.set(status);
        this.isLoading.set(false);

        if (status.state === 'Batched' && status.connectionId && this.batchDelayMinutes() === null) {
          this._loadBatchDelay(status.connectionId);
        }

        // Sonder un état terminal est du trafic pur : `isTransient` est la seule condition.
        if (status.isTransient) this._startPolling(customerId);
        else this._stopPolling();
      });
  }

  private _loadBatchDelay(connectionId: string): void {
    this._service
      .getCustomerSyncIntervalMinutes(connectionId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe((minutes) => this.batchDelayMinutes.set(minutes));
  }

  private _startPolling(customerId: string): void {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this._load(customerId, false), POLL_PERIOD_MS);
    // Au bout de deux minutes on le dit et on laisse relancer, plutôt que de laisser l'agent
    // devant un état qui semble vivant alors que plus rien ne l'actualise.
    this._pollDeadline = setTimeout(() => {
      if (!this._pollTimer) return;
      this._stopPolling();
      this.trackingStopped.set(true);
    }, POLL_DEADLINE_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._pollDeadline) clearTimeout(this._pollDeadline);
    this._pollTimer = null;
    this._pollDeadline = null;
  }
}

/**
 * Préavis « ce système bancaire ne crée les clients qu'en lot » — INT-19.
 *
 * Le critère demande que l'écran l'annonce **avant** la validation : il ne dépend donc d'aucune
 * commande ni d'aucun dossier validé, la connexion active en mode `Batch` suffit à le savoir.
 * Ne rend rien du tout quand la connexion répond en direct, pour qu'un écran hôte puisse
 * l'insérer sans condition.
 */
@Component({
  selector: 'cbs-batch-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon],
  template: `
    @if (isBatchOnly()) {
      <tas-card class="block">
        <div class="flex gap-3 p-4">
          <tas-icon
            iconName="feather:clock"
            class="mt-0.5 shrink-0 text-amber-500"
            style="font-size:16px"
          ></tas-icon>
          <div class="min-w-0">
            <p class="text-sm font-medium text-slate-800">
              Ce système bancaire crée les clients par envoi de fichiers
            </p>
            <p class="mt-1 max-w-prose text-xs text-slate-500">
              Après la validation, la création ne part pas immédiatement : elle est regroupée avec
              les autres et transmise {{ delayLabel() }}. Le client ne pourra pas opérer avant.
            </p>
          </div>
        </div>
      </tas-card>
    }
  `,
})
export class CbsBatchNoticeComponent {
  private readonly _service = inject(CbsProvisioningService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly isBatchOnly = signal(false);
  public readonly delayMinutes = signal<number | null>(null);

  public readonly delayLabel = computed(() => cbsBatchDelayLabel(this.delayMinutes()));

  /**
   * Le préavis ne dépend d'aucune entrée : il porte sur la connexion du tenant, pas sur un
   * client. Il est donc lu une fois, à la construction, sans `effect()` — un effet sans
   * dépendance laisse croire qu'il se rejouera.
   */
  private readonly _notice = this._service
    .getBatchNotice()
    .pipe(
      // Information de confort : une panne de lecture le fait disparaître, elle n'affiche pas
      // d'erreur au-dessus d'un dossier à valider.
      catchError(() => EMPTY),
      takeUntilDestroyed(this._destroyRef),
    )
    .subscribe((notice) => {
      this.isBatchOnly.set(notice.isBatchOnly);
      this.delayMinutes.set(notice.delayMinutes);
    });
}
