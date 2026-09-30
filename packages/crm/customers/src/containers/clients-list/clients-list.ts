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
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Observable, Subject, catchError, debounceTime, switchMap } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Severity, TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import {
  AgenciesApiService,
  ClientSearchItemDto,
  ClientSearchItemDtoPagedResult,
  ClientsApiService,
  UsersApiService,
} from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import {
  CLIENT_STATUS_ORDER,
  CLIENT_TYPE_ORDER,
  clientStatusLabel,
  clientStatusSeverity,
  clientTypeLabel,
  kycStatusLabel,
  kycStatusSeverity,
  riskLevelLabel,
  riskLevelSeverity,
} from '../../models/client-labels';

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

/** Nom canonique -> index attendu par `searchClients` (`status` est un entier). */
function statusToIndex(name: string | null): 0 | 1 | 2 | 3 | 4 | 5 | undefined {
  if (!name) return undefined;
  const index = CLIENT_STATUS_ORDER.indexOf(name);
  return index >= 0 ? (index as 0 | 1 | 2 | 3 | 4 | 5) : undefined;
}

/** Nom canonique -> index attendu par `searchClients` (`type` est un entier). */
function typeToIndex(name: string | null): 0 | 1 | undefined {
  if (!name) return undefined;
  const index = CLIENT_TYPE_ORDER.indexOf(name);
  return index >= 0 ? (index as 0 | 1) : undefined;
}

/** Ligne prête à afficher : libellés et sévérités déjà résolus. */
export interface ClientRow {
  id: string;
  clientNumber: string;
  displayName: string;
  phoneMasked: string;
  typeLabel: string;
  statusLabel: string;
  statusSeverity: Severity;
  kycLabel: string;
  kycSeverity: Severity;
  riskLabel: string;
  riskSeverity: Severity;
  agencyName: string;
  advisorName: string;
}

@Component({
  selector: 'clients-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './clients-list.html',
  imports: [
    FormsModule,
    TasCard,
    TasSpinner,
    TasIcon,
    TasTag,
    Button,
    TasFormField,
    TasLabel,
    TasInput,
    TasSelect,
  ],
})
export class ClientsListPage implements OnInit {
  private readonly _clientsApi = inject(ClientsApiService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canCreate = this._permissions.can('customers:create');
  public readonly canRead = this._permissions.can('customers:read');
  public readonly canMerge = this._permissions.can('customers:merge');

  public isLoading = signal(true);
  public hasFailed = signal(false);
  public items = signal<ClientSearchItemDto[]>([]);
  public totalCount = signal(0);
  public totalPages = signal(1);

  // Filtres, tous restitués depuis l'URL au démarrage.
  public filterQuery = signal('');
  public forcedCriterion = signal<SearchCriterion>('auto');
  public filterStatus = signal<string | null>(null);
  public filterType = signal<string | null>(null);
  public filterAgency = signal<string | null>(null);
  public filterAdvisor = signal<string | null>(null);
  public page = signal(1);

  private readonly _pageSize = 25;

  private readonly _agencies = signal<{ label: string; value: string }[]>([]);
  private readonly _advisors = signal<{ label: string; value: string }[]>([]);

  public readonly agencyOptions = this._agencies.asReadonly();
  public readonly advisorOptions = this._advisors.asReadonly();

  public readonly statusOptions = CLIENT_STATUS_ORDER.map((name) => ({
    label: clientStatusLabel(name),
    value: name,
  }));
  public readonly typeOptions = CLIENT_TYPE_ORDER.map((name) => ({
    label: clientTypeLabel(name),
    value: name,
  }));
  public readonly criterionChips = CRITERION_CHIPS;

  /** Critère déduit de la saisie, avant tout forçage. */
  public readonly detectedCriterion = computed<ResolvedCriterion>(() =>
    detectSearchCriterion(this.filterQuery()),
  );

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
        return value.length < 3
          ? 'Saisissez au moins 3 caractères pour lancer la recherche par nom.'
          : 'Le nom est cherché par début de mot.';
      case 'phone':
        return 'Le numéro doit correspondre exactement, quel que soit son format.';
      case 'identityDocument':
        return "Le numéro de pièce doit correspondre exactement.";
      case 'clientNumber':
        return 'Le numéro client doit correspondre exactement.';
    }
  });

  public readonly hasActiveFilters = computed(
    () =>
      this.filterQuery().trim().length > 0 ||
      this.forcedCriterion() !== 'auto' ||
      this.filterStatus() !== null ||
      this.filterType() !== null ||
      this.filterAgency() !== null ||
      this.filterAdvisor() !== null,
  );

  /**
   * `ClientSearchItemDto` ne porte que `agencyId` et `advisorUserId` : les noms
   * viennent des listes déroulantes, chargées une fois au démarrage.
   */
  public readonly rows = computed<ClientRow[]>(() => {
    const agencies = new Map(this._agencies().map((a) => [a.value, a.label]));
    const advisors = new Map(this._advisors().map((a) => [a.value, a.label]));

    return this.items().map((item) => ({
      id: item.id ?? '',
      clientNumber: item.clientNumber ?? '—',
      displayName: item.displayName ?? 'Client sans nom',
      phoneMasked: item.primaryPhoneMasked ?? '—',
      typeLabel: clientTypeLabel(item.clientType),
      statusLabel: clientStatusLabel(item.status),
      statusSeverity: clientStatusSeverity(item.status),
      kycLabel: kycStatusLabel(item.kycStatus),
      kycSeverity: kycStatusSeverity(item.kycStatus),
      riskLabel: riskLevelLabel(item.riskLevel),
      riskSeverity: riskLevelSeverity(item.riskLevel),
      agencyName: (item.agencyId && agencies.get(item.agencyId)) || 'Agence inconnue',
      advisorName:
        (item.advisorUserId && advisors.get(item.advisorUserId)) || 'Non attribué',
    }));
  });

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
      .subscribe((result) => this._onResult(result));

    this._restoreFromUrl();
    this._loadFilterLists();
    this._load();
  }

  // ——— Saisie et filtres ———

  /**
   * La recherche texte passe par un debounce de 300 ms : sans lui, chaque
   * frappe déclenchait un appel HTTP. Les listes déroulantes et les puces de
   * critère restent immédiates, un clic étant déjà une intention ferme.
   */
  public onSearchChange(value: string | null): void {
    this.filterQuery.set(value ?? '');
    this._search$.next();
  }

  public onCriterionChange(value: SearchCriterion): void {
    this.forcedCriterion.set(value);
    this._applyFilters();
  }

  public onFilterChange(
    key: 'status' | 'type' | 'agency' | 'advisor',
    value: string | null,
  ): void {
    const next = value || null;
    switch (key) {
      case 'status':
        this.filterStatus.set(next);
        break;
      case 'type':
        this.filterType.set(next);
        break;
      case 'agency':
        this.filterAgency.set(next);
        break;
      case 'advisor':
        this.filterAdvisor.set(next);
        break;
    }
    this._applyFilters();
  }

  public resetFilters(): void {
    this.filterQuery.set('');
    this.forcedCriterion.set('auto');
    this.filterStatus.set(null);
    this.filterType.set(null);
    this.filterAgency.set(null);
    this.filterAdvisor.set(null);
    this._applyFilters();
  }

  public goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.page()) return;
    this.page.set(page);
    this._syncUrl();
    this._load();
  }

  // ——— Navigation ———

  public openClient(id: string): void {
    if (!id) return;
    this._router.navigate(['/customers', id]);
  }

  public goToNewClient(): void {
    this._router.navigate(['/customers/nouveau']);
  }

  /**
   * L'écran d'import vit dans le module Paramétrage, avec celui des utilisateurs : c'est là que
   * le repo regroupe les imports (cf. le groupe « Données & Importation » de l'aperçu).
   */
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
    if (params['statut']) this.filterStatus.set(params['statut']);
    if (params['type']) this.filterType.set(params['type']);
    if (params['agence']) this.filterAgency.set(params['agence']);
    if (params['conseiller']) this.filterAdvisor.set(params['conseiller']);

    const page = Number(params['page']);
    if (Number.isInteger(page) && page > 0) this.page.set(page);
  }

  /** Point de passage unique : URL, retour en page 1, rechargement. */
  private _applyFilters(): void {
    this.page.set(1);
    this._syncUrl();
    this._load();
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        q: this.filterQuery().trim() || null,
        critere: this.forcedCriterion() === 'auto' ? null : this.forcedCriterion(),
        statut: this.filterStatus() || null,
        type: this.filterType() || null,
        agence: this.filterAgency() || null,
        conseiller: this.filterAdvisor() || null,
        page: this.page() > 1 ? this.page() : null,
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

  private _searchRequest(): Observable<ClientSearchItemDtoPagedResult> {
    const criterion = this.criterion();
    const value = this.filterQuery().trim() || undefined;

    return this._clientsApi
      .searchClients(
        criterion === 'clientNumber' ? value : undefined,
        criterion === 'phone' ? value : undefined,
        criterion === 'identityDocument' ? value : undefined,
        criterion === 'name' ? value : undefined,
        statusToIndex(this.filterStatus()),
        this.filterAgency() ?? undefined,
        this.filterAdvisor() ?? undefined,
        typeToIndex(this.filterType()),
        undefined,
        this.page(),
        this._pageSize,
      )
      .pipe(
        catchError(() => {
          this.items.set([]);
          this.totalCount.set(0);
          this.totalPages.set(1);
          this.hasFailed.set(true);
          this.isLoading.set(false);
          return EMPTY;
        }),
      );
  }

  private _onResult(result: ClientSearchItemDtoPagedResult): void {
    this.items.set(result.items ?? []);
    this.totalCount.set(result.totalCount ?? 0);
    this.totalPages.set(Math.max(result.totalPages ?? 1, 1));
    this.isLoading.set(false);
  }

  private _loadFilterLists(): void {
    this._agenciesApi
      .listAgencies(false, 1, 200)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => {
        this._agencies.set(
          (result.items ?? [])
            .filter((agency) => !!agency.id)
            .map((agency) => ({
              label: agency.name ?? agency.code ?? 'Agence',
              value: agency.id as string,
            })),
        );
      });

    this._usersApi
      .listUsers(undefined, undefined, undefined, 1, 200)
      .pipe(catchError(() => EMPTY))
      .subscribe((result) => {
        this._advisors.set(
          (result.items ?? [])
            .filter((user) => !!user.id)
            .map((user) => ({
              label: user.fullName ?? user.email ?? 'Conseiller',
              value: user.id as string,
            })),
        );
      });
  }
}

export default ClientsListPage;
