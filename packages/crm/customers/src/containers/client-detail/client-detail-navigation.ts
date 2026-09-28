import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Anchor } from '@talisoft/ui/button';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { AgenciesApiService, UsersApiService } from '@sankore/crm-api';
import { catchError, EMPTY } from 'rxjs';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  clientStatusLabel,
  clientStatusSeverity,
  clientTypeLabel,
  isArchivedStatus,
  isLegalClient,
  isMergedStatus,
  isPendingKycStatus,
  kycStatusLabel,
  kycStatusSeverity,
  riskLevelLabel,
  riskLevelSeverity,
} from '../../models/client-labels';
import { ClientActionsMenu } from './client-actions-menu';

interface ClientTab {
  label: string;
  icon: string;
  route: string;
  /** Onglet réservé aux personnes morales (bénéficiaires effectifs). */
  legalOnly?: boolean;
}

/** Au-delà de ce délai en attente de KYC, la fiche affiche une alerte. */
const PENDING_KYC_ALERT_DAYS = 15;

@Component({
  selector: 'client-detail-navigation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ClientDetailStore],
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TasCard,
    TasIcon,
    TasSpinner,
    TasTag,
    Anchor,
    ClientActionsMenu,
  ],
  template: `
    @if (store.isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (store.notFound()) {
      <tas-card class="block">
        <div class="p-10 text-center">
          <p class="text-sm font-medium text-slate-700">Ce client n'existe pas</p>
          <p class="text-sm text-slate-500 mt-1">
            Il a peut-être été fusionné ou supprimé.
          </p>
          <a tas-button color="primary" [routerLink]="['/customers']" class="mt-4 inline-block">
            Revenir à la liste
          </a>
        </div>
      </tas-card>
    } @else if (client()) {
      <div class="flex flex-col gap-4 pb-6">

        @if (showKycInitiatedBanner()) {
          <div class="flex items-start gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <tas-icon iconName="feather:shield" class="text-primary mt-0.5" style="font-size:16px"></tas-icon>
            <div class="text-sm flex-1">
              <p class="font-medium text-slate-800">KYC initié — en attente de validation</p>
              <p class="text-slate-600">
                Le client est créé. Il deviendra actif une fois son dossier de connaissance
                client validé.
              </p>
            </div>
            <button
              type="button"
              class="text-slate-400 hover:text-slate-600 shrink-0"
              aria-label="Masquer ce message"
              (click)="dismissKycBanner()"
            >
              <tas-icon iconName="feather:x" style="font-size:14px"></tas-icon>
            </button>
          </div>
        }

        @if (isMerged()) {
          <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-300 bg-slate-50">
            <tas-icon iconName="feather:git-merge" class="text-slate-500 mt-0.5" style="font-size:16px"></tas-icon>
            <div class="text-sm">
              <p class="font-medium text-slate-800">Cette fiche a été fusionnée</p>
              <p class="text-slate-600">
                Les informations sont conservées pour l'historique. La fiche à jour est
                @if (mergedIntoId()) {
                  <a class="text-primary hover:underline" [routerLink]="['/customers', mergedIntoId()]">
                    {{ mergedIntoLabel() }}</a>.
                } @else {
                  celle du client survivant.
                }
              </p>
            </div>
          </div>
        }

        @if (isArchived()) {
          <div class="flex items-start gap-3 p-3 rounded-lg border border-slate-300 bg-slate-50">
            <tas-icon iconName="feather:archive" class="text-slate-500 mt-0.5" style="font-size:16px"></tas-icon>
            <div class="text-sm">
              <p class="font-medium text-slate-800">Client archivé</p>
              <p class="text-slate-600">La fiche est en lecture seule. Réactivez le client pour la modifier.</p>
            </div>
          </div>
        }

        @if (pendingKycDays() !== null) {
          <div class="flex items-start gap-3 p-3 rounded-lg border border-amber-300 bg-amber-50">
            <tas-icon iconName="feather:alert-triangle" class="text-amber-600 mt-0.5" style="font-size:16px"></tas-icon>
            <div class="text-sm">
              <p class="font-medium text-amber-900">
                KYC en attente depuis {{ pendingKycDays() }} jours
              </p>
              <p class="text-amber-800">
                Le client reste inactif tant que son dossier n'est pas validé.
              </p>
            </div>
          </div>
        }

        <!-- En-tête -->
        <tas-card class="block">
          <div class="p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h1 class="text-lg font-semibold text-slate-900 truncate">
                    {{ client()!.displayName || '—' }}
                  </h1>
                  <tas-tag [severity]="statusSeverity()">{{ statusLabel() }}</tas-tag>
                </div>
                <p class="text-sm text-slate-500 mt-0.5">
                  {{ client()!.clientNumber || '—' }} — {{ typeLabel() }}
                </p>
              </div>
              <client-actions-menu></client-actions-menu>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 mt-4 pt-4 border-t border-slate-100">
              <div>
                <p class="text-xs text-slate-400 mb-1">Statut KYC</p>
                <tas-tag [severity]="kycSeverity()">{{ kycLabel() }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Niveau de risque</p>
                <tas-tag [severity]="riskSeverity()">{{ riskLabel() }}</tas-tag>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Agence</p>
                <p class="text-sm font-medium text-slate-800">{{ agencyLabel() }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Conseiller</p>
                <p class="text-sm font-medium text-slate-800">{{ advisorLabel() }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Segment</p>
                <p class="text-sm font-medium text-slate-800">{{ client()!.segmentCode || 'Non segmenté' }}</p>
              </div>
              <div>
                <p class="text-xs text-slate-400 mb-1">Score de fidélité</p>
                <p class="text-sm font-medium text-slate-800 tabular-nums">
                  {{ client()!.loyaltyScore ?? '—' }}
                  @if (client()!.loyaltyScoreProvisional) {
                    <span class="text-xs font-normal text-slate-400">(provisoire)</span>
                  }
                </p>
              </div>
            </div>
          </div>
        </tas-card>

        <!-- Onglets -->
        <div class="border-b border-slate-200">
          <nav class="flex gap-1 overflow-x-auto" aria-label="Sections de la fiche client">
            @for (tab of visibleTabs(); track tab.route) {
              <a
                class="client-tab flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-slate-500 whitespace-nowrap border-b-2 border-transparent hover:text-slate-800"
                [routerLink]="[tab.route]"
                routerLinkActive="client-tab--active"
              >
                <tas-icon [iconName]="tab.icon" style="font-size:14px"></tas-icon>
                {{ tab.label }}
              </a>
            }
          </nav>
        </div>

        <router-outlet></router-outlet>
      </div>
    }
  `,
  styles: [
    `
      .client-tab--active {
        color: rgb(var(--tas-color-primary));
        border-bottom-color: rgb(var(--tas-color-primary));
      }
    `,
  ],
})
export class ClientDetailNavigation {
  protected readonly store = inject(ClientDetailStore);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _usersApi = inject(UsersApiService);

  private readonly _permissions = inject(PermissionsService);
  public readonly canReveal = this._permissions.can('customers:reveal_sensitive');

  public readonly id = input.required<string>();

  /**
   * Lié au query param `?kyc=initie` que pose l'assistant de création : c'est le seul
   * moyen de tenir le critère « redirigé vers la fiche avec un bandeau KYC initié » sans
   * que l'assistant et la fiche partagent un état. `withComponentInputBinding()` est actif
   * dans `app.config.ts`, les query params se lient donc aux entrées comme les paramètres
   * de route. Inerte pour toute autre valeur.
   */
  public readonly kyc = input<string | undefined>(undefined);

  private readonly _kycBannerDismissed = signal(false);

  protected readonly showKycInitiatedBanner = computed(
    () => this.kyc() === 'initie' && !this._kycBannerDismissed(),
  );

  protected readonly client = this.store.client;

  private readonly _agencyName = signal<string | null>(null);
  private readonly _advisorName = signal<string | null>(null);

  private readonly _tabs: ClientTab[] = [
    { label: 'Identité', icon: 'feather:user', route: 'identite' },
    { label: 'Coordonnées', icon: 'feather:phone', route: 'coordonnees' },
    { label: 'Relations', icon: 'feather:users', route: 'relations' },
    { label: 'Groupes', icon: 'feather:layers', route: 'groupes' },
    { label: 'Bénéficiaires effectifs', icon: 'feather:pie-chart', route: 'beneficiaires', legalOnly: true },
    { label: 'KYC', icon: 'feather:shield', route: 'kyc' },
    { label: 'Historique', icon: 'feather:clock', route: 'historique' },
  ];

  protected readonly visibleTabs = computed(() => {
    const isLegal = isLegalClient(this.client()?.clientType);
    return this._tabs.filter((t) => !t.legalOnly || isLegal);
  });

  protected readonly statusLabel = computed(() => clientStatusLabel(this.client()?.status));
  protected readonly statusSeverity = computed<Severity>(() => clientStatusSeverity(this.client()?.status));
  protected readonly typeLabel = computed(() => clientTypeLabel(this.client()?.clientType));
  protected readonly kycLabel = computed(() => kycStatusLabel(this.client()?.kycStatus));
  protected readonly kycSeverity = computed<Severity>(() => kycStatusSeverity(this.client()?.kycStatus));
  protected readonly riskLabel = computed(() => riskLevelLabel(this.client()?.riskLevel));
  protected readonly riskSeverity = computed<Severity>(() => riskLevelSeverity(this.client()?.riskLevel));

  protected readonly isMerged = computed(() => isMergedStatus(this.client()?.status));
  protected readonly isArchived = computed(() => isArchivedStatus(this.client()?.status));
  protected readonly mergedIntoId = computed(() => this.client()?.mergedInto?.clientId ?? null);
  protected readonly mergedIntoLabel = computed(
    () => this.client()?.mergedInto?.clientNumber ?? 'ouvrir la fiche survivante',
  );

  protected readonly agencyLabel = computed(
    () => this._agencyName() ?? this.client()?.agencyCode ?? '—',
  );
  protected readonly advisorLabel = computed(() => this._advisorName() ?? 'Non assigné');

  /**
   * Nombre de jours en attente de KYC, ou `null` si l'alerte ne s'applique pas. Le seuil est
   * une constante côté front : le paramètre tenant annoncé par US-M01-FE-09 n'existe pas
   * encore dans le contrat, et une alerte figée vaut mieux qu'aucune alerte.
   */
  protected readonly pendingKycDays = computed(() => {
    const client = this.client();
    if (!client || !isPendingKycStatus(client.status) || !client.createdAt) return null;
    const days = Math.floor(
      (Date.now() - new Date(client.createdAt).getTime()) / 86_400_000,
    );
    return days >= PENDING_KYC_ALERT_DAYS ? days : null;
  });

  protected dismissKycBanner(): void {
    this._kycBannerDismissed.set(true);
  }

  constructor() {
    effect(() => this.store.load(this.id()));

    effect(() => {
      const client = this.client();
      if (!client) return;

      this._breadcrumb.set([
        { label: 'Clients', link: ['/customers'] },
        { label: client.displayName ?? client.clientNumber ?? 'Client' },
      ]);

      if (client.agencyId) {
        this._agenciesApi.getAgency(client.agencyId).pipe(
          catchError(() => EMPTY),
        ).subscribe((agency) => this._agencyName.set(agency?.name ?? null));
      }
      if (client.advisorUserId) {
        this._usersApi.getUser(client.advisorUserId).pipe(
          catchError(() => EMPTY),
        ).subscribe((user) => this._advisorName.set(user?.fullName ?? user?.email ?? null));
      }
    });
  }
}

export default ClientDetailNavigation;
