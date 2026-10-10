import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { form, FormField, FormRoot, validate } from '@angular/forms/signals';
import { catchError, EMPTY, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import {
  LeadsApiService,
  MissingQuestionnaire,
  QualificationTemplateDto,
  QuestionnaireResponseDto,
} from '@sankore/crm-api';
import {
  consentProofLabel,
  DynamicFormAnswers,
  DynamicFormRendererComponent,
  DynamicFormSchema,
  householdMemberTypeLabel,
  identityLabel,
  PERMISSIONS,
  PermissionsService,
} from '@sankore/crm/common';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { LeadComplianceStore } from './lead-compliance-store';
import { LeadEditContext } from './lead-edit-context';
import {
  HealthConsentDrawer,
  HealthConsentDrawerData,
  HealthConsentDrawerResult,
} from './health-consent-drawer';
import {
  PersonQuestionnaireState,
  PersonQuestionnaireTab,
  PersonQuestionnaireTabs,
} from './person-questionnaire-tabs';

/** Âge en dessous duquel une personne ne consent pas elle-même (BNF-F-07). */
const MAJORITY_AGE = 18;

/** Code de la jauge de complétude qui signale un consentement santé manquant. */
const HEALTH_CONSENT_GAP_CODE = 'HEALTH_CONSENT_MISSING';

/**
 * Conversion gabarit → schéma du rendu dynamique.
 *
 * Recopiée de `qualification.ts`, où elle est une fonction privée de module :
 * l'onglet Qualification appartient à un autre périmètre et n'a pas à être
 * modifié pour exposer ce détail. Les deux copies doivent rester identiques —
 * si l'une bouge, l'autre aussi.
 */
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

interface QuestionnaireEntryView {
  templateId: string;
  templateName: string;
  isHealth: boolean;
  response: QuestionnaireResponseDto | null;
}

interface PersonQuestionnaireView {
  key: string;
  roleLabel: string;
  label: string;
  subjectType: string;
  /** `null` quand l'API n'a pas encore déclaré de sujet pour cette personne. */
  subjectId: string | null;
  age: number | null;
  isMinor: boolean;
  entries: QuestionnaireEntryView[];
  requiresHealthConsent: boolean;
  consentGiven: boolean;
  consent: HealthConsentDrawerResult | null;
  state: PersonQuestionnaireState;
}

interface QuestionnaireRow {
  id: string;
  personKey: string;
  person: string;
  role: string;
  template: string;
  isHealth: boolean;
  statusLabel: string;
  statusSeverity: Severity;
  respondent: string;
  answeredAt: string | null;
}

class RespondentFormModel {
  public respondentId!: string;

  public static empty(): RespondentFormModel {
    const m = new RespondentFormModel();
    m.respondentId = '';
    return m;
  }
}

/** Les libellés de sujet viennent du serveur : on compare à la casse et aux espaces près. */
function sameSubject(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/**
 * Onglet « Questionnaires » de la fiche lead : questionnaire santé par personne
 * (BNF-F-06) et consentements santé par personne (BNF-F-07).
 *
 * Deux choix structurants :
 *
 * 1. **Les brouillons vivent en mémoire, jamais en stockage navigateur.** Un
 *    questionnaire santé est une donnée de santé ; `localStorage` la laisserait
 *    sur le poste bien après la session. C'est la différence volontaire avec
 *    l'onglet Qualification, qui persiste ses brouillons. Le prix est que la
 *    saisie est perdue en changeant d'onglet — l'écran le dit.
 * 2. **Le sélecteur de personne est dessiné depuis le foyer, pas depuis
 *    `missing[]`.** Un membre ajouté dans l'onglet Foyer apparaît donc dès que
 *    `reloadHousehold()` passe, sans rechargement de page ; les questionnaires
 *    sont rechargés dans la foulée pour que son onglet devienne actionnable.
 */
@Component({
  selector: 'lead-questionnaires',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './questionnaires.html',
  imports: [
    FormRoot,
    FormField,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    TasTable,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasSelect,
    Button,
    TimeagoPipe,
    DynamicFormRendererComponent,
    ConvertedLeadNotice,
    PersonQuestionnaireTabs,
  ],
})
export class LeadQuestionnaires {
  public readonly compliance = inject(LeadComplianceStore);
  public readonly leadEditContext = inject(LeadEditContext);

  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);

  private readonly _renderer = viewChild(DynamicFormRendererComponent);

  /**
   * Le contrat ne déclare aucune permission sur `POST .../questionnaires/responses`
   * ni sur `POST .../health-consents`. On réutilise les codes catalogués les plus
   * proches — modifier le dossier, et enregistrer un consentement — plutôt que
   * d'inventer un code que le serveur ne connaîtrait pas.
   */
  private readonly _canSubmit = this._permissions.can(PERMISSIONS.LEAD_UPDATE);
  private readonly _canRecordConsent = this._permissions.can(PERMISSIONS.LEAD_CONSENT_RECORD);

  public readonly consentProofLabel = consentProofLabel;

  public readonly isSubmitting = signal(false);
  public readonly isTemplateLoading = signal(false);
  public readonly templateError = signal<string | null>(null);

  /** Consentements recueillis dans cette session, par identifiant de sujet. */
  private readonly _localConsents = signal<Record<string, HealthConsentDrawerResult>>({});

  /** Gabarits déjà chargés, par `templateId`. */
  private readonly _templates = signal<Record<string, QualificationTemplateDto>>({});

  /** Brouillons en mémoire, clé `personKey::templateId`. Jamais persistés. */
  private readonly _drafts = signal<Record<string, DynamicFormAnswers>>({});

  private _lastMemberSignature: string | null = null;

  public readonly leadId = computed(() => this.compliance.leadId());
  public readonly progress = computed(() => this.compliance.questionnaireProgress());
  public readonly progressPercent = computed(() => {
    const { done, total } = this.progress();
    return total > 0 ? Math.round((done / total) * 100) : 0;
  });

  /** `true` quand la jauge de complétude n'a pas pu être lue : on ne sait pas qui a consenti. */
  public readonly consentStateUnknown = computed(() => this.compliance.completeness() === null);

  public readonly healthConsentsOnLead = computed(
    () => this.compliance.consents().filter((c) => c.type === 'HealthData' && !c.withdrawnAt).length,
  );

  /** Identifiant de sujet du principal, tel que l'API le nomme dans les questionnaires. */
  private readonly _principalSubjectId = computed(() => {
    const data = this.compliance.questionnaires();
    const entry =
      (data?.responses ?? []).find((r) => r.subjectType === 'Principal') ??
      (data?.missing ?? []).find((m) => m.subjectType === 'Principal');
    return entry?.subjectId ?? null;
  });

  public readonly persons = computed<PersonQuestionnaireView[]>(() => {
    const data = this.compliance.questionnaires();
    const responses = data?.responses ?? [];
    const missing = data?.missing ?? [];
    const consents = this._localConsents();
    const completeness = this.compliance.completeness();
    const gaps = completeness?.gaps ?? [];

    const seenSubjectIds = new Set<string>();
    const drafts: Omit<
      PersonQuestionnaireView,
      'entries' | 'requiresHealthConsent' | 'consentGiven' | 'consent' | 'state' | 'isMinor'
    >[] = [];

    const principal = this.compliance.principal();
    if (principal) {
      drafts.push({
        key: 'principal',
        roleLabel: 'Principal',
        label: this.compliance.principalLabel(),
        subjectType: 'Principal',
        subjectId: this._principalSubjectId(),
        age: null,
      });
    }

    const spouse = this.compliance.activeSpouse();
    if (spouse) {
      drafts.push({
        key: spouse.memberId ?? 'spouse',
        roleLabel: 'Conjoint',
        label: identityLabel(spouse.identity),
        subjectType: 'Spouse',
        subjectId: spouse.memberId ?? null,
        age: spouse.age ?? null,
      });
    }

    this.compliance.children().forEach((child, index) => {
      drafts.push({
        key: child.memberId ?? `child-${index}`,
        roleLabel: `Enfant ${index + 1}`,
        label: identityLabel(child.identity),
        subjectType: 'Child',
        subjectId: child.memberId ?? null,
        age: child.age ?? null,
      });
    });

    for (const d of drafts) {
      if (d.subjectId) seenSubjectIds.add(d.subjectId);
    }

    // Un sujet que l'API réclame mais que le foyer ne décrit pas ne doit pas
    // disparaître de l'écran : sans cet ajout, un questionnaire dû resterait
    // invisible et la jauge ne passerait jamais au vert.
    for (const entry of [...responses, ...missing]) {
      const subjectId = entry.subjectId;
      if (!subjectId || seenSubjectIds.has(subjectId)) continue;
      if (entry.subjectType === 'Principal' && this._principalSubjectId() === subjectId) continue;
      seenSubjectIds.add(subjectId);
      drafts.push({
        key: subjectId,
        roleLabel: householdMemberTypeLabel(entry.subjectType),
        label: entry.subjectLabel ?? 'Personne sans nom',
        subjectType: entry.subjectType ?? '',
        subjectId,
        age: null,
      });
    }

    return drafts.map((d) => {
      const entries = this._entriesFor(d.subjectId, d.subjectType, responses, missing);
      const requiresHealthConsent = entries.some((e) => e.isHealth);
      const serverLabels = [
        ...responses.filter((r) => r.subjectId === d.subjectId).map((r) => r.subjectLabel),
        ...missing.filter((m) => m.subjectId === d.subjectId).map((m) => m.subjectLabel),
      ];
      const labelsToMatch = [d.label, ...serverLabels];

      const localConsent = d.subjectId ? (consents[d.subjectId] ?? null) : null;
      const answeredHealth = entries.some((e) => e.isHealth && e.response);
      let consentGiven: boolean;
      if (localConsent || answeredHealth) {
        consentGiven = true;
      } else if (!completeness) {
        consentGiven = false;
      } else {
        consentGiven = !gaps.some(
          (g) =>
            g.code === HEALTH_CONSENT_GAP_CODE &&
            labelsToMatch.some((l) => sameSubject(g.subjectLabel, l)),
        );
      }

      const isMinor = d.age != null ? d.age < MAJORITY_AGE : d.subjectType === 'Child';

      let state: PersonQuestionnaireState;
      if (entries.length === 0) {
        state = 'pending';
      } else if (requiresHealthConsent && !consentGiven) {
        state = 'locked';
      } else if (entries.every((e) => e.response)) {
        state = 'done';
      } else {
        state = 'todo';
      }

      return { ...d, isMinor, entries, requiresHealthConsent, consentGiven, consent: localConsent, state };
    });
  });

  public readonly tabs = computed<PersonQuestionnaireTab[]>(() =>
    this.persons().map((p) => ({
      key: p.key,
      label: p.label,
      roleLabel: p.roleLabel,
      state: p.state,
    })),
  );

  public readonly selectedKey = linkedSignal<PersonQuestionnaireView[], string | null>({
    source: () => this.persons(),
    computation: (persons, previous) => {
      const previousKey = previous?.value ?? null;
      if (previousKey && persons.some((p) => p.key === previousKey)) return previousKey;
      return persons[0]?.key ?? null;
    },
  });

  public readonly selectedPerson = computed(
    () => this.persons().find((p) => p.key === this.selectedKey()) ?? null,
  );

  public readonly selectedTemplateId = linkedSignal<PersonQuestionnaireView | null, string | null>({
    source: () => this.selectedPerson(),
    computation: (person, previous) => {
      if (!person) return null;
      const previousId = previous?.value ?? null;
      if (previousId && person.entries.some((e) => e.templateId === previousId)) return previousId;
      const firstTodo = person.entries.find((e) => !e.response);
      return (firstTodo ?? person.entries[0])?.templateId ?? null;
    },
  });

  public readonly selectedEntry = computed<QuestionnaireEntryView | null>(() => {
    const person = this.selectedPerson();
    const templateId = this.selectedTemplateId();
    if (!person || !templateId) return null;
    return person.entries.find((e) => e.templateId === templateId) ?? null;
  });

  public readonly selectedTemplate = computed<QualificationTemplateDto | null>(() => {
    const templateId = this.selectedTemplateId();
    return templateId ? (this._templates()[templateId] ?? null) : null;
  });

  public readonly formSchema = computed<DynamicFormSchema | null>(() => {
    const template = this.selectedTemplate();
    return template ? templateToSchema(template) : null;
  });

  /**
   * Réponses précédentes, ou brouillon en mémoire s'il y en a un. Une réponse
   * purgée ou dont les réponses sont retenues ne préremplit rien : l'API dit
   * explicitement qu'elle ne les communique pas.
   */
  public readonly initialAnswers = computed<DynamicFormAnswers>(() => {
    const person = this.selectedPerson();
    const entry = this.selectedEntry();
    if (!person || !entry) return {};

    const draft = this._drafts()[this._draftKey(person.key, entry.templateId)];
    if (draft) return draft;

    const response = entry.response;
    if (!response || response.isPurged || response.answersWithheldReason) return {};

    const answers: DynamicFormAnswers = {};
    for (const a of response.answers ?? []) {
      if (a.questionId) answers[a.questionId] = a.value ?? null;
    }
    return answers;
  });

  public readonly answersWithheld = computed(() => {
    const response = this.selectedEntry()?.response;
    if (!response) return null;
    if (response.isPurged) return 'Les réponses de ce questionnaire ont été purgées.';
    return response.answersWithheldReason ?? null;
  });

  /** Répondants possibles pour un mineur : principal ou conjoint (BNF-F-06). */
  public readonly respondentOptions = computed<{ label: string; value: string }[]>(() => {
    const options: { label: string; value: string }[] = [];
    const principalId = this._principalSubjectId();
    if (principalId) {
      options.push({ label: `${this.compliance.principalLabel()} (principal)`, value: principalId });
    }
    const spouse = this.compliance.activeSpouse();
    if (spouse?.memberId) {
      options.push({ label: `${identityLabel(spouse.identity)} (conjoint)`, value: spouse.memberId });
    }
    return options;
  });

  public readonly respondentModel = signal(RespondentFormModel.empty());

  public readonly respondentForm = form(this.respondentModel, (schema) => {
    // Obligatoire pour un mineur seulement, et seulement si un répondant est
    // identifiable : sans option sélectionnable, le `required` bloquerait la
    // saisie sans que l'agent puisse rien y faire.
    validate(schema.respondentId, (ctx) => {
      const person = this.selectedPerson();
      if (!person?.isMinor) return null;
      if (this.respondentOptions().length === 0) return null;
      return ctx.value()
        ? null
        : { kind: 'respondentRequired', message: 'Le répondant est obligatoire pour un mineur' };
    });
  });

  /** Un lead converti est figé : aucune écriture ne doit pouvoir y échapper. */
  public readonly canSubmit = computed(
    () => this._canSubmit() && !this.leadEditContext.isReadOnly(),
  );
  public readonly canRecordConsent = computed(
    () => this._canRecordConsent() && !this.leadEditContext.isReadOnly(),
  );

  /** Récapitulatif « qui doit quoi » — une collection, donc `tas-table`. */
  public readonly rows = computed<QuestionnaireRow[]>(() => {
    const labelById = new Map<string, string>();
    for (const p of this.persons()) {
      if (p.subjectId) labelById.set(p.subjectId, p.label);
    }

    const rows: QuestionnaireRow[] = [];
    for (const person of this.persons()) {
      for (const entry of person.entries) {
        const response = entry.response;
        const status = this._rowStatus(person, entry);
        rows.push({
          id: `${person.key}::${entry.templateId}`,
          personKey: person.key,
          person: person.label,
          role: person.roleLabel,
          template: entry.templateName,
          isHealth: entry.isHealth,
          statusLabel: status.label,
          statusSeverity: status.severity,
          respondent: response?.respondentId
            ? (labelById.get(response.respondentId) ?? 'Répondant externe')
            : '—',
          answeredAt: response?.answeredAt ?? null,
        });
      }
    }
    return rows;
  });

  public readonly tableConfig = computed(() => ({
    property: 'entity',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 30, 50],
      totalElements: this.rows().length,
    },
  }));

  constructor() {
    // Les consentements ne font pas partie du chargement initial du store : on
    // les lit ici pour pouvoir dire combien de consentements santé existent déjà
    // sur le lead quand une personne apparaît verrouillée.
    this.compliance.reloadConsents().subscribe();

    // Un membre ajouté dans l'onglet Foyer fait apparaître son onglet tout de
    // suite (le foyer est partagé) ; les questionnaires dus, eux, doivent être
    // relus pour que son onglet sache quel gabarit afficher.
    effect(() => {
      if (this.compliance.isLoading()) return;
      const signature = this.compliance
        .members()
        .map((m) => m.memberId ?? '')
        .join('|');
      if (this._lastMemberSignature === null) {
        this._lastMemberSignature = signature;
        return;
      }
      if (signature !== this._lastMemberSignature) {
        this._lastMemberSignature = signature;
        this.compliance.reloadQuestionnaires().subscribe();
      }
    });

    // Chargement paresseux du gabarit de la personne sélectionnée.
    effect(() => {
      const person = this.selectedPerson();
      const templateId = this.selectedTemplateId();
      if (!person || !templateId) return;
      if (person.state === 'locked') return;
      if (this._templates()[templateId]) return;
      this._loadTemplate(templateId);
    });

    // Le répondant est propre à chaque personne : on repart d'un champ vide en
    // changeant d'onglet, sinon le répondant d'un enfant suivrait l'autre.
    effect(() => {
      this.selectedKey();
      this.respondentModel.set(RespondentFormModel.empty());
    });
  }

  public onPersonSelected(key: string): void {
    this.selectedKey.set(key);
  }

  public onTemplateSelected(templateId: string): void {
    this.selectedTemplateId.set(templateId);
  }

  public onRowSelected(row: QuestionnaireRow): void {
    this.selectedKey.set(row.personKey);
  }

  public onAnswersChanged(answers: DynamicFormAnswers): void {
    const person = this.selectedPerson();
    const entry = this.selectedEntry();
    if (!person || !entry) return;
    const key = this._draftKey(person.key, entry.templateId);
    this._drafts.update((drafts) => ({ ...drafts, [key]: answers }));
  }

  public openConsentDrawer(): void {
    const person = this.selectedPerson();
    const leadId = this.leadId();
    if (!person || !leadId) return;

    if (!person.subjectId) {
      this._snackbar.error(
        'Personne inconnue',
        "L'API n'a pas encore déclaré cette personne : rechargez l'onglet dans un instant.",
      );
      return;
    }

    const givenByOptions = this.respondentOptions().filter((o) => o.value !== person.subjectId);

    const data: HealthConsentDrawerData = {
      leadId,
      subjectType: person.subjectType,
      subjectId: person.subjectId,
      subjectLabel: person.label,
      isMinor: person.isMinor,
      givenByOptions,
    };

    const ref = this._sideDrawer.open<
      HealthConsentDrawerResult | null,
      HealthConsentDrawerData,
      HealthConsentDrawer
    >(HealthConsentDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((result) => {
      if (!result) return;
      this._localConsents.update((map) => ({ ...map, [result.subjectId]: result }));
      this.compliance.reloadQuestionnaires().subscribe();
      this.compliance.reloadCompleteness().subscribe();
      this.compliance.reloadConsents().subscribe();
    });
  }

  public handleSubmit(): void {
    const person = this.selectedPerson();
    const entry = this.selectedEntry();
    const leadId = this.leadId();
    const renderer = this._renderer();
    if (!person || !entry || !leadId || !renderer) return;

    if (!person.subjectId) {
      this._snackbar.error(
        'Personne inconnue',
        "L'API n'a pas encore déclaré cette personne : rechargez l'onglet dans un instant.",
      );
      return;
    }

    renderer.markAllTouched();
    this.respondentForm().markAsTouched();

    if (this.respondentForm().invalid()) {
      this._snackbar.error('Validation', 'Désignez le répondant de ce mineur.');
      return;
    }

    if (!renderer.isValid()) {
      this._snackbar.error('Validation', 'Veuillez remplir tous les champs obligatoires.');
      return;
    }

    const answers = renderer.getAnswers();
    const respondentId = person.isMinor ? this.respondentModel().respondentId || null : null;

    this.isSubmitting.set(true);
    this._leadsApi
      .submitLeadQuestionnaireResponse(leadId, {
        templateId: entry.templateId,
        subjectType: person.subjectType,
        subjectId: person.subjectId,
        answers: Object.entries(answers).map(([questionId, value]) => ({ questionId, value })),
        respondentId,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Erreur', this._submitErrorMessage(error));
          return EMPTY;
        }),
        finalize(() => this.isSubmitting.set(false)),
      )
      .subscribe(() => {
        // Un 204 ne dit pas ce que le serveur a retenu : on relit les
        // questionnaires et la complétude avant d'afficher le nouvel état.
        this._drafts.update((drafts) => {
          const next = { ...drafts };
          delete next[this._draftKey(person.key, entry.templateId)];
          return next;
        });
        this.compliance.reloadQuestionnaires().subscribe();
        this.compliance.reloadCompleteness().subscribe();
        this._snackbar.success(
          'Questionnaire enregistré',
          `Les réponses de ${person.label} sont enregistrées.`,
        );
      });
  }

  public reload(): void {
    this.compliance.reloadQuestionnaires().subscribe();
    this.compliance.reloadCompleteness().subscribe();
    this.compliance.reloadConsents().subscribe();
  }

  private _entriesFor(
    subjectId: string | null,
    subjectType: string,
    responses: QuestionnaireResponseDto[],
    missing: MissingQuestionnaire[],
  ): QuestionnaireEntryView[] {
    const matches = (candidate: { subjectId?: string; subjectType?: string | null }): boolean => {
      if (subjectId) return candidate.subjectId === subjectId;
      // Le principal n'a pas d'identifiant dans le foyer : on retombe sur le
      // type de sujet, qui est unique pour lui.
      return subjectType === 'Principal' && candidate.subjectType === 'Principal';
    };

    const entries: QuestionnaireEntryView[] = [];
    for (const response of responses) {
      if (!matches(response) || !response.templateId) continue;
      entries.push({
        templateId: response.templateId,
        templateName: response.templateName ?? 'Questionnaire',
        isHealth: response.isHealthQuestionnaire === true,
        response,
      });
    }
    for (const m of missing) {
      if (!matches(m) || !m.templateId) continue;
      if (entries.some((e) => e.templateId === m.templateId)) continue;
      entries.push({
        templateId: m.templateId,
        templateName: m.templateName ?? 'Questionnaire',
        isHealth: m.isHealthQuestionnaire === true,
        response: null,
      });
    }
    return entries;
  }

  private _rowStatus(
    person: PersonQuestionnaireView,
    entry: QuestionnaireEntryView,
  ): { label: string; severity: Severity } {
    if (entry.response) return { label: 'Complété', severity: 'success' };
    if (entry.isHealth && !person.consentGiven) {
      return { label: 'Consentement requis', severity: 'error' };
    }
    return { label: 'À compléter', severity: 'warning' };
  }

  private _draftKey(personKey: string, templateId: string): string {
    return `${personKey}::${templateId}`;
  }

  private _loadTemplate(templateId: string): void {
    this.isTemplateLoading.set(true);
    this.templateError.set(null);
    this._leadsApi
      .getQualificationTemplate(templateId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.templateError.set(
            error.status === 404
              ? "Ce questionnaire n'existe plus ou n'est plus publié."
              : 'Impossible de charger le questionnaire.',
          );
          return EMPTY;
        }),
        finalize(() => this.isTemplateLoading.set(false)),
      )
      .subscribe((template) => {
        this._templates.update((map) => ({ ...map, [templateId]: template }));
      });
  }

  private _submitErrorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    switch (body?.code) {
      case 'HEALTH_CONSENT_MISSING':
        return 'Le consentement santé de cette personne doit être recueilli avant la saisie.';
      case 'QUESTIONNAIRE_RESPONDENT_REQUIRED':
        return 'Un répondant doit être désigné pour un mineur.';
      case 'QUESTIONNAIRE_TEMPLATE_NOT_APPLICABLE':
        return "Ce questionnaire ne s'applique pas à cette personne.";
      default:
        break;
    }

    if (error.status === 409) {
      return 'Ce questionnaire a été modifié entre-temps : rechargez avant de réessayer.';
    }
    const fieldErrors = Object.values(body?.errors ?? {}).flat();
    if (fieldErrors.length > 0) return fieldErrors.join(' ');
    if (body?.detail) return body.detail;
    if (body?.title) return body.title;
    if (error.status === 403) return "Vous n'avez pas le droit d'enregistrer ce questionnaire.";
    return 'Impossible d’enregistrer le questionnaire.';
  }
}

export default LeadQuestionnaires;
