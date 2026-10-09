import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { Subject, catchError, EMPTY, switchMap } from 'rxjs';
import { ConnectionListDto } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasAlert } from '@talisoft/ui/alert';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService } from '@sankore/crm/common';
import { IntegrationFacadeService } from '../../data-access/integration-facade.service';
import { BatchFileRow, PendingIntegrationEndpoints } from '../../data-access/pending-endpoints';
import {
  BATCH_DIRECTION_OPTIONS,
  BatchDirection,
  acknowledgementView,
  batchDirectionLabel,
  overdueCount,
} from './batch-file-acknowledgement';
import {
  BatchFileDetailDrawer,
  BatchFileDetailDrawerData,
} from './batch-file-detail-drawer';

const DEFAULT_PAGE_SIZE = 20;

/**
 * INT-29 — Écran Fichiers batch.
 *
 * ━━━ Pourquoi cet écran n'appelle pas `IntegrationFacadeService` pour sa liste ━━━
 *
 * **Aucun endpoint de fichiers batch n'existe dans le swagger.** INT-29 dépend des lots
 * back INT-24 et INT-25, non livrés : la seule trace du concept dans le contrat est
 * `IntegrationCommandDto.batchFileId`. Les lignes viennent donc de
 * `data-access/pending-endpoints.ts`, qui répond l'état vide, et l'écran l'annonce par un
 * bandeau explicite au lieu de tourner sur un spinner ou d'afficher un « Aucun fichier »
 * qui laisserait croire que tout va bien.
 *
 * Ce branchement n'est ni un oubli ni un bouchon à nettoyer : les deux autres options
 * étaient d'inventer les chemins dans le swagger et de régénérer le client — ce qui
 * ferait passer un contrat supposé pour le contrat réel — ou de peupler l'écran de
 * données factices — ce qui ferait croire la fonctionnalité livrée. Le reste de l'écran
 * (filtres, colonnes, mise en évidence du retard d'accusé, drawer de détail) est écrit
 * pour de vrai et fonctionnera tel quel.
 *
 * **À l'arrivée de l'endpoint**, dans cet ordre :
 *   1. mettre à jour `swaggers/sankore-crm-api-swagger.json` ;
 *   2. lancer `npm run openapi-generator` ;
 *   3. ajouter la méthode nommée à `IntegrationFacadeService` ;
 *   4. remplacer `this._pending.listBatchFiles()` par cet appel, en passant les filtres
 *      déjà portés par cet écran (connexion, direction, période, page, pageSize) ;
 *   5. retirer le bandeau en supprimant `isPending` de ce composant.
 * Les types `BatchFileRow` / `BatchFilePage` sont alignés sur ce que les US back
 * annoncent, pour que les colonnes et le drawer n'aient pas à bouger.
 */
@Component({
  selector: 'integration-batch-files-homepage',
  templateUrl: './batch-files-homepage.html',
  imports: [
    FormsModule,
    Button,
    TasAlert,
    TasCard,
    TasFormField,
    TasHint,
    TasIcon,
    TasInput,
    TasLabel,
    TasSelect,
    TasTable,
    TasTag,
    TimeagoPipe,
  ],
})
export class BatchFilesHomePage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  /** Frontière vers les endpoints non livrés — voir le commentaire en tête de fichier. */
  private readonly _pending = new PendingIntegrationEndpoints();

  public readonly isPending = PendingIntegrationEndpoints.isPending;
  public readonly pendingNotice = PendingIntegrationEndpoints.pendingNotice;

  public readonly directionOptions = BATCH_DIRECTION_OPTIONS;
  public readonly directionLabel = batchDirectionLabel;
  public readonly acknowledgement = acknowledgementView;

  public readonly isLoading = signal(true);
  public readonly rows = signal<BatchFileRow[]>([]);
  public readonly totalCount = signal(0);
  public readonly acknowledgementDueHours = signal<number | null>(null);
  public readonly connections = signal<ConnectionListDto[]>([]);

  public readonly filterConnectionId = signal<string | null>(null);
  public readonly filterDirection = signal<string | null>(null);
  public readonly filterFrom = signal<string | null>(null);
  public readonly filterTo = signal<string | null>(null);

  /**
   * Fichier désigné par le détail d'une commande (`batchFileId`). Il est affiché tel quel
   * plutôt que résolu : rien ne permet encore d'en lire les coordonnées.
   */
  public readonly requestedFileId = signal<string | null>(null);

  public readonly connectionOptions = computed(() =>
    this.connections().map((connection) => ({
      label: connection.name ?? connection.id ?? '—',
      value: connection.id ?? '',
    })),
  );

  private readonly _connectionNames = computed(() => {
    const names = new Map<string, string>();
    for (const connection of this.connections()) {
      if (connection.id) names.set(connection.id, connection.name ?? connection.id);
    }
    return names;
  });

  /** Le seul chiffre qui déclenche une action : les fichiers sans accusé au-delà du délai. */
  public readonly overdueInView = computed(() =>
    overdueCount(this.rows(), this.acknowledgementDueHours()),
  );

  public readonly hasActiveFilters = computed(
    () =>
      !!this.filterConnectionId() ||
      !!this.filterDirection() ||
      !!this.filterFrom() ||
      !!this.filterTo(),
  );

  public tableConfig = signal<TableConfig>({
    property: 'batchFileId',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  private readonly _load$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Fichiers batch' },
    ]);

    this._setupLoader();

    const params = this._route.snapshot.queryParams;
    this.filterConnectionId.set(params['connectionId'] ?? null);
    this.filterDirection.set(
      params['direction'] === 'Outbound' || params['direction'] === 'Inbound'
        ? params['direction']
        : null,
    );
    this.filterFrom.set(params['from'] ?? null);
    this.filterTo.set(params['to'] ?? null);
    this.requestedFileId.set(params['fileId'] ?? null);

    this._loadConnections();
    this._load();
  }

  public connectionName(connectionId: string | null | undefined): string | null {
    if (!connectionId) return null;
    return this._connectionNames().get(connectionId) ?? null;
  }

  public onConnectionChange(value: string | null): void {
    this.filterConnectionId.set(value || null);
    this._applyFilters();
  }

  public onDirectionChange(value: string | null): void {
    this.filterDirection.set((value as BatchDirection | null) || null);
    this._applyFilters();
  }

  public onFromChange(value: string): void {
    this.filterFrom.set(value || null);
    this._applyFilters();
  }

  public onToChange(value: string): void {
    this.filterTo.set(value || null);
    this._applyFilters();
  }

  public resetFilters(): void {
    this.filterConnectionId.set(null);
    this.filterDirection.set(null);
    this.filterFrom.set(null);
    this.filterTo.set(null);
    this._applyFilters();
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
    this._persistFilters();
    this._load();
  }

  public reload(): void {
    this._load();
  }

  public openDetail(file: BatchFileRow): void {
    this._sideDrawer.open<null, BatchFileDetailDrawerData, BatchFileDetailDrawer>(
      BatchFileDetailDrawer,
      {
        data: {
          file,
          connectionName: this.connectionName(file.connectionId),
          acknowledgementDueHours: this.acknowledgementDueHours(),
        } satisfies BatchFileDetailDrawerData,
        panelClass: 'side-drawer-panel',
      },
    );
  }

  public openCommands(): void {
    this._router.navigate(['/settings/integrations/commands'], {
      queryParams: this.filterConnectionId()
        ? { connectionId: this.filterConnectionId(), status: '' }
        : { status: '' },
    });
  }

  private _persistFilters(): void {
    const pagination = this.tableConfig().pagination;
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        connectionId: this.filterConnectionId() || null,
        direction: this.filterDirection() || null,
        from: this.filterFrom() || null,
        to: this.filterTo() || null,
        // L'URL porte le numéro de page tel que l'API le comptera (1-based) ; le tableau
        // travaille en index 0-based.
        page: pagination.pageIndex > 0 ? pagination.pageIndex + 1 : null,
        pageSize: pagination.pageSize === DEFAULT_PAGE_SIZE ? null : pagination.pageSize,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private _applyFilters(): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex: 0 },
    }));
    this._persistFilters();
    this._load();
  }

  private _load(): void {
    this.isLoading.set(true);
    this._load$.next();
  }

  private _setupLoader(): void {
    this._load$
      .pipe(
        switchMap(() =>
          // L'appel ne prend pas encore d'arguments : la signature nommée arrivera avec
          // l'endpoint (voir le commentaire en tête de fichier). Les filtres sont déjà
          // portés par l'écran et persistés dans l'URL.
          this._pending.listBatchFiles().pipe(
            catchError(() => {
              this.rows.set([]);
              this.totalCount.set(0);
              this.isLoading.set(false);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((page) => {
        this.rows.set(page.rows);
        this.totalCount.set(page.totalCount);
        this.acknowledgementDueHours.set(page.acknowledgementDueHours);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: page.totalCount },
        }));
        this.isLoading.set(false);
      });
  }

  private _loadConnections(): void {
    this._facade
      .listAllConnections()
      .pipe(catchError(() => EMPTY))
      .subscribe((connections) => this.connections.set(connections));
  }
}

export default BatchFilesHomePage;
