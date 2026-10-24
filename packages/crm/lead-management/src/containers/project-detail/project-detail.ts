import { DatePipe, LowerCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { form, FormField, FormRoot, maxLength, minLength, required, submit, validate } from '@angular/forms/signals';
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
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { ConvertLeadWizard } from '../edit-lead/convert-lead-wizard';
import { formatAmount, formatDay } from '../edit-lead/lead-view.models';
import {
  closeDateLabel,
  closeDateWarning,
  currentStep,
  hasTemplateSteps,
  isClosed,
  monthsFromNow,
  probabilityPercent,
  projectSteps,
  stageMeta,
  stepLabel,
  stepSuggestion,
  weightedAmount,
} from '../edit-lead/opportunities/opportunity.model';
import { ProjectQuestionnaires } from './project-questionnaires';

class InfoFormModel {
  public title!: string;
  public product!: string;
  public description!: string;
  /** En texte, comme l'input le rend : converti à l'envoi. */
  public amount!: string;

  public static from(p: OpportunityDto | null): InfoFormModel {
    const m = new InfoFormModel();
    m.title = p?.title ?? '';
    m.product = p?.product ?? '';
    m.description = p?.description ?? '';
    m.amount = p?.estimatedAmount?.amount ? String(p.estimatedAmount.amount) : '';
    return m;
  }
}

class NextStepFormModel {
  public text!: string;
  public dueOn!: string;

  public static from(p: OpportunityDto | null): NextStepFormModel {
    const m = new NextStepFormModel();
    m.text = p?.nextStep ?? '';
    m.dueOn = p?.nextStepDueOn ?? '';
    return m;
  }
}

class CloseDateFormModel {
  public date!: string;

  public static from(p: OpportunityDto | null): CloseDateFormModel {
    const m = new CloseDateFormModel();
    m.date = p?.expectedCloseDate ? p.expectedCloseDate.slice(0, 10) : '';
    return m;
  }
}

class LoseFormModel {
  public reason!: string;

  public static instantiate(): LoseFormModel {
    const m = new LoseFormModel();
    m.reason = '';
    return m;
  }
}

type Editor = 'info' | 'nextStep' | 'closeDate' | 'lose' | null;

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(',', '.');
  return cleaned ? Number(cleaned) : null;
}

/**
 * Le détail d'un projet : pour qui, sur quel produit et quel parcours, où il en est, ce qu'il
 * reste à faire. Les mêmes écritures que l'onglet Projets du lead — et les mêmes refus du serveur
 * aux étapes marquées (dossier client, approbation), avec l'action qui les lève.
 */
@Component({
  selector: 'project-detail',
  imports: [
    RouterLink, DatePipe, LowerCasePipe, FormRoot, FormField, Anchor, Button, TasCard, TasFormField, TasLabel, TasError,
    TasIcon, TasInput, TasSelect, TasSpinner, ProjectQuestionnaires,
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

  public readonly formatAmount = formatAmount;
  public readonly formatDay = formatDay;
  public readonly closeDateLabel = closeDateLabel;

  public readonly projectId = signal('');
  public readonly project = signal<OpportunityDto | null>(null);
  /** Les circuits de validation lancés par les étapes, et leurs décisions — le plus récent d'abord. */
  public readonly validations = signal<ProjectValidationDto[]>([]);
  public readonly lead = signal<LeadDto | null>(null);
  public readonly client = signal<ClientDetailDto | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  public readonly busy = signal(false);
  public readonly editor = signal<Editor>(null);
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
  public readonly steps = computed(() => (this.project() ? projectSteps(this.project()!) : []));
  public readonly current = computed(() => (this.project() ? currentStep(this.project()!) : null));
  public readonly stepIndex = computed(() => {
    const step = this.current();
    return step ? this.steps().findIndex((s) => s.id === step.id) : -1;
  });
  public readonly statusLabel = computed(() => (this.project() ? stepLabel(this.project()!) : ''));
  public readonly suggestion = computed(() => (this.project() ? stepSuggestion(this.project()!) : null));
  /** Faux pour un parcours vendu au rendez-vous : ni probabilité ni clôture prévue à l'écran. */
  public readonly tracksForecast = computed(() => this.project()?.tracksForecast !== false);
  /** « Montant du crédit », « Prime annuelle »… selon le gabarit. */
  public readonly amountLabel = computed(() => projectAmountLabel(this.project()?.amountKind));
  /** La clôture est une échéance (crédit de campagne) : « Date limite », et dépassée = urgence. */
  public readonly criticalCloseDate = computed(() => !!this.project()?.criticalCloseDate);
  public readonly probability = computed(() => (this.project() ? probabilityPercent(this.project()!) : 0));
  public readonly weighted = computed(() => (this.project() ? weightedAmount(this.project()!) : 0));
  public readonly closeWarning = computed(() => (this.project() ? closeDateWarning(this.project()!) : null));
  /**
   * Ce que l'étape en cours demande avant qu'on la quitte : ses points à cocher, et l'état de son
   * circuit de validation — lancé à l'arrivée, approuvé avant de repartir.
   */
  public readonly exitConditions = computed(() => {
    const step = this.current();
    const project = this.project();
    if (!step || !project || this.closed()) return null;

    const ticked = new Set(project.checkedChecklistItemIds ?? []);
    const checklist = (step.checklist ?? []).map((i) => ({ id: i.id ?? '', label: i.label ?? '', done: ticked.has(i.id ?? '') }));
    const runs = (project.workflowRuns ?? []).filter((r) => r.stepId === step.id);
    const run = runs.length ? runs[runs.length - 1] : null;
    const workflow = step.workflowCircuit
      ? { state: run?.state ?? 'NotStarted', startedAt: run?.startedAt ?? null, runs: runs.length }
      : null;

    if (checklist.length === 0 && !workflow) return null;
    return { checklist, done: checklist.filter((i) => i.done).length, workflow };
  });

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
  public readonly productOptions = computed(() => [
    ...(this.project()?.customerEntityId ? [] : [{ value: '', label: 'À préciser' }]),
    ...this._products().map((p) => ({ value: p.label, label: p.label })),
  ]);

  // ——— Formulaires ———

  public infoModel = signal(InfoFormModel.from(null));
  public infoForm = form(this.infoModel, (schema) => {
    required(schema.title, { message: 'Le titre est obligatoire' });
    maxLength(schema.title, 200, { message: '200 caractères au plus' });
    maxLength(schema.description, 2000, { message: '2 000 caractères au plus' });
    validate(schema.amount, (ctx) => {
      const amount = parseAmount(ctx.value());
      return amount !== null && (Number.isNaN(amount) || amount <= 0)
        ? { kind: 'amount', message: 'Saisissez un montant positif, en chiffres' }
        : null;
    });
  });

  public nextStepModel = signal(NextStepFormModel.from(null));
  public nextStepForm = form(this.nextStepModel, (schema) => {
    required(schema.text, { message: "Décrivez l'action à mener" });
    maxLength(schema.text, 200, { message: "L'action ne peut pas dépasser 200 caractères" });
  });

  public closeDateModel = signal(CloseDateFormModel.from(null));
  public closeDateForm = form(this.closeDateModel, (schema) => {
    required(schema.date, { message: 'Choisissez une date' });
  });

  public loseModel = signal(LoseFormModel.instantiate());
  public loseForm = form(this.loseModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    minLength(schema.reason, 3, { message: 'Précisez le motif' });
    maxLength(schema.reason, 500, { message: 'Le motif ne peut pas dépasser 500 caractères' });
  });

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
   * Depuis un refus « montant obligatoire » : le formulaire s'ouvre plus bas, hors de l'écran —
   * sans défilement, le bouton semblait ne rien faire.
   */
  public fixAmount(): void {
    this.editInfo();
    this._reveal('project-info', 'input[inputmode="numeric"]');
  }

  public fixCloseDate(): void {
    this.editCloseDate();
    this._reveal('exit-date', 'input[type="date"]');
  }

  /** Après le rendu du formulaire ouvert : le montre et y place le curseur. */
  private _reveal(id: string, field: string): void {
    setTimeout(() => {
      const host = document.getElementById(id);
      host?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      host?.querySelector<HTMLInputElement>(field)?.focus({ preventScroll: true });
    });
  }

  /** Libellé et couleur d'un statut de circuit ou de décision, tels que le moteur les nomme. */
  public validationStatus(status: string | null | undefined): { label: string; tone: string; icon: string } {
    switch (status) {
      case 'Completed':
      case 'Approved':
        return { label: 'Approuvé', tone: 'text-primary', icon: 'feather:check-circle' };
      case 'Rejected':
        return { label: 'Refusé', tone: 'text-red-700', icon: 'feather:x-circle' };
      case 'Cancelled':
        return { label: 'Annulé', tone: 'text-slate-500', icon: 'feather:slash' };
      case 'TimedOut':
        return { label: 'Délai dépassé', tone: 'text-red-700', icon: 'feather:alert-circle' };
      case 'Skipped':
        return { label: 'Sans objet', tone: 'text-slate-400', icon: 'feather:minus-circle' };
      case 'Unknown':
        return { label: 'Illisible', tone: 'text-amber-700', icon: 'feather:help-circle' };
      default:
        return { label: 'En attente', tone: 'text-amber-700', icon: 'feather:clock' };
    }
  }

  public scrollToValidations(): void {
    document.getElementById('validations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  public scrollToExitConditions(): void {
    document.getElementById('exit-conditions')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  public scrollToQuestionnaires(): void {
    document.getElementById('questionnaires')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Une réponse enregistrée peut lever le refus d'étape affiché. */
  public onQuestionnairesChanged(): void {
    if (this.gate()?.code === 'PROJECT_QUESTIONNAIRES_INCOMPLETE') this.gate.set(null);
  }

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
        // Arrivée depuis « Remplir les questionnaires » d'un autre écran : la section est en bas.
        if (this._route.snapshot.fragment === 'questionnaires') setTimeout(() => this.scrollToQuestionnaires());
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

  public phaseLabel(phase: string | null | undefined): string {
    return stageMeta(phase)?.label ?? '';
  }

  public isCurrent(step: ProjectStepDto): boolean {
    return this.current()?.id === step.id;
  }

  // ——— Étapes ———

  /** Ce que l'agent tentait quand l'étape a été refusée : rejoué une fois le dossier client ouvert. */
  private _retry: (() => void) | null = null;

  public moveTo(step: ProjectStepDto): void {
    const p = this.project();
    if (!p || !this.canManage() || this.isCurrent(step) || this.busy() || !hasTemplateSteps(p)) return;
    this._target = step.label ?? null;
    this._retry = () => this.moveTo(step);
    void this._run(
      this._api.moveOpportunityToStep(p.id!, { stepId: step.id!, expectedUpdatedAt: p.updatedAt ?? null }),
      `Étape : ${step.label} · probabilité ${step.probability} %`,
    );
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

  public editInfo(): void {
    this.infoModel.set(InfoFormModel.from(this.project()));
    this.infoForm().reset();
    this.editor.set('info');
  }

  public saveInfo(): void {
    submit(this.infoForm, async (field) => {
      const v = field().value();
      const amount = parseAmount(v.amount);
      await this._update(
        {
          title: v.title.trim(),
          product: v.product,
          description: v.description.trim(),
          ...(amount !== null ? { estimatedAmount: amount, estimatedCurrency: this.project()?.estimatedAmount?.currency ?? 'XOF' } : {}),
        },
        'Projet mis à jour',
      );
    });
  }

  // ——— Clôture prévue ———

  public setCloseInMonths(months: number): void {
    void this._update({ expectedCloseDate: monthsFromNow(months) }, 'Clôture prévue mise à jour');
  }

  public editCloseDate(): void {
    this.closeDateModel.set(CloseDateFormModel.from(this.project()));
    this.closeDateForm().reset();
    this.editor.set('closeDate');
  }

  public saveCloseDate(): void {
    submit(this.closeDateForm, async (field) => {
      await this._update({ expectedCloseDate: `${field().value().date}T12:00:00Z` }, 'Clôture prévue mise à jour');
    });
  }

  // ——— Prochaine étape ———

  public useSuggestion(text: string): void {
    void this._update({ nextStep: text }, 'Prochaine étape définie');
  }

  public editNextStep(): void {
    this.nextStepModel.set(NextStepFormModel.from(this.project()));
    this.nextStepForm().reset();
    this.editor.set('nextStep');
  }

  public saveNextStep(): void {
    submit(this.nextStepForm, async (field) => {
      const v = field().value();
      await this._update({ nextStep: v.text.trim(), nextStepDueOn: v.dueOn || null }, 'Prochaine étape définie');
    });
  }

  public clearNextStep(): void {
    void this._update({ nextStep: '' }, 'Prochaine étape faite');
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

  public startLose(): void {
    this.loseForm().reset(LoseFormModel.instantiate());
    this.editor.set('lose');
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

  public cancelEditor(): void {
    this.editor.set(null);
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
            this.gate.set({ code, message: projectGateMessage(code, this._target) });
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
    this.editor.set(null);
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

export default ProjectDetail;
