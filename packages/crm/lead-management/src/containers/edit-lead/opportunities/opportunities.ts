import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, EMPTY, map } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { FormFieldReferenceTargetEnum, LeadsApiService, OpportunitiesApiService, OpportunityDto } from '@sankore/crm-api';
import { EntityFormReferences, PermissionsService, projectAmountLabel, projectSaveErrorMessage } from '@sankore/crm/common';
import { interestedProductLabel } from '../../../components/interested-product';
import { ConvertedLeadNotice } from '../converted-lead-notice';
import { LeadEditContext } from '../lead-edit-context';
import { formatAmount, formatDay } from '../lead-view.models';
import { CreateOpportunityDrawer, CreateOpportunityDrawerData } from './create-opportunity-drawer';
import {
  closeDateLabel,
  closeDateWarning,
  currentStep,
  differsFromLead,
  isClosed,
  probabilityPercent,
  projectSteps,
  stepLabel,
  tracksForecast,
  weightedAmount,
} from './opportunity.model';

/**
 * Onglet « Projets » de la fiche lead : la LISTE de ce que le prospect pourrait signer — une ligne
 * par projet, qui ouvre sa fiche.
 *
 * Avant, chaque projet était une grande carte avec son avancement complet et ses actions (étape,
 * clôture, prochaine étape, gagné / perdu) : deux projets remplissaient l'écran, et les mêmes
 * actions existaient en double avec la fiche projet. Tout ce qui fait avancer un projet se fait
 * désormais sur sa fiche ; ici, on voit, on compare et on ouvre.
 */
@Component({
  selector: 'lead-opportunities',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './opportunities.html',
  imports: [TasCard, TasIcon, TasSpinner, TasTable, Button, ConvertedLeadNotice],
})
export class LeadOpportunitiesPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _context = inject(LeadEditContext);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _references = inject(EntityFormReferences);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  // Un lead converti est figé : l'état est replié dans la garde de droits que le template lit.
  private readonly _canManage = this._permissions.can('lead:opportunity:manage');
  private readonly _canUpdateLead = this._permissions.can('lead:update');
  public readonly canManage = computed(() => this._canManage() && !this._context.isReadOnly());
  public readonly canAlignLead = computed(() => this._canUpdateLead() && !this._context.isReadOnly());

  public readonly lead = this._context.lead;

  public readonly formatAmount = formatAmount;
  public readonly formatDay = formatDay;
  public readonly stepLabel = stepLabel;
  public readonly probabilityPercent = probabilityPercent;
  public readonly weightedAmount = weightedAmount;
  public readonly tracksForecast = tracksForecast;
  public readonly projectAmountLabel = projectAmountLabel;
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
  public readonly totalsByKind = computed(() => {
    // Par nature de montant : un crédit et un dépôt du même lead ne s'additionnent pas.
    const totals = new Map<string, { kind: string; label: string; amount: number; weighted: number; tracked: boolean }>();
    for (const o of this.openOpportunities()) {
      const kind = o.amountKind ?? 'Generic';
      const t = totals.get(kind) ?? { kind, label: projectAmountLabel(kind), amount: 0, weighted: 0, tracked: false };
      t.amount += o.estimatedAmount?.amount ?? 0;
      if (tracksForecast(o)) {
        t.weighted += weightedAmount(o);
        t.tracked = true;
      }
      totals.set(kind, t);
    }
    return [...totals.values()].filter((t) => t.amount > 0);
  });

  /** La première opportunité ouverte dont le montant contredit celui du lead, sans réponse encore. */
  public readonly mismatch = computed(() => {
    const leadAmount = this.lead()?.desiredAmount?.amount;
    return this.openOpportunities().find((o) => differsFromLead(o, leadAmount)) ?? null;
  });
  public readonly leadProductLabel = computed(
    () => interestedProductLabel(this.lead()?.interestedProduct)?.toLowerCase() ?? 'un besoin',
  );

  constructor() {
    effect(() => {
      const id = this.lead()?.id;
      if (id) untracked(() => this._load(id));
    });
  }

  // ——— Lecture ———

  public ownerName(opp: OpportunityDto): string | null {
    return opp.ownerId ? this._users().get(opp.ownerId) ?? null : null;
  }

  /** « 2 / 5 » : où en est le projet dans son parcours, pour la barre de la ligne. */
  public progress(opp: OpportunityDto): { index: number; total: number; segments: number[] } {
    const steps = projectSteps(opp);
    const step = currentStep(opp);
    return {
      index: step ? steps.findIndex((s) => s.id === step.id) + 1 : 0,
      total: steps.length,
      segments: steps.map((_, i) => i + 1),
    };
  }

  public open(opp: OpportunityDto): void {
    if (opp.id) void this._router.navigate(['/leads/projets', opp.id]);
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
    this.busyId.set(opp.id!);
    this._opportunitiesApi
      .updateOpportunity(opp.id!, { confirmSeparateNeed: true, expectedUpdatedAt: opp.updatedAt ?? null })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this.busyId.set(null);
          this._snackbar.error('Erreur', this._errorMessage(error, "Impossible d'enregistrer la réponse."));
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.busyId.set(null);
        this._snackbar.success('Noté : ce sont deux besoins distincts', '');
        this._load(this.lead()!.id!);
      });
  }

  public retry(): void {
    const id = this.lead()?.id;
    if (id) this._load(id);
  }

  // ——— Plomberie ———

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
    if (error.status === 409) return 'Modifié entre-temps par quelqu’un d’autre. Rechargez avant de réessayer.';
    if (error.status === 403) return "Vous n'avez pas le droit de modifier ce projet.";
    const validation = error.error?.errors as Record<string, string[]> | undefined;
    return (validation && Object.values(validation).flat()[0]) || projectSaveErrorMessage(error, fallback);
  }
}

export default LeadOpportunitiesPage;
