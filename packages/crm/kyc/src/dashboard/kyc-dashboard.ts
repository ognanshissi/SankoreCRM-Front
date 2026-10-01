import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { catchError, debounceTime, EMPTY, Subject } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { AgenciesApiService } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { KycDashboardRow } from '../data-access/kyc.types';
import {
  KYC_STATUS_FILTER_OPTIONS,
  kycScoreBarClasses,
  kycVigilanceMeta,
} from '../data-access/kyc-referential';
import { KycStatusBadge } from '../ui/kyc-status-badge';
import { KycOpenFileDrawer } from '../enrolment/open-kyc-file-drawer';

/** Alerte d'ancienneté affichée sur une ligne (KYC-F-06). */
interface KycRowAlert {
  /** Libellé explicite : l'information ne doit jamais reposer sur la seule couleur. */
  label: string;
  icon: string;
  classes: string;
}

/**
 * Ligne enrichie pour l'affichage. Les champs dérivés sont calculés une fois au chargement plutôt
 * qu'appelés depuis le template : `tas-table` rend le corps via un `ng-template` réévalué à chaque
 * détection de changement, et une fonction par cellule y serait rejouée en boucle.
 */
interface KycDashboardViewRow extends KycDashboardRow {
  ageDays: number;
  alert: KycRowAlert | null;
  scoreBarClasses: string;
  vigilanceLabel: string;
  vigilanceSeverity: Severity;
}

const AGENCY_ALL = '';

@Component({
  selector: 'kyc-dashboard',
  templateUrl: './kyc-dashboard.html',
  imports: [
    FormsModule,
    TasCard,
    TasIcon,
    Button,
    TasTag,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
    TasTable,
    TimeagoPipe,
    KycStatusBadge,
  ],
})
export class KycDashboardPage implements OnInit {
  private readonly _facade = inject(KycFacadeService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  /**
   * Droit d'ouvrir un dossier sur un client existant : `kyc:manage`, le droit d'écriture du module
   * KYC — celui que le swagger exige pour déposer une pièce (`POST /kyc-files/{id}/documents`), et
   * donc pour tout ce que l'enrôlement fait. C'est **le même code que le garde de la route
   * d'enrôlement** (`kyc.routes.ts`) : sur un autre code, l'écran proposerait une action que le
   * routeur refuserait ensuite.
   */
  public readonly canOpenFile = this._permissions.can('kyc:manage');

  // ── État de chargement ────────────────────────────────────────────────
  public isLoading = signal(true);
  /**
   * Message d'erreur du dernier chargement. Séparé de l'état vide à dessein : une panne qui
   * s'afficherait « Aucun dossier en attente » ferait croire à un agent de conformité qu'il n'a
   * rien à traiter.
   */
  public loadError = signal<string | null>(null);

  /** Toutes les lignes connues du serveur, avant recherche texte locale. */
  private readonly _rows = signal<KycDashboardViewRow[]>([]);
  public totalCount = signal(0);

  /**
   * Nombre de dossiers attendant une décision de l'utilisateur connecté.
   *
   * Le cahier demande ce compteur dans le menu latéral, qui n'appartient pas à ce module. Il est
   * donc exposé de deux façons, les deux publiques et stables :
   *  - `awaitingMeCount` : signal lisible par un parent qui garde une référence au composant ;
   *  - `awaitingMeCountChange` : sortie émise à chaque chargement réussi, pour un parent routé.
   *
   * Le jour où le menu doit l'afficher sans ouvrir l'écran, la bonne réponse n'est ni l'un ni
   * l'autre mais un compteur porté par un service applicatif alimenté par l'endpoint de liste
   * (absent, cf. `KycFacadeService.searchFiles`).
   */
  public readonly awaitingMeCount = signal(0);
  public readonly awaitingMeCountChange = output<number>();

  // ── Filtres ───────────────────────────────────────────────────────────
  /** Ce que l'utilisateur est en train de taper. */
  public filterQuery = signal('');
  /** Ce que la liste applique réellement : la valeur de `filterQuery` après le debounce. */
  private readonly _appliedQuery = signal('');
  public filterStatus = signal<string>('');
  public filterAgency = signal<string>(AGENCY_ALL);
  public filterVigilance = signal<string>('');
  public filterFrom = signal<string>('');
  public filterTo = signal<string>('');

  public readonly statusOptions = [
    { label: 'Tous les statuts', value: '' },
    ...KYC_STATUS_FILTER_OPTIONS,
  ];

  /**
   * Les libellés de vigilance viennent du référentiel : seules les clés d'API sont écrites ici,
   * jamais le texte affiché.
   */
  public readonly vigilanceOptions = [
    { label: 'Tous les niveaux', value: '' },
    ...['Simplified', 'Standard', 'Enhanced'].map((value) => ({
      value,
      label: kycVigilanceMeta(value).label,
    })),
  ];

  public agencyOptions = signal<{ label: string; value: string }[]>([
    { label: 'Toutes les agences', value: AGENCY_ALL },
  ]);

  /** Frappes de recherche, regroupées avant le recalcul de la liste. */
  private readonly _search$ = new Subject<void>();

  private readonly _pageIndex = signal(0);
  private readonly _pageSize = signal(20);

  /**
   * Lignes affichées : la page du serveur, avec le SEUL filtre resté local.
   *
   * La recherche texte porte sur le **nom du client**, et ce nom n'existe pas côté KYC : les noms
   * vivent en clair dans M01 pour que sa recherche reste un parcours d'index, et c'est l'écran qui
   * les résout, une requête par client de la page. Le serveur ne peut donc pas filtrer dessus, et la
   * recherche est volontairement **dégradée à la page courante** — arbitrage du propriétaire. Le
   * libellé du compteur le dit, sans quoi l'utilisateur lirait « aucun résultat » en pensant avoir
   * cherché dans tout le portefeuille.
   *
   * Statut, agence, vigilance et période sont partis au serveur. Le tri aussi : les dossiers
   * attendant l'utilisateur d'abord, puis du plus anciennement mis à jour au plus récent — un
   * dossier qui dort est celui qui coûte. Le rejouer ici ne ferait que réordonner vingt lignes déjà
   * ordonnées, et le ferait diverger du jour où le serveur change d'avis.
   */
  public readonly displayedRows = computed<KycDashboardViewRow[]>(() => {
    const query = this._appliedQuery().trim().toLowerCase();
    if (!query) return this._rows();

    return this._rows().filter((row) => row.customerName.toLowerCase().includes(query));
  });

  /** Lignes de la page, avant le filtre texte local : ce que le serveur a renvoyé. */
  public readonly loadedCount = computed(() => this._rows().length);

  public readonly displayedCount = computed(() => this.displayedRows().length);

  /**
   * `serverSide: true` : `tas-table` émet `pageEventChange` et prend sa longueur de
   * `totalElements`. Depuis la correction de `TableDataSource`, il ne redécoupe plus les lignes
   * reçues — on lui passe donc la page du serveur, et rien de plus.
   */
  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'kycFileId',
    pagination: {
      serverSide: true,
      pageIndex: this._pageIndex(),
      pageSize: this._pageSize(),
      pageSizeOptions: [10, 20, 50],
      // Le total du SERVEUR, pas ce qui est à l'écran : le paginateur doit proposer les pages
      // suivantes même quand le filtre texte local masque des lignes de la page courante.
      totalElements: this.totalCount(),
    },
  }));
  public readonly isEmpty = computed(
    () => !this.isLoading() && !this.loadError() && this.displayedCount() === 0,
  );
  public readonly hasActiveFilters = computed(
    () =>
      !!this.filterQuery() ||
      !!this.filterStatus() ||
      !!this.filterAgency() ||
      !!this.filterVigilance() ||
      !!this.filterFrom() ||
      !!this.filterTo(),
  );

  public ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Conformité' }, { label: 'Dossiers KYC' }]);

    // Sans debounce, chaque frappe relançait le recalcul (et relancera l'appel réseau quand
    // l'endpoint existera). Les listes déroulantes, elles, restent immédiates : un clic est déjà
    // une intention ferme.
    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => {
        // Pas de rechargement : la recherche porte sur la page déjà chargée. Et pas de retour à la
        // première page non plus — cela rechargerait une page que l'utilisateur n'a pas demandée.
        this._appliedQuery.set(this.filterQuery());
        this._pushFiltersToUrl();
      });

    this._restoreFiltersFromUrl();
    this._loadAgencies();
    this._load();
  }

  // ── Filtres ───────────────────────────────────────────────────────────

  public onSearchChange(value: string | null): void {
    this.filterQuery.set(value ?? '');
    this._search$.next();
  }

  public onStatusChange(value: string | null): void {
    this.filterStatus.set(value ?? '');
    this._applyServerFilters();
  }

  public onAgencyChange(value: string | null): void {
    this.filterAgency.set(value ?? AGENCY_ALL);
    this._applyServerFilters();
  }

  public onVigilanceChange(value: string | null): void {
    this.filterVigilance.set(value ?? '');
    this._applyServerFilters();
  }

  public onFromChange(value: string): void {
    this.filterFrom.set(value ?? '');
    this._applyServerFilters();
  }

  public onToChange(value: string): void {
    this.filterTo.set(value ?? '');
    this._applyServerFilters();
  }

  public resetFilters(): void {
    this.filterQuery.set('');
    this._appliedQuery.set('');
    this.filterStatus.set('');
    this.filterAgency.set(AGENCY_ALL);
    this.filterVigilance.set('');
    this.filterFrom.set('');
    this.filterTo.set('');
    this._applyServerFilters();
  }

  public reload(): void {
    this._load();
  }

  /** Chaque page est un appel : le serveur pagine, trie et compte. */
  public onPageChange(event: PageEvent): void {
    this._pageIndex.set(event.pageIndex);
    this._pageSize.set(event.pageSize);
    this._load();
  }

  public openFile(row: KycDashboardViewRow): void {
    this._router.navigate(['/kyc', row.kycFileId]);
  }

  /**
   * Ouvre un dossier sur un client existant. Le drawer ne fait que choisir le client ; c'est
   * l'écran d'enrôlement qui appelle `POST /kyc-files`, idempotent, et reprend le dossier
   * existant le cas échéant.
   */
  public openFileForCustomer(): void {
    const ref = this._sideDrawerService.open<string, unknown, KycOpenFileDrawer>(KycOpenFileDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((customerId) => {
      if (customerId) this._router.navigate(['/kyc', 'enrolment', customerId]);
    });
  }

  /** Libellé lu par un lecteur d'écran sur une ligne activable. */
  public rowAriaLabel(row: KycDashboardViewRow): string {
    const parts = [`Dossier de ${row.customerName}`, row.alert?.label, row.requiredAction];
    return parts.filter(Boolean).join(', ');
  }

  // ── Chargement ────────────────────────────────────────────────────────

  private _applyServerFilters(): void {
    this._resetToFirstPage();
    this._pushFiltersToUrl();
    this._load();
  }

  private _resetToFirstPage(): void {
    this._pageIndex.set(0);
  }

  /** Une vue filtrée doit être partageable par simple copie de l'URL. */
  private _pushFiltersToUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery() || null,
        status: this.filterStatus() || null,
        agencyId: this.filterAgency() || null,
        vigilance: this.filterVigilance() || null,
        from: this.filterFrom() || null,
        to: this.filterTo() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private _restoreFiltersFromUrl(): void {
    const params = this._route.snapshot.queryParams;
    if (params['q']) {
      this.filterQuery.set(params['q']);
      this._appliedQuery.set(params['q']);
    }
    if (params['status']) this.filterStatus.set(params['status']);
    if (params['agencyId']) this.filterAgency.set(params['agencyId']);
    if (params['vigilance']) this.filterVigilance.set(params['vigilance']);
    if (params['from']) this.filterFrom.set(params['from']);
    if (params['to']) this.filterTo.set(params['to']);
  }

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);

    this._facade
      .searchFiles({
        status: this.filterStatus(),
        agencyId: this.filterAgency(),
        vigilanceLevel: this.filterVigilance(),
        from: this.filterFrom(),
        to: this.filterTo(),
        page: this._pageIndex(),
        pageSize: this._pageSize(),
      })
      .pipe(
        catchError(() => {
          this._rows.set([]);
          this.totalCount.set(0);
          this.loadError.set(
            "La liste des dossiers n'a pas pu être chargée. Réessayez dans un instant.",
          );
          this.isLoading.set(false);
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((page) => {
        this._rows.set(page.rows.map((row) => this._toViewRow(row)));
        this.totalCount.set(page.totalCount);
        this.awaitingMeCount.set(page.awaitingMeCount);
        this.awaitingMeCountChange.emit(page.awaitingMeCount);
        this.isLoading.set(false);
      });
  }

  private _toViewRow(row: KycDashboardRow): KycDashboardViewRow {
    const vigilance = kycVigilanceMeta(row.vigilanceLevel);
    const ageDays = this._ageInDays(row.updatedAt);
    return {
      ...row,
      ageDays,
      alert: this._alertFor(row.status, ageDays),
      scoreBarClasses: kycScoreBarClasses(row.confidenceScore),
      vigilanceLabel: vigilance.label,
      vigilanceSeverity: vigilance.severity,
    };
  }

  private _ageInDays(updatedAt: string): number {
    const parsed = Date.parse(updatedAt);
    if (Number.isNaN(parsed)) return 0;
    return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
  }

  /**
   * Expiré en rouge, revue en cours en orange — mais toujours avec un libellé et une icône :
   * un écran de conformité doit rester lisible sans distinguer les teintes (WCAG 2.1 AA, 1.4.1).
   */
  private _alertFor(status: string, ageDays: number): KycRowAlert | null {
    const age = `depuis ${ageDays} jour${ageDays > 1 ? 's' : ''}`;
    if (status === 'Expired') {
      return {
        label: `Expiré ${age}`,
        icon: 'feather:alert-octagon',
        classes: 'bg-red-50 text-red-700 border border-red-200',
      };
    }
    if (status === 'UnderReview') {
      return {
        label: `En revue ${age}`,
        icon: 'feather:alert-triangle',
        classes: 'bg-orange-50 text-orange-700 border border-orange-200',
      };
    }
    return null;
  }

  private _loadAgencies(): void {
    // `(false, 1, 0)` = toutes les agences non supprimées, comme ailleurs dans le repo.
    this._agenciesApi
      .listAgencies(false, 1, 0)
      .pipe(
        catchError(() => {
          // Le filtre agence est un confort : son absence ne doit pas faire échouer l'écran.
          return EMPTY;
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((result) => {
        this.agencyOptions.set([
          { label: 'Toutes les agences', value: AGENCY_ALL },
          ...(result.items ?? []).map((agency) => ({
            label: agency.name ?? '—',
            value: agency.id ?? '',
          })),
        ]);
      });
  }
}

export default KycDashboardPage;
