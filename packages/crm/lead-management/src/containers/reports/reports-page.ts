import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, EMPTY, finalize, Subject, switchMap } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { AgenciesApiService, AgentComparisonDto, LeadReportDto, LeadReportsApiService } from '@sankore/crm-api';
import { BreadcrumbService, projectFlowLabel } from '@sankore/crm/common';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ReportLineChart, LinePoint, LineSeries } from './report-line-chart';
import { BarItem, ReportBarList } from './report-bar-list';
import { AgentReportPanel, periodLabels } from './agent-report-panel';
import { AgentRankingPanel } from './agent-ranking-panel';
import { RankingCriterion } from './agent-ranking';
import {
  formatDuration,
  formatNumber,
  formatPercent,
  label,
  PROJECT_PHASE_LABELS,
  SERIES_COLORS,
  SOURCE_LABELS,
  STAGE_LABELS,
  STATUS_LABELS,
} from './report-labels';

type PeriodKey = '7j' | '30j' | '90j' | '12m';

const PERIODS: ReadonlyArray<{ key: PeriodKey; label: string; days: number }> = [
  { key: '7j', label: '7 jours', days: 7 },
  { key: '30j', label: '30 jours', days: 30 },
  { key: '90j', label: '90 jours', days: 90 },
  { key: '12m', label: '12 mois', days: 365 },
];

interface Kpi {
  label: string;
  value: string;
  hint: string;
  tone?: 'warn';
}

/**
 * Rapports des leads pour les administrateurs : volumes, conversions, progression dans le pipeline,
 * sources, agents et agences, sur une période et pour une agence au choix.
 *
 * Tout vient de `GET leads/reports/overview` en un appel, si bien que les chiffres de l'écran se
 * recoupent : ils partagent la même période et les mêmes définitions, écrites une fois côté
 * serveur (`LeadReportDtos.cs`).
 */
@Component({
  templateUrl: './reports-page.html',
  imports: [FormsModule, Button, TasIcon, TasSelect, TasSpinner, TasTable, ReportLineChart, ReportBarList, AgentReportPanel, AgentRankingPanel],
})
export class ReportsPage implements OnInit {
  private readonly _reports = inject(LeadReportsApiService);
  private readonly _agencies = inject(AgenciesApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _reload$ = new Subject<void>();
  private readonly _agentReload$ = new Subject<void>();

  public readonly periods = PERIODS;
  public readonly colors = SERIES_COLORS;
  public readonly fmt = formatNumber;
  public readonly pct = formatPercent;
  public readonly duration = formatDuration;

  public period = signal<PeriodKey>('30j');
  public agencyId = signal('');
  public agencyOptions = signal<{ label: string; value: string }[]>([{ label: 'Toutes les agences', value: '' }]);

  public report = signal<LeadReportDto | null>(null);
  public isLoading = signal(true);
  public error = signal<string | null>(null);
  public isExporting = signal(false);

  /** Fiche agent : l'agent affiché et, pour comparer, un second. Gardés dans l'URL. */
  /** Critère du classement, gardé dans l'URL (`classement`). */
  public rankingCriterion = signal<RankingCriterion>('score');

  public agentA = signal('');
  public agentB = signal('');
  public agentReport = signal<AgentComparisonDto | null>(null);
  public isAgentLoading = signal(false);
  public agentError = signal<string | null>(null);

  /** Les agents proposés sont ceux du rapport : ceux qui ont eu de l'activité sur la période. */
  public readonly agentOptions = computed(() => [
    { label: 'Choisir un agent', value: '' },
    ...(this.report()?.agents ?? []).map((a) => ({ label: a.name ?? '—', value: a.agentId ?? '' })),
  ]);

  public readonly agentTableConfig = signal<TableConfig>({
    property: 'agentId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50] },
  });

  public readonly kpis = computed<Kpi[]>(() => {
    const k = this.report()?.kpis;
    if (!k) return [];
    return [
      { label: 'Leads captés', value: formatNumber(k.captured), hint: 'Arrivés sur la période' },
      { label: 'Conversions', value: formatNumber(k.convertedInPeriod), hint: 'Réalisées sur la période' },
      { label: 'Taux de conversion', value: formatPercent(k.cohortConversionRate), hint: 'Des leads captés sur la période' },
      { label: 'Leads ouverts', value: formatNumber(k.openLeads), hint: 'Aujourd’hui, toutes dates' },
      { label: 'Premier contact', value: formatDuration(k.avgFirstContactMinutes), hint: 'Délai moyen après affectation' },
      { label: 'Délai respecté', value: formatPercent(k.slaComplianceRate), hint: 'Premiers contacts dans le délai' },
      {
        label: 'Délais dépassés',
        value: formatNumber(k.openSlaBreaches),
        hint: 'Leads en attente de contact',
        tone: (k.openSlaBreaches ?? 0) > 0 ? 'warn' : undefined,
      },
    ];
  });

  public readonly lineSeries: LineSeries[] = [
    { name: 'Captés', color: SERIES_COLORS.captured },
    { name: 'Convertis', color: SERIES_COLORS.converted },
  ];

  public readonly linePoints = computed<LinePoint[]>(() => {
    const r = this.report();
    if (!r) return [];
    return (r.series ?? []).map((p) => {
      const d = new Date(p.periodStart ?? 0);
      return { ...periodLabels(d, r.granularity ?? 'Day'), values: [p.captured ?? 0, p.converted ?? 0] };
    });
  });

  /** Les étapes sans lead sont gardées : un trou dans la progression est une information. */
  public readonly progression = computed<BarItem[]>(() => {
    const r = this.report();
    const total = r?.kpis?.captured ?? 0;
    return (r?.progression ?? []).map((s) => ({
      key: String(s.stage),
      label: label(STAGE_LABELS, s.stage),
      value: s.count ?? 0,
      note: total > 0 ? `${formatPercent(((s.count ?? 0) / total) * 100)}` : undefined,
    }));
  });

  /** Les projets ouverts sur la période, par phase aujourd'hui — la suite du parcours des leads. */
  public readonly projects = computed<BarItem[]>(() =>
    (this.report()?.projects ?? []).map((p) => ({
      key: String(p.phase),
      label: label(PROJECT_PHASE_LABELS, p.phase),
      value: p.count ?? 0,
      note: phaseAmounts(p.amounts ?? []),
    })),
  );

  /**
   * La prévision, toujours par nature de montant : un décaissement de crédit, une prime et une
   * collecte d'épargne ne s'additionnent pas.
   */
  public readonly forecastKinds = computed(() =>
    (this.report()?.forecast?.kinds ?? []).map((k) => ({ ...k, label: projectFlowLabel(k.kind) })),
  );

  /** L'échéancier : une ligne par mois, une colonne par nature présente. */
  public readonly forecastMonths = computed(() => {
    const schedule = this.report()?.forecast?.schedule ?? [];
    const months = [...new Set(schedule.map((m) => m.month ?? ''))].filter(Boolean).sort();
    return months.map((month) => ({
      month,
      label: new Date(month + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      cells: this.forecastKinds().map((k) => {
        const m = schedule.find((s) => s.month === month && s.kind === k.kind);
        return { kind: k.kind, count: m?.count ?? 0, weighted: m?.weightedAmount ?? 0 };
      }),
    }));
  });

  public readonly forecastAgencies = computed(() =>
    (this.report()?.forecast?.agencies ?? []).map((a, i) => ({
      ...a,
      key: `${a.agencyId ?? 'none'}-${a.kind}-${i}`,
      label: projectFlowLabel(a.kind),
    })),
  );

  public readonly forecastTableConfig = signal<TableConfig>({
    property: 'month',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 13, pageSizeOptions: [13] },
  });
  public readonly forecastAgencyTableConfig = signal<TableConfig>({
    property: 'key',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50] },
  });

  public readonly statuses = computed<BarItem[]>(() =>
    (this.report()?.byStatus ?? []).map((s) => ({ key: String(s.status), label: label(STATUS_LABELS, s.status), value: s.count ?? 0 })),
  );

  public readonly sources = computed<BarItem[]>(() =>
    (this.report()?.bySource ?? []).map((s) => ({
      key: String(s.source),
      label: label(SOURCE_LABELS, s.source),
      value: s.captured ?? 0,
      value2: s.converted ?? 0,
      note: `${formatPercent(s.conversionRate)} convertis`,
    })),
  );

  public readonly agencies = computed<BarItem[]>(() =>
    (this.report()?.agencies ?? []).map((a) => ({
      key: a.agencyId ?? 'none',
      label: a.name ?? '—',
      value: a.captured ?? 0,
      value2: a.converted ?? 0,
      note: `${formatPercent(a.conversionRate)} convertis`,
    })),
  );

  public readonly agents = computed(() => this.report()?.agents ?? []);

  public readonly rangeLabel = computed(() => {
    const r = this.report();
    if (!r?.from || !r?.to) return '';
    const f = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    // `to` est exclusif : le dernier jour couvert est la veille.
    return `Du ${f.format(new Date(r.from))} au ${f.format(new Date(new Date(r.to).getTime() - 1))}`;
  });

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Rapports' }]);

    const params = this._route.snapshot.queryParamMap;
    const p = params.get('periode');
    if (PERIODS.some((x) => x.key === p)) this.period.set(p as PeriodKey);
    this.agencyId.set(params.get('agence') ?? '');
    const criterion = params.get('classement');
    if (['score', 'converted', 'conversionRate', 'sla', 'firstContact'].includes(criterion ?? '')) {
      this.rankingCriterion.set(criterion as RankingCriterion);
    }
    this.agentA.set(params.get('agent') ?? '');
    this.agentB.set(this.agentA() ? (params.get('comparer') ?? '') : '');

    this._agentReload$
      .pipe(
        switchMap(() => {
          const ids = [this.agentA(), this.agentB()].filter(Boolean);
          if (ids.length === 0) {
            this.agentReport.set(null);
            return EMPTY;
          }
          this.isAgentLoading.set(true);
          this.agentError.set(null);
          const { from, to } = this._range();
          return this._reports
            .getAgentReport(ids, from.toISOString(), to.toISOString(), this.agencyId() || undefined)
            .pipe(
              catchError((err: HttpErrorResponse) => {
                this.agentError.set(err.error?.detail ?? 'La fiche de l’agent n’a pas pu être chargée.');
                return EMPTY;
              }),
              finalize(() => this.isAgentLoading.set(false)),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((r) => this.agentReport.set(r));

    this._reload$
      .pipe(
        switchMap(() => {
          this.isLoading.set(true);
          this.error.set(null);
          const { from, to } = this._range();
          return this._reports
            .getLeadReport(from.toISOString(), to.toISOString(), this.agencyId() || undefined)
            .pipe(
              catchError((err: HttpErrorResponse) => {
                this.error.set(err.status === 403
                  ? 'Ce rapport est réservé aux administrateurs.'
                  : (err.error?.detail ?? 'Le rapport n’a pas pu être chargé.'));
                return EMPTY;
              }),
              finalize(() => this.isLoading.set(false)),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((r) => this.report.set(r));

    this._agencies
      .listAgencies(false, 1, 0)
      .pipe(catchError(() => EMPTY))
      .subscribe((res) =>
        this.agencyOptions.set([
          { label: 'Toutes les agences', value: '' },
          ...(res.items ?? []).map((a) => ({ label: a.name ?? '—', value: a.id ?? '' })),
        ]),
      );

    this.reload();
  }

  public pickPeriod(key: PeriodKey): void {
    this.period.set(key);
    this._persist();
  }

  public pickAgency(id: string | null): void {
    this.agencyId.set(id ?? '');
    this._persist();
  }

  public reload(): void {
    this._reload$.next();
    this._agentReload$.next();
  }

  public pickCriterion(criterion: RankingCriterion): void {
    this.rankingCriterion.set(criterion);
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { classement: criterion === 'score' ? null : criterion },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public pickAgentA(id: string): void {
    this.agentA.set(id);
    if (!id || this.agentB() === id) this.agentB.set('');
    this._persistAgents();
  }

  public pickAgentB(id: string): void {
    this.agentB.set(id && id !== this.agentA() ? id : '');
    this._persistAgents();
  }

  /** « Voir » sur une ligne : cet agent devient la fiche affichée, et la comparaison s'arrête. */
  public showAgent(id: string): void {
    this.agentA.set(id);
    this.agentB.set('');
    this._persistAgents();
    this._scrollToPanel();
  }

  /** « Comparer » sur une ligne : ajouté face à l'agent affiché, ou affiché s'il n'y en a pas. */
  public compareAgent(id: string): void {
    if (!this.agentA() || this.agentA() === id) {
      this.showAgent(id);
      return;
    }
    this.agentB.set(id);
    this._persistAgents();
    this._scrollToPanel();
  }

  private _persistAgents(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { agent: this.agentA() || null, comparer: this.agentB() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this._agentReload$.next();
  }

  private _scrollToPanel(): void {
    setTimeout(() => document.getElementById('agent-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  /**
   * Le classeur est produit par le serveur à partir du même calcul que l'écran : l'export ne
   * peut pas contredire ce qui est affiché. La période est recalculée au clic, comme pour un
   * rechargement, donc « 30 jours » veut dire les 30 jours jusqu'à maintenant.
   */
  public exportExcel(): void {
    if (this.isExporting()) return;
    this.isExporting.set(true);
    const { from, to } = this._range();
    this._reports
      .exportLeadReport(from.toISOString(), to.toISOString(), this.agencyId() || undefined)
      .pipe(
        catchError(async (err: HttpErrorResponse) => {
          // En mode blob, le corps d'erreur arrive lui aussi en Blob : on le relit pour afficher
          // le message du serveur (période trop longue, droits) plutôt qu'une erreur générique.
          let detail: string | undefined;
          if (err.error instanceof Blob) {
            try { detail = JSON.parse(await err.error.text())?.detail; } catch { /* corps non JSON */ }
          }
          this._snackbar.error('Export impossible', detail ?? 'Le fichier Excel n’a pas pu être généré.');
          return null;
        }),
        finalize(() => this.isExporting.set(false)),
      )
      .subscribe((file) => {
        // Typé `string` par le client généré (le contrat décrit des octets), mais la réponse est
        // négociée en `blob` : c'est bien un Blob qui arrive.
        const blob = file as unknown as Blob | null;
        if (!blob) return;
        const day = (d: Date) => d.toISOString().slice(0, 10);
        this._download(blob, `rapport-leads-${day(from)}-au-${day(new Date(to.getTime() - 1))}.xlsx`);
      });
  }

  /** Ancre insérée dans le document : hors Chrome, un clic sur une ancre détachée est ignoré. */
  private _download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private _range(): { from: Date; to: Date } {
    const days = PERIODS.find((x) => x.key === this.period())!.days;
    const to = new Date();
    return { from: new Date(to.getTime() - days * 86_400_000), to };
  }

  public slaWidth(rate: number | null | undefined): number {
    return Math.max(0, Math.min(100, rate ?? 0));
  }

  private _persist(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { periode: this.period(), agence: this.agencyId() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    this.reload();
  }
}

export default ReportsPage;

/** Le montant d'une phase, par nature : « 5 000 000 », ou « Décaissements (crédit) : … · Collecte… : … ». */
function phaseAmounts(amounts: { kind?: string; amount?: number }[]): string | undefined {
  const present = amounts.filter((a) => a.amount);
  if (present.length === 0) return undefined;
  if (present.length === 1 && present[0].kind === 'Generic') return formatNumber(present[0].amount!);
  return present.map((a) => `${projectFlowLabel(a.kind)} : ${formatNumber(a.amount!)}`).join(' · ');
}
