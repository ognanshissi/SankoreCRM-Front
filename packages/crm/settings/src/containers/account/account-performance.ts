import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { catchError, of } from 'rxjs';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TasIcon } from '@talisoft/ui/icon';
import { LeadsAnalyticsApiService, MyPerformanceDto, ProductPerformanceDto } from '@sankore/crm-api';

type PeriodCode = 'month' | '30d' | 'quarter';

const PERIODS: { value: PeriodCode; label: string }[] = [
  { value: 'month', label: 'Ce mois' },
  { value: '30d', label: '30 jours' },
  { value: 'quarter', label: 'Trimestre' },
];

/** Un indicateur et son écart à l'agence, prêts à afficher. */
interface Kpi {
  label: string;
  value: string;
  /** Null quand il n'y a rien à comparer (pas d'agence, ou une des deux valeurs manque). */
  delta: { text: string; better: boolean; up: boolean } | null;
}

const UNPAGED: TableConfig = {
  property: 'product',
  pagination: { serverSide: false, pageIndex: 0, pageSize: 100, pageSizeOptions: [100] },
};

/** « 2 h 55 », « 45 min », « 1 j 3 h ». */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours < 24) return `${hours} h ${String(total % 60).padStart(2, '0')}`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function fmt(n: number, digits = 0): string {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function signed(n: number, digits = 0): string {
  const rounded = Number(n.toFixed(digits));
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${fmt(Math.abs(rounded), digits)}`;
}

@Component({
  selector: 'account-performance',
  imports: [DecimalPipe, TasSpinner, TasTable, TasIcon],
  templateUrl: './account-performance.html',
})
export class AccountPerformance implements OnInit {
  private readonly _analyticsApi = inject(LeadsAnalyticsApiService);

  public readonly periods = PERIODS;
  public readonly tableConfig = UNPAGED;
  public period = signal<PeriodCode>('30d');
  public isLoading = signal(true);
  public loadFailed = signal(false);
  public data = signal<MyPerformanceDto | null>(null);

  public readonly kpis = computed<Kpi[]>(() => {
    const d = this.data();
    if (!d) return [];
    const me = d.agent;
    const agency = d.agency ?? null;

    const handled = me?.leadsHandled ?? 0;
    const agencyHandled = agency?.leadsHandled ?? null;

    return [
      {
        label: 'Leads traités',
        value: fmt(handled),
        delta: agencyHandled
          ? this._delta(`${signed((100 * (handled - agencyHandled)) / agencyHandled)} % vs agence`, handled - agencyHandled, true)
          : null,
      },
      {
        label: 'Taux de conversion',
        value: me?.conversionRate != null ? `${fmt(me.conversionRate)} %` : '—',
        delta: this._points(me?.conversionRate, agency?.conversionRate, true),
      },
      {
        label: 'Délai de premier contact',
        value: me?.avgFirstContactMinutes != null ? formatMinutes(me.avgFirstContactMinutes) : '—',
        delta:
          me?.avgFirstContactMinutes != null && agency?.avgFirstContactMinutes != null
            ? this._delta(
                `${signed(me.avgFirstContactMinutes - agency.avgFirstContactMinutes)} min vs agence`,
                me.avgFirstContactMinutes - agency.avgFirstContactMinutes,
                // Plus court est mieux.
                false,
              )
            : null,
      },
      {
        label: 'Échéances respectées',
        value: me?.deadlinesRespectedRate != null ? `${fmt(me.deadlinesRespectedRate)} %` : '—',
        delta: this._points(me?.deadlinesRespectedRate, agency?.deadlinesRespectedRate, true),
      },
    ];
  });

  /** « l'Agence Plateau » quand le nom le dit déjà, sinon « l'agence Plateau ». */
  public readonly agencyLabel = computed(() => {
    const name = this.data()?.agencyName?.trim();
    if (!name) return null;
    return /^agence\b/i.test(name) ? `l'${name}` : `l'agence ${name}`;
  });

  public readonly weeks = computed(() => {
    const weeks = this.data()?.weekly ?? [];
    const max = Math.max(1, ...weeks.map((w) => w.conversions ?? 0));
    return weeks.map((w) => ({ ...w, height: ((w.conversions ?? 0) / max) * 100 }));
  });

  public readonly products = computed(() =>
    (this.data()?.products ?? []).map((p: ProductPerformanceDto) => ({ ...p, key: p.product ?? '' })),
  );

  ngOnInit(): void {
    this._load();
  }

  public setPeriod(period: PeriodCode): void {
    if (period === this.period()) return;
    this.period.set(period);
    this._load();
  }

  private _points(me: number | null | undefined, agency: number | null | undefined, higherIsBetter: boolean) {
    if (me == null || agency == null) return null;
    const diff = me - agency;
    const unit = Math.abs(Math.round(diff)) > 1 ? 'pts' : 'pt';
    return this._delta(`${signed(diff)} ${unit} vs agence`, diff, higherIsBetter);
  }

  private _delta(text: string, diff: number, higherIsBetter: boolean) {
    return { text, up: diff >= 0, better: diff === 0 || (diff > 0) === higherIsBetter };
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._analyticsApi.getMyPerformance(this.period()).pipe(
      catchError(() => {
        this.loadFailed.set(true);
        return of(null);
      }),
    ).subscribe((data) => {
      if (data) this.data.set(data);
      this.isLoading.set(false);
    });
  }
}

export default AccountPerformance;
