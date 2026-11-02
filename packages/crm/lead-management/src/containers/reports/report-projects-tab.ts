import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, Subject, switchMap } from 'rxjs';
import { DatePipe } from '@angular/common';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { LeadReportsApiService, ProjectReportDto } from '@sankore/crm-api';
import { projectFlowLabel } from '@sankore/crm/common';
import { BarItem, ReportBarList } from './report-bar-list';
import { Kpi, pointsDelta, relativeDelta, ReportKpiTiles } from './report-kpi';
import { formatNumber, formatPercent, label, PROJECT_PHASE_LABELS, SERIES_COLORS } from './report-labels';

/** Ce que la page transmet : la période calculée au chargement, l'agence, et un compteur de rechargement. */
export interface ReportRange {
  from: Date;
  to: Date;
  agencyId: string;
  /** Change à chaque « Actualiser », pour recharger même quand la période n'a pas bougé. */
  token: number;
}

const days = (n: number | null | undefined) =>
  n == null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n)} j`;

/**
 * L'onglet « Projets » des rapports (lot 2, 2026-11-02) : ouverts, gagnés, perdus et leur variation,
 * le pipeline ouvert aujourd'hui, les produits, les motifs de perte, le temps passé par étape et les
 * projets en retard. Tout vient de `GET leads/reports/projects` en un appel.
 */
@Component({
  selector: 'report-projects-tab',
  templateUrl: './report-projects-tab.html',
  imports: [Button, DatePipe, RouterLink, TasSpinner, TasTable, ReportBarList, ReportKpiTiles],
})
export class ReportProjectsTab {
  private readonly _reports = inject(LeadReportsApiService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _load$ = new Subject<ReportRange>();

  public readonly range = input.required<ReportRange>();

  public readonly report = signal<ProjectReportDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly error = signal<string | null>(null);

  public readonly fmt = formatNumber;
  public readonly days = days;
  public readonly colors = SERIES_COLORS;
  public readonly flowLabel = projectFlowLabel;
  public readonly phaseLabel = (phase: string | null | undefined) => label(PROJECT_PHASE_LABELS, phase);

  public readonly kpis = computed<Kpi[]>(() => {
    const r = this.report();
    if (!r?.kpis?.period) return [];
    const k = r.kpis.period;
    const p = r.previous;
    return [
      { label: 'Projets ouverts', value: formatNumber(k.opened), hint: 'Créés sur la période',
        delta: relativeDelta(k.opened, p?.opened, 'up', formatNumber) },
      { label: 'Gagnés', value: formatNumber(k.won), hint: 'Sur la période, toutes dates d’ouverture',
        delta: relativeDelta(k.won, p?.won, 'up', formatNumber) },
      { label: 'Perdus', value: formatNumber(k.lost), hint: 'Sur la période',
        delta: relativeDelta(k.lost, p?.lost, 'down', formatNumber) },
      { label: 'Taux de gain', value: formatPercent(k.winRate), hint: 'Gagnés ÷ (gagnés + perdus)',
        delta: pointsDelta(k.winRate, p?.winRate, 'up', formatPercent) },
      { label: 'Cycle moyen', value: days(k.avgCycleDays), hint: 'De l’ouverture au gain',
        delta: relativeDelta(k.avgCycleDays, p?.avgCycleDays, 'down', days) },
      { label: 'Projets en cours', value: formatNumber(r.kpis.openProjects), hint: 'Aujourd’hui, toutes dates' },
      {
        label: 'Clôtures dépassées',
        value: formatNumber(r.kpis.overdue),
        hint: 'En cours, date de clôture passée',
        tone: (r.kpis.overdue ?? 0) > 0 ? 'warn' : undefined,
      },
    ];
  });

  public readonly lossReasons = computed<BarItem[]>(() =>
    (this.report()?.lossReasons ?? []).map((l, i) => ({ key: `${i}`, label: l.reason ?? '—', value: l.count ?? 0 })),
  );

  public readonly steps = computed(() =>
    (this.report()?.steps ?? []).map((s, i) => ({ ...s, key: `${s.template}-${s.step}-${i}` })),
  );

  public readonly productConfig = signal<TableConfig>({
    property: 'product',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20, 50] },
  });
  public readonly stepConfig = signal<TableConfig>({
    property: 'key',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20, 50] },
  });
  public readonly overdueConfig = signal<TableConfig>({
    property: 'projectId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20, 50] },
  });

  constructor() {
    this._load$
      .pipe(
        switchMap((range) => {
          this.isLoading.set(true);
          this.error.set(null);
          return this._reports
            .getProjectReport(range.from.toISOString(), range.to.toISOString(), range.agencyId || undefined)
            .pipe(
              catchError((err: HttpErrorResponse) => {
                this.error.set(err.error?.detail ?? 'Le rapport des projets n’a pas pu être chargé.');
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

  public pct = formatPercent;
}
