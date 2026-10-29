import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { catchError, EMPTY } from 'rxjs';
import { WebhookDeliveryDetailDto, WebhooksApiService } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTag } from '@talisoft/ui/tag';
import { TasTitle } from '@talisoft/ui/title';
import { deliveryState, failureLabel, webhookErrorMessage } from './webhook-labels';

export interface WebhookDeliveryDrawerData {
  subscriptionId: string;
  deliveryId: string;
  eventLabel: string;
  canReplay: boolean;
}

/** Une livraison : ce qui a été envoyé, mot pour mot, et comment le partenaire a répondu. */
@Component({
  selector: 'webhook-delivery-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, DatePipe, TasIcon, TasSpinner, TasTag, TasTitle, TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <tas-title>{{ data.eventLabel }}</tas-title>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (detail(); as d) {
          <div class="flex flex-col gap-4">
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p class="text-xs text-slate-400">Statut</p>
                <tas-tag [severity]="state()!.severity">{{ state()!.label }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-400">Essais</p>
                <p class="tabular-nums text-slate-700">{{ d.delivery?.attempts }} / {{ d.delivery?.maxAttempts }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400">Créée</p>
                <p class="text-slate-700">{{ d.delivery?.createdAt | date: 'dd/MM/yyyy HH:mm:ss' }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400">{{ d.delivery?.deliveredAt ? 'Livrée' : 'Dernière tentative' }}</p>
                <p class="text-slate-700">{{ (d.delivery?.deliveredAt ?? d.delivery?.lastAttemptAt) | date: 'dd/MM/yyyy HH:mm:ss' }}</p>
              </div>
              <div class="col-span-2">
                <p class="text-xs text-slate-400">Réponse</p>
                <p class="text-slate-700">
                  @if (d.delivery?.lastFailureCode) {
                    <span class="text-functional-error">{{ failureLabel(d.delivery.lastFailureCode) }}</span>
                  } @else if (d.delivery?.lastStatusCode) {
                    HTTP {{ d.delivery.lastStatusCode }} en {{ d.delivery.lastDurationMs }} ms
                  } @else {
                    —
                  }
                </p>
              </div>
              <div class="col-span-2">
                <p class="text-xs text-slate-400">Identifiants</p>
                <p class="font-mono text-xs text-slate-600">événement {{ d.delivery?.eventId }}</p>
                <p class="font-mono text-xs text-slate-600">livraison {{ d.delivery?.id }}</p>
              </div>
            </div>

            <div>
              <p class="mb-1 text-xs font-medium text-slate-600">Corps envoyé</p>
              @if (prettyBody()) {
                <pre class="max-h-[28rem] overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100">{{ prettyBody() }}</pre>
              } @else {
                <p class="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  Effacé : la personne concernée a demandé la suppression de ses données.
                </p>
              }
            </div>
          </div>
        } @else {
          <div class="flex justify-center py-12"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <div class="flex w-full justify-end gap-2">
          <button tas-outlined-button type="button" (click)="close(false)">Fermer</button>
          @if (canReplay()) {
            <button tas-raised-button color="primary" type="button" [disabled]="isReplaying()" [isLoading]="isReplaying()" (click)="replay()">
              <tas-icon iconName="feather:rotate-cw" style="font-size:13px"></tas-icon>
              Renvoyer
            </button>
          }
        </div>
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class WebhookDeliveryDrawer implements OnInit {
  public readonly data: WebhookDeliveryDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _api = inject(WebhooksApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly detail = signal<WebhookDeliveryDetailDto | null>(null);
  public readonly isReplaying = signal(false);
  public readonly failureLabel = failureLabel;

  public readonly state = computed(() => {
    const d = this.detail()?.delivery;
    return d ? deliveryState(d) : null;
  });

  public readonly prettyBody = computed(() => {
    const body = this.detail()?.body;
    if (!body) return '';
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body;
    }
  });

  /** Une livraison en attente part toute seule ; une livraison effacée ne repart pas. */
  public readonly canReplay = computed(() =>
    this.data.canReplay && !!this.detail()?.body && this.detail()?.delivery?.status !== 'Pending');

  ngOnInit(): void {
    this._api.getWebhookDelivery(this.data.subscriptionId, this.data.deliveryId).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Erreur', webhookErrorMessage(err, 'Cette livraison est introuvable.'));
        this.close(false);
        return EMPTY;
      }),
    ).subscribe((detail) => this.detail.set(detail));
  }

  public replay(): void {
    this.isReplaying.set(true);
    this._api.replayWebhookDelivery(this.data.subscriptionId, this.data.deliveryId).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Erreur', webhookErrorMessage(err, 'La livraison n’a pas pu être renvoyée.'));
        this.isReplaying.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Renvoi programmé', 'La livraison repart maintenant, avec le même identifiant d’événement.');
      this.close(true);
    });
  }

  public close(replayed: boolean): void {
    this._dialogRef.close(replayed);
  }
}
