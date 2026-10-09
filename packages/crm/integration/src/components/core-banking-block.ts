import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { LiveBalanceDto } from '@sankore/crm-api';
import { PermissionsService } from '@sankore/crm/common';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { KycCapsPanel } from '@sankore/crm/kyc';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { EMPTY, catchError, finalize } from 'rxjs';
import {
  CbsProvisioningService,
  CbsProvisioningStatus,
  cbsCapabilities,
} from '../data-access/cbs-provisioning.service';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../data-access/integration-facade.service';
import { formatAmount, formatContractDate } from '../data-access/integration-referential';
import { CbsProvisioningStatusComponent } from './cbs-provisioning-status';

/**
 * Un compte du client tel que le bloc l'afficherait.
 *
 * Déclaré en `type` et non en `interface` : `TasTable<T extends TableEntity>` exige une
 * signature d'index, que TypeScript n'accorde implicitement qu'aux alias de type.
 */
export type CbsAccountRow = {
  accountId: string;
  productName: string;
  accountRef: string;
  balance: number | null;
  currency: string | null;
  asOf: string | null;
  isStale: boolean;
};

export type CbsLoanRow = {
  loanId: string;
  productName: string;
  outstanding: number | null;
  currency: string | null;
  nextInstalmentDate: string | null;
  nextInstalmentAmount: number | null;
};

/** Flux du mois, tel que le bloc l'afficherait. */
export type CbsMonthlyFlow = {
  inflow: number;
  outflow: number;
  currency: string | null;
  asOf: string;
};

/**
 * Bloc « Core banking » de la fiche client — INT-23.
 *
 * **Les comptes, les prêts et le flux du mois n'ont aucun endpoint.** Le contrat
 * `/api/v1/integration/**` offre, côté core banking : la connexion active, les commandes, la
 * référence externe d'une entité, et `GET balance/{crmCustomerId}?accountRef=` — qui **exige
 * une référence de compte déjà connue** et ne liste rien. Aucune route ne renvoie les comptes
 * ni les prêts d'un client, ni un agrégat de mouvements.
 *
 * Deux mauvaises réponses à ça : peupler le bloc de données factices, qui fait croire la
 * fonctionnalité livrée, ou supprimer les tableaux, qui fait oublier ce qui manque. Le bloc
 * porte donc la structure réelle, branchée sur des collections vides et typées, avec un état
 * vide qui dit en langage d'agent ce qui est disponible en attendant. Précédent exact de ce
 * choix : `packages/crm/customers/src/containers/client-detail/groupes.ts`.
 *
 * À l'arrivée des endpoints : brancher `accounts`, `loans` et `monthlyFlow` sur les appels
 * correspondants, et remplacer le champ « Référence de compte » par un bouton d'actualisation
 * par ligne de compte.
 */
@Component({
  selector: 'core-banking-block',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './core-banking-block.html',
  imports: [
    DatePipe,
    FormsModule,
    TasCard,
    TasIcon,
    TasTag,
    TasSpinner,
    TasTable,
    TasFormField,
    TasLabel,
    TasInput,
    Button,
    TimeagoPipe,
    CbsProvisioningStatusComponent,
    KycCapsPanel,
  ],
})
export class CoreBankingBlockComponent {
  private readonly _service = inject(CbsProvisioningService);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly customerId = input.required<string>();

  public readonly canViewLive = this._permissions.can('CoreBanking.Balance.ViewLive');

  public readonly status = signal<CbsProvisioningStatus | null>(null);
  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);

  /**
   * Points d'entrée uniques des comptes, des prêts et du flux du mois. Ils restent vides faute
   * d'endpoint : brancher ici la lecture suffira à faire vivre les tableaux ci-dessous, sans
   * toucher au gabarit.
   */
  public readonly accounts = signal<CbsAccountRow[]>([]);
  public readonly loans = signal<CbsLoanRow[]>([]);
  public readonly monthlyFlow = signal<CbsMonthlyFlow | null>(null);

  /**
   * « Actualiser le solde » exige une référence de compte que le contrat n'offre aucun moyen de
   * lister. Le champ ci-dessous est donc la seule façon honnête de rendre l'action utilisable :
   * l'agent saisit la référence qu'il connaît. Quand la liste des comptes existera, le bouton
   * passera sur chaque ligne et ce champ disparaîtra.
   *
   * Champ de recherche, pas de formulaire : aucune validation, aucune soumission, rien à
   * enregistrer — c'est l'exception `[ngModel]` documentée du repo, pas un contournement des
   * signal forms.
   */
  public readonly accountRefQuery = signal('');
  public readonly liveBalance = signal<LiveBalanceDto | null>(null);
  public readonly isRefreshing = signal(false);
  /** « Aucun solde disponible » n'est pas une panne : c'est une réponse, affichée dans le bloc. */
  public readonly balanceNotice = signal<string | null>(null);

  public readonly externalCustomerNumber = computed(
    () => this.status()?.externalCustomerNumber ?? null,
  );

  /** Le client existe-t-il dans le CBS ? Sinon le bloc montre l'état de création (INT-19). */
  public readonly isCreatedInCbs = computed(() => this.status()?.state === 'Created');

  public readonly capabilities = computed(() =>
    cbsCapabilities(this.status()?.connectionKind, this.status()?.connectionMode),
  );

  /**
   * Les actions que le système du tenant ne sait pas faire sont masquées (critère INT-23).
   * Le droit et la capacité sont deux refus distincts : sans le droit, rien n'est dit — ce
   * n'est pas à l'agent de savoir ce qu'il ne peut pas voir ; sans la capacité, on dit pourquoi.
   */
  public readonly showRefreshBalance = computed(
    () => this.canViewLive() && this.capabilities().canReadLiveBalance,
  );

  public readonly liveBalanceUnsupportedReason = computed(() =>
    this.canViewLive() ? this.capabilities().liveBalanceUnsupportedReason : null,
  );

  /**
   * Date de fraîcheur du bloc. Toujours affichée : c'est elle qui dit si on peut se fier aux
   * chiffres. `null` tant qu'aucun solde n'a été lu — et le gabarit le dit, plutôt que
   * d'afficher la date du jour, qui ferait passer « rien lu » pour « lu à l'instant ».
   */
  public readonly asOf = computed(() => this.liveBalance()?.asOf ?? null);

  /**
   * « isStale is the field to render: false means the figure comes from the CBS (now, or within
   * the last 60 seconds); true means the CBS could not be reached … and the figure is the last
   * synchronised one, true as of asOf. **Never show a stale figure as current.** »
   *
   * Un chiffre périmé est donc marqué, et accompagné de sa date — sans message d'erreur
   * bloquant, le critère d'acceptation l'exige. Ne « nettoie » pas ce signalement : il est la
   * seule chose qui distingue un solde du CBS d'un souvenir.
   */
  public readonly isStale = computed(() => this.liveBalance()?.isStale === true);

  public readonly accountsTableConfig = signal<TableConfig>({
    property: 'accountId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20, 50] },
  });

  public readonly loansTableConfig = signal<TableConfig>({
    property: 'loanId',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 20, 50] },
  });

  /** Le bloc est monté dans une fiche qui change de client sans être détruite. */
  private readonly _reload = effect(() => {
    const customerId = this.customerId();
    this.status.set(null);
    this.liveBalance.set(null);
    this.balanceNotice.set(null);
    this.accountRefQuery.set('');
    if (customerId) this._load(customerId);
  });

  public amount(value: number | null | undefined, currency: string | null | undefined): string {
    return formatAmount(value, currency);
  }

  public contractDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public refreshBalance(): void {
    const accountRef = this.accountRefQuery().trim();
    if (!accountRef) {
      this.balanceNotice.set('Indiquez la référence du compte à interroger.');
      return;
    }

    this.isRefreshing.set(true);
    this.balanceNotice.set(null);

    this._facade
      .getLiveBalance(this.customerId(), accountRef)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          // 404 INTEGRATION_BALANCE_NOT_AVAILABLE couvre quatre cas — client inconnu, hors
          // périmètre d'agence, compte qui n'est pas le sien, aucun solde détenu — et « never
          // 403 », pour qu'on ne puisse pas sonder les clients d'une autre agence. Ce n'est donc
          // ni une panne ni un refus de droit : c'est « aucun solde disponible », dit dans le bloc.
          if (error?.status === 404) {
            this.balanceNotice.set(
              "Aucun solde disponible pour cette référence de compte. Vérifiez la référence : le compte peut appartenir à un autre client ou à une autre agence.",
            );
            return EMPTY;
          }
          this._snackbar.error(
            'Solde non lu',
            integrationErrorMessage(error, "Le solde n'a pas pu être lu."),
          );
          return EMPTY;
        }),
        finalize(() => this.isRefreshing.set(false)),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((balance) => this.liveBalance.set(balance));
  }

  private _load(customerId: string): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._service
      .getStatus(customerId)
      .pipe(
        catchError(() => {
          this.loadError.set(
            "Les informations du système bancaire n'ont pas pu être lues. Réessayez dans un instant.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((status) => {
        this.status.set(status);
        this.isLoading.set(false);
      });
  }
}
