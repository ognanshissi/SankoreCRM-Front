import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { applyEach, form, FormField, FormRoot, maxLength, required, submit, validate } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, Observable } from 'rxjs';
import {
  CreateProjectTemplateRequestCategoryEnum,
  ProjectStepRequest,
  ProjectStepRequestPhaseEnum,
  ProjectTemplateDto,
  ProjectTemplatesApiService,
} from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasTitle } from '@talisoft/ui/title';
import { PHASE_OPTIONS, phaseIndex, PRESETS, projectTemplateError, StepPreset } from './project-steps.models';

export interface ProjectTemplateDrawerData {
  /** Null pour un nouveau gabarit de famille ou de produit. */
  template: ProjectTemplateDto | null;
  /** Les familles et produits du catalogue qui n'ont pas encore de gabarit. */
  categoryOptions: { value: string; label: string }[];
  productOptions: { value: string; label: string }[];
  canManage: boolean;
}

/** Ce que le tiroir rend : vrai quand un gabarit a été enregistré ou supprimé. */
export type ProjectTemplateDrawerResult = boolean;

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
  public steps!: StepRow[];

  public static instantiate(template: ProjectTemplateDto | null): TemplateFormModel {
    const m = new TemplateFormModel();
    m.name = template?.name ?? '';
    m.scope = template?.scope === 'Product' ? 'Product' : 'Category';
    m.category = template?.category ?? '';
    m.productCode = template?.productCode ?? '';
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
 * Crée ou modifie un gabarit d'étapes. Le gabarit par défaut et celui d'une famille ou d'un produit
 * se modifient de la même façon ; seule la portée d'un NOUVEAU gabarit se choisit, ensuite elle ne
 * change plus.
 */
@Component({
  selector: 'project-template-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-template-drawer.html',
  imports: [
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasError, TasHint, TasInput, TasSelect, TasIcon, FormRoot, FormField,
  ],
})
export class ProjectTemplateDrawer {
  private readonly _dialogRef = inject(DialogRef<ProjectTemplateDrawerResult>);
  private readonly _api = inject(ProjectTemplatesApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  public readonly data: ProjectTemplateDrawerData = inject(DIALOG_DATA);

  public readonly template = this.data.template;
  public readonly isNew = !this.template;
  public readonly isDefault = this.template?.scope === 'Default';
  public readonly phaseOptions = PHASE_OPTIONS;
  public readonly presets = PRESETS;
  public readonly maxSteps = 12;

  public readonly scopeOptions = [
    { value: 'Category', label: 'Une famille de produits' },
    { value: 'Product', label: 'Un produit précis' },
  ];

  public readonly isDeleting = signal(false);

  public model = signal(TemplateFormModel.instantiate(this.template));
  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom est obligatoire' });
    maxLength(schema.name, 100, { message: '100 caractères au plus' });

    if (this.isNew) {
      required(schema.category, { message: 'Choisissez une famille', when: ({ valueOf }) => valueOf(schema.scope) === 'Category' });
      required(schema.productCode, { message: 'Choisissez un produit', when: ({ valueOf }) => valueOf(schema.scope) === 'Product' });
    }

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

  public readonly title = computed(() => {
    if (this.isNew) return 'Nouveau gabarit';
    return this.isDefault ? 'Parcours par défaut' : 'Modifier le gabarit';
  });

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
    if (!this.model().name.trim()) this.formSchema.name().value.set(preset.label);
  }

  // ——— Enregistrement ———

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const v = field().value();
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
      const call: Observable<unknown> = this.template?.id
        ? this._api.updateProjectTemplate(this.template.id, { name: v.name.trim(), steps })
        : this._api.createProjectTemplate({
            name: v.name.trim(),
            category: !this.isDefault && v.scope === 'Category' ? (v.category as CreateProjectTemplateRequestCategoryEnum) : null,
            productCode: !this.isDefault && v.scope === 'Product' ? v.productCode : null,
            steps,
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
      this._dialogRef.close(true);
    });
  }

  public delete(): void {
    const id = this.template?.id;
    if (!id) return;
    this._confirm.confirm({
      title: this.isDefault ? 'Revenir au parcours standard ?' : 'Supprimer ce gabarit ?',
      message: this.isDefault
        ? 'Les projets sans gabarit de famille ou de produit reprendront les cinq étapes standard.'
        : 'Ses projets suivront le gabarit de leur famille, sinon le parcours par défaut, sur l’étape de même phase.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: this.isDefault ? 'Revenir au standard' : 'Supprimer', theme: 'warn' },
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
            this._dialogRef.close(true);
          });
      },
    });
  }

  public close(): void {
    this._dialogRef.close(false);
  }
}

export default ProjectTemplateDrawer;
