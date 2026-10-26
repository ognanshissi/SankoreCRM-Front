import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { EMPTY, catchError, finalize, of } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { Severity, TasTag } from '@talisoft/ui/tag';
import {
  ClientContractDto,
  InsurancePolicyDto,
  LiveBalanceDto,
  ProductHoldingsApiService,
} from '@sankore/crm-api';
import { PermissionsService, TENANT_MODULES, TenantModulesService } from '@sankore/crm/common';
// La police, son suivi d'envoi et ses sinistres appartiennent au module Intégration : la page
// assemble ses blocs plutôt que de les redéfinir.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
  CustomerClaimsList,
  IntegrationFacadeService,
  InsurancePolicyPanel,
  InsuranceSubscriptionsBlock,
  formatAmount,
  policyStatusMeta,
} from '@sankore/crm/integration';
import { ClientDetailStore } from '../../models/client-detail.store';
import { HoldingDetailPanel } from './holding-detail-panel';

const AMOUNT_KIND_LABELS: Record<string, string> = {
  Premium: 'Prime',
  Balance: 'Solde',
  Outstanding: 'Encours',
  InsuredCapital: 'Capital assuré',
  Deposit: 'Dépôt initial',
};

/**
 * La page d'un contrat (`/customers/:id/contrats/:contractKey`) — décision du propriétaire,
 * 2026-10-26 : le détail d'un contrat a sa page, plus un tiroir.
 *
 * La clé est celle de la liste (`holding:…`, `policy:…`, `account:…`, `loan:…`) : la page relit
 * la liste du client et y retrouve sa ligne, pour que le rapprochement contrat / police / compte
 * soit celui du serveur et pas une seconde version calculée ici. Elle assemble ensuite :
 *
 * - le contrat saisi ici (frise, termes, bénéficiaires, signature, envoi) quand il y en a un ;
 * - pour une assurance : la police (attestation, sinistre, après-vente), le suivi de l'envoi à
 *   l'assureur et les sinistres de la police ;
 * - pour un compte ou un prêt : ce que la banque en dit, et le solde en direct.
 *
 * Une ligne que seul l'assureur ou la banque connaît s'ouvre ici aussi, en lecture seule.
 */
@Component({
  selector: 'client-contrat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contrat.html',
  imports: [
    RouterLink,
    TasCard,
    TasIcon,
    TasSpinner,
    TasTag,
    Button,
    HoldingDetailPanel,
    InsurancePolicyPanel,
    InsuranceSubscriptionsBlock,
    CustomerClaimsList,
  ],
})
export class ClientContratPage {
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _integration = inject(IntegrationFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _modules = inject(TenantModulesService);
  protected readonly store = inject(ClientDetailStore);

  /** Paramètre de route, lié par `withComponentInputBinding()`. */
  public readonly contractKey = input.required<string>();

  private readonly _claims = viewChild(CustomerClaimsList);

  private readonly _canViewPolicy = this._permissions.can('Ins.Policy.View');
  private readonly _canFollowSubscriptions = this._permissions.can('Ins.Policy.View', 'Ins.Policy.Subscribe');
  private readonly _canViewClaims = this._permissions.can('Ins.Claim.View', 'Ins.Claim.Declare');
  private readonly _canViewLiveBalance = this._permissions.can('CoreBanking.Balance.ViewLive');
  private readonly _insuranceReadable = computed(() => this._modules.readable().has(TENANT_MODULES.INSURANCE));

  public readonly clientId = computed(() => this.store.clientId() ?? '');

  public readonly contract = signal<ClientContractDto | null>(null);
  public readonly coreBankingAsOf = signal<string | null>(null);
  public readonly unavailableSources = signal<string[]>([]);
  public readonly isLoading = signal(true);
  public readonly notFound = signal(false);
  public readonly loadFailed = signal(false);

  public readonly policy = signal<InsurancePolicyDto | null>(null);
  public readonly policyFailed = signal(false);

  public readonly liveBalance = signal<LiveBalanceDto | null>(null);
  public readonly isRefreshing = signal(false);
  public readonly balanceNotice = signal<string | null>(null);

  /** Un contrat saisi ici : sa clé suffit, même si la liste n'a pas pu être relue. */
  public readonly holdingId = computed(() => {
    const key = this.contractKey();
    return key.startsWith('holding:') ? key.slice('holding:'.length) : (this.contract()?.holdingId ?? null);
  });

  public readonly isExternal = computed(() => {
    const source = this.contract()?.source;
    return !!source && source !== 'Crm';
  });
  public readonly isInsurance = computed(() => this.contract()?.nature === 'Insurance');
  public readonly isBanking = computed(() => !!this.contract()?.accountRef || !!this.contract()?.loanRef);

  public readonly showSubscriptions = computed(
    () => this.isInsurance() && !!this.holdingId() && this._insuranceReadable() && this._canFollowSubscriptions(),
  );
  public readonly showClaims = computed(
    () => this.isInsurance() && !!this.contract()?.policyId && this._insuranceReadable() && this._canViewClaims(),
  );
  public readonly canRefreshBalance = computed(() => !!this.contract()?.accountRef && this._canViewLiveBalance());

  public readonly title = computed(() => {
    const c = this.contract();
    return c?.label?.trim() || c?.productCode || 'Contrat';
  });

  public readonly sourceNotice = computed(() => {
    const source = this.contract()?.source;
    if (source === 'Insurer') {
      return "Ce contrat n'existe que chez l'assureur : il n'a pas été souscrit depuis le CRM. Il se consulte ici, il se gère chez l'assureur.";
    }
    if (source === 'CoreBanking') {
      return "Ce compte n'existe qu'à la banque : aucun contrat du CRM ne lui correspond. Il se consulte ici, il se gère dans le système bancaire.";
    }
    return null;
  });

  public readonly externalStatus = computed<{ label: string; severity: Severity } | null>(() => {
    const c = this.contract();
    if (!c) return null;
    const status = c.source === 'Crm' ? c.externalStatus : c.status;
    if (!status) return null;
    if (c.nature === 'Insurance') {
      return c.premiumOutstanding ? { label: 'Prime en attente', severity: 'warning' } : policyStatusMeta(status);
    }
    return { label: status, severity: 'neutral' };
  });

  public readonly amountLabel = computed(() => {
    const c = this.contract();
    return c?.amount == null ? '—' : formatAmount(c.amount, c.currency);
  });
  public readonly amountCaption = computed(() => {
    const kind = this.contract()?.amountKind;
    return kind ? (AMOUNT_KIND_LABELS[kind] ?? kind) : 'Montant';
  });

  constructor() {
    effect(() => {
      const clientId = this.clientId();
      const key = this.contractKey();
      if (clientId && key) untracked(() => this._load(clientId, key));
    });
  }

  public reload(): void {
    const clientId = this.clientId();
    if (clientId) this._load(clientId, this.contractKey(), false);
  }

  public reloadClaims(): void {
    this._claims()?.load();
  }

  public formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const [year, month, day] = value.slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : value;
  }

  public refreshBalance(): void {
    const accountRef = this.contract()?.accountRef;
    if (!accountRef) return;

    this.isRefreshing.set(true);
    this.balanceNotice.set(null);
    this._integration
      .getLiveBalance(this.clientId(), accountRef)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          // 404 dit « aucun solde disponible » (compte inconnu, hors périmètre, aucun solde
          // détenu), jamais un refus : on le dit dans la carte plutôt qu'en erreur.
          this.balanceNotice.set(
            error?.status === 404
              ? "La banque n'a renvoyé aucun solde pour ce compte."
              : "Le solde n'a pas pu être lu. Réessayez dans un instant.",
          );
          return EMPTY;
        }),
        finalize(() => this.isRefreshing.set(false)),
      )
      .subscribe((balance) => this.liveBalance.set(balance));
  }

  private _load(clientId: string, key: string, initial = true): void {
    if (initial) {
      this.isLoading.set(true);
      this.notFound.set(false);
      this.loadFailed.set(false);
      this.policy.set(null);
      this.policyFailed.set(false);
      this.liveBalance.set(null);
      this.balanceNotice.set(null);
    }

    this._holdingsApi
      .listClientContracts(clientId)
      .pipe(
        catchError(() => {
          if (initial) this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((result) => {
        const found = (result.items ?? []).find((c) => c.key === key) ?? null;
        this.contract.set(found);
        this.coreBankingAsOf.set(result.coreBankingAsOf ?? null);
        this.unavailableSources.set(result.unavailableSources ?? []);
        this.notFound.set(!found && !key.startsWith('holding:'));
        if (found?.policyId) this._loadPolicy(clientId, found.policyId);
      });
  }

  /** Le bloc de la police prend la police entière ; la liste du client la donne. */
  private _loadPolicy(clientId: string, policyId: string): void {
    if (!this._canViewPolicy() || !this._insuranceReadable()) return;
    this._integration
      .listPolicies(clientId)
      .pipe(
        catchError(() => {
          this.policyFailed.set(true);
          return of([] as InsurancePolicyDto[]);
        }),
      )
      .subscribe((policies) => {
        const policy = policies.find((p) => p.id === policyId) ?? null;
        // Le même identifiant : on garde l'instance déjà montée, sinon le bloc se recrée et
        // perd ce que l'agent était en train de saisir.
        if (policy?.id !== this.policy()?.id) this.policy.set(policy);
      });
  }
}

export default ClientContratPage;
