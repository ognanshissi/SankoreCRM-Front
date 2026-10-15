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
import { catchError, debounceTime, EMPTY, forkJoin, of, Subject, Subscription } from 'rxjs';
import { TasIcon } from '@talisoft/ui/icon';
import { TasSpinner } from '@talisoft/ui/spinner';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { AgenciesApiService, KycFileDto, UsersApiService } from '@sankore/crm-api';
import { AuthenticationService, BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { KycFacadeService } from '../data-access/kyc-facade.service';
import { KycCaps, KycDashboardFilters, KycDashboardPage as KycFilesPage, KycDashboardRow, KycDocumentRow, KycHistoryEntry } from '../data-access/kyc.types';
import { KYC_VALIDATED_STATUSES, KycStepState, kycProgressStates } from '../data-access/kyc-progress';
import { kycTierLabel } from '../data-access/kyc-referential';
import { KycOpenFileDrawer } from '../enrolment/open-kyc-file-drawer';

/**
 * Dossiers KYC en vue maître-détail : à gauche la file de travail groupée par ce qu'elle attend, à
 * droite l'aperçu du dossier sélectionné, avec l'action qui le fait avancer.
 *
 * La liste est chargée d'un bloc (une page de 100, le maximum du serveur) puis groupée ici : les
 * groupes sont une lecture du statut, pas des filtres serveur. La recherche filtre ce bloc côté
 * client — l'endpoint n'a pas de paramètre texte — et l'écran le dit quand le périmètre dépasse ce
 * qui est chargé.
 */

type Scope = 'mine' | 'agency' | 'all';

type GroupKey = 'decide' | 'blocked' | 'client' | 'validation' | 'validated' | 'closed';

interface ListItem {
  id: string;
  customerId: string;
  name: string;
  initials: string;
  subtitle: string;
  age: string;
  agencyName: string | null;
  row: KycDashboardRow;
}

interface Group {
  key: GroupKey;
  label: string;
  dot: string;
  labelClass: string;
  items: ListItem[];
}

const PAGE_SIZE = 100;
const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

const GROUPS: Omit<Group, 'items'>[] = [
  { key: 'decide',     label: 'À vous de décider',     dot: 'bg-primary',   labelClass: 'text-primary' },
  { key: 'blocked',    label: 'Bloqués',               dot: 'bg-orange-700', labelClass: 'text-orange-800' },
  { key: 'client',     label: 'En attente du client',  dot: 'bg-slate-400', labelClass: 'text-slate-700' },
  { key: 'validation', label: 'En validation',         dot: 'bg-blue-500',  labelClass: 'text-slate-700' },
  { key: 'validated',  label: 'Validés récemment',     dot: 'bg-green-600', labelClass: 'text-green-800' },
  { key: 'closed',     label: 'Clos ou plus anciens',  dot: 'bg-slate-300', labelClass: 'text-slate-500' },
];

const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH_YEAR = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });
const EVENT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '')).toUpperCase();
}

function ageInDays(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
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
  imports: [FormsModule, TasIcon, TasSpinner],
})
export class KycDashboardPage implements OnInit {
  private readonly _facade = inject(KycFacadeService);
  private readonly _agenciesApi = inject(AgenciesApiService);
  private readonly _usersApi = inject(UsersApiService);
  private readonly _auth = inject(AuthenticationService);
  private readonly _breadcrumbService = inject(BreadcrumbService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly canOpenFile = this._permissions.can('kyc:manage');

  /** Remonté au shell pour le badge du menu : dossiers qui attendent l'utilisateur. */
  public readonly awaitingMeCountChange = output<number>();

  // ——— Liste ———
  public readonly scope = signal<Scope>('all');
  public readonly query = signal('');
  private readonly _appliedQuery = signal('');
  private readonly _search$ = new Subject<void>();

  public readonly isLoading = signal(true);
  public readonly loadError = signal<string | null>(null);
  private readonly _rows = signal<KycDashboardRow[]>([]);
  public readonly totalCount = signal(0);
  private readonly _agencyNames = signal<Map<string, string>>(new Map());
  public readonly collapsedClosed = signal(true);

  public readonly myAgencyId = computed(() => this._auth.connectedUser()?.agencyId ?? null);

  public readonly groups = computed<Group[]>(() => {
    const q = this._appliedQuery().trim().toLowerCase();
    const agencies = this._agencyNames();
    const buckets = new Map<GroupKey, ListItem[]>();

    for (const row of this._rows()) {
      const agencyName = row.agencyId ? agencies.get(row.agencyId) ?? null : null;
      if (q && !row.customerName.toLowerCase().includes(q) && !(agencyName ?? '').toLowerCase().includes(q)) continue;
      const key = groupOf(row);
      const days = ageInDays(row.updatedAt);
      const item: ListItem = {
        id: row.kycFileId,
        customerId: row.customerId,
        name: row.customerName,
        initials: initialsOf(row.customerName),
        subtitle: subtitleOf(row),
        age: `${days} j`,
        agencyName,
        row,
      };
      buckets.set(key, [...(buckets.get(key) ?? []), item]);
    }

    return GROUPS.map((g) => ({ ...g, items: buckets.get(g.key) ?? [] })).filter((g) => g.items.length > 0);
  });

  public readonly visibleCount = computed(() => this.groups().reduce((n, g) => n + g.items.length, 0));
  public readonly isTruncated = computed(() => this.totalCount() > PAGE_SIZE);

  // ——— Aperçu ———
  public readonly selectedId = signal<string | null>(null);
  public readonly selectedItem = computed(() => {
    const id = this.selectedId();
    for (const g of this.groups()) {
      const found = g.items.find((i) => i.id === id);
      if (found) return found;
    }
    return null;
  });

  public readonly previewLoading = signal(false);
  public readonly previewError = signal(false);
  public readonly previewFile = signal<KycFileDto | null>(null);
  public readonly previewDocuments = signal<KycDocumentRow[] | null>(null);
  public readonly previewHistory = signal<KycHistoryEntry[]>([]);
  public readonly previewCaps = signal<KycCaps | null>(null);
  private readonly _authorNames = signal<Record<string, string>>({});
  private _previewSub: Subscription | null = null;

  public readonly progress = computed(() => {
    const file = this.previewFile();
    if (!file) return [];
    const states = kycProgressStates({
      status: file.status,
      confidenceScore: file.confidenceScore,
      validatedAt: file.validatedAt,
      documentCount: this.previewDocuments()?.length ?? null,
    });
    const labels = ['Ouvert', 'Pièces', 'Vérification', 'Validation', 'Validé'];
    return labels.map((label, i) => ({ label, state: states[i] as KycStepState }));
  });

  public readonly headerLine = computed(() => {
    const file = this.previewFile();
    const item = this.selectedItem();
    const parts: string[] = [];
    if (item?.agencyName) parts.push(item.agencyName);
    if (file?.createdAt) parts.push(`dossier ouvert le ${SHORT_DATE.format(new Date(file.createdAt))}`);
    return parts.join(' · ');
  });

  /** L'encart d'état : ce que le dossier attend, et l'action qui le fait avancer. */
  public readonly callout = computed(() => {
    const file = this.previewFile();
    const item = this.selectedItem();
    if (!file || !item) return null;
    const status = file.status ?? '';

    if (KYC_VALIDATED_STATUSES.includes(status)) {
      const caps = this.previewCaps();
      const tier = kycTierLabel(file.tier) ?? 'KYC validé';
      const money = (v: number | null) =>
        v === null || !caps ? null : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: caps.currency, maximumFractionDigits: 0 }).format(v);
      const balance = caps?.isCapped ? money(caps.balanceCap) : null;
      const flow = caps?.isCapped ? money(caps.flowCap) : null;
      const text =
        balance && flow
          ? `${tier} : plafonds de ${balance} de solde et ${flow} de flux sur ${caps?.flowWindowDays ?? 30} jours.`
          : caps && !caps.isCapped
            ? `${tier} : aucun plafond ne s'applique.`
            : `${tier}.`;
      return {
        tone: 'success' as const,
        eyebrow: status === 'UnderReview' ? 'Validé · revue en cours' : 'Validé',
        text,
        action: file.tier === 'Simplified' ? { label: 'Passer en KYC complet', kind: 'upgrade' as const } : null,
      };
    }
    if (item.row.awaitingMe) {
      return { tone: 'primary' as const, eyebrow: 'À vous de décider', text: 'Le dossier attend votre décision dans le circuit de validation.',
        action: { label: 'Décider', kind: 'validation' as const } };
    }
    switch (status) {
      case 'Verifying':
        return { tone: 'warning' as const, eyebrow: 'Bloqué', text: file.confidenceScore == null
            ? 'Le score de confiance n\'est pas calculé : le dossier ne peut pas entrer en validation.'
            : 'La vérification biométrique n\'a pas conclu.',
          action: { label: 'Voir le score', kind: 'score' as const } };
      case 'Collecting':
      case 'ComplementRequired':
        return { tone: 'neutral' as const, eyebrow: 'En attente du client',
          text: item.row.requiredAction ? `${item.row.requiredAction}.` : 'Des pièces sont attendues.',
          action: { label: 'Voir les pièces', kind: 'piece' as const } };
      case 'Validating':
        return { tone: 'neutral' as const, eyebrow: 'En validation', text: 'Le dossier attend la décision d\'un autre niveau du circuit.',
          action: { label: 'Voir le circuit', kind: 'validation' as const } };
      case 'Expired':
        return { tone: 'warning' as const, eyebrow: 'Expiré', text: 'La validité du KYC est échue : une revue est nécessaire.', action: null };
      case 'Suspended':
        return { tone: 'warning' as const, eyebrow: 'Suspendu', text: 'Aucune décision ne peut être prise tant que le dossier est suspendu.', action: null };
      case 'Rejected':
        return { tone: 'error' as const, eyebrow: 'Rejeté', text: 'Le circuit a refusé ce dossier.', action: null };
      default:
        return null;
    }
  });

  public readonly tiles = computed(() => {
    const file = this.previewFile();
    if (!file) return [];
    const docs = (this.previewDocuments() ?? []).filter((d) => d.isCurrentForKind);
    const accepted = docs.filter((d) => d.decision === 'Accepted').length;
    const tier = kycTierLabel(file.tier);
    return [
      {
        label: 'Pièces',
        value: this.previewDocuments() === null ? '—' : docs.length ? `${accepted}/${docs.length} acceptées` : 'Aucune',
        ok: docs.length > 0 && accepted === docs.length,
      },
      { label: 'Niveau', value: tier ?? 'Pas encore attribué', ok: !!tier },
      { label: 'Doublon', value: file.duplicateSuspected ? 'Suspecté' : 'Aucun', ok: !file.duplicateSuspected },
      {
        label: 'Prochaine revue',
        value: file.nextReviewDate ? MONTH_YEAR.format(new Date(file.nextReviewDate)) : 'Fixée à la validation',
        ok: null,
      },
    ];
  });

  public readonly recentEvents = computed(() => {
    const names = this._authorNames();
    return [...this.previewHistory()]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 5)
      .map((e) => ({
        at: e.at ? EVENT_DATE.format(new Date(e.at)) : '—',
        text: e.authorId && names[e.authorId] ? `${e.label} par ${names[e.authorId]}` : e.label,
      }));
  });

  ngOnInit(): void {
    this._breadcrumbService.set([{ label: 'Conformité' }, { label: 'Dossiers KYC' }]);

    const params = this._route.snapshot.queryParamMap;
    const scope = params.get('scope') as Scope | null;
    if (scope === 'mine' || scope === 'agency' || scope === 'all') this.scope.set(scope);
    const q = params.get('q') ?? '';
    this.query.set(q);
    this._appliedQuery.set(q);
    this.selectedId.set(params.get('file'));

    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe(() => {
      this._appliedQuery.set(this.query());
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

  public onSearchChange(value: string): void {
    this.query.set(value ?? '');
    this._search$.next();
  }

  public select(item: ListItem): void {
    if (item.id === this.selectedId() && this.previewFile()) return;
    this.selectedId.set(item.id);
    this._syncUrl();
    this._loadPreview(item);
  }

  public reload(): void {
    this._load();
  }

  public openFull(tab?: string): void {
    const id = this.selectedId();
    if (!id) return;
    this._router.navigate(['/kyc', id], tab ? { queryParams: { tab } } : undefined);
  }

  public runCalloutAction(kind: 'upgrade' | 'validation' | 'score' | 'piece'): void {
    if (kind === 'upgrade') {
      // Même parcours que la fiche client : le passage au KYC complet se fait par l'enrôlement.
      const customerId = this.selectedItem()?.customerId;
      if (customerId) this._router.navigate(['/kyc', 'enrolment', customerId]);
      return;
    }
    this.openFull(kind);
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
    const scope = this.scope();

    const base: KycDashboardFilters = {
      status: '',
      agencyId: scope === 'agency' ? this.myAgencyId() ?? '' : '',
      vigilanceLevel: '',
      from: '',
      to: '',
      page: 0,
      pageSize: PAGE_SIZE,
      mine: scope === 'mine',
    };
    // Le serveur trie par activité la PLUS ANCIENNE d'abord (c'est une file de travail) : au-delà
    // d'une page, les dossiers validés récemment tomberaient hors de la liste. Deux lectures
    // ciblées les ramènent, fusionnées ensuite par identifiant.
    const since = new Date(Date.now() - RECENT_DAYS * DAY_MS).toISOString();
    const recent = (status: string) =>
      this._facade
        .searchFiles({ ...base, status, from: since })
        .pipe(catchError(() => of<KycFilesPage>({ rows: [], totalCount: 0, awaitingMeCount: 0 })));

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

        // Garde la sélection si elle est encore dans la liste, sinon prend le premier dossier.
        const all = this.groups().flatMap((g) => g.items);
        const keep = all.find((i) => i.id === this.selectedId());
        const next = keep ?? all[0] ?? null;
        if (next) {
          this.selectedId.set(next.id);
          this._loadPreview(next);
        } else {
          this.selectedId.set(null);
          this.previewFile.set(null);
        }
      });
  }

  private _loadPreview(item: ListItem): void {
    this._previewSub?.unsubscribe();
    this.previewLoading.set(true);
    this.previewError.set(false);
    this.previewFile.set(null);
    this.previewDocuments.set(null);
    this.previewHistory.set([]);
    this.previewCaps.set(null);

    const validated = KYC_VALIDATED_STATUSES.includes(item.row.status);
    this._previewSub = forkJoin({
      file: this._facade.getFile(item.id),
      documents: this._facade.listDocuments(item.id).pipe(catchError(() => of(null))),
      history: this._facade.getHistory(item.id).pipe(catchError(() => of([] as KycHistoryEntry[]))),
      // Les plafonds n'ont de sens qu'une fois un palier accordé.
      caps: validated ? this._facade.getCaps(item.customerId).pipe(catchError(() => of(null))) : of(null),
    })
      .pipe(
        takeUntilDestroyed(this._destroyRef),
        catchError(() => {
          this.previewError.set(true);
          this.previewLoading.set(false);
          return EMPTY;
        }),
      )
      .subscribe(({ file, documents, history, caps }) => {
        this.previewFile.set(file);
        this.previewDocuments.set(documents?.documents ?? null);
        this.previewHistory.set(history);
        this.previewCaps.set(caps);
        this.previewLoading.set(false);
        this._resolveAuthors(history);
      });
  }

  private _resolveAuthors(entries: KycHistoryEntry[]): void {
    const known = this._authorNames();
    const ids = [...new Set(entries.map((e) => e.authorId).filter((id): id is string => !!id && !known[id]))];
    for (const id of ids) {
      this._usersApi
        .getUser(id)
        .pipe(catchError(() => of(null)))
        .subscribe((user) => {
          const name = user?.fullName || user?.email;
          if (name) this._authorNames.update((current) => ({ ...current, [id]: name }));
        });
    }
  }

  private _loadAgencies(): void {
    this._agenciesApi
      .listAgencies(false, 1, 0)
      .pipe(catchError(() => EMPTY), takeUntilDestroyed(this._destroyRef))
      .subscribe((result) => {
        this._agencyNames.set(new Map((result.items ?? []).map((a) => [a.id ?? '', a.name ?? '—'])));
      });
  }

  private _syncUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        scope: this.scope(),
        q: this._appliedQuery() || null,
        file: this.selectedId(),
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}

export default KycDashboardPage;
