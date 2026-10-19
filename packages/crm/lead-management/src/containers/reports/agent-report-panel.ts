import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { AgentComparisonDto, AgentReportDto } from '@sankore/crm-api';
import { LinePoint, LineSeries, ReportLineChart } from './report-line-chart';
import { BarItem, ReportBarList } from './report-bar-list';
import { formatDuration, formatNumber, formatPercent, label, SERIES_COLORS, STAGE_LABELS } from './report-labels';

/**
 * Couleurs des deux agents comparés : violet et aqua, et non le bleu et l'orange qui désignent
 * déjà « Captés » et « Convertis » ailleurs sur l'écran — une même couleur ne doit pas nommer
 * deux choses. Paire validée (ΔE 27,1 dans le pire cas de daltonisme) ; l'aqua est sous 3:1 sur
 * fond blanc, d'où les valeurs écrites en clair et le tableau des données.
 */
export const AGENT_COLORS = ['#6250d6', '#1baf7a'] as const;

/** Troisième série de la fiche d'un agent seul, dans l'ordre fixe de la palette. */
const CONTACT_COLOR = '#1baf7a';

interface CompareRow {
  label: string;
  a: string;
  b: string;
  /** Qui est devant, quand « plus » veut dire « mieux » ; null si l'indicateur n'a pas de sens. */
  better: 'a' | 'b' | null;
}

@Component({
  selector: 'report-agent-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, TasSelect, TasSpinner, ReportLineChart, ReportBarList],
  templateUrl: './agent-report-panel.html',
})
export class AgentReportPanel {
  public readonly options = input.required<{ label: string; value: string }[]>();
  public readonly agentA = input('');
  public readonly agentB = input('');
  public readonly data = input<AgentComparisonDto | null>(null);
  public readonly isLoading = input(false);
  public readonly error = input<string | null>(null);

  public readonly pickA = output<string>();
  public readonly pickB = output<string>();

  public readonly colors = AGENT_COLORS;
  public readonly fmt = formatNumber;
  public readonly pct = formatPercent;
  public readonly duration = formatDuration;

  public readonly optionsB = computed(() => [
    { label: 'Aucune comparaison', value: '' },
    ...this.options().filter((o) => o.value && o.value !== this.agentA()),
  ]);

  public readonly a = computed(() => this._find(this.agentA()));
  public readonly b = computed(() => this._find(this.agentB()));
  public readonly comparing = computed(() => !!this.a() && !!this.b());

  /** Fiche d'un agent seul : trois séries d'un même ordre de grandeur, sur un seul axe. */
  public readonly soloSeries: LineSeries[] = [
    { name: 'Affectations', color: SERIES_COLORS.captured },
    { name: 'Conversions', color: SERIES_COLORS.converted },
    { name: 'Premiers contacts', color: CONTACT_COLOR },
  ];

  public readonly soloPoints = computed<LinePoint[]>(() => {
    const a = this.a();
    return a ? this._points(a, (p) => [p.assigned ?? 0, p.converted ?? 0, p.contacted ?? 0]) : [];
  });

  public readonly compareSeries = computed<LineSeries[]>(() => [
    { name: this.a()?.name ?? 'Agent 1', color: AGENT_COLORS[0] },
    { name: this.b()?.name ?? 'Agent 2', color: AGENT_COLORS[1] },
  ]);

  /** Une mesure par graphe : affectations et conversions n'ont pas la même échelle. */
  public readonly compareAssigned = computed(() => this._pair((p) => p.assigned ?? 0));
  public readonly compareConverted = computed(() => this._pair((p) => p.converted ?? 0));

  public readonly progression = computed<BarItem[]>(() => {
    const a = this.a();
    if (!a) return [];
    const b = this.comparing() ? this.b() : null;
    return (a.progression ?? []).map((s, i) => ({
      key: String(s.stage),
      label: label(STAGE_LABELS, s.stage),
      value: s.count ?? 0,
      value2: b ? (b.progression?.[i]?.count ?? 0) : undefined,
    }));
  });

  public readonly compareRows = computed<CompareRow[]>(() => {
    const a = this.a();
    const b = this.b();
    if (!a || !b) return [];
    const row = (lbl: string, va: number | null | undefined, vb: number | null | undefined,
                 f: (n: number | null | undefined) => string, higherIsBetter: boolean | null): CompareRow => ({
      label: lbl,
      a: f(va),
      b: f(vb),
      better: higherIsBetter === null || va == null || vb == null || va === vb
        ? null
        : (va > vb) === higherIsBetter ? 'a' : 'b',
    });
    return [
      row('Affectations reçues', a.assigned, b.assigned, formatNumber, null),
      row('Délai respecté', a.slaComplianceRate, b.slaComplianceRate, formatPercent, true),
      row('Premier contact moyen', a.avgFirstContactMinutes, b.avgFirstContactMinutes, formatDuration, false),
      row('Sans contact', a.notContacted, b.notContacted, formatNumber, false),
      row('Conversions', a.converted, b.converted, formatNumber, true),
      row('Taux de conversion', a.conversionRate, b.conversionRate, formatPercent, true),
      row('Charge actuelle', a.openLeads, b.openLeads, formatNumber, null),
      row('Délais dépassés en cours', a.openSlaBreaches, b.openSlaBreaches, formatNumber, false),
    ];
  });

  public kpis(a: AgentReportDto) {
    return [
      { label: 'Affectations', value: formatNumber(a.assigned), hint: 'Reçues sur la période' },
      {
        label: 'Délai respecté',
        value: formatPercent(a.slaComplianceRate),
        hint: `${a.contactedWithinSla ?? 0} à temps · ${a.contactedLate ?? 0} en retard · ${a.notContacted ?? 0} sans contact`,
      },
      { label: 'Premier contact', value: formatDuration(a.avgFirstContactMinutes), hint: 'Délai moyen après affectation' },
      { label: 'Conversions', value: formatNumber(a.converted), hint: 'Réalisées sur la période' },
      { label: 'Taux de conversion', value: formatPercent(a.conversionRate), hint: 'Des leads reçus sur la période' },
      { label: 'Charge actuelle', value: formatNumber(a.openLeads), hint: 'Leads ouverts aujourd’hui' },
      {
        label: 'Délais dépassés',
        value: formatNumber(a.openSlaBreaches),
        hint: 'En attente de contact',
        warn: (a.openSlaBreaches ?? 0) > 0,
      },
    ];
  }

  private _find(id: string): AgentReportDto | null {
    return id ? (this.data()?.agents ?? []).find((x) => x.agentId === id) ?? null : null;
  }

  private _pair(pick: (p: NonNullable<AgentReportDto['series']>[number]) => number): LinePoint[] {
    const a = this.a();
    const b = this.b();
    if (!a || !b) return [];
    const bSeries = b.series ?? [];
    return this._points(a, (p, i) => [pick(p), bSeries[i] ? pick(bSeries[i]) : 0]);
  }

  private _points(
    agent: AgentReportDto,
    values: (p: NonNullable<AgentReportDto['series']>[number], i: number) => number[],
  ): LinePoint[] {
    const granularity = this.data()?.granularity ?? 'Day';
    return (agent.series ?? []).map((p, i) => ({ ...periodLabels(new Date(p.periodStart ?? 0), granularity), values: values(p, i) }));
  }
}

export function periodLabels(d: Date, granularity: string): { label: string; tick: string } {
  const utc = { timeZone: 'UTC' } as const;
  if (granularity === 'Month') {
    return {
      label: new Intl.DateTimeFormat('fr-FR', { ...utc, month: 'long', year: 'numeric' }).format(d),
      tick: new Intl.DateTimeFormat('fr-FR', { ...utc, month: 'short', year: '2-digit' }).format(d),
    };
  }
  const short = new Intl.DateTimeFormat('fr-FR', { ...utc, day: 'numeric', month: 'short' }).format(d);
  if (granularity === 'Week') return { label: `Semaine du ${short}`, tick: short };
  return {
    label: new Intl.DateTimeFormat('fr-FR', { ...utc, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d),
    tick: short,
  };
}
