import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { form, FormField, FormRoot, submit } from '@angular/forms/signals';
import { EMPTY, catchError, firstValueFrom } from 'rxjs';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TasSpinner } from '@talisoft/ui/spinner';
import {
  TasDrawerAction,
  TasDrawerContent,
  TasDrawerTitle,
  TasSideDrawer,
} from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import {
  HoldingDto,
  ProductDto,
  ProductHoldingsApiService,
  ProductsApiService,
} from '@sankore/crm-api';
import {
  holdingStatusLabel,
  holdingStatusSeverity,
  institutionCurrency,
  productCategoryLabel,
} from '@sankore/crm/common';
import { DesignationsEditor } from './designations-editor';
import {
  HoldingSignatureActions,
  HoldingTimeline,
  holdingErrorMessage,
} from './holding-detail-drawer';

/** Cadence et borne du suivi d'un produit tout juste envoyé au back-office. */
const SYNC_POLL_INTERVAL_MS = 10_000;
const SYNC_POLL_MAX_TICKS = 18;

export interface SubscribeDrawerData {
  clientId: string;
}

/**
 * Une ligne du choix de la ligne de produit. Déclarée en `type` : `tas-table`
 * contraint ses données à `TableEntity`, qui porte une signature d'index.
 */
export type ProductPickRow = {
  id: string;
  kind: 'group' | 'product';
  categoryLabel: string;
  count: number;
  product: ProductDto | null;
  name: string;
  code: string;
  roleCount: number;
};

class TermsFormModel {
  public insuredCapital!: string;
  public premium!: string;
  public periodicity!: string;
  public durationMonths!: string;
  public annualRatePercent!: string;
  public initialDeposit!: string;
  public currency!: string;
  public effectiveFrom!: string;
  public notes!: string;

  public static instantiate(): TermsFormModel {
    const model = new TermsFormModel();
    model.insuredCapital = '';
    model.premium = '';
    model.periodicity = '';
    model.durationMonths = '';
    model.annualRatePercent = '';
    model.initialDeposit = '';
    model.currency = institutionCurrency();
    model.effectiveFrom = new Date().toISOString().slice(0, 10);
    model.notes = '';
    return model;
  }
}

/**
 * Nouvelle souscription — BNF-F-11.
 *
 * Quatre étapes : choix de la ligne de produit, termes, désignation des bénéficiaires,
 * puis signature électronique et envoi. Les trois premières ne touchent pas le serveur ;
 * la création part en un seul appel (`POST clients/{id}/holdings`), qui porte à la fois
 * les termes et la clause — le contrat refuse l'ensemble si la clause est invalide, et
 * c'est bien ce qu'on veut : pas de produit en brouillon avec une clause à moitié posée.
 *
 * L'étape de signature réutilise les blocs du drawer de détail (`holding-timeline`,
 * `holding-signature-actions`) : « signature puis envoi » est la même séquence que
 * BNF-F-12, et la dupliquer ferait diverger les messages d'erreur.
 */
@Component({
  selector: 'subscribe-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './subscribe-drawer.html',
  imports: [
    FormsModule,
    FormRoot,
    FormField,
    TasSideDrawer,
    TasDrawerTitle,
    TasDrawerContent,
    TasDrawerAction,
    TasAlert,
    Button,
    TasIcon,
    TasInput,
    TasFormField,
    TasLabel,
    TasHint,
    TasSpinner,
    TasTable,
    TasTag,
    DesignationsEditor,
    HoldingTimeline,
    HoldingSignatureActions,
  ],
})
export class SubscribeDrawer implements OnInit, OnDestroy {
  public readonly data: SubscribeDrawerData = inject(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<boolean>);
  private readonly _productsApi = inject(ProductsApiService);
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _snackbar = inject(SnackbarService);

  private readonly _editor = viewChild(DesignationsEditor);

  public readonly step = signal<1 | 2 | 3 | 4>(1);
  public readonly products = signal<ProductDto[]>([]);
  public readonly isLoadingProducts = signal(true);
  public readonly loadFailed = signal(false);
  public readonly selectedProduct = signal<ProductDto | null>(null);
  public readonly search = signal('');
  public readonly isSubscribing = signal(false);
  public readonly submitError = signal<string | null>(null);
  public readonly holding = signal<HoldingDto | null>(null);

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollTicks = 0;

  public readonly tableConfig: TableConfig = {
    property: 'entity',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 30, pageSizeOptions: [30, 60] },
  };

  public termsModel = signal(TermsFormModel.instantiate());
  public termsForm = form(this.termsModel);

  public readonly policyRoles = computed(
    () => this.selectedProduct()?.beneficiaryPolicy?.allowedRoles ?? [],
  );
  public readonly requiredFields = computed(
    () => this.selectedProduct()?.beneficiaryPolicy?.requiredFieldsBeforeConversion ?? [],
  );

  public readonly statusLabel = computed(() => holdingStatusLabel(this.holding()?.status));
  public readonly statusSeverity = computed<Severity>(() =>
    holdingStatusSeverity(this.holding()?.status),
  );

  /**
   * Catalogue groupé par catégorie, en lignes plates : un `<tr>` de titre de groupe puis
   * ses produits. Le groupement est un rendu, pas une structure — la liste reste une
   * `tas-table`, avec son état de chargement et son état vide.
   */
  public readonly productRows = computed<ProductPickRow[]>(() => {
    const term = this.search().trim().toLowerCase();
    const matching = this.products().filter((product) => {
      if (!term) return true;
      return [product.name, product.code, productCategoryLabel(product.category)]
        .filter((part): part is string => !!part)
        .some((part) => part.toLowerCase().includes(term));
    });

    const grouped = new Map<string, ProductDto[]>();
    for (const product of matching) {
      const key = product.category ?? '';
      grouped.set(key, [...(grouped.get(key) ?? []), product]);
    }

    const rows: ProductPickRow[] = [];
    for (const [category, items] of [...grouped.entries()].sort((a, b) =>
      productCategoryLabel(a[0]).localeCompare(productCategoryLabel(b[0]), 'fr'),
    )) {
      rows.push({
        id: `group:${category}`,
        kind: 'group',
        categoryLabel: productCategoryLabel(category),
        count: items.length,
        product: null,
        name: '',
        code: '',
        roleCount: 0,
      });
      for (const product of items.sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? '', 'fr'),
      )) {
        rows.push({
          id: product.id ?? `${category}-${product.code}`,
          kind: 'product',
          categoryLabel: productCategoryLabel(category),
          count: 0,
          product,
          name: product.name?.trim() || product.code?.trim() || 'Produit',
          code: product.code?.trim() || '',
          roleCount: product.beneficiaryPolicy?.allowedRoles?.length ?? 0,
        });
      }
    }
    return rows;
  });

  public readonly designationProblems = computed(
    () => this._editor()?.draft().problems ?? [],
  );

  public ngOnInit(): void {
    this._productsApi
      .listProducts(true)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          this.isLoadingProducts.set(false);
          return EMPTY;
        }),
      )
      .subscribe((products) => {
        this.products.set(products ?? []);
        this.isLoadingProducts.set(false);
      });
  }

  public ngOnDestroy(): void {
    this._stopPolling();
  }

  public close(): void {
    // Tout produit créé doit faire recharger la liste, même si la signature reste à faire.
    this._dialogRef.close(this.holding() !== null);
  }

  public selectProduct(product: ProductDto | null): void {
    if (!product) return;
    this.selectedProduct.set(product);
    this.termsModel.set(TermsFormModel.instantiate());
    this.step.set(2);
  }

  public backToProducts(): void {
    this.step.set(1);
  }

  public goToDesignations(): void {
    this.step.set(3);
  }

  public backToTerms(): void {
    this.step.set(2);
  }

  public productLabel(): string {
    const product = this.selectedProduct();
    return product?.name?.trim() || product?.code?.trim() || 'Produit';
  }

  public categoryLabel(): string {
    return productCategoryLabel(this.selectedProduct()?.category);
  }

  /** Crée le produit détenu avec ses termes et sa clause, en un seul appel. */
  public createSubscription(): void {
    const product = this.selectedProduct();
    const draft = this._editor()?.draft();
    if (!product) return;

    if (draft && !draft.isValid) {
      this.submitError.set(
        "Corrigez les points signalés sous la clause avant de créer la souscription.",
      );
      return;
    }

    this.submitError.set(null);
    this.isSubscribing.set(true);

    submit(this.termsForm, async (field) => {
      const terms = field().value();
      const response = await firstValueFrom(
        this._holdingsApi
          .subscribeClientToProduct(this.data.clientId, {
            productLineId: product.id,
            specifics: {
              insuredCapital: this._toNumber(terms.insuredCapital),
              premium: this._toNumber(terms.premium),
              periodicity: terms.periodicity.trim() || null,
              durationMonths: this._toInt(terms.durationMonths),
              annualRatePercent: this._toNumber(terms.annualRatePercent),
              initialDeposit: this._toNumber(terms.initialDeposit),
              currency: terms.currency || institutionCurrency(),
              effectiveFrom: terms.effectiveFrom || null,
              notes: terms.notes.trim() || null,
            },
            designations: draft?.designations ?? [],
          })
          .pipe(
            catchError((error: HttpErrorResponse) => {
              const message = holdingErrorMessage(
                error,
                'Impossible de créer cette souscription.',
              );
              this.submitError.set(message);
              this._snackbar.error('Erreur', message);
              this.isSubscribing.set(false);
              return EMPTY;
            }),
          ),
      );

      this.isSubscribing.set(false);
      if (response?.holdingId) {
        this._snackbar.success(
          'Souscription créée',
          'Le produit est en brouillon : il reste à faire signer le client puis à l\'envoyer.',
        );
        this.step.set(4);
        // Un 201 ne prouve pas que la clause imbriquée est enregistrée : on relit.
        this._loadHolding(response.holdingId);
      }
    });
  }

  public onHoldingChanged(): void {
    const holdingId = this.holding()?.holdingId;
    if (holdingId) this._loadHolding(holdingId);
  }

  private _loadHolding(holdingId: string): void {
    this._holdingsApi
      .getHolding(holdingId)
      .pipe(
        catchError(() => {
          this._snackbar.error(
            'Erreur',
            'La souscription est créée mais son état n\'a pas pu être relu.',
          );
          return EMPTY;
        }),
      )
      .subscribe((holding) => {
        this.holding.set(holding);
        if (holding.status === 'PendingSync') {
          this._startPolling(holdingId);
        } else {
          this._stopPolling();
        }
      });
  }

  private _startPolling(holdingId: string): void {
    if (this._pollTimer) return;
    this._pollTicks = 0;
    this._pollTimer = setInterval(() => {
      this._pollTicks += 1;
      if (this._pollTicks > SYNC_POLL_MAX_TICKS) {
        this._stopPolling();
        return;
      }
      this._holdingsApi
        .getHolding(holdingId)
        .pipe(catchError(() => EMPTY))
        .subscribe((holding) => {
          this.holding.set(holding);
          if (holding.status !== 'PendingSync') this._stopPolling();
        });
    }, SYNC_POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _toNumber(value: string): number | null {
    if (!value?.trim()) return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private _toInt(value: string): number | null {
    if (!value?.trim()) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
