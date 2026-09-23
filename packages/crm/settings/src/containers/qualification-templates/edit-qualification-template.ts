import { Component, computed, effect, inject, input, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { catchError, EMPTY, map } from 'rxjs';
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

import {
  LeadsApiService,
  QuestionInput,
  QuestionInputTypeEnum,
  SectionInput,
  RuleInputActionEnum,
  UpdateQualificationTemplateRequest,
  CreateQualificationTemplateRequest,
  ProductsApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, ProductConfigService } from '@sankore/crm/common';
import {
  EditableQuestion, EditableSection,
  uid, QUESTION_TYPE_OPTIONS, RULE_ACTION_OPTIONS,
  questionTypeLabel,
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
    TasInput,
    TasSelect,
  ],
  templateUrl: 'edit-qualification-template.html',
})
export class EditQualificationTemplate implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);

  private readonly _productsApiService = inject(ProductsApiService);

  public readonly id = input<string>();

  public readonly productConfig = inject(ProductConfigService);

  public readonly productsOptions = signal<{ value: string | null | undefined; label: string | null | undefined }[]>([]);

  private readonly _loadProducts = effect(() => {
    const category = this.editProductType();
    if (!category) { this.productsOptions.set([]); return; }
    this._productsApiService
      .listProducts(true, category as any)
      .pipe(
        map((products) =>
          products.map((product) => ({ value: product.code, label: product.name })),
        ),
      )
      .subscribe((opts) => this.productsOptions.set(opts));
  });
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
  public editProductCode = signal('');
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

    const base = {
      name: this.editName(),
      description: this.editDescription() || null,
      productCode: this.editProductCode() || null,
      productCategory: (this.editProductType() || null) as any,
      sections: sections.length > 0 ? sections : null,
      questions: questions.length > 0 ? questions : null,
    };

    const templateId = this.id();
    const obs = templateId
      ? this._leadsApi.updateQualificationTemplate(templateId, base as UpdateQualificationTemplateRequest)
      : this._leadsApi.createQualificationTemplate(base as CreateQualificationTemplateRequest);

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
          // this._router.navigate(['/settings/qualification-templates']);
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
        this.editProductType.set(tpl.productCategory ?? '');
        this.editProductCode.set(tpl.productCode ?? '');

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
