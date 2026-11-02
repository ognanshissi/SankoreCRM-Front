import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, debounceTime, EMPTY, finalize, Subject } from 'rxjs';
import { OpportunitiesApiService, OpportunityDto } from '@sankore/crm-api';
import { BreadcrumbService, PermissionsService, projectFlowLabel, TenantProvider } from '@sankore/crm/common';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { formatAmount, formatDay } from '../edit-lead/lead-view.models';
import { NewProjectDrawer } from './new-project-drawer';
import {
  isClosed,
  probabilityPercent,
  stepLabel,
  tracksForecast,
  weightedAmount,
} from '../edit-lead/opportunities/opportunity.model';

const ALL = 'tous';
const BUILT_IN = 'standard';

export type ProjectStatusFilter = 'ouverts' | 'gagnes' | 'perdus' | 'tous';

const STATUS_OPTIONS: { value: ProjectStatusFilter; label: string }[] = [
  { value: 'ouverts', label: 'Ouverts' },
  { value: 'gagnes', label: 'Gagnés' },
  { value: 'perdus', label: 'Perdus' },
  { value: 'tous', label: 'Tous' },
];

function hasStatus(p: OpportunityDto, status: ProjectStatusFilter): boolean {
  switch (status) {
    case 'ouverts': return !isClosed(p);
    case 'gagnes': return p.stage === 'ClosedWon';
    case 'perdus': return p.stage === 'ClosedLost';
    default: return true;
  }
}

function templateKey(opp: OpportunityDto): string {
  return opp.templateId ?? BUILT_IN;
}

/** Minuscules sans accents : « Koné » se trouve en tapant « kone ». */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Ce que la recherche lit d'un projet : son titre, son produit, et la personne — prénom, nom, nom
 * complet, téléphone, e-mail du lead, ou nom et numéro du client. Le téléphone est aussi indexé
 * sans espaces ni signes, pour qu'un numéro tapé d'une autre façon se retrouve.
 */
function searchText(p: OpportunityDto): string {
  const c = p.contact;
  const phoneDigits = (c?.phoneNumber ?? '').replace(/\D/g, '');
  return fold(
    [p.title, p.product, c?.name, c?.firstName, c?.lastName, c?.phoneNumber, phoneDigits, c?.email, c?.clientNumber]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * La liste des projets, ouverts ou clos (propriétaire, 2026-11-02 : la vue en colonnes est
 * retirée). Un projet avance depuis sa fiche, où ses conditions d'étape s'expliquent.
 */
@Component({
  selector: 'projects-board',
  imports: [FormsModule, RouterLink, Button, TasFormField, TasLabel, TasIcon, TasInput, TasSelect, TasTable, TasTag],
  templateUrl: './projects-board.html',
})
export class ProjectsBoard implements OnInit {
  private readonly _api = inject(OpportunitiesApiService);
  private readonly _permissions = inject(PermissionsService);
  /** La monnaie de l'institution : celle des totaux et des nouveaux montants. */
  public readonly currency = inject(TenantProvider).currency;
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _search$ = new Subject<string>();

  public readonly canManage = this._permissions.can('lead:opportunity:manage');
  public readonly formatAmount = formatAmount;
  public readonly formatDay = formatDay;
  public readonly probabilityPercent = probabilityPercent;
  public readonly tracksForecast = tracksForecast;
  public readonly stepLabel = stepLabel;
  public readonly isClosed = isClosed;
  public readonly statusOptions = STATUS_OPTIONS;

  public readonly projects = signal<OpportunityDto[]>([]);
  public readonly isLoading = signal(false);
  public readonly loadError = signal<string | null>(null);

  public readonly status = signal<ProjectStatusFilter>('ouverts');
  public readonly track = signal(ALL);
  public readonly search = signal('');
  private readonly _appliedSearch = signal('');

  private readonly _scope = computed(() => this.projects().filter((p) => hasStatus(p, this.status())));

  /** Les parcours présents parmi les projets du statut choisi, avec leur nombre de projets. */
  public readonly trackOptions = computed(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const p of this._scope()) {
      const key = templateKey(p);
      const entry = counts.get(key) ?? { label: p.templateName ?? 'Parcours standard', count: 0 };
      entry.count++;
      counts.set(key, entry);
    }
    return [
      { value: ALL, label: `Tous les parcours (${this._scope().length})` },
      ...[...counts.entries()]
        .sort((a, b) => a[1].label.localeCompare(b[1].label, 'fr'))
        .map(([value, e]) => ({ value, label: `${e.label} (${e.count})` })),
    ];
  });

  private _matches(list: OpportunityDto[]): OpportunityDto[] {
    const terms = fold(this._appliedSearch().trim()).split(/\s+/).filter(Boolean);
    const track = this.track();
    // Chaque mot doit se trouver quelque part : « awa 0708 » trouve Awa par son prénom et son numéro.
    return list.filter(
      (p) =>
        (track === ALL || templateKey(p) === track) &&
        (terms.length === 0 || terms.every((t) => searchText(p).includes(t.replace(/^\+/, '')))),
    );
  }

  /** Les lignes de la liste, les plus récemment modifiées d'abord. */
  public readonly rows = computed(() =>
    [...this._matches(this._scope())].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
  );

  /** Pagination locale : `listOpportunities` renvoie tous les projets d'un coup. */
  public readonly tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: { serverSide: false, pageIndex: 0, pageSize: 20, pageSizeOptions: [10, 20, 50, 100] },
  });

  /** Les totaux ne comptent que les projets ouverts retenus par les filtres, quel que soit le statut affiché. */
  private readonly _openVisible = computed(() => this._matches(this.projects().filter((p) => !isClosed(p))));

  public readonly totalAmount = computed(() => this._openVisible().reduce((t, p) => t + (p.estimatedAmount?.amount ?? 0), 0));
  /**
   * Le pondéré, par nature de montant et pour les seuls parcours qui suivent la prévision : un
   * décaissement de crédit et une collecte d'épargne ne s'additionnent pas.
   */
  public readonly weightedByKind = computed(() => {
    const byKind = new Map<string, number>();
    for (const p of this._openVisible().filter(tracksForecast)) {
      const kind = p.amountKind ?? 'Generic';
      byKind.set(kind, (byKind.get(kind) ?? 0) + weightedAmount(p));
    }
    return [...byKind.entries()].map(([kind, amount]) => ({ kind, label: projectFlowLabel(kind), amount }));
  });

  public ngOnInit(): void {
    this._breadcrumb.set([{ label: 'Projets' }]);

    const params = this._route.snapshot.queryParamMap;
    const status = params.get('statut') as ProjectStatusFilter | null;
    this.status.set(STATUS_OPTIONS.some((o) => o.value === status) ? status! : 'ouverts');
    this.track.set(params.get('parcours') || ALL);
    this.search.set(params.get('q') ?? '');
    this._appliedSearch.set(this.search());

    this._search$.pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef)).subscribe((q) => {
      this._appliedSearch.set(q);
      this._persist();
    });

    this.load();
  }

  public load(): void {
    this.isLoading.set(true);
    this.loadError.set(null);
    this._api
      .listOpportunities()
      .pipe(
        catchError(() => {
          this.loadError.set('Les projets n’ont pas pu être chargés.');
          return EMPTY;
        }),
        finalize(() => this.isLoading.set(false)),
      )
      .subscribe((list) => {
        this.projects.set(list ?? []);
        this._keepTrackInScope();
      });
  }

  public openNew(): void {
    const ref = this._sideDrawer.open<string | false, void, NewProjectDrawer>(NewProjectDrawer, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });
    ref.closed.subscribe((id) => {
      if (id) this.load();
    });
  }

  public onSearch(value: string): void {
    this.search.set(value);
    this._search$.next(value);
  }

  public onTrack(value: string | null): void {
    this.track.set(value || ALL);
    this._persist();
  }

  public onStatus(value: string | null): void {
    this.status.set((value as ProjectStatusFilter) || 'ouverts');
    this._keepTrackInScope();
    this._persist();
  }

  public openProject(p: OpportunityDto): void {
    if (p.id) this._router.navigate(['/leads/projets', p.id]);
  }

  public ownerLink(p: OpportunityDto): unknown[] | null {
    if (p.customerEntityId) return ['/customers', p.customerEntityId, 'projets'];
    if (p.leadId) return ['/leads', p.leadId, 'projets'];
    return null;
  }

  /** Un parcours qui n'a plus de projet dans le statut choisi retombe sur « tous », sinon la liste paraît vide. */
  private _keepTrackInScope(): void {
    if (this.track() !== ALL && !this.trackOptions().some((o) => o.value === this.track())) this.track.set(ALL);
  }

  private _persist(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        statut: this.status() !== 'ouverts' ? this.status() : null,
        parcours: this.track() === ALL ? null : this.track(),
        q: this._appliedSearch() || null,
      },
      replaceUrl: true,
    });
  }
}

export default ProjectsBoard;
