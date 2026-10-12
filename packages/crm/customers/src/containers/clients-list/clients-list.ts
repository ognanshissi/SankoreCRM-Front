import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { DatePipe, NgClass } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { EMPTY, Observable, Subject, catchError, debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TasSelect } from '@talisoft/ui/select';
import { TasTable, TableConfig } from '@talisoft/ui/table';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import {
  AgenciesApiService,
  ClientLifecycleApiService,
  ClientQuickCountsDto,
  ClientSearchItemDto,
  ClientsApiService,
  PagedResultOfClientSearchItemDto,
  RevealSensitiveFieldRequestFieldEnum,
  UsersApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import {
  CLIENT_STATUS_ORDER,
  CLIENT_TYPE_ORDER,
  RISK_LEVEL_ORDER,
  clientStatusLabel,
  clientTypeLabel,
  isLegalClient,
  riskLevelLabel,
} from '../../models/client-labels';
import { TasFormField } from '@talisoft/ui/form-field';

/** Critères de recherche du champ unique. `auto` laisse l'heuristique décider. */
export type SearchCriterion =
  | 'auto'
  | 'name'
  | 'phone'
  | 'clientNumber'
  | 'identityDocument';

/** Critère réellement envoyé à l'API, une fois `auto` résolu. */
export type ResolvedCriterion = Exclude<SearchCriterion, 'auto'>;

const CRITERION_HINTS: Record<ResolvedCriterion, string> = {
  name: 'Recherche par nom',
  phone: 'Recherche par téléphone',
  clientNumber: 'Recherche par numéro client',
  identityDocument: "Recherche par pièce d'identité",
};

const CRITERION_CHIPS: { value: SearchCriterion; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  { value: 'name', label: 'Nom' },
  { value: 'phone', label: 'Téléphone' },
  { value: 'clientNumber', label: 'Numéro client' },
  { value: 'identityDocument', label: "Pièce d'identité" },
];

/**
 * Le contrat décrit le numéro client comme `{AgencyCode}-{YYYY}-{Seq}`
 * (description de `POST /api/v1/clients`). On accepte le préfixe seul
 * (`ABJ01-2026`) pour que la détection réagisse avant la saisie complète.
 */
const CLIENT_NUMBER_PATTERN = /^[A-Za-z0-9]{2,12}-\d{4}(-[A-Za-z0-9]{1,12})?$/;

/** Sépare les séparateurs de saisie du contenu à analyser. */
function compact(value: string): string {
  return value.replace(/[\s.()/+-]/g, '');
}

/**
 * Heuristique locale, sans appel réseau.
 *
 * Le numéro client est testé en premier : son format contient une majorité de
 * chiffres et dépasse 8 caractères, il serait donc capté par la règle du
 * téléphone si celle-ci passait avant.
 */
export function detectSearchCriterion(raw: string): ResolvedCriterion {
  const value = raw.trim();
  if (!value) return 'name';

  if (CLIENT_NUMBER_PATTERN.test(value)) return 'clientNumber';

  const compacted = compact(value);
  if (!compacted) return 'name';

  const digits = (compacted.match(/\d/g) ?? []).length;
  const letters = (compacted.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;

  if (digits >= 8 && digits > compacted.length / 2) return 'phone';
  if (letters > 0 && digits > 0 && /^[A-Za-z0-9]+$/.test(compacted)) {
    return 'identityDocument';
  }
  return 'name';
}

type ClientStatusParam =
  | 'PendingKyc' | 'Active' | 'Suspended' | 'KycRejected' | 'Archived' | 'Merged';
type ClientTypeParam = 'Individual' | 'Legal';
type RiskParam = 'Unknown' | 'Low' | 'Medium' | 'High';

/** Raccourcis de la liste, comptés par `GET clients/quick-counts` sous les mêmes critères. */
export type QuickFilter = 'All' | 'KycToStart' | 'KycInProgress' | 'HighRisk' | 'WithoutAdvisor';

const QUICK_FILTERS: { value: QuickFilter; label: string; count: keyof ClientQuickCountsDto }[] = [
  { value: 'All', label: 'Tous', count: 'all' },
  { value: 'KycToStart', label: 'KYC à démarrer', count: 'kycToStart' },
  { value: 'KycInProgress', label: 'KYC en cours', count: 'kycInProgress' },
  { value: 'HighRisk', label: 'Risque élevé', count: 'highRisk' },
  { value: 'WithoutAdvisor', label: 'Sans conseiller', count: 'withoutAdvisor' },
];

/** Libellé et teinte du parcours, depuis le statut interne du dossier KYC. */
const KYC_STAGES: Record<string, { label: string; tone: 'muted' | 'warn' | 'info' | 'ok' | 'error' } | undefined> = {
  Collecting: { label: 'Pièces manquantes', tone: 'warn' },
  ComplementRequired: { label: 'Complément requis', tone: 'warn' },
  Verifying: { label: 'En vérification', tone: 'info' },
  Validating: { label: 'En validation', tone: 'info' },
  Simplified: { label: 'Simplifié validé', tone: 'ok' },
  Full: { label: 'Complet validé', tone: 'ok' },
  UnderReview: { label: 'En revue', tone: 'info' },
  Expired: { label: 'Expiré', tone: 'error' },
  Rejected: { label: 'Rejeté', tone: 'error' },
  Suspended: { label: 'Suspendu', tone: 'error' },
};

const PAGE_SIZES = [10, 25, 50];

/** Ligne prête à afficher : libellés déjà résolus. */
export interface ClientRow {
  id: string;
  clientNumber: string;
  displayName: string;
  initials: string;
  isLegal: boolean;
  phoneMasked: string;
  kycLabel: string;
  kycTone: 'muted' | 'warn' | 'info' | 'ok' | 'error';
  /** 0 à 3 segments remplis. */
  kycSteps: number;
  risk: string;
  riskLabel: string;
  isPep: boolean;
  products: string[];
  agencyId: string;
  agencyName: string;
  advisorUserId: string | null;
  advisorName: string | null;
  activity: string | null;
  activityAt: string | null;
  createdAt: string | null;
  item: ClientSearchItemDto;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

@Component({
  selector: 'clients-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clients-list.html',
  imports: [DatePipe, FormsModule, TasIcon, Button, TasSelect, TasTable, TimeagoPipe, TasFormField, NgClass],
})
export class ClientsListPage implements OnInit {
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _lifecycleApi = inject(ClientLifecycleApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canCreate = this._permissions.can('customers:create');
  public readonly canRead = this._permissions.can('customers:read');
  public readonly canMerge = this._permissions.can('customers:merge');
  public readonly canAssign = this._permissions.can('customers:update');
  public readonly canReveal = this._permissions.can('customers:reveal_sensitive');

  public isLoading = signal(true);
  public hasFailed = signal(false);
  public items = signal<ClientSearchItemDto[]>([]);
  public totalCount = signal(0);
  public counts = signal<ClientQuickCountsDto | null>(null);

  // Filtres, tous restitués depuis l'URL au démarrage.
  public filterQuery = signal('');
  public forcedCriterion = signal<SearchCriterion>('auto');
  public quick = signal<QuickFilter>('All');
  public filterStatus = signal<string | null>(null);
  public filterType = signal<string | null>(null);
  public filterAgency = signal<string | null>(null);
  public filterAdvisor = signal<string | null>(null);
  public filterRisk = signal<string | null>(null);
  public filterPep = signal<string | null>(null);
  public showMoreFilters = signal(false);
  public page = signal(1);
  public pageSize = signal(25);

  /** Ligne ouverte dans le panneau d'aperçu. */
  public selectedId = signal<string | null>(null);
  /** Cases cochées, pour l'attribution groupée. */
  public checked = signal<ReadonlySet<string>>(new Set());
  public advisorChoices = signal<{ label: string; value: string }[]>([]);
  public isAssigning = signal(false);
  public isRevealing = signal(false);
  public bulkAdvisor = signal<string | null>(null);

  private readonly _agencies = signal<{ label: string; value: string }[]>([]);
  private readonly _advisors = signal<{ label: string; value: string }[]>([]);

  public readonly agencyOptions = this._agencies.asReadonly();
  public readonly advisorOptions = this._advisors.asReadonly();
  public readonly quickFilters = QUICK_FILTERS;
  public readonly pageSizes = PAGE_SIZES;

  public readonly statusOptions = CLIENT_STATUS_ORDER.map((name) => ({ label: clientStatusLabel(name), value: name }));
  public readonly typeOptions = CLIENT_TYPE_ORDER.map((name) => ({ label: clientTypeLabel(name), value: name }));
  public readonly riskOptions = RISK_LEVEL_ORDER.map((name) => ({ label: riskLevelLabel(name), value: name }));
  public readonly pepOptions = [
    { label: 'Exposés (PPE)', value: 'true' },
    { label: 'Non exposés', value: 'false' },
  ];
  public readonly criterionOptions = CRITERION_CHIPS.map((c) => ({
    label: c.value === 'auto' ? 'Tous les champs' : c.label,
    value: c.value,
  }));

  /** Critère déduit de la saisie, avant tout forçage. */
  public readonly detectedCriterion = computed<ResolvedCriterion>(() => detectSearchCriterion(this.filterQuery()));

  /** Critère finalement appliqué : le forçage manuel gagne sur l'heuristique. */
  public readonly criterion = computed<ResolvedCriterion>(() => {
    const forced = this.forcedCriterion();
    return forced === 'auto' ? this.detectedCriterion() : forced;
  });

  public readonly criterionHint = computed(() => CRITERION_HINTS[this.criterion()]);

  /**
   * Le serveur impose deux contraintes qui surprennent sans explication :
   * le nom est ignoré en dessous de 3 caractères, le téléphone et la pièce
   * sont comparés à l'identique après normalisation.
   */
  public readonly criterionNote = computed(() => {
    const value = this.filterQuery().trim();
    if (!value) return '';
    switch (this.criterion()) {
      case 'name':
        return value.length < 3 ? 'Saisissez au moins 3 caractères pour lancer la recherche par nom.' : '';
      case 'phone':
        return 'Le numéro doit correspondre exactement, quel que soit son format.';
      case 'identityDocument':
        return 'Le numéro de pièce doit correspondre exactement.';
      case 'clientNumber':
        return 'Le numéro client doit correspondre exactement.';
    }
  });

  public readonly hasActiveFilters = computed(
    () =>
      this.filterQuery().trim().length > 0 ||
      this.quick() !== 'All' ||
      this.filterStatus() !== null ||
      this.filterType() !== null ||
      this.filterAgency() !== null ||
      this.filterAdvisor() !== null ||
      this.filterRisk() !== null ||
      this.filterPep() !== null,
  );

  public readonly moreFiltersCount = computed(
    () => [this.filterStatus(), this.filterRisk(), this.filterPep()].filter((v) => v !== null).length,
  );

  public readonly agencyFilterLabel = computed(() => {
    const id = this.filterAgency();
    return id ? this._agencies().find((a) => a.value === id)?.label ?? null : null;
  });

  public readonly rows = computed<ClientRow[]>(() =>
    this.items().map((item) => {
      const name = item.displayName ?? 'Client sans nom';
      const stage = item.kyc?.stage ? KYC_STAGES[item.kyc.stage] : null;
      return {
        id: item.id ?? '',
        clientNumber: item.clientNumber ?? '—',
        displayName: name,
        initials: initialsOf(name),
        isLegal: isLegalClient(item.clientType),
        phoneMasked: item.primaryPhoneMasked ?? '',
        kycLabel: stage?.label ?? (item.kyc ? item.kyc.stage ?? 'Dossier ouvert' : 'Non démarré'),
        kycTone: stage?.tone ?? 'muted',
        kycSteps: item.kyc?.completedSteps ?? 0,
        risk: item.riskLevel ?? 'Unknown',
        riskLabel: riskLevelLabel(item.riskLevel),
        isPep: !!item.hasPepExposure,
        products: item.products ?? [],
        agencyId: item.agencyId ?? '',
        agencyName: item.agencyName ?? '',
        advisorUserId: item.advisorUserId ?? null,
        advisorName: item.advisorName ?? null,
        activity: item.lastActivitySummary ?? null,
        activityAt: item.lastActivityAt ?? item.createdAt ?? null,
        createdAt: item.createdAt ?? null,
        item,
      };
    }),
  );

  public readonly selected = computed(() => this.rows().find((r) => r.id === this.selectedId()) ?? null);

  public readonly allChecked = computed(() => {
    const rows = this.rows();
    return rows.length > 0 && rows.every((r) => this.checked().has(r.id));
  });

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: this.page() - 1,
      pageSize: this.pageSize(),
      totalElements: this.totalCount(),
      pageSizeOptions: PAGE_SIZES,
    },
  }));

  /** Frappes de recherche, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();
  /** Déclencheur des appels serveur, passé en `switchMap` pour annuler l'obsolète. */
  private readonly _reload$ = new Subject<void>();

  ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Clients' }]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    // switchMap : une réponse arrivée après une frappe plus récente serait
    // affichée à la place de la bonne. L'ancienne requête est donc annulée.
    this._reload$
      .pipe(
        switchMap(() => this._searchRequest()),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(({ page, counts }) => this._onResult(page, counts));

    this._restoreFromUrl();
    this._loadFilterLists();
    this._load();
  }

  // ——— Saisie et filtres ———

  /**
   * La recherche texte passe par un debounce de 300 ms : sans lui, chaque
   * frappe déclenchait un appel HTTP. Les listes déroulantes et les raccourcis
   * restent immédiats, un clic étant déjà une intention ferme.
   */
  public onSearchChange(value: string | null): void {
    this.filterQuery.set(value ?? '');
    this._search$.next();
  }

  public onCriterionChange(value: SearchCriterion | null): void {
    this.forcedCriterion.set(value ?? 'auto');
    this._applyFilters();
  }

  public onQuickChange(value: QuickFilter): void {
    if (value === this.quick()) return;
    this.quick.set(value);
    this._applyFilters();
  }

  public onFilterChange(
    key: 'status' | 'type' | 'agency' | 'advisor' | 'risk' | 'pep',
    value: string | null,
  ): void {
    const next = value || null;
    const target = {
      status: this.filterStatus,
      type: this.filterType,
      agency: this.filterAgency,
      advisor: this.filterAdvisor,
      risk: this.filterRisk,
      pep: this.filterPep,
    }[key];
    target.set(next);
    this._applyFilters();
  }

  public resetFilters(): void {
    this.filterQuery.set('');
    this.forcedCriterion.set('auto');
    this.quick.set('All');
    this.filterStatus.set(null);
    this.filterType.set(null);
    this.filterAgency.set(null);
    this.filterAdvisor.set(null);
    this.filterRisk.set(null);
    this.filterPep.set(null);
    this._applyFilters();
  }

  public onPageChange(event: PageEvent): void {
    const sizeChanged = event.pageSize !== this.pageSize();
    this.pageSize.set(event.pageSize);
    this.page.set(sizeChanged ? 1 : event.pageIndex + 1);
    this._syncUrl();
    this._load();
  }

  // ——— Sélection ———

  public toggleChecked(id: string, value: boolean): void {
    const next = new Set(this.checked());
    if (value) next.add(id);
    else next.delete(id);
    this.checked.set(next);
  }

  public toggleAll(value: boolean): void {
    this.checked.set(value ? new Set(this.rows().map((r) => r.id)) : new Set());
  }

  public select(row: ClientRow): void {
    if (this.selectedId() === row.id) return;
    this.selectedId.set(row.id);
    this._loadAdvisorChoices(row.agencyId);
  }

  public closePanel(): void {
    this.selectedId.set(null);
  }

  // ——— Actions du panneau ———

  /**
   * Le numéro en clair passe par l'endpoint de révélation, qui journalise l'accès : appeler un
   * client est une consultation de donnée protégée comme une autre.
   */
  public contact(row: ClientRow, channel: 'tel' | 'sms'): void {
    this.isRevealing.set(true);
    this._clientsApi
      .revealSensitiveField(row.id, { field: RevealSensitiveFieldRequestFieldEnum.Phone })
      .pipe(
        catchError(() => {
          this._snackbar.error('Numéro indisponible', 'Le numéro du client n’a pas pu être lu.');
          this.isRevealing.set(false);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.isRevealing.set(false);
        const number = (result.value ?? '').replace(/[^\d+]/g, '');
        if (!number) {
          this._snackbar.info('Aucun numéro', 'Ce client n’a pas de téléphone enregistré.');
          return;
        }
        window.location.href = `${channel}:${number}`;
      });
  }

  public assignAdvisor(row: ClientRow, advisorUserId: string | null): void {
    if ((advisorUserId || null) === row.advisorUserId) return;
    this.isAssigning.set(true);
    this._lifecycleApi
      .assignClientAdvisor(row.id, { advisorUserId: advisorUserId || null })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error('Attribution impossible', err.error?.detail ?? err.error?.title ?? 'Le conseiller n’a pas été attribué.');
          this.isAssigning.set(false);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.isAssigning.set(false);
        this._snackbar.success('Conseiller attribué', `${row.displayName} est suivi par son nouveau conseiller.`);
        this._load();
      });
  }

  /**
   * Un conseiller doit appartenir à l'agence du client (règle serveur). L'attribution groupée
   * envoie donc chaque client séparément et dit combien ont été refusés, plutôt que de tout annuler.
   */
  public assignChecked(): void {
    const advisor = this.bulkAdvisor();
    const ids = [...this.checked()];
    if (!advisor || ids.length === 0) return;

    this.isAssigning.set(true);
    forkJoin(
      ids.map((id) =>
        this._lifecycleApi.assignClientAdvisor(id, { advisorUserId: advisor }).pipe(
          switchMap(() => of(true)),
          catchError(() => of(false)),
        ),
      ),
    ).subscribe((results) => {
      this.isAssigning.set(false);
      const failed = results.filter((ok) => !ok).length;
      if (failed === 0) this._snackbar.success('Conseiller attribué', `${ids.length} client(s) mis à jour.`);
      else this._snackbar.error('Attribution partielle', `${failed} client(s) sur ${ids.length} n’ont pas pu être attribués (agence différente ?).`);
      this.checked.set(new Set());
      this.bulkAdvisor.set(null);
      this._load();
    });
  }

  public openKyc(row: ClientRow): void {
    if (row.item.kyc?.kycFileId) this._router.navigate(['/kyc', row.item.kyc.kycFileId]);
    else this._router.navigate(['/kyc/enrolment', row.id]);
  }

  // ——— Navigation ———

  public openClient(id: string): void {
    if (!id) return;
    this._router.navigate(['/customers', id]);
  }

  public goToNewClient(): void {
    this._router.navigate(['/customers/nouveau']);
  }

  public goToImport(): void {
    this._router.navigate(['/customers/import-clients']);
  }

  /**
   * AC4 — la saisie infructueuse est transmise à l'assistant de création,
   * avec le critère détecté pour qu'il sache dans quel champ la placer.
   */
  public createFromSearch(): void {
    const value = this.filterQuery().trim();
    this._router.navigate(['/customers/nouveau'], {
      queryParams: value ? { q: value, critere: this.criterion() } : {},
    });
  }

  public goToGroups(): void {
    this._router.navigate(['/customers/groupes']);
  }

  public goToDuplicates(): void {
    this._router.navigate(['/customers/doublons']);
  }

  // ——— Interne ———

  private _restoreFromUrl(): void {
    const params = this._route.snapshot.queryParams;
    if (params['q']) this.filterQuery.set(params['q']);
    if (CRITERION_CHIPS.some((c) => c.value === params['critere'])) {
      this.forcedCriterion.set(params['critere'] as SearchCriterion);
    }
    if (QUICK_FILTERS.some((q) => q.value === params['vue'])) this.quick.set(params['vue'] as QuickFilter);
    if (params['statut']) this.filterStatus.set(params['statut']);
    if (params['type']) this.filterType.set(params['type']);
    if (params['agence']) this.filterAgency.set(params['agence']);
    if (params['conseiller']) this.filterAdvisor.set(params['conseiller']);
    if (params['risque']) this.filterRisk.set(params['risque']);
    if (params['ppe'] === 'true' || params['ppe'] === 'false') this.filterPep.set(params['ppe']);
    if (this.filterStatus() || this.filterRisk() || this.filterPep()) this.showMoreFilters.set(true);

    const page = Number(params['page']);
    if (Number.isInteger(page) && page > 0) this.page.set(page);
    const size = Number(params['taille']);
    if (PAGE_SIZES.includes(size)) this.pageSize.set(size);
  }

  /** Point de passage unique : URL, retour en page 1, rechargement. */
  private _applyFilters(): void {
    this.page.set(1);
    this.checked.set(new Set());
    this._syncUrl();
    this._load();
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery().trim() || null,
        critere: this.forcedCriterion() === 'auto' ? null : this.forcedCriterion(),
        vue: this.quick() === 'All' ? null : this.quick(),
        statut: this.filterStatus() || null,
        type: this.filterType() || null,
        agence: this.filterAgency() || null,
        conseiller: this.filterAdvisor() || null,
        risque: this.filterRisk() || null,
        ppe: this.filterPep() || null,
        page: this.page() > 1 ? this.page() : null,
        taille: this.pageSize() !== 25 ? this.pageSize() : null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private _load(): void {
    this.isLoading.set(true);
    this.hasFailed.set(false);
    this._reload$.next();
  }

  /** La page et ses compteurs partent ensemble, sous les mêmes critères. */
  private _searchRequest(): Observable<{ page: PagedResultOfClientSearchItemDto; counts: ClientQuickCountsDto | null }> {
    const criterion = this.criterion();
    const value = this.filterQuery().trim() || undefined;
    const clientNumber = criterion === 'clientNumber' ? value : undefined;
    const phone = criterion === 'phone' ? value : undefined;
    const document = criterion === 'identityDocument' ? value : undefined;
    const name = criterion === 'name' ? value : undefined;
    const status = (this.filterStatus() || undefined) as ClientStatusParam | undefined;
    const agency = this.filterAgency() ?? undefined;
    const advisor = this.filterAdvisor() ?? undefined;
    const type = (this.filterType() || undefined) as ClientTypeParam | undefined;
    const risk = (this.filterRisk() || undefined) as RiskParam | undefined;
    const pep = this.filterPep() === null ? undefined : this.filterPep() === 'true';

    return forkJoin({
      page: this._clientsApi.searchClients(
        clientNumber, phone, document, name, status, agency, advisor, type, undefined,
        this.page(), this.pageSize(), this.quick(), risk, pep,
      ),
      // Les compteurs sont un confort : leur panne ne doit pas vider la liste.
      counts: this._clientsApi
        .getClientQuickCounts(clientNumber, phone, document, name, status, agency, advisor, type, undefined, risk, pep)
        .pipe(catchError(() => of(null))),
    }).pipe(
      catchError(() => {
        this.items.set([]);
        this.totalCount.set(0);
        this.hasFailed.set(true);
        this.isLoading.set(false);
        return EMPTY;
      }),
    );
  }

  private _onResult(result: PagedResultOfClientSearchItemDto, counts: ClientQuickCountsDto | null): void {
    this.items.set(result.items ?? []);
    this.totalCount.set(result.totalCount ?? 0);
    if (counts) this.counts.set(counts);
    this.isLoading.set(false);
  }

  private _loadAdvisorChoices(agencyId: string): void {
    this.advisorChoices.set([]);
    if (!agencyId || !this.canAssign()) return;
    this._usersApi
      .listUsers('Active', agencyId, undefined, 1, 200)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) =>
        this.advisorChoices.set(
          (result.items ?? [])
            .filter((u) => !!u.id)
            .map((u) => ({ label: u.fullName ?? u.email ?? 'Conseiller', value: u.id as string })),
        ),
      );
  }

  private _loadFilterLists(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => {
        this._agencies.set(
          (result.items ?? [])
            .filter((agency) => !!agency.id)
            .map((agency) => ({ label: agency.name ?? agency.code ?? 'Agence', value: agency.id as string })),
        );
      });

    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 200)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => {
        this._advisors.set(
          (result.items ?? [])
            .filter((user) => !!user.id)
            .map((user) => ({ label: user.fullName ?? user.email ?? 'Conseiller', value: user.id as string })),
        );
      });
  }
}

export default ClientsListPage;
