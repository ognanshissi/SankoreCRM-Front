import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import {
  RoleDto,
  RolesApiService,
  RuleDto,
  RuleOperator,
  RuleType,
  WorkflowTemplateDto,
  WorkflowTemplatesApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  NO_VALUE_OPERATORS,
  RULE_OPERATOR_OPTIONS,
  RULE_TYPE_OPTIONS,
  ruleOperatorLabel,
  ruleTypeLabel,
} from '../workflow-shared';

class AddStepFormModel {
  public name!: string;
  public description!: string;
  public approverRoleCode!: string;
  public timeoutHours!: number | null;

  public static instantiate(): AddStepFormModel {
    const m = new AddStepFormModel();
    m.name = '';
    m.description = '';
    m.approverRoleCode = '';
    m.timeoutHours = null;
    return m;
  }
}

@Component({
  selector: 'workflow-steps',
  imports: [
    TasCard,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
    TasSpinner,
    TasIcon,
    FormRoot,
    FormField,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <tas-card>
          <div class="p-4 flex items-start justify-between border-b border-slate-100 mb-4">
            <div>
              <p class="font-semibold text-slate-800">Étapes de validation</p>
              <p class="text-sm text-slate-500 mt-0.5">
                La séquence d'approbations appliquée à chaque instance de ce workflow
              </p>
            </div>
            @if (!template()?.isActive) {
              <button
                tas-outlined-button
                color="primary"
                type="button"
                (click)="toggleAddStepForm()"
                class="shrink-0"
              >
                <tas-icon iconName="feather:plus" iconSize="sm"></tas-icon>
                Ajouter une étape
              </button>
            }
          </div>

          <div class="px-4 pb-4">
            @if (template()?.isActive) {
              <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50 mb-4">
                <tas-icon iconName="feather:sliders" iconSize="sm" class="text-slate-400 flex-shrink-0 mt-0.5"></tas-icon>
                <p class="text-sm text-slate-500">
                  Ce modèle est actif. Désactivez-le pour ajouter ou retirer des étapes.
                </p>
              </div>
            }

            @if (steps().length === 0) {
              <p class="text-sm text-slate-400 py-6 text-center">Aucune étape définie pour ce modèle.</p>
            } @else {
              <div class="flex flex-col">
                @for (step of steps(); track step.id; let last = $last) {
                  <div class="flex gap-3">
                    <div class="flex flex-col items-center">
                      <div class="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0">
                        {{ step.order }}
                      </div>
                      @if (!last) {
                        <div class="w-px flex-1 bg-slate-200 my-1"></div>
                      }
                    </div>
                    <div class="flex-1 pb-5" [class.pb-0]="last">
                      <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                          <p class="font-medium text-slate-800">{{ step.name }}</p>
                          @if (step.description) {
                            <p class="text-sm text-slate-500 mt-0.5">{{ step.description }}</p>
                          }
                          <div class="flex items-center gap-3 mt-2 text-xs text-slate-500">
                            <span class="inline-flex items-center gap-1">
                              <tas-icon iconName="feather:user-check" iconSize="sm"></tas-icon>
                              {{ roleLabel(step.approverRoleCode) }}
                            </span>
                            @if (step.timeoutHours) {
                              <span class="inline-flex items-center gap-1">
                                <tas-icon iconName="feather:clock" iconSize="sm"></tas-icon>
                                {{ step.timeoutHours }}h
                              </span>
                            }
                          </div>
                        </div>
                        @if (!template()?.isActive) {
                          <button
                            tas-button
                            iconButton
                            type="button"
                            title="Supprimer l'étape"
                            [disabled]="removingStepId() === step.id"
                            (click)="removeStep(step.id)"
                            class="shrink-0"
                          >
                            <tas-icon iconName="feather:trash-2" iconSize="sm" class="text-functional-error"></tas-icon>
                          </button>
                        }
                      </div>

                      <!-- Rules section -->
                      <div class="mt-3">
                        <button
                          type="button"
                          class="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-primary transition-colors"
                          (click)="toggleStepRules(step.id!)"
                        >
                          <tas-icon
                            [iconName]="expandedStepId() === step.id ? 'feather:chevron-down' : 'feather:chevron-right'"
                            style="font-size:11px"
                          ></tas-icon>
                          Règles
                          @if (rulesCountFor(step.id!); as count) {
                            <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600">
                              {{ count }}
                            </span>
                          }
                          @if (stepRulesLoadingId() === step.id) {
                            <tas-spinner size="3" class="text-primary"></tas-spinner>
                          }
                        </button>

                        @if (expandedStepId() === step.id) {
                          <div class="mt-2 ml-2 pl-3 border-l-2 border-slate-100">

                            <!-- Rule list -->
                            @if (rulesForStep(step.id!).length === 0) {
                              <p class="text-xs text-slate-400 mb-2">Aucune règle définie.</p>
                            } @else {
                              <div class="flex flex-col gap-1 mb-3">
                                @for (rule of rulesForStep(step.id!); track rule.id) {
                                  <div class="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-md bg-slate-50 border border-slate-100">
                                    <div class="min-w-0">
                                      <span class="text-[10px] font-semibold text-primary/70 uppercase tracking-wider">
                                        {{ ruleTypeLabel(rule.ruleType) }}
                                      </span>
                                      <p class="text-xs text-slate-700 mt-0.5">
                                        <span class="font-mono">{{ rule.field }}</span>
                                        <span class="text-slate-400 mx-1">{{ ruleOperatorLabel(rule.operator) }}</span>
                                        @if (!isNoValueOperator(rule.operator)) {
                                          <span class="font-mono">{{ rule.value }}</span>
                                        }
                                      </p>
                                    </div>
                                    @if (!template()?.isActive) {
                                      <button
                                        type="button"
                                        class="text-slate-300 hover:text-red-500 transition-colors shrink-0"
                                        title="Supprimer la règle"
                                        [disabled]="removingRuleId() === rule.id"
                                        (click)="removeRule(step.id!, rule.id!)"
                                      >
                                        <tas-icon iconName="feather:trash-2" style="font-size:11px"></tas-icon>
                                      </button>
                                    }
                                  </div>
                                }
                              </div>
                            }

                            <!-- Add rule form -->
                            @if (!template()?.isActive) {
                              @if (ruleFormStepId() === step.id) {
                                <div class="flex flex-col gap-2 p-3 rounded-md border border-slate-200 bg-white">
                                  <div class="grid grid-cols-2 gap-2">
                                    <div>
                                      <label class="text-[10px] text-slate-400 mb-1 block">Type</label>
                                      <select
                                        class="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                                        [value]="newRuleType()"
                                        (change)="newRuleType.set(+$any($event.target).value)"
                                      >
                                        @for (opt of ruleTypeOptions; track opt.value) {
                                          <option [value]="opt.value">{{ opt.label }}</option>
                                        }
                                      </select>
                                    </div>
                                    <div>
                                      <label class="text-[10px] text-slate-400 mb-1 block">Opérateur</label>
                                      <select
                                        class="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                                        [value]="newRuleOperator()"
                                        (change)="newRuleOperator.set(+$any($event.target).value)"
                                      >
                                        @for (opt of ruleOperatorOptions; track opt.value) {
                                          <option [value]="opt.value">{{ opt.label }}</option>
                                        }
                                      </select>
                                    </div>
                                  </div>
                                  <div>
                                    <label class="text-[10px] text-slate-400 mb-1 block">Champ</label>
                                    <input
                                      type="text"
                                      class="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 font-mono"
                                      placeholder="ex: status, amount"
                                      [value]="newRuleField()"
                                      (input)="newRuleField.set($any($event.target).value)"
                                    />
                                  </div>
                                  @if (!isNoValueOperator(newRuleOperator())) {
                                    <div>
                                      <label class="text-[10px] text-slate-400 mb-1 block">Valeur</label>
                                      <input
                                        type="text"
                                        class="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
                                        placeholder="Valeur de comparaison"
                                        [value]="newRuleValue()"
                                        (input)="newRuleValue.set($any($event.target).value)"
                                      />
                                    </div>
                                  }
                                  <div class="flex items-center gap-2 pt-1">
                                    <button
                                      tas-raised-button
                                      color="primary"
                                      type="button"
                                      [disabled]="isAddingRule() || !newRuleField().trim()"
                                      (click)="addRule(step.id!)"
                                    >
                                      Ajouter
                                    </button>
                                    <button
                                      tas-text-button
                                      type="button"
                                      [disabled]="isAddingRule()"
                                      (click)="ruleFormStepId.set(null)"
                                    >
                                      Annuler
                                    </button>
                                  </div>
                                </div>
                              } @else {
                                <button
                                  type="button"
                                  class="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-primary transition-colors mt-1"
                                  (click)="ruleFormStepId.set(step.id!)"
                                >
                                  <tas-icon iconName="feather:plus" style="font-size:10px"></tas-icon>
                                  Ajouter une règle
                                </button>
                              }
                            }
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                }
              </div>
            }

            @if (showAddStepForm()) {
              <form [formRoot]="addStepFormSchema" class="flex flex-col gap-4 mt-2 p-4 rounded-lg border border-slate-200 bg-slate-50">
                <p class="text-sm font-medium text-slate-600">Nouvelle étape — {{ steps().length + 1 }}</p>

                <tas-form-field>
                  <tas-label>Nom de l'étape <span class="text-functional-error">*</span></tas-label>
                  <input tasInput type="text" placeholder="Ex : Validation manager" [formField]="addStepFormSchema.name" />
                  @if (addStepFormSchema.name().touched() && addStepFormSchema.name().invalid()) {
                    <tas-error>{{ addStepFormSchema.name().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>

                <tas-form-field>
                  <tas-label>Description</tas-label>
                  <input tasInput type="text" placeholder="Description de l'étape" [formField]="addStepFormSchema.description" />
                </tas-form-field>

                <div class="grid grid-cols-2 gap-3">
                  <tas-form-field>
                    <tas-label>Rôle approbateur <span class="text-functional-error">*</span></tas-label>
                    <tas-select
                      [options]="roleOptions()"
                      placeholder="Sélectionnez un rôle"
                      [formField]="addStepFormSchema.approverRoleCode"
                    ></tas-select>
                    @if (addStepFormSchema.approverRoleCode().touched() && addStepFormSchema.approverRoleCode().invalid()) {
                      <tas-error>{{ addStepFormSchema.approverRoleCode().errors()[0].message }}</tas-error>
                    }
                  </tas-form-field>

                  <tas-form-field>
                    <tas-label>Délai (heures)</tas-label>
                    <input tasInput type="number" placeholder="Optionnel" [formField]="addStepFormSchema.timeoutHours" />
                  </tas-form-field>
                </div>

                <div class="flex justify-end gap-2 pt-1">
                  <button tas-text-button type="button" (click)="toggleAddStepForm()">Annuler</button>
                  <button
                    tas-raised-button
                    color="primary"
                    type="button"
                    (click)="handleAddStep()"
                    [disabled]="addStepFormSchema().invalid() || isAddingStep()"
                    [isLoading]="isAddingStep()"
                  >
                    Ajouter l'étape
                  </button>
                </div>
              </form>
            }
          </div>
        </tas-card>
      </div>
    }
  `,
})
export class WorkflowStepsPage {
  private readonly _workflowTemplatesApiService = inject(WorkflowTemplatesApiService);
  private readonly _rolesApiService = inject(RolesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);

  public readonly id = input.required<string>();
  public readonly ruleTypeOptions = RULE_TYPE_OPTIONS;
  public readonly ruleOperatorOptions = RULE_OPERATOR_OPTIONS;
  public readonly ruleTypeLabel = ruleTypeLabel;
  public readonly ruleOperatorLabel = ruleOperatorLabel;

  public isLoading = signal(true);
  public isAddingStep = signal(false);
  public removingStepId = signal<string | null>(null);
  public showAddStepForm = signal(false);

  public template = signal<WorkflowTemplateDto | null>(null);
  public roleOptions = signal<{ label: string; value: string }[]>([]);

  // ── Rules ─────────────────────────────────────────────────────────────────
  public expandedStepId = signal<string | null>(null);
  public stepRulesMap = signal<Record<string, RuleDto[]>>({});
  public stepRulesLoadingId = signal<string | null>(null);
  public ruleFormStepId = signal<string | null>(null);
  public newRuleType = signal<RuleType>(RuleType.NUMBER_0);
  public newRuleField = signal('');
  public newRuleOperator = signal<RuleOperator>(RuleOperator.NUMBER_0);
  public newRuleValue = signal('');
  public isAddingRule = signal(false);
  public removingRuleId = signal<string | null>(null);

  public steps = computed(
    () => [...(this.template()?.steps ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );

  public addStepModel = signal(AddStepFormModel.instantiate());
  public addStepFormSchema = form(this.addStepModel, (schema) => {
    required(schema.name, { message: "Le nom de l'étape est obligatoire" });
    required(schema.approverRoleCode, { message: 'Le rôle approbateur est obligatoire' });
  });

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        template: this._workflowTemplatesApiService.getWorkflowTemplate(this.id()),
        roles: this._rolesApiService.listRoles(),
      }).subscribe({
        next: ({ template, roles }) => {
          this.template.set(template);
          this.roleOptions.set(
            (roles as RoleDto[]).map((r) => ({ label: r.label ?? r.name ?? '', value: r.name ?? '' })),
          );
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error('Erreur', 'Impossible de charger les étapes.');
          this.isLoading.set(false);
        },
      });
    });
  }

  // ── Step CRUD ─────────────────────────────────────────────────────────────

  public toggleAddStepForm(): void {
    this.addStepModel.set(AddStepFormModel.instantiate());
    this.showAddStepForm.update((v) => !v);
  }

  public handleAddStep(): void {
    submit(this.addStepFormSchema, async (field) => {
      const value = field()?.value();
      this.isAddingStep.set(true);
      await firstValueFrom(
        this._workflowTemplatesApiService
          .addWorkflowStep(this.id(), {
            order: this.steps().length + 1,
            name: value.name,
            description: value.description || null,
            approverRoleCode: value.approverRoleCode,
            timeoutHours: value.timeoutHours || null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', "Impossible d'ajouter l'étape.");
              this.isAddingStep.set(false);
              return EMPTY;
            }),
          ),
      );
      this._snackbarService.success('Succès', 'Étape ajoutée avec succès.');
      this.isAddingStep.set(false);
      this.showAddStepForm.set(false);
      this._reload();
    });
  }

  public removeStep(stepId: string | undefined): void {
    if (!stepId) return;
    this._confirmDialogService.confirm({
      title: "Supprimer l'étape",
      message: 'Cette étape sera retirée du modèle. Continuer ?',
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.removingStepId.set(stepId);
        this._workflowTemplatesApiService
          .removeWorkflowStep(this.id(), stepId)
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', "Impossible de supprimer l'étape.");
              this.removingStepId.set(null);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbarService.success('Succès', 'Étape supprimée avec succès.');
            this.removingStepId.set(null);
            this._reload();
          });
      },
    });
  }

  public roleLabel(code: string | null | undefined): string {
    return this.roleOptions().find((r) => r.value === code)?.label ?? code ?? '—';
  }

  // ── Rules ─────────────────────────────────────────────────────────────────

  public toggleStepRules(stepId: string): void {
    if (this.expandedStepId() === stepId) {
      this.expandedStepId.set(null);
      this.ruleFormStepId.set(null);
      return;
    }
    this.expandedStepId.set(stepId);
    this.ruleFormStepId.set(null);
    if (!(stepId in this.stepRulesMap())) {
      this._loadRules(stepId);
    }
  }

  public rulesForStep(stepId: string): RuleDto[] {
    return this.stepRulesMap()[stepId] ?? [];
  }

  public rulesCountFor(stepId: string): number {
    return this.stepRulesMap()[stepId]?.length ?? 0;
  }

  public isNoValueOperator(op: RuleOperator | undefined): boolean {
    if (op) {
      return NO_VALUE_OPERATORS.includes(op);
    }
    return false;
  }

  public addRule(stepId: string): void {
    this.isAddingRule.set(true);
    this._workflowTemplatesApiService
      .addWorkflowRule(this.id(), stepId, {
        ruleType: this.newRuleType(),
        field: this.newRuleField().trim(),
        operator: this.newRuleOperator(),
        value: this.isNoValueOperator(this.newRuleOperator()) ? null : this.newRuleValue().trim() || null,
        logicalGroup: 0,
      })
      .subscribe({
        next: () => {
          this._snackbarService.success('Succès', 'Règle ajoutée.');
          this.ruleFormStepId.set(null);
          this.newRuleField.set('');
          this.newRuleValue.set('');
          this.newRuleType.set(RuleType.NUMBER_0);
          this.newRuleOperator.set(RuleOperator.NUMBER_0);
          this.isAddingRule.set(false);
          this._loadRules(stepId);
        },
        error: () => {
          this._snackbarService.error('Erreur', "Impossible d'ajouter la règle.");
          this.isAddingRule.set(false);
        },
      });
  }

  public removeRule(stepId: string, ruleId: string): void {
    this.removingRuleId.set(ruleId);
    this._workflowTemplatesApiService
      .removeWorkflowRule(this.id(), stepId, ruleId)
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'Impossible de supprimer la règle.');
          this.removingRuleId.set(null);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.stepRulesMap.update((m) => ({
          ...m,
          [stepId]: (m[stepId] ?? []).filter((r) => r.id !== ruleId),
        }));
        this.removingRuleId.set(null);
      });
  }

  private _loadRules(stepId: string): void {
    this.stepRulesLoadingId.set(stepId);
    this._workflowTemplatesApiService.listWorkflowRules(this.id(), stepId).subscribe({
      next: (rules) => {
        this.stepRulesMap.update((m) => ({ ...m, [stepId]: rules ?? [] }));
        this.stepRulesLoadingId.set(null);
      },
      error: () => this.stepRulesLoadingId.set(null),
    });
  }

  private _reload(): void {
    this._workflowTemplatesApiService.getWorkflowTemplate(this.id()).subscribe({
      next: (template) => this.template.set(template),
    });
  }
}

export default WorkflowStepsPage;
