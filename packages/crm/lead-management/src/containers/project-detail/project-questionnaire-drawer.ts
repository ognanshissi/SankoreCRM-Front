import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, validate } from '@angular/forms/signals';
import { catchError, EMPTY, finalize } from 'rxjs';
import {
  LeadsApiService,
  OpportunitiesApiService,
  ProjectQuestionnaireItemDto,
  QualificationTemplateDto,
  QuestionnaireRespondentDto,
} from '@sankore/crm-api';
import { DynamicFormAnswers, DynamicFormRendererComponent, DynamicFormSchema } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TasDrawerAction, TasDrawerContent, TasDrawerTitle, TasSideDrawer } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTitle } from '@talisoft/ui/title';

export interface ProjectQuestionnaireDrawerData {
  projectId: string;
  item: ProjectQuestionnaireItemDto;
  respondents: QuestionnaireRespondentDto[];
  /** Consultation seule : projet clos, ou pas le droit de le modifier. */
  readOnly: boolean;
}

/** Conversion gabarit → schéma du rendu dynamique. */
function templateToSchema(t: QualificationTemplateDto): DynamicFormSchema {
  return {
    sections: (t.sections ?? []).map((s) => ({
      id: s.id!,
      title: s.title ?? '',
      description: s.description,
      order: s.order ?? 0,
    })),
    questions: (t.questions ?? []).map((q) => ({
      id: q.id!,
      sectionId: q.sectionId,
      label: q.label ?? '',
      helpText: q.helpText,
      placeholderText: q.placeholderText,
      type: (q.type as DynamicFormSchema['questions'][number]['type']) ?? 'Text',
      options: q.options,
      isRequired: q.isRequired ?? false,
      order: q.order ?? 0,
      minValue: q.minValue,
      maxValue: q.maxValue,
      rules: (q.rules ?? []).map((r) => ({
        triggerQuestionId: r.triggerQuestionId!,
        triggerValue: r.triggerValue ?? '',
        action: (r.action as 'Show' | 'Hide' | 'Require') ?? 'Show',
      })),
    })),
  };
}

const ERROR_MESSAGES: Record<string, string> = {
  HEALTH_CONSENT_MISSING: 'Le consentement santé de cette personne doit être recueilli avant la saisie.',
  MINOR_REQUIRES_RESPONDENT: 'Désignez qui répond pour ce mineur.',
  MINOR_RESPONDENT_MUST_BE_PARENT: 'Pour un mineur, le répondant doit être le titulaire ou son conjoint.',
  QUESTIONNAIRE_TEMPLATE_NOT_APPLICABLE: "Ce questionnaire ne s'applique plus à ce projet : rechargez la page.",
  QUESTIONNAIRE_PLAN_UNAVAILABLE: 'Le catalogue des produits ne répond pas. Réessayez dans un instant.',
  REQUIRED_QUESTIONS_NOT_ANSWERED: 'Répondez à toutes les questions obligatoires.',
  OPPORTUNITY_ALREADY_CLOSED: 'Ce projet est clos : ses questionnaires ne se modifient plus.',
  LEAD_NOT_YOURS: "Ce dossier ne vous est pas attribué : vous ne pouvez pas y répondre.",
};

class RespondentFormModel {
  public respondentId!: string;

  public static from(id: string | null | undefined): RespondentFormModel {
    const m = new RespondentFormModel();
    m.respondentId = id ?? '';
    return m;
  }
}

/**
 * Saisie d'un questionnaire du projet : celui du dossier, ou celui d'une personne. Les brouillons
 * restent en mémoire — un questionnaire santé est une donnée de santé, et le stockage du navigateur
 * la garderait sur le poste bien après la session.
 */
@Component({
  selector: 'project-questionnaire-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormRoot, FormField,
    TasSideDrawer, TasDrawerTitle, TasDrawerContent, TasDrawerAction, TasTitle, Button,
    TasFormField, TasLabel, TasError, TasHint, TasSelect, TasSpinner,
    DynamicFormRendererComponent,
  ],
  template: `
    <tas-side-drawer>
      <tas-drawer-title>
        <TasTitle class="text-lg">{{ data.item.templateName || 'Questionnaire' }}</TasTitle>
        <p class="text-sm text-slate-500">{{ data.item.subjectLabel }}</p>
      </tas-drawer-title>

      <tas-drawer-content>
        @if (isLoading()) {
          <div class="flex justify-center py-12"><tas-spinner size="8" class="text-primary"></tas-spinner></div>
        } @else if (loadError()) {
          <p class="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{{ loadError() }}</p>
        } @else if (schema(); as s) {
          @if (data.item.inheritedFromLead) {
            <p class="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
              Ces réponses ont été données sur le lead. Une modification ici ne vaudra que pour ce projet.
            </p>
          }
          @if (withheld()) {
            <p class="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{{ withheld() }}</p>
          }

          @if (data.readOnly) {
            @if (answeredRows().length === 0) {
              <p class="text-sm text-slate-500">Aucune réponse enregistrée.</p>
            } @else {
              <dl class="flex flex-col gap-3 text-sm">
                @for (row of answeredRows(); track row.label) {
                  <div>
                    <dt class="text-slate-500">{{ row.label }}</dt>
                    <dd class="font-medium text-slate-800">{{ row.value }}</dd>
                  </div>
                }
              </dl>
            }
          } @else {
            @if (data.item.isMinor && respondentOptions().length > 0) {
              <form [formRoot]="respondentForm" class="mb-5">
                <tas-form-field>
                  <tas-label>Qui répond <span class="text-functional-error">*</span></tas-label>
                  <tas-select [options]="respondentOptions()" placeholder="Choisir le répondant" [formField]="respondentForm.respondentId"></tas-select>
                  <tas-hint>Un mineur ne répond pas lui-même : le titulaire ou son conjoint répond pour lui.</tas-hint>
                  @if (respondentForm.respondentId().touched() && respondentForm.respondentId().invalid()) {
                    <tas-error>{{ respondentForm.respondentId().errors()[0].message }}</tas-error>
                  }
                </tas-form-field>
              </form>
            }
            <dynamic-form-renderer [schema]="s" [initialAnswers]="initialAnswers()"></dynamic-form-renderer>
          }
        }
      </tas-drawer-content>

      <tas-drawer-action>
        <button tas-outlined-button type="button" (click)="close()">{{ data.readOnly ? 'Fermer' : 'Annuler' }}</button>
        @if (!data.readOnly) {
          <button tas-raised-button color="primary" type="button"
                  [disabled]="!schema() || isSubmitting()" [isLoading]="isSubmitting()" (click)="handleSubmit()">
            Enregistrer
          </button>
        }
      </tas-drawer-action>
    </tas-side-drawer>
  `,
})
export class ProjectQuestionnaireDrawer implements OnInit {
  public readonly data = inject<ProjectQuestionnaireDrawerData>(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _renderer = viewChild(DynamicFormRendererComponent);

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly isSubmitting = signal(false);
  private readonly _template = signal<QualificationTemplateDto | null>(null);

  public readonly schema = computed(() => {
    const t = this._template();
    return t ? templateToSchema(t) : null;
  });

  public readonly withheld = computed(() => {
    const item = this.data.item;
    if (item.status !== 'Completed') return null;
    if (item.isPurged) return 'Les réponses de ce questionnaire ont été purgées.';
    if (item.answersWithheldReason === 'HEALTH_ANSWERS_FORBIDDEN') {
      return "Vous n'avez pas le droit de lire les réponses santé : elles ne sont pas reprises ci-dessous.";
    }
    return item.answersWithheldReason ? 'Les réponses précédentes ne peuvent pas être affichées.' : null;
  });

  public readonly initialAnswers = computed<DynamicFormAnswers>(() => {
    const answers: DynamicFormAnswers = {};
    for (const a of this.data.item.answers ?? []) {
      if (a.questionId) answers[a.questionId] = a.value ?? null;
    }
    return answers;
  });

  public readonly answeredRows = computed(() => {
    const questions = this._template()?.questions ?? [];
    const answers = this.initialAnswers();
    return questions
      .filter((q) => q.id && answers[q.id] != null && answers[q.id] !== '')
      .map((q) => ({ label: q.label ?? 'Question', value: this._display(q.type, answers[q.id!]!) }));
  });

  public readonly respondentOptions = computed(() =>
    this.data.respondents
      .filter((r) => r.id !== this.data.item.subjectId)
      .map((r) => ({ value: r.id!, label: r.label ?? 'Répondant' })),
  );

  public readonly respondentModel = signal(RespondentFormModel.from(this.data.item.respondentId));
  public readonly respondentForm = form(this.respondentModel, (schema) => {
    validate(schema.respondentId, (ctx) =>
      this.data.item.isMinor && this.respondentOptions().length > 0 && !ctx.value()
        ? { kind: 'required', message: 'Le répondant est obligatoire pour un mineur' }
        : null,
    );
  });

  public ngOnInit(): void {
    this._leadsApi
      .getQualificationTemplate(this.data.item.templateId!)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(
            error.status === 404
              ? "Ce questionnaire n'existe plus ou n'est plus publié."
              : 'Impossible de charger le questionnaire.',
          );
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((template) => this._template.set(template));
  }

  public handleSubmit(): void {
    const renderer = this._renderer();
    if (!renderer) return;

    renderer.markAllTouched();
    this.respondentForm().markAsTouched();
    if (this.respondentForm().invalid()) {
      this._snackbar.error('Validation', 'Désignez le répondant de ce mineur.');
      return;
    }
    if (!renderer.isValid()) {
      this._snackbar.error('Validation', 'Répondez à toutes les questions obligatoires.');
      return;
    }

    const answers = Object.entries(renderer.getAnswers()).map(([questionId, value]) => ({ questionId, value: value ?? '' }));
    if (answers.length === 0) {
      this._snackbar.error('Validation', 'Répondez au moins à une question.');
      return;
    }

    this.isSubmitting.set(true);
    this._opportunitiesApi
      .submitProjectQuestionnaireResponse(this.data.projectId, {
        templateId: this.data.item.templateId!,
        subjectType: this.data.item.subjectType ?? '',
        subjectId: this.data.item.subjectId!,
        answers,
        respondentId: this.data.item.isMinor ? this.respondentModel().respondentId || null : null,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Questionnaire non enregistré', this._errorMessage(error));
          return EMPTY;
        }),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe(() => {
        this._snackbar.success('Questionnaire enregistré', `Les réponses de « ${this.data.item.subjectLabel} » sont enregistrées.`);
        this._dialogRef.close(true);
      });
  }

  public close(): void {
    this._dialogRef.close(false);
  }

  private _display(type: string | null | undefined, value: string): string {
    if (type === 'YesNo') return value === 'true' ? 'Oui' : value === 'false' ? 'Non' : value;
    return value;
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as { detail?: string; title?: string; error?: string; errors?: Record<string, string[]> } | null;
    const code = body?.detail ?? body?.error;
    if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    if (error.status === 403) return "Vous n'avez pas le droit d'enregistrer ce questionnaire.";
    const fieldErrors = Object.values(body?.errors ?? {}).flat();
    if (fieldErrors.length > 0) return fieldErrors.join(' ');
    return body?.title ?? "Impossible d'enregistrer le questionnaire.";
  }
}

export default ProjectQuestionnaireDrawer;
