import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { Button } from '@talisoft/ui/button';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { LeadReportAgent } from '@sankore/crm-api';
import { MIN_ASSIGNED_FOR_RANKING, rankAgents, RankedAgent, RankingCriterion, SCORE_WEIGHTS } from './agent-ranking';
import { formatDuration, formatNumber, formatPercent, SERIES_COLORS } from './report-labels';

const CRITERIA: ReadonlyArray<{ key: RankingCriterion; label: string }> = [
  { key: 'score', label: 'Score global' },
  { key: 'converted', label: 'Conversions' },
  { key: 'conversionRate', label: 'Taux de conversion' },
  { key: 'sla', label: 'Délai respecté' },
  { key: 'firstContact', label: 'Premier contact' },
];

/**
 * Classement des agents sur la période du rapport, selon un critère au choix. Le calcul est dans
 * `agent-ranking.ts` (fonction pure, testée) ; ce composant ne fait que l'afficher.
 */
@Component({
  selector: 'report-agent-ranking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, TasTable],
  templateUrl: './agent-ranking-panel.html',
})
export class AgentRankingPanel {
  public readonly agents = input.required<LeadReportAgent[]>();
  public readonly criterion = input<RankingCriterion>('score');
  public readonly criterionChange = output<RankingCriterion>();
  /** « Voir » sur une ligne : ouvre la fiche de l'agent. */
  public readonly view = output<string>();

  public readonly criteria = CRITERIA;
  public readonly minAssigned = MIN_ASSIGNED_FOR_RANKING;
  public readonly weights = SCORE_WEIGHTS;
  public readonly barColor = SERIES_COLORS.captured;

  public readonly showUnranked = signal(false);

  public readonly ranking = computed(() => rankAgents(this.agents(), this.criterion()));

  /** La barre est rapportée au meilleur ; pour le délai, au plus rapide (barre pleine = meilleur). */
  public readonly best = computed(() => {
    const values = this.ranking().ranked.map((r) => r.value ?? 0);
    if (values.length === 0) return 1;
    return this.criterion() === 'firstContact' ? Math.min(...values) : Math.max(...values);
  });

  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50] },
  });

  public readonly rows = computed(() => this.ranking().ranked.map((r) => ({ ...r, id: r.agent.agentId ?? '' })));

  public criterionLabel(): string {
    return CRITERIA.find((c) => c.key === this.criterion())?.label ?? '';
  }

  public format(r: RankedAgent): string {
    switch (this.criterion()) {
      case 'score': return formatNumber(r.value) + ' / 100';
      case 'converted': return formatNumber(r.value);
      case 'firstContact': return formatDuration(r.value);
      default: return formatPercent(r.value);
    }
  }

  public barWidth(r: RankedAgent): number {
    const v = r.value ?? 0;
    const best = this.best();
    if (this.criterion() === 'firstContact') return v > 0 ? Math.min(100, (best / v) * 100) : 0;
    return best > 0 ? Math.min(100, (v / best) * 100) : 0;
  }

  public breakdownText(r: RankedAgent): string {
    const b = r.breakdown;
    if (!b) return '';
    const n = (x: number) => Math.round(x);
    return `Conversion ${n(b.conversionRate)} · Délai ${n(b.sla)} · Rapidité ${n(b.firstContact)} · Volume ${n(b.volume)}`;
  }

  public unrankedReason(r: RankedAgent): string {
    return (r.agent.assigned ?? 0) < MIN_ASSIGNED_FOR_RANKING
      ? `${formatNumber(r.agent.assigned)} affectation${(r.agent.assigned ?? 0) > 1 ? 's' : ''} (minimum ${MIN_ASSIGNED_FOR_RANKING})`
      : 'Aucun premier contact sur la période';
  }

  public readonly fmt = formatNumber;
  public readonly pct = formatPercent;
  public readonly duration = formatDuration;
}
