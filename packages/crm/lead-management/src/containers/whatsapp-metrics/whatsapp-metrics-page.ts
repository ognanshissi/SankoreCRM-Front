import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { WhatsAppApiService, WhatsAppMetricsDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';

const PERIODS = [
  { label: '7 derniers jours', value: '7' },
  { label: '30 derniers jours', value: '30' },
  { label: '90 derniers jours', value: '90' },
  { label: '12 derniers mois', value: '365' },
];

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilitaire',
  AUTHENTICATION: 'Authentification',
  SERVICE: 'Réponses libres (fenêtre de 24 h)',
  UNKNOWN: 'Catégorie inconnue',
};

/**
 * Les indicateurs WhatsApp (WA-BE-22), sur le périmètre de celui qui supervise : réponse aux
 * templates, escalades, délai de prise en charge, conversations résolues par le bot, coût estimé.
 *
 * Le coût n'est estimé que pour les catégories dont l'institution a saisi le tarif (réglage
 * « whatsapp-template-unit-prices » des paramètres des leads) : un total partiel serait lu comme
 * complet, le serveur ne le donne donc que si toutes les catégories utilisées ont un prix.
 */
@Component({
  selector: 'whatsapp-metrics-page',
  templateUrl: './whatsapp-metrics-page.html',
  imports: [DatePipe, DecimalPipe, PercentPipe, FormsModule, RouterLink, Anchor, Button, TasCard, TasIcon, TasSelect, TasSpinner, TasTable],
})
export class WhatsAppMetricsPage implements OnInit {
  private readonly _api = inject(WhatsAppApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly periods = PERIODS;
  public readonly period = signal('30');
  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly metrics = signal<WhatsAppMetricsDto | null>(null);

  public readonly reasons = computed(() => this.metrics()?.escalationsByReason ?? []);
  public readonly costs = computed(() => this.metrics()?.costByCategory ?? []);
  public readonly missingPrices = computed(() => this.costs().some((c) => c.unitPrice == null));

  public readonly reasonsConfig = signal<TableConfig>({
    property: 'reason',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10] },
  });

  public readonly costsConfig = signal<TableConfig>({
    property: 'category',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10] },
  });

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Leads', link: ['/leads'] },
      { label: 'WhatsApp', link: ['/leads/whatsapp'] },
      { label: 'Indicateurs' },
    ]);

    const days = this._route.snapshot.queryParamMap.get('periode');
    if (days && PERIODS.some((p) => p.value === days)) this.period.set(days);

    this.reload();
  }

  public setPeriod(value: string): void {
    this.period.set(value || '30');
    this._router.navigate([], { relativeTo: this._route, replaceUrl: true, queryParams: { periode: this.period() === '30' ? null : this.period() } });
    this.reload();
  }

  public reload(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    const to = new Date();
    const from = new Date(to.getTime() - Number(this.period()) * 86_400_000);

    this._api.getWhatsAppMetrics(from.toISOString(), to.toISOString()).pipe(
      catchError(() => {
        this.loadError.set('Les indicateurs n’ont pas pu être calculés.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((metrics) => {
      this.metrics.set(metrics);
      this.isLoading.set(false);
    });
  }

  public categoryLabel(category: string | null | undefined): string {
    return CATEGORY_LABELS[category ?? ''] ?? category ?? '—';
  }
}

export default WhatsAppMetricsPage;
