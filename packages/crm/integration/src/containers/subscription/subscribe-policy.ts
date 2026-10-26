import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { form, FormField, FormRoot, submit, validate } from '@angular/forms/signals';
import { Router } from '@angular/router';
import { BreadcrumbService, PermissionsService, TENANT_MODULES, TenantModulesService } from '@sankore/crm/common';
import {
  ClientDetailDto,
  ClientsApiService,
  HoldingDto,
  InformationSheetDeliveryDto,
  InsuranceDistributionApiService,
  InsuranceDistributorDto,
  InsuranceProductDto,
  InsuranceQuoteDto,
  InsuranceSubscriptionDto,
  IntegrationApiService,
  LiveBalanceDto,
  ProductHoldingsApiService,
  RecordDeliveryRequestChannelEnum,
  RecordPremiumPaymentRequestPaymentMethodEnum,
  SubscribeInsurancePolicyRequestConsentChannelEnum,
  SubscribeInsurancePolicyRequestPaymentMethodEnum,
  SubscribeInsurancePolicyRequestPaymentModeEnum,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY, firstValueFrom, map, Observable, of } from 'rxjs';
import { InsuranceProductPreview } from '../../components/insurance-product-preview';
import { IntegrationFacadeService, integrationErrorMessage } from '../../data-access/integration-facade.service';
import {
  formatAmount,
  formatContractDate,
  INSURANCE_PERIODICITY_LABELS,
  INSURANCE_PRICING_MODE_LABELS,
  InsurancePeriodicity,
  InsurancePricingMode,
  notOfferableReasonLabel,
  quoteSourceLabel,
} from '../../data-access/integration-referential';

/** Les catégories du catalogue que réalise un produit d'assurance. */
const INSURANCE_CATEGORIES = ['Insurance', 'HealthInsurance', 'ForecastInsurance'];

/**
 * Le consentement final et sa version. Son empreinte SHA-256 part avec la preuve : c'est ce qui
 * permet de dire, des années plus tard, quel texte a été accepté. Changer une phrase oblige à
 * changer la version. Le contenu du contrat, lui, est dans la fiche d'information de l'assureur.
 */
export const SUBSCRIPTION_NOTICE_VERSION = 'CONSENTEMENT-ASS-2026-10';
export const SUBSCRIPTION_NOTICE: readonly string[] = [
  "J'ai reçu la fiche d'information du produit avant de signer, et j'en ai pris connaissance.",
  "Le contrat prend effet à la date indiquée, sous réserve du paiement de la prime : il n'est pas en vigueur avant.",
  "Les réponses aux questionnaires sont transmises à l'assureur telles que signées ; une déclaration inexacte peut m'être opposée lors d'un sinistre.",
  "Les données collectées servent à la gestion du contrat et sont transmises à l'assureur. Je peux y accéder et les faire rectifier.",
];

export type SubscriptionProductRow = { id: string; product: InsuranceProductDto; isOfferable: boolean; reasonLabels: string[] };
export type SubscriptionHoldingRow = { id: string; holding: HoldingDto; ready: boolean; hint: string };

type Mode = SubscribeInsurancePolicyRequestPaymentModeEnum;
const MODES = SubscribeInsurancePolicyRequestPaymentModeEnum;

const PAYMENT_METHOD_OPTIONS = [
  { value: 'Cash', label: 'Espèces au guichet' },
  { value: 'MobileMoney', label: 'Mobile Money' },
  { value: 'BankTransfer', label: 'Virement' },
  { value: 'Cheque', label: 'Chèque' },
];

const CONSENT_CHANNEL_OPTIONS = [
  { value: SubscribeInsurancePolicyRequestConsentChannelEnum.PaperAtCounter, label: 'Bulletin papier signé au guichet' },
  { value: SubscribeInsurancePolicyRequestConsentChannelEnum.ElectronicSignaturePad, label: 'Tablette de signature' },
  { value: SubscribeInsurancePolicyRequestConsentChannelEnum.OneTimeCode, label: 'Code à usage unique' },
  { value: SubscribeInsurancePolicyRequestConsentChannelEnum.CustomerChannel, label: 'Espace client' },
];

const DELIVERY_CHANNEL_OPTIONS = [
  { value: RecordDeliveryRequestChannelEnum.HandedOnPaper, label: 'Remise en main propre (papier)' },
  { value: RecordDeliveryRequestChannelEnum.ShownOnScreen, label: "Lue avec le client à l'écran" },
  { value: RecordDeliveryRequestChannelEnum.SentByEmail, label: 'Envoyée par e-mail' },
  { value: RecordDeliveryRequestChannelEnum.CustomerSpace, label: 'Mise à disposition dans son espace' },
];

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  Prepared: 'Préparée, en attente d’envoi',
  PendingDebit: 'Prélèvement de la prime en cours',
  Debited: "Prime prélevée — en attente de l'assureur",
  PaymentRecorded: "Prime encaissée — en attente de l'assureur",
  AwaitingPremium: "Envoyée à l'assureur — prime à payer",
  Issued: 'Police émise',
  DebitFailed: 'Prélèvement refusé : rien n’a été envoyé à l’assureur',
  Reversing: "Refusée par l'assureur — remboursement de la prime en cours",
  Reversed: "Refusée par l'assureur — prime remboursée",
  PremiumRefundDue: "Refusée par l'assureur — prime à rembourser au client",
  Refused: "Refusée par l'assureur — aucune prime n'avait été encaissée",
  Cancelled: 'Annulée',
};

const TERMINAL_STATUSES = ['Issued', 'DebitFailed', 'Reversed', 'PremiumRefundDue', 'Refused', 'Cancelled'];

class DeliveryFormModel {
  public channel!: string;
  public acknowledgementReference!: string;
  public static instantiate(): DeliveryFormModel {
    const m = new DeliveryFormModel();
    m.channel = RecordDeliveryRequestChannelEnum.HandedOnPaper;
    m.acknowledgementReference = '';
    return m;
  }
}

class SignatureFormModel {
  public signatureReference!: string;
  public static instantiate(): SignatureFormModel {
    const m = new SignatureFormModel();
    m.signatureReference = '';
    return m;
  }
}

class FinaliseFormModel {
  public paymentMode!: Mode;
  public accountRef!: string;
  public paymentMethod!: string;
  public paymentReference!: string;
  public paidOn!: string;
  public commitmentReference!: string;
  public commitmentSignedOn!: string;
  public consentChannel!: string;
  public consentEvidence!: string;
  public consentGiven!: boolean;

  public static instantiate(mode: Mode): FinaliseFormModel {
    const m = new FinaliseFormModel();
    m.paymentMode = mode;
    m.accountRef = '';
    m.paymentMethod = '';
    m.paymentReference = '';
    m.paidOn = todayIso();
    m.commitmentReference = '';
    m.commitmentSignedOn = todayIso();
    m.consentChannel = SubscribeInsurancePolicyRequestConsentChannelEnum.PaperAtCounter;
    m.consentEvidence = '';
    m.consentGiven = false;
    return m;
  }
}

class LatePaymentFormModel {
  public paymentMethod!: string;
  public paymentReference!: string;
  public paidOn!: string;
  public static instantiate(): LatePaymentFormModel {
    const m = new LatePaymentFormModel();
    m.paymentMethod = '';
    m.paymentReference = '';
    m.paidOn = todayIso();
    return m;
  }
}

/**
 * Souscrire une assurance — du contrat préparé à l'envoi chez l'assureur.
 *
 * Le contrat est le produit détenu du client (choix du propriétaire) : sa ligne, ses termes et sa
 * clause bénéficiaire se saisissent depuis la fiche client, ou s'ouvrent quand un projet est gagné.
 * Cet écran fait ensuite, dans l'ordre que la réglementation impose (lot 2) :
 * 1. le produit de l'assureur ;
 * 2. la remise de sa fiche d'information, prouvée (version, empreinte, canal, accusé) ;
 * 3. la signature, refusée par le serveur sans fiche remise ;
 * 4. le paiement de la prime — prélevée ou encaissée si l'assureur en a donné mandat, sinon
 *    encaissée par l'assureur ; ou sous 60 jours (dérogation) au-delà de 80 × SMIG annuel —, le
 *    consentement, puis l'envoi. Le contrat n'est en vigueur qu'une fois la prime payée.
 */
@Component({
  selector: 'integration-subscribe-policy',
  templateUrl: './subscribe-policy.html',
  imports: [
    TasAlert, Button, TasCard, TasDatePicker, TasError, TasFormField, TasHint, TasIcon, TasInput,
    TasLabel, TasSelect, TasSpinner, TasTable, TasTag, TimeagoPipe, FormRoot, FormField, InsuranceProductPreview,
  ],
})
export class SubscribePolicyPage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _integration = inject(IntegrationApiService);
  private readonly _distribution = inject(InsuranceDistributionApiService);
  private readonly _clients = inject(ClientsApiService);
  private readonly _holdings = inject(ProductHoldingsApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _tenantModules = inject(TenantModulesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  public readonly customerId = input.required<string>();
  /** Le contrat à poursuivre, quand on arrive depuis sa fiche (`?holding=`). */
  public readonly holding = input<string | undefined>();

  public readonly hasBanking = computed(() => this._tenantModules.has(TENANT_MODULES.BANKING_MICROFINANCE));
  private readonly _hasBalancePermission = this._permissions.can('CoreBanking.Balance.ViewLive');

  public readonly steps = [
    { index: 1, label: 'Contrat' },
    { index: 2, label: "Produit de l'assureur" },
    { index: 3, label: "Fiche d'information" },
    { index: 4, label: 'Signature' },
    { index: 5, label: 'Paiement et envoi' },
  ] as const;
  public readonly currentStep = signal<1 | 2 | 3 | 4 | 5>(1);

  public readonly notice = SUBSCRIPTION_NOTICE;
  public readonly noticeVersion = SUBSCRIPTION_NOTICE_VERSION;
  public readonly paymentMethodOptions = PAYMENT_METHOD_OPTIONS;
  public readonly consentChannelOptions = CONSENT_CHANNEL_OPTIONS;
  public readonly deliveryChannelOptions = DELIVERY_CHANNEL_OPTIONS;
  public readonly modes = MODES;
  public readonly today = todayIso();

  // ——— Client et distributeur ———

  public readonly client = signal<ClientDetailDto | null>(null);
  public readonly isLoadingClient = signal(true);
  public readonly clientDisplayName = computed(() => this.client()?.displayName || this.client()?.legalName || '—');

  public readonly distributor = signal<InsuranceDistributorDto | null>(null);
  /** Pièces du distributeur échues ou absentes : toute nouvelle souscription est refusée. */
  public readonly distributorBlocked = computed(() => this.distributor() !== null && this.distributor()?.inGoodStanding !== true);
  public readonly distributorProblems = computed(() => {
    const d = this.distributor();
    if (!d) return [];
    if (!d.status) return ['le profil de distributeur n’est pas renseigné'];
    return [
      ...(d.missingDocuments ?? []).map((k) => `${documentLabel(k)} absente`),
      ...(d.expiredDocuments ?? []).map((k) => `${documentLabel(k)} échue`),
    ];
  });

  // ——— Étape 1 — contrat ———

  public readonly isLoadingHoldings = signal(true);
  public readonly holdingsError = signal<string | null>(null);
  public readonly holdingRows = signal<SubscriptionHoldingRow[]>([]);
  public readonly selectedHoldingId = signal<string | null>(null);
  public readonly selectedHolding = computed(
    () => this.holdingRows().find((row) => row.id === this.selectedHoldingId())?.holding ?? null,
  );
  public readonly isSigned = computed(() => !!this.selectedHolding()?.signedAt);
  public readonly holdingTableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25] },
  });

  // ——— Étape 2 — produit ———

  public readonly isLoadingProducts = signal(true);
  public readonly products = signal<InsuranceProductDto[]>([]);
  public readonly productsError = signal<string | null>(null);
  public readonly productsForbidden = signal(false);
  public readonly selectedProductId = signal<string | null>(null);
  public readonly selectedProduct = computed(
    () => this.products().find((p) => p.id === this.selectedProductId()) ?? null,
  );
  public readonly productRows = computed<SubscriptionProductRow[]>(() => {
    const code = (this.selectedHolding()?.productCode ?? '').trim().toUpperCase();
    return this.products()
      .filter((p) => (p.crmProductCode ?? '').trim().toUpperCase() === code)
      .map((product) => ({
        id: product.id ?? '',
        product,
        isOfferable: product.isOfferable === true,
        reasonLabels: (product.notOfferableReasons ?? []).map(notOfferableReasonLabel),
      }))
      .sort((a, b) => Number(b.isOfferable) - Number(a.isOfferable));
  });
  public readonly productTableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 10, pageSizeOptions: [10, 25] },
  });
  public readonly exclusions = computed(() =>
    (this.selectedProduct()?.exclusions ?? '').split('\n').map((l) => l.trim()).filter(Boolean),
  );

  // ——— Étape 3 — fiche d'information ———

  public readonly deliveries = signal<InformationSheetDeliveryDto[]>([]);
  public readonly isOpeningSheet = signal(false);
  /** La remise retenue : la plus récente pour ce produit. */
  public readonly delivery = computed(
    () => this.deliveries().find((d) => d.productId === this.selectedProductId()) ?? null,
  );
  /** Signé AVANT la remise : la signature doit être reprise après la fiche. */
  public readonly signedBeforeSheet = computed(() => {
    const signedAt = this.selectedHolding()?.signedAt;
    const delivered = this.delivery()?.deliveredAt;
    return !!signedAt && (!delivered || delivered > signedAt);
  });
  public deliveryModel = signal(DeliveryFormModel.instantiate());
  public deliveryForm = form(this.deliveryModel, (schema) => {
    validate(schema.acknowledgementReference, ({ value }) =>
      (value() ?? '').trim() ? null : { kind: 'required', message: "L'accusé de réception du client est obligatoire" },
    );
  });

  // ——— Étape 4 — signature ———

  public signatureModel = signal(SignatureFormModel.instantiate());
  public signatureForm = form(this.signatureModel, (schema) => {
    validate(schema.signatureReference, ({ value }) =>
      (value() ?? '').trim() ? null : { kind: 'required', message: 'La référence du bulletin signé est obligatoire' },
    );
  });

  // ——— Étape 5 — prime, paiement, consentement ———

  public readonly isQuoting = signal(false);
  public readonly quote = signal<InsuranceQuoteDto | null>(null);
  public readonly quoteError = signal<string | null>(null);
  public readonly premiumAmount = computed<number | null>(() => {
    const p = this.selectedProduct();
    if (!p) return null;
    return p.pricingMode === 'InsurerComputed' ? (this.quote()?.premiumAmount ?? null) : (p.fixedPremiumAmount ?? null);
  });
  public readonly premiumCurrency = computed(() => this.quote()?.currency ?? this.selectedProduct()?.currency ?? null);
  public readonly premiumLabel = computed(() => formatAmount(this.premiumAmount(), this.premiumCurrency()));
  public readonly periodicityLabel = computed(() => {
    const p = (this.quote()?.periodicity ?? this.selectedProduct()?.periodicity) as InsurancePeriodicity | undefined;
    return p ? INSURANCE_PERIODICITY_LABELS[p] : '—';
  });
  public readonly priceSourceLabel = computed(() => {
    const quote = this.quote();
    if (quote) return quoteSourceLabel(quote.source);
    const mode = this.selectedProduct()?.pricingMode as InsurancePricingMode | undefined;
    return mode ? INSURANCE_PRICING_MODE_LABELS[mode] : '—';
  });

  /** Mandat d'encaissement de l'assureur : sans lui, l'assureur encaisse lui-même. */
  public readonly hasMandate = computed(() => this.selectedProduct()?.insurerCollectionMandate === true);
  public readonly derogationThreshold = computed(() => this.distributor()?.derogationThreshold ?? null);
  public readonly derogationAllowed = computed(() => {
    const threshold = this.derogationThreshold();
    const premium = this.premiumAmount();
    return threshold !== null && premium !== null && premium > threshold;
  });
  public readonly availableModes = computed<Mode[]>(() => {
    const modes: Mode[] = [];
    if (this.hasMandate()) {
      if (this.hasBanking()) modes.push(MODES.CoreBankingDebit);
      modes.push(MODES.RecordedByAgent);
    }
    modes.push(MODES.InsurerCollects);
    if (this.derogationAllowed()) modes.push(MODES.DeferredByDerogation);
    return modes;
  });
  public readonly canViewBalance = computed(() => this._hasBalancePermission() && this.hasBanking());
  public readonly isLoadingBalance = signal(false);
  public readonly balance = signal<LiveBalanceDto | null>(null);
  public readonly balanceUnavailable = signal(false);
  public readonly balanceError = signal<string | null>(null);
  public readonly availableBalanceLabel = computed(() => {
    const b = this.balance();
    return b ? formatAmount(b.availableBalance ?? b.balance, b.currency) : '—';
  });

  public model = signal(FinaliseFormModel.instantiate(MODES.InsurerCollects));
  public formSchema = form(this.model, (schema) => {
    validate(schema.accountRef, ({ value, valueOf }) =>
      valueOf(schema.paymentMode) === MODES.CoreBankingDebit && !(value() ?? '').trim()
        ? { kind: 'required', message: 'La référence du compte à débiter est obligatoire' } : null,
    );
    validate(schema.paymentMethod, ({ value, valueOf }) =>
      valueOf(schema.paymentMode) === MODES.RecordedByAgent && !value()
        ? { kind: 'required', message: 'Indiquez comment la prime a été payée' } : null,
    );
    validate(schema.paymentReference, ({ value, valueOf }) =>
      valueOf(schema.paymentMode) === MODES.RecordedByAgent && !(value() ?? '').trim()
        ? { kind: 'required', message: 'La référence du reçu ou de la transaction est obligatoire' } : null,
    );
    validate(schema.paidOn, ({ value, valueOf }) => {
      if (valueOf(schema.paymentMode) !== MODES.RecordedByAgent) return null;
      const raw = (value() ?? '').slice(0, 10);
      if (!raw) return { kind: 'required', message: "La date d'encaissement est obligatoire" };
      return raw > todayIso() ? { kind: 'maxDate', message: "La date d'encaissement ne peut pas être dans le futur" } : null;
    });
    validate(schema.commitmentReference, ({ value, valueOf }) =>
      valueOf(schema.paymentMode) === MODES.DeferredByDerogation && !(value() ?? '').trim()
        ? { kind: 'required', message: "La référence de l'engagement écrit est obligatoire" } : null,
    );
    validate(schema.commitmentSignedOn, ({ value, valueOf }) =>
      valueOf(schema.paymentMode) === MODES.DeferredByDerogation && !value()
        ? { kind: 'required', message: "La date de l'engagement est obligatoire" } : null,
    );
    validate(schema.consentEvidence, ({ value }) =>
      (value() ?? '').trim() ? null : { kind: 'required', message: 'La référence de la preuve est obligatoire' },
    );
    validate(schema.consentGiven, ({ value }) =>
      value() ? null : { kind: 'required', message: 'Le client doit avoir consenti' },
    );
  });

  // ——— Payeur de la prime (lot 4) ———

  /**
   * Un tiers payeur est un client de l'institution, KYC approuvé (choix du propriétaire) : l'origine
   * des fonds est une question LBC/FT, et le serveur refuse tout autre payeur.
   */
  public readonly payerIsOther = signal(false);
  public readonly payerQuery = signal('');
  public readonly payerOptions = signal<{ value: string; label: string }[]>([]);
  public payerModel = signal({ payerId: '' });
  public payerForm = form(this.payerModel);
  public readonly payerId = computed(() => this.payerModel().payerId);
  public readonly isSearchingPayer = signal(false);
  /** Une recherche a tourné sans résultat : sans ce message, la liste restait vide en silence. */
  public readonly payerSearchedEmpty = signal(false);

  public searchPayer(): void {
    const query = this.payerQuery().trim();
    if (query.length < 2) return;
    this.isSearchingPayer.set(true);
    // Un numéro de client se reconnaît à ses chiffres ; sinon on cherche par nom.
    const byNumber = /\d/.test(query);
    this._clients.searchClients(byNumber ? query : undefined, undefined, undefined, byNumber ? undefined : query,
      undefined, undefined, undefined, undefined, undefined, 1, 10).pipe(catchError(() => of(null)))
      .subscribe((page) => {
        this.payerOptions.set((page?.items ?? [])
          .filter((c) => c.id !== this.customerId())
          .map((c) => ({ value: c.id ?? '', label: `${c.displayName ?? '—'} · ${c.clientNumber ?? ''}` })));
        this.payerSearchedEmpty.set(this.payerOptions().length === 0);
        this.isSearchingPayer.set(false);
      });
  }

  // ——— Envoi et suivi ———

  public readonly busy = signal(false);
  public readonly stepError = signal<string | null>(null);
  public readonly subscription = signal<InsuranceSubscriptionDto | null>(null);
  private readonly _premiumConfirmed = signal(false);
  /** La prime reste due : mode « payée plus tard » et pas encore confirmée. */
  public readonly premiumOutstanding = computed(() => {
    const s = this.subscription();
    const mode = this.model().paymentMode;
    return !!s && (mode === MODES.InsurerCollects || mode === MODES.DeferredByDerogation)
      && !['Refused', 'Cancelled'].includes(s.status ?? '') && !this._premiumConfirmed();
  });
  public readonly subscriptionStatusLabel = computed(() => {
    const s = this.subscription();
    if (!s) return '';
    if (s.status === 'Issued' && this.premiumOutstanding()) return 'Police émise — en attente du paiement de la prime';
    return SUBSCRIPTION_STATUS_LABELS[s.status ?? ''] ?? s.status ?? '';
  });
  public readonly isTracking = signal(false);
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollTicks = 0;

  public lateModel = signal(LatePaymentFormModel.instantiate());
  public lateForm = form(this.lateModel, (schema) => {
    validate(schema.paymentMethod, ({ value }) => (value() ? null : { kind: 'required', message: 'Le moyen de paiement est obligatoire' }));
    validate(schema.paymentReference, ({ value }) =>
      (value() ?? '').trim() ? null : { kind: 'required', message: 'La référence est obligatoire' },
    );
  });

  public constructor() {
    inject(DestroyRef).onDestroy(() => this._stopPolling());
  }

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Clients', link: ['/customers'] },
      { label: 'Fiche client', link: ['/customers', this.customerId()] },
      { label: 'Souscrire une assurance' },
    ]);
    this._clients.getClient(this.customerId()).pipe(catchError(() => EMPTY)).subscribe((c) => {
      this.client.set(c);
      this.isLoadingClient.set(false);
    });
    this._distribution.getInsuranceDistributor().pipe(catchError(() => EMPTY)).subscribe((d) => this.distributor.set(d));
    this._loadHoldings();
    this._loadProducts();
  }

  // ——— Navigation ———

  public readonly isStep1Complete = computed(() => this.holdingRows().find((r) => r.id === this.selectedHoldingId())?.ready === true);
  public readonly isStep2Complete = computed(() => this.selectedProduct()?.isOfferable === true);
  public readonly isStep3Complete = computed(() => !!this.delivery() && !this.signedBeforeSheet());
  public readonly isStep4Complete = computed(() => this.isStep3Complete() && this.isSigned());

  public goToStep(step: 1 | 2 | 3 | 4 | 5): void {
    if (this.subscription()) return;
    const gates = [true, this.isStep1Complete(), this.isStep2Complete(), this.isStep3Complete(), this.isStep4Complete()];
    if (gates.slice(0, step).some((ok) => !ok)) return;

    this.stepError.set(null);
    this.currentStep.set(step);
    if (step === 2) this._autoSelectProduct();
    if (step === 3) this._loadDeliveries();
    if (step === 5) {
      this._loadQuote();
      const modes = this.availableModes();
      if (!modes.includes(this.model().paymentMode)) this.model.set(FinaliseFormModel.instantiate(modes[0]));
    }
  }

  public selectHolding(row: SubscriptionHoldingRow): void {
    if (!row.ready) return;
    this.selectedHoldingId.set(row.id);
    this.selectedProductId.set(null);
    this.deliveries.set([]);
    this.quote.set(null);
  }

  public selectProduct(row: SubscriptionProductRow): void {
    if (!row.isOfferable) return;
    this.selectedProductId.set(row.id);
    this.quote.set(null);
    this.quoteError.set(null);
  }

  // ——— Fiche d'information ———

  public openSheet(): void {
    const sheetId = this.selectedProduct()?.informationSheetId;
    if (!sheetId) return;
    this.isOpeningSheet.set(true);
    (this._integration.getInsuranceInformationSheetContent(sheetId) as unknown as Observable<Blob>)
      .pipe(catchError(() => {
        this._snackbar.error('Fiche indisponible', "La fiche d'information n'a pas pu être ouverte.");
        this.isOpeningSheet.set(false);
        return EMPTY;
      }))
      .subscribe((blob) => {
        window.open(URL.createObjectURL(blob), '_blank');
        this.isOpeningSheet.set(false);
      });
  }

  public recordDelivery(): void {
    const holdingId = this.selectedHoldingId();
    const productId = this.selectedProductId();
    if (!holdingId || !productId) return;
    submit(this.deliveryForm, async (field) => {
      const value = field().value();
      const ok = await this._run(
        this._integration.recordInformationSheetDelivery(holdingId, {
          productId,
          channel: value.channel as RecordDeliveryRequestChannelEnum,
          acknowledgementReference: value.acknowledgementReference.trim(),
        }),
        "La remise de la fiche n'a pas pu être enregistrée.",
      );
      if (ok) {
        this._snackbar.success('Fiche remise', 'La remise est prouvée : le client peut maintenant signer.');
        this._loadDeliveries();
      }
    });
  }

  /** Signé avant la fiche : la signature est annulée, la fiche remise, puis le client signe à nouveau. */
  public async cancelSignature(): Promise<void> {
    const holdingId = this.selectedHoldingId();
    if (!holdingId) return;
    if (await this._run(this._holdings.returnHoldingToDraft(holdingId), "La signature n'a pas pu être annulée.")) {
      this._loadHoldings(holdingId);
    }
  }

  // ——— Signature ———

  public sign(): void {
    const holding = this.selectedHolding();
    if (!holding?.holdingId) return;
    const holdingId = holding.holdingId;
    submit(this.signatureForm, async (field) => {
      const reference = field().value().signatureReference.trim();
      if (holding.status === 'Draft'
        && !(await this._run(this._holdings.requestHoldingSignature(holdingId), "Le contrat n'a pas pu être présenté à la signature."))) return;
      const signed = await this._run(
        this._holdings.signHolding(holdingId, { signatureReference: reference, signedAt: new Date().toISOString() }),
        "La signature n'a pas pu être enregistrée.",
      );
      if (signed) {
        this._snackbar.success('Contrat signé', 'Reste le paiement de la prime et l’envoi.');
        this._loadHoldings(holdingId, () => this.goToStep(5));
      }
    });
  }

  // ——— Paiement et envoi ———

  public setPaymentMode(mode: Mode): void {
    this.formSchema.paymentMode().value.set(mode);
  }

  public modeLabel(mode: Mode): string {
    switch (mode) {
      case MODES.CoreBankingDebit: return 'Prélèvement sur le compte du client';
      case MODES.RecordedByAgent: return "Prime encaissée par l'agent";
      case MODES.InsurerCollects: return "Encaissée par l'assureur";
      default: return 'Paiement sous 60 jours (dérogation)';
    }
  }

  public toggleConsent(): void {
    const field = this.formSchema.consentGiven();
    field.value.set(!field.value());
    field.markAsTouched();
  }

  public loadBalance(): void {
    const accountRef = (this.formSchema.accountRef().value() ?? '').trim();
    if (!accountRef || !this.canViewBalance()) return;
    this.isLoadingBalance.set(true);
    this.balanceUnavailable.set(false);
    this.balanceError.set(null);
    this._facade.getLiveBalance(this.customerId(), accountRef).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 404) this.balanceUnavailable.set(true);
        else this.balanceError.set(integrationErrorMessage(err, "Le solde du compte n'a pas pu être lu."));
        this.isLoadingBalance.set(false);
        return EMPTY;
      }),
    ).subscribe((b) => {
      this.balance.set(b);
      this.isLoadingBalance.set(false);
    });
  }

  public handleSubmit(): void {
    const holdingId = this.selectedHoldingId();
    const product = this.selectedProduct();
    if (!holdingId || !product?.id || this.distributorBlocked()) return;
    const productId = product.id;
    this.stepError.set(null);

    submit(this.formSchema, async (field) => {
      const v = field().value();
      const prepared = await firstValueFrom(
        this._facade.prepareInsuranceSubscription({
          holdingId,
          productId,
          paymentMode: v.paymentMode,
          accountRef: v.paymentMode === MODES.CoreBankingDebit ? v.accountRef.trim() : null,
          paymentMethod: v.paymentMode === MODES.RecordedByAgent ? (v.paymentMethod as SubscribeInsurancePolicyRequestPaymentMethodEnum) : null,
          paymentReference: v.paymentMode === MODES.RecordedByAgent ? v.paymentReference.trim() : null,
          paidOn: v.paymentMode === MODES.RecordedByAgent ? v.paidOn.slice(0, 10) : null,
          commitmentReference: v.paymentMode === MODES.DeferredByDerogation ? v.commitmentReference.trim() : null,
          commitmentSignedOn: v.paymentMode === MODES.DeferredByDerogation ? v.commitmentSignedOn.slice(0, 10) : null,
          premiumAmount: this.premiumAmount(),
          currency: this.premiumCurrency(),
          consentChannel: v.consentChannel as SubscribeInsurancePolicyRequestConsentChannelEnum,
          consentTextVersion: SUBSCRIPTION_NOTICE_VERSION,
          consentTextSha256: await sha256Hex(SUBSCRIPTION_NOTICE.join('\n')),
          consentedAt: new Date().toISOString(),
          consentEvidenceStorageRef: v.consentEvidence.trim(),
          premiumPayerClientId: this.payerIsOther() && this.payerId() ? this.payerId() : null,
        }).pipe(catchError((err: HttpErrorResponse) => {
          this.stepError.set(integrationErrorMessage(err, "La souscription n'a pas pu être préparée."));
          return EMPTY;
        })),
        { defaultValue: null },
      );
      if (!prepared?.subscriptionId) return;

      // Préparée : le contrat part maintenant. Une souscription déjà partie n'est pas renvoyée.
      if (!prepared.alreadyExisted
        && !(await this._run(this._holdings.submitHolding(holdingId),
          "La souscription est préparée mais le contrat n'a pas pu être envoyé. Réessayez : la préparation sera reprise."))) return;

      this._snackbar.success('Souscription envoyée', 'Le contrat entre en vigueur une fois la prime payée et la police émise.');
      this._track(prepared.subscriptionId);
    });
  }

  public recordLatePayment(): void {
    const id = this.subscription()?.id;
    if (!id) return;
    submit(this.lateForm, async (field) => {
      const v = field().value();
      const ok = await this._run(
        this._integration.recordInsurancePremiumPayment(id, {
          paymentMethod: v.paymentMethod as RecordPremiumPaymentRequestPaymentMethodEnum,
          paymentReference: v.paymentReference.trim(),
          paidOn: v.paidOn.slice(0, 10),
        }),
        "L'encaissement n'a pas pu être enregistré.",
      );
      if (ok) {
        this._premiumConfirmed.set(true);
        this._snackbar.success('Prime encaissée', 'Le contrat entre en vigueur dès que la police est émise.');
      }
    });
  }

  public backToClient(): void {
    this._router.navigate(['/customers', this.customerId(), 'produits']);
  }

  // ——— Affichage ———

  public formatAmountLabel(amount: number | null | undefined, currency: string | null | undefined): string {
    return formatAmount(amount, currency);
  }
  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }
  public periodicityOf(p: InsuranceProductDto): string {
    const periodicity = p.periodicity as InsurancePeriodicity | undefined;
    return periodicity ? INSURANCE_PERIODICITY_LABELS[periodicity] : '—';
  }
  public priceOf(p: InsuranceProductDto): string {
    return p.pricingMode === 'InsurerComputed' ? "Tarif demandé à l'assureur" : formatAmount(p.fixedPremiumAmount, p.currency);
  }
  public channelLabel(channel: string | null | undefined): string {
    return DELIVERY_CHANNEL_OPTIONS.find((o) => o.value === channel)?.label ?? channel ?? '—';
  }
  public isTerminal(status: string | null | undefined): boolean {
    return TERMINAL_STATUSES.includes(status ?? '');
  }

  // ——— Chargements ———

  private async _run(call: Observable<unknown>, fallback: string): Promise<boolean> {
    this.busy.set(true);
    this.stepError.set(null);
    const ok = await firstValueFrom(call.pipe(
      map(() => true),
      catchError((err: HttpErrorResponse) => {
        this.stepError.set(integrationErrorMessage(err, fallback));
        return of(false);
      }),
    ), { defaultValue: true });
    this.busy.set(false);
    return ok;
  }

  private _loadHoldings(keep?: string, then?: () => void): void {
    this.isLoadingHoldings.set(true);
    this._holdings.listClientHoldings(this.customerId(), undefined, undefined, 1, 100).pipe(
      catchError((err: HttpErrorResponse) => {
        this.holdingsError.set(integrationErrorMessage(err, "Les contrats du client n'ont pas pu être lus."));
        this.isLoadingHoldings.set(false);
        return EMPTY;
      }),
    ).subscribe((page) => {
      const rows = (page.items ?? [])
        .filter((h) => INSURANCE_CATEGORIES.includes(h.productCategory ?? ''))
        .filter((h) => ['Draft', 'PendingSignature', 'Rejected'].includes(h.status ?? ''))
        .map(toHoldingRow);
      this.holdingRows.set(rows);
      this.isLoadingHoldings.set(false);

      const wanted = keep ?? this.holding();
      const ready = rows.filter((r) => r.ready);
      const preselected = rows.find((r) => r.id === wanted && r.ready) ?? (ready.length === 1 ? ready[0] : undefined);
      if (preselected) {
        this.selectedHoldingId.set(preselected.id);
        if (!keep && wanted === preselected.id) this.goToStep(2);
      }
      then?.();
    });
  }

  private _loadProducts(): void {
    this._facade.listInsuranceProducts({ isActive: true, page: 1, pageSize: 200 }).pipe(
      catchError((err: HttpErrorResponse) => {
        if (err.status === 403) this.productsForbidden.set(true);
        else this.productsError.set(integrationErrorMessage(err, "Le catalogue des produits n'a pas pu être lu."));
        this.isLoadingProducts.set(false);
        return EMPTY;
      }),
    ).subscribe((page) => {
      this.products.set(page.items ?? []);
      this.isLoadingProducts.set(false);
      if (this.currentStep() === 2) this._autoSelectProduct();
    });
  }

  private _loadDeliveries(): void {
    const holdingId = this.selectedHoldingId();
    if (!holdingId) return;
    this._integration.listInformationSheetDeliveries(holdingId).pipe(catchError(() => of([])))
      .subscribe((rows) => this.deliveries.set(rows ?? []));
  }

  private _autoSelectProduct(): void {
    if (this.selectedProductId()) return;
    const offerable = this.productRows().filter((r) => r.isOfferable);
    if (offerable.length === 1) this.selectProduct(offerable[0]);
  }

  private _loadQuote(): void {
    const product = this.selectedProduct();
    if (!product?.id || product.pricingMode !== 'InsurerComputed') {
      this.quote.set(null);
      this.quoteError.set(null);
      return;
    }
    this.isQuoting.set(true);
    this.quoteError.set(null);
    this._facade.quoteInsuranceProduct(product.id, this.customerId(), this.selectedHolding()?.specifics?.insuredCapital ?? null).pipe(
      catchError((err: HttpErrorResponse) => {
        this.quoteError.set(integrationErrorMessage(err, "L'assureur n'a pas renvoyé de tarif."));
        this.isQuoting.set(false);
        return EMPTY;
      }),
    ).subscribe((q) => {
      this.quote.set(q);
      this.isQuoting.set(false);
    });
  }

  private _track(subscriptionId: string): void {
    this.isTracking.set(true);
    const read = () => this._facade.getInsuranceSubscription(subscriptionId).pipe(catchError(() => EMPTY))
      .subscribe((dto) => {
        this.subscription.set(dto);
        if (this.isTerminal(dto.status)) this._stopPolling();
      });
    read();
    this._pollTicks = 0;
    this._pollTimer = setInterval(() => {
      this._pollTicks += 1;
      if (this._pollTicks > 40) {
        this._stopPolling();
        return;
      }
      read();
    }, 3000);
  }

  private _stopPolling(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
    this.isTracking.set(false);
  }
}

function toHoldingRow(holding: HoldingDto): SubscriptionHoldingRow {
  const ready = holding.status === 'Draft' || holding.status === 'PendingSignature';
  const hint = holding.status === 'Rejected'
    ? `Refusé${holding.rejectionReason ? ' — ' + holding.rejectionReason : ''}. Repassez-le en brouillon depuis la fiche client.`
    : holding.signedAt
      ? 'Signé : reste à vérifier la fiche remise, puis le paiement et l’envoi.'
      : 'Prêt : produit de l’assureur, fiche d’information, signature, paiement.';
  return { id: holding.holdingId ?? '', holding, ready, hint };
}

function documentLabel(kind: string): string {
  switch (kind) {
    case 'Approval': return "L'agrément";
    case 'FinancialGuarantee': return 'La garantie financière';
    default: return "L'attestation de RC professionnelle";
  }
}

/** Date du jour en `yyyy-MM-dd`, dans le fuseau du poste et non en UTC. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default SubscribePolicyPage;
