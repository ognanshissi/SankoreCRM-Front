import { Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError, TasHint } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { WorkflowTemplateDto, WorkflowTemplatesApiService } from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { entityTypeLabel } from '../workflow-shared';

class EditTemplateFormModel {
  public name!: string;
  public description!: string;

  public static fromTemplate(template: WorkflowTemplateDto): EditTemplateFormModel {
    const m = new EditTemplateFormModel();
    m.name = template.name ?? '';
    m.description = template.description ?? '';
    return m;
  }
}

@Component({
  selector: 'workflow-informations',
  imports: [
    TasCard,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
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
    } @else if (template()) {
      <div class="pb-6 flex flex-col gap-4">

        <!-- Read-only metadata -->
        <tas-card>
          <div class="p-4 grid grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <p class="text-xs text-slate-400 mb-1">Entité déclencheur</p>
              <p class="text-sm font-medium text-slate-800">
                {{ entityTypeLabel(template()!.entityType) }}
              </p>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Statut</p>
              <span
                class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                [class]="template()!.isActive
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'"
              >
                {{ template()!.isActive ? 'Actif' : 'Brouillon' }}
              </span>
            </div>
            <div>
              <p class="text-xs text-slate-400 mb-1">Nombre d'étapes</p>
              <p class="text-sm font-medium text-slate-800">
                {{ template()!.steps?.length ?? 0 }}
              </p>
            </div>
          </div>
        </tas-card>

        <!-- Edit form -->
        <tas-card>
          <div class="p-4 flex flex-col gap-4">
            <p class="text-sm font-semibold text-slate-700">Modifier les informations</p>
            <form [formRoot]="updateFormSchema" class="flex flex-col gap-4">
              <tas-form-field>
                <tas-label>Nom du modèle <span class="text-functional-error">*</span></tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="Nom du modèle"
                  [formField]="updateFormSchema.name"
                />
                @if (updateFormSchema.name().touched() && updateFormSchema.name().invalid()) {
                  <tas-error>{{ updateFormSchema.name().errors()[0].message }}</tas-error>
                }
              </tas-form-field>

              <tas-form-field>
                <tas-label>Description</tas-label>
                <input
                  tasInput
                  type="text"
                  placeholder="À quoi sert ce workflow ?"
                  [formField]="updateFormSchema.description"
                />
              </tas-form-field>
            </form>
            <div class="flex justify-end">
              <button
                tas-raised-button
                color="primary"
                type="button"
                (click)="handleSave()"
                [disabled]="updateFormSchema().invalid() || updateFormSchema().submitting()"
                [isLoading]="updateFormSchema().submitting()"
              >
                <tas-icon iconName="feather:save" iconSize="sm"></tas-icon>
                Enregistrer
              </button>
            </div>
          </div>
        </tas-card>

        <!-- Activate / Deactivate -->
        <tas-card>
          <div class="p-4 flex items-start justify-between gap-4">
            <div class="flex items-start gap-3">
              <div class="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                [class]="template()!.isActive ? 'bg-yellow-50' : 'bg-green-50'"
              >
                <tas-icon
                  [iconName]="template()!.isActive ? 'feather:pause-circle' : 'feather:play-circle'"
                  [class]="template()!.isActive ? 'text-yellow-500' : 'text-green-500'"
                  style="font-size:14px"
                ></tas-icon>
              </div>
              <div>
                <p class="text-sm font-medium text-slate-700">
                  {{ template()!.isActive ? 'Désactiver le modèle' : 'Activer le modèle' }}
                </p>
                <p class="text-xs text-slate-400 mt-0.5">
                  @if (template()!.isActive) {
                    Les nouvelles instances ne pourront plus être démarrées. Les instances en cours ne seront pas affectées.
                  } @else {
                    Le modèle sera disponible pour démarrer de nouvelles instances de workflow.
                  }
                </p>
              </div>
            </div>
            <button
              [attr.tas-outlined-button]="template()!.isActive ? '' : null"
              [attr.tas-filled-button]="!template()!.isActive ? '' : null"
              color="primary"
              type="button"
              [disabled]="isTogglingStatus()"
              (click)="toggleStatus()"
              class="shrink-0"
            >
              {{ template()!.isActive ? 'Désactiver' : 'Activer' }}
            </button>
          </div>
        </tas-card>

        <!-- Create draft (active templates only) -->
        @if (template()!.isActive) {
          <tas-card>
            <div class="p-4 flex items-start justify-between gap-4">
              <div class="flex items-start gap-3">
                <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center shrink-0 mt-0.5">
                  <tas-icon iconName="feather:copy" class="text-slate-400" style="font-size:14px"></tas-icon>
                </div>
                <div>
                  <p class="text-sm font-medium text-slate-700">Créer un brouillon modifiable</p>
                  <p class="text-xs text-slate-400 mt-0.5">
                    Duplique ce modèle en brouillon. Le modèle actif reste inchangé jusqu'à la prochaine activation.
                  </p>
                </div>
              </div>
              <button
                tas-outlined-button
                color="primary"
                type="button"
                [disabled]="isCreatingDraft()"
                (click)="createDraft()"
                class="shrink-0"
              >
                Créer un brouillon
              </button>
            </div>
          </tas-card>
        }

      </div>
    }
  `,
})
export class WorkflowInformationsPage {
  private readonly _workflowTemplatesApiService = inject(WorkflowTemplatesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly id = input.required<string>();
  public readonly entityTypeLabel = entityTypeLabel;

  public isLoading = signal(true);
  public isTogglingStatus = signal(false);
  public isCreatingDraft = signal(false);
  public template = signal<WorkflowTemplateDto | null>(null);

  public updateModel = signal(new EditTemplateFormModel());
  public updateFormSchema = form(this.updateModel, (schema) => {
    required(schema.name, { message: 'Le nom du modèle est obligatoire' });
  });

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      this._workflowTemplatesApiService.getWorkflowTemplate(this.id()).subscribe({
        next: (template) => {
          this.template.set(template);
          this.updateModel.set(EditTemplateFormModel.fromTemplate(template));
          this.isLoading.set(false);
        },
        error: () => {
          this._snackbarService.error('Erreur', 'Impossible de charger le modèle.');
          this.isLoading.set(false);
        },
      });
    });
  }

  public handleSave(): void {
    submit(this.updateFormSchema, async (field) => {
      const value = field()?.value();
      await firstValueFrom(
        this._workflowTemplatesApiService
          .updateWorkflowTemplate(this.id(), {
            name: value.name,
            description: value.description || null,
          })
          .pipe(
            catchError(() => {
              this._snackbarService.error('Erreur', 'Impossible de mettre à jour le modèle.');
              return EMPTY;
            }),
          ),
      );
      this._snackbarService.success('Succès', 'Modèle mis à jour avec succès.');
      this.template.update((t) =>
        t ? { ...t, name: value.name, description: value.description } : t,
      );
    });
  }

  public toggleStatus(): void {
    const template = this.template();
    if (!template) return;

    this.isTogglingStatus.set(true);
    const request$ = template.isActive
      ? this._workflowTemplatesApiService.deactivateWorkflowTemplate(this.id())
      : this._workflowTemplatesApiService.activateWorkflowTemplate(this.id());

    request$
      .pipe(
        catchError(() => {
          this._snackbarService.error(
            'Erreur',
            `Impossible de ${template.isActive ? 'désactiver' : 'activer'} le modèle.`,
          );
          this.isTogglingStatus.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.template.update((t) => (t ? { ...t, isActive: !t.isActive } : t));
        this._snackbarService.success(
          'Succès',
          template.isActive ? 'Modèle désactivé.' : 'Modèle activé.',
        );
        this.isTogglingStatus.set(false);
      });
  }

  public createDraft(): void {
    this.isCreatingDraft.set(true);
    this._workflowTemplatesApiService
      .createWorkflowTemplateDraft(this.id())
      .pipe(
        catchError(() => {
          this._snackbarService.error('Erreur', 'Impossible de créer le brouillon.');
          this.isCreatingDraft.set(false);
          return EMPTY;
        }),
      )
      .subscribe((draftId) => {
        this.isCreatingDraft.set(false);
        if (draftId) {
          this._snackbarService.success('Succès', 'Brouillon créé. Redirection…');
          this._router.navigate(['/settings/workflows', draftId]);
        } else {
          this._snackbarService.success('Succès', 'Brouillon créé. Retrouvez-le dans la liste des workflows.');
        }
      });
  }
}

export default WorkflowInformationsPage;
