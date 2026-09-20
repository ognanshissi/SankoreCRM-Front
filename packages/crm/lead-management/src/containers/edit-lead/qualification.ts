import { Component, computed, effect, inject, input, signal, viewChild, OnDestroy } from '@angular/core';
import { catchError, EMPTY, finalize } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { Severity, TasTag } from '@talisoft/ui/tag';
import {
  LeadsApiService,
  LeadDto,
  QualificationTemplateDto,
  QualifyLeadResult,
  QualifyLeadResultNextActionEnum,
} from '@sankore/crm-api';
import {
  DynamicFormRendererComponent,
  DynamicFormSchema,
  DynamicFormAnswers,
} from '@sankore/crm/common';

type PageState = 'loading' | 'no-product' | 'no-template' | 'form' | 'submitted';

function draftKey(leadId: string, templateId: string, version: number): string {
  return `qualification_draft_${leadId}_${templateId}_v${version}`;
}

function nextActionMeta(action: QualifyLeadResultNextActionEnum | undefined): { label: string; severity: Severity; icon: string } {
  switch (action) {
    case QualifyLeadResultNextActionEnum.DispatchToAgent:
      return { label: 'Transférer à un agent', severity: 'success', icon: 'feather:user-check' };
    case QualifyLeadResultNextActionEnum.CollectMoreData:
      return { label: 'Collecter plus d\'informations', severity: 'warning', icon: 'feather:edit-3' };
    case QualifyLeadResultNextActionEnum.Disqualify:
      return { label: 'Disqualifié', severity: 'error', icon: 'feather:x-circle' };
    default:
      return { label: 'Terminé', severity: 'info', icon: 'feather:check-circle' };
  }
}

@Component({
  selector: 'lead-qualification',
  imports: [
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    DynamicFormRendererComponent,
  ],
  template: `
    @switch (pageState()) {
      @case ('loading') {
        <div class="flex justify-center py-24">
          <tas-spinner size="10" class="text-primary"></tas-spinner>
        </div>
      }
      @case ('no-product') {
        <div class="flex flex-col items-center justify-center py-24 text-center">
          <div class="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <tas-icon iconName="feather:package" class="text-slate-400" style="font-size:24px"></tas-icon>
          </div>
          <p class="text-sm text-slate-500">Ce lead n'a pas de produit associé.</p>
          <p class="text-xs text-slate-400 mt-1">Renseignez un produit d'intérêt pour accéder à la qualification.</p>
        </div>
      }
      @case ('no-template') {
        <div class="flex flex-col items-center justify-center py-24 text-center">
          <div class="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mb-3">
            <tas-icon iconName="feather:clipboard" class="text-amber-400" style="font-size:24px"></tas-icon>
          </div>
          <p class="text-sm text-slate-500">Aucun formulaire de qualification actif</p>
          <p class="text-xs text-slate-400 mt-1">Aucune configuration publiée n'est disponible pour le produit « {{ lead()?.interestedProduct }} ».</p>
        </div>
      }
      @case ('submitted') {
        <!-- Submission result -->
        <tas-card>
          <div class="p-6 text-center">
            <div class="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
              <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:32px"></tas-icon>
            </div>
            <h2 class="text-lg font-semibold text-slate-800 mb-2">Qualification soumise</h2>

            @if (submissionResult()) {
              <div class="mt-4 flex flex-col items-center gap-3">
                <!-- Score -->
                <div class="flex items-center gap-3">
                  <span class="text-sm text-slate-500">Score :</span>
                  <span
                    class="text-2xl font-bold tabular-nums"
                    [class]="scoreTextColor(submissionResult()!.score ?? 0)"
                  >
                    {{ submissionResult()!.score ?? 0 }}
                  </span>
                  <span class="text-sm text-slate-400">/ 100</span>
                </div>

                <!-- Status -->
                @if (submissionResult()!.status) {
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-slate-500">Statut :</span>
                    <tas-tag severity="info">{{ submissionResult()!.status }}</tas-tag>
                  </div>
                }

                <!-- Intent level -->
                @if (submissionResult()!.intentLevel != null) {
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-slate-500">Température :</span>
                    <tas-tag [severity]="intentSeverity(submissionResult()!.intentLevel)">
                      {{ intentLabel(submissionResult()!.intentLevel) }}
                    </tas-tag>
                  </div>
                }

                <!-- Next action -->
                <div class="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 inline-flex items-center gap-2">
                  <tas-icon [iconName]="resultActionMeta().icon" style="font-size:16px"></tas-icon>
                  <span class="text-sm font-medium">{{ resultActionMeta().label }}</span>
                </div>

                @if (submissionResult()!.nextActionDetail) {
                  <p class="text-xs text-slate-500 mt-1">{{ submissionResult()!.nextActionDetail }}</p>
                }
              </div>
            }

            <button
              tas-outlined-button
              color="primary"
              class="mt-6"
              type="button"
              (click)="resetToForm()"
            >
              <tas-icon iconName="feather:edit-3" style="font-size:14px"></tas-icon>
              Requalifier
            </button>
          </div>
        </tas-card>
      }
      @case ('form') {
        <div class="pb-6">
          <!-- Form header -->
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-base font-semibold text-slate-800">{{ template()?.name }}</h2>
              @if (template()?.description) {
                <p class="text-sm text-slate-500 mt-0.5">{{ template()?.description }}</p>
              }
              <p class="text-xs text-slate-400 mt-1">
                Version {{ template()?.version }}
                @if (hasDraft()) {
                  — <span class="text-amber-600 font-medium">Brouillon restauré</span>
                }
              </p>
            </div>
            @if (hasDraft()) {
              <button
                tas-outlined-button
                type="button"
                (click)="clearDraft()"
                class="text-xs"
              >
                <tas-icon iconName="feather:trash-2" style="font-size:12px"></tas-icon>
                Effacer le brouillon
              </button>
            }
          </div>

          <!-- Dynamic form -->
          <dynamic-form-renderer
            [schema]="formSchema()!"
            [initialAnswers]="restoredAnswers()"
            (answersChanged)="onAnswersChanged($event)"
          ></dynamic-form-renderer>

          <!-- Submit -->
          <div class="flex items-center justify-end gap-3 mt-4">
            @if (isSubmitting()) {
              <tas-spinner size="4" class="text-primary"></tas-spinner>
            }
            <button
              tas-button
              color="primary"
              type="button"
              [disabled]="isSubmitting()"
              (click)="handleSubmit()"
            >
              Soumettre la qualification
            </button>
          </div>
        </div>
      }
    }
  `,
})
export class LeadQualificationPage implements OnDestroy {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _formRenderer = viewChild(DynamicFormRendererComponent);

  public readonly id = input.required<string>();

  public pageState = signal<PageState>('loading');
  public lead = signal<LeadDto | null>(null);
  public template = signal<QualificationTemplateDto | null>(null);
  public isSubmitting = signal(false);
  public submissionResult = signal<QualifyLeadResult | null>(null);
  public hasDraft = signal(false);
  public restoredAnswers = signal<DynamicFormAnswers>({});

  private _draftKey: string | null = null;
  private _saveTimer: ReturnType<typeof setInterval> | null = null;

  public readonly formSchema = computed<DynamicFormSchema | null>(() => {
    const t = this.template();
    if (!t) return null;
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
        type: (q.type as any) ?? 'Text',
        options: q.options,
        isRequired: q.isRequired ?? false,
        order: q.order ?? 0,
        minValue: q.minValue,
        maxValue: q.maxValue,
        rules: (q.rules ?? []).map((r) => ({
          triggerQuestionId: r.triggerQuestionId!,
          triggerValue: r.triggerValue ?? '',
          action: (r.action as any) ?? 'Show',
        })),
      })),
    };
  });

  public readonly resultActionMeta = computed(() =>
    nextActionMeta(this.submissionResult()?.nextAction),
  );

  constructor() {
    effect(() => {
      const leadId = this.id();
      this.pageState.set('loading');
      this.submissionResult.set(null);

      this._leadsApiService.getLead(leadId).pipe(
        catchError(() => {
          this.pageState.set('loading');
          return EMPTY;
        }),
      ).subscribe((lead) => {
        this.lead.set(lead);
        this._loadTemplate(lead);
      });
    });
  }

  ngOnDestroy(): void {
    this._stopAutoSave();
  }

  public onAnswersChanged(answers: DynamicFormAnswers): void {
    this._saveDraft(answers);
  }

  public handleSubmit(): void {
    const renderer = this._formRenderer();
    if (!renderer) return;

    renderer.markAllTouched();
    if (!renderer.isValid()) {
      this._snackbar.error('Validation', 'Veuillez remplir tous les champs obligatoires.');
      return;
    }

    const answers = renderer.getAnswers();
    const templateId = this.template()?.id;
    if (!templateId) return;

    this.isSubmitting.set(true);
    this._leadsApiService.qualifyLead(this.id(), {
      templateId,
      answers: Object.entries(answers).map(([questionId, value]) => ({
        questionId,
        value,
      })),
      triggerEvent: 'QualificationFormSubmitted',
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de soumettre la qualification.');
        return EMPTY;
      }),
      finalize(() => this.isSubmitting.set(false)),
    ).subscribe((result) => {
      this.submissionResult.set(result);
      this.pageState.set('submitted');
      this._purgeDraft();
      this._snackbar.success('Qualification soumise', `Score : ${result.score}`);
    });
  }

  public clearDraft(): void {
    this._purgeDraft();
    this.hasDraft.set(false);
    this.restoredAnswers.set({});
  }

  public resetToForm(): void {
    this.submissionResult.set(null);
    this.restoredAnswers.set({});
    this.pageState.set('form');
  }

  public scoreTextColor(score: number): string {
    if (score >= 70) return 'text-green-600';
    if (score >= 40) return 'text-amber-600';
    return 'text-red-600';
  }

  public intentLabel(level: string | null | undefined): string {
    switch (String(level)) {
      case '0': return 'Froid';
      case '1': return 'Tiède';
      case '2': return 'Chaud';
      case '3': return 'Très chaud';
      default:  return 'Inconnu';
    }
  }

  public intentSeverity(level: string | null | undefined): Severity {
    switch (String(level)) {
      case '0': return 'neutral';
      case '1': return 'info';
      case '2': return 'warning';
      case '3': return 'error';
      default:  return 'neutral';
    }
  }

  private _loadTemplate(lead: LeadDto): void {
    const product = lead.interestedProduct;
    if (!product) {
      this.pageState.set('no-product');
      return;
    }

    this._leadsApiService.getActiveTemplateForProduct(product as any).pipe(
      catchError((err) => {
        if (err.status === 404) {
          this.pageState.set('no-template');
        } else {
          this._snackbar.error('Erreur', 'Impossible de charger le formulaire de qualification.');
        }
        return EMPTY;
      }),
    ).subscribe((tpl) => {
      if (!tpl || tpl.status !== 'Published') {
        this.pageState.set('no-template');
        return;
      }
      this.template.set(tpl);
      this._draftKey = draftKey(this.id(), tpl.id!, tpl.version ?? 0);
      this._restoreDraft();
      this.pageState.set('form');
      this._startAutoSave();
    });
  }

  private _restoreDraft(): void {
    if (!this._draftKey) return;
    try {
      const raw = localStorage.getItem(this._draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as DynamicFormAnswers;
        const hasValues = Object.values(parsed).some((v) => v != null && v !== '');
        if (hasValues) {
          this.restoredAnswers.set(parsed);
          this.hasDraft.set(true);
        }
      }
    } catch { /* ignore corrupt drafts */ }
  }

  private _saveDraft(answers: DynamicFormAnswers): void {
    if (!this._draftKey) return;
    try {
      localStorage.setItem(this._draftKey, JSON.stringify(answers));
    } catch { /* quota exceeded — silent fail */ }
  }

  private _purgeDraft(): void {
    if (!this._draftKey) return;
    try {
      localStorage.removeItem(this._draftKey);
    } catch { /* ignore */ }
  }

  private _startAutoSave(): void {
    this._saveTimer = setInterval(() => {
      const renderer = this._formRenderer();
      if (renderer) {
        this._saveDraft(renderer.getAnswers());
      }
    }, 10_000);
  }

  private _stopAutoSave(): void {
    if (this._saveTimer) {
      clearInterval(this._saveTimer);
      this._saveTimer = null;
    }
  }
}

export default LeadQualificationPage;
