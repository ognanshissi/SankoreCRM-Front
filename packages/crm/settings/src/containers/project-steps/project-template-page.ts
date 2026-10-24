import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { applyEach, disabled, form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, forkJoin, Observable, of } from 'rxjs';
import {
  CreateProjectTemplateRequestAmountKindEnum,
  CreateProjectTemplateRequestCategoryEnum,
  ProductDto,
  ProductsApiService,
  ProjectStepRequest,
  ProjectStepRequestPhaseEnum,
  ProjectTemplateDto,
  ProjectTemplatesApiService,
  UpdateProjectTemplateRequestAmountKindEnum,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasCard } from '@talisoft/ui/card';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { BreadcrumbService, PermissionsService, PROJECT_AMOUNT_KINDS } from '@sankore/crm/common';
import {
  FAMILY_AMOUNT_KIND,
  PHASE_OPTIONS,
  phaseIndex,
  PRESETS,
  projectTemplateError,
  StepPreset,
  templateScopeOptions,
} from './project-steps.models';

/** Le segment d'URL d'un nouveau gabarit, et celui du parcours par défaut (qui n'a pas d'id tant qu'il n'est pas modifié). */
export const NEW_TEMPLATE = 'new';
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
}

class TemplateFormModel {
  public name!: string;
  public scope!: Scope;
  public category!: string;
  public productCode!: string;
  public tracksForecast!: boolean;
  public amountKind!: string;
  public criticalCloseDate!: boolean;
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
    m.steps = (template?.steps ?? []).map((s) => ({
      id: s.id ?? null,
      label: s.label ?? '',
      phase: s.phase ?? 'Prospecting',
      probability: String(s.probability ?? ''),
      suggestion: s.suggestion ?? '',
      opensClientFile: !!s.opensClientFile,
      isApproval: !!s.isApproval,
      requiresQuestionnaires: !!s.requiresQuestionnaires,
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
  }));
}

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
  imports: [
    RouterLink, TasCard, TasSpinner, Button,
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
  public readonly phaseOptions = PHASE_OPTIONS;
  public readonly presets = PRESETS;
  public readonly amountKindOptions = PROJECT_AMOUNT_KINDS.map((k) => ({ value: k.value, label: k.label }));
  public readonly maxSteps = 12;

  public readonly scopeOptions = [
    { value: 'Category', label: 'Une famille de produits' },
    { value: 'Product', label: 'Un produit précis' },
  ];

  public readonly isDeleting = signal(false);

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

    applyEach(schema.steps, (row) => {
      required(row.label, { message: 'Nom obligatoire' });
      maxLength(row.label, 60, { message: '60 caractères au plus' });
      maxLength(row.suggestion, 200, { message: '200 caractères au plus' });
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
    })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(projectTemplateError(error, 'Le gabarit n’a pas pu être chargé.'));
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ templates, products }) => {
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
      return [...rows, { id: null, label: '', phase: last?.phase ?? 'Prospecting', probability: '', suggestion: '', opensClientFile: false, isApproval: false, requiresQuestionnaires: false }];
    });
  }

  public removeStep(index: number): void {
    this.formSchema.steps().value.update((rows) => rows.filter((_, i) => i !== index));
  }

  public moveStep(index: number, delta: -1 | 1): void {
    this.formSchema.steps().value.update((rows) => {
      const target = index + delta;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  public applyPreset(key: string): void {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    this.formSchema.steps().value.set(fromPreset(preset.steps));
    this.formSchema.tracksForecast().value.set(preset.tracksForecast);
    this.formSchema.amountKind().value.set(preset.amountKind);
    this.formSchema.criticalCloseDate().value.set(!!preset.criticalCloseDate);
    if (!this.model().name.trim()) this.formSchema.name().value.set(preset.label);
  }

  // ——— Enregistrement ———

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
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
      }));

      // Le parcours intégré n'est pas stocké : l'enregistrer en crée la copie du tenant, avec les
      // ids d'étapes intégrés pour que les projets déjà placés dessus y restent.
      const template = this.template();
      const call: Observable<unknown> = template?.id
        ? this._api.updateProjectTemplate(template.id, {
            name: v.name.trim(), steps, ...forecast, amountKind: v.amountKind as UpdateProjectTemplateRequestAmountKindEnum,
          })
        : this._api.createProjectTemplate({
            name: v.name.trim(),
            category: !this.isDefault() && v.scope === 'Category' ? (v.category as CreateProjectTemplateRequestCategoryEnum) : null,
            productCode: !this.isDefault() && v.scope === 'Product' ? v.productCode : null,
            steps,
            ...forecast,
            amountKind: v.amountKind as CreateProjectTemplateRequestAmountKindEnum,
          });

      const saved = await firstValueFrom(
        call.pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error('Gabarit non enregistré', projectTemplateError(error, 'L’enregistrement a échoué.'));
            return EMPTY;
          }),
        ),
        { defaultValue: 'failed' as const },
      );

      if (saved === 'failed') return;
      this._snackbar.success('Gabarit enregistré', `« ${v.name.trim()} » s'applique aux projets dès maintenant.`);
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
