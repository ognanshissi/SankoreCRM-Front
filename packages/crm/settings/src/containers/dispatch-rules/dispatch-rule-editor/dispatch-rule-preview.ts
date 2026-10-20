import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import {
  DispatchingRuleDtoStrategyEnum,
  DispatchPreviewCandidate,
  DispatchPreviewResult,
  LeadDto,
  LeadsApiService,
} from '@sankore/crm-api';
import { CRITERIA, needsWeights, Weights } from '../dispatch-rules.shared';

interface PreviewSegment {
  key: string;
  color: string;
  value: number;
}

interface RankedCandidate {
  agentId: string;
  name: string;
  subtitle: string;
  score: number | null;
  segments: PreviewSegment[];
  blockedReason: string | null;
}

type PreviewState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; result: DispatchPreviewResult };

const CLOSED_STATUSES = ['Converted', 'Lost', 'Disqualified', 'Archived'];
const VISIBLE_CANDIDATES = 4;

/**
 * « Si ce lead arrivait maintenant » : classe les agents avec les réglages en cours d'édition,
 * avant tout enregistrement.
 *
 * Le serveur n'a pas d'aperçu pour une règle non enregistrée ; `previewLeadDispatch` renvoie en
 * revanche, par agent, les faits qui ne dépendent pas de la règle (langue et produit reconnus,
 * distance, charge, conversion). Le score est recalculé ici avec les poids et plafonds du
 * formulaire, selon la formule de `CompatibilityScorer` — si l'une change, l'autre doit suivre.
 */
@Component({
  selector: 'dispatch-rule-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasSpinner, TasIcon],
  template: `
    <div class="rounded-2xl bg-primary text-white p-5">
      <p class="text-[11px] font-semibold uppercase tracking-wider text-white/60">Aperçu en direct</p>
      <p class="text-base font-semibold mt-0.5">Si ce lead arrivait maintenant</p>

      <div class="mt-3 flex flex-col gap-1.5">
        @if (leadsLoading()) {
          <div class="flex justify-center py-6"><tas-spinner size="6" class="text-white"></tas-spinner></div>
        } @else if (leads().length === 0) {
          <p class="text-xs text-white/70 py-3">Aucun lead ouvert pour illustrer la règle.</p>
        } @else {
          @for (lead of leads(); track lead.id) {
            <button
              type="button"
              class="w-full text-left rounded-lg px-3 py-2 transition-colors"
              [class]="selectedLeadId() === lead.id ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'"
              [attr.aria-pressed]="selectedLeadId() === lead.id"
              (click)="selectLead(lead.id!)"
            >
              <p class="text-sm font-semibold truncate">{{ lead.fullName || 'Lead sans nom' }}</p>
              <p class="text-xs text-white/70 truncate">{{ leadDetails(lead) }}</p>
            </button>
          }
        }
      </div>
    </div>

    <div class="mt-3 rounded-2xl bg-white border border-slate-200 p-4">
      @switch (state()?.status) {
        @case ('loading') {
          <div class="flex justify-center py-10"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        }
        @case ('error') {
          <p class="text-xs text-slate-500 py-6 text-center">{{ errorMessage() }}</p>
        }
        @case ('ready') {
          @if (notice()) {
            <p class="text-xs text-slate-500 mb-3">{{ notice() }}</p>
          }
          @if (ranked().length === 0) {
            <p class="text-xs text-slate-500 py-6 text-center">Aucun agent disponible pour ce lead.</p>
          } @else {
            <div class="flex flex-col gap-2">
              @for (c of visibleCandidates(); track c.agentId; let i = $index) {
                <div
                  class="rounded-xl border px-3 py-2.5"
                  [class]="isWinner(i, c) ? 'border-primary ring-1 ring-primary bg-primary/5' : 'border-slate-200'"
                  [class.opacity-60]="c.blockedReason"
                >
                  <div class="flex items-center gap-3">
                    <span class="text-xs text-slate-400 tabular-nums w-3">{{ i + 1 }}</span>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-semibold text-slate-800 truncate">{{ c.name }}</p>
                      @if (c.blockedReason) {
                        <p class="text-xs text-functional-error truncate">{{ c.blockedReason }}</p>
                      } @else if (isWinner(i, c)) {
                        <p class="text-xs text-primary font-medium">Recevrait le lead</p>
                      } @else {
                        <p class="text-xs text-slate-500 truncate">{{ c.subtitle }}</p>
                      }
                    </div>
                    @if (c.score !== null) {
                      <span class="text-lg font-semibold tabular-nums" [class]="isWinner(i, c) ? 'text-primary' : 'text-slate-800'">
                        {{ c.score }}
                      </span>
                    }
                  </div>
                  @if (c.score !== null) {
                    <div class="mt-2 h-1.5 rounded-full bg-slate-100 flex overflow-hidden" aria-hidden="true">
                      @for (s of c.segments; track s.key) {
                        <span class="h-full" [class]="s.color" [style.width.%]="s.value"></span>
                      }
                    </div>
                  }
                </div>
              }
            </div>
            @if (ranked().length > visibleCount) {
              <button type="button" class="mt-2 text-xs font-medium text-primary hover:underline" (click)="showAll.set(!showAll())">
                {{ showAll() ? 'Réduire' : 'Voir les ' + ranked().length + ' agents' }}
              </button>
            }
            @if (scored()) {
              <p class="mt-3 text-xs text-slate-500">Barre colorée : contribution de chaque critère au score sur 100.</p>
              <p class="mt-1.5 text-xs text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                @for (c of criteria; track c.key) {
                  <span class="inline-flex items-center gap-1"><span class="w-2 h-2 rounded-sm" [class]="c.color"></span>{{ c.label }}</span>
                }
              </p>
            }
          }
        }
        @default {
          <p class="text-xs text-slate-500 py-6 text-center flex items-center justify-center gap-1.5">
            <tas-icon iconName="feather:arrow-up" style="font-size:12px"></tas-icon>
            Choisissez un lead pour voir qui le recevrait.
          </p>
        }
      }
    </div>
  `,
})
export class DispatchRulePreview implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);

  public readonly strategy = input.required<DispatchingRuleDtoStrategyEnum>();
  /** Parts normalisées (somme 100). */
  public readonly weights = input.required<Weights>();
  public readonly maxLeadsPerAgent = input.required<number>();
  public readonly maxTasksPerAgent = input.required<number>();
  public readonly antiMonopolyThreshold = input.required<number>();
  public readonly excludedAgentIds = input.required<string[]>();

  public readonly criteria = CRITERIA;
  public readonly visibleCount = VISIBLE_CANDIDATES;

  public readonly leadsLoading = signal(true);
  public readonly leads = signal<LeadDto[]>([]);
  public readonly selectedLeadId = signal<string | null>(null);
  public readonly showAll = signal(false);
  private readonly _previews = signal<Record<string, PreviewState>>({});

  public readonly state = computed(() => {
    const id = this.selectedLeadId();
    return id ? this._previews()[id] ?? null : null;
  });

  public readonly errorMessage = computed(() => {
    const s = this.state();
    return s?.status === 'error' ? s.message : '';
  });

  private readonly _result = computed(() => {
    const s = this.state();
    return s?.status === 'ready' ? s.result : null;
  });

  /** Le score n'a de sens que pour les stratégies à critères, et seulement si le serveur a fourni les faits. */
  public readonly scored = computed(() => {
    const result = this._result();
    return needsWeights(this.strategy()) && !!result?.candidates?.some((c) => !!c.factors);
  });

  public readonly notice = computed(() => {
    const result = this._result();
    if (!result) return '';
    if (needsWeights(this.strategy())) {
      return this.scored()
        ? ''
        : 'Le score ne peut pas être recalculé pour ce lead : la règle qui le traite aujourd\'hui ne calcule pas de critères. Voici les agents éligibles.';
    }
    switch (this.strategy()) {
      case DispatchingRuleDtoStrategyEnum.RoundRobin:
        return 'Le lead irait au prochain agent éligible, à tour de rôle.';
      case DispatchingRuleDtoStrategyEnum.WeightedRoundRobin:
        return 'Le lead irait en priorité aux agents éligibles les moins chargés.';
      default:
        return 'Agents éligibles pour ce lead.';
    }
  });

  public readonly ranked = computed<RankedCandidate[]>(() => {
    const result = this._result();
    if (!result) return [];
    const scored = this.scored();
    const rows = (result.candidates ?? []).map((c) => this._rank(c, scored));
    return rows.sort((a, b) => {
      if (!!a.blockedReason !== !!b.blockedReason) return a.blockedReason ? 1 : -1;
      return scored ? (b.score ?? 0) - (a.score ?? 0) : 0;
    });
  });

  public readonly visibleCandidates = computed(() =>
    this.showAll() ? this.ranked() : this.ranked().slice(0, VISIBLE_CANDIDATES),
  );

  ngOnInit(): void {
    this._leadsApi.listLeads(1, 20).pipe(catchError(() => of({ items: [] as LeadDto[] }))).subscribe((res) => {
      const open = (res.items ?? []).filter((l) => !!l.id && !CLOSED_STATUSES.includes(l.status ?? '')).slice(0, 3);
      this.leads.set(open);
      this.leadsLoading.set(false);
      if (open[0]?.id) this.selectLead(open[0].id);
    });
  }

  public selectLead(leadId: string): void {
    this.selectedLeadId.set(leadId);
    this.showAll.set(false);
    if (this._previews()[leadId]) return;

    this._setPreview(leadId, { status: 'loading' });
    this._leadsApi.previewLeadDispatch(leadId).subscribe({
      next: (result) => this._setPreview(leadId, { status: 'ready', result }),
      error: (err: HttpErrorResponse) =>
        this._setPreview(leadId, {
          status: 'error',
          message: err.status === 422
            ? 'Ce lead n\'est plus à attribuer : choisissez-en un autre.'
            : 'Impossible de calculer l\'aperçu pour ce lead.',
        }),
    });
  }

  public isWinner(index: number, candidate: RankedCandidate): boolean {
    return index === 0 && !candidate.blockedReason && this.scored();
  }

  public leadDetails(lead: LeadDto): string {
    return [lead.interestedProduct, lead.address?.city, lead.preferredLanguage].filter(Boolean).join(' · ') || 'Aucun détail';
  }

  private _setPreview(leadId: string, state: PreviewState): void {
    this._previews.update((p) => ({ ...p, [leadId]: state }));
  }

  private _rank(c: DispatchPreviewCandidate, scored: boolean): RankedCandidate {
    const f = c.factors;
    const activeLeads = f?.workload?.activeLeads;
    const subtitle = activeLeads !== undefined
      ? `${activeLeads} lead${activeLeads > 1 ? 's' : ''} ouvert${activeLeads > 1 ? 's' : ''}`
      : `${c.openTaskCount ?? 0} tâche(s) ouverte(s)`;

    let score: number | null = null;
    let segments: PreviewSegment[] = [];
    if (scored && f) {
      const w = this.weights();
      const maxLeads = this.maxLeadsPerAgent();
      const maxTasks = this.maxTasksPerAgent();
      const leadLoad = maxLeads <= 0 ? 0 : (f.workload?.activeLeads ?? 0) / maxLeads;
      const taskLoad = maxTasks <= 0 ? 0 : (f.workload?.openTasks ?? c.openTaskCount ?? 0) / maxTasks;
      const ratios: Weights = {
        language: f.language?.matched ? 1 : 0,
        product: f.product?.matched ? 1 : 0,
        geography: f.geography?.decayFactor ?? 0,
        workload: 1 - Math.min((leadLoad + taskLoad) / 2, 1),
        performance: f.performance?.conversionRate30d ?? 0,
        agency: f.agency?.matched ? 1 : 0,
      };
      segments = CRITERIA.map((cr) => ({ key: cr.key, color: cr.color, value: w[cr.key] * ratios[cr.key] }));
      score = Math.round(Math.min(100, segments.reduce((sum, s) => sum + s.value, 0)));
    }

    return {
      agentId: c.agentId ?? '',
      name: c.fullName ?? 'Agent',
      subtitle,
      score,
      segments,
      blockedReason: this._blockedReason(c),
    };
  }

  private _blockedReason(c: DispatchPreviewCandidate): string | null {
    if (c.agentId && this.excludedAgentIds().includes(c.agentId)) return 'Exclu de cette règle';
    const maxTasks = this.maxTasksPerAgent();
    if (maxTasks > 0 && (c.openTaskCount ?? 0) >= maxTasks) return `${c.openTaskCount} tâches ouvertes : plafond atteint`;
    if ((c.hotLeadsCount ?? 0) >= this.antiMonopolyThreshold()) return `${c.hotLeadsCount} leads chauds : plafond atteint`;
    return null;
  }
}
