import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { Router } from '@angular/router';
import { email, form, FormField, FormRoot, required, submit } from '@angular/forms/signals';
import {
  catchError,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  firstValueFrom,
  forkJoin,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TasTitle } from '@talisoft/ui/title';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasError, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasInputPhone } from '@talisoft/ui/input-phone';
import {
  AgenciesApiService,
  CaptureLeadRequest,
  CaptureLeadRequestChannelEnum,
  CaptureLeadRequestProspectTypeEnum,
  CaptureLeadRequestSourceEnum,
  ClientSearchItemDto,
  ClientsApiService,
  DuplicateMatchResult,
  HoldingDto,
  LeadSourceListDtoStatusEnum,
  LeadSourcesApiService,
  LeadsApiService,
  OpportunitiesApiService,
  OpportunityDto,
  ProductHoldingsApiService,
  ProductsApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { DuplicateWarningBanner, PERMISSIONS, PermissionsService } from '@sankore/crm/common';
import {
  CustomerMatchBanner,
  CustomerMatchView,
  customerMatchViewFromClient,
} from '../edit-lead/customer-match-banner';

export class CreateLeadFormModel {
  public firstName!: string;
  public lastName!: string;
  public phoneNumber!: string;
  public email!: string;
  public nationalId!: string;
  public prospectType!: CaptureLeadRequestProspectTypeEnum;
  public companyName!: string;
  public source!: CaptureLeadRequestSourceEnum;
  /**
   * Source **configurée** d'où vient le lead (`leadSourceConfigId`). Facultatif : un lead saisi au
   * guichet peut n'être rattaché à aucune source paramétrée. Chaîne vide = aucune.
   */
  public leadSourceConfigId!: string;
  public interestedProduct!: string;
  public desiredAmount!: string;
  public desiredCurrency!: string;
  public agencyId!: string;
  /** Canal d'entrée de la demande (BNF-F-18 : produit, canal, commentaire). */
  public channel!: string;
  public comment!: string;

  public static instantiate(): CreateLeadFormModel {
    const m = new CreateLeadFormModel();
    m.firstName = '';
    m.lastName = '';
    m.phoneNumber = '';
    m.email = '';
    m.nationalId = '';
    m.prospectType = CaptureLeadRequestProspectTypeEnum.Individual;
    m.companyName = '';
    m.source = CaptureLeadRequestSourceEnum.Agency;
    m.leadSourceConfigId = '';
    m.interestedProduct = '';
    m.desiredAmount = '';
    m.desiredCurrency = 'XOF';
    m.agencyId = '';
    m.channel = CaptureLeadRequestChannelEnum.Agency;
    m.comment = '';
    return m;
  }
}

/**
 * `prospectType` est une énumération de **chaînes** au contrat. Les valeurs étaient écrites
 * `NUMBER_0`/`NUMBER_1`, les noms que le générateur ne produit que pour une énumération numérique,
 * puis repassées par `.toString()` — ce qui envoyait « 0 » et « 1 ». `tas-select` travaillant déjà
 * en chaînes, le nom du contrat convient directement et aucune conversion n'est nécessaire.
 */
export const PROSPECT_TYPE_OPTIONS = [
  { label: 'Individuel', value: CaptureLeadRequestProspectTypeEnum.Individual },
  { label: 'Entreprise', value: CaptureLeadRequestProspectTypeEnum.Corporate },
];

export const CURRENCY_OPTIONS = [
  { label: 'XOF', value: 'XOF' },
  { label: 'EUR', value: 'EUR' },
  { label: 'USD', value: 'USD' },
];

/** Les onze canaux de `CaptureLeadRequestChannelEnum`, dans l'ordre du contrat. */
export const CHANNEL_OPTIONS = [
  { label: 'Agence', value: CaptureLeadRequestChannelEnum.Agency },
  { label: 'Centre d\'appels', value: CaptureLeadRequestChannelEnum.CallCenter },
  { label: 'Site web', value: CaptureLeadRequestChannelEnum.Web },
  { label: 'Agent mobile', value: CaptureLeadRequestChannelEnum.MobileAgent },
  { label: 'SMS', value: CaptureLeadRequestChannelEnum.Sms },
  { label: 'USSD', value: CaptureLeadRequestChannelEnum.Ussd },
  { label: 'WhatsApp', value: CaptureLeadRequestChannelEnum.WhatsApp },
  { label: 'Parrainage', value: CaptureLeadRequestChannelEnum.Referral },
  { label: 'Partenaire', value: CaptureLeadRequestChannelEnum.Partner },
  { label: 'Import', value: CaptureLeadRequestChannelEnum.Import },
  { label: 'Campagne marketing', value: CaptureLeadRequestChannelEnum.MarketingCampaign },
];

/** Longueur minimale d'un numéro avant d'interroger le serveur. */
const MIN_PHONE_LENGTH = 8;

/** Au-delà, l'encart cesse d'aider : la saisie est trop imprécise pour trancher. */
const MAX_CANDIDATES = 5;

/** Une correspondance client, avec ses produits et demandes, avant mise en forme. */
interface CustomerMatchRaw {
  client: ClientSearchItemDto;
  holdings: HoldingDto[] | null;
  opportunities: OpportunityDto[] | null;
}

@Component({
  selector: 'create-lead',
  templateUrl: './create-lead.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasTitle,
    Button,
    TasFormField,
    TasLabel,
    TasError,
    TasHint,
    TasInput,
    TasSelect,
    TasInputPhone,
    FormRoot,
    FormField,
    DuplicateWarningBanner,
    CustomerMatchBanner,
  ],
})
export class CreateLeadComponent {
  private readonly _dialogRef = inject(DialogRef);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _leadSourcesApiService = inject(LeadSourcesApiService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _productSpecialitiesService = inject(ProductsApiService);
  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _holdingsApiService = inject(ProductHoldingsApiService);
  private readonly _opportunitiesApiService = inject(OpportunitiesApiService);
  private readonly _permissions = inject(PermissionsService);

  /** Le lien vers la fiche client n'est proposé qu'à qui peut la lire. */
  public readonly canReadCustomers = this._permissions.can(PERMISSIONS.CUSTOMERS_READ);

  public duplicates = signal<DuplicateMatchResult[]>([]);
  public isCheckingDuplicates = signal(false);

  public readonly prospectTypeOptions = PROSPECT_TYPE_OPTIONS;
  public readonly channelOptions = CHANNEL_OPTIONS;

  /**
   * Sources configurées proposées à la saisie, depuis Paramétrage › Sources & Campagnes.
   *
   * Les sources **archivées sont exclues** : on consulte l'historique d'une source archivée, on ne
   * lui attribue pas un lead créé aujourd'hui. C'est l'inverse du filtre de la liste des leads, qui
   * les garde pour ne pas rendre leurs leads introuvables.
   */
  public leadSourceOptions = signal<{ label: string; value: string }[]>([
    { label: 'Aucune', value: '' },
  ]);
  public readonly currencyOptions = CURRENCY_OPTIONS;

  public agencies = signal<{ label: string; value: string }[]>([]);
  public model = signal(CreateLeadFormModel.instantiate());
  public productOptions = toSignal(
    this._productSpecialitiesService.listProducts().pipe(
      map((products) =>
        products.map((product) => ({
          name: product.name,
          code: product.code,
        })),
      ),
    ),
  );

  // ——— Détection d'un client existant (BNF-F-18) ———

  private readonly _matchRaw = signal<CustomerMatchRaw[]>([]);
  public isCheckingCustomers = signal(false);
  public customerLookupFailed = signal(false);

  /** Client retenu par l'agent, ou proposé par défaut sur correspondance exacte. */
  public selectedCustomerId = signal<string | null>(null);

  /**
   * L'agent a explicitement répondu « Nouveau prospect ». Mémorisé pour ne pas
   * re-proposer le rattachement à chaque frappe suivante : une correspondance exacte
   * est re-proposée par défaut, et sans ce drapeau le refus serait annulé au caractère
   * suivant.
   */
  private readonly _customerRejected = signal(false);

  public formSchema = form(this.model, (schema) => {
    // Le `when` ne dépend que de `selectedCustomerId` : quand un client existant est
    // retenu, les champs d'identité sont masqués et ne doivent plus bloquer la
    // soumission — l'identité vient de la fiche client, elle n'est pas ressaisie.
    required(schema.firstName, {
      message: 'Le prénom est obligatoire',
      when: () => this.selectedCustomerId() === null,
    });
    required(schema.lastName, {
      message: 'Le nom est obligatoire',
      when: () => this.selectedCustomerId() === null,
    });
    required(schema.phoneNumber, {
      message: 'Le numéro de téléphone est obligatoire',
    });
    // Facultatif, mais validé au format dès qu'il est renseigné (BNF-F-01).
    email(schema.email, { message: 'Adresse e-mail invalide' });
  });

  public isCompany = computed(
    () => this.formSchema.prospectType().value() === CaptureLeadRequestProspectTypeEnum.Corporate,
  );

  private readonly _agencyNames = computed(() => {
    const index: Record<string, string> = {};
    for (const a of this.agencies()) index[a.value] = a.label;
    return index;
  });

  /**
   * Les correspondances mises en forme. Recalculées quand le produit demandé change :
   * les alertes « demande ouverte / produit actif sur la même ligne » en dépendent.
   */
  public readonly customerMatches = computed<CustomerMatchView[]>(() => {
    const raws = this._matchRaw();
    const names = this._agencyNames();
    const product = this.formSchema.interestedProduct().value();
    // `searchClients` fait une égalité sur l'index aveugle du téléphone : un résultat
    // unique est donc une correspondance exacte, plusieurs résultats une ambiguïté qui
    // demande un choix explicite.
    const isExact = raws.length === 1;
    return raws.map((raw) =>
      customerMatchViewFromClient(raw.client, {
        isExact,
        matchedOn: ['Phone'],
        agencyLabel: names[raw.client.agencyId ?? ''] ?? null,
        products: raw.holdings,
        opportunities: raw.opportunities,
        requestedProductCode: product,
      }),
    );
  });

  /** Le client existant retenu : c'est lui qui réduit le parcours de création. */
  public readonly retainedCustomer = computed(
    () => this.customerMatches().find((m) => m.customerId === this.selectedCustomerId()) ?? null,
  );

  public readonly isExistingCustomer = computed(() => this.retainedCustomer() !== null);

  constructor() {
    this._loadAgencies();
    this._loadLeadSources();
    this._watchLeadDuplicates();
    this._watchCustomerMatches();
  }

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const customer = this.retainedCustomer();

      // Quand un client existant est retenu, aucune identité n'est renvoyée : seuls le
      // produit demandé, le canal et le commentaire partent, et l'agence est celle du
      // client. `fullName` est repris de la fiche client — ce n'est pas une saisie, et
      // sans lui le lead arriverait sans nom dans la liste.
      const request: CaptureLeadRequest = customer
        ? {
            fullName: customer.displayName,
            phoneNumber: value.phoneNumber || null,
            prospectType: value.prospectType,
            source: value.source,
            channel: (value.channel || null) as CaptureLeadRequestChannelEnum | null,
            interestedProduct: value.interestedProduct || null,
            agencyId: customer.agencyId ?? null,
            customerReference: customer.clientNumber,
            comment: value.comment || null,
          }
        : {
            firstName: value.firstName || null,
            lastName: value.lastName || null,
            phoneNumber: value.phoneNumber || null,
            email: value.email || null,
            nationalId: value.nationalId || null,
            prospectType: value.prospectType,
            companyName: this.isCompany() ? value.companyName || null : null,
            source: value.source,
            channel: (value.channel || null) as CaptureLeadRequestChannelEnum | null,
            leadSourceConfigId: value.leadSourceConfigId || null,
            interestedProduct: value.interestedProduct || null,
            desiredAmount: value.desiredAmount ? Number(value.desiredAmount) : null,
            desiredCurrency: value.desiredCurrency || null,
            agencyId: value.agencyId || null,
            comment: value.comment || null,
          };

      const result = await firstValueFrom(
        this._leadsApiService.captureLead(request).pipe(
          catchError(() => {
            this._snackbarService.error(
              'Erreur',
              'Impossible de créer le lead, réessayez plus tard.',
            );
            return EMPTY;
          }),
        ),
      );

      if (!result) return;

      // Le serveur peut refuser la création en renvoyant les doublons au lieu d'un
      // identifiant (mode « Block »). On les montre dans le bandeau plutôt que de
      // naviguer vers un lead qui n'existe pas.
      if (!result.leadId) {
        this.duplicates.set(result.potentialDuplicates ?? []);
        this._snackbarService.error(
          'Doublon détecté',
          'Le lead n\'a pas été créé : un lead existant correspond déjà à ce contact.',
        );
        return;
      }

      if (customer) {
        await this._attachToCustomer(result.leadId, customer);
      }

      this._snackbarService.success('Succès', 'Lead créé avec succès');
      this._dialogRef.close(result.leadId);
      this._router.navigate(['/leads', result.leadId]);
    });
  }

  /** « C'est ce client ». */
  public retainCustomer(match: CustomerMatchView): void {
    this._customerRejected.set(false);
    this.selectedCustomerId.set(match.customerId);
  }

  /** « Nouveau prospect » : le choix est mémorisé pour la suite de la saisie. */
  public rejectCustomers(): void {
    this._customerRejected.set(true);
    this.selectedCustomerId.set(null);
  }

  public viewCustomer(customerId: string): void {
    this._dialogRef.close();
    this._router.navigate(['/customers', customerId, 'identite']);
  }

  public viewDuplicate(leadId: string): void {
    this._dialogRef.close();
    this._router.navigate(['/leads', leadId]);
  }

  public close(): void {
    this._dialogRef.close();
  }

  /**
   * Rattachement explicite après création : `captureLead` ne prend pas d'identifiant
   * client au contrat (seulement `customerReference`), et `PUT /leads/{id}/customer`
   * (BNF-B-22) est le seul geste qui lie réellement le lead au client. Son échec ne
   * doit pas perdre le lead déjà créé — on le dit et on laisse l'agent finir depuis la
   * fiche.
   */
  private async _attachToCustomer(leadId: string, customer: CustomerMatchView): Promise<void> {
    let failed = false;
    await firstValueFrom(
      this._leadsApiService
        .attachLeadToCustomer(leadId, {
          customerId: customer.customerId,
          reason: customer.isExact
            ? 'Client existant retenu à la création (correspondance exacte sur le téléphone)'
            : 'Client existant retenu à la création (correspondance partielle confirmée par l\'agent)',
          expectedUpdatedAt: null,
        })
        .pipe(
          catchError(() => {
            failed = true;
            return of(null);
          }),
        ),
    );

    if (failed) {
      this._snackbarService.error(
        'Rattachement échoué',
        'Le lead a été créé mais n\'a pas pu être rattaché au client. Rattachez-le depuis la fiche lead.',
      );
    }
  }

  /** Doublons de **lead** sur téléphone ou e-mail (BNF-F-01). */
  private _watchLeadDuplicates(): void {
    const phone$ = toObservable(computed(() => this.formSchema.phoneNumber().value()));
    const email$ = toObservable(computed(() => this.formSchema.email().value()));

    combineLatest([phone$, email$])
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        map(([phone, mail]) => ({
          phone: (phone ?? '').replace(/[^0-9+]/g, ''),
          email: (mail ?? '').trim(),
        })),
        filter(({ phone, email: mail }) => phone.length >= MIN_PHONE_LENGTH || mail.includes('@')),
        debounceTime(300),
        distinctUntilChanged((a, b) => a.phone === b.phone && a.email === b.email),
        tap(() => this.isCheckingDuplicates.set(true)),
        switchMap(({ phone, email: mail }) =>
          this._leadsApiService
            .findLeadDuplicates(
              phone.length >= MIN_PHONE_LENGTH ? phone : undefined,
              mail.includes('@') ? mail : undefined,
            )
            .pipe(catchError(() => of([] as DuplicateMatchResult[]))),
        ),
      )
      .subscribe((results) => {
        this.duplicates.set(results ?? []);
        this.isCheckingDuplicates.set(false);
      });
  }

  /**
   * Détection d'un **client existant** avant création (BNF-F-18).
   *
   * `getLeadCustomerMatches` (BNF-B-22) demande un `leadId` : il n'est donc pas
   * appelable ici. La seule détection possible avant création est la recherche client,
   * et son seul critère de contact au contrat est `phone` — matché par égalité sur
   * l'index aveugle, donc insensible au formatage. Il n'y a **pas** de filtre e-mail sur
   * `GET /clients` : la détection par e-mail n'est pas réalisable côté client.
   */
  private _watchCustomerMatches(): void {
    toObservable(computed(() => this.formSchema.phoneNumber().value()))
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        map((phone) => (phone ?? '').replace(/[^0-9+]/g, '')),
        debounceTime(300),
        distinctUntilChanged(),
        tap((phone) => {
          if (phone.length < MIN_PHONE_LENGTH) {
            this._matchRaw.set([]);
            this.selectedCustomerId.set(null);
            this.customerLookupFailed.set(false);
          }
        }),
        filter((phone) => phone.length >= MIN_PHONE_LENGTH),
        tap(() => {
          this.isCheckingCustomers.set(true);
          this.customerLookupFailed.set(false);
        }),
        switchMap((phone) =>
          this._clientsApiService
            .searchClients(
              undefined,
              phone,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              1,
              MAX_CANDIDATES,
            )
            .pipe(
              switchMap((page) => this._withProductsAndRequests(page.items ?? [])),
              catchError(() => {
                // L'échec de la détection ne bloque pas la création : l'encart affiche
                // un message et le reste du formulaire continue de fonctionner.
                this.customerLookupFailed.set(true);
                return of([] as CustomerMatchRaw[]);
              }),
            ),
        ),
      )
      .subscribe((raws) => {
        this._matchRaw.set(raws);
        this.isCheckingCustomers.set(false);

        // Correspondance exacte et unique : le rattachement est proposé par défaut,
        // sauf si l'agent a déjà répondu « Nouveau prospect ».
        const stillValid = raws.some((r) => r.client.id === this.selectedCustomerId());
        if (!stillValid) this.selectedCustomerId.set(null);
        if (raws.length === 1 && !this._customerRejected() && !stillValid) {
          this.selectedCustomerId.set(raws[0].client.id ?? null);
        }
      });
  }

  /**
   * Produits détenus et demandes en cours de chaque candidat : ce sont les deux
   * informations que l'encart doit montrer (produits détenus) et sur lesquelles porte
   * l'alerte « demande ouverte ou produit actif sur la même ligne de produit ».
   * Chaque appel retombe sur `null` pour qu'un refus de droit n'emporte pas l'encart.
   */
  private _withProductsAndRequests(clients: ClientSearchItemDto[]) {
    if (clients.length === 0) return of([] as CustomerMatchRaw[]);
    return forkJoin(
      clients.map((client) =>
        forkJoin({
          holdings: this._holdingsApiService
            .listClientHoldings(client.id!, undefined, undefined, 1, 50)
            .pipe(
              map((page) => page.items ?? []),
              catchError(() => of(null)),
            ),
          opportunities: this._opportunitiesApiService
            .listOpportunities(undefined, client.id!)
            .pipe(catchError(() => of(null))),
        }).pipe(map(({ holdings, opportunities }) => ({ client, holdings, opportunities }))),
      ),
    );
  }

  private _loadLeadSources(): void {
    this._leadSourcesApiService
      .listLeadSources(undefined, undefined, undefined, undefined, 1, 200)
      .pipe(
        map((res) => [
          { label: 'Aucune', value: '' },
          ...(res.items ?? [])
            .filter((source) => source.status !== LeadSourceListDtoStatusEnum.Archived)
            .map((source) => ({
              label: source.label?.trim() || source.code?.trim() || 'Source sans nom',
              value: source.id ?? '',
            })),
        ]),
        catchError(() => {
          // Le champ est facultatif : son indisponibilité ne doit pas empêcher de créer un lead.
          // La liste reste réduite à « Aucune », le reste du formulaire fonctionne.
          return EMPTY;
        }),
      )
      .subscribe((options) => this.leadSourceOptions.set(options));
  }

  private _loadAgencies(): void {
    this._agenciesApiService
      .listAgencies(false, 1, 200)
      .pipe(
        map((res) =>
          (res.items ?? []).map((a) => ({
            label: a.name ?? '',
            value: a.id ?? '',
          })),
        ),
      )
      .subscribe({
        next: (opts) => this.agencies.set(opts),
      });
  }
}
