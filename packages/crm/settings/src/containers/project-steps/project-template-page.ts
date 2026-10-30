import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { applyEach, disabled, form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, Observable, of } from 'rxjs';
import {
  CreateProjectTemplateRequestAmountKindEnum,
  CreateProjectTemplateRequestCategoryEnum,
  ProductDto,
  ProjectFieldRequest,
  ProjectFieldRequestTypeEnum,
  ProductsApiService,
  ProjectStepRequest,
  ProjectStepRequestPhaseEnum,
  ProjectTemplateDto,
  ProjectTemplatesApiService,
  UpdateProjectTemplateRequestAmountKindEnum,
  WorkflowCircuitSummary,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasCard } from '@talisoft/ui/card';
import { TasCheckbox } from '@talisoft/ui/checkbox';
import { TasAlert } from '@talisoft/ui/alert';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { BreadcrumbService, PermissionsService, PROJECT_AMOUNT_KINDS } from '@sankore/crm/common';
import {
  FAMILY_AMOUNT_KIND,
  fieldKeyOf,
  isChoiceType,
  PHASE_OPTIONS,
  PROJECT_FIELD_TYPES,
  phaseLabel,
  phaseIndex,
  PRESETS,
  projectTemplateError,
  StepPreset,
  templateScopeOptions,
} from './project-steps.models';
import { PromoteButton } from '../../components/promote-to-production/promote-to-production';

/** Le segment d'URL d'un nouveau gabarit, et celui du parcours par défaut (qui n'a pas d'id tant qu'il n'est pas modifié). */
export const NEW_TEMPLATE = 'new';
/**
 * « Aucun circuit » dans la liste. Pas une chaîne vide : `tas-select` lit une valeur vide comme
 * « rien de choisi » et affiche son texte d'invite au lieu de « Aucun ».
 */
const NO_CIRCUIT = 'none';
const MAX_CHECKLIST = 10;
export const DEFAULT_TEMPLATE = 'default';

type Scope = 'Category' | 'Product';

interface StepRow {
  /** L'id d'une étape existante : le renvoyer garde les projets qui y sont. */
  id: string | null;
  label: string;
  phase: string;
  /** En texte, comme l'input le rend : converti à l'envoi. */
  probability: string;
  suggestion: string;
  opensClientFile: boolean;
  isApproval: boolean;
  requiresQuestionnaires: boolean;
  requiresAmount: boolean;
  requiresCloseDate: boolean;
  /** L'id d'un point existant garde les coches déjà données sur les projets. */
  checklist: { id: string | null; label: string }[];
  /** La clé du circuit de validation lancé à l'arrivée sur l'étape, ou NO_CIRCUIT. */
  workflowCircuit: string;
  /** Les champs du gabarit à renseigner pour l'atteindre, par `rowId` de champ. */
  requiredFields: string[];
}

interface FieldRow {
  /**
   * Repère de la ligne dans l'écran : la clé d'un champ enregistré, un repère local pour un
   * nouveau — une étape doit pouvoir l'exiger avant que sa clé existe.
   */
  rowId: string;
  /** La clé enregistrée ; null pour un nouveau champ (calculée à l'envoi). */
  key: string | null;
  label: string;
  type: string;
  helpText: string;
  /** Une option par ligne, pour les deux types « liste ». */
  options: string;
  /** Les options enregistrées : une option gardée garde sa valeur, et les choix déjà faits avec. */
  savedOptions: { value: string; label: string }[];
}

class TemplateFormModel {
  public name!: string;
  public scope!: Scope;
  public category!: string;
  public productCode!: string;
  public tracksForecast!: boolean;
  public amountKind!: string;
  public criticalCloseDate!: boolean;
  public fields!: FieldRow[];
  public steps!: StepRow[];

  public static instantiate(template: ProjectTemplateDto | null): TemplateFormModel {
    const m = new TemplateFormModel();
    m.name = template?.name ?? '';
    m.scope = template?.scope === 'Product' ? 'Product' : 'Category';
    m.category = template?.category ?? '';
    m.productCode = template?.productCode ?? '';
    m.tracksForecast = template?.tracksForecast ?? true;
    m.amountKind = template?.amountKind ?? 'Generic';
    m.criticalCloseDate = !!template?.criticalCloseDate;
    m.fields = (template?.fields ?? []).map((f) => ({
      rowId: f.key ?? '',
      key: f.key ?? null,
      label: f.label ?? '',
      type: f.type ?? 'Text',
      helpText: f.helpText ?? '',
      options: (f.options ?? []).map((o) => o.label ?? '').join('\n'),
      savedOptions: (f.options ?? []).map((o) => ({ value: o.value ?? '', label: o.label ?? '' })),
    }));
    m.steps = (template?.steps ?? []).map((s) => ({
      id: s.id ?? null,
      label: s.label ?? '',
      phase: s.phase ?? 'Prospecting',
      probability: String(s.probability ?? ''),
      suggestion: s.suggestion ?? '',
      opensClientFile: !!s.opensClientFile,
      isApproval: !!s.isApproval,
      requiresQuestionnaires: !!s.requiresQuestionnaires,
      requiresAmount: !!s.requiresAmount,
      requiresCloseDate: !!s.requiresCloseDate,
      checklist: (s.checklist ?? []).map((i) => ({ id: i.id ?? null, label: i.label ?? '' })),
      workflowCircuit: s.workflowCircuit || NO_CIRCUIT,
      requiredFields: [...(s.requiredFieldKeys ?? [])],
    }));
    return m;
  }
}

function fromPreset(steps: StepPreset[]): StepRow[] {
  return steps.map((s) => ({
    id: null,
    label: s.label ?? '',
    phase: s.phase ?? 'Prospecting',
    probability: String(s.probability ?? ''),
    suggestion: s.suggestion ?? '',
    opensClientFile: !!s.opensClientFile,
    isApproval: !!s.isApproval,
    requiresQuestionnaires: !!s.requiresQuestionnaires,
    requiresAmount: !!s.requiresAmount,
    requiresCloseDate: !!s.requiresCloseDate,
    checklist: (s.checklist ?? []).map((label) => ({ id: null, label })),
    workflowCircuit: NO_CIRCUIT,
    requiredFields: [],
  }));
}

let localRowSeed = 0;

function probabilityOf(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(n) ? n : null;
}

/**
 * Paramètres › Étapes des projets › un gabarit, en page (`/settings/project-steps/new`, `/:id`,
 * `/default`) : la portée, la nature du montant, la prévision et jusqu'à douze étapes ne tiennent
 * pas lisiblement dans un tiroir. Le gabarit par défaut et celui d'une famille ou d'un produit se
 * modifient de la même façon ; seule la portée d'un NOUVEAU gabarit se choisit, ensuite elle ne
 * change plus.
 */
@Component({
  selector: 'project-template-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-template-page.html',
  imports: [PromoteButton, 
    RouterLink, TasAlert, TasCard, TasCheckbox, TasSpinner, TasSwitch, Button,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasIcon, FormRoot, FormField,
  ],
})
export class ProjectTemplatePage implements OnInit {
  private readonly _api = inject(ProjectTemplatesApiService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManage = this._permissions.can('lead:pipeline-stage:manage');
  private readonly _key = this._route.snapshot.paramMap.get('templateId') ?? NEW_TEMPLATE;
  public readonly isNew = this._key === NEW_TEMPLATE;

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly template = signal<ProjectTemplateDto | null>(null);
  public readonly isDefault = computed(() => this.template()?.scope === 'Default');
  /** Les familles et produits du catalogue qui n'ont pas encore de gabarit. */
  public readonly categoryOptions = signal<{ value: string; label: string }[]>([]);
  public readonly productOptions = signal<{ value: string; label: string }[]>([]);
  /** Les circuits de validation « Projet » actifs (Paramétrage › Workflows), qu'une étape peut lancer. */
  public readonly circuits = signal<WorkflowCircuitSummary[]>([]);
  public readonly circuitOptions = computed(() => {
    const active = this.circuits().map((c) => ({ value: c.circuit ?? '', label: c.name ?? c.circuit ?? '' }));
    // Un circuit désactivé depuis reste affiché sur l'étape qui le nomme : sinon l'enregistrer
    // l'effacerait sans que personne l'ait décidé.
    const named = new Set(active.map((o) => o.value));
    const orphans = [...new Set(this.model().steps.map((s) => s.workflowCircuit).filter((c) => c && c !== NO_CIRCUIT && !named.has(c)))]
      .map((c) => ({ value: c, label: `${c} (inactif)` }));
    return [{ value: NO_CIRCUIT, label: 'Aucun' }, ...active, ...orphans];
  });
  public readonly phaseOptions = PHASE_OPTIONS;
  public readonly presets = PRESETS;
  public readonly amountKindOptions = PROJECT_AMOUNT_KINDS.map((k) => ({ value: k.value, label: k.label }));
  public readonly maxSteps = 12;
  public readonly maxFields = 30;
  public readonly fieldTypes = PROJECT_FIELD_TYPES;
  public readonly isChoiceType = isChoiceType;
  public fieldTypeLabel(type: string): string {
    return PROJECT_FIELD_TYPES.find((t) => t.value === type)?.label ?? type;
  }

  public readonly scopeOptions = [
    { value: 'Category', label: 'Une famille de produits' },
    { value: 'Product', label: 'Un produit précis' },
  ];

  public readonly isDeleting = signal(false);

  /**
   * L'étape affichée dans le panneau de droite. Une seule à la fois : les douze dépliées ensemble
   * faisaient une page interminable où l'on perdait de vue le parcours.
   */
  public readonly selected = signal(0);
  public readonly phaseLabel = phaseLabel;
  public readonly noCircuit = NO_CIRCUIT;
  public readonly amountKindLabel = computed(
    () => this.amountKindOptions.find((k) => k.value === this.model().amountKind)?.label ?? '',
  );

  public model = signal(TemplateFormModel.instantiate(null));
  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom est obligatoire' });
    disabled(schema.criticalCloseDate, ({ valueOf }) => !valueOf(schema.tracksForecast));
    maxLength(schema.name, 100, { message: '100 caractères au plus' });

    if (this.isNew) {
      required(schema.category, { message: 'Choisissez une famille', when: ({ valueOf }) => valueOf(schema.scope) === 'Category' });
      required(schema.productCode, { message: 'Choisissez un produit', when: ({ valueOf }) => valueOf(schema.scope) === 'Product' });
    }
    // Lecture seule sans le droit de gérer : le formulaire montre, il ne modifie pas.
    disabled(schema, () => !this.canManage());

    validate(schema.steps, (ctx) => {
      const steps = ctx.value();
      if (steps.length === 0) return { kind: 'steps', message: 'Ajoutez au moins une étape' };
      const labels = steps.map((s) => s.label.trim().toLowerCase()).filter(Boolean);
      if (new Set(labels).size !== labels.length) return { kind: 'steps', message: 'Deux étapes portent le même nom' };
      if (steps.filter((s) => s.opensClientFile).length > 1) return { kind: 'steps', message: 'Une seule étape peut ouvrir le dossier client' };
      if (steps.filter((s) => s.isApproval).length > 1) return { kind: 'steps', message: 'Une seule étape peut être l’étape d’approbation' };
      if (steps.filter((s) => s.requiresQuestionnaires).length > 1) return { kind: 'steps', message: 'Une seule étape peut exiger les questionnaires complets' };
      const opens = steps.findIndex((s) => s.opensClientFile);
      const approval = steps.findIndex((s) => s.isApproval);
      if (opens >= 0 && approval >= 0 && approval < opens) {
        return { kind: 'steps', message: 'L’approbation ne peut pas précéder l’ouverture du dossier client' };
      }
      for (let i = 1; i < steps.length; i++) {
        if (phaseIndex(steps[i].phase) < phaseIndex(steps[i - 1].phase)) {
          return { kind: 'steps', message: `« ${steps[i].label || 'Étape ' + (i + 1)} » revient à une phase antérieure à l'étape qui la précède` };
        }
      }
      return null;
    });

    validate(schema.fields, (ctx) => {
      const labels = ctx.value().map((f) => f.label.trim().toLowerCase()).filter(Boolean);
      if (new Set(labels).size !== labels.length) return { kind: 'fields', message: 'Deux champs portent le même libellé' };
      return null;
    });

    applyEach(schema.fields, (row) => {
      required(row.label, { message: 'Libellé obligatoire' });
      maxLength(row.label, 100, { message: '100 caractères au plus' });
      maxLength(row.helpText, 300, { message: '300 caractères au plus' });
      validate(row.options, ({ value, valueOf }) =>
        isChoiceType(valueOf(row.type)) && !value().split('\n').some((l) => l.trim())
          ? { kind: 'options', message: 'Une option au moins, une par ligne' }
          : null,
      );
    });

    applyEach(schema.steps, (row) => {
      required(row.label, { message: 'Nom obligatoire' });
      maxLength(row.label, 60, { message: '60 caractères au plus' });
      maxLength(row.suggestion, 200, { message: '200 caractères au plus' });
      validate(row.checklist, (ctx) => {
        const labels = ctx.value().map((i) => i.label.trim().toLowerCase()).filter(Boolean);
        if (labels.length > MAX_CHECKLIST) return { kind: 'checklist', message: `${MAX_CHECKLIST} points au plus` };
        if (labels.some((l) => l.length > 120)) return { kind: 'checklist', message: '120 caractères au plus par point' };
        if (new Set(labels).size !== labels.length) return { kind: 'checklist', message: 'Deux points portent le même texte' };
        return null;
      });
      validate(row.probability, (ctx) => {
        const n = probabilityOf(ctx.value());
        return n !== null && n >= 1 && n <= 99 ? null : { kind: 'probability', message: 'De 1 à 99' };
      });
    });
  });

  constructor() {
    // Un nouveau gabarit de famille propose la nature de montant de cette famille (crédit →
    // décaissement…), tant que l'utilisateur ne l'a pas choisie lui-même.
    if (this.isNew) {
      effect(() => {
        const family = this.formSchema.category().value();
        const kind = FAMILY_AMOUNT_KIND[family];
        if (kind && !this.formSchema.amountKind().dirty()) this.formSchema.amountKind().value.set(kind);
      });
    }
  }

  public readonly title = computed(() => {
    if (this.isNew) return 'Nouveau gabarit';
    return this.isDefault() ? 'Parcours par défaut' : this.template()?.name || 'Gabarit';
  });

  public ngOnInit(): void {
    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    forkJoin({
      templates: this._api.listProjectTemplates(),
      // Sans catalogue lisible, la page reste utilisable : seuls les choix de portée manquent.
      products: this._productsApi.listProducts().pipe(catchError(() => of([] as ProductDto[]))),
      circuits: this._api.listProjectWorkflowCircuits().pipe(catchError(() => of([] as WorkflowCircuitSummary[]))),
    })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(projectTemplateError(error, 'Le gabarit n’a pas pu être chargé.'));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ templates, products, circuits }) => {
        this.circuits.set(circuits ?? []);
        const all = templates ?? [];
        const template = this.isNew
          ? null
          : (all.find((t) => (this._key === DEFAULT_TEMPLATE ? t.scope === 'Default' : t.id === this._key)) ?? null);

        if (!this.isNew && !template) {
          this.loadError.set("Ce gabarit n'existe plus.");
          this.isLoading.set(false);
          return;
        }

        const options = templateScopeOptions(all, products ?? []);
        this.categoryOptions.set(options.categories);
        this.productOptions.set(options.products);
        this.template.set(template);
        this.model.set(TemplateFormModel.instantiate(template));
        this.selected.set(0);
        this._breadcrumb.set([
          { label: 'Paramétrage', link: ['/settings'] },
          { label: 'Étapes des projets', link: ['/settings/project-steps'] },
          { label: this.title() },
        ]);
        this.isLoading.set(false);
      });
  }

  // ——— Étapes ———

  public addStep(): void {
    this.formSchema.steps().value.update((rows) => {
      const last = rows[rows.length - 1];
      return [
        ...rows,
        {
          id: null, label: '', phase: last?.phase ?? 'Prospecting', probability: '', suggestion: '',
          opensClientFile: false, isApproval: false, requiresQuestionnaires: false,
          requiresAmount: false, requiresCloseDate: false, checklist: [], workflowCircuit: NO_CIRCUIT,
          requiredFields: [],
        },
      ];
    });
    this.selected.set(this.model().steps.length - 1);
  }

  public selectStep(index: number): void {
    this.selected.set(index);
  }

  public addChecklistItem(stepIndex: number): void {
    const position = this.model().steps[stepIndex]?.checklist.length ?? 0;
    this.formSchema.steps().value.update((rows) =>
      rows.map((r, i) => (i === stepIndex ? { ...r, checklist: [...r.checklist, { id: null, label: '' }] } : r)),
    );
    // Le curseur dans le nouveau point : resté sur le bouton, chaque espace tapé ajoutait un point vide.
    // Retrouvé par le `name` que les signal forms posent (…steps.2.checklist.0.label) : `tasInput`
    // impose son propre id, et ni un attribut ni une classe ajoutés ici n'arrivent jusqu'au champ.
    setTimeout(() =>
      document.querySelector<HTMLInputElement>(`input[name$="steps.${stepIndex}.checklist.${position}.label"]`)?.focus(),
    );
  }

  public removeChecklistItem(stepIndex: number, itemIndex: number): void {
    this.formSchema.steps().value.update((rows) =>
      rows.map((r, i) => (i === stepIndex ? { ...r, checklist: r.checklist.filter((_, j) => j !== itemIndex) } : r)),
    );
  }

  public removeStep(index: number): void {
    this.formSchema.steps().value.update((rows) => rows.filter((_, i) => i !== index));
    this.selected.set(Math.max(0, Math.min(index, this.model().steps.length - 1)));
  }

  public moveStep(index: number, delta: -1 | 1): void {
    this.formSchema.steps().value.update((rows) => {
      const target = index + delta;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    // La sélection suit l'étape déplacée.
    if (this.selected() === index) this.selected.set(Math.max(0, Math.min(index + delta, this.model().steps.length - 1)));
  }

  // ——— Champs ———

  /** Un champ déjà enregistré garde son type : ses valeurs sont écrites dans ce type. */
  public isSavedField(index: number): boolean {
    return !!this.model().fields[index]?.key;
  }

  public addField(): void {
    this.formSchema.fields().value.update((rows) => [
      ...rows,
      { rowId: `new-${++localRowSeed}`, key: null, label: '', type: 'Text', helpText: '', options: '', savedOptions: [] },
    ]);
  }

  /** Retirer un champ le retire aussi des étapes qui l'exigeaient. */
  public removeField(index: number): void {
    const rowId = this.model().fields[index]?.rowId;
    this.formSchema.fields().value.update((rows) => rows.filter((_, i) => i !== index));
    this.formSchema.steps().value.update((rows) =>
      rows.map((r) => ({ ...r, requiredFields: r.requiredFields.filter((k) => k !== rowId) })),
    );
  }

  public toggleRequiredField(stepIndex: number, rowId: string, on: boolean): void {
    if (!this.canManage()) return;
    this.formSchema.steps().value.update((rows) =>
      rows.map((r, i) =>
        i !== stepIndex
          ? r
          : { ...r, requiredFields: on ? [...new Set([...r.requiredFields, rowId])] : r.requiredFields.filter((k) => k !== rowId) },
      ),
    );
  }

  public applyPreset(key: string): void {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    this.formSchema.steps().value.set(fromPreset(preset.steps));
    this.selected.set(0);
    this.formSchema.tracksForecast().value.set(preset.tracksForecast);
    this.formSchema.amountKind().value.set(preset.amountKind);
    this.formSchema.criticalCloseDate().value.set(!!preset.criticalCloseDate);
    if (!this.model().name.trim()) this.formSchema.name().value.set(preset.label);
  }

  // ——— Enregistrement ———

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();

      // Les nouveaux champs reçoivent ici leur clé, tirée du libellé ; les étapes qui les exigent
      // sont réécrites avec, au lieu du repère local.
      const taken = new Set(v.fields.filter((f) => f.key).map((f) => f.key as string));
      const keyOf = new Map<string, string>();
      const fields: ProjectFieldRequest[] = v.fields.map((f) => {
        const key = f.key ?? fieldKeyOf(f.label, taken);
        taken.add(key);
        keyOf.set(f.rowId, key);
        return {
          key,
          label: f.label.trim(),
          type: f.type as ProjectFieldRequestTypeEnum,
          helpText: f.helpText.trim() || null,
          options: isChoiceType(f.type)
            ? f.options.split('\n').map((l) => l.trim()).filter(Boolean).map((label) => ({
                value: f.savedOptions.find((o) => o.label.toLowerCase() === label.toLowerCase())?.value ?? '',
                label,
              }))
            : null,
        };
      });

      // Les deux requêtes déclarent chacune leur enum : même valeurs, types distincts.
      const forecast = { tracksForecast: v.tracksForecast, criticalCloseDate: v.tracksForecast && v.criticalCloseDate };
      const steps: ProjectStepRequest[] = v.steps.map((s) => ({
        id: s.id,
        label: s.label.trim(),
        phase: s.phase as ProjectStepRequestPhaseEnum,
        probability: probabilityOf(s.probability) ?? 0,
        suggestion: s.suggestion.trim() || null,
        opensClientFile: s.opensClientFile,
        isApproval: s.isApproval,
        requiresQuestionnaires: s.requiresQuestionnaires,
        requiresAmount: s.requiresAmount,
        requiresCloseDate: s.requiresCloseDate,
        // Un point laissé vide est un point qu'on n'a pas fini d'écrire : il n'est pas envoyé.
        checklist: s.checklist.filter((i) => i.label.trim()).map((i) => ({ id: i.id, label: i.label.trim() })),
        workflowCircuit: s.workflowCircuit === NO_CIRCUIT ? null : s.workflowCircuit || null,
        requiredFieldKeys: s.requiredFields.map((rowId) => keyOf.get(rowId)).filter((k): k is string => !!k),
      }));

      // Le parcours intégré n'est pas stocké : l'enregistrer en crée la copie du tenant, avec les
      // ids d'étapes intégrés pour que les projets déjà placés dessus y restent.
      const template = this.template();
      const call: Observable<unknown> = template?.id
        ? this._api.updateProjectTemplate(template.id, {
            name: v.name.trim(), steps, fields, ...forecast, amountKind: v.amountKind as UpdateProjectTemplateRequestAmountKindEnum,
          })
        : this._api.createProjectTemplate({
            name: v.name.trim(),
            category: !this.isDefault() && v.scope === 'Category' ? (v.category as CreateProjectTemplateRequestCategoryEnum) : null,
            productCode: !this.isDefault() && v.scope === 'Product' ? v.productCode : null,
            steps,
            fields,
            ...forecast,
            amountKind: v.amountKind as CreateProjectTemplateRequestAmountKindEnum,
          });

      const saved = await firstValueFrom(
        call.pipe(
          catchError((error: HttpErrorResponse) => {
            const marked = steps.find((s) => s.requiresQuestionnaires)?.label ?? undefined;
            this._snackbar.error('Gabarit non enregistré', projectTemplateError(error, 'L’enregistrement a échoué.', marked));
            return EMPTY;
          }),
        ),
        { defaultValue: 'failed' as const },
      );

      if (saved === 'failed') return;
      this._snackbar.success(
        'Gabarit enregistré',
        template?.id
          ? `Les nouveaux projets suivent « ${v.name.trim()} » tel qu'enregistré ; les projets en cours gardent leur version.`
          : `« ${v.name.trim()} » s'applique aux nouveaux projets.`,
      );
      this.back();
    });
  }

  public delete(): void {
    const id = this.template()?.id;
    if (!id) return;
    const isDefault = this.isDefault();
    this._confirm.confirm({
      title: isDefault ? 'Revenir au parcours standard ?' : 'Supprimer ce gabarit ?',
      message: isDefault
        ? 'Les projets sans gabarit de famille ou de produit reprendront les cinq étapes standard.'
        : 'Ses projets suivront le gabarit de leur famille, sinon le parcours par défaut, sur l’étape de même phase.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: isDefault ? 'Revenir au standard' : 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isDeleting.set(true);
        this._api
          .deleteProjectTemplate(id)
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this.isDeleting.set(false);
              this._snackbar.error('Suppression impossible', projectTemplateError(error, 'La suppression a échoué.'));
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this._snackbar.success('Gabarit supprimé', 'Les projets concernés suivent désormais le niveau suivant.');
            this.back();
          });
      },
    });
  }

  public back(): void {
    void this._router.navigate(['/settings/project-steps']);
  }
}

export default ProjectTemplatePage;
