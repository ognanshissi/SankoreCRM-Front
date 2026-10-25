import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FormField,
  FormRoot,
  form,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import {
  InsuranceProductDto,
  InsuranceProductDtoMinKycLevelEnum,
  InsuranceProductDtoPeriodicityEnum,
  InsuranceProductDtoPricingModeEnum,
  InsuranceProductWriteRequest,
  InsuranceProductWriteRequestMinKycLevelEnum,
  InsuranceProductWriteRequestPeriodicityEnum,
  InsuranceProductWriteRequestPricingModeEnum,
  ProductDto,
  ProductsApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService, TENANT_MODULES, TenantModulesService, TenantModule, ModuleReadOnlyNotice } from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasDatePicker } from '@talisoft/ui/date-picker';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasSwitch } from '@talisoft/ui/switch';
import { TasTag } from '@talisoft/ui/tag';
import { TasInput } from '@talisoft/ui/input';
import { EMPTY, catchError, firstValueFrom, forkJoin, of } from 'rxjs';
import { InsuranceProductPreview } from '../../components/insurance-product-preview';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  CONNECTION_KIND_LABELS,
  ConnectionKind,
  INSURANCE_MIN_KYC_LEVELS,
  INSURANCE_PERIODICITIES,
  INSURANCE_PRICING_MODES,
  formatContractDate,
  notOfferableReasonLabel,
} from '../../data-access/integration-referential';

/**
 * Une ligne de l'éditeur de garanties. `key` n'existe que pour le suivi de boucle :
 * deux garanties peuvent être créées sans code et se retrouveraient avec la même clé.
 */
type GuaranteeRow = {
  key: string;
  code: string;
  label: string;
  ceilingAmount: string;
  deductible: string;
};

class EditInsuranceProductFormModel {
  public name!: string;
  public description!: string;
  public periodicity!: string;
  public pricingMode!: string;
  public fixedPremiumAmount!: string;
  public currency!: string;
  public insuredAmount!: string;
  public minAge!: string;
  public maxAge!: string;
  public minKycLevel!: string;
  public requiresCbsAccount!: boolean;
  public requiresActiveLoan!: boolean;
  public linkedCreditProductCode!: string;
  public commissionRatePercent!: string;
  public premiumRetryLimit!: string;
  public premiumRetryIntervalDays!: string;
  public effectiveFrom!: string;
  public effectiveTo!: string;

  public static fromDto(dto: InsuranceProductDto): EditInsuranceProductFormModel {
    const model = new EditInsuranceProductFormModel();
    model.name = dto.name ?? '';
    model.description = dto.description ?? '';
    model.periodicity = dto.periodicity ?? '';
    model.pricingMode = dto.pricingMode ?? '';
    model.fixedPremiumAmount =
      dto.fixedPremiumAmount !== null && dto.fixedPremiumAmount !== undefined
        ? String(dto.fixedPremiumAmount)
        : '';
    model.currency = dto.currency ?? '';
    model.insuredAmount =
      dto.insuredAmount !== null && dto.insuredAmount !== undefined
        ? String(dto.insuredAmount)
        : '';
    model.minAge = dto.minAge !== null && dto.minAge !== undefined ? String(dto.minAge) : '';
    model.maxAge = dto.maxAge !== null && dto.maxAge !== undefined ? String(dto.maxAge) : '';
    model.minKycLevel = dto.minKycLevel ?? 'None';
    model.requiresCbsAccount = dto.requiresCbsAccount ?? false;
    model.requiresActiveLoan = dto.requiresActiveLoan ?? false;
    model.linkedCreditProductCode = dto.linkedCreditProductCode ?? '';
    // Le contrat ne donne aucune unité pour `commissionRate` (ni bornes, ni exemple) :
    // la saisie est en pourcentage et le stockage en fraction 0–1, converti aux deux
    // bouts. Un taux dont on ne sait pas s'il vaut 0,05 ou 5 est un bug financier.
    model.commissionRatePercent =
      dto.commissionRate !== null && dto.commissionRate !== undefined
        ? String(Math.round(dto.commissionRate * 10000) / 100)
        : '0';
    model.premiumRetryLimit = String(dto.premiumRetryLimit ?? 0);
    model.premiumRetryIntervalDays = String(dto.premiumRetryIntervalDays ?? 0);
    model.effectiveFrom = dto.effectiveFrom ? dto.effectiveFrom.slice(0, 10) : '';
    model.effectiveTo = dto.effectiveTo ? dto.effectiveTo.slice(0, 10) : '';
    return model;
  }
}

/**
 * Les champs du modèle sont des chaînes — l'input rend du texte — mais un
 * `input type="number"` passe par le NumberValueAccessor d'Angular et renvoie un
 * nombre : sans cette normalisation, un `.trim()` explosait à l'enregistrement.
 */
function asText(raw: string | number | null | undefined): string {
  return raw === null || raw === undefined ? '' : String(raw).trim();
}

function toNumberOrNull(raw: string | number | null | undefined): number | null {
  const text = asText(raw);
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBlankOrPositiveInteger(raw: string | number | null | undefined, max: number): boolean {
  const text = asText(raw);
  if (!text) return true;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= max;
}

/** Écran ASS-14 — la configuration complète d'un produit d'assurance. */
@Component({
  selector: 'edit-insurance-product',
  templateUrl: './edit-insurance-product.html',
  imports: [ModuleReadOnlyNotice, 
    FormsModule,
    FormRoot,
    FormField,
    InsuranceProductPreview,
    TasAlert,
    Button,
    TasCard,
    TasError,
    TasDatePicker,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSelect,
    TasSpinner,
    TasSwitch,
    TasTag,
  ],
})
export class EditInsuranceProductPage {
  /** Module désactivé : l'écran reste consultable, sans action (bandeau en tête). */
  public readonly readOnlyModules: TenantModule[] = [TENANT_MODULES.INSURANCE];
  /** Module désactivé : consultation seule, les actions se masquent (le serveur les refuserait). */
  private readonly _moduleReadOnly = inject(TenantModulesService).readOnly(TENANT_MODULES.INSURANCE);
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _router = inject(Router);

  private readonly _canManagePermission = this._permissions.can('Ins.Product.Manage');
  public readonly canManage = computed(() => this._canManagePermission() && !this._moduleReadOnly());

  public readonly id = input.required<string>();

  // `tas-select` attend `{ [key: string]: any }[]` : les listes du référentiel sont en
  // lecture seule, on les recopie plutôt que de relâcher le type du composant.
  public readonly periodicityOptions = INSURANCE_PERIODICITIES.map((option) => ({ ...option }));
  public readonly pricingModeOptions = INSURANCE_PRICING_MODES.map((option) => ({ ...option }));
  public readonly minKycLevelOptions = INSURANCE_MIN_KYC_LEVELS.map((option) => ({ ...option }));

  public isLoading = signal(true);
  public loadFailed = signal(false);
  public isChangingDistribution = signal(false);
  public product = signal<InsuranceProductDto | null>(null);
  public creditProducts = signal<ProductDto[]>([]);
  public guarantees = signal<GuaranteeRow[]>([]);

  public model = signal(new EditInsuranceProductFormModel());

  public formSchema = form(this.model, (schema) => {
    required(schema.name, { message: 'Le nom du produit est obligatoire' });
    required(schema.periodicity, { message: 'Choisissez la périodicité de la prime' });
    required(schema.pricingMode, { message: 'Choisissez le mode de tarification' });
    required(schema.effectiveFrom, { message: "La date d'entrée en vigueur est obligatoire" });

    // En tarif calculé, la prime est demandée à l'assureur : exiger un montant ici
    // rendrait le formulaire insauvegardable pour un produit parfaitement valide.
    validate(schema.fixedPremiumAmount, ({ value, valueOf }) => {
      if (valueOf(schema.pricingMode) !== 'CatalogueFixed') return null;
      const amount = toNumberOrNull(value());
      return amount !== null && amount > 0
        ? null
        : { kind: 'required', message: 'Indiquez la prime du catalogue' };
    });

    validate(schema.currency, ({ value, valueOf }) => {
      if (valueOf(schema.pricingMode) !== 'CatalogueFixed') return null;
      return asText(value()).length === 3
        ? null
        : { kind: 'pattern', message: 'Indiquez la devise en trois lettres, par exemple XOF' };
    });

    validate(schema.insuredAmount, ({ value }) => {
      if (!asText(value())) return null;
      const amount = toNumberOrNull(value());
      return amount !== null && amount >= 0
        ? null
        : { kind: 'range', message: 'Entrez un montant valide' };
    });

    validate(schema.minAge, ({ value }) =>
      isBlankOrPositiveInteger(value(), 120)
        ? null
        : { kind: 'range', message: 'Entrez un âge entre 0 et 120 ans' },
    );

    validate(schema.maxAge, ({ value, valueOf }) => {
      if (!isBlankOrPositiveInteger(value(), 120)) {
        return { kind: 'range', message: 'Entrez un âge entre 0 et 120 ans' };
      }
      const min = toNumberOrNull(valueOf(schema.minAge));
      const max = toNumberOrNull(value());
      return min !== null && max !== null && max < min
        ? { kind: 'range', message: "L'âge maximum ne peut pas être inférieur à l'âge minimum" }
        : null;
    });

    validate(schema.commissionRatePercent, ({ value }) => {
      const rate = toNumberOrNull(value());
      return rate !== null && rate >= 0 && rate <= 100
        ? null
        : { kind: 'range', message: 'Entrez un taux entre 0 et 100' };
    });

    validate(schema.premiumRetryLimit, ({ value }) =>
      isBlankOrPositiveInteger(value(), 20) && asText(value())
        ? null
        : { kind: 'range', message: 'Entrez un nombre de relances entre 0 et 20' },
    );

    validate(schema.premiumRetryIntervalDays, ({ value }) =>
      isBlankOrPositiveInteger(value(), 365) && asText(value())
        ? null
        : { kind: 'range', message: 'Entrez un intervalle entre 0 et 365 jours' },
    );

    validate(schema.effectiveTo, ({ value, valueOf }) => {
      const to = asText(value());
      if (!to) return null;
      const from = asText(valueOf(schema.effectiveFrom));
      return from && to < from
        ? { kind: 'range', message: 'La fin de validité précède son début' }
        : null;
    });
  });

  public readonly isCatalogueFixed = computed(
    () => this.formSchema.pricingMode().value() === 'CatalogueFixed',
  );

  public readonly selectedPricingModeDescription = computed(() => {
    const mode = this.formSchema.pricingMode().value();
    return this.pricingModeOptions.find((option) => option.value === mode)?.description ?? null;
  });

  public readonly creditProductOptions = computed(() =>
    this.creditProducts()
      .filter((creditProduct) => !!creditProduct.code)
      .map((creditProduct) => ({
        label: creditProduct.name
          ? `${creditProduct.name} (${creditProduct.code})`
          : (creditProduct.code as string),
        value: creditProduct.code as string,
      })),
  );

  public readonly insurerKindLabel = computed(() => {
    const kind = this.product()?.connectionKind;
    return kind ? CONNECTION_KIND_LABELS[kind as ConnectionKind] : '—';
  });

  public readonly notOfferableLabels = computed(() =>
    (this.product()?.notOfferableReasons ?? []).map((reason) => notOfferableReasonLabel(reason)),
  );

  public readonly lastUpdatedLabel = computed(() =>
    formatContractDate(this.product()?.updatedAt ?? null),
  );

  /**
   * Une garantie sans code ne peut pas être identifiée par l'assureur, et deux
   * garanties de même code se recouvrent silencieusement à l'enregistrement.
   */
  public readonly guaranteeError = computed<string | null>(() => {
    const rows = this.guarantees();
    if (rows.some((row) => !asText(row.code))) {
      return 'Donnez un code à chaque garantie, ou retirez la ligne.';
    }
    const codes = rows.map((row) => asText(row.code).toLowerCase());
    if (new Set(codes).size !== codes.length) {
      return 'Deux garanties portent le même code.';
    }
    return null;
  });

  /**
   * Le produit tel qu'il sera vu au guichet, modifications en cours comprises :
   * l'aperçu sert à décider avant d'enregistrer. `isOfferable` et
   * `notOfferableReasons` restent ceux du serveur — ils sont dérivés, pas saisis.
   */
  public readonly previewProduct = computed<InsuranceProductDto | null>(() => {
    const loaded = this.product();
    if (!loaded) return null;
    const value = this.formSchema().value();
    const isFixed = value.pricingMode === 'CatalogueFixed';

    return {
      ...loaded,
      name: asText(value.name),
      description: asText(value.description) || null,
      guarantees: this._guaranteesPayload(),
      periodicity: value.periodicity as InsuranceProductDtoPeriodicityEnum,
      pricingMode: value.pricingMode as InsuranceProductDtoPricingModeEnum,
      fixedPremiumAmount: isFixed ? toNumberOrNull(value.fixedPremiumAmount) : null,
      currency: isFixed ? asText(value.currency).toUpperCase() || null : null,
      insuredAmount: toNumberOrNull(value.insuredAmount),
      minAge: toNumberOrNull(value.minAge),
      maxAge: toNumberOrNull(value.maxAge),
      minKycLevel: (value.minKycLevel || 'None') as InsuranceProductDtoMinKycLevelEnum,
      requiresCbsAccount: value.requiresCbsAccount,
      requiresActiveLoan: value.requiresActiveLoan,
      linkedCreditProductCode: value.linkedCreditProductCode || null,
      effectiveFrom: asText(value.effectiveFrom),
      effectiveTo: asText(value.effectiveTo) || null,
    };
  });

  constructor() {
    effect(() => {
      const productId = this.id();
      this.isLoading.set(true);
      this.loadFailed.set(false);

      forkJoin({
        product: this._facade.getInsuranceProduct(productId),
        // Le contrat impose que `linkedCreditProductCode` nomme un produit de PRÊT du
        // catalogue CRM : la liste évite de saisir un code que le serveur refusera.
        creditProducts: this._productsApi
          .listProducts(true, 'Loan')
          .pipe(catchError(() => of([] as ProductDto[]))),
      })
        .pipe(
          catchError((error: HttpErrorResponse) => {
            this._snackbar.error(
              'Erreur',
              integrationErrorMessage(error, 'Impossible de charger ce produit.'),
            );
            this.loadFailed.set(true);
            this.isLoading.set(false);
            return EMPTY;
          }),
        )
        .subscribe(({ product, creditProducts }) => {
          this.creditProducts.set(creditProducts ?? []);
          this._applyProduct(product);
          this.isLoading.set(false);
        });
    });
  }

  public setRequiresCbsAccount(value: boolean): void {
    this.formSchema.requiresCbsAccount().value.set(value);
  }

  public setRequiresActiveLoan(value: boolean): void {
    this.formSchema.requiresActiveLoan().value.set(value);
  }

  // ——— Éditeur de garanties ———
  // Collection dynamique éditée en place : c'est l'exception assumée à la règle
  // `tas-table` du projet (« les éditeurs de collections dynamiques, où l'ordre et
  // l'édition en place sont le sujet »). Ce n'est pas un oubli : une liste paginée
  // avec recherche n'a aucun sens pour quatre lignes qu'on saisit et réordonne.

  public addGuarantee(): void {
    this.guarantees.update((rows) => [
      ...rows,
      {
        key: `garantie-${Date.now()}-${rows.length}`,
        code: '',
        label: '',
        ceilingAmount: '',
        deductible: '',
      },
    ]);
  }

  public removeGuarantee(key: string): void {
    this.guarantees.update((rows) => rows.filter((row) => row.key !== key));
  }

  public updateGuarantee(
    key: string,
    field: 'code' | 'label' | 'ceilingAmount' | 'deductible',
    value: string | number | null,
  ): void {
    const next = value === null || value === undefined ? '' : String(value);
    this.guarantees.update((rows) =>
      rows.map((row) => (row.key === key ? { ...row, [field]: next } : row)),
    );
  }

  // ——— Enregistrement ———

  public handleSubmit(): void {
    if (this.guaranteeError()) {
      this._snackbar.error('Garanties à corriger', this.guaranteeError() as string);
      return;
    }

    submit(this.formSchema, async (field) => {
      const value = field()?.value();
      if (!value) return;

      const saved = await firstValueFrom(
        this._facade
          .updateInsuranceProduct(this.id(), this._toWriteRequest(value))
          .pipe(
            catchError((error: HttpErrorResponse) => {
              this._snackbar.error(
                'Erreur',
                integrationErrorMessage(error, "Impossible d'enregistrer ce produit."),
              );
              return EMPTY;
            }),
          ),
      );

      if (!saved) return;

      // On repart de la réponse : `isOfferable` et `notOfferableReasons` sont dérivés
      // côté serveur et peuvent changer du seul fait de l'enregistrement.
      this._applyProduct(saved);
      this._snackbar.success('Produit enregistré', 'La configuration est à jour.');
    });
  }

  public activate(): void {
    const product = this.product();
    if (!product) return;

    this._confirm.confirm({
      title: 'Mettre ce produit en distribution ?',
      message: `Les agents pourront proposer « ${product.name ?? 'ce produit'} » à la souscription, s'il est proposable.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Activer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._changeDistribution(true),
    });
  }

  /**
   * Pas de suppression dans ce domaine : souscriptions, contrats, échéances de prime et
   * lignes de bordereau nomment le produit. Le retrait est un statut, et il n'arrête
   * que les nouvelles souscriptions.
   */
  public withdraw(): void {
    const product = this.product();
    if (!product) return;

    this._confirm.confirm({
      title: 'Retirer ce produit de la distribution ?',
      message:
        `« ${product.name ?? 'Ce produit'} » ne pourra plus être proposé à la souscription. ` +
        'Les contrats en cours continuent : seules les nouvelles souscriptions sont arrêtées.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Retirer de la distribution', theme: 'warn' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => this._changeDistribution(false),
    });
  }

  public backToCatalogue(): void {
    this._router.navigate(['/settings/integrations/insurance-products']);
  }

  private _changeDistribution(activate: boolean): void {
    this.isChangingDistribution.set(true);
    const call = activate
      ? this._facade.activateInsuranceProduct(this.id())
      : this._facade.deactivateInsuranceProduct(this.id());

    call
      .pipe(
        catchError((error: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(
              error,
              activate
                ? "Impossible d'activer ce produit."
                : 'Impossible de retirer ce produit de la distribution.',
            ),
          );
          this.isChangingDistribution.set(false);
          return EMPTY;
        }),
      )
      .subscribe((product) => {
        this.isChangingDistribution.set(false);
        this._applyProduct(product);

        if (!activate) {
          this._snackbar.success('Produit retiré', 'Aucune nouvelle souscription ne sera prise.');
          return;
        }

        const reasons = (product.notOfferableReasons ?? []).map((reason) =>
          notOfferableReasonLabel(reason),
        );
        if (product.isOfferable) {
          this._snackbar.success('Produit activé', 'Vos agents peuvent le proposer.');
        } else {
          this._snackbar.info(
            'Produit activé, mais pas encore proposable',
            reasons.join(' · ') || "L'assureur ne renvoie pas de tarif.",
          );
        }
      });
  }

  private _applyProduct(product: InsuranceProductDto): void {
    this.product.set(product);
    this.model.set(EditInsuranceProductFormModel.fromDto(product));
    this.guarantees.set(
      (product.guarantees ?? []).map((guarantee, index) => ({
        key: guarantee.code || `garantie-${index}`,
        code: guarantee.code ?? '',
        label: guarantee.label ?? '',
        ceilingAmount:
          guarantee.ceilingAmount !== null && guarantee.ceilingAmount !== undefined
            ? String(guarantee.ceilingAmount)
            : '',
        deductible:
          guarantee.deductible !== null && guarantee.deductible !== undefined
            ? String(guarantee.deductible)
            : '',
      })),
    );

    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: "Produits d'assurance", link: ['/settings/integrations/insurance-products'] },
      { label: product.name ?? 'Produit' },
    ]);
  }

  private _guaranteesPayload() {
    return this.guarantees().map((row) => ({
      code: asText(row.code),
      label: asText(row.label) || null,
      ceilingAmount: toNumberOrNull(row.ceilingAmount),
      deductible: toNumberOrNull(row.deductible),
    }));
  }

  private _toWriteRequest(
    value: EditInsuranceProductFormModel,
  ): InsuranceProductWriteRequest {
    const isFixed = value.pricingMode === 'CatalogueFixed';

    return {
      name: asText(value.name),
      // Les valeurs viennent des options du référentiel, identiques à l'énumération du
      // contrat ; `tas-select` ne rend que des chaînes.
      periodicity: value.periodicity as InsuranceProductWriteRequestPeriodicityEnum,
      pricingMode: value.pricingMode as InsuranceProductWriteRequestPricingModeEnum,
      effectiveFrom: asText(value.effectiveFrom),
      description: asText(value.description) || null,
      guarantees: this._guaranteesPayload(),
      // En tarif calculé, le montant et la devise du catalogue sont sans objet : les
      // envoyer quand même laisserait une prime fantôme dans la fiche.
      fixedPremiumAmount: isFixed ? toNumberOrNull(value.fixedPremiumAmount) : null,
      currency: isFixed ? asText(value.currency).toUpperCase() || null : null,
      insuredAmount: toNumberOrNull(value.insuredAmount),
      minAge: toNumberOrNull(value.minAge),
      maxAge: toNumberOrNull(value.maxAge),
      minKycLevel: (value.minKycLevel ||
        'None') as InsuranceProductWriteRequestMinKycLevelEnum,
      requiresCbsAccount: value.requiresCbsAccount,
      requiresActiveLoan: value.requiresActiveLoan,
      linkedCreditProductCode: value.linkedCreditProductCode || null,
      // Saisie en pourcentage, envoi en fraction 0–1 (cf. `fromDto`).
      commissionRate: (toNumberOrNull(value.commissionRatePercent) ?? 0) / 100,
      premiumRetryLimit: toNumberOrNull(value.premiumRetryLimit) ?? 0,
      premiumRetryIntervalDays: toNumberOrNull(value.premiumRetryIntervalDays) ?? 0,
      effectiveTo: asText(value.effectiveTo) || null,
    };
  }
}

export default EditInsuranceProductPage;
