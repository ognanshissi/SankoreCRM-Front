import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  DispatchingRulesApiService,
  DispatchingRuleDtoStrategyEnum,
  ScoringWeightsDto,
  UsersApiService,
  UserDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import {
  STRATEGIES,
  WEIGHT_KEYS,
  WEIGHT_LABELS,
  DEFAULT_WEIGHTS,
  needsWeights,
} from './dispatch-rules.shared';

@Component({
  selector: 'create-dispatch-rule',
  imports: [
    FormsModule,
    RouterLink,
    TasCard,
    TasSpinner,
    TasIcon,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    Anchor,
  ],
  template: `
    <div class="max-w-3xl pb-6 flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <a [routerLink]="['/settings/dispatch-rules']" tas-button iconButton>
            <tas-icon iconName="feather:chevron-left"></tas-icon>
          </a>
          <div>
            <h1 class="text-lg font-semibold text-slate-800">
              Nouvelle stratégie d'affectation
            </h1>
            <p class="text-xs text-slate-400 mt-0.5">
              Configurez comment les leads seront automatiquement assignés aux
              agents.
            </p>
          </div>
        </div>
      </div>

      <!-- Name -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">Identification</p>
        </div>
        <div class="p-4">
          <tas-form-field>
            <tas-label
              >Nom de la règle <span class="text-red-500">*</span></tas-label
            >
            <input
              tasInput
              type="text"
              placeholder="Ex : Distribution par compatibilité"
              [ngModel]="name()"
              (ngModelChange)="name.set($event)"
            />
          </tas-form-field>
        </div>
      </tas-card>

      <!-- Strategy selection -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">
            Stratégie d'affectation
          </p>
          <p class="text-xs text-slate-400 mt-0.5">
            Choisissez l'algorithme de distribution des leads.
          </p>
        </div>
        <div class="p-4 grid grid-cols-1 gap-2">
          @for (opt of strategies; track opt.key) {
            <button
              type="button"
              class="w-full text-left p-3 rounded-lg border transition-all"
              [class]="
                strategy() === opt.key
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-slate-200 hover:border-slate-300'
              "
              (click)="strategy.set(opt.key)"
            >
              <div class="flex items-center gap-3">
                <div
                  class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0"
                >
                  <tas-icon
                    [iconName]="opt.icon"
                    style="font-size:14px"
                  ></tas-icon>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-slate-800">
                    {{ opt.label }}
                  </p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    {{ opt.description }}
                  </p>
                </div>
                @if (strategy() === opt.key) {
                  <tas-icon
                    iconName="feather:check-circle"
                    class="text-primary shrink-0"
                    style="font-size:18px"
                  ></tas-icon>
                }
              </div>
            </button>
          }
        </div>
      </tas-card>

      <!-- Scoring weights -->
      @if (showWeights()) {
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">
              Pondération des critères
            </p>
            <p class="text-xs text-slate-400 mt-0.5">
              Ajustez l'importance relative de chaque facteur (0–100).
            </p>
          </div>
          <div class="p-4 flex flex-col gap-3">
            @for (wk of weightKeys; track wk) {
              <div class="flex items-center gap-3">
                <span class="text-sm text-slate-700 w-32 shrink-0">{{
                  weightLabel(wk)
                }}</span>
                <div class="flex-1">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    class="w-full accent-primary"
                    [ngModel]="weights()[wk] ?? 50"
                    (ngModelChange)="setWeight(wk, $event)"
                  />
                </div>
                <span
                  class="text-sm font-semibold text-slate-800 tabular-nums w-8 text-right"
                >
                  {{ weights()[wk] ?? 50 }}
                </span>
              </div>
            }
          </div>
        </tas-card>
      }

      <!-- Constraints -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">Contraintes</p>
          <p class="text-xs text-slate-400 mt-0.5">
            Paramètres optionnels pour limiter et prioriser la distribution.
          </p>
        </div>
        <div class="p-4 grid grid-cols-2 gap-4">
          <tas-form-field>
            <tas-label>Max leads par agent</tas-label>
            <input
              tasInput
              type="number"
              placeholder="50"
              [ngModel]="maxLeads()"
              (ngModelChange)="maxLeads.set($event)"
            />
          </tas-form-field>
          <tas-form-field>
            <tas-label>SLA premier contact</tas-label>
            <input
              tasInput
              type="text"
              placeholder="04:00:00"
              [ngModel]="sla()"
              (ngModelChange)="sla.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">Format HH:MM:SS</p>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Seuil anti-monopole</tas-label>
            <input
              tasInput
              type="number"
              placeholder="80"
              [ngModel]="antiMonopoly()"
              (ngModelChange)="antiMonopoly.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">
              % maximum de leads qu'un agent peut détenir
            </p>
          </tas-form-field>
          <tas-form-field>
            <tas-label>Priorité</tas-label>
            <input
              tasInput
              type="number"
              placeholder="1"
              [ngModel]="priority()"
              (ngModelChange)="priority.set($event)"
            />
            <p class="text-[10px] text-slate-400 mt-1">
              Les règles de priorité basse sont évaluées en premier
            </p>
          </tas-form-field>
        </div>
      </tas-card>

      <!-- Excluded agents -->
      <tas-card class="block">
        <div class="p-4 border-b border-slate-100">
          <p class="text-sm font-semibold text-slate-700">Agents exclus</p>
          <p class="text-xs text-slate-400 mt-0.5">
            Sélectionnez les agents à exclure de cette règle d'affectation.
          </p>
        </div>
        <div class="p-4">
          <!-- Search -->
          <div class="flex items-end gap-2 mb-3">
            <tas-form-field class="flex-1">
              <tas-label>Rechercher un agent</tas-label>
              <input
                tasInput
                type="text"
                placeholder="Nom ou e-mail..."
                [ngModel]="agentSearch()"
                (ngModelChange)="agentSearch.set($event)"
              />
            </tas-form-field>
          </div>

          <!-- Available agents -->
          @if (filteredAgents().length > 0) {
            <div class="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
              @for (agent of filteredAgents(); track agent.id) {
                <button
                  type="button"
                  class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                  [class.bg-red-50]="isExcluded(agent.id!)"
                  (click)="toggleExcluded(agent.id!)"
                >
                  <div
                    class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                    [class]="isExcluded(agent.id!) ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'"
                  >
                    {{ agentInitials(agent) }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-slate-800 truncate">{{ agent.fullName ?? agent.email }}</p>
                    @if (agent.agencyName) {
                      <p class="text-[10px] text-slate-400">{{ agent.agencyName }}</p>
                    }
                  </div>
                  @if (isExcluded(agent.id!)) {
                    <tas-icon iconName="feather:x-circle" class="text-red-400 shrink-0" style="font-size:14px"></tas-icon>
                  } @else {
                    <tas-icon iconName="feather:plus-circle" class="text-slate-300 shrink-0" style="font-size:14px"></tas-icon>
                  }
                </button>
              }
            </div>
          } @else if (agentSearch()) {
            <p class="text-xs text-slate-400 py-2">Aucun agent trouvé pour « {{ agentSearch() }} ».</p>
          }

          <!-- Excluded badges -->
          @if (excludedAgentIds().length > 0) {
            <div class="mt-3">
              <p class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1.5">
                {{ excludedAgentIds().length }} agent(s) exclu(s)
              </p>
              <div class="flex flex-wrap gap-1.5">
                @for (id of excludedAgentIds(); track id) {
                  <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">
                    {{ excludedAgentName(id) }}
                    <button type="button" class="text-red-400 hover:text-red-600" (click)="toggleExcluded(id)">
                      <tas-icon iconName="feather:x" style="font-size:10px"></tas-icon>
                    </button>
                  </span>
                }
              </div>
            </div>
          }
        </div>
      </tas-card>

      <!-- Info -->
      <div
        class="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2"
      >
        <tas-icon
          iconName="feather:info"
          class="text-blue-500 shrink-0"
          style="font-size:14px"
        ></tas-icon>
        <p class="text-xs text-blue-700">
          La règle sera créée en état <strong>inactif</strong>. Vous pourrez la
          simuler puis l'activer depuis la page de modification.
        </p>
      </div>

      <!-- Bottom action -->
      <div class="flex items-center justify-end gap-3">
        <a
          [routerLink]="['/settings/dispatch-rules']"
          tas-outlined-button
          color="primary"
          >Annuler</a
        >
        <button
          tas-raised-button
          color="primary"
          type="button"
          [disabled]="isSaving() || !name()"
          [isLoading]="isSaving()"
          (click)="create()"
        >
          <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
          Créer la règle
        </button>
      </div>
    </div>
  `,
})
export class CreateDispatchRulePage implements OnInit {
  private readonly _api = inject(DispatchingRulesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly strategies = STRATEGIES;
  public readonly weightKeys = WEIGHT_KEYS;

  public name = signal('');
  public strategy = signal<DispatchingRuleDtoStrategyEnum>(
    DispatchingRuleDtoStrategyEnum.RoundRobin,
  );
  public weights = signal<ScoringWeightsDto>({ ...DEFAULT_WEIGHTS });
  public maxLeads = signal<number | null>(null);
  public sla = signal('');
  public antiMonopoly = signal<number | null>(null);
  public priority = signal<number | null>(null);
  public isSaving = signal(false);

  public showWeights = computed(() => needsWeights(this.strategy()));

  // Excluded agents
  public allAgents = signal<UserDto[]>([]);
  public agentSearch = signal('');
  public excludedAgentIds = signal<string[]>([]);

  public filteredAgents = computed(() => {
    const q = this.agentSearch().toLowerCase().trim();
    const agents = this.allAgents();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.fullName?.toLowerCase().includes(q) ||
        a.email?.toLowerCase().includes(q) ||
        a.agencyName?.toLowerCase().includes(q),
    );
  });

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: "Stratégies d'affectation", link: ['/settings/dispatch-rules'] },
      { label: 'Nouvelle règle' },
    ]);
    this._usersApi.listUsers(undefined, undefined, undefined, 1, 500).pipe(
      catchError(() => of({ items: [] as UserDto[] })),
    ).subscribe((res) => {
      this.allAgents.set(res.items ?? []);
    });
  }

  public isExcluded(id: string): boolean {
    return this.excludedAgentIds().includes(id);
  }

  public toggleExcluded(id: string): void {
    this.excludedAgentIds.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  public agentInitials(agent: UserDto): string {
    const name = agent.fullName ?? agent.email ?? '';
    const parts = name.split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  }

  public excludedAgentName(id: string): string {
    const agent = this.allAgents().find((a) => a.id === id);
    return agent?.fullName ?? agent?.email ?? id.slice(0, 8);
  }

  public weightLabel(key: keyof ScoringWeightsDto): string {
    return WEIGHT_LABELS[key] ?? key;
  }

  public setWeight(key: keyof ScoringWeightsDto, value: number): void {
    this.weights.update((w) => ({ ...w, [key]: value }));
  }

  public create(): void {
    if (!this.name()) return;
    this.isSaving.set(true);

    this._api
      .createDispatchingRule({
        name: this.name(),
        strategy: this.strategy() as any,
        weights: needsWeights(this.strategy()) ? this.weights() : undefined,
        maxLeadsPerAgent: this.maxLeads() ?? undefined,
        firstContactSla: this.sla() || undefined,
        antiMonopolyThreshold: this.antiMonopoly() ?? undefined,
        priority: this.priority() ?? undefined,
        excludedAgentIds: this.excludedAgentIds().length > 0 ? this.excludedAgentIds() : undefined,
      })
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de créer la règle.');
          this.isSaving.set(false);
          return EMPTY;
        }),
      )
      .subscribe((ruleId) => {
        this._snackbar.success(
          'Règle créée',
          'La stratégie a été créée. Vous pouvez la simuler avant activation.',
        );
        this.isSaving.set(false);
        this._router.navigate(['/settings/dispatch-rules']);
      });
  }
}

export default CreateDispatchRulePage;
