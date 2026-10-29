import { Component, inject, OnInit, signal } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { WebhookEventTypeDto, WebhooksApiService } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SIGNATURE_SNIPPET } from './webhook-labels';

/**
 * Ce qu’un intégrateur doit savoir pour recevoir les webhooks : la forme d’un envoi, ses
 * en-têtes, la vérification de la signature, les garanties, et chaque événement avec son exemple
 * — tiré du serveur, donc toujours celui qui part vraiment.
 */
@Component({
  templateUrl: './webhooks-documentation-page.html',
  imports: [TasCard, TasIcon, TasTable],
})
export class WebhooksDocumentationPage implements OnInit {
  private readonly _api = inject(WebhooksApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly isLoading = signal(true);
  public readonly eventTypes = signal<WebhookEventTypeDto[]>([]);
  public readonly expanded = signal<string | null>(null);
  public readonly snippet = SIGNATURE_SNIPPET;

  public readonly tableConfig = signal<TableConfig>({
    property: 'code',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [50], totalElements: 0 },
  });

  ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Webhooks', link: ['/settings/webhooks'] },
      { label: 'Documentation' },
    ]);

    this._api.listWebhookEventTypes().pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger les événements.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((types) => {
      this.eventTypes.set(types ?? []);
      this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, totalElements: (types ?? []).length } }));
      this.isLoading.set(false);
    });
  }

  public toggle(code: string | null | undefined): void {
    this.expanded.update((current) => (current === code ? null : code ?? null));
  }

  public pretty(json: string | null | undefined): string {
    if (!json) return '';
    try {
      return JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      return json;
    }
  }

  public copy(text: string): void {
    navigator.clipboard.writeText(text).then(() => this._snackbar.success('Copié', 'Le code a été copié.'));
  }
}

export default WebhooksDocumentationPage;
