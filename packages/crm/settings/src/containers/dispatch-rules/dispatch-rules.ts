import { Component, computed, effect, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  DispatchingRulesApiService,
  DispatchingRuleDto,
  DispatchingRuleDtoStrategyEnum,
  CreateDispatchingRuleRequestStrategyEnum,
  ScoringWeightsDto,
  SimulateDispatchResult,
  SimulatedCandidateDto,
  LeadsApiService,
  LeadDto,
} from '@sankore/crm-api';
import { BreadcrumbService, HasPermissionDirective } from '@sankore/crm/common';

type ViewState = 'list' | 'edit' | 'create';

interface StrategyOption {
  key: DispatchingRuleDtoStrategyEnum;
  label: string;
  description: string;
  icon: string;
}

const STRATEGIES: StrategyOption[] = [
  {
    key: DispatchingRuleDtoStrategyEnum.RoundRobin,
    label: 'Round Robin',
    description: 'Distribution égale et séquentielle entre les agents disponibles.',
    icon: 'feather:refresh-cw',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.WeightedRoundRobin,
    label: 'Round Robin pondéré',
    description: 'Distribution proportionnelle à la capacité ou aux poids configurés par agent.',
    icon: 'feather:sliders',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.CompatibilityScoring,
    label: 'Score de compatibilité',
    description: 'Affectation à l\'agent ayant le meilleur score basé sur langue, produit, géographie, charge et performance.',
    icon: 'feather:target',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.CherryPicking,
    label: 'Cherry Picking',
    description: 'L\'agent choisit lui-même les leads dans une file d\'attente partagée.',
    icon: 'feather:inbox',
  },
  {
    key: DispatchingRuleDtoStrategyEnum.StickyAssignment,
    label: 'Assignation persistante',
    description: 'Le lead reste assigné au même agent malgré les changements de statut ou de cycle.',
    icon: 'feather:link',
  },
];

const WEIGHT_LABELS: Record<keyof ScoringWeightsDto, string> = {
  language: 'Langue',
  product: 'Produit',
  geography: 'Géographie',
  workload: 'Charge de travail',
  performance: 'Performance',
  agency: 'Agence',
};

function strategySeverity(strategy: DispatchingRuleDtoStrategyEnum | undefined): Severity {
  switch (strategy) {
    case DispatchingRuleDtoStrategyEnum.RoundRobin:           return 'info';
    case DispatchingRuleDtoStrategyEnum.WeightedRoundRobin:   return 'primary';
    case DispatchingRuleDtoStrategyEnum.CompatibilityScoring: return 'success';
    case DispatchingRuleDtoStrategyEnum.CherryPicking:        return 'warning';
    case DispatchingRuleDtoStrategyEnum.StickyAssignment:     return 'accent';
    default: return 'neutral';
  }
}

function strategyLabel(strategy: DispatchingRuleDtoStrategyEnum | string | undefined): string {
  return STRATEGIES.find((s) => s.key === strategy)?.label ?? (strategy ?? '—');
}

@Component({
  selector: 'dispatch-rules-config',
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasSwitch,
    TasFormField,
    TasLabel,
    TasInput,
    HasPermissionDirective,
  ],
  template: `
    <ng-container>

      <!-- ============ LIST VIEW ============ -->
      @if (viewState() === 'list') {
          @if (isLoading()) {
            <div class="flex justify-center py-24">
              <tas-spinner size="10" class="text-primary"></tas-spinner>
            </div>
          } @else {
            <div class="pb-6">
              <div class="flex items-start justify-between mb-6">
                <div>
                  <h1 class="text-lg font-semibold text-slate-800">Stratégies d'affectation</h1>
                  <p class="text-sm text-slate-500 mt-0.5">
                    Configurez comment les leads sont automatiquement assignés aux agents.
                  </p>
                </div>
                <button tas-button color="primary" type="button" (click)="startCreate()">
                  <tas-icon iconName="feather:plus" style="font-size:14px"></tas-icon>
                  Nouvelle règle
                </button>
              </div>

              @if (rules().length === 0) {
                <tas-card class="block">
                  <div class="flex flex-col items-center justify-center py-16 text-center">
                    <div class="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                      <tas-icon iconName="feather:shuffle" class="text-slate-400" style="font-size:24px"></tas-icon>
                    </div>
                    <p class="text-sm text-slate-500">Aucune règle d'affectation configurée</p>
                    <p class="text-xs text-slate-400 mt-1">Créez votre première stratégie pour automatiser l'assignation des leads.</p>
                  </div>
                </tas-card>
              } @else {
                <div class="flex flex-col gap-3">
                  @for (rule of rules(); track rule.id) {
                    <tas-card class="block">
                      <div class="p-4 flex items-center gap-4">
                        <!-- Status -->
                        <tas-switch
                          [checked]="rule.isActive ?? false"
                          [ariaLabel]="(rule.isActive ? 'Désactiver' : 'Activer') + ' ' + (rule.name ?? '')"
                          [isLoading]="togglingRuleId() === rule.id"
                          (toggle)="toggleRuleActive(rule, $event)"
                        ></tas-switch>

                        <!-- Info -->
                        <div class="flex-1 min-w-0 cursor-pointer" (click)="startEdit(rule)">
                          <div class="flex items-center gap-2">
                            <p class="text-sm font-semibold text-slate-800">{{ rule.name }}</p>
                            <tas-tag [severity]="strategySeverity(rule.strategy)">
                              {{ strategyLabel(rule.strategy) }}
                            </tas-tag>
                            @if (rule.isActive) {
                              <tas-tag severity="success">Active</tas-tag>
                            }
                          </div>
                          <div class="flex items-center gap-4 mt-1 text-xs text-slate-400">
                            @if (rule.maxLeadsPerAgent) {
                              <span>Max {{ rule.maxLeadsPerAgent }} leads/agent</span>
                            }
                            @if (rule.firstContactSla) {
                              <span>SLA {{ rule.firstContactSla }}</span>
                            }
                            @if (rule.priority != null) {
                              <span>Priorité {{ rule.priority }}</span>
                            }
                          </div>
                        </div>

                        <!-- Actions -->
                        <button
                          tas-outlined-button
                          type="button"
                          (click)="startEdit(rule)"
                          class="text-xs shrink-0"
                        >
                          <tas-icon iconName="feather:edit-2" style="font-size:12px"></tas-icon>
                          Modifier
                        </button>
                        <button
                          type="button"
                          class="text-slate-300 hover:text-red-500 transition-colors shrink-0"
                          (click)="deleteRule(rule)"
                        >
                          <tas-icon iconName="feather:trash-2" style="font-size:16px"></tas-icon>
                        </button>
                      </div>
                    </tas-card>
                  }
                </div>
              }
            </div>
          }
      }

      <!-- ============ EDIT / CREATE VIEW ============ -->
      @if (viewState() === 'edit' || viewState() === 'create') {
        <div class="pb-6">
          <!-- Back + header -->
          <div class="flex items-center gap-3 mb-6">
            <button
              type="button"
              class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
              (click)="confirmLeave()"
            >
              <tas-icon iconName="feather:arrow-left" style="font-size:14px"></tas-icon>
            </button>
            <div class="flex-1">
              <h1 class="text-lg font-semibold text-slate-800">
                {{ viewState() === 'create' ? 'Nouvelle stratégie' : 'Modifier la stratégie' }}
              </h1>
            </div>
            <div class="flex items-center gap-2">
              <button tas-outlined-button type="button" (click)="confirmLeave()">Annuler</button>
              <button
                tas-button
                color="primary"
                type="button"
                [disabled]="isSaving() || !editName()"
                (click)="save()"
              >
                @if (isSaving()) {
                  <tas-spinner size="3" class="text-white"></tas-spinner>
                }
                {{ viewState() === 'create' ? 'Créer' : 'Enregistrer' }}
              </button>
            </div>
          </div>

          <!-- Name -->
          <tas-card class="mb-4 block">
            <div class="p-4">
              <tas-form-field appearance="outline">
                <tas-label>Nom de la règle</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="Ex : Distribution par compatibilité"
                  [ngModel]="editName()"
                  (ngModelChange)="editName.set($event)"
                />
              </tas-form-field>
            </div>
          </tas-card>

          <!-- Strategy selection -->
          <tas-card class="mb-4 block">
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

          <!-- Scoring weights (only for CompatibilityScoring) -->
          @if (editStrategy() === 'CompatibilityScoring') {
            <tas-card class="mb-4 block">
              <div class="p-4 border-b border-slate-100">
                <p class="text-sm font-semibold text-slate-700">Pondération des critères</p>
                <p class="text-xs text-slate-400 mt-0.5">Ajustez l'importance relative de chaque facteur (0–100).</p>
              </div>
              <div class="p-4 flex flex-col gap-3">
                @for (wk of weightKeys; track wk) {
                  <div class="flex items-center gap-3">
                    <span class="text-sm text-slate-700 w-32 shrink-0">{{ weightLabel(wk) }}</span>
                    <div class="flex-1">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        class="w-full accent-primary"
                        [ngModel]="editWeights()[wk] ?? 50"
                        (ngModelChange)="setWeight(wk, $event)"
                      />
                    </div>
                    <span class="text-sm font-semibold text-slate-800 tabular-nums w-8 text-right">
                      {{ editWeights()[wk] ?? 50 }}
                    </span>
                  </div>
                }
              </div>
            </tas-card>
          }

          <!-- Constraints -->
          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Contraintes</p>
            </div>
            <div class="p-4 grid grid-cols-2 gap-4">
              <tas-form-field appearance="outline" size="small">
                <tas-label>Max leads par agent</tas-label>
                <input
                  tasInput
                  type="number"
                  placeholder="50"
                  [ngModel]="editMaxLeads()"
                  (ngModelChange)="editMaxLeads.set($event)"
                />
              </tas-form-field>
              <tas-form-field appearance="outline" size="small">
                <tas-label>SLA premier contact</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="04:00:00"
                  [ngModel]="editSla()"
                  (ngModelChange)="editSla.set($event)"
                />
              </tas-form-field>
              <tas-form-field appearance="outline" size="small">
                <tas-label>Seuil anti-monopole</tas-label>
                <input
                  tasInput
                  type="number"
                  placeholder="80"
                  [ngModel]="editAntiMonopoly()"
                  (ngModelChange)="editAntiMonopoly.set($event)"
                />
              </tas-form-field>
              <tas-form-field appearance="outline" size="small">
                <tas-label>Priorité</tas-label>
                <input
                  tasInput
                  type="number"
                  placeholder="1"
                  [ngModel]="editPriority()"
                  (ngModelChange)="editPriority.set($event)"
                />
              </tas-form-field>
            </div>
          </tas-card>

          <!-- Simulation -->
          <tas-card class="mb-4 block">
            <div class="p-4 border-b border-slate-100">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-semibold text-slate-700">Simulation</p>
                  <p class="text-xs text-slate-400 mt-0.5">Testez cette stratégie sur un lead existant avant activation.</p>
                </div>
                <button
                  tas-outlined-button
                  color="primary"
                  type="button"
                  [disabled]="isSimulating() || !editRuleId()"
                  (click)="runSimulation()"
                  class="text-xs"
                >
                  @if (isSimulating()) {
                    <tas-spinner size="3" class="text-primary"></tas-spinner>
                  } @else {
                    <tas-icon iconName="feather:play" style="font-size:12px"></tas-icon>
                  }
                  Lancer la simulation
                </button>
              </div>
            </div>

            @if (viewState() === 'create' && !editRuleId()) {
              <div class="p-4 text-center">
                <p class="text-xs text-slate-400">Créez d'abord la règle pour pouvoir la simuler.</p>
              </div>
            }

            <!-- Simulation result -->
            @if (simulationResult()) {
              <div class="p-4">
                <!-- Non-applied banner -->
                <div class="mb-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
                  <tas-icon iconName="feather:alert-triangle" class="text-amber-500 shrink-0" style="font-size:14px"></tas-icon>
                  <p class="text-xs font-medium text-amber-700">
                    Aperçu — aucune donnée modifiée
                  </p>
                </div>

                <div class="text-xs text-slate-500 mb-2">
                  Stratégie simulée : <span class="font-medium">{{ strategyLabel(simulationResult()!.strategy) }}</span>
                  @if (simulationResult()!.excludedCount) {
                    · {{ simulationResult()!.excludedCount }} agent(s) exclu(s)
                  }
                </div>

                @if ((simulationResult()!.rankedCandidates ?? []).length === 0) {
                  <p class="text-xs text-slate-400 py-4 text-center">Aucun candidat trouvé pour cette simulation.</p>
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
                              @if (i === 0) {
                                <span class="ml-1 text-green-600 text-[10px]">← serait affecté</span>
                              }
                            </td>
                            <td class="px-3 py-2 text-right tabular-nums font-semibold"
                              [class]="(c.compatibilityScore ?? 0) >= 70 ? 'text-green-600' : (c.compatibilityScore ?? 0) >= 40 ? 'text-amber-600' : 'text-red-500'"
                            >
                              {{ c.compatibilityScore ?? '—' }}
                            </td>
                            <td class="px-3 py-2 text-right tabular-nums text-slate-600">{{ c.activeLeadsCount ?? 0 }}</td>
                            <td class="px-3 py-2 text-center">
                              @if (c.wouldBeBlockedByAntiMonopoly) {
                                <tas-tag severity="error">Bloqué</tas-tag>
                              } @else {
                                <span class="text-slate-300">—</span>
                              }
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

          @if (formDirty()) {
            <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2">
              <tas-icon iconName="feather:info" class="text-amber-500 shrink-0" style="font-size:14px"></tas-icon>
              <p class="text-xs text-amber-700">
                Des modifications non enregistrées sont en attente.
              </p>
            </div>
          }
        </div>
      }
    </ng-container>
  `,
})
export class DispatchRulesConfig implements OnInit {
  private readonly _dispatchApi = inject(DispatchingRulesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public readonly strategies = STRATEGIES;
  public readonly weightKeys: (keyof ScoringWeightsDto)[] = ['language', 'product', 'geography', 'workload', 'performance', 'agency'];
  public readonly strategySeverity = strategySeverity;
  public readonly strategyLabel = strategyLabel;

  // ——— List state ———
  public isLoading = signal(true);
  public rules = signal<DispatchingRuleDto[]>([]);
  public togglingRuleId = signal<string | null>(null);

  // ——— View state ———
  public viewState = signal<ViewState>('list');

  // ——— Edit / Create form state ———
  public editRuleId = signal<string | null>(null);
  public editName = signal('');
  public editStrategy = signal<DispatchingRuleDtoStrategyEnum>(DispatchingRuleDtoStrategyEnum.RoundRobin);
  public editWeights = signal<ScoringWeightsDto>({ language: 50, product: 50, geography: 30, workload: 40, performance: 40, agency: 20 });
  public editMaxLeads = signal<number | null>(null);
  public editSla = signal('');
  public editAntiMonopoly = signal<number | null>(null);
  public editPriority = signal<number | null>(null);
  public isSaving = signal(false);

  // ——— Simulation ———
  public isSimulating = signal(false);
  public simulationResult = signal<SimulateDispatchResult | null>(null);

  // ——— Dirty tracking ———
  private _savedFormSnapshot = '';
  public readonly formDirty = computed(() => {
    return this._currentFormSnapshot() !== this._savedFormSnapshot;
  });

  private _currentFormSnapshot = computed(() =>
    JSON.stringify({
      name: this.editName(),
      strategy: this.editStrategy(),
      weights: this.editWeights(),
      maxLeads: this.editMaxLeads(),
      sla: this.editSla(),
      antiMonopoly: this.editAntiMonopoly(),
      priority: this.editPriority(),
    }),
  );

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Stratégies d\'affectation' },
    ]);
    this._loadRules();
  }

  public weightLabel(key: keyof ScoringWeightsDto): string {
    return WEIGHT_LABELS[key] ?? key;
  }

  public setWeight(key: keyof ScoringWeightsDto, value: number): void {
    this.editWeights.update((w) => ({ ...w, [key]: value }));
  }

  // ——— List actions ———

  public toggleRuleActive(rule: DispatchingRuleDto, active: boolean): void {
    this.togglingRuleId.set(rule.id ?? null);
    const obs = active
      ? this._dispatchApi.activateDispatchingRule(rule.id!)
      : this._dispatchApi.deactivateDispatchingRule(rule.id!);

    obs.pipe(
      catchError(() => {
        this._snackbar.error('Erreur', `Impossible de ${active ? 'activer' : 'désactiver'} la règle.`);
        return EMPTY;
      }),
    ).subscribe({
      next: () => {
        this.rules.update((list) =>
          list.map((r) => (r.id === rule.id ? { ...r, isActive: active } : r)),
        );
        this._snackbar.success('Succès', `Règle ${active ? 'activée' : 'désactivée'}.`);
      },
      complete: () => this.togglingRuleId.set(null),
    });
  }

  public deleteRule(rule: DispatchingRuleDto): void {
    this._confirmDialog.confirm({
      title: 'Supprimer cette règle ?',
      message: `La règle « ${rule.name} » sera supprimée définitivement.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        // No delete endpoint in the API — deactivate instead
        this._dispatchApi.deactivateDispatchingRule(rule.id!).pipe(
          catchError(() => {
            this._snackbar.error('Erreur', 'Impossible de supprimer la règle.');
            return EMPTY;
          }),
        ).subscribe(() => {
          this.rules.update((list) => list.filter((r) => r.id !== rule.id));
          this._snackbar.success('Succès', 'Règle supprimée.');
        });
      },
    });
  }

  // ——— Navigation ———

  public startCreate(): void {
    this._resetForm();
    this.viewState.set('create');
    this._savedFormSnapshot = this._currentFormSnapshot();
  }

  public startEdit(rule: DispatchingRuleDto): void {
    this.editRuleId.set(rule.id ?? null);
    this.editName.set(rule.name ?? '');
    this.editStrategy.set(rule.strategy ?? DispatchingRuleDtoStrategyEnum.RoundRobin);
    this.editWeights.set(rule.weights ?? { language: 50, product: 50, geography: 30, workload: 40, performance: 40, agency: 20 });
    this.editMaxLeads.set(rule.maxLeadsPerAgent ?? null);
    this.editSla.set(rule.firstContactSla ?? '');
    this.editAntiMonopoly.set(rule.antiMonopolyThreshold ?? null);
    this.editPriority.set(rule.priority ?? null);
    this.simulationResult.set(null);
    this.viewState.set('edit');
    this._savedFormSnapshot = this._currentFormSnapshot();
  }

  public confirmLeave(): void {
    if (this.formDirty()) {
      this._confirmDialog.confirm({
        title: 'Modifications non sauvegardées',
        message: 'Vous avez des modifications en cours. Voulez-vous vraiment quitter sans sauvegarder ?',
        closable: true,
        showCancelButton: true,
        acceptButtonProps: { label: 'Quitter', theme: 'warn' },
        rejectButtonProps: { label: 'Rester' },
        accept: () => this._backToList(),
      });
    } else {
      this._backToList();
    }
  }

  // ——— Save ———

  public save(): void {
    const name = this.editName();
    if (!name) return;

    this.isSaving.set(true);

    const payload = {
      name,
      strategy: this.editStrategy() as any,
      weights: this.editStrategy() === DispatchingRuleDtoStrategyEnum.CompatibilityScoring
        ? this.editWeights()
        : undefined,
      maxLeadsPerAgent: this.editMaxLeads() ?? undefined,
      firstContactSla: this.editSla() || undefined,
      antiMonopolyThreshold: this.editAntiMonopoly() ?? undefined,
      priority: this.editPriority() ?? undefined,
    };

    if (this.viewState() === 'create') {
      this._dispatchApi.createDispatchingRule(payload).pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de créer la règle.');
          return EMPTY;
        }),
      ).subscribe({
        next: (ruleId) => {
          this.editRuleId.set(ruleId);
          this._savedFormSnapshot = this._currentFormSnapshot();
          this._snackbar.success('Règle créée', 'La stratégie a été créée. Vous pouvez la simuler avant activation.');
          this.viewState.set('edit');
          this._loadRules();
        },
        complete: () => this.isSaving.set(false),
      });
    } else {
      this._dispatchApi.updateDispatchingRule(this.editRuleId()!, payload).pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Impossible de sauvegarder les modifications.');
          return EMPTY;
        }),
      ).subscribe({
        next: () => {
          this._savedFormSnapshot = this._currentFormSnapshot();
          this._snackbar.success('Enregistré', 'La stratégie a été mise à jour.');
          this._loadRules();
        },
        complete: () => this.isSaving.set(false),
      });
    }
  }

  // ——— Simulation ———

  public runSimulation(): void {
    const ruleId = this.editRuleId();
    if (!ruleId) return;

    // Pick a recent lead for simulation
    this.isSimulating.set(true);
    this.simulationResult.set(null);

    this._leadsApi.listLeads(1, 1).pipe(
      catchError(() => of({ items: [] as LeadDto[] })),
    ).subscribe((res) => {
      const lead = res.items?.[0];
      if (!lead?.id) {
        this._snackbar.error('Simulation', 'Aucun lead disponible pour la simulation.');
        this.isSimulating.set(false);
        return;
      }

      this._dispatchApi.simulateDispatchingRule(ruleId, { leadId: lead.id }).pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'La simulation a échoué.');
          return EMPTY;
        }),
      ).subscribe({
        next: (result) => this.simulationResult.set(result),
        complete: () => this.isSimulating.set(false),
      });
    });
  }

  // ——— Private ———

  private _resetForm(): void {
    this.editRuleId.set(null);
    this.editName.set('');
    this.editStrategy.set(DispatchingRuleDtoStrategyEnum.RoundRobin);
    this.editWeights.set({ language: 50, product: 50, geography: 30, workload: 40, performance: 40, agency: 20 });
    this.editMaxLeads.set(null);
    this.editSla.set('');
    this.editAntiMonopoly.set(null);
    this.editPriority.set(null);
    this.simulationResult.set(null);
  }

  private _backToList(): void {
    this.viewState.set('list');
    this.simulationResult.set(null);
  }

  private _loadRules(): void {
    this.isLoading.set(true);
    this._dispatchApi.listDispatchingRules().pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((rules) => {
      this.rules.set(rules ?? []);
      this.isLoading.set(false);
    });
  }
}

export default DispatchRulesConfig;
