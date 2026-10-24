import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import { catchError, EMPTY, finalize, firstValueFrom, forkJoin, of } from 'rxjs';
import { Anchor, Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { RouterLink } from '@angular/router';
import { PermissionsService, projectGateCode, projectGateMessage } from '@sankore/crm/common';
import {
  LeadDto,
  LeadsApiService,
  OpportunitiesApiService,
  AdvanceOpportunityStageRequestStageEnum,
  CloseOpportunityRequestOutcomeEnum,
  OpportunityDto,
  ProductDto,
  ProductHoldingsApiService,
  ProductsApiService,
  UsersApiService,
} from '@sankore/crm-api';
import { ClientDetailStore } from '../../models/client-detail.store';

/**
 * Étapes d'opportunité du contrat (`OpportunityDto.stage`). Table locale et non
 * partagée : le socle de conformité ne porte que les référentiels du §3 du cahier
 * des charges, et aucune lib commune n'expose encore ce référentiel — le précédent
 * du module Leads est le même, une table par écran (`doublons.ts`).
 */
const STAGE_META: Record<string, { label: string; severity: Severity }> = {
  Prospecting:   { label: 'Prospection',        severity: 'info' },
  Qualification: { label: 'Qualification',      severity: 'info' },
  NeedsAnalysis: { label: 'Étude',              severity: 'warning' },
  Proposal:      { label: 'Proposition',        severity: 'warning' },
  Negotiation:   { label: 'Négociation',        severity: 'warning' },
  ClosedWon:     { label: 'Gagné',              severity: 'success' },
  ClosedLost:    { label: 'Perdu',              severity: 'error' },
};

const CLOSED_STAGES = new Set(['ClosedWon', 'ClosedLost']);

/** Statuts de lead, mêmes libellés que le module Leads (`doublons.ts`). */
const LEAD_STATUS_META: Record<string, { label: string; severity: Severity }> = {
  New:          { label: 'Nouveau',      severity: 'info' },
  Open:         { label: 'Ouvert',       severity: 'info' },
  Qualifying:   { label: 'En cours',     severity: 'warning' },
  Qualified:    { label: 'Qualifié',     severity: 'warning' },
  Nurturing:    { label: 'En maturation', severity: 'info' },
  Recycled:     { label: 'Recyclé',      severity: 'info' },
  Converted:    { label: 'Converti',     severity: 'success' },
  Lost:         { label: 'Perdu',        severity: 'error' },
  Disqualified: { label: 'Disqualifié',  severity: 'error' },
  Archived:     { label: 'Archivé',      severity: 'neutral' },
};

/**
 * Alias d'objet et non interface : `tas-select` déclare `options` en
 * `{ [key: string]: any }[]`, et seul un alias reçoit la signature d'index
 * implicite qui rend l'affectation légale sous `strictTemplates`.
 */
type ProductOption = { label: string; value: string };

/** Une ligne du bloc « Demandes en cours ». */
type DemandeRow = {
  opportunityId: string;
  title: string;
  productLabel: string;
  /** L'étape telle que le contrat la nomme — ce que le sélecteur renvoie et compare. */
  stageValue: string;
  /** L'étape du gabarit du projet, et les étapes qu'il propose ; vides sans gabarit. */
  stepId: string;
  stepOptions: { value: string; label: string }[];
  stageLabel: string;
  stageSeverity: Severity;
  isClosed: boolean;
  isWon: boolean;
  leadId: string | null;
  leadStatusLabel: string | null;
  leadStatusSeverity: Severity;
  ownerLabel: string;
  createdAt: string | null;
  expectedCloseDate: string | null;
  amountLabel: string | null;
  /** Souscription issue de cette demande, quand le rapprochement est possible. */
  holdingId: string | null;
};

class NewDemandeFormModel {
  /**
   * Un seul champ pour la liste déroulante et la saisie libre : le contrat déclare
   * `product` en chaîne libre, et deux champs distincts rendraient le formulaire
   * invalide dès que le référentiel produit n'est pas lisible.
   */
  public product!: string;
  public title!: string;
  public estimatedAmount!: string;
  public estimatedCurrency!: string;
  public expectedCloseDate!: string;
  public description!: string;

  public static instantiate(): NewDemandeFormModel {
    const m = new NewDemandeFormModel();
    m.product = '';
    m.title = '';
    m.estimatedAmount = '';
    m.estimatedCurrency = 'XOF';
    m.expectedCloseDate = '';
    m.description = '';
    return m;
  }
}

/**
 * Onglet « Demandes en cours » de la fiche client (BNF-F-20).
 *
 * Écart assumé avec l'énoncé de l'US, qui parle de « leads ouverts » : le contrat
 * ne permet pas de lister les leads d'un client. `GET /leads` ne porte aucun filtre
 * par client (ni `customerId`, ni `convertedToCustomerId`) et aucun endpoint
 * `clients/{id}/leads` n'existe. Ce que le contrat expose, c'est
 * `GET /leads/opportunities?customerId=`, qui rend exactement les demandes
 * rattachées au client, et `POST /leads/opportunities/for-customer`, qui en crée
 * une déjà rattachée. Le bloc est donc bâti sur les opportunités ; le statut du
 * lead est ajouté par ligne quand la demande en porte un (`OpportunityDto.leadId`).
 */
@Component({
  selector: 'client-demandes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './demandes.html',
  imports: [
    DatePipe,
    RouterLink,
    FormRoot,
    FormField,
    // Les contrôles d'action de ligne (étape, motif de clôture) ne sont pas un formulaire : ils
    // n'ont ni validation ni soumission, et chaque changement EST l'action. `form()` n'aurait
    // rien à y apporter — même exception que les barres de filtres.
    FormsModule,
    TasCard,
    TasIcon,
    TasSpinner,
    TasTable,
    TasTag,
    Button,
    Anchor,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
  ],
})
export class ClientDemandes {
  protected readonly clientStore = inject(ClientDetailStore);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _leadsApi = inject(LeadsApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _permissions = inject(PermissionsService);

  /**
   * Les deux droits catalogués des endpoints d'opportunité. Sans le droit de
   * lecture, l'appel répondrait 403 et le bloc n'afficherait que des erreurs : on
   * le dit, plutôt que de laisser croire que le client n'a aucune demande.
   */
  protected readonly canRead = this._permissions.can('lead:opportunity:read');
  protected readonly canManage = this._permissions.can('lead:opportunity:manage');
  protected readonly canReadLead = this._permissions.can('lead:read');

  protected readonly clientId = computed(() => this.clientStore.clientId() ?? '');

  protected readonly canCreate = computed(
    () => this.canManage() && !this.clientStore.isReadOnly(),
  );

  private readonly _opportunities = signal<OpportunityDto[]>([]);
  private readonly _leadsById = signal<Map<string, LeadDto>>(new Map());
  private readonly _ownerNames = signal<Map<string, string>>(new Map());
  private readonly _holdingIdByLeadId = signal<Map<string, string>>(new Map());
  private readonly _holdingIdByOpportunityId = signal<Map<string, string>>(new Map());

  /** La demande dont une étape ou une clôture est en cours d'envoi. */
  protected readonly busyOpportunityId = signal<string | null>(null);

  /** La demande dont le formulaire de clôture est ouvert, et le motif saisi. */
  protected readonly closingOpportunityId = signal<string | null>(null);
  protected readonly closeReason = signal('');
  private readonly _products = signal<ProductDto[]>([]);
  private _productsRequested = false;

  private readonly _isLoading = signal(true);
  private readonly _loadFailed = signal(false);

  protected readonly isLoading = this._isLoading.asReadonly();
  protected readonly loadFailed = this._loadFailed.asReadonly();

  protected readonly showClosed = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly submitError = signal<string | null>(null);

  /**
   * Dernier doublon signalé par le serveur. `CreateOpportunityForCustomerResult`
   * répond `duplicateDetected` sans rien créer : il faut reposter avec `force`.
   */
  private readonly _duplicateAcknowledged = signal(false);
  protected readonly duplicateWarning = signal<number | null>(null);

  protected readonly productOptions = computed<ProductOption[]>(() =>
    this._products()
      .map((p) => ({ label: p.name?.trim() || p.code?.trim() || '', value: p.name?.trim() || p.code?.trim() || '' }))
      .filter((o) => o.value.length > 0),
  );

  /** Sans référentiel produit lisible, la demande se saisit en texte libre. */
  protected readonly productAsFreeText = computed(() => this.productOptions().length === 0);

  protected readonly rows = computed<DemandeRow[]>(() => {
    const leads = this._leadsById();
    const owners = this._ownerNames();
    const holdingsByLead = this._holdingIdByLeadId();
    const holdingsByOpportunity = this._holdingIdByOpportunityId();

    return this._opportunities().map((o) => {
      const stage = o.stage ?? '';
      const stageMeta = STAGE_META[stage] ?? { label: stage || '—', severity: 'neutral' as Severity };
      const leadId = o.leadId ?? null;
      const lead = leadId ? leads.get(leadId) : undefined;
      const leadMeta = lead?.status ? LEAD_STATUS_META[lead.status] : undefined;
      const amount = o.estimatedAmount?.amount;
      const steps = o.steps ?? [];
      const step = steps.find((s) => s.id === o.currentStepId);

      return {
        opportunityId: o.id ?? '',
        title: o.title?.trim() || 'Projet sans intitulé',
        productLabel: o.product?.trim() || 'Produit non précisé',
        stageValue: stage,
        stepId: step?.id ?? '',
        stepOptions: steps.map((s) => ({ value: s.id ?? '', label: s.label ?? '' })),
        stageLabel: step?.label ?? stageMeta.label,
        stageSeverity: stageMeta.severity,
        isClosed: CLOSED_STAGES.has(stage),
        isWon: stage === 'ClosedWon',
        leadId,
        leadStatusLabel: lead
          ? (leadMeta?.label ?? lead.status ?? 'Statut inconnu')
          : null,
        leadStatusSeverity: leadMeta?.severity ?? 'neutral',
        ownerLabel: o.ownerId ? (owners.get(o.ownerId) ?? 'Agent inconnu') : 'Non assignée',
        createdAt: o.createdAt ?? null,
        expectedCloseDate: o.expectedCloseDate ?? null,
        amountLabel:
          amount !== undefined && amount !== null
            ? `${amount} ${o.estimatedAmount?.currency ?? ''}`.trim()
            : null,
        // Le lien direct d'abord : il désigne CETTE demande, là où `sourceLeadId` ne désigne
        // que le lead dont elle descend — et plusieurs demandes peuvent descendre du même.
        holdingId:
          holdingsByOpportunity.get(o.id ?? '')
          ?? (leadId ? (holdingsByLead.get(leadId) ?? null) : null),
      };
    });
  });

  protected readonly openRows = computed(() => this.rows().filter((r) => !r.isClosed));
  protected readonly closedRows = computed(() => this.rows().filter((r) => r.isClosed));
  protected readonly visibleRows = computed(() =>
    this.showClosed() ? this.rows() : this.openRows(),
  );

  /** Le bloc arrive entier : pas de pagination serveur côté contrat. */
  protected readonly tableConfig: TableConfig = {
    property: 'demandes',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 25,
      pageSizeOptions: [25, 50],
    },
  };

  protected model = signal(NewDemandeFormModel.instantiate());

  protected formSchema = form(this.model, (schema) => {
    required(schema.product, {
      message: 'Le produit demandé est obligatoire',
    });
  });

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      if (!clientId || !this.canRead()) {
        this._isLoading.set(false);
        return;
      }
      this._load(clientId);
      // Chargé avec la liste et non à l'ouverture du formulaire : le référentiel
      // décide si le produit se choisit ou se saisit, et un basculement du contrôle
      // sous les doigts de l'agent effacerait ce qu'il vient de taper. Le drapeau est
      // un champ et non un signal : lu dans l'effet, un signal écrit par le
      // chargement relancerait l'effet, et avec lui la liste des demandes.
      if (!this._productsRequested) {
        this._productsRequested = true;
        this._loadProducts();
      }
    });
  }

  protected toggleClosed(): void {
    this.showClosed.update((v) => !v);
  }

  protected openForm(): void {
    this.submitError.set(null);
    this.duplicateWarning.set(null);
    this._duplicateAcknowledged.set(false);
    this.model.set(NewDemandeFormModel.instantiate());
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
  }

  protected reload(): void {
    const clientId = this.clientId();
    if (clientId) this._load(clientId);
  }

  /**
   * Les étapes qu'une demande ouverte peut prendre, dans l'ordre du pipeline.
   *
   * Les deux étapes closes en sont absentes : clore porte un motif et ouvre un contrat, ce que le
   * serveur refuse de faire passer par ce chemin — c'est `close()`.
   */
  protected readonly openStages: { value: string; label: string }[] = [
    { value: AdvanceOpportunityStageRequestStageEnum.Prospecting, label: STAGE_META['Prospecting'].label },
    { value: AdvanceOpportunityStageRequestStageEnum.Qualification, label: STAGE_META['Qualification'].label },
    { value: AdvanceOpportunityStageRequestStageEnum.NeedsAnalysis, label: STAGE_META['NeedsAnalysis'].label },
    { value: AdvanceOpportunityStageRequestStageEnum.Proposal, label: STAGE_META['Proposal'].label },
    { value: AdvanceOpportunityStageRequestStageEnum.Negotiation, label: STAGE_META['Negotiation'].label },
  ];

  /** Les deux issues, pour que le gabarit ne manipule pas des chaînes nues. */
  protected readonly wonOutcome = CloseOpportunityRequestOutcomeEnum.ClosedWon;
  protected readonly lostOutcome = CloseOpportunityRequestOutcomeEnum.ClosedLost;

  /**
   * Déplace le projet sur une étape de SON gabarit (Paramètres › Étapes des projets). Le serveur
   * refuse une étape d'un autre gabarit plutôt que de la deviner.
   */
  protected moveToStep(row: DemandeRow, stepId: string): void {
    if (!stepId || stepId === row.stepId || this.busyOpportunityId()) return;

    this.busyOpportunityId.set(row.opportunityId);

    this._opportunitiesApi
      .moveOpportunityToStep(row.opportunityId, { stepId, expectedUpdatedAt: null })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Étape non enregistrée',
            this._gateMessage(error, row.stepOptions.find((o) => o.value === stepId)?.label ?? null) ?? this._errorMessage(error),
          );
          return EMPTY;
        }),
        finalize(() => this.busyOpportunityId.set(null)),
      )
      .subscribe(() => this.reload());
  }

  protected advanceStage(row: DemandeRow, stage: string): void {
    if (!stage || stage === row.stageValue || this.busyOpportunityId()) return;

    this.busyOpportunityId.set(row.opportunityId);

    this._opportunitiesApi
      .advanceOpportunityStage(row.opportunityId, {
        stage: stage as AdvanceOpportunityStageRequestStageEnum,
        // Null : la liste n'affiche pas l'horodatage de la demande, donc elle n'a rien d'honnête
        // à présenter au contrôle de concurrence. Le serveur le saute quand il est absent.
        expectedUpdatedAt: null,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Étape non enregistrée', this._errorMessage(error));
          return EMPTY;
        }),
        finalize(() => this.busyOpportunityId.set(null)),
      )
      .subscribe(() => this.reload());
  }

  protected openCloseForm(row: DemandeRow): void {
    this.closingOpportunityId.set(row.opportunityId);
    this.closeReason.set('');
  }

  protected cancelClose(): void {
    this.closingOpportunityId.set(null);
    this.closeReason.set('');
  }

  /**
   * Clôt la demande. Une demande GAGNÉE ouvre une souscription en brouillon sur la fiche, et la
   * réponse en porte l'identifiant — ou `null` quand le produit ne correspond à aucune ligne du
   * catalogue, auquel cas la ligne propose la souscription à la main.
   */
  protected close(row: DemandeRow, outcome: CloseOpportunityRequestOutcomeEnum): void {
    if (this.busyOpportunityId()) return;

    this.busyOpportunityId.set(row.opportunityId);

    this._opportunitiesApi
      .closeOpportunity(row.opportunityId, {
        outcome,
        reason: this.closeReason().trim() || null,
        expectedUpdatedAt: null,
      })
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error('Clôture impossible', this._gateMessage(error, null) ?? this._errorMessage(error));
          return EMPTY;
        }),
        finalize(() => this.busyOpportunityId.set(null)),
      )
      .subscribe((result) => {
        this.cancelClose();

        if (outcome !== CloseOpportunityRequestOutcomeEnum.ClosedWon) {
          this._snackbar.success('Projet clos', 'Le projet est marqué perdu.');
        } else if (result?.holdingId) {
          this._snackbar.success(
            'Projet gagné',
            'Une souscription en brouillon a été ouverte sur la fiche du client.',
          );
        } else {
          // Pas une erreur : le produit est du texte libre et ne correspond à aucune ligne
          // active. La ligne affiche alors « Souscrire », qui ouvre le parcours à la main.
          this._snackbar.info(
            'Projet gagné',
            "Aucune souscription n'a pu être ouverte automatiquement : souscrivez le produit "
              + 'depuis la ligne.',
          );
        }

        this.reload();
      });
  }

  /** Repost avec `force` après un doublon signalé : l'agent a confirmé. */
  protected createAnyway(): void {
    this._duplicateAcknowledged.set(true);
    this.handleSubmit();
  }

  protected handleSubmit(): void {
    const clientId = this.clientId();
    if (!clientId) return;
    this.submitError.set(null);

    submit(this.formSchema, async (field) => {
      const value = field().value();
      const product = value.product.trim();
      const amount = Number(value.estimatedAmount.replace(',', '.'));
      const hasAmount = value.estimatedAmount.trim().length > 0 && !Number.isNaN(amount);

      const result = await firstValueFrom(
        this._opportunitiesApi
          .createOpportunityForCustomer({
            customerEntityId: clientId,
            title: value.title.trim() || `Projet — ${product}`,
            product,
            description: value.description.trim() || null,
            // Par défaut la demande suit le conseiller de la fiche : sans cela elle
            // n'aurait pas d'agent assigné, qui est l'une des colonnes attendues.
            ownerId: this.clientStore.client()?.advisorUserId ?? null,
            estimatedAmount: hasAmount ? amount : null,
            estimatedCurrency: hasAmount ? value.estimatedCurrency.trim() || null : null,
            expectedCloseDate: value.expectedCloseDate || null,
            force: this._duplicateAcknowledged(),
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this.submitError.set(this._errorMessage(error));
              return EMPTY;
            }),
          ),
      );

      if (result === undefined) return;

      if (result.duplicateDetected && !result.opportunityId) {
        // Pas de `warning` sur `SnackbarService` : l'avertissement est rendu dans le
        // formulaire, avec le bouton qui permet de passer outre.
        this.duplicateWarning.set(result.existingOpportunityIds?.length ?? 0);
        return;
      }

      this._snackbar.success(
        'Projet créé',
        'Le projet est rattaché au client et apparaît dans la liste.',
      );
      this.formOpen.set(false);
      this.duplicateWarning.set(null);
      this._duplicateAcknowledged.set(false);
      this.reload();
    });
  }

  // ——— Chargement ———

  private _load(clientId: string): void {
    this._isLoading.set(true);
    this._loadFailed.set(false);

    this._opportunitiesApi
      .listOpportunities(undefined, clientId)
      .pipe(
        catchError(() => {
          this._loadFailed.set(true);
          return of(null);
        }),
      )
      .subscribe((list) => {
        this._opportunities.set(list ?? []);
        this._isLoading.set(false);
        if (list && list.length > 0) this._loadRelated(clientId, list);
      });
  }

  /**
   * Trois compléments, chacun indépendant : un échec sur l'un laisse les autres
   * colonnes remplies plutôt que de vider le bloc entier.
   */
  private _loadRelated(clientId: string, list: OpportunityDto[]): void {
    const leadIds = [...new Set(list.map((o) => o.leadId).filter((id): id is string => !!id))];
    const ownerIds = [...new Set(list.map((o) => o.ownerId).filter((id): id is string => !!id))];

    if (leadIds.length > 0) {
      forkJoin(
        leadIds.map((id) =>
          this._leadsApi.getLead(id).pipe(catchError(() => of(null))),
        ),
      ).subscribe((leads) => {
        const map = new Map<string, LeadDto>();
        leads.forEach((lead, index) => {
          if (lead) map.set(leadIds[index], lead);
        });
        this._leadsById.set(map);
      });
    }

    if (ownerIds.length > 0) {
      forkJoin(
        ownerIds.map((id) =>
          this._usersApi.getUser(id).pipe(catchError(() => of(null))),
        ),
      ).subscribe((users) => {
        const map = new Map<string, string>();
        users.forEach((user, index) => {
          const label = user?.fullName?.trim() || user?.email?.trim();
          if (label) map.set(ownerIds[index], label);
        });
        this._ownerNames.set(map);
      });
    }

    // Lien vers la souscription. Deux rattachements, indexés dans la même table :
    // `sourceOpportunityId` est le lien DIRECT, posé par la clôture d'une demande gagnée, et
    // `sourceLeadId` reste le lien indirect des souscriptions nées d'une conversion de lead.
    // Le premier a la priorité — il désigne cette demande-ci, pas le lead dont elle descend.
    this._holdingsApi
      .listClientHoldings(clientId, undefined, undefined, 1, 100)
      .pipe(catchError(() => of(null)))
      .subscribe((page) => {
        const byLead = new Map<string, string>();
        const byOpportunity = new Map<string, string>();

        for (const holding of page?.items ?? []) {
          if (!holding.holdingId) continue;
          if (holding.sourceOpportunityId) {
            byOpportunity.set(holding.sourceOpportunityId, holding.holdingId);
          }
          if (holding.sourceLeadId) {
            byLead.set(holding.sourceLeadId, holding.holdingId);
          }
        }

        this._holdingIdByLeadId.set(byLead);
        this._holdingIdByOpportunityId.set(byOpportunity);
      });
  }

  private _loadProducts(): void {
    this._productsApi
      .listProducts(true)
      .pipe(catchError(() => of([] as ProductDto[])))
      .subscribe((products) => this._products.set(products ?? []));
  }

  /** Le refus d'une étape marquée du gabarit (lot 3), dit comme sur l'onglet du lead. */
  private _gateMessage(error: HttpErrorResponse, target: string | null): string | null {
    const code = projectGateCode(error);
    if (!code) return null;
    const message = projectGateMessage(code, target);
    if (code === 'PROJECT_QUESTIONNAIRES_INCOMPLETE') return `${message} Ouvrez le projet pour les remplir.`;
    return code === 'PROJECT_CLIENT_FILE_REQUIRED' ? message : `${message} Voir l'onglet KYC de la fiche.`;
  }

  private _errorMessage(error: HttpErrorResponse): string {
    const body = error.error as
      | { code?: string; title?: string; detail?: string; errors?: Record<string, string[]> }
      | undefined;

    if (error.status === 403) {
      return "Vous n'avez pas le droit de créer un projet pour ce client.";
    }
    const firstValidation = body?.errors ? Object.values(body.errors).flat()[0] : undefined;
    return (
      firstValidation ?? body?.detail ?? body?.title ?? 'Impossible de créer ce projet.'
    );
  }
}

export default ClientDemandes;
