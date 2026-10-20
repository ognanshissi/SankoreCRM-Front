import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { form, FormField, FormRoot, max, maxLength, min, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, map, of } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSwitch } from '@talisoft/ui/switch';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  CreateDispatchingRuleRequestStrategyEnum,
  DispatchingRuleDto,
  DispatchingRuleDtoStrategyEnum,
  DispatchingRulesApiService,
  UpdateDispatchingRuleRequest,
  UserDto,
  UsersApiService,
} from '@sankore/crm-api';
import { BreadcrumbService } from '@sankore/crm/common';
import {
  CRITERIA,
  DEFAULT_WEIGHTS,
  formatDuration,
  minutesToTimeSpan,
  needsWeights,
  normalizeWeights,
  STRATEGIES,
  timeSpanToMinutes,
  toWeights,
  WEIGHT_KEYS,
  WEIGHT_PRESETS,
  WeightPreset,
  Weights,
} from '../dispatch-rules.shared';
import { NumberStepper } from './number-stepper';
import { DispatchRulePreview } from './dispatch-rule-preview';

class DispatchRuleFormModel {
  public name!: string;
  public strategy!: DispatchingRuleDtoStrategyEnum;
  /** Importances brutes des curseurs ; les parts envoyées au serveur sont normalisées à 100. */
  public weights!: Weights;
  public maxLeadsPerAgent!: number;
  public maxTasksPerAgent!: number;
  public firstContactSlaMinutes!: number;
  public antiMonopolyThreshold!: number;
  public excludedAgentIds!: string[];

  // Mêmes valeurs que DispatchingRule.Default() côté serveur.
  public static instantiate(): DispatchRuleFormModel {
    const m = new DispatchRuleFormModel();
    m.name = '';
    m.strategy = DispatchingRuleDtoStrategyEnum.CompatibilityScoring;
    m.weights = { ...DEFAULT_WEIGHTS };
    m.maxLeadsPerAgent = 30;
    m.maxTasksPerAgent = 20;
    m.firstContactSlaMinutes = 24 * 60;
    m.antiMonopolyThreshold = 5;
    m.excludedAgentIds = [];
    return m;
  }

  public static fromRule(dto: DispatchingRuleDto): DispatchRuleFormModel {
    const m = DispatchRuleFormModel.instantiate();
    m.name = dto.name ?? '';
    m.strategy = dto.strategy ?? m.strategy;
    m.weights = toWeights(dto.weights);
    m.maxLeadsPerAgent = dto.maxLeadsPerAgent || m.maxLeadsPerAgent;
    m.maxTasksPerAgent = dto.maxTasksPerAgent ?? 0;
    m.firstContactSlaMinutes = timeSpanToMinutes(dto.firstContactSla) || m.firstContactSlaMinutes;
    m.antiMonopolyThreshold = dto.antiMonopolyThreshold || m.antiMonopolyThreshold;
    m.excludedAgentIds = [...(dto.excludedAgentIds ?? [])];
    return m;
  }
}

interface AgentRow {
  id: string;
  name: string;
  initials: string;
  subtitle: string;
  /** Raison pour laquelle l'agent ne peut pas recevoir de leads, quelle que soit la règle. */
  blockedReason: string | null;
}

/** Placeholder de la règle en cours d'édition dans l'ordre d'évaluation, tant qu'elle n'a pas d'id. */
const SELF = '__self__';

@Component({
  selector: 'dispatch-rule-editor',
  imports: [
    FormRoot, FormField, RouterLink,
    TasCard, TasSpinner, TasIcon, TasSwitch, Button, Anchor,
    TasFormField, TasLabel, TasError, TasInput,
    NumberStepper, DispatchRulePreview,
  ],
  templateUrl: './dispatch-rule-editor.html',
})
export class DispatchRuleEditorPage implements OnInit {
  private readonly _api = inject(DispatchingRulesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  /** Absent en création. */
  public readonly id = input<string>();

  public readonly strategies = STRATEGIES;
  public readonly criteria = CRITERIA;
  public readonly presets = WEIGHT_PRESETS;

  public readonly isLoading = signal(true);
  public readonly rule = signal<DispatchingRuleDto | null>(null);
  public readonly isToggling = signal(false);
  /** État voulu à la création ; en édition, l'interrupteur agit tout de suite sur le serveur. */
  public readonly activeOnCreate = signal(false);

  public readonly model = signal(DispatchRuleFormModel.instantiate());
  public readonly formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Donnez un nom à la règle' });
    maxLength(schema.name, 100, { message: '100 caractères au maximum' });
    min(schema.maxLeadsPerAgent, 1);
    min(schema.maxTasksPerAgent, 0);
    min(schema.firstContactSlaMinutes, 60);
    min(schema.antiMonopolyThreshold, 1);
    for (const key of WEIGHT_KEYS) {
      min(schema.weights[key], 0);
      max(schema.weights[key], 100);
    }
    validate(schema.weights, (ctx) => {
      const total = WEIGHT_KEYS.reduce((sum, k) => sum + (ctx.value()[k] || 0), 0);
      return needsWeights(ctx.valueOf(schema.strategy)) && total <= 0
        ? { kind: 'weights', message: 'Au moins un critère doit compter.' }
        : undefined;
    });
  });

  public readonly isEdit = computed(() => !!this.id());
  public readonly isActive = computed(() => (this.isEdit() ? this.rule()?.isActive ?? false : this.activeOnCreate()));
  public readonly strategy = computed(() => this.formSchema.strategy().value());
  public readonly showWeights = computed(() => needsWeights(this.strategy()));
  public readonly normalizedWeights = computed(() => normalizeWeights(this.formSchema.weights().value()));
  public readonly excludedAgentIds = computed(() => this.formSchema.excludedAgentIds().value());

  public readonly activePreset = computed(() => {
    const raw = this.formSchema.weights().value();
    return WEIGHT_PRESETS.find((p) => WEIGHT_KEYS.every((k) => p.weights[k] === raw[k]))?.label ?? null;
  });

  // ── Ordre d'évaluation ────────────────────────────────────────────────
  /** Les autres règles, dans l'ordre où le serveur les évalue (priorité décroissante). */
  public readonly otherRules = signal<DispatchingRuleDto[]>([]);
  public readonly position = signal(0);
  private readonly _initialPosition = signal(0);
  public readonly totalRules = computed(() => this.otherRules().length + 1);

  /**
   * L'ordre d'évaluation tel qu'il sera après l'enregistrement : les autres règles, et celle-ci à la
   * position choisie. C'est ce que montre le champ « Priorité » — un rang parmi des règles nommées,
   * plutôt qu'un nombre dont personne ne sait s'il est grand ou petit.
   */
  public readonly priorityPreview = computed(() => {
    const entries = this.otherRules().map((r) => ({
      key: r.id ?? '', name: r.name ?? 'Règle sans nom', isActive: !!r.isActive, self: false,
    }));
    entries.splice(this.position(), 0, {
      key: SELF,
      name: this.formSchema.name().value().trim() || (this.isEdit() ? 'Cette règle' : 'Nouvelle règle'),
      isActive: this.isActive(),
      self: true,
    });
    return entries;
  });

  /** Première règle active placée avant celle-ci : c'est elle qui prend les leads sans source imposée. */
  public readonly activeRuleAbove = computed(
    () => this.otherRules().slice(0, this.position()).find((r) => r.isActive) ?? null,
  );

  // ── Agents ────────────────────────────────────────────────────────────
  public readonly users = signal<UserDto[]>([]);
  public readonly agentSearch = signal('');

  public readonly agentRows = computed<AgentRow[]>(() =>
    this.users()
      .filter((u) => !!u.id && !u.deactivatedAt && u.status !== 'Deactivated')
      .map((u) => this._toAgentRow(u))
      .sort((a, b) => Number(!!a.blockedReason) - Number(!!b.blockedReason) || a.name.localeCompare(b.name)),
  );

  public readonly filteredAgentRows = computed(() => {
    const q = this.agentSearch().trim().toLowerCase();
    if (!q) return this.agentRows();
    return this.agentRows().filter((a) => `${a.name} ${a.subtitle}`.toLowerCase().includes(q));
  });

  public readonly eligibleAgentCount = computed(() => this.agentRows().filter((a) => !a.blockedReason).length);
  public readonly includedAgentCount = computed(() => {
    const excluded = new Set(this.excludedAgentIds());
    return this.agentRows().filter((a) => !a.blockedReason && !excluded.has(a.id)).length;
  });

  // ── Formats ───────────────────────────────────────────────────────────
  public readonly formatDuration = formatDuration;
  public readonly formatTasks = (v: number): string => (v <= 0 ? 'illimité' : String(v));

  ngOnInit(): void {
    const id = this.id();
    forkJoin({
      rule: id ? this._api.getDispatchingRule(id) : of(null),
      rules: this._api.listDispatchingRules().pipe(catchError(() => of([] as DispatchingRuleDto[]))),
      users: this._usersApi.listUsers(undefined, undefined, undefined, 1, 500).pipe(
        catchError(() => of({ items: [] as UserDto[] })),
      ),
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger la règle.');
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe(({ rule, rules, users }) => {
      this.rule.set(rule);
      if (rule) this.model.set(DispatchRuleFormModel.fromRule(rule));
      this.users.set(users.items ?? []);

      const ordered = [...(rules ?? [])].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      const selfIndex = id ? ordered.findIndex((r) => r.id === id) : -1;
      const others = ordered.filter((r) => r.id !== id);
      const position = selfIndex >= 0 ? selfIndex : others.length;
      this.otherRules.set(others);
      this.position.set(position);
      this._initialPosition.set(position);

      this._breadcrumbService.set([
        { label: 'Leads', link: ['/leads'] },
        { label: 'Dispatching', link: ['/leads/dispatching'] },
        { label: rule?.name ?? 'Nouvelle règle' },
      ]);
      this.isLoading.set(false);
    });
  }

  public selectStrategy(key: DispatchingRuleDtoStrategyEnum): void {
    if (this.isEdit()) return;
    this.formSchema.strategy().value.set(key);
  }

  public applyPreset(preset: WeightPreset): void {
    this.formSchema.weights().value.set({ ...preset.weights });
  }

  public move(delta: -1 | 1): void {
    const next = this.position() + delta;
    if (next < 0 || next >= this.totalRules()) return;
    this.position.set(next);
  }

  public isExcluded(agentId: string): boolean {
    return this.excludedAgentIds().includes(agentId);
  }

  public toggleAgent(agent: AgentRow): void {
    if (agent.blockedReason) return;
    const field = this.formSchema.excludedAgentIds();
    const current = field.value();
    field.value.set(current.includes(agent.id) ? current.filter((x) => x !== agent.id) : [...current, agent.id]);
  }

  public setAllAgents(included: boolean): void {
    const eligible = this.agentRows().filter((a) => !a.blockedReason).map((a) => a.id);
    const field = this.formSchema.excludedAgentIds();
    const others = field.value().filter((x) => !eligible.includes(x));
    field.value.set(included ? others : [...others, ...eligible]);
  }

  public toggleActive(active: boolean): void {
    const ruleId = this.id();
    if (!ruleId) {
      this.activeOnCreate.set(active);
      return;
    }
    this.isToggling.set(true);
    (active ? this._api.activateDispatchingRule(ruleId) : this._api.deactivateDispatchingRule(ruleId)).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', `Impossible de ${active ? 'activer' : 'désactiver'} la règle.`);
        this.isToggling.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.rule.update((r) => (r ? { ...r, isActive: active } : r));
      this._snackbar.success(
        active ? 'Règle activée' : 'Règle désactivée',
        active ? 'Elle s\'applique aux prochains leads.' : 'Elle ne reçoit plus de nouveaux leads.',
      );
      this.isToggling.set(false);
    });
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field().value();
      const plan = this._priorityPlan();
      const payload: UpdateDispatchingRuleRequest = {
        name: value.name.trim(),
        weights: normalizeWeights(value.weights),
        maxLeadsPerAgent: value.maxLeadsPerAgent,
        // Envoyé explicitement : absent, il repartait à 0 et écrasait le plafond réglé. 0 = pas de limite.
        maxTasksPerAgent: value.maxTasksPerAgent,
        firstContactSla: minutesToTimeSpan(value.firstContactSlaMinutes),
        antiMonopolyThreshold: value.antiMonopolyThreshold,
        priority: plan.self,
        excludedAgentIds: value.excludedAgentIds,
      };

      let ruleId = this.id();
      if (ruleId) {
        const ok = await firstValueFrom(this._api.updateDispatchingRule(ruleId, payload).pipe(
          map(() => true),
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Enregistrement impossible', this._errorMessage(err));
            return of(false);
          }),
        ));
        if (!ok) return;
      } else {
        ruleId = await firstValueFrom(this._api.createDispatchingRule({
          ...payload,
          strategy: CreateDispatchingRuleRequestStrategyEnum[value.strategy],
        }).pipe(
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error('Création impossible', this._errorMessage(err));
            return of(undefined);
          }),
        ));
        if (!ruleId) return;
      }

      const reorderFailures = await this._applyReorder(plan.others);

      // Le serveur crée toujours la règle active : une règle voulue inactive est désactivée aussitôt.
      if (!this.isEdit() && !this.activeOnCreate()) {
        const deactivated = await firstValueFrom(this._api.deactivateDispatchingRule(ruleId).pipe(
          map(() => true),
          catchError(() => of(false)),
        ));
        if (!deactivated) {
          this._snackbar.error('Règle créée', 'Mais elle est restée active : désactivez-la depuis la liste.');
          this._router.navigate(['/leads/dispatching']);
          return;
        }
      }

      if (reorderFailures > 0) {
        this._snackbar.info('Règle enregistrée', `L'ordre de ${reorderFailures} autre(s) règle(s) n'a pas pu être mis à jour.`);
      } else {
        this._snackbar.success('Règle enregistrée', this.isActive() ? 'Elle s\'applique aux prochains leads.' : 'Elle reste inactive.');
      }
      this._router.navigate(['/leads/dispatching']);
    });
  }

  /**
   * Priorités qui réalisent l'ordre choisi. On ne touche qu'à la règle éditée quand l'écart
   * entre ses voisines le permet ; sinon (priorités égales ou consécutives) toutes les règles
   * sont renumérotées, faute de quoi l'ordre entre ex æquo resterait celui de la base.
   */
  private _priorityPlan(): { self: number; others: { rule: DispatchingRuleDto; priority: number }[] } {
    const others = this.otherRules();
    const position = this.position();
    const current = this.rule()?.priority;

    if (this.isEdit() && position === this._initialPosition() && current !== undefined) {
      return { self: current, others: [] };
    }

    const above = others[position - 1]?.priority;
    const below = others[position]?.priority;
    if (above === undefined && below === undefined) return { self: 0, others: [] };
    if (above === undefined) return { self: below! + 1, others: [] };
    // Pas sous zéro : la liste affichait « Priorité −1 », et une priorité négative se lit comme une
    // erreur. Sous une règle déjà à 0, on renumérote plutôt.
    if (below === undefined && above >= 1) return { self: above - 1, others: [] };
    if (above !== undefined && below !== undefined && above - below >= 2) {
      return { self: Math.floor((above + below) / 2), others: [] };
    }

    const ordered = others.map((r) => r.id ?? '');
    ordered.splice(position, 0, SELF);
    const n = ordered.length;
    const priorityAt = (index: number) => (n - index) * 10;

    return {
      self: priorityAt(position),
      others: ordered
        .map((ruleId, index) => ({ rule: others.find((r) => r.id === ruleId), priority: priorityAt(index) }))
        .filter((e): e is { rule: DispatchingRuleDto; priority: number } => !!e.rule && e.rule.priority !== e.priority),
    };
  }

  private async _applyReorder(updates: { rule: DispatchingRuleDto; priority: number }[]): Promise<number> {
    let failures = 0;
    for (const { rule, priority } of updates) {
      const ok = await firstValueFrom(this._api.updateDispatchingRule(rule.id!, {
        name: rule.name,
        weights: rule.weights,
        maxLeadsPerAgent: rule.maxLeadsPerAgent,
        maxTasksPerAgent: rule.maxTasksPerAgent,
        firstContactSla: rule.firstContactSla,
        antiMonopolyThreshold: rule.antiMonopolyThreshold,
        priority,
        excludedAgentIds: rule.excludedAgentIds ?? [],
      }).pipe(map(() => true), catchError(() => of(false))));
      if (!ok) failures++;
    }
    return failures;
  }

  private _toAgentRow(u: UserDto): AgentRow {
    const name = u.fullName || u.email || 'Utilisateur';
    const parts = name.split(/\s+/);
    const role = u.roleLabels?.[0] ?? u.roles?.[0];
    let blockedReason: string | null = null;
    if (u.status === 'PendingActivation') {
      const expired = !!u.invitationExpiresAt && new Date(u.invitationExpiresAt).getTime() < Date.now();
      blockedReason = expired ? 'Invitation expirée : exclu d\'office' : 'Invitation en attente : exclu d\'office';
    } else if (u.status && u.status !== 'Active') {
      blockedReason = 'Compte inactif : exclu d\'office';
    }
    return {
      id: u.id!,
      name,
      initials: ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?',
      subtitle: [role, u.agencyName].filter(Boolean).join(' · ') || (u.email ?? ''),
      blockedReason,
    };
  }

  private _errorMessage(err: HttpErrorResponse): string {
    const errors = err.error?.errors as Record<string, string[]> | undefined;
    if (errors) {
      const first = Object.values(errors).flat()[0];
      if (first) return first;
    }
    return err.error?.detail ?? err.error?.title ?? 'Le serveur a refusé la règle.';
  }
}

export default DispatchRuleEditorPage;
