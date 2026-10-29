import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { WebhooksApiService, WebhookSubscriptionDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { WebhookDrawer, WebhookDrawerData } from './webhook-drawer';
import { failureLabel, webhookState } from './webhook-labels';

/**
 * Les webhooks sortants : les adresses de partenaires prévenues des événements leads, projets et
 * clients. Les webhooks ENTRANTS (un partenaire qui pousse des leads) sont des sources de leads,
 * et vivent dans Formulaires & sources.
 */
@Component({
  templateUrl: './webhooks-page.html',
  imports: [Anchor, Button, RouterLink, TasIcon, TasTable, TasTag, TimeagoPipe],
})
export class WebhooksPage implements OnInit {
  private readonly _api = inject(WebhooksApiService);
  private readonly _drawer = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManage = this._permissions.can('Integration.Webhook.Manage');

  public readonly isLoading = signal(false);
  public readonly subscriptions = signal<WebhookSubscriptionDto[]>([]);

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50], totalElements: 0 },
  });

  public readonly state = webhookState;
  public readonly failureLabel = failureLabel;

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Webhooks' },
    ]);
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this._api.listWebhookSubscriptions().pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger les webhooks.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((items) => {
      this.subscriptions.set(items ?? []);
      this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: (items ?? []).length } }));
      this.isLoading.set(false);
    });
  }

  public create(): void {
    const ref = this._drawer.open<string | null, WebhookDrawerData, WebhookDrawer>(WebhookDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: {},
    });
    ref.closed.subscribe((id) => {
      if (id) this._router.navigate(['/settings/webhooks', id]);
    });
  }

  public open(item: WebhookSubscriptionDto): void {
    this._router.navigate(['/settings/webhooks', item.id]);
  }
}

export default WebhooksPage;
