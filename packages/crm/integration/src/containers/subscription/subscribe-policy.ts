import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import {
  applyEach,
  form,
  FormField,
  FormRoot,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import {
  ClientDetailDto,
  ClientsApiService,
  InsuranceProductDto,
  InsuranceQuoteDto,
  LiveBalanceDto,
} from '@sankore/crm-api';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY, firstValueFrom } from 'rxjs';
import { InsuranceProductPreview } from '../../components/insurance-product-preview';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
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
import {
  PendingIntegrationEndpoints,
  SubscribePolicyRequest,
} from '../../data-access/pending-endpoints';
import { SubscriptionTracking } from './subscription-tracking';
import {
  clearSubscriptionDraft,
  formatDraftSavedAt,
  readSubscriptionDraft,
  SubscriptionDraft,
  writeSubscriptionDraft,
} from './subscription-draft';

/**
 * Une ligne du catalogue, telle que l'étape 1 la rend. Déclarée en `type` et non en
 * `interface` : `tas-table` contraint ses données à `TableEntity`, qui porte une
 * signature d'index.
 */
export type SubscriptionProductRow = {
  id: string;
  product: InsuranceProductDto;
  isOfferable: boolean;
  reasonLabels: string[];
};

class BeneficiaryFormModel {
  public fullName!: string;
  public relationship!: string;
  /** Saisi en texte : l'input rend du texte, la conversion se fait à la soumission. */
  public sharePercent!: string;
  public birthDate!: string;

  public static instantiate(): BeneficiaryFormModel {
    const model = new BeneficiaryFormModel();
    model.fullName = '';
    model.relationship = '';
    model.sharePercent = '';
    model.birthDate = '';
    return model;
  }
}

class SubscribePolicyFormModel {
  public effectiveFrom!: string;
  public insuredAmount!: string;
  public beneficiaries!: BeneficiaryFormModel[];
  public debitAccountRef!: string;
  public consentGiven!: boolean;
  public clientSigned!: boolean;
  public signatureReference!: string;
  /**
   * Réponses au questionnaire du produit. La structure est celle qu'attend
   * `SubscribePolicyRequest` ; elle reste vide tant qu'aucun endpoint ne décrit de
   * questionnaire par produit. **Jamais recopiée dans le brouillon.**
   */
  public questionnaireAnswers!: Array<{ code: string; answer: string }>;

  public static instantiate(): SubscribePolicyFormModel {
    const model = new SubscribePolicyFormModel();
    model.effectiveFrom = todayIso();
    model.insuredAmount = '';
    model.beneficiaries = [];
    model.debitAccountRef = '';
    model.consentGiven = false;
    model.clientSigned = false;
    model.signatureReference = '';
    model.questionnaireAnswers = [];
    return model;
  }
}

/**
 * Parcours de souscription d'un contrat d'assurance — ASS-15.
 *
 * Écran routé plein, et non un drawer : trois étapes dont un récapitulatif signé par le
 * client ne tiennent pas dans un panneau latéral, et l'agent tourne l'écran vers le
 * client au moment du récapitulatif.
 *
 * **Ce qui fonctionne pour de vrai** : l'étape 1 lit le catalogue
 * (`GET insurance/products`), l'étape 2 lit l'identité au dossier
 * (`GET clients/{id}`), et le récapitulatif demande le tarif à l'assureur
 * (`POST insurance/products/{id}/quote`) puis le solde du compte à débiter
 * (`GET integration/balance/{customerId}`). Ces quatre appels existent au contrat.
 *
 * **Ce qui attend le serveur** : la soumission elle-même. Aucun endpoint de
 * souscription n'est déclaré (lots back ASS-04/ASS-05), donc le dernier bouton passe par
 * `PendingIntegrationEndpoints.subscribePolicy()`, qui répond `null`. Un `null` n'est
 * jamais présenté comme un succès : l'écran dit que la souscription attend une livraison
 * serveur et laisse le récapitulatif consultable. C'est annoncé AVANT le clic, pour ne
 * pas faire perdre son temps à un agent au guichet.
 *
 * **Éligibilité client non vérifiée** : `isOfferable` du contrat ne porte que
 * l'éligibilité du produit (statut, connexion, période de validité). L'âge
 * (`minAge`/`maxAge`), le palier KYC (`minKycLevel`), l'exigence d'un compte
 * (`requiresCbsAccount`) et celle d'un prêt en cours (`requiresActiveLoan`) dépendent du
 * client, et aucun endpoint ne les évalue. Les conditions sont donc affichées en clair
 * dans l'aperçu du produit pour que l'agent les vérifie, et rien n'est bloqué sur une
 * règle devinée côté client.
 */
@Component({
  selector: 'integration-subscribe-policy',
  templateUrl: './subscribe-policy.html',
  imports: [
    TasAlert,
    Button,
    TasCard,
    TasError,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSpinner,
    TasTable,
    TasTag,
    TimeagoPipe,
    FormRoot,
    FormField,
    InsuranceProductPreview,
    SubscriptionTracking,
  ],
})
export class SubscribePolicyPage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _clients = inject(ClientsApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _router = inject(Router);

  /**
   * Les endpoints de souscription ne sont pas livrés : la frontière est instanciée ici
   * plutôt qu'injectée, `PendingIntegrationEndpoints` n'étant pas un service Angular.
   */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly customerId = input.required<string>();

  public readonly canViewBalance = this._permissions.can('CoreBanking.Balance.ViewLive');

  public readonly steps = [
    { index: 1, label: 'Produit' },
    { index: 2, label: 'Contrat' },
    { index: 3, label: 'Récapitulatif' },
  ] as const;

  public readonly currentStep = signal<1 | 2 | 3>(1);

  // ——— Client (lecture seule, venue du dossier KYC) ———

  public readonly isLoadingClient = signal(true);
  public readonly client = signal<ClientDetailDto | null>(null);
  public readonly clientError = signal<string | null>(null);

  public readonly clientDisplayName = computed(
    () => this.client()?.displayName || this.client()?.legalName || '—',
  );

  // ——— Étape 1 — catalogue ———

  public readonly isLoadingProducts = signal(true);
  public readonly products = signal<InsuranceProductDto[]>([]);
  public readonly productsError = signal<string | null>(null);
  /**
   * `GET insurance/products` déclare la permission `Ins.Product.Manage`, qu'un agent de
   * guichet n'a pas forcément : on le dit plutôt que de laisser un catalogue vide.
   */
  public readonly productsForbidden = signal(false);

  public readonly selectedProductId = signal<string | null>(null);

  public readonly selectedProduct = computed<InsuranceProductDto | null>(
    () => this.products().find((product) => product.id === this.selectedProductId()) ?? null,
  );

  public readonly productRows = computed<SubscriptionProductRow[]>(() =>
    this.products()
      .map((product) => ({
        id: product.id ?? '',
        product,
        isOfferable: product.isOfferable === true,
        reasonLabels: (product.notOfferableReasons ?? []).map(notOfferableReasonLabel),
      }))
      // Les proposables d'abord : les autres restent visibles — c'est le critère
      // d'acceptation — mais ne doivent pas occuper le haut de l'écran.
      .sort((a, b) => {
        if (a.isOfferable !== b.isOfferable) return a.isOfferable ? -1 : 1;
        return (a.product.name ?? '').localeCompare(b.product.name ?? '', 'fr');
      }),
  );

  public readonly offerableCount = computed(
    () => this.productRows().filter((row) => row.isOfferable).length,
  );

  /** Catalogue reçu en entier (une page de 200) : la pagination est locale. */
  public readonly productTableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: false,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [10, 25, 50],
    },
  });

  // ——— Étape 2 et 3 — formulaire ———

  public model = signal(SubscribePolicyFormModel.instantiate());

  public formSchema = form(this.model, (schema) => {
    required(schema.effectiveFrom, { message: "La date d'effet est obligatoire" });
    validate(schema.effectiveFrom, ({ value }) => {
      const raw = (value() ?? '').slice(0, 10);
      if (!raw) return null;

      const today = todayIso();
      if (raw < today) {
        return {
          kind: 'minDate',
          message: `La date d'effet ne peut pas être antérieure à aujourd'hui (${formatContractDate(today)}).`,
        };
      }

      const product = this.selectedProduct();
      const from = product?.effectiveFrom?.slice(0, 10);
      if (from && raw < from) {
        return {
          kind: 'minDate',
          message: `Ce produit entre en vigueur le ${formatContractDate(from)} : choisissez cette date ou une date postérieure.`,
        };
      }

      const to = product?.effectiveTo?.slice(0, 10);
      if (to && raw > to) {
        return {
          kind: 'maxDate',
          message: `Ce produit cesse d'être en vigueur le ${formatContractDate(to)} : choisissez cette date ou une date antérieure.`,
        };
      }

      return null;
    });

    validate(schema.insuredAmount, ({ value }) => {
      const raw = (value() ?? '').trim();
      if (!raw) return null;
      const amount = Number(raw);
      return Number.isFinite(amount) && amount > 0
        ? null
        : { kind: 'range', message: 'Entrez un montant positif, ou laissez le champ vide' };
    });

    applyEach(schema.beneficiaries, (beneficiary) => {
      required(beneficiary.fullName, { message: 'Le nom du bénéficiaire est obligatoire' });
      required(beneficiary.relationship, {
        message: 'Précisez le lien du bénéficiaire avec le client',
      });
      validate(beneficiary.sharePercent, ({ value }) => {
        const share = Number((value() ?? '').trim());
        return Number.isFinite(share) && share > 0 && share <= 100
          ? null
          : { kind: 'range', message: 'Entrez une part comprise entre 1 et 100' };
      });
    });

    // L'erreur de saisie la plus fréquente sur ce genre de formulaire : des parts qui
    // ne totalisent pas 100 %. Le message donne la somme obtenue, pas seulement la règle.
    validate(schema.beneficiaries, ({ value }) => {
      const list = value() ?? [];
      if (list.length === 0) return null;

      const total = list.reduce(
        (sum, beneficiary) => sum + (Number((beneficiary.sharePercent ?? '').trim()) || 0),
        0,
      );
      const rounded = Math.round(total * 100) / 100;
      return rounded === 100
        ? null
        : {
            kind: 'share',
            message: `La somme des parts fait ${rounded} %. Elle doit faire exactement 100 %.`,
          };
    });

    required(schema.debitAccountRef, {
      message: 'La référence du compte à débiter est obligatoire',
    });

    validate(schema.consentGiven, ({ value }) =>
      value() ? null : { kind: 'required', message: 'Le consentement du client est obligatoire' },
    );

    validate(schema.clientSigned, ({ value }) =>
      value() ? null : { kind: 'required', message: 'La signature du client est obligatoire' },
    );
  });

  // ——— Étape 3 — devis ———

  public readonly isQuoting = signal(false);
  public readonly quote = signal<InsuranceQuoteDto | null>(null);
  public readonly quoteError = signal<string | null>(null);

  public readonly premiumAmount = computed<number | null>(() => {
    const product = this.selectedProduct();
    if (!product) return null;
    return product.pricingMode === 'InsurerComputed'
      ? (this.quote()?.premiumAmount ?? null)
      : (product.fixedPremiumAmount ?? null);
  });

  public readonly premiumCurrency = computed(
    () => this.quote()?.currency ?? this.selectedProduct()?.currency ?? null,
  );

  public readonly premiumLabel = computed(() =>
    formatAmount(this.premiumAmount(), this.premiumCurrency()),
  );

  public readonly periodicityLabel = computed(() => {
    const periodicity = (this.quote()?.periodicity ??
      this.selectedProduct()?.periodicity) as InsurancePeriodicity | undefined;
    return periodicity ? INSURANCE_PERIODICITY_LABELS[periodicity] : '—';
  });

  /**
   * D'où vient le tarif. Pour un produit au tarif catalogue, aucun devis n'est demandé :
   * on nomme alors le mode de tarification du produit plutôt que d'attribuer à
   * l'assureur un prix qu'il n'a pas donné.
   */
  public readonly priceSourceLabel = computed(() => {
    const quote = this.quote();
    if (quote) return quoteSourceLabel(quote.source);
    const mode = this.selectedProduct()?.pricingMode as InsurancePricingMode | undefined;
    return mode ? INSURANCE_PRICING_MODE_LABELS[mode] : '—';
  });

  public readonly quotedAt = computed(() => this.quote()?.quotedAt ?? null);

  // ——— Étape 3 — solde du compte à débiter ———

  public readonly isLoadingBalance = signal(false);
  public readonly balance = signal<LiveBalanceDto | null>(null);
  /** 404 `INTEGRATION_BALANCE_NOT_AVAILABLE` : « aucun solde pour ce compte », pas une panne. */
  public readonly balanceUnavailable = signal(false);
  public readonly balanceError = signal<string | null>(null);

  public readonly availableBalanceLabel = computed(() => {
    const balance = this.balance();
    if (!balance) return '—';
    return formatAmount(balance.availableBalance ?? balance.balance, balance.currency);
  });

  // ——— Soumission ———

  public readonly submissionAcknowledged = signal(false);
  public readonly submittedPolicyId = signal<string | null>(null);
  /**
   * Requête complète, telle qu'elle partira le jour où ASS-04 livre l'endpoint. La
   * construire dès maintenant garde l'écran vrai : rien d'autre que l'appel ne changera.
   */
  public readonly preparedRequest = signal<SubscribePolicyRequest | null>(null);

  // ——— Brouillon ———

  public readonly draftOffer = signal<SubscriptionDraft | null>(null);

  public readonly draftOfferLabel = computed(() => {
    const draft = this.draftOffer();
    return draft ? formatDraftSavedAt(draft.savedAt) : '';
  });

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Clients', link: ['/customers'] },
      { label: 'Fiche client', link: ['/customers', this.customerId()] },
      { label: 'Souscrire une assurance' },
    ]);

    this._loadClient();
    this._loadProducts();

    const draft = readSubscriptionDraft(this.customerId());
    if (draft) this.draftOffer.set(draft);
  }

  // ——— Navigation entre les étapes ———

  public readonly isStep1Complete = computed(() => this.selectedProduct()?.isOfferable === true);

  public readonly isStep2Complete = computed(
    () =>
      !this.formSchema.effectiveFrom().invalid() && !this.formSchema.beneficiaries().invalid(),
  );

  public goToStep(step: 1 | 2 | 3): void {
    if (step === 2 && !this.isStep1Complete()) return;
    if (step === 3 && (!this.isStep1Complete() || !this.isStep2Complete())) return;

    this.currentStep.set(step);
    this._saveDraft();

    if (step === 3) {
      this._loadQuote();
      if (this._accountRef()) this.loadBalance();
    }
  }

  public selectProduct(row: SubscriptionProductRow): void {
    if (!row.isOfferable) return;
    this.selectedProductId.set(row.id);
    this.quote.set(null);
    this.quoteError.set(null);
    // Le montant assuré du catalogue sert de point de départ : l'agent peut l'ajuster
    // quand le produit laisse ce choix.
    const insuredAmount = row.product.insuredAmount;
    this.formSchema.insuredAmount().value.set(insuredAmount ? String(insuredAmount) : '');
  }

  // ——— Bénéficiaires ———

  public addBeneficiary(): void {
    this.formSchema
      .beneficiaries()
      .value.update((list) => [...list, BeneficiaryFormModel.instantiate()]);
  }

  public removeBeneficiary(index: number): void {
    this.formSchema
      .beneficiaries()
      .value.update((list) => list.filter((_, position) => position !== index));
  }

  // ——— Consentement et signature ———

  public toggleConsent(): void {
    const field = this.formSchema.consentGiven();
    field.value.set(!field.value());
    field.markAsTouched();
  }

  public toggleSigned(): void {
    const field = this.formSchema.clientSigned();
    field.value.set(!field.value());
    field.markAsTouched();
  }

  // ——— Solde ———

  public loadBalance(): void {
    const accountRef = this._accountRef();
    if (!accountRef || !this.canViewBalance()) return;

    this.isLoadingBalance.set(true);
    this.balanceUnavailable.set(false);
    this.balanceError.set(null);

    this._facade
      .getLiveBalance(this.customerId(), accountRef)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          // Le contrat répond 404 pour un client hors périmètre, un compte qui n'est pas
          // le sien ET un compte dont aucun solde n'est détenu : ce n'est pas une panne,
          // c'est le « si connu » du critère d'acceptation.
          if (err.status === 404) {
            this.balanceUnavailable.set(true);
          } else {
            this.balanceError.set(
              integrationErrorMessage(err, "Le solde du compte n'a pas pu être lu."),
            );
          }
          this.isLoadingBalance.set(false);
          return EMPTY;
        }),
      )
      .subscribe((balance) => {
        this.balance.set(balance);
        this.isLoadingBalance.set(false);
      });
  }

  // ——— Brouillon ———

  public resumeDraft(): void {
    const draft = this.draftOffer();
    if (!draft) return;

    if (draft.productId) this.selectedProductId.set(draft.productId);

    this.model.update((current) => ({
      ...current,
      effectiveFrom: draft.effectiveFrom || current.effectiveFrom,
      insuredAmount: draft.insuredAmount,
      debitAccountRef: draft.debitAccountRef,
      beneficiaries: draft.beneficiaries.map((beneficiary) => {
        const model = BeneficiaryFormModel.instantiate();
        model.fullName = beneficiary.fullName;
        model.relationship = beneficiary.relationship;
        model.sharePercent = beneficiary.sharePercent;
        model.birthDate = beneficiary.birthDate;
        return model;
      }),
    }));

    this.draftOffer.set(null);
    this._snackbar.info(
      'Brouillon repris',
      "Le questionnaire du produit n'est pas conservé dans un brouillon : il devra être resaisi.",
    );
  }

  public dismissDraft(): void {
    this.draftOffer.set(null);
  }

  public saveDraft(): void {
    this._saveDraft();
    this._snackbar.success(
      'Brouillon enregistré',
      'Vous pourrez reprendre ce parcours depuis la fiche de ce client.',
    );
  }

  public abandon(): void {
    this._confirm.confirm({
      title: 'Abandonner cette souscription ?',
      message:
        'Le brouillon enregistré sur ce poste sera supprimé et la saisie sera perdue.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Abandonner', theme: 'warn' },
      rejectButtonProps: { label: 'Continuer la saisie' },
      accept: () => {
        clearSubscriptionDraft(this.customerId());
        this._router.navigate(['/customers', this.customerId()]);
      },
    });
  }

  // ——— Soumission ———

  public handleSubmit(): void {
    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      const product = this.selectedProduct();
      if (!value || !product?.id) return;

      this.preparedRequest.set({
        crmCustomerId: this.customerId(),
        productId: product.id,
        effectiveFrom: value.effectiveFrom,
        debitAccountRef: value.debitAccountRef.trim(),
        insuredAmount: value.insuredAmount.trim() ? Number(value.insuredAmount.trim()) : null,
        beneficiaries: value.beneficiaries.map((beneficiary) => ({
          fullName: beneficiary.fullName.trim(),
          relationship: beneficiary.relationship.trim(),
          sharePercent: Number(beneficiary.sharePercent.trim()),
          birthDate: beneficiary.birthDate || null,
        })),
        questionnaireAnswers: value.questionnaireAnswers,
        consentGiven: value.consentGiven,
        signatureReference: value.signatureReference.trim() || null,
      });

      const result = await firstValueFrom(this._pending.subscribePolicy());

      // Un `null` n'est pas un succès. Afficher « Contrat souscrit » ici ferait croire
      // la vente conclue alors que rien n'a été envoyé à l'assureur.
      if (!result) {
        this.submissionAcknowledged.set(true);
        return;
      }

      this.submittedPolicyId.set(result.policyId);
      clearSubscriptionDraft(this.customerId());
      this._snackbar.success(
        'Souscription envoyée',
        'Le prélèvement et l’émission du contrat sont suivis ci-dessous.',
      );
    });
  }

  // ——— Affichage ———

  public formatAmountLabel(
    amount: number | null | undefined,
    currency: string | null | undefined,
  ): string {
    return formatAmount(amount, currency);
  }

  public formatDate(value: string | null | undefined): string {
    return formatContractDate(value);
  }

  public periodicityOf(product: InsuranceProductDto): string {
    const periodicity = product.periodicity as InsurancePeriodicity | undefined;
    return periodicity ? INSURANCE_PERIODICITY_LABELS[periodicity] : '—';
  }

  public priceOf(product: InsuranceProductDto): string {
    return product.pricingMode === 'InsurerComputed'
      ? "Tarif demandé à l'assureur"
      : formatAmount(product.fixedPremiumAmount, product.currency);
  }

  private _accountRef(): string {
    return (this.formSchema.debitAccountRef().value() ?? '').trim();
  }

  private _saveDraft(): void {
    const value = this.model();
    writeSubscriptionDraft(this.customerId(), {
      productId: this.selectedProductId(),
      effectiveFrom: value.effectiveFrom,
      debitAccountRef: value.debitAccountRef,
      insuredAmount: value.insuredAmount,
      beneficiaries: value.beneficiaries,
    });
  }

  private _loadClient(): void {
    this._clients
      .getClient(this.customerId())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.clientError.set(
            integrationErrorMessage(err, "La fiche de ce client n'a pas pu être lue."),
          );
          this.isLoadingClient.set(false);
          return EMPTY;
        }),
      )
      .subscribe((client) => {
        this.client.set(client);
        this.isLoadingClient.set(false);
      });
  }

  private _loadProducts(): void {
    this.isLoadingProducts.set(true);
    this.productsError.set(null);
    this.productsForbidden.set(false);

    // `offerableOnly` n'est VOLONTAIREMENT pas passé : le critère d'acceptation exige
    // d'afficher aussi les produits inéligibles avec leur motif. Filtrer côté serveur
    // les ferait disparaître, et un agent qui ne comprend pas pourquoi un produit manque
    // appelle le support.
    this._facade
      .listInsuranceProducts({ isActive: true, page: 1, pageSize: 200 })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          if (err.status === 403) {
            this.productsForbidden.set(true);
          } else {
            this.productsError.set(
              integrationErrorMessage(err, "Le catalogue des produits n'a pas pu être lu."),
            );
          }
          this.isLoadingProducts.set(false);
          return EMPTY;
        }),
      )
      .subscribe((page) => {
        this.products.set(page.items ?? []);
        this.isLoadingProducts.set(false);
      });
  }

  private _loadQuote(): void {
    const product = this.selectedProduct();
    if (!product?.id) return;

    // Un produit au tarif catalogue n'a pas besoin de l'assureur : la prime est celle
    // du catalogue, et demander un devis ferait un appel pour rien.
    if (product.pricingMode !== 'InsurerComputed') {
      this.quote.set(null);
      this.quoteError.set(null);
      return;
    }

    const insuredAmountRaw = (this.formSchema.insuredAmount().value() ?? '').trim();
    const insuredAmount = insuredAmountRaw ? Number(insuredAmountRaw) : null;

    this.isQuoting.set(true);
    this.quoteError.set(null);

    this._facade
      .quoteInsuranceProduct(product.id, this.customerId(), insuredAmount)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.quoteError.set(
            integrationErrorMessage(err, "L'assureur n'a pas renvoyé de tarif."),
          );
          this.isQuoting.set(false);
          return EMPTY;
        }),
      )
      .subscribe((quote) => {
        this.quote.set(quote);
        this.isQuoting.set(false);
      });
  }
}

/** Date du jour en `yyyy-MM-dd`, dans le fuseau du poste et non en UTC. */
function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default SubscribePolicyPage;
