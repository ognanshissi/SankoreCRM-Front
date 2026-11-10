import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, EMPTY, finalize, Subject, switchMap } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { ClientReportDto, ClientReportsApiService } from '@sankore/crm-api';
import { BarItem, ReportBarList } from './report-bar-list';
import { Kpi, relativeDelta, ReportKpiTiles } from './report-kpi';
import { ReportRange } from './report-projects-tab';
import { formatNumber, SERIES_COLORS } from './report-labels';
import { TenantKycService } from '@sankore/crm/common';

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const days = (n: number | null | undefined) => (n == null ? '—' : `${decimal.format(n)} j`);

/**
 * L'onglet « Clients » des rapports (lot 3, 2026-11-02) : nouveaux clients, base active, conseillers,
 * équipement, réclamations, risque, et la répartition par type, segment et agence. Des agrégats
 * seulement : aucun client n'y est nommé. Tout vient de `GET clients/reports` en un appel.
 */
@Component({
  selector: 'report-clients-tab',
  templateUrl: './report-clients-tab.html',
  imports: [Button, TasSpinner, ReportBarList, ReportKpiTiles],
})
export class ReportClientsTab {
  private readonly _reports = inject(ClientReportsApiService);
  /** KYC désactivé pour l'institution : plus de clients « en attente de KYC » (docs/kyc-par-institution.md). */
  public readonly kycInForce = inject(TenantKycService).inForce;
  private readonly _baseHint = computed(() => (this.kycInForce() ? 'Actifs ou en attente de KYC' : 'Clients actifs'));
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _load$ = new Subject<ReportRange>();

  public readonly range = input.required<ReportRange>();

  public readonly report = signal<ClientReportDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly error = signal<string | null>(null);
  public readonly colors = SERIES_COLORS;

  public readonly kpis = computed<Kpi[]>(() => {
    const r = this.report();
    if (!r?.kpis?.period) return [];
    const k = r.kpis;
    const period = r.kpis.period;
    const p = r.previous;
    return [
      { label: 'Nouveaux clients', value: formatNumber(period.newClients), hint: 'Créés sur la période',
        delta: relativeDelta(period.newClients, p?.newClients, 'up', formatNumber) },
      { label: 'Clients actifs', value: formatNumber(k.active), hint: 'Aujourd’hui' },
      {
        label: 'Sans conseiller',
        value: formatNumber(k.withoutAdvisor),
        hint: this._baseHint(),
        tone: (k.withoutAdvisor ?? 0) > 0 ? 'warn' : undefined,
      },
      { label: 'Produits par client', value: k.avgProductsPerClient == null ? '—' : decimal.format(k.avgProductsPerClient),
        hint: 'Contrats actifs ÷ clients actifs' },
      { label: 'Réclamations reçues', value: formatNumber(period.complaintsReceived), hint: 'Sur la période',
        delta: relativeDelta(period.complaintsReceived, p?.complaintsReceived, 'down', formatNumber) },
      { label: 'Délai de traitement', value: days(period.avgResolutionDays), hint: 'De la réception à la réponse',
        delta: relativeDelta(period.avgResolutionDays, p?.avgResolutionDays, 'down', days) },
      {
        label: 'Réclamations en retard',
        value: formatNumber(k.overdueComplaints),
        hint: `${formatNumber(k.openComplaints)} ouverte${(k.openComplaints ?? 0) > 1 ? 's' : ''} aujourd’hui`,
        tone: (k.overdueComplaints ?? 0) > 0 ? 'warn' : undefined,
      },
      { label: 'Risque élevé', value: formatNumber(k.highRisk), hint: this._baseHint() },
      { label: 'PPE', value: formatNumber(k.pep), hint: 'Exposés politiquement' },
      { label: 'Suspendus ou archivés', value: formatNumber(period.suspendedOrArchived), hint: 'Sur la période',
        delta: relativeDelta(period.suspendedOrArchived, p?.suspendedOrArchived, 'down', formatNumber) },
    ];
  });

  public readonly byType = computed<BarItem[]>(() =>
    (this.report()?.byType ?? []).map((t) => ({
      key: String(t.type),
      label: t.type === 'Legal' ? 'Personnes morales' : 'Personnes physiques',
      value: t.base ?? 0,
      value2: t.newClients ?? 0,
    })),
  );

  public readonly bySegment = computed<BarItem[]>(() =>
    (this.report()?.bySegment ?? []).map((s) => ({
      key: s.segmentCode ?? 'none',
      label: s.segmentCode ?? 'Non segmenté',
      value: s.count ?? 0,
    })),
  );

  public readonly byAgency = computed<BarItem[]>(() =>
    (this.report()?.byAgency ?? []).map((a) => ({
      key: a.agencyId ?? a.name ?? '',
      label: a.name ?? '—',
      value: a.active ?? 0,
      value2: a.newClients ?? 0,
    })),
  );

  constructor() {
    this._load$
      .pipe(
        switchMap((range) => {
          this.isLoading.set(true);
          this.error.set(null);
          return this._reports
            .getClientReport(range.from.toISOString(), range.to.toISOString(), range.agencyId || undefined)
            .pipe(
              catchError((err: HttpErrorResponse) => {
                this.error.set(err.error?.detail ?? 'Le rapport des clients n’a pas pu être chargé.');
                return EMPTY;
              }),
              finalize(() => this.isLoading.set(false)),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((r) => this.report.set(r));

    effect(() => this._load$.next(this.range()));
  }

  public reload(): void {
    this._load$.next(this.range());
  }
}
