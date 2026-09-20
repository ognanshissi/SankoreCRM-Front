import { Component, computed, effect, inject, input, signal, OnDestroy } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Anchor } from '@talisoft/ui/button';
import { LeadsApiService, LeadDto } from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { catchError, EMPTY } from 'rxjs';

interface LeadMenuItem {
  label: string;
  icon: string;
  route: string;
}

function leadStatusMeta(status: string | null | undefined): { label: string; severity: Severity } {
  switch (status) {
    case 'New':       return { label: 'Nouveau',  severity: 'info' };
    case 'Contacted': return { label: 'Contacté', severity: 'warning' };
    case 'Qualified': return { label: 'Qualifié', severity: 'warning' };
    case 'Converted': return { label: 'Converti', severity: 'success' };
    case 'Lost':      return { label: 'Perdu',    severity: 'error' };
    case 'Expired':   return { label: 'Expiré',   severity: 'neutral' };
    default:          return { label: status ?? '—', severity: 'neutral' };
  }
}

interface TemperatureMeta {
  label: string;
  key: string;
  colorClasses: string;
  dotClass: string;
}

function temperatureMeta(intentLevel: string | null | undefined): TemperatureMeta {
  switch (String(intentLevel)) {
    case '0': return { label: 'Froid',      key: 'COLD',    colorClasses: 'bg-slate-100 text-slate-700 border-slate-300',   dotClass: 'bg-slate-400' };
    case '1': return { label: 'Tiède',      key: 'WARM',    colorClasses: 'bg-blue-50 text-blue-700 border-blue-300',       dotClass: 'bg-blue-500' };
    case '2': return { label: 'Chaud',      key: 'HOT',     colorClasses: 'bg-amber-50 text-amber-700 border-amber-300',    dotClass: 'bg-amber-500' };
    case '3': return { label: 'Très chaud', key: 'VERY HOT', colorClasses: 'bg-red-50 text-red-700 border-red-300',         dotClass: 'bg-red-500' };
    default:  return { label: 'Inconnu',    key: 'UNKNOWN', colorClasses: 'bg-gray-50 text-gray-500 border-gray-300',       dotClass: 'bg-gray-400' };
  }
}

function scoreColor(score: number): { bg: string; text: string; bar: string } {
  if (score >= 70) return { bg: 'bg-green-50',  text: 'text-green-700', bar: 'bg-green-500' };
  if (score >= 40) return { bg: 'bg-amber-50',  text: 'text-amber-700', bar: 'bg-amber-500' };
  return               { bg: 'bg-red-50',    text: 'text-red-700',   bar: 'bg-red-400' };
}

interface ScoreFactor {
  label: string;
  value: string;
  impact: string;
}

function parseFactors(factorsJson: string | null | undefined): ScoreFactor[] {
  if (!factorsJson) return [];
  try {
    const parsed = JSON.parse(factorsJson);
    if (Array.isArray(parsed)) return parsed;
    return Object.entries(parsed).map(([key, val]: [string, any]) => ({
      label: key,
      value: typeof val === 'object' ? (val.value ?? val.detail ?? JSON.stringify(val)) : String(val),
      impact: typeof val === 'object' ? (val.impact ?? '') : '',
    }));
  } catch {
    return [];
  }
}

@Component({
  imports: [
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
    TasIcon,
    TasCard,
    TasSpinner,
    Anchor,
    TasTag,
  ],
  template: `
    @if (notFound()) {
      <!-- 404 screen -->
      <div class="flex flex-col items-center justify-center py-32 text-center">
        <div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
          <tas-icon iconName="feather:alert-circle" class="text-slate-400" style="font-size:28px"></tas-icon>
        </div>
        <h2 class="text-lg font-semibold text-slate-800 mb-1">Lead introuvable</h2>
        <p class="text-sm text-slate-500 mb-6 max-w-sm">
          Ce lead n'existe pas ou vous n'avez pas les droits pour y accéder.
        </p>
        <a [routerLink]="['/leads']" tas-button iconButton class="inline-flex items-center gap-2 text-sm">
          <tas-icon iconName="feather:arrow-left" style="font-size:14px"></tas-icon>
          Retour aux leads
        </a>
      </div>
    } @else {
      <!-- Header -->
      <div class="flex items-center gap-3 mb-4">
        <a [routerLink]="['/leads']" tas-button iconButton>
          <tas-icon iconName="feather:chevron-left"></tas-icon>
        </a>
        <div class="flex-1 min-w-0">
          @if (isLoading()) {
            <div class="h-5 w-48 bg-slate-200 rounded animate-pulse"></div>
          } @else {
            <h1 class="text-lg font-semibold text-slate-900 truncate">
              {{ displayName() }}
            </h1>
          }
        </div>
        @if (!isLoading() && lead()) {
          <tas-tag [severity]="statusMeta().severity">{{ statusMeta().label }}</tas-tag>
        }
      </div>

      <!-- Grid: sidebar + content -->
      <div class="grid grid-cols-4 gap-4">

        <!-- Sidebar -->
        <div class="col-span-1">
          <tas-card>
            <!-- Lead summary -->
            @if (isLoading()) {
              <div class="p-4 flex justify-center">
                <tas-spinner size="5" class="text-primary"></tas-spinner>
              </div>
            } @else if (lead()) {
              <div class="p-4 border-b border-gray-100">
                <p class="text-sm font-medium text-slate-800 truncate">{{ displayName() }}</p>
                @if (lead()!.email) {
                  <p class="text-xs text-slate-500 mt-0.5 truncate">{{ lead()!.email }}</p>
                }
                @if (lead()!.phoneNumber) {
                  <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <tas-icon iconName="feather:phone" class="inline-block w-3 h-3"></tas-icon>
                    {{ lead()!.phoneNumber }}
                  </p>
                }
                @if (lead()!.source) {
                  <p class="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <tas-icon iconName="feather:globe" class="inline-block w-3 h-3"></tas-icon>
                    {{ lead()!.source }}
                  </p>
                }
                <!-- Score & Temperature badge -->
                @if (lead()!.score != null || lead()!.intentLevel != null) {
                  <div class="mt-3 relative">
                    <button
                      type="button"
                      class="w-full flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      [class]="scoreBadgeClasses()"
                      (click)="toggleFactorsPanel()"
                      (keydown.enter)="toggleFactorsPanel()"
                      (keydown.space)="toggleFactorsPanel(); $event.preventDefault()"
                      [attr.aria-expanded]="showFactors()"
                      aria-controls="score-factors-panel"
                    >
                      <!-- Score circle -->
                      <div
                        class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold tabular-nums shrink-0"
                        [class]="scoreCircleClasses()"
                      >
                        {{ lead()!.score ?? '—' }}
                      </div>
                      <div class="flex-1 min-w-0 text-left">
                        <div class="flex items-center gap-1">
                          <span class="w-2 h-2 rounded-full shrink-0" [class]="tempMeta().dotClass"></span>
                          <span class="text-xs font-semibold truncate">{{ tempMeta().label }}</span>
                        </div>
                        <span class="text-[10px] opacity-70">Score {{ lead()!.score ?? 0 }}/100</span>
                      </div>
                      <tas-icon
                        [iconName]="showFactors() ? 'feather:chevron-up' : 'feather:chevron-down'"
                        class="shrink-0 opacity-50"
                        style="font-size:14px"
                      ></tas-icon>
                    </button>

                    <!-- Factors detail panel -->
                    @if (showFactors()) {
                      <div
                        id="score-factors-panel"
                        class="mt-2 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden"
                        role="region"
                        aria-label="Détail du score"
                      >
                        <div class="px-3 py-2 border-b border-slate-100 bg-slate-50">
                          <p class="text-xs font-semibold text-slate-700">Facteurs du score</p>
                        </div>
                        @if (scoreFactors().length === 0) {
                          <div class="px-3 py-4 text-center">
                            <p class="text-xs text-slate-400">Aucun détail disponible</p>
                          </div>
                        } @else {
                          <div class="divide-y divide-slate-100">
                            @for (factor of scoreFactors(); track factor.label) {
                              <div class="px-3 py-2 flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                  <p class="text-xs font-medium text-slate-700 truncate">{{ factor.label }}</p>
                                  <p class="text-[10px] text-slate-500 truncate">{{ factor.value }}</p>
                                </div>
                                @if (factor.impact) {
                                  <span
                                    class="text-[10px] font-semibold tabular-nums shrink-0"
                                    [class]="factor.impact.startsWith('-') ? 'text-red-600' : 'text-green-600'"
                                  >
                                    {{ factor.impact.startsWith('-') ? '' : '+' }}{{ factor.impact }}
                                  </span>
                                }
                              </div>
                            }
                          </div>
                        }
                        <div class="px-3 py-2 border-t border-slate-100 bg-slate-50">
                          <div class="flex items-center justify-between">
                            <span class="text-[10px] text-slate-400">Température</span>
                            <span class="inline-flex items-center gap-1 text-xs font-medium">
                              <span class="w-1.5 h-1.5 rounded-full" [class]="tempMeta().dotClass"></span>
                              {{ tempMeta().label }}
                            </span>
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Menu items -->
            @for (item of menuItems; track item.route) {
              <a
                class="px-4 py-3 hover:bg-gray-200 flex items-center gap-2 text-sm"
                [routerLink]="item.route"
                [routerLinkActive]="'is-link-active'"
              >
                <tas-icon [iconName]="item.icon"></tas-icon>
                <span>{{ item.label }}</span>
              </a>
            }
          </tas-card>
        </div>

        <!-- Page content -->
        <div class="col-span-3 h-[calc(100vh_-_130px)] overflow-y-auto">
          <router-outlet></router-outlet>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .is-link-active {
        background-color: rgba(var(--tas-color-primary), 0.2);
        color: var(--tas-color-primary);
      }
    `,
  ],
})
export class EditLeadNavigation implements OnDestroy {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public notFound = signal(false);
  public showFactors = signal(false);
  public latestFactorsJson = signal<string | null>(null);

  public readonly scoreFactors = computed(() => parseFactors(this.latestFactorsJson()));

  public readonly menuItems: LeadMenuItem[] = [
    { label: 'Informations',  icon: 'feather:user',        route: 'informations' },
    { label: 'Qualification', icon: 'feather:clipboard',    route: 'qualification' },
    { label: 'Score',         icon: 'feather:bar-chart-2',  route: 'score' },
    { label: 'Timeline',      icon: 'feather:clock',        route: 'timeline' },
    { label: 'Tâches',        icon: 'feather:check-square', route: 'taches' },
    { label: 'Activités',     icon: 'feather:activity',     route: 'activites' },
    { label: 'Doublons',      icon: 'feather:copy',         route: 'doublons' },
    { label: 'Consentement',  icon: 'feather:shield',       route: 'consentement' },
  ];

  constructor() {
    effect(() => {
      const id = this.id();
      this.isLoading.set(true);
      this.notFound.set(false);
      this._stopPolling();

      this._leadsApiService.getLead(id).pipe(
        catchError((err) => {
          this.isLoading.set(false);
          if (err.status === 404 || err.status === 403) {
            this.notFound.set(true);
          }
          return EMPTY;
        }),
      ).subscribe((lead) => {
        this.lead.set(lead);
        this.isLoading.set(false);
        this._breadcrumbService.set([
          { label: 'Leads', link: ['/leads'] },
          { label: this._displayName(lead) },
        ]);
        this._loadScoreFactors(id);
        this._startPolling(id);
      });
    });
  }

  ngOnDestroy(): void {
    this._stopPolling();
  }

  public displayName(): string {
    return this._displayName(this.lead());
  }

  public statusMeta(): { label: string; severity: Severity } {
    return leadStatusMeta(this.lead()?.status);
  }

  public tempMeta(): TemperatureMeta {
    return temperatureMeta(this.lead()?.intentLevel);
  }

  public scoreBadgeClasses(): string {
    return temperatureMeta(this.lead()?.intentLevel).colorClasses;
  }

  public scoreCircleClasses(): string {
    const s = this.lead()?.score ?? 0;
    const c = scoreColor(s);
    return `${c.bg} ${c.text}`;
  }

  public toggleFactorsPanel(): void {
    this.showFactors.update((v) => !v);
  }

  private _loadScoreFactors(leadId: string): void {
    this._leadsApiService.getLeadScoreHistory(leadId).pipe(
      catchError(() => EMPTY),
    ).subscribe((history) => {
      const latest = history?.[0];
      this.latestFactorsJson.set(latest?.factorsJson ?? null);
    });
  }

  /** Poll every 30s to pick up real-time score recalculations */
  private _startPolling(leadId: string): void {
    this._pollTimer = setInterval(() => {
      this._leadsApiService.getLead(leadId).pipe(
        catchError(() => EMPTY),
      ).subscribe((lead) => {
        const current = this.lead();
        if (current && (current.score !== lead.score || current.intentLevel !== lead.intentLevel)) {
          this.lead.set(lead);
          this._loadScoreFactors(leadId);
        }
      });
    }, 30_000);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _displayName(lead: LeadDto | null | undefined): string {
    if (!lead) return 'Lead';
    if (lead.fullName) return lead.fullName;
    const parts = [lead.firstName, lead.lastName].filter(Boolean);
    return parts.length ? parts.join(' ') : lead.phoneNumber ?? lead.email ?? 'Lead';
  }
}

export default EditLeadNavigation;
