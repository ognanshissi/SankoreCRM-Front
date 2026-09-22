import { Component, computed, inject, input, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY } from 'rxjs';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel, TasError } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  LeadsApiService,
  QualificationTemplateDto,
  QuestionInput,
  QuestionInputTypeEnum,
  SectionInput,
  RuleInputActionEnum,
} from '@sankore/crm-api';
import { BreadcrumbService, ProductConfigService } from '@sankore/crm/common';
import {
  EditableQuestion, EditableSection, EditableRule,
  uid, PRODUCT_TYPE_OPTIONS, QUESTION_TYPE_OPTIONS, RULE_ACTION_OPTIONS,
  questionTypeLabel, statusLabel,
} from './qualification-template.models';

@Component({
  selector: 'edit-qualification-template',
  imports: [
    FormsModule,
    DragDropModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasInput,
    TasSelect,
  ],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6">
        <!-- Header -->
        <div class="flex items-center gap-3 mb-6">
          <button
            type="button"
            class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200"
            (click)="goBack()"
          >
            <tas-icon
              iconName="feather:arrow-left"
              style="font-size:14px"
            ></tas-icon>
          </button>
          <h1 class="text-lg font-semibold text-slate-800 flex-1">
            {{
              isCreate()
                ? 'Nouveau formulaire'
                : isReadonly()
                  ? 'Formulaire (lecture seule)'
                  : 'Modifier le formulaire'
            }}
          </h1>
          @if (!isReadonly()) {
            <button
              tas-raised-button
              color="primary"
              type="button"
              [disabled]="isSaving() || !editName()"
              (click)="save()"
            >
              @if (isSaving()) {
                <tas-spinner size="3" class="text-white"></tas-spinner>
              }
              Enregistrer
            </button>
          }
        </div>

        @if (isReadonly()) {
          <div
            class="mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2"
          >
            <tas-icon
              iconName="feather:lock"
              class="text-slate-400"
              style="font-size:14px"
            ></tas-icon>
            <p class="text-xs text-slate-500">
              Ce formulaire est publié. Archivez-le pour en créer une nouvelle
              version.
            </p>
          </div>
        }

        <!-- Meta -->
        <tas-card class="mb-4 block">
          <div class="p-4 border-b border-slate-100">
            <p class="text-sm font-semibold text-slate-700">
              Informations générales
            </p>
          </div>
          <div class="p-4 flex flex-col gap-3">
            <tas-form-field>
              <tas-label
                >Nom du formulaire
                <span class="text-red-500">*</span></tas-label
              >
              <input
                tasInput
                type="text"
                placeholder="Ex : Qualification Prêt v2"
                [ngModel]="editName()"
                (ngModelChange)="editName.set($event)"
                [disabled]="isReadonly()"
              />
            </tas-form-field>
            <tas-form-field>
              <tas-label>Description</tas-label>
              <textarea
                tasInput
                rows="2"
                placeholder="Description du formulaire"
                [ngModel]="editDescription()"
                (ngModelChange)="editDescription.set($event)"
                [disabled]="isReadonly()"
              ></textarea>
            </tas-form-field>
            <tas-form-field>
              <tas-label>Catégorie de produit</tas-label>
              <tas-select
                [options]="productConfig.categories"
                optionLabel="label"
                optionValue="value"
                placeholder="Sélectionnez"
                [ngModel]="editProductType()"
                (ngModelChange)="editProductType.set($event)"
              ></tas-select>
            </tas-form-field>
          </div>
        </tas-card>

        <!-- Sections -->
        <tas-card class="mb-4 block">
          <div
            class="p-4 border-b border-slate-100 flex items-center justify-between"
          >
            <p class="text-sm font-semibold text-slate-700">Sections</p>
            @if (!isReadonly()) {
              <button
                tas-outlined-button
                type="button"
                class="text-xs"
                (click)="addSection()"
              >
                <tas-icon
                  iconName="feather:plus"
                  style="font-size:12px"
                ></tas-icon>
                Ajouter une section
              </button>
            }
          </div>
          @if (editSections().length === 0) {
            <div class="p-4 text-center">
              <p class="text-xs text-slate-400">
                Aucune section. Les questions seront affichées sans
                regroupement.
              </p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (sec of editSections(); track sec._uid; let si = $index) {
                <div class="p-4 flex items-center gap-3">
                  <span
                    class="w-6 h-6 rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500 flex items-center justify-center tabular-nums shrink-0"
                    >{{ si + 1 }}</span
                  >
                  <div class="flex-1 grid grid-cols-2 gap-2">
                    <tas-form-field>
                      <input
                        tasInput
                        type="text"
                        placeholder="Titre de la section"
                        [ngModel]="sec.title"
                        (ngModelChange)="sec.title = $event"
                        [disabled]="isReadonly()"
                      />
                    </tas-form-field>
                    <tas-form-field>
                      <input
                        tasInput
                        type="text"
                        placeholder="Description (optionnel)"
                        [ngModel]="sec.description"
                        (ngModelChange)="sec.description = $event"
                        [disabled]="isReadonly()"
                      />
                    </tas-form-field>
                  </div>
                  @if (!isReadonly()) {
                    <button
                      type="button"
                      class="text-slate-300 hover:text-red-500"
                      (click)="removeSection(si)"
                    >
                      <tas-icon
                        iconName="feather:trash-2"
                        style="font-size:14px"
                      ></tas-icon>
                    </button>
                  }
                </div>
              }
            </div>
          }
        </tas-card>

        <!-- Questions -->
        <tas-card class="mb-4 block">
          <div
            class="p-4 border-b border-slate-100 flex items-center justify-between"
          >
            <div>
              <p class="text-sm font-semibold text-slate-700">Questions</p>
              <p class="text-xs text-slate-400 mt-0.5">
                {{ editQuestions().length }} question(s) · Glissez pour
                réordonner
              </p>
            </div>
            @if (!isReadonly()) {
              <button
                tas-button
                color="primary"
                type="button"
                class="text-xs"
                (click)="addQuestion()"
              >
                <tas-icon
                  iconName="feather:plus"
                  style="font-size:12px"
                ></tas-icon>
                Ajouter une question
              </button>
            }
          </div>

          @if (editQuestions().length === 0) {
            <div
              class="flex flex-col items-center justify-center py-12 text-center"
            >
              <tas-icon
                iconName="feather:help-circle"
                class="text-slate-300 mb-2"
                style="font-size:28px"
              ></tas-icon>
              <p class="text-sm text-slate-400">Aucune question ajoutée</p>
              @if (!isReadonly()) {
                <button
                  type="button"
                  class="text-xs text-primary hover:underline mt-2"
                  (click)="addQuestion()"
                >
                  Ajouter la première question
                </button>
              }
            </div>
          } @else {
            <div
              cdkDropList
              (cdkDropListDropped)="onReorderQuestion($event)"
              class="divide-y divide-slate-100"
            >
              @for (q of editQuestions(); track q._uid; let qi = $index) {
                <div cdkDrag class="bg-white">
                  <div
                    cdkDragPlaceholder
                    class="bg-primary/5 border-2 border-dashed border-primary/30 rounded h-14 mx-4 my-2"
                  ></div>

                  <!-- Summary row -->
                  <div
                    class="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 cursor-pointer"
                    (click)="q.expanded = !q.expanded"
                  >
                    @if (!isReadonly()) {
                      <div
                        cdkDragHandle
                        class="cursor-grab text-slate-300 hover:text-slate-500"
                        (click)="$event.stopPropagation()"
                      >
                        <tas-icon
                          iconName="feather:menu"
                          style="font-size:14px"
                        ></tas-icon>
                      </div>
                    }
                    <span
                      class="w-5 h-5 rounded bg-slate-100 text-[9px] font-bold text-slate-500 flex items-center justify-center tabular-nums shrink-0"
                      >{{ qi + 1 }}</span
                    >
                    <p
                      class="text-sm font-medium text-slate-800 flex-1 truncate"
                    >
                      {{ q.label || 'Question sans titre' }}
                    </p>
                    <tas-tag severity="info">{{
                      questionTypeLabel(q.type)
                    }}</tas-tag>
                    @if (q.isRequired) {
                      <tas-tag severity="error">Requis</tas-tag>
                    }
                    @if (q.rules.length > 0) {
                      <tas-tag severity="warning"
                        >{{ q.rules.length }} règle(s)</tas-tag
                      >
                    }
                    <span class="text-[10px] text-slate-400 tabular-nums"
                      >poids {{ q.weight }}</span
                    >
                    <tas-icon
                      [iconName]="
                        q.expanded
                          ? 'feather:chevron-up'
                          : 'feather:chevron-down'
                      "
                      class="text-slate-400"
                      style="font-size:14px"
                    ></tas-icon>
                  </div>

                  <!-- Expanded editor -->
                  @if (q.expanded) {
                    <div
                      class="px-4 pb-4 pt-1 border-t border-slate-50 bg-slate-50/50"
                    >
                      <div class="grid grid-cols-2 gap-3 mb-3">
                        <tas-form-field>
                          <tas-label
                            >Libellé
                            <span class="text-red-500">*</span></tas-label
                          >
                          <input
                            tasInput
                            type="text"
                            placeholder="Ex : Avez-vous un compte ?"
                            [ngModel]="q.label"
                            (ngModelChange)="q.label = $event"
                            [disabled]="isReadonly()"
                          />
                        </tas-form-field>
                        <tas-form-field>
                          <tas-label>Type de champ</tas-label>
                          <tas-select
                            [options]="questionTypeOptions"
                            optionLabel="label"
                            optionValue="value"
                            [ngModel]="q.type"
                            (ngModelChange)="q.type = $event"
                          ></tas-select>
                        </tas-form-field>
                      </div>

                      <div class="grid grid-cols-3 gap-3 mb-3">
                        <tas-form-field>
                          <tas-label>Poids (scoring)</tas-label>
                          <input
                            tasInput
                            type="number"
                            min="0"
                            max="100"
                            [ngModel]="q.weight"
                            (ngModelChange)="q.weight = $event"
                            [disabled]="isReadonly()"
                          />
                        </tas-form-field>
                        @if (editSections().length > 0) {
                          <tas-form-field>
                            <tas-label>Section</tas-label>
                            <tas-select
                              [options]="sectionOptions()"
                              optionLabel="label"
                              optionValue="value"
                              [ngModel]="String(q.sectionIndex)"
                              (ngModelChange)="q.sectionIndex = +$event"
                            ></tas-select>
                          </tas-form-field>
                        }
                        <div class="flex items-end gap-2 pb-1">
                          <label
                            class="flex items-center gap-1.5 cursor-pointer text-sm"
                          >
                            <input
                              type="checkbox"
                              class="form-checkbox accent-primary"
                              [checked]="q.isRequired"
                              (change)="q.isRequired = !q.isRequired"
                              [disabled]="isReadonly()"
                            />
                            Obligatoire
                          </label>
                        </div>
                      </div>

                      <!-- Choice options -->
                      @if (
                        q.type === 'SingleChoice' || q.type === 'MultiChoice'
                      ) {
                        <tas-form-field>
                          <tas-label
                            >Options (séparées par des virgules)</tas-label
                          >
                          <input
                            tasInput
                            type="text"
                            placeholder="Oui, Non, Peut-être"
                            [ngModel]="q.options"
                            (ngModelChange)="q.options = $event"
                            [disabled]="isReadonly()"
                          />
                        </tas-form-field>
                      }

                      <!-- Numeric bounds -->
                      @if (q.type === 'Numeric') {
                        <div class="grid grid-cols-2 gap-3 mt-3">
                          <tas-form-field>
                            <tas-label>Valeur min</tas-label>
                            <input
                              tasInput
                              type="number"
                              [ngModel]="q.minValue"
                              (ngModelChange)="q.minValue = $event"
                              [disabled]="isReadonly()"
                            />
                          </tas-form-field>
                          <tas-form-field>
                            <tas-label>Valeur max</tas-label>
                            <input
                              tasInput
                              type="number"
                              [ngModel]="q.maxValue"
                              (ngModelChange)="q.maxValue = $event"
                              [disabled]="isReadonly()"
                            />
                          </tas-form-field>
                        </div>
                      }

                      <!-- Help / Placeholder -->
                      <div class="grid grid-cols-2 gap-3 mt-3">
                        <tas-form-field>
                          <tas-label>Texte d'aide</tas-label>
                          <input
                            tasInput
                            type="text"
                            placeholder="Aide contextuelle"
                            [ngModel]="q.helpText"
                            (ngModelChange)="q.helpText = $event"
                            [disabled]="isReadonly()"
                          />
                        </tas-form-field>
                        <tas-form-field>
                          <tas-label>Placeholder</tas-label>
                          <input
                            tasInput
                            type="text"
                            placeholder="Placeholder du champ"
                            [ngModel]="q.placeholderText"
                            (ngModelChange)="q.placeholderText = $event"
                            [disabled]="isReadonly()"
                          />
                        </tas-form-field>
                      </div>

                      <!-- Conditional rules -->
                      <div
                        class="mt-3 p-3 rounded-lg bg-white border border-slate-200"
                      >
                        <div class="flex items-center justify-between mb-2">
                          <p class="text-xs font-semibold text-slate-600">
                            Règles conditionnelles
                          </p>
                          @if (!isReadonly()) {
                            <button
                              type="button"
                              class="text-xs text-primary hover:underline"
                              (click)="addRule(q)"
                            >
                              + Ajouter
                            </button>
                          }
                        </div>
                        @if (q.rules.length === 0) {
                          <p class="text-[10px] text-slate-400">
                            Aucune règle — la question est toujours visible.
                          </p>
                        } @else {
                          @for (
                            rule of q.rules;
                            track $index;
                            let ri = $index
                          ) {
                            <div
                              class="grid grid-cols-[1fr_auto_auto_auto] gap-2 mt-2 items-start"
                            >
                              <tas-form-field>
                                <tas-label>Question déclencheur</tas-label>
                                <tas-select
                                  [options]="questionUidOptions(q._uid)"
                                  optionLabel="label"
                                  optionValue="value"
                                  placeholder="Sélectionnez"
                                  [ngModel]="rule.triggerQuestionUid"
                                  (ngModelChange)="
                                    rule.triggerQuestionUid = $event
                                  "
                                ></tas-select>
                              </tas-form-field>
                              <tas-form-field>
                                <tas-label>Valeur</tas-label>
                                <input
                                  tasInput
                                  type="text"
                                  placeholder="Ex : Oui"
                                  [ngModel]="rule.triggerValue"
                                  (ngModelChange)="rule.triggerValue = $event"
                                />
                              </tas-form-field>
                              <tas-form-field>
                                <tas-label>Action</tas-label>
                                <tas-select
                                  [options]="ruleActionOptions"
                                  optionLabel="label"
                                  optionValue="value"
                                  [ngModel]="rule.action"
                                  (ngModelChange)="rule.action = $event"
                                ></tas-select>
                              </tas-form-field>
                              @if (!isReadonly()) {
                                <div class="flex items-end pb-2">
                                  <button
                                    type="button"
                                    class="text-slate-300 hover:text-red-500 p-1"
                                    (click)="removeRule(q, ri)"
                                  >
                                    <tas-icon
                                      iconName="feather:x"
                                      style="font-size:14px"
                                    ></tas-icon>
                                  </button>
                                </div>
                              }
                            </div>
                          }
                        }
                      </div>

                      @if (!isReadonly()) {
                        <div class="mt-3 flex justify-end">
                          <button
                            type="button"
                            class="text-xs text-red-400 hover:text-red-600"
                            (click)="removeQuestion(qi)"
                          >
                            <tas-icon
                              iconName="feather:trash-2"
                              style="font-size:12px"
                            ></tas-icon>
                            Supprimer cette question
                          </button>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          }
        </tas-card>
      </div>
    }
  `,
})
export class EditQualificationTemplate implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  public readonly id = input<string>();

  public readonly productConfig = inject(ProductConfigService);

  public readonly questionTypeOptions = QUESTION_TYPE_OPTIONS;
  public readonly ruleActionOptions = RULE_ACTION_OPTIONS;
  public readonly questionTypeLabel = questionTypeLabel;
  public readonly String = String;

  public isLoading = signal(false);
  public isSaving = signal(false);
  public isReadonly = signal(false);
  public isCreate = signal(true);

  public editName = signal('');
  public editDescription = signal('');
  public editProductType = signal('');
  public editSections = signal<EditableSection[]>([]);
  public editQuestions = signal<EditableQuestion[]>([]);

  public readonly sectionOptions = computed(() => [
    { label: '(aucune section)', value: '-1' },
    ...this.editSections().map((s, i) => ({
      label: s.title || `Section ${i + 1}`,
      value: String(i),
    })),
  ]);

  ngOnInit(): void {
    const templateId = this.id();
    if (templateId) {
      this.isCreate.set(false);
      this._loadTemplate(templateId);
    }
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Formulaires', link: ['/settings/qualification-templates'] },
      { label: templateId ? 'Modifier' : 'Nouveau' },
    ]);
  }

  public questionUidOptions(
    excludeUid: string,
  ): { label: string; value: string }[] {
    return this.editQuestions()
      .filter((q) => q._uid !== excludeUid)
      .map((q, i) => ({ label: q.label || `Q${i + 1}`, value: q._uid }));
  }

  public goBack(): void {
    this._router.navigate(['/settings/qualification-templates']);
  }

  // ——— Section/Question editing ———

  public addSection(): void {
    this.editSections.update((list) => [
      ...list,
      { _uid: uid(), title: '', description: '' },
    ]);
  }

  public removeSection(index: number): void {
    this.editSections.update((list) => list.filter((_, i) => i !== index));
    this.editQuestions.update((list) =>
      list.map((q) =>
        q.sectionIndex === index
          ? { ...q, sectionIndex: -1 }
          : q.sectionIndex > index
            ? { ...q, sectionIndex: q.sectionIndex - 1 }
            : q,
      ),
    );
  }

  public addQuestion(): void {
    this.editQuestions.update((list) => [
      ...list,
      {
        _uid: uid(),
        label: '',
        type: QuestionInputTypeEnum.Text,
        weight: 1,
        isRequired: false,
        options: '',
        helpText: '',
        placeholderText: '',
        minValue: null,
        maxValue: null,
        sectionIndex: -1,
        expanded: true,
        rules: [],
      },
    ]);
  }

  public removeQuestion(index: number): void {
    this.editQuestions.update((list) => list.filter((_, i) => i !== index));
  }

  public addRule(q: EditableQuestion): void {
    q.rules = [
      ...q.rules,
      {
        triggerQuestionUid: '',
        triggerValue: '',
        action: RuleInputActionEnum.Show,
      },
    ];
  }

  public removeRule(q: EditableQuestion, index: number): void {
    q.rules = q.rules.filter((_, i) => i !== index);
  }

  public onReorderQuestion(event: CdkDragDrop<void>): void {
    this.editQuestions.update((list) => {
      const reordered = [...list];
      moveItemInArray(reordered, event.previousIndex, event.currentIndex);
      return reordered;
    });
  }

  // ——— Save ———

  public save(): void {
    if (!this.editName()) return;
    this.isSaving.set(true);

    const sections: SectionInput[] = this.editSections().map((s) => ({
      title: s.title || null,
      description: s.description || null,
      questions: null,
    }));

    const questions: QuestionInput[] = this.editQuestions().map((q) => ({
      label: q.label || null,
      type: q.type,
      weight: q.weight,
      isRequired: q.isRequired,
      options:
        q.type === QuestionInputTypeEnum.SingleChoice ||
        q.type === QuestionInputTypeEnum.MultiChoice
          ? q.options
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : null,
      helpText: q.helpText || null,
      placeholderText: q.placeholderText || null,
      minValue: q.type === QuestionInputTypeEnum.Numeric ? q.minValue : null,
      maxValue: q.type === QuestionInputTypeEnum.Numeric ? q.maxValue : null,
      rules:
        q.rules.length > 0
          ? q.rules.map((r) => ({
              triggerQuestionId: r.triggerQuestionUid,
              triggerValue: r.triggerValue || null,
              action: r.action,
            }))
          : null,
    }));

    const payload = {
      name: this.editName(),
      description: this.editDescription() || null,
      productType: this.editProductType()
        ? (Number(this.editProductType()) as any)
        : null,
      sections: sections.length > 0 ? sections : null,
      questions: questions.length > 0 ? questions : null,
    };

    const templateId = this.id();
    const obs = templateId
      ? this._leadsApi.updateQualificationTemplate(templateId, payload)
      : this._leadsApi.createQualificationTemplate(payload);

    obs
      .pipe(
        catchError(() => {
          this._snackbar.error('Erreur', 'Sauvegarde échouée.');
          return EMPTY;
        }),
      )
      .subscribe({
        next: () => {
          this._snackbar.success(
            'Enregistré',
            'Formulaire de qualification sauvegardé.',
          );
          this._router.navigate(['/settings/qualification-templates']);
        },
        complete: () => this.isSaving.set(false),
      });
  }

  // ——— Private ———

  private _loadTemplate(templateId: string): void {
    this.isLoading.set(true);
    this._leadsApi
      .getQualificationTemplate(templateId)
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          this._snackbar.error('Erreur', 'Formulaire introuvable.');
          return EMPTY;
        }),
      )
      .subscribe((tpl) => {
        this.isReadonly.set(tpl.status === 'Published');
        this.editName.set(tpl.name ?? '');
        this.editDescription.set(tpl.description ?? '');
        this.editProductType.set(tpl.productType ?? '');

        const sections = (tpl.sections ?? []).sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0),
        );
        this.editSections.set(
          sections.map((s) => ({
            _uid: uid(),
            title: s.title ?? '',
            description: s.description ?? '',
          })),
        );

        const sectionIdToIndex = new Map(sections.map((s, i) => [s.id, i]));
        const questions = (tpl.questions ?? []).sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0),
        );
        this.editQuestions.set(
          questions.map((q) => ({
            _uid: q.id ?? uid(),
            label: q.label ?? '',
            type:
              (q.type as QuestionInputTypeEnum) ?? QuestionInputTypeEnum.Text,
            weight: q.weight ?? 1,
            isRequired: q.isRequired ?? false,
            options: (q.options ?? []).join(', '),
            helpText: q.helpText ?? '',
            placeholderText: q.placeholderText ?? '',
            minValue: q.minValue ?? null,
            maxValue: q.maxValue ?? null,
            sectionIndex: q.sectionId
              ? (sectionIdToIndex.get(q.sectionId) ?? -1)
              : -1,
            expanded: false,
            rules: (q.rules ?? []).map((r) => ({
              triggerQuestionUid: r.triggerQuestionId ?? '',
              triggerValue: r.triggerValue ?? '',
              action:
                (r.action as RuleInputActionEnum) ?? RuleInputActionEnum.Show,
            })),
          })),
        );

        this.isLoading.set(false);
      });
  }
}

export default EditQualificationTemplate;
