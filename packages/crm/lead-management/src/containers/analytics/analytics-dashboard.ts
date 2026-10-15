import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  AgentPerformanceDto,
  FunnelMetricsDto,
  LeadSettingsApiService,
  LeadsAnalyticsApiService,
  LeadsApiService,
  SlaBreachDto,
  SourceCount,
  UsersApiService,
} from '@sankore/crm-api';
import { TasFormField } from "@talisoft/ui/form-field"
import { BreadcrumbService } from '@sankore/crm/common';
import { ReassignLeadDrawer } from '../edit-lead/reassign-lead-drawer';

/**
 * Tableau de bord des leads : acquisition, entonnoir, retards à traiter et performance des agents.
 *
 * Le serveur ne fournit ni série temporelle ni comparaison de périodes : les tendances et les
 * écarts sont recalculés ici en interrogeant les mêmes endpoints sur la période précédente et sur
 * quelques sous-périodes. Chaque bloc charge et échoue seul — une tendance indisponible ne masque
 * jamais le chiffre qu'elle accompagne.
 */

type PeriodKey = '7d' | '30d' | '90d' | 'month' | 'year';

interface Period {
  key: PeriodKey;
  label: string;
  from: Date;
  to: Date;
}

interface Kpi {
  label: string;
  value: string;
  /** Écart vs période précédente, ou null s'il n'a pas pu être calculé. */
  delta: { text: string; suffix: string; good: boolean; up: boolean; flat?: boolean } | null;
  trend: number[] | null;
}

interface AgentRow {
  id: string;
  name: string;
  agency: string;
  initials: string;
  assigned: number;
  slaRate: number | null;
  late: number;
  converted: number;
  firstContact: string;
}

const PERIOD_LABELS: Record<PeriodKey, string> = {
  '7d': '7 jours',
  '30d': '30 jours',
  '90d': '90 jours',
  month: 'Ce mois',
  year: 'Cette année',
};

/** Objectif par défaut quand le réglage du tenant n'est pas lisible par l'utilisateur. */
const DEFAULT_SLA_TARGET = 90;
const MAX_TREND_POINTS = 8;
const DAY_MS = 86_400_000;

const SOURCE_LABELS: Record<string, string> = {
  Web: 'Site internet',
  MobileAgent: 'Agent mobile',
  Agency: 'Agence',
  CallCenter: 'Centre d\'appels',
  Sms: 'SMS',
  Ussd: 'USSD',
  WhatsApp: 'WhatsApp',
  Referral: 'Recommandation',
  Partner: 'Partenaire',
  FileImport: 'Import de fichier',
  Campaign: 'Campagne',
};

function buildPeriod(key: PeriodKey): Period {
  const to = new Date();
  const from = new Date(to);
  switch (key) {
    case '7d': from.setDate(from.getDate() - 7); break;
    case '30d': from.setDate(from.getDate() - 30); break;
    case '90d': from.setDate(from.getDate() - 90); break;
    case 'month': from.setDate(1); from.setHours(0, 0, 0, 0); break;
    case 'year': from.setMonth(0, 1); from.setHours(0, 0, 0, 0); break;
  }
  return { key, label: PERIOD_LABELS[key], from, to };
}

/** Période de même durée, juste avant : c'est la comparaison la plus lisible pour « vs précédente ». */
function previousOf(p: Period): { from: Date; to: Date } {
  const span = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - span), to: new Date(p.from) };
}

/** Découpe la période en au plus MAX_TREND_POINTS tranches d'au moins un jour. */
function bucketsOf(p: Period): { from: Date; to: Date }[] {
  const span = p.to.getTime() - p.from.getTime();
  const count = Math.max(2, Math.min(MAX_TREND_POINTS, Math.round(span / DAY_MS)));
  const step = span / count;
  return Array.from({ length: count }, (_, i) => ({
    from: new Date(p.from.getTime() + i * step),
    to: new Date(p.from.getTime() + (i + 1) * step),
  }));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Moyenne du premier contact, pondérée par le nombre de leads effectivement contactés. */
function weightedFirstContact(agents: AgentPerformanceDto[] | null): number | null {
  if (!agents) return null;
  let weight = 0;
  let total = 0;
  for (const a of agents) {
    if (a.avgFirstContactMinutes == null) continue;
    const w = (a.contactedWithinSla ?? 0) + (a.contactedLate ?? 0) || 1;
    weight += w;
    total += a.avgFirstContactMinutes * w;
  }
  return weight ? total / weight : null;
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

@Component({
  selector: 'analytics-dashboard',
  templateUrl: './analytics-dashboard.html',
  imports: [FormsModule, RouterLink, TasIcon, TasSelect, TasSpinner, TasTable, TasFormField],
})
export class AnalyticsDashboard implements OnInit {
  private readonly _analyticsApi = inject(LeadsAnalyticsApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _settingsApi = inject(LeadSettingsApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly periodKeys: PeriodKey[] = ['7d', '30d', '90d', 'month', 'year'];
  public readonly periodLabels = PERIOD_LABELS;

  // ——— Filtres (persistés dans l'URL) ———
  public readonly periodKey = signal<PeriodKey>('30d');
  public readonly agencyId = signal('');
  public readonly agencyOptions = signal<{ label: string; value: string }[]>([
    { label: 'Toutes les agences', value: '' },
  ]);

  // ——— Données ———
  public readonly funnel = signal<FunnelMetricsDto | null>(null);
  public readonly funnelLoading = signal(false);
  public readonly funnelError = signal(false);
  public readonly previousFunnel = signal<FunnelMetricsDto | null>(null);
  public readonly trendFunnels = signal<(FunnelMetricsDto | null)[] | null>(null);

  public readonly agents = signal<AgentPerformanceDto[]>([]);
  public readonly agentsLoading = signal(false);
  public readonly agentsError = signal(false);
  public readonly previousAgents = signal<AgentPerformanceDto[] | null>(null);
  public readonly trendAgents = signal<(AgentPerformanceDto[] | null)[] | null>(null);

  public readonly breaches = signal<SlaBreachDto[]>([]);
  public readonly breachesLoading = signal(false);
  public readonly breachesError = signal(false);
  public readonly showAllBreaches = signal(false);
  public readonly reassigningLeadId = signal<string | null>(null);

  public readonly sources = signal<SourceCount[]>([]);
  public readonly sourcesError = signal(false);

  public readonly slaTarget = signal(DEFAULT_SLA_TARGET);
  /** Noms et agences des utilisateurs : les DTO d'analyse ne portent que des identifiants. */
  private readonly _users = signal<Map<string, { name: string; agency: string }>>(new Map());

  // ——— Dérivés ———

  public readonly period = computed(() => buildPeriod(this.periodKey()));

  public readonly subtitle = computed(() => {
    const f = this.funnel();
    if (!f) return null;
    const converted = f.converted ?? 0;
    const top = this.sourceRows()[0];
    const base = `${converted} nouveau${converted > 1 ? 'x' : ''} client${converted > 1 ? 's' : ''} sur la période`;
    return top ? `${base}. Première source de leads : ${top.label.toLowerCase()} (${top.count}).` : `${base}.`;
  });

  public readonly kpis = computed<Kpi[]>(() => {
    const f = this.funnel();
    const prev = this.previousFunnel();
    const trend = this.trendFunnels();
    const fc = weightedFirstContact(this.agents());
    const prevFc = weightedFirstContact(this.previousAgents());
    const trendFc = this.trendAgents();

    const series = (pick: (x: FunnelMetricsDto) => number | undefined): number[] | null =>
      trend && trend.every((t) => !!t) ? trend.map((t) => pick(t!) ?? 0) : null;

    const captured = f?.totalCaptured ?? 0;
    const prevCaptured = prev?.totalCaptured ?? null;

    return [
      {
        label: 'Leads captés',
        value: f ? String(captured) : '—',
        delta:
          f && prevCaptured
            ? this._delta(((captured - prevCaptured) / prevCaptured) * 100, ' %', 'vs période précédente', true)
            : null,
        trend: series((t) => t.totalCaptured),
      },
      {
        label: 'Taux de qualification',
        value: f?.qualificationRate != null ? `${Math.round(f.qualificationRate)} %` : '—',
        delta:
          f?.qualificationRate != null && prev?.qualificationRate != null
            ? this._delta(f.qualificationRate - prev.qualificationRate, ' pts', 'vs période précédente', true)
            : null,
        trend: series((t) => t.qualificationRate),
      },
      {
        label: 'Taux de conversion',
        value: f?.conversionRate != null ? `${Math.round(f.conversionRate)} %` : '—',
        delta:
          f?.conversionRate != null && prev?.conversionRate != null
            ? this._delta(f.conversionRate - prev.conversionRate, ' pts', 'vs période précédente', true)
            : null,
        trend: series((t) => t.conversionRate),
      },
      {
        label: 'Premier contact (moyenne)',
        value: formatMinutes(fc),
        delta:
          fc != null && prevFc != null && Math.round(fc - prevFc) !== 0
            ? {
                text: `${formatMinutes(Math.abs(fc - prevFc))}`,
                suffix: fc > prevFc ? 'plus lent que la période précédente' : 'plus rapide que la période précédente',
                // Plus court est mieux : la flèche monte quand le délai s'allonge, en rouge.
                good: fc < prevFc,
                up: fc > prevFc,
              }
            : null,
        trend:
          trendFc && trendFc.every((t) => !!t)
            ? trendFc.map((t) => weightedFirstContact(t) ?? 0)
            : null,
      },
    ];
  });

  public readonly funnelSteps = computed(() => {
    const f = this.funnel();
    if (!f) return [];
    const captured = f.totalCaptured ?? 0;
    const raw = [
      { label: 'Captés', count: captured },
      { label: 'Qualifiés', count: f.qualified ?? 0 },
      { label: 'Assignés', count: f.assigned ?? 0 },
      { label: 'Convertis', count: f.converted ?? 0 },
    ];
    return raw.map((step, i) => {
      const previous = i > 0 ? raw[i - 1].count : null;
      // Le dispatch n'exige pas la qualification : « Assignés » peut dépasser « Qualifiés ».
      // Le pourcentage est donné tel quel, seule la barre est bornée.
      const ofPrevious = previous ? Math.round((step.count / previous) * 100) : null;
      const width = captured ? Math.min(100, (step.count / captured) * 100) : 0;
      return {
        ...step,
        ofPrevious,
        width,
        hint:
          i === 0
            ? `${step.count} leads captés sur la période`
            : `${step.count} lead${step.count > 1 ? 's' : ''} sur ${captured} captés (${captured ? Math.round((step.count / captured) * 100) : 0} %), ${ofPrevious ?? 0} % de l'étape précédente`,
      };
    });
  });

  public readonly funnelOutcomes = computed(() => {
    const f = this.funnel();
    if (!f) return [];
    return [
      { label: 'Perdus', count: f.lost ?? 0 },
      { label: 'Disqualifiés', count: f.disqualified ?? 0 },
      { label: 'En qualification', count: f.qualifying ?? 0 },
    ];
  });

  public readonly breachRows = computed(() => {
    const users = this._users();
    const rows = [...this.breaches()]
      .sort((a, b) => (b.breachHours ?? 0) - (a.breachHours ?? 0))
      .map((b) => {
        const name = b.fullName?.trim() || b.phoneNumber || 'Lead sans nom';
        const agent = b.agentId ? users.get(b.agentId)?.name : null;
        return {
          leadId: b.leadId ?? '',
          name,
          initials: initialsOf(name),
          // Un retard de SLA porte sur l'échéance d'assignation : c'est le premier contact attendu.
          context: `Premier contact · ${agent ?? 'Non attribué'}`,
          delay: this._delayLabel(b.breachHours ?? 0),
        };
      });
    return this.showAllBreaches() ? rows : rows.slice(0, 4);
  });

  public readonly sourceRows = computed(() => {
    const rows = [...this.sources()]
      .filter((s) => (s.count ?? 0) > 0)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 6);
    const max = rows[0]?.count ?? 1;
    return rows.map((s) => ({
      label: SOURCE_LABELS[s.source ?? ''] ?? s.source ?? '—',
      count: s.count ?? 0,
      width: ((s.count ?? 0) / max) * 100,
    }));
  });

  public readonly agentRows = computed<AgentRow[]>(() => {
    const users = this._users();
    return [...this.agents()]
      .sort((a, b) => (b.totalAssigned ?? 0) - (a.totalAssigned ?? 0))
      .map((a) => {
        const user = a.agentId ? users.get(a.agentId) : undefined;
        const name = user?.name ?? 'Agent inconnu';
        return {
          id: a.agentId ?? '',
          name,
          agency: user?.agency ?? '',
          initials: initialsOf(name),
          assigned: a.totalAssigned ?? 0,
          slaRate: a.slaComplianceRate != null ? Math.round(a.slaComplianceRate) : null,
          late: a.contactedLate ?? 0,
          converted: a.convertedLeads ?? 0,
          firstContact: formatMinutes(a.avgFirstContactMinutes),
        };
      });
  });

  public readonly agentTableConfig = computed<TableConfig>(() => ({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
      totalElements: this.agentRows().length,
    },
  }));

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Leads', link: ['/leads'] },
      { label: 'Tableau de bord' },
    ]);

    const params = this._route.snapshot.queryParamMap;
    const period = params.get('period') as PeriodKey | null;
    if (period && this.periodKeys.includes(period)) this.periodKey.set(period);
    this.agencyId.set(params.get('agency') ?? '');

    this._loadAgencies();
    this._loadUsers();
    this._loadSlaTarget();
    this._refreshAll();
  }

  public setPeriod(key: PeriodKey): void {
    if (key === this.periodKey()) return;
    this.periodKey.set(key);
    this._syncUrl();
    this._refreshAll();
  }

  public onAgencyChange(value: string | null): void {
    this.agencyId.set(value ?? '');
    this._syncUrl();
    this._refreshAll();
  }

  /** Points d'une courbe de tendance pour un SVG de 96 × 32. */
  public sparkline(values: number[] | null): string {
    if (!values || values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return values
      .map((v, i) => `${((i / (values.length - 1)) * 96).toFixed(1)},${(30 - ((v - min) / range) * 28).toFixed(1)}`)
      .join(' ');
  }

  /** Réassigner depuis le tableau de bord : le drawer existant attend le lead complet. */
  public reassign(leadId: string): void {
    if (!leadId || this.reassigningLeadId()) return;
    this.reassigningLeadId.set(leadId);
    this._leadsApi
      .getLead(leadId)
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Le lead n\'a pas pu être chargé.');
          return of(null);
        }),
      )
      .subscribe((lead) => {
        this.reassigningLeadId.set(null);
        if (!lead) return;
        this._sideDrawer
          .open(ReassignLeadDrawer, { data: { lead } })
          .closed.subscribe((reassigned) => {
            if (reassigned) this._loadBreaches();
          });
      });
  }

  // ——— Chargements ———

  private _refreshAll(): void {
    this._loadFunnel();
    this._loadAgents();
    this._loadBreaches();
    this._loadSources();
  }

  private _loadFunnel(): void {
    const p = this.period();
    const agency = this.agencyId() || undefined;
    const prev = previousOf(p);
    this.funnelLoading.set(true);
    this.funnelError.set(false);
    this.previousFunnel.set(null);
    this.trendFunnels.set(null);

    this._analyticsApi
      .getLeadFunnelMetrics(isoDay(p.from), isoDay(p.to), agency)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.funnelError.set(true);
          return of(null);
        }),
      )
      .subscribe((f) => {
        this.funnel.set(f);
        this.funnelLoading.set(false);
      });

    // Comparaison et tendance : au mieux. Une erreur les fait disparaître, pas le chiffre.
    this._analyticsApi
      .getLeadFunnelMetrics(isoDay(prev.from), isoDay(prev.to), agency)
      .pipe(takeUntilDestroyed(this._destroyRef), catchError(() => of(null)))
      .subscribe((f) => this.previousFunnel.set(f));

    this._trend((from, to) => this._analyticsApi.getLeadFunnelMetrics(from, to, agency))
      .subscribe((series) => this.trendFunnels.set(series));
  }

  private _loadAgents(): void {
    const p = this.period();
    // L'ancienne page n'envoyait pas l'agence : le tableau des agents ignorait le filtre.
    const agency = this.agencyId() || undefined;
    const prev = previousOf(p);
    this.agentsLoading.set(true);
    this.agentsError.set(false);
    this.previousAgents.set(null);
    this.trendAgents.set(null);

    this._analyticsApi
      .getAgentPerformance(isoDay(p.from), isoDay(p.to), undefined, agency)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.agentsError.set(true);
          return of([] as AgentPerformanceDto[]);
        }),
      )
      .subscribe((a) => {
        this.agents.set(a ?? []);
        this.agentsLoading.set(false);
      });

    this._analyticsApi
      .getAgentPerformance(isoDay(prev.from), isoDay(prev.to), undefined, agency)
      .pipe(takeUntilDestroyed(this._destroyRef), catchError(() => of(null)))
      .subscribe((a) => this.previousAgents.set(a));

    this._trend((from, to) => this._analyticsApi.getAgentPerformance(from, to, undefined, agency))
      .subscribe((series) => this.trendAgents.set(series));
  }

  private _loadBreaches(): void {
    this.breachesLoading.set(true);
    this.breachesError.set(false);
    this._analyticsApi
      .getLeadSlaBreaches(undefined, this.agencyId() || undefined)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.breachesError.set(true);
          return of([] as SlaBreachDto[]);
        }),
      )
      .subscribe((b) => {
        this.breaches.set(b ?? []);
        this.breachesLoading.set(false);
      });
  }

  private _loadSources(): void {
    const p = this.period();
    this.sourcesError.set(false);
    this._leadsApi
      .getLeadStats(isoDay(p.from), isoDay(p.to), this.agencyId() || undefined)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.sourcesError.set(true);
          return of(null);
        }),
      )
      .subscribe((stats) => this.sources.set(stats?.bySource ?? []));
  }

  /** Une requête par tranche de la période ; une tranche en échec vaut null. */
  private _trend<T>(fetch: (from: string, to: string) => Observable<T>): Observable<(T | null)[]> {
    const calls = bucketsOf(this.period()).map((b) =>
      fetch(isoDay(b.from), isoDay(b.to)).pipe(catchError(() => of(null))),
    );
    return forkJoin(calls).pipe(takeUntilDestroyed(this._destroyRef));
  }

  private _loadAgencies(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((res: { items?: { id?: string; name?: string | null }[] | null }) => {
        this.agencyOptions.set([
          { label: 'Toutes les agences', value: '' },
          ...(res.items ?? []).map((a) => ({ label: a.name ?? '', value: a.id ?? '' })),
        ]);
      });
  }

  private _loadUsers(): void {
    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 500)
      .pipe(
        map((res) => res.items ?? []),
        catchError(() => of([])),
      )
      .subscribe((users) => {
        const byId = new Map<string, { name: string; agency: string }>();
        for (const u of users) {
          if (u.id) byId.set(u.id, { name: u.fullName || u.email || 'Utilisateur', agency: u.agencyName ?? '' });
        }
        this._users.set(byId);
      });
  }

  /** Réglage du tenant ; illisible sans droit d'administration, d'où la valeur par défaut. */
  private _loadSlaTarget(): void {
    this._settingsApi
      .getLeadSetting('sla-compliance-target-percent')
      .pipe(catchError(() => of(null)))
      .subscribe((setting) => {
        const value = Number(setting?.value ?? setting?.defaultValue);
        if (Number.isFinite(value) && value > 0 && value <= 100) this.slaTarget.set(value);
      });
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { period: this.periodKey(), agency: this.agencyId() || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private _delta(diff: number, unit: string, suffix: string, higherIsBetter: boolean): Kpi['delta'] {
    const rounded = Math.round(diff);
    if (rounded === 0) return { text: 'Stable', suffix, good: true, up: false, flat: true };
    return {
      text: `${Math.abs(rounded)}${unit}`,
      suffix,
      good: higherIsBetter ? rounded > 0 : rounded < 0,
      up: rounded > 0,
    };
  }

  private _delayLabel(hours: number): string {
    if (hours < 1) return `Retard de ${Math.max(1, Math.round(hours * 60))} min`;
    if (hours < 48) return `Retard de ${Math.round(hours)} h`;
    return `Retard de ${Math.round(hours / 24)} j`;
  }
}

export default AnalyticsDashboard;
