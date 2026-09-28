import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  form,
  FormField,
  FormRoot,
  pattern,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
import { catchError, EMPTY, forkJoin, of, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import {
  TasError,
  TasFormField,
  TasHint,
  TasLabel,
} from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasSwitch } from '@talisoft/ui/switch';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  ClientTimelineSegmentsApiService,
  SegmentBucketDto,
  SegmentDistributionDto,
  SegmentRuleDefinition,
  SegmentRulesDto,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';

// ─── Catalogue de critères ───────────────────────────────────────────────────

/**
 * La liste des critères est **fermée par le contrat** : `SegmentRuleDefinition`
 * n'expose que ces sept champs, et l'API n'accepte rien d'autre. Elle n'est donc
 * pas une déduction depuis `ClientDetailDto` — agence, type de client et score
 * de fidélité, par exemple, ne sont pas segmentables aujourd'hui, même s'ils
 * existent sur la fiche client. Ajouter un critère ici sans l'ajouter au
 * contrat le ferait ignorer silencieusement par le serveur.
 */
export type SegmentCriterionKey =
  | 'minTenureDays'
  | 'maxTenureDays'
  | 'minDaysSinceLastActivity'
  | 'maxDaysSinceLastActivity'
  | 'requiredKycStatus'
  | 'requiredRiskLevel'
  | 'requiresOutstandingData';

interface SegmentCriterionDefinition {
  key: SegmentCriterionKey;
  label: string;
  /** `number` : un nombre de jours. `choice` : une valeur d'énumération. `flag` : un oui/non. */
  editor: 'number' | 'choice' | 'flag';
  options?: { label: string; value: string }[];
  hint: string;
}

/**
 * `requiredKycStatus` et `requiredRiskLevel` sont déclarés `type: string` sans
 * énumération dans le swagger : ces valeurs reprennent le vocabulaire du module
 * Clients (`packages/crm/customers/src/models/client-labels.ts`) et restent
 * **à confirmer côté API**. Elles sont recopiées plutôt qu'importées pour ne pas
 * coupler la lib `settings` à la lib `customers`.
 */
const KYC_STATUS_OPTIONS = [
  { label: 'Non démarré', value: 'NotStarted' },
  { label: 'En attente', value: 'Pending' },
  { label: 'Validé', value: 'Validated' },
  { label: 'Rejeté', value: 'Rejected' },
  { label: 'Expiré', value: 'Expired' },
];

const RISK_LEVEL_OPTIONS = [
  { label: 'Faible', value: 'Low' },
  { label: 'Moyen', value: 'Medium' },
  { label: 'Élevé', value: 'High' },
];

export const SEGMENT_CRITERIA: SegmentCriterionDefinition[] = [
  {
    key: 'minTenureDays',
    label: 'Ancienneté minimale',
    editor: 'number',
    hint: "Le client est dans l'institution depuis au moins ce nombre de jours.",
  },
  {
    key: 'maxTenureDays',
    label: 'Ancienneté maximale',
    editor: 'number',
    hint: "Le client est dans l'institution depuis au plus ce nombre de jours.",
  },
  {
    key: 'minDaysSinceLastActivity',
    label: 'Inactivité minimale',
    editor: 'number',
    hint: 'La dernière activité remonte à au moins ce nombre de jours.',
  },
  {
    key: 'maxDaysSinceLastActivity',
    label: 'Inactivité maximale',
    editor: 'number',
    hint: 'La dernière activité remonte à au plus ce nombre de jours.',
  },
  {
    key: 'requiredKycStatus',
    label: 'Statut KYC requis',
    editor: 'choice',
    options: KYC_STATUS_OPTIONS,
    hint: 'Le dossier KYC du client est dans cet état.',
  },
  {
    key: 'requiredRiskLevel',
    label: 'Niveau de risque requis',
    editor: 'choice',
    options: RISK_LEVEL_OPTIONS,
    hint: 'Le client porte ce niveau de risque.',
  },
  {
    key: 'requiresOutstandingData',
    label: 'Encours et produits détenus',
    editor: 'flag',
    hint: "Le serveur accepte la règle mais ne l'applique pas : les encours viennent de l'Épargne (M03) et du Crédit (M04), qui n'exposent pas encore de contrat.",
  },
];

// ─── Modèle local d'édition ──────────────────────────────────────────────────

let _uidCounter = 0;
function uid(prefix: string): string {
  return prefix + ++_uidCounter;
}

interface EditableCondition {
  _uid: string;
  criterion: SegmentCriterionKey;
  /** Toujours une chaîne : `tas-select` ne travaille qu'en chaînes et les champs rendent du texte. */
  value: string;
}

interface EditableRule {
  _uid: string;
  code: string;
  segmentCode: string;
  conditions: EditableCondition[];
  expanded: boolean;
  /** Renvoyé par le serveur, en lecture seule : une règle non évaluable est stockée mais jamais appliquée. */
  isEvaluable: boolean;
  notEvaluableReason: string | null;
}

// ─── Modèles de formulaire (signal forms) ────────────────────────────────────

class RuleIdentityFormModel {
  public code!: string;
  public segmentCode!: string;

  public static instantiate(): RuleIdentityFormModel {
    const model = new RuleIdentityFormModel();
    model.code = '';
    model.segmentCode = '';
    return model;
  }

  public static fromRule(rule: EditableRule): RuleIdentityFormModel {
    const model = new RuleIdentityFormModel();
    model.code = rule.code;
    model.segmentCode = rule.segmentCode;
    return model;
  }
}

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/;

@Component({
  selector: 'client-segment-rules',
  templateUrl: './client-segment-rules.html',
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    DragDropModule,
    TasCard,
    Button,
    TasIcon,
    TasTag,
    TasSpinner,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasSwitch,
  ],
})
export class ClientSegmentRulesPage implements OnInit {
  private readonly _segmentsApiService = inject(ClientTimelineSegmentsApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _confirmDialogService = inject(ConfirmDialogService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);

  /**
   * `PUT /api/v1/clients/segments/rules` exige `customers:update_sensitive` — la
   * lecture ne demande que `customers:read`. Le contrôle est répété ici et pas
   * seulement dans la garde de route : si la garde est un jour ouverte à
   * `customers:read` pour offrir un mode consultation, l'écran passe de lui-même
   * en lecture seule au lieu de laisser le serveur répondre 403.
   */
  public readonly canManage = this._permissions.can('customers:update_sensitive');

  public isLoading = signal(true);
  public isSaving = signal(false);
  public hasUnsavedChanges = signal(false);

  public rules = signal<EditableRule[]>([]);
  public serverState = signal<SegmentRulesDto | null>(null);
  public distribution = signal<SegmentDistributionDto | null>(null);

  public editingUid = signal<string | null>(null);
  public showAddForm = signal(false);

  public addModel = signal(RuleIdentityFormModel.instantiate());
  public addFormSchema = form(this.addModel, (schema) => {
    required(schema.code, { message: 'Le nom de la règle est obligatoire' });
    pattern(schema.code, CODE_PATTERN, {
      message:
        'Utilisez 2 à 40 caractères : lettres, chiffres, tiret ou souligné',
    });
    validate(schema.code, (ctx) => this._codeConflict(ctx.value(), null));
    required(schema.segmentCode, {
      message: 'Le segment cible est obligatoire',
    });
    pattern(schema.segmentCode, CODE_PATTERN, {
      message:
        'Utilisez 2 à 40 caractères : lettres, chiffres, tiret ou souligné',
    });
  });

  public editModel = signal(RuleIdentityFormModel.instantiate());
  public editFormSchema = form(this.editModel, (schema) => {
    required(schema.code, { message: 'Le nom de la règle est obligatoire' });
    pattern(schema.code, CODE_PATTERN, {
      message:
        'Utilisez 2 à 40 caractères : lettres, chiffres, tiret ou souligné',
    });
    validate(schema.code, (ctx) =>
      this._codeConflict(ctx.value(), this.editingUid()),
    );
    required(schema.segmentCode, {
      message: 'Le segment cible est obligatoire',
    });
    pattern(schema.segmentCode, CODE_PATTERN, {
      message:
        'Utilisez 2 à 40 caractères : lettres, chiffres, tiret ou souligné',
    });
  });

  /**
   * Aucun endpoint du contrat ne compte les clients qui correspondraient à une
   * règle candidate : `GET /api/v1/clients/segments` ne renvoie que la
   * répartition déjà calculée par le traitement nocturne. La simulation reste
   * donc désactivée — afficher un nombre déduit de cette répartition serait un
   * chiffre inventé.
   */
  public readonly simulationUnavailableReason =
    "La simulation n'est pas encore disponible : l'API ne propose aucun endpoint qui compte les clients correspondant à une règle avant son activation.";

  /** Segments déjà connus du serveur : ils évitent de retaper un code à la main. */
  public readonly knownSegmentCodes = computed(() => {
    const codes = new Set<string>();
    for (const bucket of this.distribution()?.buckets ?? []) {
      if (bucket.segmentCode) codes.add(bucket.segmentCode);
    }
    for (const rule of this.rules()) {
      if (rule.segmentCode) codes.add(rule.segmentCode);
    }
    return [...codes].sort((a, b) => a.localeCompare(b));
  });

  public readonly buckets = computed(() =>
    [...(this.distribution()?.buckets ?? [])].sort(
      (a, b) => (b.clientCount ?? 0) - (a.clientCount ?? 0),
    ),
  );

  /**
   * Une règle sans condition attrape tout le monde (c'est la façon prévue par le
   * contrat d'exprimer un segment par défaut) : placée ailleurs qu'en dernier,
   * elle rend les règles suivantes inatteignables.
   */
  public readonly deadRuleCount = computed(() => {
    const list = this.rules();
    const catchAll = list.findIndex((rule) => rule.conditions.length === 0);
    return catchAll >= 0 ? list.length - catchAll - 1 : 0;
  });

  public ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Segmentation des clients' },
    ]);
    this._load();
  }

  // ─── Critères ──────────────────────────────────────────────────────────────

  public criterionOf(condition: EditableCondition): SegmentCriterionDefinition {
    return (
      SEGMENT_CRITERIA.find((def) => def.key === condition.criterion) ??
      SEGMENT_CRITERIA[0]
    );
  }

  public availableCriteria(rule: EditableRule): SegmentCriterionDefinition[] {
    const used = new Set(rule.conditions.map((condition) => condition.criterion));
    return SEGMENT_CRITERIA.filter((def) => !used.has(def.key));
  }

  /** Une part à 12,3456 % ne dit rien de plus qu'une part à 12,3 %. */
  public sharePercentLabel(bucket: SegmentBucketDto): string {
    return String(Math.round((bucket.sharePercent ?? 0) * 10) / 10);
  }

  public addCondition(rule: EditableRule, criterion: string): void {
    const def = SEGMENT_CRITERIA.find((item) => item.key === criterion);
    if (!def) return;
    if (rule.conditions.some((condition) => condition.criterion === def.key)) {
      return;
    }
    rule.conditions = [
      ...rule.conditions,
      {
        _uid: uid('__c'),
        criterion: def.key,
        value: this._defaultValue(def),
      },
    ];
    this.hasUnsavedChanges.set(true);
  }

  public removeCondition(rule: EditableRule, conditionUid: string): void {
    rule.conditions = rule.conditions.filter(
      (condition) => condition._uid !== conditionUid,
    );
    this.hasUnsavedChanges.set(true);
  }

  public setConditionValue(condition: EditableCondition, value: unknown): void {
    condition.value =
      value === null || value === undefined ? '' : String(value);
    this.hasUnsavedChanges.set(true);
  }

  public toggleExpanded(rule: EditableRule): void {
    rule.expanded = !rule.expanded;
  }

  /** Résumé lisible d'une règle, pour la ligne repliée. */
  public conditionsSummary(rule: EditableRule): string {
    if (rule.conditions.length === 0) return 'Tous les clients';
    return rule.conditions
      .map((condition) => {
        const def = this.criterionOf(condition);
        if (def.editor === 'flag') return def.label;
        if (def.editor === 'choice') {
          const option = def.options?.find(
            (item) => item.value === condition.value,
          );
          return `${def.label} : ${option?.label ?? (condition.value || '—')}`;
        }
        return `${def.label} : ${condition.value || '—'} j`;
      })
      .join(' · ');
  }

  // ─── Ajout et modification d'une règle ─────────────────────────────────────

  public toggleAddForm(): void {
    this.editingUid.set(null);
    this.addFormSchema().reset(RuleIdentityFormModel.instantiate());
    this.showAddForm.update((visible) => !visible);
  }

  public handleAddRule(): void {
    submit(this.addFormSchema, (field) => {
      const value = field()?.value();
      const rule: EditableRule = {
        _uid: uid('__r'),
        code: value.code.trim(),
        segmentCode: value.segmentCode.trim(),
        conditions: [],
        expanded: true,
        isEvaluable: true,
        notEvaluableReason: null,
      };
      this.rules.update((list) => [...list, rule]);
      this.hasUnsavedChanges.set(true);
      this.showAddForm.set(false);
      this.addFormSchema().reset(RuleIdentityFormModel.instantiate());
      this._snackbarService.info(
        'Règle ajoutée',
        'Composez ses conditions, puis enregistrez pour appliquer le nouvel ordre de priorité.',
      );
      return Promise.resolve(undefined);
    });
  }

  public openEditForm(rule: EditableRule): void {
    this.showAddForm.set(false);
    this.editModel.set(RuleIdentityFormModel.fromRule(rule));
    this.editingUid.set(rule._uid);
  }

  public cancelEditForm(): void {
    this.editingUid.set(null);
  }

  public handleEditRule(): void {
    const ruleUid = this.editingUid();
    if (!ruleUid) return;
    submit(this.editFormSchema, (field) => {
      const value = field()?.value();
      this.rules.update((list) =>
        list.map((rule) =>
          rule._uid === ruleUid
            ? {
                ...rule,
                code: value.code.trim(),
                segmentCode: value.segmentCode.trim(),
              }
            : rule,
        ),
      );
      this.hasUnsavedChanges.set(true);
      this.editingUid.set(null);
      return Promise.resolve(undefined);
    });
  }

  public applySegmentSuggestion(target: 'add' | 'edit', code: string): void {
    const schema = target === 'add' ? this.addFormSchema : this.editFormSchema;
    schema.segmentCode().value.set(code);
  }

  public removeRule(rule: EditableRule): void {
    this._confirmDialogService.confirm({
      title: 'Supprimer la règle',
      message: `La règle « ${rule.code} » sera retirée de la séquence. Enregistrez pour appliquer la suppression.`,
      closable: true,
      acceptButtonProps: { label: 'Supprimer', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.rules.update((list) =>
          list.filter((item) => item._uid !== rule._uid),
        );
        if (this.editingUid() === rule._uid) this.editingUid.set(null);
        this.hasUnsavedChanges.set(true);
      },
    });
  }

  // ─── Réordonnancement ──────────────────────────────────────────────────────

  public onReorderRule(event: CdkDragDrop<void>): void {
    if (event.previousIndex === event.currentIndex) return;
    this.rules.update((list) => {
      const reordered = [...list];
      moveItemInArray(reordered, event.previousIndex, event.currentIndex);
      return reordered;
    });
    this.hasUnsavedChanges.set(true);
  }

  public moveRule(index: number, offset: number): void {
    const target = index + offset;
    if (target < 0 || target >= this.rules().length) return;
    this.rules.update((list) => {
      const reordered = [...list];
      moveItemInArray(reordered, index, target);
      return reordered;
    });
    this.hasUnsavedChanges.set(true);
  }

  // ─── Enregistrement ────────────────────────────────────────────────────────

  public save(): void {
    const problems = this._validateRules();
    if (problems.length > 0) {
      this._snackbarService.error('Règles incomplètes', problems[0]);
      return;
    }

    const sent = this.rules().map((rule, index) =>
      this._toDefinition(rule, index + 1),
    );

    this.isSaving.set(true);
    this._segmentsApiService
      .updateClientSegmentRules({ rules: sent })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.isSaving.set(false);
          this._snackbarService.error(
            'Erreur',
            this._serverMessage(error) ??
              "Impossible d'enregistrer les règles de segmentation.",
          );
          return EMPTY;
        }),
        // Un 200 ne prouve pas que le serveur a tout stocké : la séquence part
        // en un seul document JSON. On la relit avant d'annoncer quoi que ce
        // soit, et l'écran repart de ce que le serveur renvoie.
        switchMap(() =>
          this._segmentsApiService.getClientSegmentRules().pipe(
            catchError(() => {
              this.isSaving.set(false);
              this.hasUnsavedChanges.set(false);
              this._snackbarService.info(
                'Enregistrement envoyé',
                'Les règles sont parties mais la relecture a échoué : rechargez la page pour vérifier ce qui est stocké.',
              );
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe((reloaded) => {
        this.isSaving.set(false);
        this._applyServerRules(reloaded);

        const stored = (reloaded.rules ?? []).map((rule) =>
          this._signature(rule as SegmentRuleDefinition),
        );
        const expected = sent.map((rule) => this._signature(rule));
        const matches =
          stored.length === expected.length &&
          expected.every((line, index) => line === stored[index]);

        if (!matches) {
          this._snackbarService.error(
            'Enregistrement à vérifier',
            `${expected.length} règle(s) envoyée(s), ${stored.length} relue(s) et dans un état différent. L'écran affiche ce que le serveur a réellement stocké.`,
          );
          return;
        }

        this.hasUnsavedChanges.set(false);
        this._snackbarService.success(
          'Enregistré',
          `${stored.length} règle(s) enregistrée(s) dans cet ordre de priorité. Le classement s'applique au prochain passage du traitement nocturne.`,
        );

        const notEvaluable = reloaded.notEvaluableCount ?? 0;
        if (notEvaluable > 0) {
          this._snackbarService.info(
            'Règles stockées mais inactives',
            `${notEvaluable} règle(s) attendent les encours de l'Épargne (M03) ou du Crédit (M04) et ne seront pas appliquées.`,
          );
        }
      });
  }

  public reload(): void {
    if (!this.hasUnsavedChanges()) {
      this._load();
      return;
    }
    this._confirmDialogService.confirm({
      title: 'Abandonner les modifications',
      message:
        'Les règles seront rechargées depuis le serveur et vos modifications non enregistrées seront perdues.',
      closable: true,
      acceptButtonProps: { label: 'Recharger', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._load(),
    });
  }

  // ─── Privé ─────────────────────────────────────────────────────────────────

  /**
   * Un critère de choix arrive sans valeur : c'est la validation qui exige un
   * choix explicite, plutôt qu'une première option retenue par défaut à l'insu
   * de l'administrateur.
   */
  private _defaultValue(def: SegmentCriterionDefinition): string {
    return def.editor === 'flag' ? 'true' : '';
  }

  private _load(): void {
    this.isLoading.set(true);
    forkJoin({
      rules: this._segmentsApiService.getClientSegmentRules().pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbarService.error(
            'Erreur',
            this._serverMessage(error) ??
              'Impossible de charger les règles de segmentation.',
          );
          return EMPTY;
        }),
      ),
      // La répartition n'est qu'un repère : son échec ne doit pas priver
      // l'administrateur de l'écran de paramétrage.
      distribution: this._segmentsApiService
        .getClientSegmentDistribution()
        .pipe(catchError(() => of(null))),
    }).subscribe({
      next: ({ rules, distribution }) => {
        this._applyServerRules(rules);
        this.distribution.set(distribution);
        this.hasUnsavedChanges.set(false);
        this.editingUid.set(null);
        this.showAddForm.set(false);
        this.isLoading.set(false);
      },
      complete: () => this.isLoading.set(false),
    });
  }

  private _applyServerRules(dto: SegmentRulesDto): void {
    this.serverState.set(dto);
    const ordered = [...(dto.rules ?? [])].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
    );
    this.rules.set(
      ordered.map((rule) => ({
        _uid: uid('__r'),
        code: rule.code ?? '',
        segmentCode: rule.segmentCode ?? '',
        conditions: this._toConditions(rule),
        expanded: false,
        isEvaluable: rule.isEvaluable ?? true,
        notEvaluableReason: rule.notEvaluableReason ?? null,
      })),
    );
  }

  private _toConditions(rule: SegmentRuleDefinition): EditableCondition[] {
    const conditions: EditableCondition[] = [];
    for (const def of SEGMENT_CRITERIA) {
      if (def.key === 'requiresOutstandingData') {
        if (rule.requiresOutstandingData) {
          conditions.push({
            _uid: uid('__c'),
            criterion: def.key,
            value: 'true',
          });
        }
        continue;
      }
      // La clé booléenne est déjà traitée au-dessus : le reste est un nombre
      // de jours ou une valeur d'énumération.
      const raw = rule[def.key] as string | number | null | undefined;
      if (raw === null || raw === undefined || raw === '') continue;
      conditions.push({
        _uid: uid('__c'),
        criterion: def.key,
        value: String(raw),
      });
    }
    return conditions;
  }

  private _toDefinition(
    rule: EditableRule,
    priority: number,
  ): SegmentRuleDefinition {
    const raw = (key: SegmentCriterionKey): string =>
      rule.conditions.find((condition) => condition.criterion === key)?.value.trim() ??
      '';
    const asNumber = (key: SegmentCriterionKey): number | null => {
      const value = raw(key);
      return value === '' ? null : Number(value);
    };
    const asString = (key: SegmentCriterionKey): string | null => {
      const value = raw(key);
      return value === '' ? null : value;
    };

    return {
      code: rule.code.trim(),
      priority,
      segmentCode: rule.segmentCode.trim(),
      minTenureDays: asNumber('minTenureDays'),
      maxTenureDays: asNumber('maxTenureDays'),
      minDaysSinceLastActivity: asNumber('minDaysSinceLastActivity'),
      maxDaysSinceLastActivity: asNumber('maxDaysSinceLastActivity'),
      requiredKycStatus: asString('requiredKycStatus'),
      requiredRiskLevel: asString('requiredRiskLevel'),
      requiresOutstandingData: raw('requiresOutstandingData') === 'true',
    };
  }

  /** Signature d'une règle hors priorité : ce qui est comparé après relecture. */
  private _signature(rule: SegmentRuleDefinition): string {
    return [
      rule.code ?? '',
      rule.segmentCode ?? '',
      rule.minTenureDays ?? '',
      rule.maxTenureDays ?? '',
      rule.minDaysSinceLastActivity ?? '',
      rule.maxDaysSinceLastActivity ?? '',
      rule.requiredKycStatus ?? '',
      rule.requiredRiskLevel ?? '',
      rule.requiresOutstandingData ? '1' : '0',
    ].join('|');
  }

  private _validateRules(): string[] {
    const problems: string[] = [];
    const list = this.rules();

    if (list.length === 0) {
      problems.push(
        'Ajoutez au moins une règle avant d’enregistrer, sinon aucun client ne sera classé.',
      );
      return problems;
    }

    const seen = new Set<string>();
    list.forEach((rule, index) => {
      const position = `Règle ${index + 1}`;
      if (!rule.code.trim()) {
        problems.push(`${position} : le nom de la règle est vide.`);
      }
      if (!rule.segmentCode.trim()) {
        problems.push(`${position} : le segment cible est vide.`);
      }
      const key = rule.code.trim().toLowerCase();
      if (key && seen.has(key)) {
        problems.push(`${position} : le nom « ${rule.code} » est déjà utilisé.`);
      }
      seen.add(key);

      for (const condition of rule.conditions) {
        const def = this.criterionOf(condition);
        if (def.editor === 'flag') continue;
        if (!condition.value.trim()) {
          problems.push(`${position} : le critère « ${def.label} » n'a pas de valeur.`);
          continue;
        }
        if (def.editor === 'number') {
          const parsed = Number(condition.value);
          if (!Number.isInteger(parsed) || parsed < 0) {
            problems.push(
              `${position} : « ${def.label} » attend un nombre de jours entier et positif.`,
            );
          }
        }
      }

      const bounds: [SegmentCriterionKey, SegmentCriterionKey, string][] = [
        ['minTenureDays', 'maxTenureDays', "l'ancienneté"],
        [
          'minDaysSinceLastActivity',
          'maxDaysSinceLastActivity',
          "l'inactivité",
        ],
      ];
      for (const [minKey, maxKey, label] of bounds) {
        const min = rule.conditions.find((c) => c.criterion === minKey)?.value;
        const max = rule.conditions.find((c) => c.criterion === maxKey)?.value;
        if (min && max && Number(min) > Number(max)) {
          problems.push(
            `${position} : le minimum de ${label} dépasse son maximum, aucune fiche ne peut correspondre.`,
          );
        }
      }
    });

    return problems;
  }

  private _codeConflict(
    value: string | undefined,
    ignoreUid: string | null,
  ): { kind: string; message: string } | null {
    const candidate = (value ?? '').trim().toLowerCase();
    if (!candidate) return null;
    const conflict = this.rules().some(
      (rule) =>
        rule._uid !== ignoreUid && rule.code.trim().toLowerCase() === candidate,
    );
    return conflict
      ? { kind: 'duplicate', message: 'Une règle porte déjà ce nom' }
      : null;
  }

  private _serverMessage(error: HttpErrorResponse): string | null {
    const body = error.error;
    if (!body) return null;
    if (typeof body === 'string') return body;
    const errors = body.errors as Record<string, string[]> | undefined;
    if (errors) {
      const first = Object.values(errors).flat()[0];
      if (first) return first;
    }
    return (body.detail as string) ?? (body.title as string) ?? null;
  }
}

export default ClientSegmentRulesPage;
