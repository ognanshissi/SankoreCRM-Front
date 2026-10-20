import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, EMPTY, forkJoin, map, of, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField } from '@talisoft/ui/form-field';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import {
  AgenciesApiService,
  CustomerMatchDto,
  HoldingDto,
  LeadsApiService,
  LogActivityRequestTypeEnum,
  OpportunitiesApiService,
  OpportunityDto,
  ProductHoldingsApiService,
  SetIntentLevelRequestIntentLevelEnum,
  TagDto,
} from '@sankore/crm-api';
import {
  AuthenticationService,
  completenessGapTitle,
  completenessGapSection,
  CustomFieldsCard,
  PERMISSIONS,
  PermissionsService,
  WireValue,
} from '@sankore/crm/common';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { CallButton } from '@sankore/crm/telephony';
import { LeadEditContext } from './lead-edit-context';
import { LeadComplianceStore } from './lead-compliance-store';
import { interestedProductLabel } from '../../components/interested-product';
import { ConvertedLeadNotice } from './converted-lead-notice';
import { EditLeadInfoDrawer, genderLabel } from './edit-lead-info-drawer';
import { LogActivityDrawer, LogActivityDrawerData } from './log-activity-drawer';
import { CustomerMatchBanner, CustomerMatchView, customerMatchViewFromDto } from './customer-match-banner';
import { AttachCustomerDrawer, AttachCustomerDrawerData, AttachCustomerResult } from './attach-customer-drawer';
import { ageOf, formatAmount, formatDay, INTENT_OPTIONS, originLabel, originPhrase, prospectTypeLabel } from './lead-view.models';

/** Une correspondance client, avec ses produits et demandes, avant mise en forme. */
interface LeadCustomerMatchRaw {
  dto: CustomerMatchDto;
  holdings: HoldingDto[] | null;
  opportunities: OpportunityDto[] | null;
}

function pipelineLabel(stage: string | null | undefined): string {
  switch (stage) {
    // Les étapes du serveur (PipelineStage).
    case 'New':                  return 'Nouveau';
    case 'ContactAttempted':     return 'Contact tenté';
    case 'ContactEstablished':   return 'Contact établi';
    case 'NeedIdentified':       return 'Besoin identifié';
    case 'Qualified':            return 'Qualifié';
    case 'ProductProposed':      return 'Produit proposé';
    case 'ApplicationStarted':   return 'Dossier démarré';
    case 'DocumentCollection':   return 'Collecte des pièces';
    case 'ApplicationCompleted': return 'Dossier complet';
    case 'ApprovalPending':      return 'En approbation';
    case 'Converted':            return 'Converti';
    case 'Lost':                 return 'Perdu';
    default:                     return stage ?? '—';
  }
}

/** Où se corrige un élément manquant de la jauge de complétude — l'onglet de la fiche. */
const GAP_SECTION_LABEL: Record<string, string> = {
  identite: 'Identité',
  foyer: 'Foyer',
  questionnaires: 'Questionnaires',
  conformite: 'Conformité',
  consentement: 'Consentements',
  client: 'Fiche client',
};

/** Le numéro d'une pièce lisible à moitié : assez pour le reconnaître, pas pour le recopier. */
function maskDocument(value: string): string {
  const v = value.replace(/\s+/g, '');
  if (v.length <= 6) return v.replace(/.(?=.{2})/g, '•');
  return `${v.slice(0, 4)} •••• ${v.slice(-4)}`;
}

/**
 * L'onglet Informations de la fiche lead : ce qu'un agent doit savoir avant de décrocher —
 * la demande, le profil, d'où vient le lead, ce qui manque au dossier — et les gestes qui en
 * découlent.
 *
 * <p>Le lead est celui de la coque (`LeadEditContext`) et non une copie rechargée ici : l'en-tête
 * et cet onglet ne peuvent plus diverger, et chaque écriture redemande un rechargement à la coque
 * pour toute la fiche.</p>
 */
@Component({
  selector: 'lead-informations',
  templateUrl: './informations.html',
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasInput,
    TasFormField,
    Button,
    TimeagoPipe,
    ConvertedLeadNotice,
    CustomerMatchBanner,
    CustomFieldsCard,
    CallButton,
  ],
})
export class LeadInformationsPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _leadEditContext = inject(LeadEditContext);
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  protected readonly compliance = inject(LeadComplianceStore);

  public readonly id = input.required<string>();

  // L'état « converti » est replié dans les gardes de droits déjà lues par le template : chaque
  // action d'écriture passe par l'une d'elles, il n'y a donc pas d'endroit où la règle s'oublie.
  private readonly _canTag = this._permissions.can('lead:tag');
  private readonly _canUpdate = this._permissions.can('lead:update');
  public readonly canTag = computed(() => this._canTag() && !this._leadEditContext.isReadOnly());
  public readonly canUpdate = computed(() => this._canUpdate() && !this._leadEditContext.isReadOnly());
  public readonly canReadCustomers = this._permissions.can(PERMISSIONS.CUSTOMERS_READ);

  /**
   * Rattacher et détacher sont des écritures sur le lead : le contrat n'expose pas de droit dédié
   * pour `PUT /leads/{id}/customer`, et `lead:update` est le plus proche.
   */
  public readonly canLinkCustomer = this.canUpdate;
  public readonly linkDisabledReason = computed(() => {
    if (this.canLinkCustomer()) return null;
    if (this._leadEditContext.isConverted()) return 'Lead converti : le rattachement client n\'est plus modifiable.';
    return 'Vous n\'avez pas le droit de modifier ce lead.';
  });

  public readonly lead = this._leadEditContext.lead;
  public readonly isLoading = computed(() => !this._leadEditContext.isKnown());

  public readonly productLabel = computed(() => interestedProductLabel(this.lead()?.interestedProduct));
  public readonly firstName = computed(() => this.lead()?.firstName || this.lead()?.fullName?.split(' ')[0] || 'le prospect');
  public readonly age = computed(() => ageOf(this.lead()?.dateOfBirth));
  public readonly origin = computed(() => originLabel(this.lead()));
  public readonly originPhrase = computed(() => originPhrase(this.lead()));
  public readonly isCompany = computed(() => this.lead()?.prospectType === 'Corporate');

  public readonly intentOptions = INTENT_OPTIONS;
  public readonly pipelineLabel = pipelineLabel;
  public readonly prospectTypeLabel = prospectTypeLabel;
  public readonly genderLabel = genderLabel;
  public readonly formatDay = formatDay;
  public readonly amount = computed(() => {
    const a = this.lead()?.desiredAmount;
    return a?.amount ? formatAmount(a.amount, a.currency) : null;
  });

  // ——— Pièce d'identité : masquée par défaut ———

  public readonly showDocument = signal(false);
  public readonly documentDisplay = computed(() => {
    const value = this.lead()?.nationalId;
    if (!value) return null;
    return this.showDocument() ? value : maskDocument(value);
  });

  // ——— L'alerte du haut : un contact sans trace ———

  /**
   * « Contacté » sans aucune activité : le statut dit que quelqu'un a parlé au prospect, et rien ne
   * dit ce qui s'est dit. « Nouveau » sans activité appelle, lui, un premier contact.
   */
  public readonly contactAlert = computed<'contacted-without-trace' | 'never-contacted' | null>(() => {
    const lead = this.lead();
    if (!lead || lead.lastActivityAt || !this.canUpdate()) return null;
    if (lead.status === 'Open') return 'contacted-without-trace';
    if (lead.status === 'New') return 'never-contacted';
    return null;
  });
  public readonly isRecordingFirstContact = signal(false);

  // ——— Fiche complète ———

  public readonly completeness = this.compliance.completeness;
  public readonly completenessPercent = computed(() => Math.round(this.completeness()?.percentage ?? 0));
  public readonly gaps = computed(() =>
    (this.completeness()?.gaps ?? []).map((g) => {
      const section = completenessGapSection(g.code);
      return {
        label: completenessGapTitle(g),
        where: GAP_SECTION_LABEL[section] ?? 'Identité',
        route: section === 'client' ? null : section,
        blocking: g.blocking ?? false,
      };
    }),
  );

  // ——— Qualification ———

  private readonly _questionCount = signal<number | null>(null);
  public readonly qualification = computed(() => {
    const total = this._questionCount();
    const done = this.lead()?.qualificationCompleteness ?? 0;
    return {
      percent: Math.round(done * 100),
      total,
      answered: total === null ? null : Math.round(done * total),
      started: done > 0,
    };
  });
  public showQualOverride = signal(false);
  public qualOverrideValue = signal(50);
  public isSavingQual = signal(false);

  // ——— Tags ———

  public tags = signal<TagDto[]>([]);
  public newTag = signal('');
  public showTagInput = signal(false);
  public isAddingTag = signal(false);

  // ——— Client existant (BNF-F-18 / BNF-F-19) ———

  private readonly _matchRaw = signal<LeadCustomerMatchRaw[]>([]);
  private readonly _agencyNames = signal<Record<string, string>>({});
  public isLoadingMatches = signal(false);
  public matchesFailed = signal(false);

  /** Le statut FATCA du bandeau vient du socle, jamais d'un calcul local. */
  public readonly fatcaEnabled = this.compliance.fatcaEnabled;
  public readonly fatcaStatus = this.compliance.principalFatcaStatus;

  public readonly customerMatches = computed<CustomerMatchView[]>(() => {
    const names = this._agencyNames();
    const requested = this.lead()?.interestedProduct ?? null;
    return this._matchRaw().map((raw) =>
      customerMatchViewFromDto(raw.dto, {
        agencyLabel: names[raw.dto.agencyId ?? ''] ?? null,
        products: raw.holdings,
        opportunities: raw.opportunities,
        requestedProductCode: requested,
      }),
    );
  });

  constructor() {
    effect(() => {
      const leadId = this.id();
      this._leadsApiService.listLeadTags(leadId).pipe(catchError(() => EMPTY))
        .subscribe((t) => this.tags.set(t ?? []));
      this._loadCustomerMatches(leadId);
    });

    // Le nombre de questions vient du formulaire de qualification du produit demandé.
    effect(() => {
      const product = this.lead()?.interestedProduct;
      if (!product) {
        this._questionCount.set(null);
        return;
      }
      this._leadsApiService.resolveQualificationTemplate(product).pipe(
        catchError(() => of(null)),
      ).subscribe((template) => this._questionCount.set(template?.questions?.length ?? null));
    });

    this._loadAgencyNames();
  }

  // ——— Écritures : chacune recharge toute la fiche ———

  private _reload(): void {
    this._leadEditContext.reload();
  }

  /**
   * Envoie seulement les champs personnalisés : tout autre champ du PATCH laissé absent reste tel
   * quel au serveur. `expectedUpdatedAt` refuse l'enregistrement si quelqu'un a modifié le lead
   * depuis qu'il a été chargé.
   */
  public readonly saveCustomFields = (customFields: Record<string, WireValue>) =>
    this._leadsApiService.updateLead(this.id(), {
      customFields,
      expectedUpdatedAt: this.lead()?.updatedAt ?? null,
    });

  public onCustomFieldsSaved(): void {
    this._reload();
  }

  public setIntentLevel(level: SetIntentLevelRequestIntentLevelEnum): void {
    if (!this.canUpdate() || this.lead()?.intentLevel === level) return;
    this._leadsApiService.setLeadIntentLevel(this.id(), { intentLevel: level }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de modifier l\'intérêt ressenti.'); return EMPTY; }),
    ).subscribe(() => this._reload());
  }

  public recordFirstContact(): void {
    this.isRecordingFirstContact.set(true);
    this._leadsApiService.recordFirstContact(this.id(), { contactedAt: new Date().toISOString() }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Enregistrement échoué.');
        this.isRecordingFirstContact.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this.isRecordingFirstContact.set(false);
      this._snackbar.success('Premier contact', 'Le premier contact a été enregistré.');
      this._reload();
    });
  }

  /** « Noter l'appel » : le panneau d'activité, ouvert sur un appel. */
  public logActivity(type: LogActivityRequestTypeEnum = LogActivityRequestTypeEnum.Call): void {
    const data: LogActivityDrawerData = { leadId: this.id(), leadName: this.lead()?.fullName ?? 'Lead', initialType: type };
    const ref = this._sideDrawerService.open(LogActivityDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });
    ref.closed.subscribe((result) => {
      if (result) this._reload();
    });
  }

  public readonly Activity = LogActivityRequestTypeEnum;

  public copyEmail(): void {
    const email = this.lead()?.email;
    if (!email) return;
    navigator.clipboard?.writeText(email).then(
      () => this._snackbar.success('Copié', 'L\'adresse e-mail est dans le presse-papiers.'),
      () => this._snackbar.error('Erreur', 'Copie impossible.'),
    );
  }

  public openTab(route: string | null): void {
    if (route) this._router.navigate(['/leads', this.id(), route]);
  }

  public openEditInfoDrawer(): void {
    const currentLead = this.lead();
    if (!currentLead) return;

    const ref = this._sideDrawerService.open(EditLeadInfoDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { lead: currentLead },
    });

    // On recharge plutôt que de recopier le formulaire : le serveur recalcule fullName,
    // desiredAmount et updatedAt, et le prochain enregistrement en a besoin.
    ref.closed.subscribe((updated) => {
      if (updated) this._reload();
    });
  }

  public saveQualificationCompleteness(): void {
    this.isSavingQual.set(true);
    this._leadsApiService.setLeadQualificationCompleteness(this.id(), {
      completeness: this.qualOverrideValue() / 100,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Mise à jour échouée.');
        this.isSavingQual.set(false);
        return EMPTY;
      }),
    ).subscribe(() => {
      this._snackbar.success('Qualification mise à jour', `Progression définie à ${this.qualOverrideValue()} %.`);
      this.showQualOverride.set(false);
      this.isSavingQual.set(false);
      this._reload();
    });
  }

  // ——— Tags ———

  public addTag(): void {
    const tag = this.newTag().trim();
    if (!tag) return;
    this.isAddingTag.set(true);
    this._leadsApiService.addLeadTag(this.id(), {
      tag,
      addedBy: this._auth.connectedUser()?.id,
    }).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible d\'ajouter le tag.');
        this.isAddingTag.set(false);
        return EMPTY;
      }),
    ).subscribe((added) => {
      this.tags.update((list) => [...list, added]);
      this.newTag.set('');
      this.showTagInput.set(false);
      this.isAddingTag.set(false);
    });
  }

  public removeTag(tag: TagDto): void {
    this._leadsApiService.removeLeadTag(this.id(), tag.id!).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible de retirer le tag.'); return EMPTY; }),
    ).subscribe(() => this.tags.update((list) => list.filter((t) => t.id !== tag.id)));
  }

  // ——— Client existant ———

  public openCustomer(customerId: string): void {
    this._router.navigate(['/customers', customerId, 'identite']);
  }

  /** Un KYC à reprendre se corrige sur la fiche client, pas sur le lead (BNF-F-19). */
  public openCustomerKyc(customerId: string): void {
    this._router.navigate(['/customers', customerId, 'kyc']);
  }

  public openAttachDrawer(match: CustomerMatchView): void {
    this._openLinkDrawer('attach', match);
  }

  public openDetachDrawer(match: CustomerMatchView): void {
    this._openLinkDrawer('detach', match);
  }

  private _openLinkDrawer(mode: 'attach' | 'detach', match: CustomerMatchView): void {
    const data: AttachCustomerDrawerData = {
      leadId: this.id(),
      mode,
      customer: match,
      expectedUpdatedAt: this.lead()?.updatedAt ?? null,
    };

    const ref = this._sideDrawerService.open(AttachCustomerDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data,
    });

    ref.closed.subscribe((raw) => {
      const result = raw as AttachCustomerResult | false | undefined;
      if (!result) return;
      // Un 204 ne dit pas ce que le serveur a retenu : on relit les correspondances et la fiche.
      this._loadCustomerMatches(this.id());
      this._reload();
    });
  }

  private _loadCustomerMatches(leadId: string): void {
    this.isLoadingMatches.set(true);
    this.matchesFailed.set(false);

    this._leadsApiService
      .getLeadCustomerMatches(leadId)
      .pipe(
        switchMap((matches) => this._withProductsAndRequests(matches ?? [])),
        catchError(() => {
          // La correspondance est un confort : son échec ne doit pas vider l'onglet.
          this.matchesFailed.set(true);
          return of([] as LeadCustomerMatchRaw[]);
        }),
      )
      .subscribe((raws) => {
        this._matchRaw.set(raws);
        this.isLoadingMatches.set(false);
      });
  }

  /**
   * Produits détenus et demandes en cours de chaque correspondance : l'un est affiché, l'autre
   * porte l'alerte « demande ouverte ou produit actif sur la même ligne ». Chaque appel retombe
   * sur `null` pour qu'un refus de droit n'emporte pas le bandeau.
   */
  private _withProductsAndRequests(matches: CustomerMatchDto[]) {
    if (matches.length === 0) return of([] as LeadCustomerMatchRaw[]);
    return forkJoin(
      matches.map((dto) =>
        forkJoin({
          holdings: this._holdingsApi
            .listClientHoldings(dto.customerId!, undefined, undefined, 1, 50)
            .pipe(map((page) => page.items ?? []), catchError(() => of(null))),
          opportunities: this._opportunitiesApi
            .listOpportunities(undefined, dto.customerId!)
            .pipe(catchError(() => of(null))),
        }).pipe(map(({ holdings, opportunities }) => ({ dto, holdings, opportunities }))),
      ),
    );
  }

  private _loadAgencyNames(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(
        map((res) => {
          const index: Record<string, string> = {};
          for (const a of res.items ?? []) if (a.id) index[a.id] = a.name ?? '';
          return index;
        }),
        catchError(() => EMPTY),
      )
      .subscribe((index) => this._agencyNames.set(index));
  }
}

export default LeadInformationsPage;
