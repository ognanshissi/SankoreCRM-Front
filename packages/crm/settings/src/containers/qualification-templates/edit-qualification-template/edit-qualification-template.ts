import { Component, computed, effect, inject, input, signal, untracked, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  disabled,
  form,
  FormField,
  FormRoot,
} from '@angular/forms/signals';
import { catchError, EMPTY, map } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
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
  UpdateQualificationTemplateRequest,
  UpdateQualificationTemplateRequestProductCategoryEnum,
  ProductDtoCategoryEnum,
  ProductsApiService,
} from '@sankore/crm-api';
import {
  BreadcrumbService,
  DynamicFormRendererComponent,
  DynamicFormSchema,
  PermissionsService,
  ProductConfigService,
} from '@sankore/crm/common';
import {
  EditableQuestion, EditableRule, EditableSection,
  uid, QUESTION_TYPE_OPTIONS, RULE_ACTION_OPTIONS,
  questionTypeLabel, APPLIES_TO_OPTIONS, isInsuranceCategory,
  statusLabel, statusSeverity, qualificationScopeKey, productVersionNumbers,
} from '../qualification-template.models';

/** Une version du formulaire, telle que l'encart « Versions » la liste. */
interface VersionRow {
  id: string;
  name: string;
  number: number | null;
  status: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  current: boolean;
}

/** Les onglets de la page — le plan et l'éditeur d'abord, c'est là qu'on travaille. */
export type TemplateTab = 'questions' | 'infos' | 'apercu' | 'versions';

/** Un groupe du plan : une section, ou les questions sans section. */
interface PlanGroup {
  section: EditableSection | null;
  index: number;
  questions: EditableQuestion[];
}

/**
 * BNF-F-16 — portée et santé du questionnaire.
 *
 * Aucun de ces trois réglages n'existe au contrat (`appliesTo`,
 * `isHealthQuestionnaire`, `excludedFromScoring` sont absents de
 * `QualificationTemplateDto` comme des requêtes de création et de mise à
 * jour). Seul « Exclu du scoring » est persistable, par le seul champ
 * disponible : le poids des questions, mis à zéro.
 */
class TemplateScopeFormModel {
  public appliesTo!: string;
  public isHealthQuestionnaire!: boolean;
  public excludedFromScoring!: boolean;

  public static instantiate(): TemplateScopeFormModel {
    const model = new TemplateScopeFormModel();
    model.appliesTo = 'Lead';
    model.isHealthQuestionnaire = false;
    model.excludedFromScoring = false;
    return model;
  }
}

@Component({
  selector: 'edit-qualification-template',
  imports: [
    DatePipe,
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    TasTable,
    DynamicFormRendererComponent,
    Button,
    TasFormField,
    TasLabel,
    TasHint,
    TasInput,
    TasSelect,
    FormRoot,
    FormField,
  ],
  templateUrl: 'edit-qualification-template.html',
})
export class EditQualificationTemplate implements OnInit {
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirmDialog = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _router = inject(Router);
  private readonly _permissions = inject(PermissionsService);

  public readonly canManage = this._permissions.can(
    'lead:qualification-template:manage',
  );

  private readonly _productsApiService = inject(ProductsApiService);

  public readonly id = input<string>();

  public readonly productConfig = inject(ProductConfigService);
  /** La catégorie enregistrée reste proposée même si son module a été désactivé depuis. */
  private readonly _storedCategory = signal<string | null>(null);
  public readonly categoryOptions = computed(() => this.productConfig.offeredCategories(this._storedCategory()));

  public readonly productsOptions = signal<{ value: string | null | undefined; label: string | null | undefined }[]>([]);

  private readonly _loadProducts = effect(() => {
    const category = this.editProductType();
    if (!category) { this.productsOptions.set([]); return; }
    this._productsApiService
      .listProducts(true, category as ProductDtoCategoryEnum)
      .pipe(
        map((products) =>
          products.map((product) => ({ value: product.code, label: product.name })),
        ),
      )
      .subscribe((opts) => this.productsOptions.set(opts));
  });
  public readonly questionTypeOptions = QUESTION_TYPE_OPTIONS;
  public readonly ruleActionOptions = RULE_ACTION_OPTIONS;
  public readonly appliesToOptions = APPLIES_TO_OPTIONS;
  public readonly questionTypeLabel = questionTypeLabel;
  public readonly statusLabel = statusLabel;
  public readonly statusSeverity = statusSeverity;
  public readonly String = String;

  public isLoading = signal(false);
  public loadFailed = signal(false);
  public isSaving = signal(false);
  public isPublishing = signal(false);
  public isReadonly = signal(false);

  public editName = signal('');
  public editDescription = signal('');
  public editProductType = signal('');
  public editProductCode = signal('');
  public editSections = signal<EditableSection[]>([]);
  public editQuestions = signal<EditableQuestion[]>([]);
  public templateStatus = signal<string | null>(null);

  public readonly tab = signal<TemplateTab>('questions');
  public readonly tabs: { id: TemplateTab; label: string }[] = [
    { id: 'questions', label: 'Questions' },
    { id: 'infos', label: 'Informations' },
    { id: 'apercu', label: 'Aperçu' },
    { id: 'versions', label: 'Versions' },
  ];
  /** Ce que l'éditeur de droite affiche : une question ou une section du plan. */
  public readonly selected = signal<{ kind: 'question' | 'section'; uid: string } | null>(null);
  /**
   * Le schéma de l'aperçu, figé à l'ouverture de l'onglet : recalculé à chaque passage de la
   * détection, il redonnerait au rendu un nouveau schéma et effacerait les réponses de test.
   */
  public readonly previewSchema = signal<DynamicFormSchema | null>(null);

  /**
   * Les autres versions du formulaire — les formulaires de son produit (propriétaire, 2026-10-27),
   * la plus récente d'abord, les brouillons jamais publiés en tête.
   */
  public readonly versions = signal<VersionRow[]>([]);
  public readonly productVersion = computed(() => this.versions().find((v) => v.current)?.number ?? null);
  /** Le numéro que prendra ce formulaire s'il est publié maintenant. */
  public readonly nextProductVersion = computed(
    () => this.versions().filter((v) => v.number !== null && !v.current).length + 1,
  );
  /** Une autre version de ce produit est publiée : la publication l'archivera. */
  public readonly replacesPublished = computed(() => this.versions().some((v) => !v.current && v.status === 'Published'));
  public readonly versionsTableConfig: TableConfig = {
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10], totalElements: 0 },
  };

  private _loadedId: string | null = null;
  private _loadedTab: string | null = null;
  private _reselectAt: number | null = null;

  /**
   * Ouvrir une autre version garde cet écran — la route est la même — et change seulement son
   * entrée `id` : sans ce rechargement, il afficherait toujours la version d'avant.
   */
  private readonly _reloadOnIdChange = effect(() => {
    const id = this.id();
    if (id && this._loadedId && id !== this._loadedId) untracked(() => this._loadTemplate(id));
  });

  /** Un questionnaire santé n'est proposé que pour une catégorie d'assurance. */
  public readonly isInsurance = computed(() =>
    isInsuranceCategory(this.editProductType()),
  );

  public readonly isDraft = computed(() => this.templateStatus() === 'Draft');

  public scopeModel = signal(TemplateScopeFormModel.instantiate());

  public scopeForm = form(this.scopeModel, (schema) => {
    disabled(schema.appliesTo, { when: () => this.isReadonly() });
    disabled(schema.isHealthQuestionnaire, {
      when: () => this.isReadonly() || !this.isInsurance(),
    });
    // « Questionnaire santé » force « Exclu du scoring » : la case est à vrai
    // et non modifiable, et le serveur la force aussi.
    disabled(schema.excludedFromScoring, {
      when: ({ valueOf }) =>
        this.isReadonly() || valueOf(schema.isHealthQuestionnaire),
    });
  });

  public readonly excludedFromScoring = computed(() =>
    this.scopeForm.excludedFromScoring().value(),
  );

  /** `RuleInput.triggerQuestionId` est un `uuid` côté API : les ids locaux (`__q1`) sont refusés. */
  private static readonly UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /**
   * Valeur dérivée de la case « Questionnaire santé » : cocher la santé force
   * l'exclusion du scoring, et quitter une catégorie d'assurance retire le
   * marquage santé — sinon un questionnaire de prêt resterait marqué santé.
   */
  private readonly _deriveScoringExclusion = effect(() => {
    const health = this.scopeForm.isHealthQuestionnaire();
    if (!this.isInsurance() && health.value()) {
      health.value.set(false);
      return;
    }
    const excluded = this.scopeForm.excludedFromScoring();
    if (health.value() && !excluded.value()) {
      excluded.value.set(true);
    }
  });

  public readonly sectionOptions = computed(() => [
    { label: '(aucune section)', value: '-1' },
    ...this.editSections().map((s, i) => ({
      label: s.title || `Section ${i + 1}`,
      value: String(i),
    })),
  ]);

  ngOnInit(): void {
    this._setBreadcrumb();

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
    return this.orderedQuestions()
      .filter((q) => q._uid !== excludeUid)
      .map((q) => ({ label: `Q${this.questionNumber(q._uid)} · ${q.label || 'Question sans titre'}`, value: q._uid }));
  }

  // ——— Onglets, plan et sélection ———

  public openTab(tab: TemplateTab): void {
    if (tab === 'apercu') this.resetPreview();
    this.tab.set(tab);
  }

  /** Recharge l'aperçu depuis le questionnaire tel qu'il est à l'écran, enregistré ou non. */
  public resetPreview(): void {
    const sections = this.editSections();
    this.previewSchema.set({
      sections: sections.map((sec, i) => ({ id: sec._uid, title: sec.title || `Section ${i + 1}`, description: sec.description || null, order: i })),
      questions: this.orderedQuestions().map((q, i) => ({
        id: q._uid,
        sectionId: q.sectionIndex >= 0 && q.sectionIndex < sections.length ? sections[q.sectionIndex]._uid : null,
        label: q.label || 'Question sans titre',
        helpText: q.helpText || null,
        placeholderText: q.placeholderText || null,
        type: q.type,
        options: this._optionsOf(q),
        isRequired: q.isRequired,
        order: i,
        minValue: q.minValue,
        maxValue: q.maxValue,
        rules: q.rules
          .filter((r) => r.triggerQuestionUid)
          .map((r) => ({ triggerQuestionId: r.triggerQuestionUid, triggerValue: r.triggerValue ?? '', action: r.action })),
      })),
    } as DynamicFormSchema);
  }

  /**
   * Le plan : les sections dans leur ordre, puis les questions sans section — l'ordre dans lequel
   * le serveur les range, et donc celui de la saisie.
   */
  public groups(): PlanGroup[] {
    const sections = this.editSections();
    const questions = this.editQuestions();
    const groups: PlanGroup[] = sections.map((section, index) => ({
      section,
      index,
      questions: questions.filter((q) => q.sectionIndex === index),
    }));
    const loose = questions.filter((q) => q.sectionIndex < 0 || q.sectionIndex >= sections.length);
    if (loose.length || sections.length === 0) groups.push({ section: null, index: -1, questions: loose });
    return groups;
  }

  public orderedQuestions(): EditableQuestion[] {
    return this.groups().flatMap((g) => g.questions);
  }

  /** Son numéro dans le plan : Q1, Q2… */
  public questionNumber(uid: string): number {
    return this.orderedQuestions().findIndex((q) => q._uid === uid) + 1;
  }

  public selectedQuestion(): EditableQuestion | null {
    const sel = this.selected();
    return sel?.kind === 'question' ? (this.editQuestions().find((q) => q._uid === sel.uid) ?? null) : null;
  }

  public selectedSection(): { section: EditableSection; index: number } | null {
    const sel = this.selected();
    if (sel?.kind !== 'section') return null;
    const index = this.editSections().findIndex((x) => x._uid === sel.uid);
    return index < 0 ? null : { section: this.editSections()[index], index };
  }

  public selectQuestion(q: EditableQuestion): void {
    this.selected.set({ kind: 'question', uid: q._uid });
  }

  public selectSection(sec: EditableSection): void {
    this.selected.set({ kind: 'section', uid: sec._uid });
  }

  public isSelected(uid: string): boolean {
    return this.selected()?.uid === uid;
  }

  /** Les questions dont dépend celle-ci (ses règles), en numéros. */
  public triggersOf(q: EditableQuestion): number[] {
    return [...new Set(q.rules.map((r) => this.questionNumber(r.triggerQuestionUid)).filter((n) => n > 0))];
  }

  /** Les questions qui dépendent de celle-ci, en numéros. */
  public dependentsOf(q: EditableQuestion): number[] {
    return this.orderedQuestions()
      .filter((other) => other.rules.some((r) => r.triggerQuestionUid === q._uid))
      .map((other) => this.questionNumber(other._uid));
  }

  /** « Q1, Q4 » : de quoi dépend la question, pour le plan. */
  public triggerLabel(q: EditableQuestion): string {
    return this.triggersOf(q).map((n) => `Q${n}`).join(', ');
  }

  /** « Q2, Q5 dépendent de la réponse à cette question. » */
  public dependentsLabel(q: EditableQuestion): string {
    const deps = this.dependentsOf(q);
    return `${deps.map((n) => `Q${n}`).join(', ')} ${deps.length > 1 ? 'dépendent' : 'dépend'} de la réponse à cette question.`;
  }

  /** « Afficher si Q1 (Le souscripteur…) = « Oui » » — la règle en clair. */
  public ruleSummary(rule: EditableRule): string {
    const action = RULE_ACTION_OPTIONS.find((o) => o.value === rule.action)?.label ?? rule.action;
    const n = this.questionNumber(rule.triggerQuestionUid);
    if (!n) return `${action} — question déclencheuse à choisir`;
    return `${action} si Q${n} = « ${rule.triggerValue || '…'} »`;
  }

  /** Les réponses possibles de la question déclencheuse, pour proposer la valeur d'une règle. */
  public triggerValues(rule: EditableRule): string[] {
    const trigger = this.editQuestions().find((q) => q._uid === rule.triggerQuestionUid);
    if (!trigger) return [];
    if (trigger.type === QuestionInputTypeEnum.YesNo) return ['true', 'false'];
    return this._optionsOf(trigger) ?? [];
  }

  /** Monte ou descend une question à l'intérieur de son groupe du plan. */
  public moveQuestion(q: EditableQuestion, direction: -1 | 1): void {
    const group = this.groups().find((g) => g.questions.includes(q));
    if (!group) return;
    const at = group.questions.indexOf(q);
    const other = group.questions[at + direction];
    if (!other) return;
    this.editQuestions.update((list) => {
      const next = [...list];
      const a = next.indexOf(q);
      const b = next.indexOf(other);
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  public canMove(q: EditableQuestion, direction: -1 | 1): boolean {
    const group = this.groups().find((g) => g.questions.includes(q));
    const at = group ? group.questions.indexOf(q) : -1;
    return at >= 0 && !!group!.questions[at + direction];
  }

  public setQuestionSection(q: EditableQuestion, value: string): void {
    q.sectionIndex = +value;
    this.editQuestions.update((list) => [...list]);
  }

  public productSummary(): string {
    const category = this.categoryOptions().find((o) => o.value === this.editProductType())?.label ?? '';
    const product = this.productsOptions().find((o) => o.value === this.editProductCode())?.label ?? this.editProductCode();
    return [category, product].filter(Boolean).join(' · ') || 'Aucun produit';
  }

  private _optionsOf(q: EditableQuestion): string[] | null {
    return q.type === QuestionInputTypeEnum.SingleChoice || q.type === QuestionInputTypeEnum.MultiChoice
      ? q.options.split(',').map((o) => o.trim()).filter(Boolean)
      : null;
  }

  public goBack(): void {
    this._router.navigate(['/settings/qualification-templates']);
  }

  // ——— Section/Question editing ———

  public addSection(): void {
    const section = { _uid: uid(), title: '', description: '' };
    this.editSections.update((list) => [...list, section]);
    this.selectSection(section);
  }

  public removeSection(index: number): void {
    this.selected.set(null);
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

  public addQuestion(sectionIndex = -1): void {
    const question: EditableQuestion = {
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
        sectionIndex,
        expanded: true,
        rules: [],
        isShareable: false,
    };
    this.editQuestions.update((list) => [...list, question]);
    this.selectQuestion(question);
  }

  /** Retire la question, et les règles des autres qui la prenaient pour déclencheur. */
  public removeQuestion(q: EditableQuestion): void {
    this.selected.set(null);
    this.editQuestions.update((list) =>
      list
        .filter((x) => x !== q)
        .map((x) => {
          x.rules = x.rules.filter((r) => r.triggerQuestionUid !== q._uid);
          return x;
        }),
    );
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
        // L'API recrée chaque question sous un nouvel id : c'est cet id-ci, celui que les règles
        // nomment, qui lui permet de les rebrancher. Sans lui, une règle enregistrée deux fois
        // pointe vers une question disparue et masque la sienne pour de bon.
        id: EditQualificationTemplate.UUID_PATTERN.test(q._uid) ? q._uid : null,
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
      productCategory: (this.editProductType() ||
        null) as UpdateQualificationTemplateRequestProductCategoryEnum | null,
      sections: sections.length > 0 ? sections : null,
      questions: orphanQuestions.length > 0 ? orphanQuestions : null,
      subjectScope: this.scopeModel().appliesTo,
      isHealthQuestionnaire: this.scopeModel().isHealthQuestionnaire,
      excludeFromScoring: this.scopeModel().excludedFromScoring,
    };

    const templateId = this.id();
    if (!templateId) {
      this.isSaving.set(false);
      return;
    }
    const open = this.selectedQuestion();
    this._reselectAt = open ? this.questionNumber(open._uid) : null;

    this._leadsApi
      .updateQualificationTemplate(
        templateId,
        base as UpdateQualificationTemplateRequest,
      )
      .pipe(
        catchError((err: HttpErrorResponse) => {
          const code = (err.error as { detail?: string } | null)?.detail;
          this._snackbar.error(
            'Enregistrement refusé',
            code === 'HEALTH_QUESTIONNAIRE_REQUIRES_INSURANCE_LINE'
              ? 'Un questionnaire santé ne se rattache qu’à une famille d’assurance.'
              : code === 'TEMPLATE_NOT_IN_DRAFT_STATUS'
                ? 'Ce formulaire n’est plus un brouillon : rechargez la page.'
                : 'Sauvegarde échouée.',
          );
          this.isSaving.set(false);
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
          // L'écriture remplace sections et questions d'un bloc : on relit ce
          // que le serveur a réellement retenu plutôt que de faire confiance
          // au 204 (poids remis à zéro, règles écartées, ordre des sections).
          this._loadTemplate(templateId);
        },
        complete: () => this.isSaving.set(false),
      });
  }

  /**
   * BNF-F-16 — avertissement à la publication : une nouvelle version du
   * questionnaire est créée, les réponses déjà collectées restent attachées à
   * leur version.
   */
  public publish(): void {
    const templateId = this.id();
    if (!templateId) return;

    this._confirmDialog.confirm({
      title: 'Publier ce questionnaire ?',
      message: `La publication en fait la version ${this.nextProductVersion()} du questionnaire de ce produit, « ${this.editName()} ».${this.replacesPublished() ? " La version publiée jusqu'ici est archivée." : ''} Les réponses déjà collectées restent rattachées à leur version et le questionnaire ne sera plus modifiable.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Publier', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isPublishing.set(true);
        this._leadsApi
          .publishQualificationTemplate(templateId)
          .pipe(
            catchError((err: HttpErrorResponse) => {
              this.isPublishing.set(false);
              this._snackbar.error(
                'Erreur',
                err.status === 422
                  ? 'Le questionnaire ne peut pas être publié en l’état : vérifiez qu’il contient au moins une question valide.'
                  : 'Publication échouée.',
              );
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.isPublishing.set(false);
            this._snackbar.success(
              'Publié',
              'Une nouvelle version du questionnaire est active.',
            );
            this._loadTemplate(templateId);
          });
      },
    });
  }

  public reload(): void {
    const templateId = this.id();
    if (templateId) this._loadTemplate(templateId);
  }

  // ——— Private ———

  /** Ouvre une autre version, en lecture seule si elle est publiée ou archivée. */
  public openVersion(row: VersionRow): void {
    if (row.current) return;
    this._router.navigate(['/settings/qualification-templates', row.id, 'edit']);
  }

  private _loadVersions(current: QualificationTemplateDto): void {
    this._leadsApi
      .listQualificationTemplates()
      .pipe(catchError(() => EMPTY))
      .subscribe((all) => {
        const scope = qualificationScopeKey(current);
        const numbers = productVersionNumbers(all ?? []);
        const rows: VersionRow[] = (all ?? [])
          .filter((t) => t.id && qualificationScopeKey(t) === scope)
          .map((t) => ({
            id: t.id!,
            name: t.name ?? '',
            number: numbers.get(t.id!) ?? null,
            status: t.status ?? null,
            publishedAt: t.publishedAt ?? null,
            createdAt: t.createdAt ?? null,
            current: t.id === current.id,
          }));
        rows.sort((a, b) =>
          a.number === null && b.number === null
            ? Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '')
            : a.number === null ? -1 : b.number === null ? 1 : b.number - a.number,
        );
        this.versions.set(rows);
      });
  }

  /** Reposé à chaque chargement : passer à une autre version navigue, et la navigation le réinitialise. */
  private _setBreadcrumb(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Formulaires', link: ['/settings/qualification-templates'] },
      { label: 'Modifier' },
    ]);
  }

  private _loadTemplate(templateId: string): void {
    if (this._loadedId) this._setBreadcrumb();
    this._loadedId = templateId;
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._leadsApi
      .getQualificationTemplate(templateId)
      .pipe(
        catchError(() => {
          this.isLoading.set(false);
          this.loadFailed.set(true);
          this._snackbar.error('Erreur', 'Formulaire introuvable.');
          return EMPTY;
        }),
      )
      .subscribe((tpl) => {
        this._loadVersions(tpl);
        this.templateStatus.set(tpl.status ?? null);
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
        this._storedCategory.set(tpl.productCategory ?? null);
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
          questions.map((q): EditableQuestion => ({
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
            // Pas de champ au contrat : la valeur ne survit pas au rechargement.
            isShareable: false,
            rules: (q.rules ?? []).map((r) => ({
              triggerQuestionUid: r.triggerQuestionId ?? '',
              triggerValue: r.triggerValue ?? '',
              action:
                (r.action as RuleInputActionEnum) ?? RuleInputActionEnum.Show,
            })),
          })),
        );

        const scope = TemplateScopeFormModel.instantiate();
        scope.appliesTo = tpl.subjectScope || 'Lead';
        scope.isHealthQuestionnaire = !!tpl.isHealthQuestionnaire;
        // Les formulaires d'avant ce champ s'excluaient du score par des poids tous nuls.
        scope.excludedFromScoring =
          !!tpl.excludeFromScoring || (questions.length > 0 && questions.every((q) => (q.weight ?? 0) === 0));
        this.scopeModel.set(scope);

        // Un enregistrement recrée chaque question sous un nouvel id : la question ouverte se
        // retrouve par sa place dans le plan, sinon on ouvre la première.
        const ordered = this.orderedQuestions();
        const again = this._reselectAt ? ordered[this._reselectAt - 1] : null;
        this._reselectAt = null;
        const pick = again ?? ordered[0];
        this.selected.set(pick ? { kind: 'question', uid: pick._uid } : null);
        if (this._loadedTab !== templateId) {
          this.tab.set('questions');
          this._loadedTab = templateId;
        }

        this.isLoading.set(false);
      });
  }
}

export default EditQualificationTemplate;
