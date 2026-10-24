import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Button } from '@talisoft/ui/button';
import { FatcaStatusBadge, holdingStatusLabel } from '@sankore/crm/common';
import {
  ClientSearchItemDto,
  CustomerMatchDto,
  HoldingDto,
  OpportunityDto,
} from '@sankore/crm-api';
// Les libellés KYC sont le référentiel du module Clients : les redéfinir ici ferait
// diverger deux tables pour la même énumération. L'import croisé est le précédent du
// repo (cf. `client-labels` consommé par la liste KYC).
// eslint-disable-next-line @nx/enforce-module-boundaries
import { clientStatusLabel, kycStatusLabel, kycStatusSeverity } from '@sankore/crm/customers';

/** Un produit détenu par le client, réduit à ce que le bandeau affiche. */
export interface CustomerMatchProductView {
  holdingId: string;
  productCode: string;
  productLineId: string | null;
  label: string;
  statusLabel: string;
  isActive: boolean;
}

/**
 * Vue normalisée d'une correspondance « client existant ».
 *
 * Elle existe parce que les deux moments où le bandeau sert ne lisent pas la même
 * ressource : à la création le lead n'existe pas encore, donc `getLeadCustomerMatches`
 * n'est pas appelable et la détection passe par la recherche client
 * (`ClientsApiService.searchClients`) ; sur la fiche lead c'est bien
 * `getLeadCustomerMatches` (BNF-B-22) qui répond, avec en plus `isExactSingleMatch`
 * et `alreadyLinked`. Un seul composant, deux fabriques.
 */
export interface CustomerMatchView {
  customerId: string;
  displayName: string;
  clientNumber: string | null;
  /** Agence de rattachement du client : le lead créé en hérite (BNF-F-18). */
  agencyId: string | null;
  /**
   * Le conseiller de la fiche client. Recopié jusqu'ici pour que la demande créée depuis la
   * création de lead arrive avec un agent assigné — sans lui, elle apparaît sans titulaire dans
   * l'onglet « Demandes », qui en fait une colonne.
   */
  advisorUserId: string | null;
  agencyLabel: string | null;
  statusLabel: string | null;
  kycStatus: string | null;
  matchedOnLabels: string[];
  /** Correspondance exacte et unique : le rattachement est proposé par défaut. */
  isExact: boolean;
  /** Le lead est déjà rattaché à ce client. */
  alreadyLinked: boolean;
  /** Produits détenus. `null` tant qu'ils ne sont pas chargés (ou en cas d'échec). */
  products: CustomerMatchProductView[] | null;
  /** Alertes « demande ouverte / produit actif sur la même ligne de produit ». */
  conflicts: string[];
}

const MATCHED_ON_LABELS: Record<string, string> = {
  Phone: 'Téléphone',
  PhoneNumber: 'Téléphone',
  Email: 'E-mail',
  NationalId: "Pièce d'identité",
  IdentityDocument: "Pièce d'identité",
  IdentityDocumentNumber: "Pièce d'identité",
  Name: 'Nom',
  FullName: 'Nom',
  DisplayName: 'Nom',
  ClientNumber: 'Numéro client',
  CustomerReference: 'Référence client',
  DateOfBirth: 'Date de naissance',
};

/**
 * Libellé d'un critère de correspondance. `CustomerMatchDto.matchedOn` est déclaré
 * `Array<string>` sans énumération au contrat : un code inconnu ne doit donc pas vider
 * la ligne, il est rendu tel quel pour se voir à l'écran et se corriger.
 */
export function customerMatchedOnLabel(code: string | null | undefined): string {
  if (!code) return 'Correspondance';
  // Le serveur envoie selon les cas « Email » ou « email » : la casse ne change pas le critère.
  const key = Object.keys(MATCHED_ON_LABELS).find((k) => k.toLowerCase() === code.toLowerCase());
  return key ? MATCHED_ON_LABELS[key] : code;
}

function holdingView(holding: HoldingDto): CustomerMatchProductView {
  return {
    holdingId: holding.holdingId ?? '',
    productCode: holding.productCode ?? '',
    productLineId: holding.productLineId ?? null,
    label: holding.productCode?.trim() || 'Produit sans code',
    statusLabel: holdingStatusLabel(holding.status),
    isActive: holding.status === 'Active',
  };
}

const OPEN_OPPORTUNITY_STAGES = [
  'Prospecting',
  'Qualification',
  'NeedsAnalysis',
  'Proposal',
  'Negotiation',
];

/**
 * Alertes BNF-F-18 : « le client a déjà une demande ouverte ou un produit actif sur la
 * même ligne de produit ». La comparaison porte sur le **code produit**, seule clé
 * commune entre le produit demandé du lead (`interestedProduct`, un code), les produits
 * détenus (`HoldingDto.productCode`) et les opportunités (`OpportunityDto.product`).
 */
export function customerProductConflicts(
  productCode: string | null | undefined,
  holdings: HoldingDto[] | null,
  opportunities: OpportunityDto[] | null,
): string[] {
  const code = (productCode ?? '').trim();
  if (!code) return [];
  const conflicts: string[] = [];

  const activeHolding = (holdings ?? []).find(
    (h) => (h.productCode ?? '').trim() === code && h.status === 'Active',
  );
  if (activeHolding) {
    conflicts.push(`Ce client détient déjà un produit actif sur la ligne « ${code} ».`);
  }

  const openRequest = (opportunities ?? []).find(
    (o) =>
      (o.product ?? '').trim() === code &&
      OPEN_OPPORTUNITY_STAGES.includes(String(o.stage ?? '')),
  );
  if (openRequest) {
    conflicts.push(
      `Un projet est déjà ouvert pour ce client sur la ligne « ${code} »` +
        (openRequest.title ? ` (${openRequest.title}).` : '.'),
    );
  }

  return conflicts;
}

/** Fabrique côté fiche lead : `getLeadCustomerMatches` (BNF-B-22). */
export function customerMatchViewFromDto(
  dto: CustomerMatchDto,
  extra: {
    agencyLabel?: string | null;
    products?: HoldingDto[] | null;
    opportunities?: OpportunityDto[] | null;
    requestedProductCode?: string | null;
  } = {},
): CustomerMatchView {
  return {
    customerId: dto.customerId ?? '',
    displayName: dto.displayName?.trim() || dto.clientNumber?.trim() || 'Client sans nom',
    clientNumber: dto.clientNumber ?? null,
    agencyId: dto.agencyId ?? null,
    advisorUserId: dto.advisorUserId ?? null,
    agencyLabel: extra.agencyLabel ?? null,
    statusLabel: dto.status ? clientStatusLabel(dto.status) : null,
    kycStatus: dto.kycStatus ?? null,
    matchedOnLabels: (dto.matchedOn ?? []).map(customerMatchedOnLabel),
    isExact: dto.isExactSingleMatch === true,
    alreadyLinked: dto.alreadyLinked === true,
    products: extra.products ? extra.products.map(holdingView) : null,
    conflicts: customerProductConflicts(
      extra.requestedProductCode,
      extra.products ?? null,
      extra.opportunities ?? null,
    ),
  };
}

/**
 * Fabrique côté création : la recherche client sur téléphone (`searchClients`) est le
 * seul moyen de détecter un client existant **avant** que le lead ne soit créé —
 * `getLeadCustomerMatches` demande un `leadId`. `isExact` n'est donc pas porté par le
 * serveur : il est posé par l'appelant quand la recherche n'a ramené qu'un seul client,
 * la recherche par téléphone étant une égalité sur l'index aveugle au contrat.
 */
export function customerMatchViewFromClient(
  client: ClientSearchItemDto,
  extra: {
    isExact?: boolean;
    matchedOn?: string[];
    agencyLabel?: string | null;
    products?: HoldingDto[] | null;
    opportunities?: OpportunityDto[] | null;
    requestedProductCode?: string | null;
  } = {},
): CustomerMatchView {
  return {
    customerId: client.id ?? '',
    displayName: client.displayName?.trim() || client.clientNumber?.trim() || 'Client sans nom',
    clientNumber: client.clientNumber ?? null,
    agencyId: client.agencyId ?? null,
    advisorUserId: client.advisorUserId ?? null,
    agencyLabel: extra.agencyLabel ?? null,
    statusLabel: client.status ? clientStatusLabel(client.status) : null,
    kycStatus: client.kycStatus ?? null,
    matchedOnLabels: (extra.matchedOn ?? []).map(customerMatchedOnLabel),
    isExact: extra.isExact === true,
    alreadyLinked: false,
    products: extra.products ? extra.products.map(holdingView) : null,
    conflicts: customerProductConflicts(
      extra.requestedProductCode,
      extra.products ?? null,
      extra.opportunities ?? null,
    ),
  };
}

/**
 * Encart / bandeau « Client existant », partagé par la création du lead (BNF-F-18) et la
 * fiche lead (BNF-F-19).
 *
 * Purement présentationnel : il reçoit des `CustomerMatchView` et n'émet que des
 * intentions. Les deux hôtes n'ont ni le même appel de détection, ni la même écriture
 * (la création retient un client en mémoire, la fiche appelle `attachLeadToCustomer`),
 * et c'est la seule chose qui diffère réellement entre les deux moments.
 *
 * Les candidats ne passent **pas** par `tas-table` : exception voulue par le propriétaire
 * du projet. C'est un aperçu d'une à quelques fiches, sans pagination ni recherche, et la
 * table y ajoutait un paginateur et des en-têtes de colonnes pour une seule ligne.
 *
 * Sur un lead converti, il n'y a plus rien à rattacher ni à détacher : le bandeau se réduit
 * au client issu de la conversion — sa référence et son statut KYC, sans action.
 */
@Component({
  selector: 'customer-match-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasCard, TasIcon, TasTag, TasSpinner, Button, FatcaStatusBadge],
  template: `
    @if (isLoading()) {
      <div
        class="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"
        role="status"
      >
        <tas-spinner size="4" class="text-primary"></tas-spinner>
        <span class="text-xs text-slate-500">Recherche d'un client existant…</span>
      </div>
    } @else if (loadFailed()) {
      <!-- Non bloquant : la détection est un confort, pas un prérequis (BNF-F-18). -->
      <div class="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <tas-icon
          iconName="feather:info"
          class="text-slate-400 shrink-0 mt-0.5"
          style="font-size:14px"
        ></tas-icon>
        <p class="text-xs text-slate-500">
          La recherche de client existant est indisponible. Vous pouvez continuer ;
          le rattachement restera possible depuis la fiche lead.
        </p>
      </div>
    } @else if (converted()) {
      <!-- ===== Lead converti : le client issu de la conversion, en lecture seule ===== -->
      @if (convertedClient(); as c) {
        <tas-card class="block">
          <div class="p-4 border-l-4 border-green-500">
            <div class="flex items-center gap-2 flex-wrap">
              <tas-icon
                iconName="feather:user-check"
                class="text-green-600"
                style="font-size:14px"
              ></tas-icon>
              <p class="text-sm font-semibold text-slate-800">Client</p>
              <tas-tag severity="success">Converti</tas-tag>
            </div>
            <p class="text-sm font-medium text-slate-800 mt-2 truncate">{{ c.displayName }}</p>
            @if (c.agencyLabel) {
              <p class="text-xs text-slate-500 mt-0.5">{{ c.agencyLabel }}</p>
            }

            <dl class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <dt class="text-xs text-slate-400">Référence client</dt>
                <dd class="text-sm font-medium text-slate-800 tabular-nums mt-0.5">
                  {{ c.clientNumber ?? '—' }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-slate-400">Statut KYC</dt>
                <dd class="mt-0.5">
                  <tas-tag [severity]="kycSeverity(c.kycStatus)">{{ kycLabel(c.kycStatus) }}</tas-tag>
                </dd>
              </div>
            </dl>
          </div>
        </tas-card>
      }
    } @else if (linked()) {
      <!-- ===== Bandeau « Client existant » : le lead est rattaché (BNF-F-19) ===== -->
      <tas-card class="block">
        <div class="p-4 border-l-4 border-primary">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <tas-icon
                  iconName="feather:user-check"
                  class="text-primary"
                  style="font-size:14px"
                ></tas-icon>
                <p class="text-sm font-semibold text-slate-800">Client existant</p>
                <tas-tag severity="success">Rattaché</tas-tag>
              </div>
              <p class="text-sm font-medium text-slate-800 mt-2 truncate">
                {{ linked()!.displayName }}
              </p>
              <p class="text-xs text-slate-500 mt-0.5">
                @if (linked()!.clientNumber) {
                  <span class="tabular-nums">N° {{ linked()!.clientNumber }}</span>
                }
                @if (linked()!.agencyLabel) { · {{ linked()!.agencyLabel }} }
                @if (linked()!.statusLabel) { · {{ linked()!.statusLabel }} }
              </p>
            </div>

            <div class="flex flex-col items-start sm:items-end gap-1.5 shrink-0">
              <!-- Un libellé accompagne toujours le badge : la couleur ne porte
                   jamais seule l'information (WCAG 2.1 AA). -->
              <span class="inline-flex items-center gap-1.5">
                <span class="text-xs text-slate-400">KYC</span>
                <tas-tag [severity]="kycSeverity(linked()!.kycStatus)">
                  {{ kycLabel(linked()!.kycStatus) }}
                </tas-tag>
              </span>
              @if (fatcaEnabled()) {
                <span class="inline-flex items-center gap-1.5">
                  <span class="text-xs text-slate-400">FATCA</span>
                  @if (fatcaStatus()) {
                    <fatca-status-badge [status]="fatcaStatus()"></fatca-status-badge>
                  } @else {
                    <tas-tag severity="neutral">Non documenté</tas-tag>
                  }
                </span>
              }
            </div>
          </div>

          @if (linked()!.products && linked()!.products!.length > 0) {
            <div class="mt-3">
              <p class="text-xs text-slate-400 mb-1">Produits détenus</p>
              <div class="flex flex-wrap gap-1.5">
                @for (p of linked()!.products!; track p.holdingId) {
                  <span
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-600"
                  >
                    {{ p.label }} <span class="text-slate-400">— {{ p.statusLabel }}</span>
                  </span>
                }
              </div>
            </div>
          }

          @for (conflict of linked()!.conflicts; track conflict) {
            <p class="mt-2 text-xs text-amber-700 flex items-start gap-1.5">
              <tas-icon
                iconName="feather:alert-triangle"
                class="text-amber-600 shrink-0 mt-0.5"
                style="font-size:12px"
              ></tas-icon>
              {{ conflict }}
            </p>
          }

          <div class="mt-3 flex flex-wrap items-center gap-2">
            @if (canOpenCustomer()) {
              <button
                tas-outlined-button
                color="primary"
                type="button"
                class="text-xs"
                (click)="openCustomer.emit(linked()!.customerId)"
              >
                <tas-icon iconName="feather:external-link" style="font-size:12px"></tas-icon>
                Fiche client
              </button>
              <button
                tas-text-button
                color="primary"
                type="button"
                class="text-xs"
                (click)="openCustomerKyc.emit(linked()!.customerId)"
              >
                Dossier KYC
              </button>
            }
            @if (canDetach()) {
              <button
                tas-text-button
                color="warn"
                type="button"
                class="text-xs"
                (click)="detach.emit(linked()!)"
              >
                Détacher…
              </button>
            } @else if (actionsDisabledReason()) {
              <span class="text-xs text-slate-400">{{ actionsDisabledReason() }}</span>
            }
          </div>
        </div>
      </tas-card>
    } @else if (candidates().length > 0) {
      <!-- ===== Encart « Client existant » : candidats au rattachement (BNF-F-18) ===== -->
      <!--
        Compact (2026-10-24) : une ligne de résumé, et une ligne par client. Plusieurs
        candidats occupaient un écran entier, « Aucun produit détenu » et « Correspond sur »
        répétés sur chacun. Replié par défaut quand il y a un choix à faire ; déplié quand un
        seul client correspond exactement, puisqu'il est alors proposé.
      -->
      <tas-card class="block">
        <div class="border-l-4 border-amber-400 px-4 py-3">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <tas-icon iconName="feather:user-check" class="shrink-0 text-amber-600" style="font-size:14px"></tas-icon>
            <p class="min-w-0 flex-1 text-sm text-slate-700">
              <span class="font-semibold text-slate-800">Client existant</span>
              —
              @if (exactProposal()) {
                ce contact correspond exactement à un client : le rattachement est proposé.
              } @else {
                {{ candidates().length }} client{{ candidates().length > 1 ? 's' : '' }} peuvent correspondre
                @if (sharedMatchedOn(); as on) { <span class="text-slate-500">sur {{ on }}</span> }
              }
            </p>
            <button tas-text-button color="primary" type="button" class="text-xs"
                    [attr.aria-expanded]="isOpen()" (click)="expanded.set(!isOpen())">
              {{ isOpen() ? 'Masquer' : 'Voir et choisir' }}
              <tas-icon [iconName]="isOpen() ? 'feather:chevron-up' : 'feather:chevron-down'" style="font-size:12px"></tas-icon>
            </button>
          </div>

          @if (isOpen()) {
            <ul class="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              @for (item of candidates(); track item.customerId) {
                <li class="px-3 py-2" [class]="item.customerId === selectedCustomerId() ? 'bg-primary/5' : ''">
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div class="min-w-48 flex-1">
                      <p class="truncate text-sm">
                        <span class="font-medium text-slate-800">{{ item.displayName }}</span>
                        @if (item.customerId === selectedCustomerId()) {
                          <tas-tag severity="success" class="ms-1">Retenu</tas-tag>
                        }
                      </p>
                      <p class="truncate text-xs text-slate-500">
                        @if (item.clientNumber) { <span class="tabular-nums">N° {{ item.clientNumber }}</span> }
                        @if (item.agencyLabel) { · {{ item.agencyLabel }} }
                        @if (item.statusLabel) { · {{ item.statusLabel }} }
                        @if (!sharedMatchedOn() && item.matchedOnLabels.length > 0) {
                          · sur {{ item.matchedOnLabels.join(', ').toLowerCase() }}
                        }
                      </p>
                    </div>
                    <!-- Un libellé accompagne toujours le badge : la couleur ne porte jamais seule l'information (WCAG 2.1 AA). -->
                    <span class="inline-flex shrink-0 items-center gap-1.5">
                      <span class="text-xs text-slate-400">KYC</span>
                      <tas-tag [severity]="kycSeverity(item.kycStatus)">{{ kycLabel(item.kycStatus) }}</tas-tag>
                    </span>
                    <div class="flex shrink-0 items-center gap-1">
                      @if (canAct()) {
                        <button tas-outlined-button color="primary" type="button" class="text-xs"
                                [disabled]="item.customerId === selectedCustomerId()"
                                (click)="matchSelected.emit(item)">
                          {{ selectLabel() }}
                        </button>
                      }
                      @if (canOpenCustomer()) {
                        <button tas-button iconButton type="button"
                                [attr.aria-label]="'Ouvrir la fiche de ' + item.displayName" title="Fiche client"
                                (click)="openCustomer.emit(item.customerId)">
                          <tas-icon iconName="feather:external-link" class="text-primary" style="font-size:14px"></tas-icon>
                        </button>
                      }
                    </div>
                  </div>

                  @if (item.products && item.products.length > 0) {
                    <div class="mt-1.5 flex flex-wrap gap-1.5">
                      @for (p of item.products; track p.holdingId) {
                        <span class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {{ p.label }} <span class="text-slate-400">— {{ p.statusLabel }}</span>
                        </span>
                      }
                    </div>
                  }
                  @for (conflict of item.conflicts; track conflict) {
                    <p class="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
                      <tas-icon iconName="feather:alert-triangle" class="mt-0.5 shrink-0 text-amber-600" style="font-size:12px"></tas-icon>
                      {{ conflict }}
                    </p>
                  }
                </li>
              }
            </ul>

            @if (canAct() && showRejectAction()) {
              <div class="mt-2">
                <button tas-text-button color="primary" type="button" class="text-xs" (click)="reject.emit()">
                  {{ selectedCustomerId() ? 'Finalement, nouveau prospect' : 'Nouveau prospect' }}
                </button>
              </div>
            } @else if (actionsDisabledReason()) {
              <p class="mt-2 text-xs text-slate-400">{{ actionsDisabledReason() }}</p>
            }
          }
        </div>
      </tas-card>
    }
  `,
})
export class CustomerMatchBanner {
  public readonly matches = input.required<CustomerMatchView[]>();
  public readonly isLoading = input(false);
  /** L'appel de correspondance a échoué : on le dit, sans bloquer le parcours. */
  public readonly loadFailed = input(false);
  public readonly selectedCustomerId = input<string | null>(null);

  /** Lead converti : le bandeau ne montre plus que le client issu de la conversion. */
  public readonly converted = input(false);
  /** `LeadDto.convertedToCustomerId`, pour retrouver ce client parmi les correspondances. */
  public readonly convertedCustomerId = input<string | null>(null);

  /** Statut FATCA du principal, tel que le porte `LeadComplianceStore` (BNF-F-19). */
  public readonly fatcaStatus = input<string | null>(null);
  public readonly fatcaEnabled = input(false);

  /** Droit de retenir / rattacher un client. */
  public readonly canAct = input(false);
  /** Droit de détacher le lead du client auquel il est rattaché. */
  public readonly canDetach = input(false);
  /** Droit de lecture de la fiche client (`customers:read`). */
  public readonly canOpenCustomer = input(false);
  /** Pourquoi les actions sont indisponibles, affiché à la place des boutons. */
  public readonly actionsDisabledReason = input<string | null>(null);

  /** Libellé du bouton de rétention : « C'est ce client » à la création, « Rattacher »
   *  sur la fiche, où le geste écrit immédiatement. */
  public readonly selectLabel = input("C'est ce client");

  /**
   * « Nouveau prospect » n'existe qu'à la création : sur la fiche lead, refuser une
   * correspondance proposée ne demande aucune écriture — il suffit de ne rien faire.
   */
  public readonly showRejectAction = input(true);

  public readonly matchSelected = output<CustomerMatchView>();
  public readonly reject = output<void>();
  public readonly detach = output<CustomerMatchView>();
  public readonly openCustomer = output<string>();
  public readonly openCustomerKyc = output<string>();

  /** Le client auquel le lead est déjà rattaché, s'il y en a un. */
  public readonly linked = computed(
    () => this.matches().find((m) => m.alreadyLinked) ?? null,
  );

  public readonly candidates = computed(() => this.matches().filter((m) => !m.alreadyLinked));

  /**
   * Le client issu de la conversion. Il revient parmi les correspondances (le lead et la fiche
   * créée partagent téléphone, e-mail et pièce) ; à défaut, le client auquel le lead était déjà
   * rattaché avant de convertir. Rien sinon : l'avis de conversion porte déjà le lien vers la fiche.
   */
  public readonly convertedClient = computed(() => {
    const id = this.convertedCustomerId();
    return (id ? this.matches().find((m) => m.customerId === id) : undefined) ?? this.linked();
  });

  /**
   * Correspondance exacte **et** unique : c'est le seul cas où le rattachement est
   * proposé par défaut. Dès qu'il y a plusieurs candidats, le choix doit rester
   * explicite — c'est la différence que BNF-F-18 demande de faire voir.
   */
  public readonly exactProposal = computed(() => {
    const list = this.candidates();
    return list.length === 1 && list[0].isExact;
  });

  /** Ouvert ou replié à la main ; à défaut, ouvert seulement pour une proposition exacte. */
  public readonly expanded = signal<boolean | null>(null);
  public readonly isOpen = computed(() => this.expanded() ?? (this.exactProposal() || !!this.selectedCustomerId()));

  /** Le critère commun à tous les candidats (« l'e-mail ») : dit une fois dans le résumé plutôt que sur chaque ligne. */
  public readonly sharedMatchedOn = computed(() => {
    const keys = this.candidates().map((c) => c.matchedOnLabels.join(', '));
    const first = keys[0];
    return first && keys.every((k) => k === first) ? first.toLowerCase() : null;
  });

  public kycLabel(status: string | null): string {
    return kycStatusLabel(status);
  }

  public kycSeverity(status: string | null): Severity {
    return kycStatusSeverity(status);
  }
}
