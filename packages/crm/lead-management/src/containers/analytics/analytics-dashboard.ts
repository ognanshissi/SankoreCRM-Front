import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSelect } from '@talisoft/ui/select';
import {
  LeadsApiService,
  LeadsAnalyticsApiService,
  AgenciesApiService,
  LeadStatsDto,
  FunnelMetricsDto,
  AgentPerformanceDto,
  SlaBreachDto,
} from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService } from '@sankore/crm/common';
import { WidgetWrapper } from './widgets/widget-wrapper';

interface PeriodOption { label: string; value: string; from: string; to: string }

function buildPeriods(): PeriodOption[] {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const sub = (days: number) => { const d = new Date(now); d.setDate(d.getDate() - days); return d; };
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  return [
    { label: '7 derniers jours',  value: '7d',    from: fmt(sub(7)),  to: fmt(now) },
    { label: '30 derniers jours', value: '30d',   from: fmt(sub(30)), to: fmt(now) },
    { label: '90 derniers jours', value: '90d',   from: fmt(sub(90)), to: fmt(now) },
    { label: 'Ce mois',          value: 'month', from: fmt(startOfMonth), to: fmt(now) },
    { label: 'Cette année',      value: 'year',  from: fmt(startOfYear),  to: fmt(now) },
  ];
}

@Component({
  selector: 'analytics-dashboard',
  imports: [FormsModule, TasCard, TasSpinner, TasIcon, TasTag, Button, TasSelect, WidgetWrapper],
  template: `
    <div class="pb-6">
      <!-- Header -->
      <div class="flex items-start justify-between mb-5">
        <div>
          <h1 class="text-lg font-semibold text-slate-800">Tableau de bord</h1>
          <p class="text-sm text-slate-400 mt-0.5">Acquisition, conversion et performance agent.</p>
        </div>
        <div class="flex items-center gap-3">
          <div class="w-52">
            <tas-select
              [options]="agencyOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="Agence"
              [ngModel]="selectedAgency()"
              (ngModelChange)="onAgencyChange($event)"
            ></tas-select>
          </div>
          <div class="flex border border-slate-200 rounded-lg overflow-hidden">
            @for (p of periods; track p.value) {
              <button
                type="button"
                class="px-3 py-1.5 text-xs transition-colors"
                [class]="selectedPeriod() === p.value
                  ? 'bg-primary text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50'"
                (click)="onPeriodChange(p.value)"
              >
                {{ p.label }}
              </button>
            }
          </div>
        </div>
      </div>

      <!-- KPI row -->
      <div class="grid grid-cols-4 gap-3 mb-5">
        <widget-wrapper title="Leads capturés" icon="feather:inbox"
          [isLoading]="funnelLoading()" [hasError]="funnelError()" (retry)="loadFunnel()">
          <div class="p-4">
            <p class="text-2xl font-bold text-slate-800 tabular-nums">{{ funnel()?.totalCaptured ?? 0 }}</p>
          </div>
        </widget-wrapper>
        <widget-wrapper title="Taux de qualification" icon="feather:clipboard"
          [isLoading]="funnelLoading()" [hasError]="funnelError()" (retry)="loadFunnel()">
          <div class="p-4">
            <p class="text-2xl font-bold text-slate-800 tabular-nums">{{ fmtPct(funnel()?.qualificationRate) }}</p>
          </div>
        </widget-wrapper>
        <widget-wrapper title="Taux de conversion" icon="feather:trending-up"
          [isLoading]="funnelLoading()" [hasError]="funnelError()" (retry)="loadFunnel()">
          <div class="p-4">
            <p class="text-2xl font-bold tabular-nums" [class]="(funnel()?.conversionRate ?? 0) > 0.1 ? 'text-green-600' : 'text-slate-800'">
              {{ fmtPct(funnel()?.conversionRate) }}
            </p>
          </div>
        </widget-wrapper>
        <widget-wrapper title="Leads perdus" icon="feather:x-circle"
          [isLoading]="funnelLoading()" [hasError]="funnelError()" (retry)="loadFunnel()">
          <div class="p-4">
            <p class="text-2xl font-bold text-red-600 tabular-nums">{{ funnel()?.lost ?? 0 }}</p>
            <p class="text-xs text-slate-400 mt-0.5">{{ fmtPct(funnel()?.lossRate) }} de perte</p>
          </div>
        </widget-wrapper>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-4">
        <!-- Funnel breakdown -->
        <widget-wrapper title="Entonnoir de conversion" icon="feather:filter"
          [isLoading]="funnelLoading()" [hasError]="funnelError()" (retry)="loadFunnel()">
          <div class="p-4">
            @for (stage of funnelStages(); track stage.label) {
              <div class="flex items-center gap-3 mb-2">
                <span class="text-xs text-slate-500 w-28 shrink-0 truncate">{{ stage.label }}</span>
                <div class="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    [style.width.%]="stage.pct"
                    [style.background-color]="stage.color"
                  ></div>
                </div>
                <span class="text-xs font-semibold text-slate-700 tabular-nums w-10 text-right">{{ stage.count }}</span>
              </div>
            }
          </div>
        </widget-wrapper>

        <!-- SLA Breaches -->
        <widget-wrapper title="Violations SLA" icon="feather:alert-triangle"
          [isLoading]="slaLoading()" [hasError]="slaError()" (retry)="loadSlaBreaches()">
          @if (slaBreaches().length === 0) {
            <div class="p-4 flex flex-col items-center justify-center py-8 text-center">
              <tas-icon iconName="feather:check-circle" class="text-green-300 mb-2" style="font-size:24px"></tas-icon>
              <p class="text-xs text-slate-400">Aucune violation SLA</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100 max-h-[280px] overflow-y-auto">
              @for (b of slaBreaches().slice(0, 10); track b.leadId) {
                <div class="px-4 py-2.5 flex items-center gap-3">
                  <div class="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                    <tas-icon iconName="feather:alert-octagon" class="text-red-500" style="font-size:10px"></tas-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-slate-800 truncate">{{ b.fullName ?? b.leadId }}</p>
                    <p class="text-[10px] text-slate-400">{{ b.breachHours }}h de retard</p>
                  </div>
                </div>
              }
            </div>
            @if (slaBreaches().length > 10) {
              <div class="p-3 border-t border-slate-100 text-center">
                <span class="text-xs text-slate-400">+ {{ slaBreaches().length - 10 }} autre(s)</span>
              </div>
            }
          }
        </widget-wrapper>
      </div>

      <!-- Agent performance -->
      <widget-wrapper title="Performance des agents" icon="feather:users"
        [isLoading]="agentsLoading()" [hasError]="agentsError()" (retry)="loadAgentPerformance()">
        @if (agents().length === 0) {
          <div class="p-4 flex flex-col items-center justify-center py-8 text-center">
            <tas-icon iconName="feather:users" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
            <p class="text-xs text-slate-400">Aucune donnée agent pour cette période</p>
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="bg-slate-50 text-slate-500">
                  <th class="text-left px-4 py-2.5 font-medium">Agent</th>
                  <th class="text-right px-4 py-2.5 font-medium">Assignés</th>
                  <th class="text-right px-4 py-2.5 font-medium">Contactés SLA</th>
                  <th class="text-right px-4 py-2.5 font-medium">En retard</th>
                  <th class="text-right px-4 py-2.5 font-medium">Non contactés</th>
                  <th class="text-right px-4 py-2.5 font-medium">SLA %</th>
                  <th class="text-right px-4 py-2.5 font-medium">Convertis</th>
                  <th class="text-right px-4 py-2.5 font-medium">Temps moyen</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (a of agents(); track a.agentId) {
                  <tr class="hover:bg-slate-50">
                    <td class="px-4 py-2.5 font-medium text-slate-800">{{ a.agentId }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{{ a.totalAssigned ?? 0 }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-green-600">{{ a.contactedWithinSla ?? 0 }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-amber-600">{{ a.contactedLate ?? 0 }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-red-500">{{ a.notContacted ?? 0 }}</td>
                    <td class="px-4 py-2.5 text-right">
                      <div class="inline-flex items-center gap-1">
                        <div class="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            class="h-full rounded-full"
                            [class]="(a.slaComplianceRate ?? 0) >= 80 ? 'bg-green-500' : (a.slaComplianceRate ?? 0) >= 50 ? 'bg-amber-500' : 'bg-red-400'"
                            [style.width.%]="a.slaComplianceRate ?? 0"
                          ></div>
                        </div>
                        <span class="tabular-nums font-semibold"
                          [class]="(a.slaComplianceRate ?? 0) >= 80 ? 'text-green-600' : (a.slaComplianceRate ?? 0) >= 50 ? 'text-amber-600' : 'text-red-500'">
                          {{ (a.slaComplianceRate ?? 0).toFixed(0) }}%
                        </span>
                      </div>
                    </td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-slate-700">{{ a.convertedLeads ?? 0 }}</td>
                    <td class="px-4 py-2.5 text-right tabular-nums text-slate-500">
                      {{ a.avgFirstContactMinutes != null ? a.avgFirstContactMinutes.toFixed(0) + ' min' : '—' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </widget-wrapper>
    </div>
  `,
})
export class AnalyticsDashboard implements OnInit {
  private readonly _analyticsApi = inject(LeadsAnalyticsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly periods = buildPeriods();

  // Filters
  public selectedPeriod = signal('30d');
  public selectedAgency = signal('');
  public agencyOptions = signal<{ label: string; value: string }[]>([{ label: 'Toutes mes agences', value: '' }]);

  // Widget states — each independent
  public funnel = signal<FunnelMetricsDto | null>(null);
  public funnelLoading = signal(false);
  public funnelError = signal(false);

  public agents = signal<AgentPerformanceDto[]>([]);
  public agentsLoading = signal(false);
  public agentsError = signal(false);

  public slaBreaches = signal<SlaBreachDto[]>([]);
  public slaLoading = signal(false);
  public slaError = signal(false);

  public readonly funnelStages = computed(() => {
    const f = this.funnel();
    if (!f) return [];
    const max = f.totalCaptured || 1;
    const stages = [
      { label: 'Capturés',     count: f.totalCaptured ?? 0, color: '#6366f1' },
      { label: 'En qualification', count: f.qualifying ?? 0, color: '#8b5cf6' },
      { label: 'Qualifiés',    count: f.qualified ?? 0,     color: '#3b82f6' },
      { label: 'Assignés',     count: f.assigned ?? 0,      color: '#0ea5e9' },
      { label: 'Convertis',    count: f.converted ?? 0,     color: '#22c55e' },
      { label: 'Perdus',       count: f.lost ?? 0,          color: '#ef4444' },
      { label: 'Disqualifiés', count: f.disqualified ?? 0,  color: '#94a3b8' },
    ];
    return stages.map((s) => ({ ...s, pct: Math.round((s.count / max) * 100) }));
  });

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Leads', link: ['/leads'] }, { label: 'Tableau de bord' }]);
    this._loadAgencies();
    this._refreshAll();
  }

  public fmtPct(rate: number | undefined | null): string {
    if (rate == null) return '—';
    return (rate * 100).toFixed(1) + '%';
  }

  public onPeriodChange(value: string): void {
    this.selectedPeriod.set(value);
    this._refreshAll();
  }

  public onAgencyChange(value: string): void {
    this.selectedAgency.set(value);
    this._refreshAll();
  }

  // ——— Independent widget loaders ———

  public loadFunnel(): void {
    const p = this._currentPeriod();
    this.funnelLoading.set(true);
    this.funnelError.set(false);
    this._analyticsApi.getLeadFunnelMetrics(p.from, p.to, this.selectedAgency() || undefined).pipe(
      catchError(() => { this.funnelError.set(true); return of(null); }),
    ).subscribe((f) => { this.funnel.set(f); this.funnelLoading.set(false); });
  }

  public loadAgentPerformance(): void {
    const p = this._currentPeriod();
    this.agentsLoading.set(true);
    this.agentsError.set(false);
    this._analyticsApi.getAgentPerformance(p.from, p.to).pipe(
      catchError(() => { this.agentsError.set(true); return of([]); }),
    ).subscribe((a) => { this.agents.set(a ?? []); this.agentsLoading.set(false); });
  }

  public loadSlaBreaches(): void {
    this.slaLoading.set(true);
    this.slaError.set(false);
    this._analyticsApi.getLeadSlaBreaches(undefined, this.selectedAgency() || undefined).pipe(
      catchError(() => { this.slaError.set(true); return of([]); }),
    ).subscribe((b) => { this.slaBreaches.set(b ?? []); this.slaLoading.set(false); });
  }

  // ——— Private ———

  private _refreshAll(): void {
    this.loadFunnel();
    this.loadAgentPerformance();
    this.loadSlaBreaches();
  }

  private _currentPeriod(): { from: string; to: string } {
    return this.periods.find((p) => p.value === this.selectedPeriod()) ?? this.periods[0];
  }

  private _loadAgencies(): void {
    this._agenciesApi.listAgencies(false, 1, 200).pipe(
      catchError(() => of({ items: [] })),
    ).subscribe((res: any) => {
      this.agencyOptions.set([
        { label: 'Toutes mes agences', value: '' },
        ...(res.items ?? []).map((a: any) => ({ label: a.name ?? '', value: a.id ?? '' })),
      ]);
    });
  }
}

export default AnalyticsDashboard;
