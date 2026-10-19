import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize, Subject, switchMap } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  DispatchAgentDto,
  DispatchFeedItemDto,
  DispatchOverviewDto,
  DispatchRuleOverviewDto,
  LeadDispatchingApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { formatDuration, formatNumber, label, SOURCE_LABELS } from '../reports/report-labels';

type PeriodKey = 'jour' | '7j' | '30j';

const PERIODS: ReadonlyArray<{ key: PeriodKey; label: string }> = [
  { key: 'jour', label: 'Aujourd’hui' },
  { key: '7j', label: '7 j' },
  { key: '30j', label: '30 j' },
];

const STRATEGY_LABELS: Record<string, string> = {
  RoundRobin: 'Tour de rôle',
  WeightedRoundRobin: 'Tour de rôle pondéré',
  CherryPicking: 'Au choix des agents',
  CompatibilityScoring: 'Score de compatibilité',
  StickyAssignment: 'Conseiller habituel',
};

const STRATEGY_ICONS: Record<string, string> = {
  RoundRobin: 'feather:repeat',
  WeightedRoundRobin: 'feather:repeat',
  CherryPicking: 'feather:list',
  CompatibilityScoring: 'feather:sliders',
  StickyAssignment: 'feather:user-check',
};

type Tone = 'ok' | 'warn' | 'info' | 'muted';

interface RuleStatus {
  label: string;
  tone: Tone;
}

interface Insight {
  tone: Tone;
  text: string;
  /** Lien vers la modification de la règle, quand c'est elle qu'il faut corriger. */
  editLink?: boolean;
}

/**
 * Le dispatching des leads, règle par règle : ce que chacune a distribué sur la période, à quels
 * agents, et les dernières affectations (`GET leads/dispatching/overview`).
 *
 * La question à laquelle l'écran répond d'abord est « cette règle sert-elle ? » : seule la règle
 * active de plus haute priorité reçoit les leads qu'aucune source ne lie à une autre règle. Une
 * deuxième règle active, de priorité inférieure, paraît configurée et ne reçoit rien — c'est ce que
 * l'écran des règles ne montrait pas.
 *
 * La création et la modification restent dans le paramétrage (`/settings/dispatch-rules`).
 */
@Component({
  templateUrl: './dispatching-page.html',
  imports: [RouterLink, Anchor, Button, TasIcon, TasSpinner, TasTable],
})
export class DispatchingPage implements OnInit {
  private readonly _api = inject(LeadDispatchingApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _permissions = inject(PermissionsService);
  private readonly _reload$ = new Subject<void>();

  public readonly canManage = this._permissions.can('lead:dispatching-rule:manage');

  public readonly periods = PERIODS;
  public readonly fmt = formatNumber;
  public readonly duration = formatDuration;

  public period = signal<PeriodKey>('7j');
  public selectedKey = signal('');
  public agentFilter = signal('');

  public overview = signal<DispatchOverviewDto | null>(null);
  public isLoading = signal(true);
  public error = signal<string | null>(null);

  public readonly rules = computed(() => this.overview()?.rules ?? []);

  /** La règle choisie, ou à défaut celle qui s'applique : c'est elle qu'on vient voir. */
  public readonly selected = computed<DispatchRuleOverviewDto | null>(() => {
    const rules = this.rules();
    return (
      rules.find((r) => r.key === this.selectedKey()) ??
      rules.find((r) => r.usage === 'AppliesByDefault') ??
      rules[0] ??
      null
    );
  });

  public readonly rank = computed(() => {
    const s = this.selected();
    const configured = this.rules().filter((r) => r.kind === 'Rule' && r.isActive);
    const i = configured.findIndex((r) => r.key === s?.key);
    return i >= 0 ? i + 1 : null;
  });

  public readonly settings = computed(() => {
    const r = this.selected();
    if (!r || r.kind === 'Manual' || r.kind === 'DeletedRule') return [];
    const items = [
      { k: 'Stratégie', v: this.strategyLabel(r.strategy) },
      { k: 'Priorité', v: r.priority == null ? '—' : String(r.priority) },
      { k: 'Plafond de leads', v: r.maxLeadsPerAgent ? `${r.maxLeadsPerAgent} par agent` : 'Aucun' },
      { k: 'Plafond de tâches', v: r.maxTasksPerAgent ? `${r.maxTasksPerAgent} ouvertes par agent` : 'Aucun' },
      { k: 'Anti-monopole', v: r.antiMonopolyThreshold ? `${r.antiMonopolyThreshold} leads chauds max` : 'Aucun' },
      { k: 'Premier contact', v: formatSla(r.firstContactSla) },
      { k: 'Agents exclus', v: r.excludedAgentCount ? String(r.excludedAgentCount) : 'Aucun' },
    ];
    if (r.pinnedSources?.length) items.push({ k: 'Sources liées', v: r.pinnedSources.join(', ') });
    return items;
  });

  public readonly stats = computed(() => {
    const r = this.selected();
    const queue = this.overview()?.queueCount ?? 0;
    return [
      { label: 'Leads dispatchés', value: formatNumber(r?.dispatched ?? 0), note: 'sur la période', warn: false, queue: false },
      {
        label: 'En file d’attente',
        value: formatNumber(queue),
        note: queue ? 'sans agent, toutes règles' : 'tous ont un agent',
        warn: queue > 0,
        queue: true,
      },
      { label: 'Réaffectés', value: formatNumber(r?.reassigned ?? 0), note: 'passés à un autre agent', warn: false, queue: false },
      { label: 'Délai d’affectation', value: formatDuration(r?.medianDelayMinutes), note: 'médiane, de la capture à l’agent', warn: false, queue: false },
    ];
  });

  public readonly insight = computed<Insight | null>(() => {
    const r = this.selected();
    if (!r) return null;
    const winner = this.rules().find((x) => x.usage === 'AppliesByDefault');
    switch (r.usage) {
      case 'AppliesByDefault': {
        if (r.kind === 'BuiltInDefault')
          return { tone: 'warn', text: 'Aucune règle n’est active : le moteur applique ses réglages intégrés. Créez une règle pour choisir la stratégie et les plafonds.' };
        const counts = (r.agents ?? []).map((a) => a.received ?? 0);
        const spread = counts.length > 1 ? Math.max(...counts) - Math.min(...counts) : 0;
        const base = 'Règle appliquée par défaut : tout lead dont la source ne désigne pas une autre règle passe par elle.';
        return counts.length > 1
          ? { tone: 'ok', text: `${base} Écart entre agents sur la période : ${spread} lead${spread > 1 ? 's' : ''}.` }
          : { tone: 'ok', text: base };
      }
      case 'NeverReached':
        return {
          tone: 'warn',
          text: `Cette règle est active mais ne reçoit aucun lead : « ${winner?.name ?? 'une autre règle'} » a une priorité plus haute et prend tout, et aucune source ne la désigne. Augmentez sa priorité ou liez-la à une source.`,
          editLink: true,
        };
      case 'PinnedToSources':
        return { tone: 'info', text: `Appliquée seulement aux leads des sources : ${(r.pinnedSources ?? []).join(', ')}.` };
      case 'Inactive':
        return { tone: 'muted', text: 'Règle désactivée : elle ne distribue plus de leads. Les chiffres montrent ce qu’elle a distribué sur la période.' };
      default:
        if (r.kind === 'Manual') return { tone: 'info', text: 'Leads affectés à la main par un responsable, en nommant l’agent : aucune règle n’a été appliquée.' };
        if (r.kind === 'DeletedRule') return { tone: 'muted', text: 'Affectations faites par des règles supprimées depuis.' };
        if (r.kind === 'BuiltInDefault') return { tone: 'muted', text: 'Affectations faites avec les réglages intégrés, avant qu’une règle soit active.' };
        return null;
    }
  });

  public readonly agents = computed(() => this.selected()?.agents ?? []);
  public readonly maxReceived = computed(() => Math.max(1, ...this.agents().map((a) => a.received ?? 0)));

  public readonly feed = computed(() => {
    const all = this.selected()?.recent ?? [];
    const agent = this.agentFilter();
    return (agent ? all.filter((f) => f.agentId === agent) : all).slice(0, 10);
  });
  public readonly agentFilterName = computed(
    () => this.agents().find((a) => a.agentId === this.agentFilter())?.name ?? '',
  );

  public readonly ruleTableConfig = signal<TableConfig>({ property: 'key', pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [50] } });
  public readonly agentTableConfig = signal<TableConfig>({ property: 'agentId', pagination: { serverSide: false, pageIndex: 0, pageSize: 50, pageSizeOptions: [50] } });
  public readonly feedTableConfig = signal<TableConfig>({ property: 'assignmentId', pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10] } });

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Leads', link: ['/leads'] }, { label: 'Dispatching' }]);

    const params = this._route.snapshot.queryParams;
    if (PERIODS.some((p) => p.key === params['periode'])) this.period.set(params['periode']);
    if (params['regle']) this.selectedKey.set(params['regle']);

    this._reload$
      .pipe(
        switchMap(() => {
          this.isLoading.set(true);
          this.error.set(null);
          const { from, to } = range(this.period());
          return this._api.getDispatchOverview(from, to).pipe(
            catchError((err: HttpErrorResponse) => {
              this.error.set(err.error?.detail ?? 'Impossible de charger le dispatching.');
              return EMPTY;
            }),
            finalize(() => this.isLoading.set(false)),
          );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((o) => this.overview.set(o));

    this.reload();
  }

  public reload(): void {
    this._reload$.next();
  }

  public pickPeriod(key: PeriodKey): void {
    this.period.set(key);
    this._persist();
    this.reload();
  }

  public pickRule(rule: DispatchRuleOverviewDto): void {
    this.selectedKey.set(rule.key ?? '');
    this.agentFilter.set('');
    this._persist();
  }

  public toggleAgent(agent: DispatchAgentDto): void {
    this.agentFilter.set(this.agentFilter() === agent.agentId ? '' : agent.agentId ?? '');
  }

  public strategyLabel(s: string | null | undefined): string {
    return label(STRATEGY_LABELS, s);
  }

  public strategyIcon(s: string | null | undefined): string {
    return (s && STRATEGY_ICONS[s]) || 'feather:user';
  }

  public ruleSubtitle(r: DispatchRuleOverviewDto): string {
    if (r.kind === 'Manual') return 'Agent choisi par un responsable';
    if (r.kind === 'DeletedRule') return 'Règles supprimées';
    if (r.kind === 'BuiltInDefault') return 'Réglages intégrés';
    return this.strategyLabel(r.strategy);
  }

  public ruleStatus(r: DispatchRuleOverviewDto): RuleStatus {
    switch (r.usage) {
      case 'AppliesByDefault': return { label: 'Appliquée par défaut', tone: 'ok' };
      case 'PinnedToSources': return { label: 'Liée à des sources', tone: 'info' };
      case 'NeverReached': return { label: 'Active · jamais atteinte', tone: 'warn' };
      case 'Inactive': return { label: 'Désactivée', tone: 'muted' };
      default: return { label: 'Hors règle', tone: 'muted' };
    }
  }

  public isEditable(r: DispatchRuleOverviewDto | null): boolean {
    return !!r && r.kind === 'Rule' && !!r.ruleId && this.canManage();
  }

  public sourceLabel(s: string | null | undefined): string {
    return label(SOURCE_LABELS, s);
  }

  public initials(name: string | null | undefined): string {
    return (name ?? '?').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }

  public barWidth(n: number | null | undefined): number {
    return Math.round(((n ?? 0) / this.maxReceived()) * 100);
  }

  public at(f: DispatchFeedItemDto): string {
    if (!f.at) return '';
    const d = new Date(f.at);
    const today = new Date();
    return d.toDateString() === today.toDateString()
      ? TIME.format(d)
      : DAY.format(d);
  }

  public outcome(f: DispatchFeedItemDto): { label: string; cls: string } {
    switch (f.outcome) {
      case 'Contacted': return { label: 'Contacté', cls: 'bg-green-50 text-green-800' };
      case 'Reassigned': return { label: 'Réaffecté', cls: 'bg-amber-50 text-amber-800' };
      default: return { label: 'À contacter', cls: 'bg-blue-50 text-blue-800' };
    }
  }

  private _persist(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        periode: this.period() === '7j' ? null : this.period(),
        regle: this.selectedKey() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

function range(period: PeriodKey): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  if (period === 'jour') from.setHours(0, 0, 0, 0);
  else from.setDate(from.getDate() - (period === '7j' ? 7 : 30));
  return { from: from.toISOString(), to: to.toISOString() };
}

/** `TimeSpan` sérialisé : « 04:00:00 » ou « 5.00:00:00 ». */
function formatSla(span: string | null | undefined): string {
  if (!span) return '—';
  const m = /^(?:(\d+)\.)?(\d{1,2}):(\d{2})/.exec(span);
  if (!m) return span;
  const minutes = (Number(m[1] ?? 0) * 24 + Number(m[2])) * 60 + Number(m[3]);
  return formatDuration(minutes);
}

export default DispatchingPage;
