import { Component, computed, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, Subject, switchMap } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { KycReportDto, KYCReportsApiService } from '@sankore/crm-api';
import { BarItem, ReportBarList } from './report-bar-list';
import { Kpi, pointsDelta, relativeDelta, ReportKpiTiles } from './report-kpi';
import { ReportRange } from './report-projects-tab';
import { formatNumber, formatPercent, SERIES_COLORS } from './report-labels';

const LEVELS: Record<string, string> = {
  Agent: 'Agent',
  BranchManager: 'Chef d’agence',
  ComplianceOfficer: 'Conformité',
  GeneralManagement: 'Direction générale',
  Automatic: 'Automatique',
};
const TIERS: Record<string, string> = { Simplified: 'Simplifié', Full: 'Complet' };
const CHANNELS: Record<string, string> = {
  Agency: 'Agence',
  MobileAgent: 'Agent mobile',
  Web: 'Web',
  Import: 'Import',
  LeadConversion: 'Conversion d’un lead',
  RemoteSelfService: 'À distance (client)',
};
const VIGILANCE: Record<string, string> = { Low: 'Faible', Standard: 'Standard', High: 'Renforcée' };

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const days = (n: number | null | undefined) => (n == null ? '—' : `${decimal.format(n)} j`);
const bars = (items: { key?: string | null; count?: number }[] | null | undefined, labels: Record<string, string>): BarItem[] =>
  (items ?? []).map((c) => ({ key: c.key ?? '', label: labels[c.key ?? ''] ?? c.key ?? '—', value: c.count ?? 0 }));

/**
 * L'onglet « KYC » des rapports (lot 5, 2026-11-02) : dossiers ouverts, validés, refusés, délai de
 * validation, compléments, et où les dossiers attendent une signature aujourd'hui. Tout vient de
 * `GET kyc-files/reports` en un appel.
 */
@Component({
  selector: 'report-kyc-tab',
  templateUrl: './report-kyc-tab.html',
  imports: [Button, RouterLink, TasSpinner, TasTable, ReportBarList, ReportKpiTiles],
})
export class ReportKycTab {
  private readonly _reports = inject(KYCReportsApiService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _load$ = new Subject<ReportRange>();

  public readonly range = input.required<ReportRange>();

  public readonly report = signal<KycReportDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly error = signal<string | null>(null);
  public readonly colors = SERIES_COLORS;
  public readonly days = days;
  public readonly fmt = formatNumber;
  public readonly levelLabel = (level: string | null | undefined) => LEVELS[level ?? ''] ?? level ?? '—';

  public readonly kpis = computed<Kpi[]>(() => {
    const r = this.report();
    const period = r?.kpis?.period;
    if (!r?.kpis || !period) return [];
    const p = r.previous;
    return [
      { label: 'Dossiers ouverts', value: formatNumber(period.opened), hint: 'Sur la période',
        delta: relativeDelta(period.opened, p?.opened, 'up', formatNumber) },
      { label: 'Validés', value: formatNumber(period.validated), hint: 'Simplifiés ou complets',
        delta: relativeDelta(period.validated, p?.validated, 'up', formatNumber) },
      { label: 'Refusés', value: formatNumber(period.rejected), hint: 'Sur la période',
        delta: relativeDelta(period.rejected, p?.rejected, 'down', formatNumber) },
      { label: 'Délai de validation', value: days(period.avgValidationDays), hint: 'De l’ouverture à la validation',
        delta: relativeDelta(period.avgValidationDays, p?.avgValidationDays, 'down', days) },
      { label: 'Premier passage', value: formatPercent(period.firstPassRate), hint: 'Validés sans complément',
        delta: pointsDelta(period.firstPassRate, p?.firstPassRate, 'up', formatPercent) },
      { label: 'Compléments', value: formatPercent(period.complementRate), hint: 'Des dossiers décidés, renvoyés au moins une fois',
        delta: pointsDelta(period.complementRate, p?.complementRate, 'down', formatPercent) },
      { label: 'Validés automatiquement', value: formatNumber(period.automatic), hint: 'Dossiers à distance, sans humain',
        delta: relativeDelta(period.automatic, p?.automatic, 'up', formatNumber) },
      { label: 'En validation', value: formatNumber(r.kpis.inValidation), hint: 'En attente d’une signature aujourd’hui' },
      {
        label: 'Revues à venir',
        value: formatNumber(r.kpis.reviewsDueSoon),
        hint: (r.kpis.reviewsOverdue ?? 0) > 0 ? `Sous 30 jours · ${formatNumber(r.kpis.reviewsOverdue)} en retard` : 'Sous 30 jours',
        tone: (r.kpis.reviewsOverdue ?? 0) > 0 ? 'warn' : undefined,
      },
    ];
  });

  public readonly waiting = computed<BarItem[]>(() =>
    (this.report()?.waiting ?? []).map((w) => ({
      key: w.level ?? '',
      label: this.levelLabel(w.level),
      value: w.count ?? 0,
      note: `en moyenne ${days(w.avgDays)} · le plus ancien ${days(w.oldestDays)}`,
    })),
  );
  public readonly byTier = computed(() => bars(this.report()?.byTier, TIERS));
  public readonly byChannel = computed(() => bars(this.report()?.byChannel, CHANNELS));
  public readonly byVigilance = computed(() => bars(this.report()?.byVigilance, VIGILANCE));
  public readonly byAgency = computed<BarItem[]>(() =>
    (this.report()?.byAgency ?? []).map((a) => ({
      key: a.agencyId ?? a.name ?? '',
      label: a.name ?? '—',
      value: a.opened ?? 0,
      value2: a.validated ?? 0,
    })),
  );

  public readonly longestConfig = signal<TableConfig>({
    property: 'kycFileId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20] },
  });

  constructor() {
    this._load$
      .pipe(
        switchMap((range) => {
          this.isLoading.set(true);
          this.error.set(null);
          return this._reports
            .getKycReport(range.from.toISOString(), range.to.toISOString(), range.agencyId || undefined)
            .pipe(
              catchError((err: HttpErrorResponse) => {
                this.error.set(err.error?.detail ?? 'Le rapport KYC n’a pas pu être chargé.');
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
