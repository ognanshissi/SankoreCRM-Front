import { Component, computed, DestroyRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { form, FormField, FormRoot, maxLength, minLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, Observable, of } from 'rxjs';
import {
  ClientDetailDto,
  ClientsApiService,
  CloseOpportunityRequestOutcomeEnum,
  FormFieldReferenceTargetEnum,
  LeadDto,
  LeadsApiService,
  OpportunitiesApiService,
  OpportunityDto,
  ProjectStepDto,
  UpdateOpportunityRequest,
  ProjectValidationDto,
} from '@sankore/crm-api';
import {
  BreadcrumbService,
  EntityFormReferences,
  PermissionsService,
  ProjectGateCode,
  projectGateCode,
  projectAmountLabel,
  projectGateMessage,
  projectSaveErrorMessage,
} from '@sankore/crm/common';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { ConvertLeadWizard } from '../edit-lead/convert-lead-wizard';
import { currentStep, hasTemplateSteps, isClosed, stepLabel } from '../edit-lead/opportunities/opportunity.model';
import { EditProjectInfoDrawer, EditProjectInfoDrawerData } from './edit-project-info-drawer';
import { ProjectFields } from './project-fields';
import { ProjectHistory } from './project-history';
import { ProjectProgress } from './project-progress';
import { ProjectQuestionnaires } from './project-questionnaires';
import { ProjectSummary, ProjectUpdate } from './project-summary';
import { ProjectTasks } from './project-tasks';
import { ProjectValidations } from './project-validations';

class LoseFormModel {
  public reason!: string;

  public static instantiate(): LoseFormModel {
    const m = new LoseFormModel();
    m.reason = '';
    return m;
  }
}


/**
 * Le détail d'un projet, en deux colonnes depuis la refonte du 2026-10-27 (choix du
 * propriétaire) : à gauche le travail — où il en est, ce que l'étape demande pour la quitter, le
 * dossier, les questionnaires, les validations ; à droite ce qu'on veut voir sans faire défiler —
 * pour qui, combien, quand, la prochaine action.
 *
 * Toutes les écritures passent par la page : elle relit le projet (le jeton de concurrence est
 * périmé dès la réponse) et traduit les refus du serveur aux étapes marquées en bandeau, avec
 * l'action qui les lève.
 */
@Component({
  selector: 'project-detail',
  imports: [
    RouterLink, FormRoot, FormField, Anchor, Button, TasCard, TasFormField, TasLabel, TasError, TasIcon, TasInput, TasSpinner,
    ProjectFields, ProjectHistory, ProjectProgress, ProjectQuestionnaires, ProjectSummary, ProjectTasks, ProjectValidations,
  ],
  templateUrl: './project-detail.html',
})
export class ProjectDetail implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _permissions = inject(PermissionsService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  private readonly _summary = viewChild(ProjectSummary);
  private readonly _history = viewChild(ProjectHistory);

  public readonly projectId = signal('');
  public readonly project = signal<OpportunityDto | null>(null);
  /** Les circuits de validation lancés par les étapes, et leurs décisions — le plus récent d'abord. */
  public readonly validations = signal<ProjectValidationDto[]>([]);
  public readonly lead = signal<LeadDto | null>(null);
  public readonly client = signal<ClientDetailDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly busy = signal(false);
  /** Le formulaire « Marquer perdu », ouvert sous l'en-tête. */
  public readonly losing = signal(false);
  /** La souscription qu'un « gagné » vient d'ouvrir, pour la proposer tout de suite. */
  public readonly holdingId = signal<string | null>(null);
  public readonly gate = signal<{ code: ProjectGateCode; message: string } | null>(null);
  private _target: string | null = null;

  private readonly _canManage = this._permissions.can('lead:opportunity:manage');
  public readonly canManage = computed(() => this._canManage() && !!this.project() && !isClosed(this.project()!));

  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
    ),
    { initialValue: new Map<string, string>() },
  );
  private readonly _products = toSignal(this._references.options(FormFieldReferenceTargetEnum.Product), { initialValue: [] });

  // ——— Lecture ———

  public readonly closed = computed(() => !!this.project() && isClosed(this.project()!));
  public readonly current = computed(() => (this.project() ? currentStep(this.project()!) : null));
  public readonly statusLabel = computed(() => (this.project() ? stepLabel(this.project()!) : ''));

  public readonly ownerName = computed(() => {
    const id = this.project()?.ownerId;
    return id ? this._users().get(id) ?? null : null;
  });

  /** Le client du projet : sa fiche, ou celle de son lead converti. */
  public readonly clientId = computed(
    () => this.project()?.customerEntityId ?? this.lead()?.convertedToCustomerId ?? null,
  );
  public readonly personName = computed(
    () =>
      this.lead()?.fullName?.trim() ||
      [this.lead()?.firstName, this.lead()?.lastName].filter(Boolean).join(' ') ||
      this.client()?.displayName?.trim() ||
      '—',
  );
  private readonly _productOptions = computed(() => [
    ...(this.project()?.customerEntityId ? [] : [{ value: '', label: 'À préciser' }]),
    ...this._products().map((p) => ({ value: p.label, label: p.label })),
  ]);

  /** Le projet est gagné et peut encore ouvrir son contrat : la clôture a pu échouer en silence. */
  public readonly canOpenHolding = computed(
    () => this._canManage() && this.project()?.stage === 'ClosedWon' && !this.holdingId(),
  );

  /** La dernière version de son parcours, quand le projet en suit une plus ancienne et est encore ouvert. */
  public readonly newerTemplateVersion = computed(() => {
    const p = this.project();
    if (!p || isClosed(p) || !p.templateVersion || !p.latestTemplateVersion) return null;
    return p.latestTemplateVersion > p.templateVersion ? p.latestTemplateVersion : null;
  });

  /** L'écriture que la colonne de droite reçoit : celle de la page, avec sa relecture et ses refus. */
  public readonly update: ProjectUpdate = (patch, success) => this._update(patch, success);

  public loseModel = signal(LoseFormModel.instantiate());
  public loseForm = form(this.loseModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    minLength(schema.reason, 3, { message: 'Précisez le motif' });
    maxLength(schema.reason, 500, { message: 'Le motif ne peut pas dépasser 500 caractères' });
  });

  public ngOnInit(): void {
    this._route.paramMap.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((params) => {
      this.projectId.set(params.get('projectId') ?? '');
      this.isLoading.set(true);
      this.load();
    });
  }

  public load(): void {
    this.loadError.set(null);
    this._api
      .getOpportunity(this.projectId())
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.loadError.set(error.status === 404 ? "Ce projet n'existe pas ou ne vous est pas accessible." : 'Le projet n’a pas pu être chargé.');
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe((project) => {
        this.project.set(project);
        this.isLoading.set(false);
        this._breadcrumb.set([{ label: 'Projets', link: ['/leads/projets'] }, { label: project.title ?? 'Projet' }]);
        this._loadPerson(project);
        this._loadValidations(project);
        // Arrivée depuis « Remplir les questionnaires » d'un autre écran.
        if (this._route.snapshot.fragment === 'questionnaires') setTimeout(() => this.scrollTo('questionnaires'));
      });
  }

  /** Le lead derrière le projet, sinon le client : pour le nom, les liens et la conversion. */
  private _loadPerson(project: OpportunityDto): void {
    const lead$: Observable<LeadDto | null> = project.leadId
      ? this._leadsApi.getLead(project.leadId).pipe(catchError(() => of(null)))
      : of(null);
    lead$.subscribe((lead) => {
      this.lead.set(lead);
      if (!lead && project.customerEntityId) {
        this._clientsApi.getClient(project.customerEntityId).pipe(catchError(() => of(null))).subscribe((c) => this.client.set(c));
      }
    });
  }

  /** Lue à part : un moteur de validation qui ne répond pas ne doit pas empêcher d'ouvrir le projet. */
  private _loadValidations(project: OpportunityDto): void {
    if (!project.id || !(project.workflowRuns ?? []).length) {
      this.validations.set([]);
      return;
    }
    this._api
      .getProjectValidations(project.id)
      .pipe(catchError(() => of([] as ProjectValidationDto[])))
      .subscribe((list) => this.validations.set(list ?? []));
  }

  public scrollTo(id: 'questionnaires' | 'validations' | 'exit-conditions' | 'fields'): void {
    const target =
      id === 'fields'
        ? (document.getElementById('project-fields') ?? document.getElementById('project-files'))
        : document.getElementById(id);
    target?.scrollIntoView({ behavior: 'smooth', block: id === 'exit-conditions' ? 'center' : 'start' });
  }

  // ——— Refus d'étape ———

  /** Depuis un refus « montant obligatoire » : le tiroir s'ouvre, le curseur sur le montant. */
  public fixAmount(): void {
    this.editInfo('amount');
  }

  /** La clôture prévue est dans la colonne de droite : on l'y ouvre, on la montre, on y place le curseur. */
  public fixCloseDate(): void {
    this._summary()?.editCloseDate();
    setTimeout(() => {
      const host = document.getElementById('exit-date');
      host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      host?.querySelector<HTMLInputElement>('tas-date-picker input')?.focus({ preventScroll: true });
    });
  }

  /** Une valeur ou un fichier enregistré peut lever le refus « champs à renseigner ». */
  public onFieldsChanged(): void {
    if (this.gate()?.code === 'PROJECT_FIELDS_REQUIRED') this.gate.set(null);
    this.load();
  }

  /** Une réponse enregistrée peut lever le refus d'étape affiché. */
  public onQuestionnairesChanged(): void {
    if (this.gate()?.code === 'PROJECT_QUESTIONNAIRES_INCOMPLETE') this.gate.set(null);
  }

  /**
   * Les champs encore vides que l'étape visée (ou le gain) exige, jusqu'à elle comprise : le
   * serveur ne renvoie qu'un code, la page a le projet en main pour les nommer.
   */
  private _missingFields(p: OpportunityDto): string[] {
    const steps = p.steps ?? [];
    const index = this._target ? steps.findIndex((s) => s.label === this._target) : steps.length - 1;
    const keys = new Set(steps.slice(0, index + 1).flatMap((s) => s.requiredFieldKeys ?? []));
    const values = (p.customFields ?? {}) as Record<string, unknown>;
    const withFiles = new Set((p.attachments ?? []).map((a) => a.fieldKey));
    return (p.fields ?? [])
      .filter((f) => keys.has(f.key ?? ''))
      .filter((f) => {
        if (f.type === 'Attachment') return !withFiles.has(f.key);
        const v = values[f.key ?? ''];
        return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
      })
      .map((f) => f.label ?? f.key ?? '');
  }

  // ——— Étapes ———

  /** Ce que l'agent tentait quand l'étape a été refusée : rejoué une fois le dossier client ouvert. */
  private _retry: (() => void) | null = null;

  public moveTo(step: ProjectStepDto): void {
    const p = this.project();
    if (!p || !this.canManage() || this.current()?.id === step.id || this.busy() || !hasTemplateSteps(p)) return;
    this._target = step.label ?? null;
    this._retry = () => this.moveTo(step);
    void this._run(
      this._api.moveOpportunityToStep(p.id!, { stepId: step.id!, expectedUpdatedAt: p.updatedAt ?? null }),
      `Étape : ${step.label} · probabilité ${step.probability} %`,
    );
  }

  public toggleChecklistItem(itemId: string, done: boolean): void {
    const p = this.project();
    if (!p?.id || this.busy()) return;
    void this._run(this._api.setProjectChecklistItem(p.id, itemId, { done }), done ? 'Point coché' : 'Point décoché');
  }

  public restartWorkflow(): void {
    const p = this.project();
    if (!p?.id || this.busy()) return;
    void this._run(this._api.restartProjectWorkflow(p.id), 'Circuit de validation relancé');
  }

  /**
   * L'assistant d'ouverture du dossier client de la fiche lead ; l'étape refusée est ensuite
   * rejouée sur le projet relu — et si c'était l'approbation, le lead devient client.
   */
  public convertForGate(): void {
    const lead = this.lead();
    if (!lead) return;
    const retry = this._retry;
    const ref = this._sideDrawer.open(ConvertLeadWizard, {
      panelClass: 'side-drawer-panel',
      data: { lead, projectId: this.projectId() },
    });
    ref.closed.subscribe((result: unknown) => {
      if (!result) return;
      this.gate.set(null);
      this._snackbar.success('Dossier client ouvert', 'Le projet reprend là où il était bloqué.');
      // Relu d'abord : l'ouverture du dossier a rattaché le projet au client et changé sa date.
      this._api.getOpportunity(this.projectId()).pipe(catchError(() => EMPTY)).subscribe((fresh) => {
        this.project.set(fresh);
        if (retry) retry();
        else this.load();
      });
    });
  }

  // ——— Informations ———

  public editInfo(focus?: 'amount'): void {
    const project = this.project();
    if (!project) return;
    this._sideDrawer.open<boolean, EditProjectInfoDrawerData, EditProjectInfoDrawer>(EditProjectInfoDrawer, {
      data: {
        project,
        productOptions: this._productOptions(),
        amountLabel: projectAmountLabel(project.amountKind),
        save: (patch) => this._update(patch, 'Projet mis à jour'),
        focus,
      },
    });
  }

  // ——— Parcours ———

  /**
   * Fait passer le projet à la dernière version de son parcours (propriétaire, 2026-10-26 : sur
   * demande, jamais en modifiant le gabarit). Il garde son étape si elle existe encore, sinon il
   * prend celle de sa phase ; les conditions de la nouvelle version valent pour les étapes suivantes.
   */
  public followLatestTemplateVersion(latest: number): void {
    const p = this.project();
    if (!p?.id) return;
    this._confirm.confirm({
      title: `Passer à la version ${latest} ?`,
      message:
        `« ${p.title} » suivra les étapes, conditions et champs de la version ${latest} du parcours. ` +
        `Il reste sur son étape si elle existe encore, sinon sur celle de sa phase. Ce choix est définitif.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: `Passer à la version ${latest}`, theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.busy.set(true);
        this._api
          .followLatestProjectTemplateVersion(p.id!)
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const code = String((error.error as { error?: string } | null)?.error ?? '');
              this._snackbar.error(
                'Version inchangée',
                code === 'PROJECT_TEMPLATE_VERSION_ALREADY_LATEST'
                  ? 'Le projet suit déjà la dernière version : rechargez la page.'
                  : code === 'OPPORTUNITY_ALREADY_CLOSED'
                    ? 'Le projet est clos : son parcours ne change plus.'
                    : 'Le projet n’a pas pu changer de version.',
              );
              this.busy.set(false);
              return EMPTY;
            }),
          )
          .subscribe(() => {
            this.busy.set(false);
            this._snackbar.success('Parcours mis à jour', `Le projet suit la version ${latest}.`);
            this.load();
          });
      },
    });
  }

  // ——— Issue ———

  public markWon(): void {
    const p = this.project();
    if (!p) return;
    this._confirm.confirm({
      title: 'Marquer ce projet gagné ?',
      message: `« ${p.title} » sera clos comme gagné. Il ne pourra plus changer d'étape.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Marquer gagné', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._win(),
    });
  }

  private _win(): void {
    const p = this.project();
    if (!p) return;
    this._target = null;
    this._retry = () => this._win();
    void this._run(
      this._api
        .closeOpportunity(p.id!, { outcome: CloseOpportunityRequestOutcomeEnum.ClosedWon, expectedUpdatedAt: p.updatedAt ?? null })
        .pipe(map((r) => this.holdingId.set(r?.holdingId ?? null))),
      'Projet gagné',
    );
  }

  /**
   * Ouvre — ou retrouve — le contrat du projet gagné. La clôture tente la même ouverture mais tait
   * un échec pour ne pas défaire la vente ; sans ce bouton, un projet d'assurance gagné sans
   * contrat n'avait plus aucun chemin vers une souscription (aucun contrat ne s'ouvre depuis la fiche client).
   */
  public openHolding(): void {
    const p = this.project();
    if (!p?.id) return;
    this.busy.set(true);
    this._api
      .openProjectHolding(p.id)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Contrat non ouvert', holdingOpenErrorMessage(error));
          this.busy.set(false);
          return EMPTY;
        }),
      )
      .subscribe((r) => {
        this.busy.set(false);
        this.holdingId.set(r?.holdingId ?? null);
        // Le projet n'a pas changé — seul l'historique a une ligne de plus.
        this._history()?.load();
        this._snackbar.success('Contrat ouvert', 'Le contrat est en brouillon dans les contrats du client.');
      });
  }

  public startLose(): void {
    this.loseForm().reset(LoseFormModel.instantiate());
    this.losing.set(true);
  }

  public confirmLose(): void {
    const p = this.project();
    if (!p) return;
    submit(this.loseForm, async (field) => {
      await this._run(
        this._api.closeOpportunity(p.id!, {
          outcome: CloseOpportunityRequestOutcomeEnum.ClosedLost,
          reason: field().value().reason.trim(),
          expectedUpdatedAt: p.updatedAt ?? null,
        }),
        'Projet perdu',
      );
    });
  }

  // ——— Écritures ———

  private _update(patch: UpdateOpportunityRequest, success: string): Promise<boolean> {
    const p = this.project();
    if (!p) return Promise.resolve(false);
    return this._run(this._api.updateOpportunity(p.id!, { ...patch, expectedUpdatedAt: p.updatedAt ?? null }), success);
  }

  /** Une écriture, puis la relecture : le jeton de concurrence (`updatedAt`) est périmé dès la réponse. */
  private async _run(call: Observable<unknown>, success: string): Promise<boolean> {
    this.busy.set(true);
    const done = await firstValueFrom(
      call.pipe(
        map(() => true),
        catchError((error: HttpErrorResponse) => {
          const code = projectGateCode(error);
          if (code) {
            const missing = code === 'PROJECT_FIELDS_REQUIRED' && this.project() ? this._missingFields(this.project()!) : [];
            const message = projectGateMessage(code, this._target);
            this.gate.set({ code, message: missing.length ? `${message.replace(/\.$/, '')} : ${missing.join(', ')}.` : message });
          } else {
            this._snackbar.error('Erreur', this._errorMessage(error));
          }
          return EMPTY;
        }),
      ),
      { defaultValue: false },
    );
    this.busy.set(false);
    if (!done) return false;
    this.gate.set(null);
    this.losing.set(false);
    this._snackbar.success(success, '');
    this.load();
    return true;
  }

  private _errorMessage(error: HttpErrorResponse): string {
    if (error.status === 409) return 'Modifié entre-temps par quelqu’un d’autre. Rechargez avant de réessayer.';
    if (error.status === 403) return "Vous n'avez pas le droit de modifier ce projet.";
    const validation = error.error?.errors as Record<string, string[]> | undefined;
    return (validation && Object.values(validation).flat()[0]) || projectSaveErrorMessage(error, "Impossible d'enregistrer la modification.");
  }

  public back(): void {
    void this._router.navigate(['/leads/projets']);
  }
}

function holdingOpenErrorMessage(error: HttpErrorResponse): string {
  const code = String(error.error?.error ?? error.error?.detail ?? '');
  switch (code) {
    case 'OPPORTUNITY_NO_CLIENT':
      return "Ce projet n'est rattaché à aucun client : ouvrez d'abord le dossier client.";
    case 'OPPORTUNITY_PRODUCT_NOT_IN_CATALOGUE':
      return "Le produit du projet ne correspond à aucun produit actif du catalogue.";
    case 'OPPORTUNITY_NOT_WON':
      return "Seul un projet gagné ouvre un contrat.";
    case 'HOLDING_ALREADY_HELD':
      return "Le client détient déjà ce produit et il n'autorise pas un second contrat.";
    case 'PRODUCT_LINE_UNAVAILABLE':
      return 'Le catalogue est momentanément indisponible. Réessayez dans un instant.';
    default:
      return "Le contrat n'a pas pu être ouvert.";
  }
}

export default ProjectDetail;
