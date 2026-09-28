import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Button } from '@talisoft/ui/button';
import { TasIcon } from '@talisoft/ui/icon';
import { TasCard } from '@talisoft/ui/card';
import { TasTag } from '@talisoft/ui/tag';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { PageEvent } from '@angular/material/paginator';
import {
  AgenciesApiService,
  AgencyDto,
  AgencyTreeNodeDto,
} from '@sankore/crm-api';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { CreateAgencyComponent } from '../create-agency/create-agency';
import { NgClass } from '@angular/common';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import { AgencyActivationService } from '../agency-activation.service';

export type AgenciesViewMode = 'list' | 'tree';

/** Une ligne d'arborescence aplatie : voir `_flattenTree`. */
export interface AgencyTreeRow {
  /** Clé de `track` : l'id du nœud, qui est optionnel dans le DTO généré. */
  key: string;
  node: AgencyTreeNodeDto;
  depth: number;
  childCount: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

@Component({
  templateUrl: './agencies-homepage.html',
  imports: [
    Button,
    TasIcon,
    TasTable,
    TasCard,
    TasTag,
    TasSpinner,
    NgClass,
    TimeagoPipe,
  ],
})
export class AgenciesHomePage {
  private readonly _permissions = inject(PermissionsService);
  public readonly canCreate = this._permissions.can('agency:create');
  public readonly canRead = this._permissions.can('agency:read');
  public readonly canActivate = this._permissions.can('agency:activate');

  private readonly _agenciesApiService = inject(AgenciesApiService);
  private readonly _sideDrawerService = inject(SideDrawerService);
  private readonly _snackbarService = inject(SnackbarService);
  private readonly _agencyActivationService = inject(AgencyActivationService);
  private readonly _router = inject(Router);
  private readonly _breadcrumbService = inject(BreadcrumbService);

  public isLoading = signal(false);
  public agencies = signal<AgencyDto[]>([]);
  public searchQuery = signal('');

  // --- Bascule Liste / Arborescence -----------------------------------------
  // État de vue, pas un formulaire : pas de validation ni de soumission, donc
  // des signaux et des boutons plutôt que `form()`.
  public viewMode = signal<AgenciesViewMode>('list');
  public includeDeleted = signal(false);

  public isTreeLoading = signal(false);
  public treeRoots = signal<AgencyTreeNodeDto[]>([]);
  public expandedIds = signal<ReadonlySet<string>>(new Set<string>());
  private _treeLoadedOnce = false;

  public readonly activatingId = this._agencyActivationService.activatingId;

  public readonly treeRows = computed<AgencyTreeRow[]>(() => {
    const rows: AgencyTreeRow[] = [];
    this._flattenTree(this.treeRoots(), 0, this.expandedIds(), rows);
    return rows;
  });

  public readonly treeNodeCount = computed(() =>
    this._countNodes(this.treeRoots()),
  );

  public tableConfig = signal<TableConfig>({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 10,
      pageSizeOptions: [5, 10, 30, 50],
      totalElements: 0,
    },
  });

  ngOnInit(): void {
    this._breadcrumbService.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Agences' },
    ]);
    this.loadAgencies(0, 10);
  }

  public openCreateDrawer(): void {
    const ref = this._sideDrawerService.open(CreateAgencyComponent, {
      width: '100%',
      height: '100%',
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (result) {
        this.loadAgencies(
          this.tableConfig().pagination.pageIndex,
          this.tableConfig().pagination.pageSize,
        );
        if (this._treeLoadedOnce) this.loadTree();
      }
    });
  }

  public navigateToEdit(agency: AgencyDto | AgencyTreeNodeDto): void {
    this._router.navigate(['/settings/agencies', agency.id, 'edit']);
  }

  public onPageChange(event: PageEvent): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        pageIndex: event.pageIndex,
        pageSize: event.pageSize,
      },
    }));
    this.loadAgencies(event.pageIndex, event.pageSize, this.searchQuery() || undefined);
  }

  public onSearchChange(q: string): void {
    this.searchQuery.set(q);
    const pageSize = this.tableConfig().pagination.pageSize;
    this.tableConfig.update((c) => ({
      ...c,
      pagination: { ...c.pagination, pageIndex: 0 },
    }));
    this.loadAgencies(0, pageSize, q || undefined);
  }

  public loadAgencies(page: number, pageSize: number, search?: string): void {
    this.isLoading.set(true);
    this._agenciesApiService.listAgencies(false, page + 1, pageSize, undefined, search).subscribe({
      next: (result) => {
        this.agencies.set(result.items ?? []);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: {
            ...config.pagination,
            totalElements: result.totalCount ?? 0,
          },
        }));
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  // --- Arborescence ---------------------------------------------------------

  public setViewMode(mode: AgenciesViewMode): void {
    this.viewMode.set(mode);
    // L'arbre est chargé à la première bascule seulement : inutile de payer
    // l'appel pour un administrateur qui reste sur la liste.
    if (mode === 'tree' && !this._treeLoadedOnce) this.loadTree();
  }

  public toggleIncludeDeleted(): void {
    this.includeDeleted.update((v) => !v);
    this.loadTree();
  }

  /**
   * GET /api/v1/agencies/tree — signature générée :
   * `getAgencyTree(includeDeleted: boolean, rootId?: string)`. `includeDeleted`
   * est positionnel et obligatoire, on le passe donc toujours ; `rootId` reste
   * absent, l'écran affiche tout le tenant.
   */
  public loadTree(): void {
    this._treeLoadedOnce = true;
    this.isTreeLoading.set(true);
    this._agenciesApiService.getAgencyTree(this.includeDeleted()).subscribe({
      next: (nodes) => {
        const roots = nodes ?? [];
        this.treeRoots.set(roots);
        this.expandedIds.set(this._defaultExpanded(roots));
        this.isTreeLoading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.isTreeLoading.set(false);
        this._snackbarService.error(
          'Erreur',
          err?.status === 403
            ? "Vous n'avez pas la permission de consulter l'arborescence des agences."
            : "Impossible de charger l'arborescence des agences, réessayez plus tard.",
        );
      },
    });
  }

  public toggleNode(row: AgencyTreeRow): void {
    const id = row.node.id;
    if (!id || !row.hasChildren) return;
    this.expandedIds.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  public expandAll(): void {
    const ids = new Set<string>();
    this._collectExpandableIds(this.treeRoots(), ids);
    this.expandedIds.set(ids);
  }

  public collapseAll(): void {
    this.expandedIds.set(new Set<string>());
  }

  public activateFromTree(node: AgencyTreeNodeDto): void {
    this._agencyActivationService.confirmAndActivate(node, () => {
      this.loadTree();
      // La liste affiche le même statut : la laisser périmée ferait apparaître
      // l'agence comme inactive après une réactivation réussie.
      this.loadAgencies(
        this.tableConfig().pagination.pageIndex,
        this.tableConfig().pagination.pageSize,
        this.searchQuery() || undefined,
      );
    });
  }

  /**
   * Aplatit l'arbre en lignes avec leur profondeur, au lieu d'un composant
   * récursif : le rendu reste un `@for` unique, et déplier/replier n'est qu'un
   * changement du jeu d'ids dépliés.
   */
  private _flattenTree(
    nodes: AgencyTreeNodeDto[],
    depth: number,
    expanded: ReadonlySet<string>,
    out: AgencyTreeRow[],
  ): void {
    for (const [index, node] of nodes.entries()) {
      const children = node.children ?? [];
      // `childCount` vient du contrat et fait foi pour savoir qu'un nœud a des
      // enfants ; on retombe sur `children.length` s'il n'est pas renseigné.
      const childCount = node.childCount ?? children.length;
      const hasChildren = childCount > 0 || children.length > 0;
      const isExpanded = hasChildren && !!node.id && expanded.has(node.id);
      const key = node.id ?? `${depth}-${index}-${node.code ?? node.name ?? ''}`;
      out.push({ key, node, depth, childCount, hasChildren, isExpanded });
      if (isExpanded && children.length > 0) {
        this._flattenTree(children, depth + 1, expanded, out);
      }
    }
  }

  private _defaultExpanded(roots: AgencyTreeNodeDto[]): ReadonlySet<string> {
    // Déduction (aucune spécification) : on déplie le premier niveau pour que
    // l'arbre ne s'ouvre pas sur une seule ligne, et on laisse le reste replié
    // pour ne pas noyer une hiérarchie profonde.
    const ids = new Set<string>();
    for (const root of roots) {
      if (root.id && (root.children?.length ?? 0) > 0) ids.add(root.id);
    }
    return ids;
  }

  private _collectExpandableIds(
    nodes: AgencyTreeNodeDto[],
    out: Set<string>,
  ): void {
    for (const node of nodes) {
      const children = node.children ?? [];
      if (node.id && children.length > 0) {
        out.add(node.id);
        this._collectExpandableIds(children, out);
      }
    }
  }

  private _countNodes(nodes: AgencyTreeNodeDto[]): number {
    return nodes.reduce(
      (total, node) => total + 1 + this._countNodes(node.children ?? []),
      0,
    );
  }

  public codeBadge(code: string | null | undefined, name: string | null | undefined): string {
    const src = code ?? name ?? '??';
    return src.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase();
  }

  public agencyTypeLabel(type: string | null | undefined): string {
    switch (type) {
      case 'HeadQuarter': return 'HQ';
      case 'Branch': return 'Région';
      case 'ServicePoint': return 'Zone';
      case 'Counter': return 'Agence';
      default: return type ?? '—';
    }
  }
}

export default AgenciesHomePage;
