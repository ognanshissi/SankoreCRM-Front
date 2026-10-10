import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMPTY, catchError, finalize } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { HoldingDto, ProductHoldingsApiService } from '@sankore/crm-api';
import {
  PRODUCT_CATEGORY_OPTIONS,
  PermissionsService,
  holdingStatusLabel,
  holdingStatusSeverity,
  isDesignationToReview,
  productCategoryLabel,
} from '@sankore/crm/common';
import { ClientDetailStore } from '../../models/client-detail.store';
import {
  HoldingDetailDrawer,
  HoldingDetailDrawerData,
  holdingOriginLabel,
} from './holding-detail-drawer';
import { SubscribeDrawer, SubscribeDrawerData } from './subscribe-drawer';

/**
 * Statuts proposés au filtre. Ce sont ceux du référentiel §3 du cahier des charges,
 * traduits par le socle : la liste est fermée côté serveur (`HoldingStatus`), et un
 * code inconnu renvoyé par l'API reste affichable — `holdingStatusLabel` s'en charge.
 */
const STATUS_OPTIONS: { label: string; value: string }[] = [
  'Draft',
  'PendingSignature',
  'PendingSync',
  'Active',
  'Rejected',
  'Closed',
].map((code) => ({ label: holdingStatusLabel(code), value: code }));

/** Cadence et borne du suivi « temps réel » des produits en synchronisation. */
const SYNC_POLL_INTERVAL_MS = 15_000;
const SYNC_POLL_MAX_TICKS = 12;

const PAGE_SIZE = 50;

/**
 * Une ligne du tableau : soit un titre de catégorie, soit un produit détenu.
 *
 * Déclarée en `type` et non en `interface` : `tas-table` contraint ses données à
 * `TableEntity`, qui porte une signature d'index — seule une déclaration en alias
 * d'objet la reçoit implicitement sous `strictTemplates`.
 */
export type HoldingRow = {
  id: string;
  kind: 'group' | 'holding';
  categoryLabel: string;
  count: number;
  holding: HoldingDto | null;
  productLabel: string;
  statusLabel: string;
  statusSeverity: Severity;
  originLabel: string;
  isImported: boolean;
  externalRef: string;
  dateLabel: string;
  dateCaption: string;
  designationCount: number;
  toReviewCount: number;
  isRejected: boolean;
  rejectionReason: string | null;
};

/**
 * Onglet « Produits détenus » de la fiche client — BNF-F-10 à BNF-F-12.
 *
 * Trois choix méritent d'être dits :
 *
 * - **Le groupement par catégorie est un rendu, pas une structure.** La liste reste une
 *   `tas-table` : un `<tr>` de titre de groupe en `colspan`, puis ses produits. C'est ce
 *   qui garde la pagination serveur, l'état de chargement et l'état vide du composant du
 *   kit tout en tenant 360 px.
 * - **Aucun statut n'est recalculé.** Les actions proposées viennent de `canEdit` et
 *   d'`availableActions` que l'API renvoie ligne par ligne.
 * - **Le suivi « temps réel » est borné.** On n'interroge le serveur que tant qu'au moins
 *   un produit est en synchronisation, toutes les quinze secondes, trois minutes au plus,
 *   et le minuteur meurt avec l'onglet.
 */
@Component({
  selector: 'client-produits',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './produits.html',
  imports: [
    FormsModule,
    TasCard,
    TasTable,
    TasTag,
    TasIcon,
    TasSelect,
    TasFormField,
    TasLabel,
    Button,
  ],
})
export class ClientProduits implements OnDestroy {
  private readonly _holdingsApi = inject(ProductHoldingsApiService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _injector = inject(Injector);
  private readonly _permissions = inject(PermissionsService);
  protected readonly store = inject(ClientDetailStore);

  /**
   * Le contrat ne documente aucun droit propre aux produits détenus : on retient
   * `customers:update`, le droit d'écriture générique de la fiche. À revoir si le back
   * expose un code dédié — c'est la seule approximation de permission de cet écran.
   */
  public readonly canWrite = this._permissions.can('customers:update');

  public readonly categoryOptions = PRODUCT_CATEGORY_OPTIONS.map((option) => ({
    label: option.label,
    value: String(option.value),
  }));
  public readonly statusOptions = STATUS_OPTIONS;

  public readonly category = signal('');
  public readonly status = signal('');
  public readonly page = signal(0);

  public readonly holdings = signal<HoldingDto[]>([]);
  public readonly totalCount = signal(0);
  public readonly isLoading = signal(true);
  public readonly loadFailed = signal(false);

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _pollTicks = 0;

  /**
   * Lié au query param `?holding=<id>` : la conversion d'un lead rattaché à un client
   * existant et le bloc « Demandes en cours » renvoient tous deux ici en désignant la
   * souscription concernée. `withComponentInputBinding()` est actif dans `app.config.ts`,
   * les query params se lient donc aux entrées comme les paramètres de route. Sans cette
   * entrée, les deux liens arrivaient sur l'onglet sans rien mettre en avant.
   */
  public readonly holding = input<string | undefined>(undefined);

  /** Souscription mise en avant, remise à plat dès que l'agent l'a ouverte. */
  public readonly highlightedHoldingId = signal<string | null>(null);

  private _autoOpenedHoldingId: string | null = null;

  public readonly clientId = computed(() => this.store.clientId() ?? '');
  public readonly isReadOnly = computed(() => this.store.isReadOnly());
  public readonly canSubscribe = computed(() => this.canWrite() && !this.isReadOnly());

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'entity',
    pagination: {
      serverSide: true,
      pageIndex: this.page(),
      pageSize: PAGE_SIZE,
      pageSizeOptions: [PAGE_SIZE],
      totalElements: this.totalCount(),
    },
  }));

  public readonly hasFilters = computed(() => !!this.category() || !!this.status());

  public readonly pendingSyncCount = computed(
    () => this.holdings().filter((holding) => holding.status === 'PendingSync').length,
  );

  public readonly toReviewCount = computed(() =>
    this.holdings().reduce(
      (total, holding) =>
        total +
        (holding.designations ?? []).filter(
          (designation) =>
            designation.validTo == null && isDesignationToReview(designation.status),
        ).length,
      0,
    ),
  );

  /** Lignes plates : un titre de catégorie puis ses produits, dans l'ordre reçu. */
  public readonly rows = computed<HoldingRow[]>(() => {
    const grouped = new Map<string, HoldingDto[]>();
    for (const holding of this.holdings()) {
      const key = holding.productCategory ?? '';
      grouped.set(key, [...(grouped.get(key) ?? []), holding]);
    }

    const rows: HoldingRow[] = [];
    for (const [category, items] of [...grouped.entries()].sort((a, b) =>
      productCategoryLabel(a[0]).localeCompare(productCategoryLabel(b[0]), 'fr'),
    )) {
      rows.push({
        id: `group:${category}`,
        kind: 'group',
        categoryLabel: productCategoryLabel(category),
        count: items.length,
        holding: null,
        productLabel: '',
        statusLabel: '',
        statusSeverity: 'neutral',
        originLabel: '',
        isImported: false,
        externalRef: '',
        dateLabel: '',
        dateCaption: '',
        designationCount: 0,
        toReviewCount: 0,
        isRejected: false,
        rejectionReason: null,
      });

      for (const holding of items) {
        const designations = (holding.designations ?? []).filter((d) => d.validTo == null);
        rows.push({
          id: holding.holdingId ?? `${category}-${rows.length}`,
          kind: 'holding',
          categoryLabel: productCategoryLabel(category),
          count: 0,
          holding,
          productLabel: holding.productCode?.trim() || 'Produit',
          statusLabel: holdingStatusLabel(holding.status),
          statusSeverity: holdingStatusSeverity(holding.status),
          originLabel: holdingOriginLabel(holding.origin),
          isImported: holding.isReadOnly === true,
          externalRef: holding.externalRef?.trim() || '—',
          ...this._dateOf(holding),
          designationCount: designations.length,
          toReviewCount: designations.filter((d) => isDesignationToReview(d.status)).length,
          isRejected: holding.status === 'Rejected',
          rejectionReason: holding.rejectionReason ?? null,
        });
      }
    }
    return rows;
  });

  constructor() {
    // Mise en avant du produit désigné par `?holding=` : on n'ouvre son détail
    // qu'une fois, et seulement si la ligne est bien dans la page chargée — ouvrir un
    // drawer sur un identifiant absent de la liste donnerait un écran vide sans dire
    // pourquoi.
    effect(() => {
      const wanted = this.holding();
      if (!wanted || this.isLoading()) return;

      const found = this.holdings().find((h) => h.holdingId === wanted);
      if (!found) {
        this.highlightedHoldingId.set(null);
        return;
      }

      this.highlightedHoldingId.set(wanted);
      if (this._autoOpenedHoldingId !== wanted) {
        this._autoOpenedHoldingId = wanted;
        this.openHolding(found);
      }
    });

    // Les filtres repartent de la première page : garder `pageIndex` ferait demander
    // une page qui n'existe plus dans le résultat filtré, et la liste semblerait vide.
    effect(() => {
      const clientId = this.clientId();
      const category = this.category();
      const status = this.status();
      const page = this.page();
      if (!clientId) return;
      this._load(clientId, category, status, page);
    });
  }

  public ngOnDestroy(): void {
    this._stopPolling();
  }

  public setCategory(value: string): void {
    this.page.set(0);
    this.category.set(value ?? '');
  }

  public setStatus(value: string): void {
    this.page.set(0);
    this.status.set(value ?? '');
  }

  public resetFilters(): void {
    this.page.set(0);
    this.category.set('');
    this.status.set('');
  }

  public onPageChange(event: { pageIndex: number }): void {
    this.page.set(event.pageIndex);
  }

  public reload(): void {
    const clientId = this.clientId();
    if (clientId) this._load(clientId, this.category(), this.status(), this.page());
  }

  /** « Nouvelle souscription » : le choix de la ligne de produit ouvre le parcours. */
  public openSubscribe(): void {
    const clientId = this.clientId();
    if (!clientId) return;

    const ref = this._sideDrawer.open<boolean, SubscribeDrawerData, SubscribeDrawer>(
      SubscribeDrawer,
      {
        width: '100%',
        height: '100%',
        panelClass: 'side-drawer-panel',
        data: { clientId },
        // `ClientHouseholdStore` et `ClientDetailStore` sont fournis par la coquille de la
        // fiche : sans cet injecteur, le drawer serait instancié depuis l'injecteur
        // racine et l'éditeur de désignations n'aurait aucun membre du foyer à cocher.
        injector: this._injector,
      },
    );

    ref.closed.subscribe((created) => {
      if (created) this.reload();
    });
  }

  public openHolding(holding: HoldingDto | null): void {
    const clientId = this.clientId();
    if (!holding?.holdingId || !clientId) return;

    const ref = this._sideDrawer.open<
      boolean,
      HoldingDetailDrawerData,
      HoldingDetailDrawer
    >(HoldingDetailDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
      data: { holdingId: holding.holdingId, clientId },
      injector: this._injector,
    });

    ref.closed.subscribe((changed) => {
      if (changed) this.reload();
    });
  }

  private _load(clientId: string, category: string, status: string, page: number): void {
    this.isLoading.set(true);
    this.loadFailed.set(false);
    this._holdingsApi
      .listClientHoldings(clientId, category || undefined, status || undefined, page + 1, PAGE_SIZE)
      .pipe(
        catchError(() => {
          this.loadFailed.set(true);
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((result) => {
        this.holdings.set(result.items ?? []);
        this.totalCount.set(result.totalCount ?? 0);
        this._syncPolling();
      });
  }

  private _syncPolling(): void {
    if (this.pendingSyncCount() > 0) {
      this._startPolling();
    } else {
      this._stopPolling();
    }
  }

  private _startPolling(): void {
    if (this._pollTimer) return;
    this._pollTicks = 0;
    this._pollTimer = setInterval(() => {
      this._pollTicks += 1;
      if (this._pollTicks > SYNC_POLL_MAX_TICKS) {
        this._stopPolling();
        return;
      }
      const clientId = this.clientId();
      if (!clientId) return;
      this._holdingsApi
        .listClientHoldings(
          clientId,
          this.category() || undefined,
          this.status() || undefined,
          this.page() + 1,
          PAGE_SIZE,
        )
        .pipe(catchError(() => EMPTY))
        .subscribe((result) => {
          this.holdings.set(result.items ?? []);
          this.totalCount.set(result.totalCount ?? 0);
          this._syncPolling();
        });
    }, SYNC_POLL_INTERVAL_MS);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * La date à montrer dépend du statut : ce qui intéresse l'agent sur un produit actif
   * est la date d'accusé du back-office, sur un brouillon la date de saisie.
   */
  private _dateOf(holding: HoldingDto): { dateLabel: string; dateCaption: string } {
    if (holding.syncedAt) {
      return { dateLabel: this._formatDate(holding.syncedAt), dateCaption: 'Synchronisé le' };
    }
    if (holding.signedAt) {
      return { dateLabel: this._formatDate(holding.signedAt), dateCaption: 'Signé le' };
    }
    return { dateLabel: this._formatDate(holding.createdAt), dateCaption: 'Créé le' };
  }

  private _formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
}

export default ClientProduits;
