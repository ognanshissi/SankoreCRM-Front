import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  DispatchingRulesApiService,
  DispatchingRuleDto,
  DispatchingRuleDtoStrategyEnum,
  ScoringWeightsDto,
  SimulateDispatchResult,
  LeadsApiService,
  LeadDto,
  UsersApiService,
  UserDto,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import {
  STRATEGIES,
  WEIGHT_KEYS,
  WEIGHT_LABELS,
  DEFAULT_WEIGHTS,
  strategySeverity,
  strategyLabel,
  needsWeights,
} from './dispatch-rules.shared';

@Component({
  selector: 'edit-dispatch-rule',
  imports: [
    FormsModule, RouterLink, TasCard, TasSpinner, TasIcon, TasTag, Button, Anchor,
    TasSwitch, TasFormField, TasLabel, TasInput,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24"><tas-spinner size="10" class="text-primary"></tas-spinner></div>
    } @else if (rule()) {
      <div class="max-w-3xl pb-6 flex flex-col gap-4">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <a [routerLink]="['/settings/dispatch-rules']" tas-button iconButton>
              <tas-icon iconName="feather:chevron-left"></tas-icon>
            </a>
            <div class="min-w-0">
              <h1 class="text-lg font-semibold text-slate-800 truncate">{{ editName() || '(sans nom)' }}</h1>
              <div class="flex items-center gap-2 mt-0.5">
                <tas-tag [severity]="strategySeverity(rule()!.strategy)">{{ strategyLabel(rule()!.strategy) }}</tas-tag>
                @if (rule()!.isActive) { <tas-tag severity="success">Active</tas-tag> }
                @else { <tas-tag severity="warning">Inactive</tas-tag> }
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2 mr-1">
              <tas-switch
                [checked]="rule()!.isActive ?? false"
                ariaLabel="Activer ou désactiver"
                [isLoading]="isToggling()"
                (toggle)="toggleActive()"
              ></tas-switch>
              <span class="text-xs text-slate-500">{{ rule()!.isActive ? 'Active' : 'Inactive' }}</span>
            </div>
            <button
              tas-raised-button
              color="primary"
              type="button"
              [disabled]="isSaving() || !editName()"
              [isLoading]="isSaving()"
              (click)="save()"
            >
              <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
              Enregistrer
            </button>
          </div>
        </div>

        <!-- Name -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Identification</p>
          </div>
          <div class="p-4">
            <tas-form-field>
              <tas-label>Nom de la règle <span class="text-red-500">*</span></tas-label>
              <input tasInput type="text" placeholder="Ex : Distribution par compatibilité"
                [ngModel]="editName()" (ngModelChange)="editName.set($event)" />
            </tas-form-field>
          </div>
        </tas-card>

        <!-- Strategy -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Stratégie d'affectation</p>
          </div>
          <div class="p-4 grid grid-cols-1 gap-2">
            @for (opt of strategies; track opt.key) {
              <button
                type="button"
                class="w-full text-left p-3 rounded-lg border transition-all"
                [class]="editStrategy() === opt.key
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                  : 'border-slate-200 hover:border-slate-300'"
                (click)="editStrategy.set(opt.key)"
              >
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <tas-icon [iconName]="opt.icon" style="font-size:14px"></tas-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800">{{ opt.label }}</p>
                    <p class="text-xs text-slate-400 mt-0.5">{{ opt.description }}</p>
                  </div>
                  @if (editStrategy() === opt.key) {
                    <tas-icon iconName="feather:check-circle" class="text-primary shrink-0" style="font-size:18px"></tas-icon>
                  }
                </div>
              </button>
            }
          </div>
        </tas-card>

        <!-- Weights -->
        @if (showWeights()) {
          <tas-card class="block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Pondération des critères</p>
              <p class="text-xs text-slate-400 mt-0.5">Ajustez l'importance relative de chaque facteur (0–100).</p>
            </div>
            <div class="p-4 flex flex-col gap-3">
              @for (wk of weightKeys; track wk) {
                <div class="flex items-center gap-3">
                  <span class="text-sm text-slate-700 w-32 shrink-0">{{ weightLabel(wk) }}</span>
                  <div class="flex-1">
                    <input type="range" min="0" max="100" class="w-full accent-primary"
                      [ngModel]="editWeights()[wk] ?? 50" (ngModelChange)="setWeight(wk, $event)" />
                  </div>
                  <span class="text-sm font-semibold text-slate-800 tabular-nums w-8 text-right">{{ editWeights()[wk] ?? 50 }}</span>
                </div>
              }
            </div>
          </tas-card>
        }

        <!-- Constraints -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Contraintes</p>
          </div>
          <div class="p-4 grid grid-cols-2 gap-4">
            <tas-form-field>
              <tas-label>Max leads par agent</tas-label>
              <input tasInput type="number" placeholder="50" [ngModel]="editMaxLeads()" (ngModelChange)="editMaxLeads.set($event)" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>SLA premier contact</tas-label>
              <input tasInput type="text" placeholder="04:00:00" [ngModel]="editSla()" (ngModelChange)="editSla.set($event)" />
              <p class="text-[10px] text-slate-400 mt-1">Format HH:MM:SS</p>
            </tas-form-field>
            <tas-form-field>
              <tas-label>Seuil anti-monopole</tas-label>
              <input tasInput type="number" placeholder="80" [ngModel]="editAntiMonopoly()" (ngModelChange)="editAntiMonopoly.set($event)" />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Priorité</tas-label>
              <input tasInput type="number" placeholder="1" [ngModel]="editPriority()" (ngModelChange)="editPriority.set($event)" />
            </tas-form-field>
          </div>
        </tas-card>

        <!-- Excluded agents -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">Agents exclus</p>
            <p class="text-xs text-slate-400 mt-0.5">Agents qui ne recevront pas de leads via cette règle.</p>
          </div>
          <div class="p-4">
            <div class="flex items-end gap-2 mb-3">
              <tas-form-field class="flex-1">
                <tas-label>Rechercher un agent</tas-label>
                <input tasInput type="text" placeholder="Nom ou e-mail..." [ngModel]="agentSearch()" (ngModelChange)="agentSearch.set($event)" />
              </tas-form-field>
            </div>

            @if (filteredAgents().length > 0) {
              <div class="border border-slate-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                @for (agent of filteredAgents(); track agent.id) {
                  <button
                    type="button"
                    class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                    [class.bg-red-50]="isExcluded(agent.id!)"
                    (click)="toggleExcluded(agent.id!)"
                  >
                    <div class="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                      [class]="isExcluded(agent.id!) ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'">
                      {{ agentInitials(agent) }}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm text-slate-800 truncate">{{ agent.fullName ?? agent.email }}</p>
                      @if (agent.agencyName) { <p class="text-[10px] text-slate-400">{{ agent.agencyName }}</p> }
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
              <p class="text-xs text-slate-400 py-2">Aucun agent trouvé.</p>
            }

            @if (excludedAgentIds().length > 0) {
              <div class="mt-3">
                <p class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1.5">{{ excludedAgentIds().length }} agent(s) exclu(s)</p>
                <div class="flex flex-wrap gap-1.5">
                  @for (agentId of excludedAgentIds(); track agentId) {
                    <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 border border-red-200 text-xs text-red-700">
                      {{ excludedAgentName(agentId) }}
                      <button type="button" class="text-red-400 hover:text-red-600" (click)="toggleExcluded(agentId)">
                        <tas-icon iconName="feather:x" style="font-size:10px"></tas-icon>
                      </button>
                    </span>
                  }
                </div>
              </div>
            }
          </div>
        </tas-card>

        <!-- Simulation -->
        <tas-card class="block">
          <div class="p-4 border-b border-slate-100">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-semibold text-slate-700">Simulation</p>
                <p class="text-xs text-slate-400 mt-0.5">Testez cette stratégie sur un lead existant avant activation.</p>
              </div>
              <button tas-outlined-button color="primary" type="button" [disabled]="isSimulating()" (click)="runSimulation()" class="text-xs">
                @if (isSimulating()) { <tas-spinner size="3" class="text-primary"></tas-spinner> }
                @else { <tas-icon iconName="feather:play" style="font-size:12px"></tas-icon> }
                Lancer la simulation
              </button>
            </div>
          </div>

          @if (simulationResult()) {
            <div class="p-4">
              <div class="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
                <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0" style="font-size:14px"></tas-icon>
                <p class="text-xs font-medium text-amber-700">Aperçu — aucune donnée modifiée</p>
              </div>
              <div class="text-xs text-slate-500 mb-2">
                Stratégie simulée : <span class="font-medium">{{ strategyLabel(simulationResult()!.strategy) }}</span>
                @if (simulationResult()!.excludedCount) { · {{ simulationResult()!.excludedCount }} agent(s) exclu(s) }
              </div>
              @if ((simulationResult()!.rankedCandidates ?? []).length === 0) {
                <p class="text-xs text-slate-400 py-4 text-center">Aucun candidat trouvé.</p>
              } @else {
                <div class="border border-slate-200 rounded-lg overflow-hidden">
                  <table class="w-full text-xs">
                    <thead>
                      <tr class="bg-slate-50 text-slate-500">
                        <th class="text-left px-3 py-2 font-medium">#</th>
                        <th class="text-left px-3 py-2 font-medium">Agent</th>
                        <th class="text-right px-3 py-2 font-medium">Score</th>
                        <th class="text-right px-3 py-2 font-medium">Leads actifs</th>
                        <th class="text-center px-3 py-2 font-medium">Anti-monopole</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (c of simulationResult()!.rankedCandidates ?? []; track c.agentId; let i = $index) {
                        <tr [class]="i === 0 ? 'bg-green-50/50' : ''">
                          <td class="px-3 py-2 text-slate-400 tabular-nums">{{ i + 1 }}</td>
                          <td class="px-3 py-2 font-medium text-slate-800">
                            {{ c.agentName ?? c.agentId }}
                            @if (i === 0) { <span class="ml-1 text-green-600 text-[10px]">← serait affecté</span> }
                          </td>
                          <td class="px-3 py-2 text-right tabular-nums font-semibold"
                            [class]="(c.compatibilityScore ?? 0) >= 70 ? 'text-green-600' : (c.compatibilityScore ?? 0) >= 40 ? 'text-amber-600' : 'text-red-500'">
                            {{ c.compatibilityScore ?? '—' }}
                          </td>
                          <td class="px-3 py-2 text-right tabular-nums text-slate-600">{{ c.activeLeadsCount ?? 0 }}</td>
                          <td class="px-3 py-2 text-center">
                            @if (c.wouldBeBlockedByAntiMonopoly) { <tas-tag severity="error">Bloqué</tas-tag> }
                            @else { <span class="text-slate-300">—</span> }
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          }
        </tas-card>

        <!-- Bottom save -->
        <div class="flex items-center justify-end gap-3">
          <a [routerLink]="['/settings/dispatch-rules']" tas-outlined-button color="primary">Annuler</a>
          <button tas-raised-button color="primary" type="button" [disabled]="isSaving() || !editName()" [isLoading]="isSaving()" (click)="save()">
            <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
            Enregistrer
          </button>
        </div>
      </div>
    }
  `,
})
export class EditDispatchRulePage {
  private readonly _api = inject(DispatchingRulesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly id = input.required<string>();

  public readonly strategies = STRATEGIES;
  public readonly weightKeys = WEIGHT_KEYS;
  public readonly strategySeverity = strategySeverity;
  public readonly strategyLabel = strategyLabel;

  public isLoading = signal(true);
  public isSaving = signal(false);
  public isToggling = signal(false);
  public rule = signal<DispatchingRuleDto | null>(null);

  // Form
  public editName = signal('');
  public editStrategy = signal<DispatchingRuleDtoStrategyEnum>(DispatchingRuleDtoStrategyEnum.RoundRobin);
  public editWeights = signal<ScoringWeightsDto>({ ...DEFAULT_WEIGHTS });
  public editMaxLeads = signal<number | null>(null);
  public editSla = signal('');
  public editAntiMonopoly = signal<number | null>(null);
  public editPriority = signal<number | null>(null);

  public showWeights = computed(() => needsWeights(this.editStrategy()));

  // Excluded agents
  public allAgents = signal<UserDto[]>([]);
  public agentSearch = signal('');
  public excludedAgentIds = signal<string[]>([]);

  public filteredAgents = computed(() => {
    const q = this.agentSearch().toLowerCase().trim();
    const agents = this.allAgents();
    if (!q) return agents;
    return agents.filter(
      (a) => a.fullName?.toLowerCase().includes(q) || a.email?.toLowerCase().includes(q) || a.agencyName?.toLowerCase().includes(q),
    );
  });

  // Simulation
  public isSimulating = signal(false);
  public simulationResult = signal<SimulateDispatchResult | null>(null);

  constructor() {
    effect(() => {
      const ruleId = this.id();
      this.isLoading.set(true);
      this._api.getDispatchingRule(ruleId).subscribe({
        next: (dto) => {
          this.rule.set(dto);
          this.editName.set(dto.name ?? '');
          this.editStrategy.set(dto.strategy ?? DispatchingRuleDtoStrategyEnum.RoundRobin);
          this.editWeights.set(dto.weights ?? { ...DEFAULT_WEIGHTS });
          this.editMaxLeads.set(dto.maxLeadsPerAgent ?? null);
          this.editSla.set(dto.firstContactSla ?? '');
          this.editAntiMonopoly.set(dto.antiMonopolyThreshold ?? null);
          this.editPriority.set(dto.priority ?? null);
          this.excludedAgentIds.set(dto.excludedAgentIds ?? []);
          this.isLoading.set(false);
          this._breadcrumbService.set([
            { label: 'Paramétrage', link: ['/settings'] },
            { label: "Stratégies d'affectation", link: ['/settings/dispatch-rules'] },
            { label: dto.name ?? 'Règle' },
          ]);
        },
        error: () => {
          this._snackbar.error('Erreur', 'Impossible de charger la règle.');
          this.isLoading.set(false);
        },
      });
    });

    this._usersApi.listUsers(undefined, undefined, undefined, 1, 500).pipe(
      catchError(() => of({ items: [] as UserDto[] })),
    ).subscribe((res) => {
      this.allAgents.set(res.items ?? []);
    });
  }

  public weightLabel(key: keyof ScoringWeightsDto): string {
    return WEIGHT_LABELS[key] ?? key;
  }

  public setWeight(key: keyof ScoringWeightsDto, value: number): void {
    this.editWeights.update((w) => ({ ...w, [key]: value }));
  }

  public isExcluded(id: string): boolean {
    return this.excludedAgentIds().includes(id);
  }

  public toggleExcluded(id: string): void {
    this.excludedAgentIds.update((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
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

  public save(): void {
    if (!this.editName()) return;
    this.isSaving.set(true);
    this._api.updateDispatchingRule(this.id(), {
      name: this.editName(),
      weights: needsWeights(this.editStrategy()) ? this.editWeights() : undefined,
      maxLeadsPerAgent: this.editMaxLeads() ?? undefined,
      firstContactSla: this.editSla() || undefined,
      antiMonopolyThreshold: this.editAntiMonopoly() ?? undefined,
      priority: this.editPriority() ?? undefined,
      excludedAgentIds: this.excludedAgentIds().length > 0 ? this.excludedAgentIds() : null,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de sauvegarder.');
        this.isSaving.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Enregistré', 'La stratégie a été mise à jour.');
      this.rule.update((r) => r ? { ...r, name: this.editName(), weights: this.editWeights() } : r);
      this.isSaving.set(false);
    });
  }

  public toggleActive(): void {
    this.isToggling.set(true);
    const active = !this.rule()?.isActive;
    const obs = active
      ? this._api.activateDispatchingRule(this.id())
      : this._api.deactivateDispatchingRule(this.id());
    obs.pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Opération échouée.'); this.isToggling.set(false); return EMPTY; }),
    ).subscribe(() => {
      this.rule.update((r) => r ? { ...r, isActive: active } : r);
      this._snackbar.success('Succès', `Règle ${active ? 'activée' : 'désactivée'}.`);
      this.isToggling.set(false);
    });
  }

  public runSimulation(): void {
    this.isSimulating.set(true);
    this.simulationResult.set(null);
    this._leadsApi.listLeads(1, 1).pipe(
      catchError(() => of({ items: [] as LeadDto[] })),
    ).subscribe((res) => {
      const lead = res.items?.[0];
      if (!lead?.id) {
        this._snackbar.error('Simulation', 'Aucun lead disponible.');
        this.isSimulating.set(false);
        return;
      }
      this._api.simulateDispatchingRule(this.id(), { leadId: lead.id }).pipe(
        catchError(() => { this._snackbar.error('Erreur', 'La simulation a échoué.'); return EMPTY; }),
      ).subscribe({
        next: (result) => this.simulationResult.set(result),
        complete: () => this.isSimulating.set(false),
      });
    });
  }
}

export default EditDispatchRulePage;
