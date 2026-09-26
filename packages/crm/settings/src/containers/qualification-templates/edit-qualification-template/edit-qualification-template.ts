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
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
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
  ProductsApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, ProductConfigService } from '@sankore/crm/common';
import {
  EditableQuestion, EditableSection,
  uid, QUESTION_TYPE_OPTIONS, RULE_ACTION_OPTIONS,
  questionTypeLabel,
} from '../qualification-template.models';

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

  public editName = signal('');
  public editDescription = signal('');
  public editProductType = signal('');
  public editProductCode = signal('');
  public editSections = signal<EditableSection[]>([]);
  public editQuestions = signal<EditableQuestion[]>([]);

  /** `RuleInput.triggerQuestionId` est un `uuid` côté API : les ids locaux (`__q1`) sont refusés. */
  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  public readonly sectionOptions = computed(() => [
    { label: '(aucune section)', value: '-1' },
    ...this.editSections().map((s, i) => ({
      label: s.title || `Section ${i + 1}`,
      value: String(i),
    })),
  ]);

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Formulaires', link: ['/settings/qualification-templates'] },
      { label: 'Modifier' },
    ]);

    // La création passe désormais par le drawer de la liste : cet écran
    // n'édite qu'un formulaire existant.
    const templateId = this.id();
    if (!templateId) {
      this._snackbar.error('Erreur', 'Formulaire introuvable.');
      this.goBack();
      return;
    }
    this._loadTemplate(templateId);
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

    const allQuestions = this.editQuestions();
    const sectionList = this.editSections();
    let droppedRules = 0;

    const buildQuestion = (q: EditableQuestion): QuestionInput => {
      // Une règle qui déclenche sur une question tout juste ajoutée (pas
      // encore enregistrée) n'a qu'un id local (`__q1`) : ce n'est pas un
      // GUID, l'API le rejette. On l'écarte plutôt que de faire échouer toute
      // la question, et on prévient l'utilisateur une fois la sauvegarde faite.
      const rules = q.rules.filter((r) => {
        const isValid = EditQualificationTemplate.UUID_PATTERN.test(
          r.triggerQuestionUid,
        );
        if (!isValid) droppedRules++;
        return isValid;
      });

      return {
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
          rules.length > 0
            ? rules.map((r) => ({
                triggerQuestionId: r.triggerQuestionUid,
                triggerValue: r.triggerValue || null,
                action: r.action,
              }))
            : null,
      };
    };

    // `QuestionInput` ne porte aucun `sectionId` : le seul moyen que l'API
    // rattache une question à sa section est de l'imbriquer dans
    // `SectionInput.questions`. Le code précédent envoyait systématiquement
    // `questions: null` pour chaque section et poussait toutes les questions
    // à la racine, ce qui ignorait totalement la section choisie dans l'UI.
    const sections: SectionInput[] = sectionList.map((s, i) => {
      const sectionQuestions = allQuestions
        .filter((q) => q.sectionIndex === i)
        .map(buildQuestion);
      return {
        title: s.title || null,
        description: s.description || null,
        questions: sectionQuestions.length > 0 ? sectionQuestions : null,
      };
    });

    // Les questions racine ne sont que celles restées sans section
    // (sectionIndex -1, ou une section depuis supprimée).
    const orphanQuestions = allQuestions
      .filter(
        (q) => q.sectionIndex < 0 || q.sectionIndex >= sectionList.length,
      )
      .map(buildQuestion);

    const base = {
      name: this.editName(),
      description: this.editDescription() || null,
      productCode: this.editProductCode() || null,
      productCategory: (this.editProductType() || null) as any,
      sections: sections.length > 0 ? sections : null,
      questions: orphanQuestions.length > 0 ? orphanQuestions : null,
    };

    const templateId = this.id();
    if (!templateId) {
      this.isSaving.set(false);
      return;
    }

    this._leadsApi
      .updateQualificationTemplate(
        templateId,
        base as UpdateQualificationTemplateRequest,
      )
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
          if (droppedRules > 0) {
            this._snackbar.info(
              'Règles ignorées',
              `${droppedRules} règle(s) pointaient vers une question pas encore enregistrée et n'ont pas été sauvegardées. Enregistrez d'abord la question déclencheuse, puis reconfigurez la règle.`,
            );
          }
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
        // Published : figé pour ne pas modifier un formulaire déjà actif.
        // Archived : fin de vie, aucune transition ne permet de le
        // réactiver (voir qualification-templates.ts) — donc pas modifiable
        // non plus, pour ne pas laisser croire qu'un changement sera pris
        // en compte.
        this.isReadonly.set(
          tpl.status === 'Published' || tpl.status === 'Archived',
        );
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
