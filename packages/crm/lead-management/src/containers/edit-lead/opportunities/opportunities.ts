import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, FormRoot, maxLength, minLength, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, firstValueFrom, map, Observable } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import {
  CloseOpportunityRequestOutcomeEnum,
  FormFieldReferenceTargetEnum,
  LeadsApiService,
  OpportunitiesApiService,
  OpportunityDto,
  UpdateOpportunityRequest,
} from '@sankore/crm-api';
import { EntityFormReferences, PermissionsService } from '@sankore/crm/common';
import { interestedProductLabel } from '../../../components/interested-product';
import { ConvertedLeadNotice } from '../converted-lead-notice';
import { LeadEditContext } from '../lead-edit-context';
import { formatAmount, formatDay } from '../lead-view.models';
import { CreateOpportunityDrawer, CreateOpportunityDrawerData } from './create-opportunity-drawer';
import {
  closeDateLabel,
  closeDateWarning,
  differsFromLead,
  isClosed,
  monthsFromNow,
  OPEN_STAGES,
  probabilityPercent,
  StageMeta,
  stageLabel,
  stageMeta,
  toStageRequest,
  weightedAmount,
} from './opportunity.model';

/** La prochaine action d'une opportunité, en cours de saisie. */
class NextStepFormModel {
  public text!: string;
  public dueOn!: string;

  public static fromOpportunity(opp: OpportunityDto | null): NextStepFormModel {
    const m = new NextStepFormModel();
    m.text = opp?.nextStep ?? '';
    m.dueOn = opp?.nextStepDueOn ?? '';
    return m;
  }
}

class CloseDateFormModel {
  public date!: string;

  public static fromOpportunity(opp: OpportunityDto | null): CloseDateFormModel {
    const m = new CloseDateFormModel();
    m.date = opp?.expectedCloseDate?.slice(0, 10) ?? '';
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

type Editor = { id: string; kind: 'nextStep' | 'closeDate' | 'lose' };

/**
 * Onglet « Opportunités » de la fiche lead : ce que le prospect pourrait signer, où en est chaque
 * affaire, et ce qu'il reste à faire pour la conclure.
 *
 * Une liste d'entités du serveur, donc une `tas-table` — chaque ligne est une carte, sur une seule
 * cellule, comme les autres listes « en cartes » du projet.
 */
@Component({
  selector: 'lead-opportunities',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './opportunities.html',
  imports: [
    FormRoot,
    FormField,
    TasCard,
    TasIcon,
    TasInput,
    TasFormField,
    TasLabel,
    TasError,
    TasSpinner,
    TasTable,
    Button,
    ConvertedLeadNotice,
  ],
})
export class LeadOpportunitiesPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _context = inject(LeadEditContext);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  // Un lead converti est figé : l'état est replié dans la garde de droits que le template lit.
  private readonly _canManage = this._permissions.can('lead:opportunity:manage');
  private readonly _canUpdateLead = this._permissions.can('lead:update');
  public readonly canManage = computed(() => this._canManage() && !this._context.isReadOnly());
  public readonly canAlignLead = computed(() => this._canUpdateLead() && !this._context.isReadOnly());

  public readonly lead = this._context.lead;
  public readonly stages = OPEN_STAGES;
  public readonly formatAmount = formatAmount;
  public readonly formatDay = formatDay;
  public readonly stageLabel = stageLabel;
  public readonly probabilityPercent = probabilityPercent;
  public readonly weightedAmount = weightedAmount;
  public readonly closeDateLabel = closeDateLabel;
  public readonly closeDateWarning = closeDateWarning;
  public readonly isClosed = isClosed;

  public readonly tableConfig: TableConfig = {
    property: 'lead-opportunities',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25] },
  };

  public readonly opportunities = signal<OpportunityDto[]>([]);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);
  public readonly busyId = signal<string | null>(null);
  public readonly showClosed = signal(false);
  public readonly editor = signal<Editor | null>(null);

  private readonly _users = toSignal(
    this._references.options(FormFieldReferenceTargetEnum.User).pipe(
      map((options) => new Map(options.map((o) => [o.value, o.label] as const))),
    ),
    { initialValue: new Map<string, string>() },
  );

  public readonly openOpportunities = computed(() => this.opportunities().filter((o) => !isClosed(o)));
  public readonly closedOpportunities = computed(() => this.opportunities().filter((o) => isClosed(o)));
  public readonly visible = computed(() =>
    this.showClosed() ? this.opportunities() : this.openOpportunities(),
  );

  /** Les totaux portent sur les affaires ouvertes : une affaire gagnée ou perdue n'est plus un potentiel. */
  public readonly totalAmount = computed(() =>
    this.openOpportunities().reduce((sum, o) => sum + (o.estimatedAmount?.amount ?? 0), 0),
  );
  public readonly totalWeighted = computed(() =>
    this.openOpportunities().reduce((sum, o) => sum + weightedAmount(o), 0),
  );

  /** La première opportunité ouverte dont le montant contredit celui du lead, sans réponse encore. */
  public readonly mismatch = computed(() => {
    const leadAmount = this.lead()?.desiredAmount?.amount;
    return this.openOpportunities().find((o) => differsFromLead(o, leadAmount)) ?? null;
  });
  public readonly leadProductLabel = computed(
    () => interestedProductLabel(this.lead()?.interestedProduct)?.toLowerCase() ?? 'un besoin',
  );

  public nextStepModel = signal(NextStepFormModel.fromOpportunity(null));
  public nextStepForm = form(this.nextStepModel, (schema) => {
    required(schema.text, { message: "Décrivez l'action à mener" });
    maxLength(schema.text, 200, { message: "L'action ne peut pas dépasser 200 caractères" });
  });

  public closeDateModel = signal(CloseDateFormModel.fromOpportunity(null));
  public closeDateForm = form(this.closeDateModel, (schema) => {
    required(schema.date, { message: 'Choisissez une date' });
  });

  public loseModel = signal(LoseFormModel.instantiate());
  public loseForm = form(this.loseModel, (schema) => {
    required(schema.reason, { message: 'Le motif est obligatoire' });
    minLength(schema.reason, 3, { message: 'Précisez le motif' });
    maxLength(schema.reason, 500, { message: 'Le motif ne peut pas dépasser 500 caractères' });
  });

  constructor() {
    effect(() => {
      const id = this.lead()?.id;
      if (id) untracked(() => this._load(id));
    });
  }

  // ——— Lecture ———

  public stageMetaOf(opp: OpportunityDto): StageMeta | null {
    return stageMeta(opp.stage);
  }

  /** L'étape courante et celles déjà franchies, pour la barre de chaque case de la frise. */
  public stageIndex(opp: OpportunityDto): number {
    return OPEN_STAGES.findIndex((s) => s.value === opp.stage);
  }

  public ownerName(opp: OpportunityDto): string | null {
    return opp.ownerId ? this._users().get(opp.ownerId) ?? null : null;
  }

  public isEditing(opp: OpportunityDto, kind: Editor['kind']): boolean {
    const editor = this.editor();
    return !!editor && editor.id === opp.id && editor.kind === kind;
  }

  // ——— Création ———

  public openCreateDrawer(): void {
    const lead = this.lead();
    if (!lead) return;
    const ref = this._sideDrawer.open<string | false, CreateOpportunityDrawerData, CreateOpportunityDrawer>(
      CreateOpportunityDrawer,
      { width: '100%', height: '100%', panelClass: 'side-drawer-panel', data: { lead } },
    );
    ref.closed.subscribe((id) => {
      if (id) this._load(lead.id!);
    });
  }

  // ——— Étapes ———

  public moveTo(opp: OpportunityDto, stage: StageMeta): void {
    if (!this.canManage() || opp.stage === stage.value || this.busyId()) return;
    this._run(
      opp,
      this._opportunitiesApi.advanceOpportunityStage(opp.id!, {
        stage: toStageRequest(stage.value),
        expectedUpdatedAt: opp.updatedAt ?? null,
      }),
      `Étape : ${stage.label} · probabilité ${stage.probability} %`,
    );
  }

  // ——— Clôture prévue ———

  public setCloseInMonths(opp: OpportunityDto, months: number): void {
    this._update(opp, { expectedCloseDate: monthsFromNow(months) }, 'Clôture prévue mise à jour');
  }

  public editCloseDate(opp: OpportunityDto): void {
    this.closeDateForm().reset(CloseDateFormModel.fromOpportunity(opp));
    this.editor.set({ id: opp.id!, kind: 'closeDate' });
  }

  public saveCloseDate(opp: OpportunityDto): void {
    submit(this.closeDateForm, async (field) => {
      await this._updateAsync(opp, { expectedCloseDate: `${field().value().date}T12:00:00Z` }, 'Clôture prévue mise à jour');
    });
  }

  // ——— Prochaine étape ———

  public useSuggestion(opp: OpportunityDto, suggestion: string): void {
    this._update(opp, { nextStep: suggestion }, 'Prochaine étape définie');
  }

  public editNextStep(opp: OpportunityDto): void {
    this.nextStepForm().reset(NextStepFormModel.fromOpportunity(opp));
    this.editor.set({ id: opp.id!, kind: 'nextStep' });
  }

  public saveNextStep(opp: OpportunityDto): void {
    submit(this.nextStepForm, async (field) => {
      const value = field().value();
      await this._updateAsync(
        opp,
        { nextStep: value.text.trim(), nextStepDueOn: value.dueOn || null },
        'Prochaine étape définie',
      );
    });
  }

  /** « Fait » : l'action est menée, la case redevient « Non définie » pour la suivante. */
  public clearNextStep(opp: OpportunityDto): void {
    this._update(opp, { nextStep: '' }, 'Prochaine étape faite');
  }

  // ——— Deux demandes différentes ? ———

  /** C'est la même demande, réévaluée : le lead prend le montant de l'opportunité. */
  public alignLead(opp: OpportunityDto): void {
    const lead = this.lead();
    const amount = opp.estimatedAmount?.amount;
    if (!lead?.id || amount == null) return;
    this.busyId.set(opp.id!);
    this._leadsApi.updateLead(lead.id, {
      desiredAmount: amount,
      desiredCurrency: opp.estimatedAmount?.currency ?? 'XOF',
      expectedUpdatedAt: lead.updatedAt ?? null,
    }).pipe(
      catchError((error: HttpErrorResponse) => {
        this.busyId.set(null);
        this._snackbar.error('Erreur', this._errorMessage(error, 'Impossible de mettre le lead à jour.'));
        return EMPTY;
      }),
    ).subscribe(() => {
      this.busyId.set(null);
      this._snackbar.success('Lead mis à jour', `Le lead porte désormais sur ${formatAmount(amount, 'XOF')}.`);
      this._context.reload();
    });
  }

  public confirmSeparateNeed(opp: OpportunityDto): void {
    this._update(opp, { confirmSeparateNeed: true }, 'Noté : ce sont deux besoins distincts');
  }

  // ——— Gagnée, perdue ———

  public markWon(opp: OpportunityDto): void {
    this._confirm.confirm({
      title: 'Marquer cette opportunité gagnée ?',
      message: `« ${opp.title} » sera close comme gagnée. Elle ne pourra plus changer d'étape.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Marquer gagnée', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this._run(
          opp,
          this._opportunitiesApi.closeOpportunity(opp.id!, {
            outcome: CloseOpportunityRequestOutcomeEnum.ClosedWon,
            expectedUpdatedAt: opp.updatedAt ?? null,
          }),
          'Opportunité gagnée',
        );
      },
    });
  }

  public startLose(opp: OpportunityDto): void {
    this.loseForm().reset(LoseFormModel.instantiate());
    this.editor.set({ id: opp.id!, kind: 'lose' });
  }

  public confirmLose(opp: OpportunityDto): void {
    submit(this.loseForm, async (field) => {
      await this._runAsync(
        opp,
        this._opportunitiesApi.closeOpportunity(opp.id!, {
          outcome: CloseOpportunityRequestOutcomeEnum.ClosedLost,
          reason: field().value().reason.trim(),
          expectedUpdatedAt: opp.updatedAt ?? null,
        }),
        'Opportunité perdue',
      );
    });
  }

  public cancelEditor(): void {
    this.editor.set(null);
  }

  public retry(): void {
    const id = this.lead()?.id;
    if (id) this._load(id);
  }

  // ——— Plomberie ———

  private _update(opp: OpportunityDto, patch: UpdateOpportunityRequest, success: string): void {
    void this._updateAsync(opp, patch, success);
  }

  private _updateAsync(opp: OpportunityDto, patch: UpdateOpportunityRequest, success: string): Promise<void> {
    return this._runAsync(
      opp,
      this._opportunitiesApi.updateOpportunity(opp.id!, { ...patch, expectedUpdatedAt: opp.updatedAt ?? null }),
      success,
    );
  }

  private _run(opp: OpportunityDto, call: Observable<unknown>, success: string): void {
    void this._runAsync(opp, call, success);
  }

  /**
   * Une écriture, puis la relecture de la liste : chaque opportunité porte son propre jeton de
   * concurrence (`updatedAt`), périmé dès que le serveur a répondu.
   */
  private async _runAsync(opp: OpportunityDto, call: Observable<unknown>, success: string): Promise<void> {
    this.busyId.set(opp.id!);
    const done = await firstValueFrom(
      call.pipe(
        map(() => true),
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Erreur', this._errorMessage(error, "Impossible d'enregistrer la modification."));
          return EMPTY;
        }),
      ),
      { defaultValue: false },
    );
    this.busyId.set(null);
    if (!done) return;
    this.editor.set(null);
    this._snackbar.success(success, '');
    this._load(this.lead()!.id!);
  }

  private _load(leadId: string): void {
    this.loadFailed.set(false);
    this._opportunitiesApi.listOpportunities(leadId).pipe(
      catchError(() => {
        this.isLoading.set(false);
        this.loadFailed.set(true);
        return EMPTY;
      }),
    ).subscribe((items) => {
      this.opportunities.set(items ?? []);
      this.isLoading.set(false);
    });
  }

  private _errorMessage(error: HttpErrorResponse, fallback: string): string {
    if (error.status === 409) return 'Modifiée entre-temps par quelqu’un d’autre. Rechargez avant de réessayer.';
    if (error.status === 403) return "Vous n'avez pas le droit de modifier cette opportunité.";
    const validation = error.error?.errors as Record<string, string[]> | undefined;
    return (validation && Object.values(validation).flat()[0]) || error.error?.detail || error.error?.title || fallback;
  }
}

export default LeadOpportunitiesPage;
