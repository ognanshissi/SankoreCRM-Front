import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormField } from '@angular/forms/signals';
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
import { TasIcon } from '@talisoft/ui/icon';
import { TasFormField, TasError, TasLabel } from '@talisoft/ui/form-field';
import { TasInputPhone } from '@talisoft/ui/input-phone';
import { TasSpinner } from '@talisoft/ui/spinner';
import {
  AgenciesApiService,
  CaptureLeadRequest,
  CaptureLeadRequestChannelEnum,
  CaptureLeadRequestGenderEnum,
  CaptureLeadRequestProspectTypeEnum,
  CaptureLeadRequestSourceEnum,
  CaptureLeadResult,
  ClientSearchItemDto,
  ClientsApiService,
  DuplicateMatchResult,
  DuplicateMatchResultStatusEnum,
  EntityFormDto,
  FormsApiService,
  HoldingDto,
  LeadsApiService,
  OpportunitiesApiService,
  OpportunityDto,
  ProductHoldingsApiService,
} from '@sankore/crm-api';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  asEnum,
  DuplicateRefusal,
  DuplicateWarningBanner,
  EntityFormFieldTemplate,
  EntityFormRenderer,
  explainFormError,
  formErrorDetail,
  PERMISSIONS,
  PermissionsService,
  WireValues,
} from '@sankore/crm/common';
import {
  CustomerMatchBanner,
  CustomerMatchView,
  customerMatchViewFromClient,
} from '../edit-lead/customer-match-banner';

/**
 * Les champs d'une DEMANDE pour un client existant : l'identité, l'origine et l'affectation
 * viennent de sa fiche et ne sont pas ressaisies, et les champs personnalisés du lead ne
 * s'appliquent pas à une opportunité. Tout le reste de la mise en page est masqué dans ce cas.
 */
const DEMAND_FIELDS = ['phoneNumber', 'interestedProduct', 'desiredAmount', 'channel', 'comment'];

/** Une valeur texte du formulaire, ou null. */
function text(values: WireValues, key: string): string | null {
  const v = values[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Un montant du formulaire (`{ amount, currency }`), ou null. */
function money(values: WireValues, key: string): { amount: number; currency: string } | null {
  const v = values[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
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

/**
 * Le corps d'un refus pour doublon, ou `null` si l'erreur est autre chose.
 *
 * `POST leads/capture` refuse en **409** avec un `CaptureLeadResult` en guise de corps : ce
 * n'est pas une panne, c'est la réponse du portail. Le test porte sur `duplicateDetected` et
 * pas seulement sur le statut — un 409 d'une autre nature (un proxy, une future règle) ne doit
 * pas être présenté comme un doublon.
 */
function duplicateRefusalBody(error: HttpErrorResponse): CaptureLeadResult | null {
  if (error.status !== 409) return null;

  const body = error.error as CaptureLeadResult | string | null;

  // `error.error` est une chaîne quand le corps n'a pas pu être lu comme du JSON.
  if (!body || typeof body !== 'object') return null;

  return body.duplicateDetected === true ? body : null;
}

/**
 * Le titre et le message du refus, construits à partir de ce que le serveur a renvoyé.
 *
 * Il renvoie le nom, le statut et un résumé de correspondance déjà rédigé
 * (« 80% — Téléphone identique (normalisé) + Nom très similaire (100%) ») : une phrase générique
 * à la place obligeait l'agent à deviner lequel de ses champs avait déclenché le refus.
 *
 * Le cas « déjà client » est distingué des autres parce que la suite n'est pas la même : sur un
 * lead encore ouvert on reprend celui-là, sur un lead converti c'est une demande à ajouter au
 * client — ce que « un lead existant correspond déjà à ce contact » ne disait pas.
 */
function duplicateRefusalText(duplicates: DuplicateMatchResult[]): [string, string] {
  const first = duplicates[0];

  if (!first) {
    // Le serveur a refusé sans nommer de correspondance : rare, mais le refus reste vrai et
    // l'annoncer vaut mieux que de laisser l'écran muet.
    return [
      'Doublon détecté',
      "Le lead n'a pas été créé : un contact existant correspond déjà à cette saisie.",
    ];
  }

  const who = first.fullName?.trim() || 'Un contact existant';
  const converted = first.status === DuplicateMatchResultStatusEnum.Converted;

  const title = converted ? 'Contact déjà client' : 'Doublon détecté';

  const head = converted
    ? `${who} est déjà client : le lead n'a pas été créé.`
    : `${who} a déjà un lead en cours : le lead n'a pas été créé.`;

  const why = first.confidenceSummary?.trim();

  const others =
    duplicates.length > 1
      ? ` ${duplicates.length - 1} autre correspondance${duplicates.length > 2 ? 's' : ''} dans le bandeau.`
      : '';

  return [title, why ? `${head} ${why}.${others}` : `${head}${others}`];
}

/**
 * Le message d'une erreur de capture qui n'est pas un doublon.
 *
 * Un 422 porte sa raison dans `detail` — le serveur y met l'erreur métier telle quelle — et la
 * masquer derrière « réessayez plus tard » est exactement ce qui coûte une heure, puisque
 * réessayer ne change rien à une validation refusée.
 */
function captureErrorMessage(error: HttpErrorResponse, form: EntityFormDto | null): string {
  const explained = explainFormError(formErrorDetail(error), form);
  if (explained) return explained;

  const detail = error.error?.detail ?? error.error?.title;
  if (typeof detail === 'string' && detail.trim().length > 0) return detail;

  return error.status === 403
    ? "Vous n'avez pas le droit de créer un lead."
    : 'Impossible de créer le lead, réessayez plus tard.';
}

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
    TasIcon,
    TasInputPhone,
    TasSpinner,
    FormField,
    EntityFormRenderer,
    EntityFormFieldTemplate,
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
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _formsApi = inject(FormsApiService);
  private readonly _clientsApiService = inject(ClientsApiService);
  private readonly _holdingsApiService = inject(ProductHoldingsApiService);
  private readonly _opportunitiesApiService = inject(OpportunitiesApiService);
  private readonly _permissions = inject(PermissionsService);

  /** Le lien vers la fiche client n'est proposé qu'à qui peut la lire. */
  public readonly canReadCustomers = this._permissions.can(PERMISSIONS.CUSTOMERS_READ);

  /**
   * La demande d'un client existant est une opportunité, et son endpoint exige sa propre
   * habilitation. Vérifiée ici plutôt que laissée au 403 : l'agent apprend qu'il ne peut pas
   * servir ce client avant d'avoir saisi le produit, pas après.
   */
  public readonly canManageOpportunities = this._permissions.can(
    PERMISSIONS.LEAD_OPPORTUNITY_MANAGE,
  );

  public duplicates = signal<DuplicateMatchResult[]>([]);

  /**
   * Le refus prononcé par le serveur, affiché dans le bandeau du drawer.
   *
   * Dans le drawer et non dans un toast : le toast disparaît au bout de cinq secondes alors que
   * le formulaire, lui, reste à l'écran dans l'état exact qui a été refusé — l'agent relisait un
   * message qui n'était plus là pour comprendre pourquoi « Créer » ne faisait rien.
   */
  public refusal = signal<DuplicateRefusal | null>(null);

  /**
   * Le bandeau, pour le ramener dans le champ de vision. Il est en haut du formulaire et le
   * bouton est en pied de drawer : sans recentrage, le refus s'afficherait hors écran — ce qui
   * était précisément l'argument du toast.
   */
  private readonly _duplicateBanner = viewChild<ElementRef<HTMLElement>>('duplicateBanner');

  /**
   * Nombre de demandes déjà ouvertes sur le même client et le même produit, quand le serveur a
   * refusé pour cette raison. `null` = aucun refus en cours.
   */
  public demandDuplicateCount = signal<number | null>(null);

  /** L'agent a vu les demandes existantes et insiste : le prochain envoi part en `force`. */
  private readonly _demandDuplicateAcknowledged = signal(false);

  /** Idem côté lead : « ce n'est pas la même personne ». */
  private readonly _leadDuplicateAcknowledged = signal(false);

  /** Une résolution « c'est ce client » est en cours — deux clics ne doivent pas la relancer. */
  public isResolvingDuplicate = signal(false);

  /**
   * Le client retenu depuis un doublon converti, qui n'est PAS dans les correspondances : la
   * recherche client se fait sur le téléphone, et ce chemin sert justement les cas où elle n'a
   * rien trouvé.
   */
  private readonly _retainedFromDuplicate = signal<CustomerMatchView | null>(null);
  public isCheckingDuplicates = signal(false);

  // ——— Le formulaire du tenant (formulaires dynamiques, lot 5) ———

  /** La mise en page « Lead » du tenant ; la création rapide en affiche les champs cochés. */
  public readonly form = signal<EntityFormDto | null>(null);
  public readonly formLoadFailed = signal(false);
  public readonly submitting = signal(false);

  private readonly _renderer = viewChild(EntityFormRenderer);
  private readonly _values = computed<WireValues>(() => this._renderer()?.wireValues() ?? {});

  /** Ce que les détections lisent : le téléphone, l'e-mail, le produit demandé. */
  public readonly phone = computed(() => text(this._values(), 'phoneNumber') ?? '');
  public readonly email = computed(() => text(this._values(), 'email') ?? '');
  public readonly product = computed(() => text(this._values(), 'interestedProduct') ?? '');

  /** Un client retenu réduit le formulaire à la demande ; sinon tout ce que la mise en page propose. */
  public readonly excluded = computed(() =>
    this.isExistingCustomer()
      ? (this.form()?.fields ?? []).map((f) => f.key ?? '').filter((k) => !DEMAND_FIELDS.includes(k))
      : [],
  );

  public agencies = signal<{ label: string; value: string }[]>([]);

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
    const product = this.product();
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
  public readonly retainedCustomer = computed(() => {
    const selected = this.selectedCustomerId();
    if (!selected) return null;

    const fromDuplicate = this._retainedFromDuplicate();
    if (fromDuplicate?.customerId === selected) return fromDuplicate;

    return this.customerMatches().find((m) => m.customerId === selected) ?? null;
  });

  public readonly isExistingCustomer = computed(() => this.retainedCustomer() !== null);

  constructor() {
    this.loadForm();
    this._loadAgencies();
    this._watchLeadDuplicates();
    this._watchCustomerMatches();
  }

  public loadForm(): void {
    this.formLoadFailed.set(false);
    this._formsApi.getEntityForm('Lead').subscribe({
      next: (form) => this.form.set(form),
      error: () => this.formLoadFailed.set(true),
    });
  }

  /**
   * Deux écritures, et c'est le client retenu qui tranche entre elles.
   *
   * <b>Un client existant qui demande un nouveau produit n'est pas un lead, c'est une demande
   * sur sa fiche.</b> Le bouton le disait déjà — « Créer la demande » — mais l'écran capturait un
   * lead, que l'onglet « Demandes » du client ne montre jamais : il liste des opportunités
   * (`GET leads/opportunities?customerId=`). La demande atterrissait donc hors de l'endroit où
   * l'agent allait la chercher, et le serveur la refusait par-dessus le marché, sa garde de
   * doublon reconnaissant le lead dont ce client est justement issu.
   *
   * Les deux se corrigent du même geste. Au passage, la règle de doublon qui s'applique devient
   * la bonne : même client + même produit + demande encore ouverte, au lieu de « quelqu'un qui
   * ressemble à cette personne existe déjà ».
   */
  public async handleSubmit(): Promise<void> {
    const renderer = this._renderer();
    if (!renderer || this.submitting()) return;

    if (!renderer.valid()) {
      renderer.markAllAsTouched();
      return;
    }

    // Les refus de la tentative précédente : le bandeau et l'encart doivent parler de CET
    // envoi, et une réponse qui reste affichée pendant que la requête repart se lit comme une
    // réponse déjà rendue. L'accusé de doublon, lui, survit — c'est lui qui porte le
    // « créer quand même » jusqu'au serveur.
    this.refusal.set(null);
    this.demandDuplicateCount.set(null);

    const customer = this.retainedCustomer();

    this.submitting.set(true);
    try {
      await (customer
        ? this._createDemandForCustomer(renderer.wireValues(), customer)
        : this._captureLead(renderer));
    } finally {
      this.submitting.set(false);
    }
  }

  /** « Créer quand même » sur une demande en double : l'agent a vu les demandes existantes. */
  public createDemandAnyway(): void {
    this._demandDuplicateAcknowledged.set(true);
    this.handleSubmit();
  }

  /** « Ce n'est pas la même personne » : repose la capture en passant outre la détection. */
  public createLeadAnyway(): void {
    this._leadDuplicateAcknowledged.set(true);
    this.handleSubmit();
  }

  /**
   * « C'est ce client » depuis le refus : le doublon est un lead converti, donc il y a une fiche
   * client derrière. On la résout puis on la retient, ce qui bascule la soumission sur la branche
   * demande — c'est la sortie du cas où la recherche client par téléphone ne retrouve pas la
   * fiche alors que la dédup de lead, elle, a reconnu la personne.
   */
  public async retainCustomerOfDuplicate(duplicate: DuplicateMatchResult): Promise<void> {
    const leadId = duplicate.leadId;
    if (!leadId || this.isResolvingDuplicate()) return;

    this.isResolvingDuplicate.set(true);

    const converted = await firstValueFrom(
      this._leadsApiService.getLead(leadId).pipe(catchError(() => of(null))),
    );

    this.isResolvingDuplicate.set(false);

    const customerId = converted?.convertedToCustomerId;

    if (!customerId) {
      this._snackbarService.error(
        'Fiche client introuvable',
        "Ce lead n'est relié à aucune fiche client : créez la demande depuis la fiche, ou "
          + 'indiquez qu\'il ne s\'agit pas de la même personne.',
      );
      return;
    }

    // La fiche n'est pas forcément dans les correspondances déjà chargées : la recherche client
    // se fait sur le téléphone, et ce chemin existe précisément pour les cas où elle n'a rien
    // trouvé. On la charge donc pour en faire une correspondance retenue à part entière.
    const client = await firstValueFrom(
      this._clientsApiService.getClient(customerId).pipe(catchError(() => of(null))),
    );

    if (!client) {
      this._snackbarService.error(
        'Fiche client illisible',
        "La fiche de ce client n'a pas pu être chargée.",
      );
      return;
    }

    this._retainedFromDuplicate.set(
      customerMatchViewFromClient(client, {
        isExact: true,
        matchedOn: ['Phone'],
        requestedProductCode: this.product(),
      }),
    );

    this._customerRejected.set(false);
    this.selectedCustomerId.set(customerId);
    this.refusal.set(null);
  }

  // ── Les deux écritures ───────────────────────────────────────────────────

  /**
   * La demande d'un client connu : une opportunité rattachée à sa fiche, créée en UN appel.
   *
   * Avant, c'était une capture suivie d'un `PUT leads/{id}/customer` — deux écritures dont la
   * seconde pouvait échouer seule, laissant un lead qui se présente comme un prospect neuf
   * pendant qu'un toast disait le contraire. Il n'y a plus de demi-état possible.
   */
  private async _createDemandForCustomer(
    values: WireValues,
    customer: CustomerMatchView,
  ): Promise<void> {
    const product = text(values, 'interestedProduct') ?? '';
    const amount = money(values, 'desiredAmount');

    const result = await firstValueFrom(
      this._opportunitiesApiService
        .createOpportunityForCustomer({
          customerEntityId: customer.customerId,
          title: `Demande — ${product}`,
          product,
          description: text(values, 'comment'),
          // Le conseiller de la fiche, comme le fait l'onglet « Demandes » : sans titulaire, la
          // demande arrive sans agent assigné, qui est l'une des colonnes de cette liste.
          ownerId: customer.advisorUserId,
          estimatedAmount: amount?.amount ?? null,
          estimatedCurrency: amount?.currency ?? null,
          customerPhone: text(values, 'phoneNumber'),
          force: this._demandDuplicateAcknowledged(),
        })
        .pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbarService.error('Erreur', captureErrorMessage(error, this.form()));
            return of(null);
          }),
        ),
    );

    if (!result) return;

    // Ce refus-ci arrive en **200**, pas en 409 comme celui de la capture : deux endpoints
    // voisins, deux conventions opposées. D'où le test sur le corps et non sur une erreur.
    if (result.duplicateDetected && !result.opportunityId) {
      this.demandDuplicateCount.set(result.existingOpportunityIds?.length ?? 0);
      this._revealDuplicateBanner();
      return;
    }

    this._snackbarService.success(
      'Demande créée',
      'La demande est rattachée au client et apparaît dans sa fiche.',
    );

    this._demandDuplicateAcknowledged.set(false);

    // Fermé sans identifiant : aucun lead n'a été créé, la liste des leads n'a rien à recharger.
    this._dialogRef.close(null);
    this._router.navigate(['/customers', customer.customerId, 'demandes']);
  }

  /** La capture d'un prospect neuf — le chemin d'origine, inchangé dans son principe. */
  private async _captureLead(renderer: EntityFormRenderer): Promise<void> {
    const v = renderer.wireValues();
    // Un champ masqué par sa condition n'est pas envoyé : un nom d'entreprise saisi puis rendu
    // invisible en repassant le type à « Particulier » n'appartient plus à ce lead.
    const shown = (key: string) => (renderer.isVisible(key) ? text(v, key) : null);
    const amount = money(v, 'desiredAmount');

    const request: CaptureLeadRequest = {
      prospectType: asEnum(CaptureLeadRequestProspectTypeEnum, v['prospectType']) ?? CaptureLeadRequestProspectTypeEnum.Individual,
      firstName: shown('firstName'),
      lastName: shown('lastName'),
      gender: asEnum(CaptureLeadRequestGenderEnum, v['gender']) ?? null,
      dateOfBirth: shown('dateOfBirth'),
      nationalId: shown('nationalId'),
      companyName: shown('companyName'),
      companyEmail: shown('companyEmail'),
      companyPhone: shown('companyPhone'),
      website: shown('website'),
      phoneNumber: text(v, 'phoneNumber'),
      email: shown('email'),
      preferredLanguage: text(v, 'preferredLanguage') ?? 'fr',
      interestedProduct: text(v, 'interestedProduct'),
      desiredAmount: amount?.amount ?? null,
      desiredCurrency: amount?.currency ?? null,
      comment: shown('comment'),
      source: asEnum(CaptureLeadRequestSourceEnum, v['source']) ?? CaptureLeadRequestSourceEnum.Agency,
      leadSourceConfigId: shown('leadSourceConfigId'),
      channel: asEnum(CaptureLeadRequestChannelEnum, v['channel']) ?? null,
      campaign: shown('campaign'),
      externalReference: shown('externalReference'),
      customerReference: shown('customerReference'),
      agencyId: shown('agencyId'),
      preferredAgencyId: shown('preferredAgencyId'),
      ownerId: shown('ownerId'),
      customFields: renderer.customFieldsPayload(),
      force: this._leadDuplicateAcknowledged(),
    };

    // `POST leads/capture` répond **409** quand il refuse la création pour cause de doublon
    // (`GateMode: Block`, le défaut du serveur) — et le corps de ce 409 est un
    // `CaptureLeadResult` complet, pas un problème HTTP. Il arrive donc par le canal
    // d'erreur : le refus était annoncé « réessayez plus tard », et la branche qui sait
    // l'afficher ne pouvait jamais s'exécuter puisqu'un corps sans `leadId` n'arrive
    // jamais par le canal nominal.
    const result = await firstValueFrom(
      this._leadsApiService.captureLead(request).pipe(
        catchError((error: HttpErrorResponse) => {
          const refusal = duplicateRefusalBody(error);
          if (refusal) return of(refusal);

          this._snackbarService.error('Erreur', captureErrorMessage(error, this.form()));

          // `of(null)` et non `EMPTY` : `firstValueFrom` d'un flux vide ne vaut pas
          // `undefined`, il **rejette** avec `EmptyError` — et cette promesse-là est celle
          // que `submit()` attend, donc l'erreur réseau ressortait en rejet non géré.
          return of(null);
        }),
      ),
    );

    if (!result) return;

    // Le serveur a refusé la création en renvoyant les doublons au lieu d'un identifiant.
    // On les montre dans le bandeau plutôt que de naviguer vers un lead qui n'existe pas.
    if (!result.leadId) {
      const duplicates = result.potentialDuplicates ?? [];
      this.duplicates.set(duplicates);

      const [title, message] = duplicateRefusalText(duplicates);
      this.refusal.set({ title, message });
      this._revealDuplicateBanner();
      return;
    }

    this._snackbarService.success('Succès', 'Lead créé avec succès');
    this._leadDuplicateAcknowledged.set(false);
    this._dialogRef.close(result.leadId);
    this._router.navigate(['/leads', result.leadId]);
  }

  /**
   * Ramène le bandeau à l'écran après un refus.
   *
   * `setTimeout` et non un appel direct : le bandeau ne prend sa hauteur définitive qu'après le
   * cycle de détection déclenché par `refusal.set(...)`, et recentrer avant donne une position
   * calculée sur l'ancienne taille — soit un bandeau à moitié visible.
   */
  private _revealDuplicateBanner(): void {
    setTimeout(() =>
      this._duplicateBanner()?.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      }),
    );
  }

  /** « C'est ce client ». */
  public retainCustomer(match: CustomerMatchView): void {
    this._customerRejected.set(false);
    this.selectedCustomerId.set(match.customerId);

    // On change de destinataire : le refus affiché et l'accord de passer outre portaient sur
    // l'autre, et les garder ferait créer en `force` une demande que personne n'a vue refusée.
    this._resetDuplicateAnswers();
  }

  /** « Nouveau prospect » : le choix est mémorisé pour la suite de la saisie. */
  public rejectCustomers(): void {
    this._customerRejected.set(true);
    this.selectedCustomerId.set(null);
    this._retainedFromDuplicate.set(null);
    this._resetDuplicateAnswers();
  }

  private _resetDuplicateAnswers(): void {
    this.refusal.set(null);
    this.demandDuplicateCount.set(null);
    this._demandDuplicateAcknowledged.set(false);
    this._leadDuplicateAcknowledged.set(false);
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

  /** Doublons de **lead** sur téléphone ou e-mail (BNF-F-01). */
  private _watchLeadDuplicates(): void {
    const phone$ = toObservable(this.phone);
    const email$ = toObservable(this.email);

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
        // La saisie a changé : le refus prononcé sur l'ancienne ne vaut plus, et le laisser
        // afficher ferait lire « le lead n'a pas été créé » à propos d'un numéro corrigé.
        tap(() => {
          // La saisie a changé : ni le refus ni l'accord pour passer outre ne valent plus. Un
          // `force` qui survivrait à un changement de téléphone ferait créer sans contrôle un
          // lead que personne n'a regardé.
          this.refusal.set(null);
          this._leadDuplicateAcknowledged.set(false);
          this.isCheckingDuplicates.set(true);
        }),
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
    toObservable(this.phone)
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        map((phone) => (phone ?? '').replace(/[^0-9+]/g, '')),
        debounceTime(300),
        distinctUntilChanged(),
        tap((phone) => {
          if (phone.length < MIN_PHONE_LENGTH) {
            this._matchRaw.set([]);
            this.selectedCustomerId.set(null);
            this._retainedFromDuplicate.set(null);
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
        // Le client retenu depuis un doublon n'est pas dans `raws` — il vient d'un lead converti,
        // pas de la recherche par téléphone. Il tombe quand même ici, et c'est voulu : ce bloc ne
        // s'exécute que sur un NOUVEAU numéro, donc sur une autre personne que celle qu'il
        // désignait.
        const stillValid = raws.some((r) => r.client.id === this.selectedCustomerId());

        if (!stillValid) {
          this.selectedCustomerId.set(null);
          this._retainedFromDuplicate.set(null);
        }
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
