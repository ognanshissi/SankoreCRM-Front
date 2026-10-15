import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Router } from '@angular/router';
import { catchError, EMPTY, forkJoin, map, of, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import { TasInput } from '@talisoft/ui/input';
import { TasFormField } from '@talisoft/ui/form-field';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  CustomerMatchDto,
  HoldingDto,
  LeadsApiService,
  LeadDto,
  OpportunitiesApiService,
  OpportunityDto,
  ProductHoldingsApiService,
  TagDto,
} from '@sankore/crm-api';
import { LeadEditContext } from './lead-edit-context';
import { LeadComplianceStore } from './lead-compliance-store';
import { interestedProductLabel } from '../../components/interested-product';
import { ConvertedLeadNotice } from './converted-lead-notice';
import {
  AuthenticationService,
  PERMISSIONS,
  PermissionsService,
} from '@sankore/crm/common';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { EditLeadInfoDrawer, genderLabel } from './edit-lead-info-drawer';
import {
  CustomerMatchBanner,
  CustomerMatchView,
  customerMatchViewFromDto,
} from './customer-match-banner';
import {
  AttachCustomerDrawer,
  AttachCustomerDrawerData,
  AttachCustomerResult,
} from './attach-customer-drawer';

/** Une correspondance client, avec ses produits et demandes, avant mise en forme. */
interface LeadCustomerMatchRaw {
  dto: CustomerMatchDto;
  holdings: HoldingDto[] | null;
  opportunities: OpportunityDto[] | null;
}

function sourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'Manual':    return 'Saisie manuelle';
    case 'Web':       return 'Site web';
    case 'Phone':     return 'Téléphone';
    case 'Referral':  return 'Parrainage';
    case 'Partner':   return 'Partenaire';
    case 'Campaign':  return 'Campagne';
    case 'Import':    return 'Import';
    case 'Api':       return 'API';
    default:          return source ?? '—';
  }
}

function pipelineLabel(stage: string | null | undefined): string {
  switch (stage) {
    case 'Captured':       return 'Capturé';
    case 'Contacted':      return 'Contacté';
    case 'Qualified':      return 'Qualifié';
    case 'ProposalSent':   return 'Proposition envoyée';
    case 'Negotiation':    return 'Négociation';
    case 'Won':            return 'Gagné';
    case 'Lost':           return 'Perdu';
    default:               return stage ?? '—';
  }
}

function prospectTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case '0': return 'Individuel';
    case '1': return 'Entreprise';
    default:  return type ?? '—';
  }
}

function intentLabel(level: string | null | undefined): string {
  switch (level) {
    case '0': return 'Froid';
    case '1': return 'Tiède';
    case '2': return 'Chaud';
    case '3': return 'Très chaud';
    default:  return level ?? '—';
  }
}

@Component({
  selector: 'lead-informations',
  imports: [FormsModule, DecimalPipe, TasCard, TasSpinner, TasIcon, TasTag, TasInput, TasFormField, Button, TimeagoPipe, ConvertedLeadNotice, CustomerMatchBanner],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (lead()) {
      <div class="pb-6 flex flex-col gap-4">
        <converted-lead-notice></converted-lead-notice>

        <!--
          Bandeau « Client existant » (BNF-F-19) et rattachement motivé (BNF-F-18).
          Rien ne s'affiche quand l'API ne renvoie aucune correspondance, et c'est
          l'état normal d'un prospect qui n'est pas déjà client.
        -->
        <customer-match-banner
          [matches]="customerMatches()"
          [isLoading]="isLoadingMatches()"
          [loadFailed]="matchesFailed()"
          [fatcaEnabled]="fatcaEnabled()"
          [fatcaStatus]="fatcaStatus()"
          [canAct]="canLinkCustomer()"
          [canDetach]="canLinkCustomer()"
          [canOpenCustomer]="canReadCustomers()"
          [actionsDisabledReason]="linkDisabledReason()"
          selectLabel="Rattacher…"
          [showRejectAction]="false"
          (select)="openAttachDrawer($event)"
          (detach)="openDetachDrawer($event)"
          (openCustomer)="openCustomer($event)"
          (openCustomerKyc)="openCustomerKyc($event)"
        ></customer-match-banner>

        <!-- Identity -->
        <tas-card>
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <p class="text-xs font-semibold text-slate-400">Identité</p>
              @if (canUpdate()) {
                <button type="button" class="text-xs text-primary hover:underline flex items-center gap-1"
                  (click)="openEditInfoDrawer()">
                  <tas-icon iconName="feather:edit-2" style="font-size:10px"></tas-icon>
                  Modifier
                </button>
              }
            </div>
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <p class="text-xs text-slate-400 mb-1">Nom complet</p>
                <p class="text-sm font-medium text-slate-800">{{ lead()!.fullName ?? '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Type de prospect</p>
                <p class="text-sm font-medium text-slate-800">{{ prospectTypeLabel(lead()!.prospectType) }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Téléphone</p>
                <p class="text-sm font-medium text-slate-800">{{ lead()!.phoneNumber ?? '—' }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">E-mail</p>
                <p class="text-sm font-medium text-slate-800 truncate">{{ lead()!.email ?? '—' }}</p>
              </div>
              @if (lead()!.dateOfBirth) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Date de naissance</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.dateOfBirth }}</p>
                </div>
              }
              @if (lead()!.gender) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Genre</p>
                  <p class="text-sm font-medium text-slate-800">{{ genderLabel(lead()!.gender) }}</p>
                </div>
              }
              @if (lead()!.nationalId) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Identifiant national</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.nationalId }}</p>
                </div>
              }
            </div>
          </div>
        </tas-card>

        <!-- Company (if enterprise) -->
        @if (lead()!.companyName || lead()!.companyEmail || lead()!.companyPhone) {
          <tas-card>
            <div class="p-4">
              <p class="text-xs font-semibold text-slate-400 mb-3">Entreprise</p>
              <div class="grid grid-cols-2 gap-x-6 gap-y-4">
                @if (lead()!.companyName) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Raison sociale</p>
                    <p class="text-sm font-medium text-slate-800">{{ lead()!.companyName }}</p>
                  </div>
                }
                @if (lead()!.companyEmail) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">E-mail entreprise</p>
                    <p class="text-sm font-medium text-slate-800 truncate">{{ lead()!.companyEmail }}</p>
                  </div>
                }
                @if (lead()!.companyPhone) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Téléphone entreprise</p>
                    <p class="text-sm font-medium text-slate-800">{{ lead()!.companyPhone }}</p>
                  </div>
                }
                @if (lead()!.website) {
                  <div>
                    <p class="text-xs text-slate-400 mb-1">Site web</p>
                    <p class="text-sm font-medium text-slate-800 truncate">{{ lead()!.website }}</p>
                  </div>
                }
              </div>
            </div>
          </tas-card>
        }

        <!-- Commercial info -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Informations commerciales</p>
            <div class="mb-4 flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
              <div class="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">
                <tas-icon iconName="feather:package" class="text-blue-600" style="font-size:16px"></tas-icon>
              </div>
              <div class="min-w-0">
                <p class="text-xs text-blue-700/80">Produit d'intérêt</p>
                @if (productLabel(); as product) {
                  <p class="text-base font-semibold text-blue-900 truncate">{{ product }}</p>
                } @else {
                  <p class="text-sm font-medium text-slate-500">Non précisé</p>
                }
              </div>
            </div>
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <p class="text-xs text-slate-400 mb-1">Source</p>
                <p class="text-sm font-medium text-slate-800">{{ sourceLabel(lead()!.source) }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Étape pipeline</p>
                <p class="text-sm font-medium text-slate-800">{{ pipelineLabel(lead()!.pipelineStage) }}</p>
              </div>
              @if (lead()!.desiredAmount) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Montant souhaité</p>
                  <p class="text-sm font-medium text-slate-800 tabular-nums">
                    {{ lead()!.desiredAmount!.amount | number:'1.0-0' }}
                    {{ lead()!.desiredAmount!.currency }}
                  </p>
                </div>
              }
              @if (lead()!.campaign) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Campagne</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.campaign }}</p>
                </div>
              }
              @if (lead()!.channel) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Canal</p>
                  <p class="text-sm font-medium text-slate-800">{{ lead()!.channel }}</p>
                </div>
              }
              @if (lead()!.intentLevel != null) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Température</p>
                  <p class="text-sm font-medium text-slate-800">{{ intentLabel(lead()!.intentLevel) }}</p>
                </div>
              }
              <div>
                <p class="text-xs text-slate-400 mb-1">Qualification</p>
                <div class="flex items-center gap-2">
                  <div class="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-primary rounded-full transition-all"
                      [style.width.%]="(lead()!.qualificationCompleteness ?? 0) * 100"
                    ></div>
                  </div>
                  <span class="text-xs text-slate-500 tabular-nums">
                    {{ ((lead()!.qualificationCompleteness ?? 0) * 100) | number:'1.0-0' }}%
                  </span>
                  @if (!showQualOverride() && canUpdate()) {
                    <button type="button" class="text-[10px] text-primary hover:underline" (click)="showQualOverride.set(true)">
                      Modifier
                    </button>
                  }
                </div>
                @if (showQualOverride()) {
                  <div class="flex items-center gap-2 mt-2">
                    <input type="range" min="0" max="100" class="flex-1 accent-primary"
                      [ngModel]="qualOverrideValue()" (ngModelChange)="qualOverrideValue.set($event)" />
                    <span class="text-xs text-slate-600 tabular-nums w-8 text-right">{{ qualOverrideValue() }}%</span>
                    @if (canUpdate()) {
                      <button tas-button color="primary" type="button" class="text-[10px]"
                        [disabled]="isSavingQual()" (click)="saveQualificationCompleteness()">
                        @if (isSavingQual()) { <tas-spinner size="2" class="text-white"></tas-spinner> }
                        OK
                      </button>
                    }
                    <button type="button" class="text-[10px] text-slate-400" (click)="showQualOverride.set(false)">Annuler</button>
                  </div>
                }
              </div>
            </div>
          </div>
        </tas-card>

        <!-- Metadata -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Dates</p>
            <div class="grid grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <p class="text-xs text-slate-400 mb-1">Capturé le</p>
                <p class="text-sm font-medium text-slate-800">
                  {{ lead()!.capturedAt ? (lead()!.capturedAt! | dateTimeAgo) : '—' }}
                </p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Dernière activité</p>
                <p class="text-sm font-medium text-slate-800">
                  {{ lead()!.lastActivityAt ? (lead()!.lastActivityAt! | dateTimeAgo) : 'Aucune' }}
                </p>
              </div>
              @if (lead()!.expiresAt) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Expire le</p>
                  <p class="text-sm font-medium text-slate-800">
                    {{ lead()!.expiresAt! | dateTimeAgo }}
                  </p>
                </div>
              }
              @if (lead()!.convertedAt) {
                <div>
                  <p class="text-xs text-slate-400 mb-1">Converti le</p>
                  <p class="text-sm font-medium text-slate-800">
                    {{ lead()!.convertedAt! | dateTimeAgo }}
                  </p>
                </div>
              }
            </div>
          </div>
        </tas-card>

        <!-- Tags -->
        <tas-card>
          <div class="p-4">
            <p class="text-xs font-semibold text-slate-400 mb-3">Tags</p>
            <div class="flex flex-wrap gap-1.5 mb-3">
              @for (tag of tags(); track tag.id) {
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  {{ tag.tag }}
                  @if (canTag()) {
                    <button type="button" class="hover:text-red-500 transition-colors" (click)="removeTag(tag)">
                      <tas-icon iconName="feather:x" style="font-size:10px"></tas-icon>
                    </button>
                  }
                </span>
              }
              @if (tags().length === 0 && !showTagInput()) {
                <span class="text-xs text-slate-400">Aucun tag</span>
              }
            </div>
            @if (showTagInput()) {
              <div class="flex items-center gap-2">
                <tas-form-field>
                  <input tasInput type="text" placeholder="Nouveau tag…"
                    [ngModel]="newTag()" (ngModelChange)="newTag.set($event)"
                    (keydown.enter)="addTag()" />
                </tas-form-field>
                @if (canTag()) {
                  <button tas-button color="primary" type="button" class="text-xs shrink-0" [disabled]="!newTag().trim() || isAddingTag()" (click)="addTag()">
                    @if (isAddingTag()) { <tas-spinner size="3" class="text-white"></tas-spinner> }
                    Ajouter
                  </button>
                }
                <button type="button" class="text-xs text-slate-400 hover:text-slate-600" (click)="showTagInput.set(false)">Annuler</button>
              </div>
            } @else if (canTag()) {
              <button type="button" class="text-xs text-primary hover:underline flex items-center gap-1" (click)="showTagInput.set(true)">
                <tas-icon iconName="feather:plus" style="font-size:10px"></tas-icon> Ajouter un tag
              </button>
            }
          </div>
        </tas-card>

        <!-- Comment -->
        @if (lead()!.comment) {
          <tas-card>
            <div class="p-4">
              <p class="text-xs font-semibold text-slate-400 mb-2">Commentaire</p>
              <p class="text-sm text-slate-600 whitespace-pre-line">{{ lead()!.comment }}</p>
            </div>
          </tas-card>
        }

      </div>
    }
  `,
})
export class LeadInformationsPage {
  private readonly _permissions = inject(PermissionsService);
  private readonly _leadEditContext = inject(LeadEditContext);

  // L'état « converti » est replié dans les gardes de droits déjà lues par le
  // template : chaque action d'écriture passe par l'une d'elles, il n'y a donc
  // pas d'endroit où la règle puisse être oubliée.
  private readonly _canTag = this._permissions.can('lead:tag');
  private readonly _canUpdate = this._permissions.can('lead:update');
  public readonly canTag = computed(
    () => this._canTag() && !this._leadEditContext.isReadOnly(),
  );
  public readonly canUpdate = computed(
    () => this._canUpdate() && !this._leadEditContext.isReadOnly(),
  );

  private readonly _canReadCustomers = this._permissions.can(PERMISSIONS.CUSTOMERS_READ);
  public readonly canReadCustomers = this._canReadCustomers;

  /**
   * Rattacher et détacher sont des écritures sur le lead : le contrat n'expose pas de
   * droit dédié pour `PUT /leads/{id}/customer`, et `lead:update` est le droit
   * d'écriture du lead le plus proche. Un lead converti reste en lecture seule.
   */
  public readonly canLinkCustomer = computed(
    () => this._canUpdate() && !this._leadEditContext.isReadOnly(),
  );

  public readonly linkDisabledReason = computed(() => {
    if (this.canLinkCustomer()) return null;
    if (this._leadEditContext.isConverted()) {
      return 'Lead converti : le rattachement client n\'est plus modifiable.';
    }
    return 'Vous n\'avez pas le droit de modifier ce lead.';
  });

  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _router = inject(Router);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _opportunitiesApi = inject(OpportunitiesApiService);
  private readonly _compliance = inject(LeadComplianceStore);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public lead = signal<LeadDto | null>(null);
  public readonly productLabel = computed(() => interestedProductLabel(this.lead()?.interestedProduct));
  public tags = signal<TagDto[]>([]);
  public newTag = signal('');
  public showTagInput = signal(false);
  public isAddingTag = signal(false);
  public showQualOverride = signal(false);
  public qualOverrideValue = signal(50);
  public isSavingQual = signal(false);

  // ——— Client existant (BNF-F-18 / BNF-F-19) ———

  private readonly _matchRaw = signal<LeadCustomerMatchRaw[]>([]);
  private readonly _agencyNames = signal<Record<string, string>>({});
  public isLoadingMatches = signal(false);
  public matchesFailed = signal(false);

  /** Le statut FATCA du bandeau vient du socle, jamais d'un calcul local. */
  public readonly fatcaEnabled = this._compliance.fatcaEnabled;
  public readonly fatcaStatus = this._compliance.principalFatcaStatus;

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

  public readonly sourceLabel = sourceLabel;
  public readonly pipelineLabel = pipelineLabel;
  public readonly prospectTypeLabel = prospectTypeLabel;
  public readonly intentLabel = intentLabel;
  public readonly genderLabel = genderLabel;

  constructor() {
    effect(() => {
      const leadId = this.id();
      this.isLoading.set(true);
      this._leadsApiService.getLead(leadId).pipe(
        catchError(() => { this.isLoading.set(false); return EMPTY; }),
      ).subscribe((lead) => {
        this.lead.set(lead);
        this.isLoading.set(false);
      });
      this._leadsApiService.listLeadTags(leadId).pipe(
        catchError(() => EMPTY),
      ).subscribe((t) => this.tags.set(t ?? []));
      this._loadCustomerMatches(leadId);
    });

    this._loadAgencyNames();
  }

  public openCustomer(customerId: string): void {
    this._router.navigate(['/customers', customerId, 'identite']);
  }

  /**
   * Lien profond vers l'action côté client : un KYC à reprendre se corrige sur la fiche
   * client, pas sur le lead (BNF-F-19).
   */
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
      // Un 204 ne dit pas ce que le serveur a retenu : on relit les correspondances et
      // le lead, dont le `updatedAt` sert de jeton au prochain enregistrement.
      this._loadCustomerMatches(this.id());
      this._leadsApiService.getLead(this.id()).pipe(
        catchError(() => EMPTY),
      ).subscribe((lead) => this.lead.set(lead));
      this._compliance.reloadAfterWrite();
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
   * Produits détenus et demandes en cours de chaque correspondance : l'un est affiché,
   * l'autre porte l'alerte « demande ouverte ou produit actif sur la même ligne ».
   * Chaque appel retombe sur `null` pour qu'un refus de droit n'emporte pas le bandeau.
   */
  private _withProductsAndRequests(matches: CustomerMatchDto[]) {
    if (matches.length === 0) return of([] as LeadCustomerMatchRaw[]);
    return forkJoin(
      matches.map((dto) =>
        forkJoin({
          holdings: this._holdingsApi
            .listClientHoldings(dto.customerId!, undefined, undefined, 1, 50)
            .pipe(
              map((page) => page.items ?? []),
              catchError(() => of(null)),
            ),
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
          for (const a of res.items ?? []) {
            if (a.id) index[a.id] = a.name ?? '';
          }
          return index;
        }),
        catchError(() => EMPTY),
      )
      .subscribe((index) => this._agencyNames.set(index));
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

    ref.closed.subscribe((updated) => {
      if (updated) {
        // On recharge plutôt que de recopier le formulaire : le serveur recalcule fullName,
        // desiredAmount et updatedAt, et le prochain enregistrement a besoin du updatedAt à jour
        // pour l'optimistic locking.
        this._leadsApiService.getLead(this.id()).pipe(
          catchError(() => EMPTY),
        ).subscribe((lead) => this.lead.set(lead));
      }
    });
  }

  public saveQualificationCompleteness(): void {
    this.isSavingQual.set(true);
    this._leadsApiService.setLeadQualificationCompleteness(this.id(), {
      completeness: this.qualOverrideValue() / 100,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Mise à jour échouée.'); return EMPTY; }),
    ).subscribe(() => {
      this.lead.update((l) => l ? { ...l, qualificationCompleteness: this.qualOverrideValue() / 100 } : l);
      this._snackbar.success('Qualification mise à jour', `Progression définie à ${this.qualOverrideValue()}%.`);
      this.showQualOverride.set(false);
      this.isSavingQual.set(false);
    });
  }

  public addTag(): void {
    const tag = this.newTag().trim();
    if (!tag) return;
    this.isAddingTag.set(true);
    this._leadsApiService.addLeadTag(this.id(), {
      tag,
      addedBy: this._auth.connectedUser()?.id,
    }).pipe(
      catchError(() => { this._snackbar.error('Erreur', 'Impossible d\'ajouter le tag.'); return EMPTY; }),
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
    ).subscribe(() => {
      this.tags.update((list) => list.filter((t) => t.id !== tag.id));
    });
  }
}

export default LeadInformationsPage;
