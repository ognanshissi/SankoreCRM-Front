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
import { catchError, debounceTime, EMPTY, forkJoin, of, Subject } from 'rxjs';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { AgenciesApiService } from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { KycDashboardFilters, KycDashboardPage as KycFilesPage, KycDashboardRow } from '../data-access/kyc.types';
import { kycTierLabel } from '../data-access/kyc-referential';
import { KycOpenFileDrawer } from '../enrolment/open-kyc-file-drawer';

/**
 * Dossiers KYC en table (propriétaire, 2026-11-02) : une ligne par dossier, l'étape qu'il attend en
 * colonne et en filtre, l'action qui le fait avancer au bout de la ligne. La vue maître-détail
 * qu'elle remplace répétait dans un aperçu ce que la page du dossier montre déjà.
 *
 * La liste est chargée d'un bloc (une page de 100, le maximum du serveur) puis rangée ici : les
 * étapes sont une lecture du statut, pas des filtres serveur. La recherche filtre ce bloc côté
 * client — l'endpoint n'a pas de paramètre texte — et l'écran le dit quand le périmètre dépasse ce
 * qui est chargé.
 */

type Scope = 'mine' | 'agency' | 'all';
/** Ce que les lignes « Dossiers à gérer » de Ma journée ouvrent : `?filtre=`. */
type Watch = 'revisions' | 'pieces';

const WATCH_LABELS: Record<Watch, string> = {
  revisions: 'Révisions à faire',
  pieces: 'Pièces expirées ou bientôt expirées',
};

type GroupKey = 'decide' | 'blocked' | 'client' | 'validation' | 'validated' | 'closed';

/** L'action au bout de la ligne : l'onglet du dossier qui le fait avancer. */
type RowActionKind = 'validation' | 'score' | 'piece' | 'upgrade' | 'open';

interface KycRow {
  id: string;
  customerId: string;
  name: string;
  initials: string;
  subtitle: string;
  ageDays: number;
  agencyName: string | null;
  group: Omit<Group, 'count'>;
  tier: string | null;
  action: { kind: RowActionKind; label: string };
  row: KycDashboardRow;
}

interface Group {
  key: GroupKey;
  label: string;
  dot: string;
  labelClass: string;
  count: number;
}

const PAGE_SIZE = 100;
const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

const GROUPS: Omit<Group, 'count'>[] = [
  { key: 'decide',     label: 'À vous de décider',     dot: 'bg-primary',   labelClass: 'text-primary' },
  { key: 'blocked',    label: 'Bloqués',               dot: 'bg-orange-700', labelClass: 'text-orange-800' },
  { key: 'client',     label: 'En attente du client',  dot: 'bg-slate-400', labelClass: 'text-slate-700' },
  { key: 'validation', label: 'En validation',         dot: 'bg-blue-500',  labelClass: 'text-slate-700' },
  { key: 'validated',  label: 'Validés récemment',     dot: 'bg-green-600', labelClass: 'text-green-800' },
  { key: 'closed',     label: 'Clos ou plus anciens',  dot: 'bg-slate-300', labelClass: 'text-slate-500' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '')).toUpperCase();
}

function ageInDays(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

/** L'action qu'offrait l'aperçu, désormais au bout de la ligne. */
function actionOf(row: KycDashboardRow, group: GroupKey): KycRow['action'] {
  if (row.awaitingMe) return { kind: 'validation', label: 'Décider' };
  if (group === 'validated' && row.tier === 'Simplified') return { kind: 'upgrade', label: 'Passer en KYC complet' };
  switch (row.status) {
    case 'Verifying':
      return { kind: 'score', label: 'Voir le score' };
    case 'Collecting':
    case 'ComplementRequired':
      return { kind: 'piece', label: 'Voir les pièces' };
    case 'Validating':
      return { kind: 'validation', label: 'Voir le circuit' };
    default:
      return { kind: 'open', label: 'Ouvrir' };
  }
}

/** À quel groupe appartient une ligne : l'ordre des tests est la règle. */
function groupOf(row: KycDashboardRow): GroupKey {
  if (row.awaitingMe) return 'decide';
  switch (row.status) {
    case 'Verifying':
    case 'Suspended':
    case 'Expired':
      return 'blocked';
    case 'Collecting':
    case 'ComplementRequired':
      return 'client';
    case 'Validating':
      return 'validation';
    case 'Simplified':
    case 'Full':
    case 'UnderReview':
      return ageInDays(row.updatedAt) <= RECENT_DAYS ? 'validated' : 'closed';
    default:
      return 'closed';
  }
}

/** Ce que la ligne dit du dossier, en une phrase courte. */
function subtitleOf(row: KycDashboardRow): string {
  const parts: string[] = [];
  switch (row.status) {
    case 'Validating':
      parts.push(row.awaitingMe ? 'À valider' : 'En validation · autre niveau');
      break;
    case 'Verifying':
      parts.push('Vérification', row.confidenceScore === null ? 'score à calculer' : 'en cours');
      break;
    case 'Collecting':
      parts.push('Collecte', row.isRemoteCollection ? 'lien envoyé' : 'pièces à collecter');
      break;
    case 'ComplementRequired':
      parts.push('Complément', row.isRemoteCollection ? 'lien envoyé' : 'pièces à reprendre');
      break;
    case 'Simplified':
    case 'Full':
      parts.push(`${kycTierLabel(row.tier) ?? 'KYC'} validé`);
      break;
    case 'UnderReview':
      parts.push('Revue en cours');
      break;
    case 'Expired':
      parts.push('Expiré', 'à renouveler');
      break;
    case 'Suspended':
      parts.push('Suspendu');
      break;
    case 'Rejected':
      parts.push('Rejeté');
      break;
    default:
      parts.push(row.status || '—');
  }
  if (row.vigilanceLevel === 'Enhanced') parts.push('vigilance renforcée');
  if (row.duplicateSuspected) parts.push('doublon suspecté');
  return parts.join(' · ');
}

@Component({
  selector: 'kyc-dashboard',
  templateUrl: './kyc-dashboard.html',
  imports: [FormsModule, Button, TasIcon, TasTable],
})
export class KycDashboardPage implements OnInit {
  private readonly _facade = inject(KycFacadeService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly canOpenFile = this._permissions.can('kyc:manage');
  /**
   * Sans « kyc:read:all » (Agent, Agent commercial), le serveur ne renvoie déjà que les dossiers
   * de l'utilisateur (responsable, sinon créateur) : « Mon agence » et « Toutes les agences »
   * montraient la même liste sous un faux libellé. Le sélecteur disparaît et la liste n'envoie
   * pas « mine », qui ne retiendrait que le responsable et cacherait les dossiers créés.
   */
  public readonly canReadAll = this._permissions.can('kyc:read:all');

  /** Remonté au shell pour le badge du menu : dossiers qui attendent l'utilisateur. */
  public readonly awaitingMeCountChange = output<number>();

  public readonly scope = signal<Scope>('all');
  public readonly watch = signal<Watch | null>(null);
  public readonly watchLabel = computed(() => {
    const watch = this.watch();
    return watch ? WATCH_LABELS[watch] : '';
  });
  public readonly query = signal('');
  private readonly _appliedQuery = signal('');
  private readonly _search$ = new Subject<void>();
  /** L'étape filtrée ; null = toutes. */
  public readonly groupFilter = signal<GroupKey | null>(null);

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  private readonly _rows = signal<KycDashboardRow[]>([]);
  public readonly totalCount = signal(0);
  private readonly _agencyNames = signal<Map<string, string>>(new Map());

  public readonly myAgencyId = computed(() => this._auth.connectedUser()?.agencyId ?? null);

  public readonly tableConfig = signal<TableConfig>({
    property: 'kyc-files',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [20, 50, 100] },
  });

  /** Les dossiers que la recherche retient, rangés par étape puis du plus ancien au plus récent. */
  private readonly _searched = computed<KycRow[]>(() => {
    const q = this._appliedQuery().trim().toLowerCase();
    const agencies = this._agencyNames();
    const order = new Map(GROUPS.map((g, i) => [g.key, i]));
    const rows: KycRow[] = [];

    for (const row of this._rows()) {
      const agencyName = row.agencyId ? agencies.get(row.agencyId) ?? null : null;
      if (q && !row.customerName.toLowerCase().includes(q) && !(agencyName ?? '').toLowerCase().includes(q)) continue;
      const key = groupOf(row);
      rows.push({
        id: row.kycFileId,
        customerId: row.customerId,
        name: row.customerName,
        initials: initialsOf(row.customerName),
        subtitle: subtitleOf(row),
        ageDays: ageInDays(row.updatedAt),
        agencyName,
        group: GROUPS.find((g) => g.key === key)!,
        tier: kycTierLabel(row.tier),
        action: actionOf(row, key),
        row,
      });
    }
    return rows.sort((a, b) => order.get(a.group.key)! - order.get(b.group.key)! || b.ageDays - a.ageDays);
  });

  /** Les étapes présentes, avec leur nombre, pour les filtres au-dessus de la table. */
  public readonly groups = computed<Group[]>(() => {
    const counts = new Map<GroupKey, number>();
    for (const r of this._searched()) counts.set(r.group.key, (counts.get(r.group.key) ?? 0) + 1);
    return GROUPS.map((g) => ({ ...g, count: counts.get(g.key) ?? 0 })).filter((g) => g.count > 0);
  });

  public readonly rows = computed(() => {
    const filter = this.groupFilter();
    return filter ? this._searched().filter((r) => r.group.key === filter) : this._searched();
  });

  public readonly searchedCount = computed(() => this._searched().length);
  public readonly isTruncated = computed(() => this.totalCount() > PAGE_SIZE);

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Conformité' }, { label: 'Dossiers KYC' }]);

    const params = this._route.snapshot.queryParamMap;
    const scope = params.get('scope') as Scope | null;
    if (scope === 'mine' || scope === 'agency' || scope === 'all') this.scope.set(scope);
    const watch = params.get('filtre') as Watch | null;
    if (watch === 'revisions' || watch === 'pieces') this.watch.set(watch);
    const q = params.get('q') ?? '';
    this.query.set(q);
    this._appliedQuery.set(q);
    const group = params.get('step') as GroupKey | null;
    if (group && GROUPS.some((g) => g.key === group)) this.groupFilter.set(group);

    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(() => {
      this._appliedQuery.set(this.query());
      this._resetPage();
      this._syncUrl();
    });

    this._loadAgencies();
    this._load();
  }

  public setScope(scope: Scope): void {
    if (scope === this.scope()) return;
    this.scope.set(scope);
    this._syncUrl();
    this._load();
  }

  public clearWatch(): void {
    this.watch.set(null);
    this._syncUrl();
    this._load();
  }

  public setGroupFilter(group: GroupKey | null): void {
    this.groupFilter.set(this.groupFilter() === group ? null : group);
    this._resetPage();
    this._syncUrl();
  }

  public onSearchChange(value: string): void {
    this.query.set(value ?? '');
    this._search$.next();
  }

  public reload(): void {
    this._load();
  }

  public open(row: KycRow): void {
    this._router.navigate(['/kyc', row.id]);
  }

  public runAction(row: KycRow, event: Event): void {
    event.stopPropagation();
    const kind = row.action.kind;
    if (kind === 'upgrade') {
      // Même parcours que la fiche client : le passage au KYC complet se fait par l'enrôlement.
      this._router.navigate(['/kyc', 'enrolment', row.customerId]);
      return;
    }
    this._router.navigate(['/kyc', row.id], kind === 'open' ? undefined : { queryParams: { tab: kind } });
  }

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

  // ——— Chargements ———

  private _load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    const scope = this.canReadAll() ? this.scope() : 'all';

    const watch = this.watch();
    const base: KycDashboardFilters = {
      status: watch === 'revisions' ? 'UnderReview' : '',
      agencyId: scope === 'agency' ? this.myAgencyId() ?? '' : '',
      vigilanceLevel: '',
      from: '',
      to: '',
      page: 0,
      pageSize: PAGE_SIZE,
      mine: scope === 'mine',
      documentsExpiring: watch === 'pieces',
    };
    // Le serveur trie par activité la PLUS ANCIENNE d'abord (c'est une file de travail) : au-delà
    // d'une page, les dossiers validés récemment tomberaient hors de la liste. Deux lectures
    // ciblées les ramènent, fusionnées ensuite par identifiant.
    const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
    const nothing = of<KycFilesPage>({ rows: [], totalCount: 0, awaitingMeCount: 0 });
    // Filtrée, la liste ne montre que ce qu'annonce le filtre.
    const recent = (status: string) =>
      watch
        ? nothing
        : this._facade.searchFiles({ ...base, status, from: since }).pipe(catchError(() => nothing));

    forkJoin({
      main: this._facade.searchFiles(base),
      simplified: recent('Simplified'),
      full: recent('Full'),
    })
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this._rows.set([]);
          this.totalCount.set(0);
          this.loadError.set("La liste des dossiers n'a pas pu être chargée.");
          this.isLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ main, simplified, full }) => {
        const byId = new Map(main.rows.map((r) => [r.kycFileId, r]));
        for (const r of [...simplified.rows, ...full.rows]) if (!byId.has(r.kycFileId)) byId.set(r.kycFileId, r);
        this._rows.set([...byId.values()]);
        this.totalCount.set(main.totalCount);
        this.awaitingMeCountChange.emit(main.awaitingMeCount);
        this.isLoading.set(false);
      });
  }

  private _loadAgencies(): void {
    this._agenciesApi
      .listAgencies(false, 1, 0)
      .pipe(catchError(() => EMPTY), takeUntilDestroyed(this._destroyRef))
      .subscribe((result) => {
        this._agencyNames.set(new Map((result.items ?? []).map((a) => [a.id ?? '', a.name ?? '—'])));
      });
  }

  private _resetPage(): void {
    this.tableConfig.update((c) => ({ ...c, pagination: { ...c.pagination, pageIndex: 0 } }));
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        scope: this.canReadAll() ? this.scope() : null,
        q: this._appliedQuery() || null,
        filtre: this.watch(),
        step: this.groupFilter(),
        file: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export default KycDashboardPage;
