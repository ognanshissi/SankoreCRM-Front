import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, forkJoin } from 'rxjs';
import {
  WebhookDeliveryDto,
  WebhookEventTypeDto,
  WebhooksApiService,
  WebhookSubscriptionDto,
  WebhookTestResultDto,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { WebhookDeliveryDrawer, WebhookDeliveryDrawerData } from './webhook-delivery-drawer';
import { WebhookDrawer, WebhookDrawerData } from './webhook-drawer';
import { DELIVERY_STATUS_OPTIONS, deliveryState, failureLabel, webhookErrorMessage, webhookState } from './webhook-labels';

/**
 * Un webhook sortant : ses événements, son secret de signature, un envoi de test, et le journal
 * de ses livraisons. Le secret n’est affiché qu’à sa génération, jamais relu.
 */
@Component({
  templateUrl: './webhook-detail-page.html',
  imports: [
    Anchor, Button, DatePipe, FormsModule, RouterLink, TasCard, TasIcon, TasSelect, TasSpinner, TasTable, TasTag, TimeagoPipe,
  ],
})
export class WebhookDetailPage implements OnInit {
  /** Lu sur la route (`withComponentInputBinding`). */
  public readonly id = input.required<string>();

  private readonly _api = inject(WebhooksApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManage = this._permissions.can('Integration.Webhook.Manage');

  public readonly isLoading = signal(true);
  public readonly subscription = signal<WebhookSubscriptionDto | null>(null);
  public readonly eventTypes = signal<WebhookEventTypeDto[]>([]);

  public readonly revealedSecret = signal<string | null>(null);
  public readonly isRotating = signal(false);
  public readonly isToggling = signal(false);

  public readonly testEvent = signal('');
  public readonly isTesting = signal(false);
  public readonly testResult = signal<WebhookTestResultDto | null>(null);

  public readonly deliveries = signal<WebhookDeliveryDto[]>([]);
  public readonly isLoadingDeliveries = signal(false);
  public readonly statusFilter = signal('All');
  public readonly statusOptions = DELIVERY_STATUS_OPTIONS;
  public readonly deliveriesConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: true, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50, 100], totalElements: 0 },
  });

  public readonly state = webhookState;
  public readonly deliveryState = deliveryState;
  public readonly failureLabel = failureLabel;

  /** Les événements de l’abonnement, avec leur libellé, dans l’ordre du catalogue. */
  public readonly subscribedEvents = computed(() => {
    const chosen = this.subscription()?.events ?? [];
    return this.eventTypes().filter((e) => chosen.includes(e.code!));
  });

  public readonly testOptions = computed(() =>
    this.subscribedEvents().map((e) => ({ label: e.label ?? e.code ?? '', value: e.code ?? '' })));

  ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    forkJoin({
      subscription: this._api.getWebhookSubscription(this.id()),
      types: this._api.listWebhookEventTypes(),
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Ce webhook est introuvable.');
        this._router.navigate(['/settings/webhooks']);
        return EMPTY;
      }),
    ).subscribe(({ subscription, types }) => {
      this.subscription.set(subscription);
      this.eventTypes.set(types ?? []);
      if (!this.testEvent() || !subscription.events?.includes(this.testEvent())) {
        this.testEvent.set(subscription.events?.[0] ?? '');
      }
      this.isLoading.set(false);
      this._breadcrumb.set([
        { label: 'Paramétrage', link: ['/settings'] },
        { label: 'Webhooks', link: ['/settings/webhooks'] },
        { label: subscription.name ?? 'Webhook' },
      ]);
      this.loadDeliveries();
    });
  }

  // ── Actions on the subscription ──────────────────────────────────────────────────────────

  public edit(): void {
    const ref = this._drawer.open<string | null, WebhookDrawerData, WebhookDrawer>(WebhookDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { subscription: this.subscription() },
    });
    ref.closed.subscribe((id) => {
      if (id) this.load();
    });
  }

  public toggleActive(): void {
    const s = this.subscription();
    if (!s?.id) return;
    const activate = !s.isActive;

    this.isToggling.set(true);
    this._api.setWebhookSubscriptionActive(s.id, { isActive: activate }).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Erreur', webhookErrorMessage(err, 'Le changement n’a pas pu être enregistré.'));
        this.isToggling.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isToggling.set(false);
      this._snackbar.success(
        activate ? 'Webhook réactivé' : 'Webhook désactivé',
        activate ? 'Les prochains événements lui seront envoyés.' : 'Plus rien ne lui est envoyé ; les livraisons en attente seront annulées.',
      );
      this.load();
    });
  }

  public remove(): void {
    const s = this.subscription();
    if (!s?.id) return;

    this._confirm.confirm({
      title: 'Supprimer ce webhook ?',
      message: `« ${s.name} » et tout son journal de livraisons seront supprimés. Le partenaire ne recevra plus rien.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._api.deleteWebhookSubscription(s.id!).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Erreur', webhookErrorMessage(err, 'Le webhook n’a pas pu être supprimé.'));
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Supprimé', 'Le webhook a été supprimé.');
          this._router.navigate(['/settings/webhooks']);
        });
      },
    });
  }

  public rotateSecret(): void {
    const s = this.subscription();
    if (!s?.id) return;

    this._confirm.confirm({
      title: 'Générer un nouveau secret ?',
      message:
        'L’ancien secret continuera de signer les envois pendant 7 jours, le temps que le partenaire installe le nouveau. '
        + 'Le nouveau ne sera affiché qu’une seule fois.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Générer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isRotating.set(true);
        this._api.rotateWebhookSecret(s.id!).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Erreur', webhookErrorMessage(err, 'Le secret n’a pas pu être renouvelé.'));
            this.isRotating.set(false);
            return EMPTY;
          }),
        ).subscribe((result) => {
          this.revealedSecret.set(result.secret ?? null);
          this.isRotating.set(false);
          this._snackbar.success('Nouveau secret', 'Copiez-le avant de quitter cette page.');
          this.load();
        });
      },
    });
  }

  public copy(value: string): void {
    navigator.clipboard.writeText(value).then(() =>
      this._snackbar.success('Copié', 'Le secret a été copié dans le presse-papiers.'));
  }

  public sendTest(): void {
    const s = this.subscription();
    if (!s?.id) return;

    this.isTesting.set(true);
    this.testResult.set(null);
    this._api.testWebhookSubscription(s.id, { eventCode: this.testEvent() || null }).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error('Erreur', webhookErrorMessage(err, 'Le test n’a pas pu être envoyé.'));
        this.isTesting.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      this.testResult.set(result);
      this.isTesting.set(false);
    });
  }

  // ── Delivery log ─────────────────────────────────────────────────────────────────────────

  public onStatusFilter(value: string): void {
    this.statusFilter.set(value || 'All');
    this.deliveriesConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
    this.loadDeliveries();
  }

  public onPageChange(event: PageEvent): void {
    this.deliveriesConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: event.pageIndex, pageSize: event.pageSize },
    }));
    this.loadDeliveries();
  }

  public loadDeliveries(): void {
    const { pageIndex, pageSize } = this.deliveriesConfig().pagination!;
    this.isLoadingDeliveries.set(true);
    const status = this.statusFilter() === 'All' ? undefined : this.statusFilter();
    this._api.listWebhookDeliveries(this.id(), status, pageIndex + 1, pageSize).pipe(
      catchError(() => {
        this.isLoadingDeliveries.set(false);
        return EMPTY;
      }),
    ).subscribe((page) => {
      this.deliveries.set(page.items ?? []);
      this.deliveriesConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: page.totalCount ?? 0 } }));
      this.isLoadingDeliveries.set(false);
    });
  }

  public openDelivery(delivery: WebhookDeliveryDto): void {
    const ref = this._drawer.open<boolean, WebhookDeliveryDrawerData, WebhookDeliveryDrawer>(WebhookDeliveryDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {
        subscriptionId: this.id(),
        deliveryId: delivery.id!,
        eventLabel: this.eventTypes().find((e) => e.code === delivery.eventCode)?.label ?? delivery.eventCode ?? '',
        canReplay: this.canManage() && !!this.subscription()?.isActive,
      },
    });
    ref.closed.subscribe((replayed) => {
      if (replayed) this.loadDeliveries();
    });
  }

  public eventLabel(code: string | null | undefined): string {
    return this.eventTypes().find((e) => e.code === code)?.label ?? code ?? '';
  }
}

export default WebhookDetailPage;
