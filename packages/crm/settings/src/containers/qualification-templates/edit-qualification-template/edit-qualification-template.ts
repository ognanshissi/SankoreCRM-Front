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
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
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
  PermissionsService,
  ProductConfigService,
} from '@sankore/crm/common';
import {
  EditableQuestion, EditableSection,
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
    DragDropModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    TasTable,
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
    // et non modifiable. `disabled` ne retire pas la valeur du modèle, elle
    // reste donc appliquée aux poids à l'enregistrement.
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
        isShareable: false,
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
        // L'API recrée chaque question sous un nouvel id : c'est cet id-ci, celui que les règles
        // nomment, qui lui permet de les rebrancher. Sans lui, une règle enregistrée deux fois
        // pointe vers une question disparue et masque la sienne pour de bon.
        id: EditQualificationTemplate.UUID_PATTERN.test(q._uid) ? q._uid : null,
        label: q.label || null,
        type: q.type,
        // « Exclu du scoring » n'a aucun champ au contrat : le seul levier
        // disponible est le poids des questions, mis à zéro.
        weight: this.excludedFromScoring() ? 0 : q.weight,
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

        // « Exclu du scoring » se relit du seul champ qui le porte : des poids
        // tous nuls. Le marquage santé, lui, n'a aucun champ et repart à faux.
        const scope = TemplateScopeFormModel.instantiate();
        scope.excludedFromScoring =
          questions.length > 0 && questions.every((q) => (q.weight ?? 0) === 0);
        this.scopeModel.set(scope);

        this.isLoading.set(false);
      });
  }
}

export default EditQualificationTemplate;
