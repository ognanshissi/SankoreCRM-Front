import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PageEvent } from '@angular/material/paginator';
import { Subject, catchError, debounceTime, EMPTY, switchMap } from 'rxjs';
import { ConnectionListDto, IntegrationCommandListItem } from '@sankore/crm-api';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { TasError, TasFormField, TasHint, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { BreadcrumbService, PermissionsService } from '@sankore/crm/common';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../../data-access/integration-facade.service';
import {
  COMMAND_STATUSES,
  CONNECTION_FAMILIES,
  ConnectionFamily,
  canCancelCommand,
  canReplayCommand,
  commandStatusMeta,
  commandTypeLabel,
  entityTypeLabel,
  errorFamilyLabel,
} from '../../data-access/integration-referential';
import {
  CancelCommandDrawer,
  CancelCommandDrawerData,
  CancelCommandDrawerResult,
} from './cancel-command-drawer';
import {
  CommandDetailDrawer,
  CommandDetailDrawerData,
  CommandDetailDrawerResult,
} from './command-detail-drawer';
import {
  COMMAND_ENTITY_TYPES,
  COMMAND_ENTITY_TYPE_OPTIONS,
  COMMAND_ERROR_FAMILIES,
  COMMAND_ERROR_FAMILY_OPTIONS,
  COMMAND_STATUS_OPTIONS,
  COMMAND_TYPES,
  COMMAND_TYPE_OPTIONS,
  REPLAY_CONFIRMATION,
  commandAgeLabel,
  endOfDayIso,
  isCommandStuck,
  isUuid,
  knownFilterValue,
  shortId,
  startOfDayIso,
} from './command-presentation';

const DEFAULT_PAGE_SIZE = 20;

/**
 * INT-18 — Écran Commandes et file de rejet.
 *
 * La vue par défaut est la file de rejet (`status=Rejected`) : c'est la seule vue sur
 * laquelle quelqu'un doit agir. Le serveur trie du plus ancien au plus récent et l'écran
 * ne l'inverse pas — dans une file de rejet, la ligne la plus ancienne est la plus
 * urgente, pas la moins intéressante.
 */
@Component({
  selector: 'integration-commands-homepage',
  templateUrl: './commands-homepage.html',
  imports: [
    FormsModule,
    Button,
    TasCard,
    TasError,
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
export class CommandsHomePage implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _breadcrumb = inject(BreadcrumbService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  public readonly canReplay = this._permissions.can('Integration.Command.Replay');

  // Libellés et aides du référentiel, liés au template.
  public readonly statusMeta = commandStatusMeta;
  public readonly typeLabel = commandTypeLabel;
  public readonly entityLabel = entityTypeLabel;
  public readonly errorFamilyLabel = errorFamilyLabel;
  public readonly ageLabel = commandAgeLabel;
  public readonly shortId = shortId;
  public readonly isStuck = isCommandStuck;

  public readonly statusOptions = COMMAND_STATUS_OPTIONS;
  public readonly commandTypeOptions = COMMAND_TYPE_OPTIONS;
  public readonly entityTypeOptions = COMMAND_ENTITY_TYPE_OPTIONS;
  public readonly errorFamilyOptions = COMMAND_ERROR_FAMILY_OPTIONS;
  public readonly familyOptions = CONNECTION_FAMILIES.map((family) => ({
    label: family.label,
    value: family.value,
  }));

  public readonly isLoading = signal(true);
  public readonly rows = signal<IntegrationCommandListItem[]>([]);
  public readonly totalCount = signal(0);
  public readonly loadError = signal<string | null>(null);
  public readonly actionInProgress = signal<string | null>(null);

  /**
   * Après un rejeu ou une annulation, la ligne est corrigée avec ce que l'appel a
   * retourné plutôt que rechargée à l'aveugle : le contrat donne le statut et les
   * tentatives, et un rechargement immédiat ferait disparaître la ligne de la file de
   * rejet sous le doigt. Le rechargement reste proposé.
   */
  public readonly needsReload = signal(false);

  public readonly connections = signal<ConnectionListDto[]>([]);

  public readonly filterStatus = signal<string | null>('Rejected');
  public readonly filterCommandType = signal<string | null>(null);
  public readonly filterErrorFamily = signal<string | null>(null);
  public readonly filterEntityType = signal<string | null>(null);
  public readonly filterCrmId = signal('');
  public readonly filterFamily = signal<string | null>(null);
  public readonly filterConnectionId = signal<string | null>(null);
  public readonly filterFrom = signal<string | null>(null);
  public readonly filterTo = signal<string | null>(null);

  /**
   * « Famille » ne restreint que la liste des connexions proposées : `/commands` n'expose
   * pas de paramètre de famille, seulement `connectionId`. Interroger chaque connexion
   * d'une famille puis agréger les pages côté client casserait `totalCount` et la
   * pagination serveur — la page 2 de l'écran ne correspondrait à aucune page du serveur.
   * Une connexion précise est donc exigée pour filtrer réellement, et l'écran le dit.
   */
  public readonly connectionOptions = computed(() => {
    const family = this.filterFamily();
    return this.connections()
      .filter((connection) => !family || connection.family === family)
      .map((connection) => ({
        label: connection.name ?? connection.id ?? '—',
        value: connection.id ?? '',
      }));
  });

  private readonly _connectionNames = computed(() => {
    const names = new Map<string, string>();
    for (const connection of this.connections()) {
      if (connection.id) names.set(connection.id, connection.name ?? connection.id);
    }
    return names;
  });

  public readonly crmIdError = computed(() => {
    const raw = this.filterCrmId().trim();
    if (!raw || isUuid(raw)) return null;
    return "Un identifiant client est un UUID (8-4-4-4-12). Collez-le en entier.";
  });

  public readonly hasActiveFilters = computed(
    () =>
      this.filterStatus() !== 'Rejected' ||
      !!this.filterCommandType() ||
      !!this.filterErrorFamily() ||
      !!this.filterEntityType() ||
      !!this.filterCrmId().trim() ||
      !!this.filterFamily() ||
      !!this.filterConnectionId() ||
      !!this.filterFrom() ||
      !!this.filterTo(),
  );

  public readonly isRejectionQueue = computed(() => this.filterStatus() === 'Rejected');

  public tableConfig = signal<TableConfig>({
    property: 'commandId',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  /** Frappes de l'identifiant client, regroupées avant l'appel réseau. */
  private readonly _search$ = new Subject<void>();

  /** Un seul flux de chargement : `switchMap` annule la requête devenue obsolète. */
  private readonly _load$ = new Subject<void>();

  public ngOnInit(): void {
    this._breadcrumb.set([
      { label: 'Paramétrage', link: ['/settings'] },
      { label: 'Intégrations', link: ['/settings/integrations'] },
      { label: 'Commandes' },
    ]);

    this._search$
      .pipe(debounceTime(300), takeUntilDestroyed(this._destroyRef))
      .subscribe(() => this._applyFilters());

    this._setupLoader();
    this._restoreFilters();
    this._loadConnections();
    this._load();
  }

  public connectionName(connectionId: string | null | undefined): string | null {
    if (!connectionId) return null;
    return this._connectionNames().get(connectionId) ?? null;
  }

  public onCrmIdChange(value: string | null): void {
    this.filterCrmId.set(value ?? '');
    this._search$.next();
  }

  public onStatusChange(value: string | null): void {
    this.filterStatus.set(knownFilterValue(value, COMMAND_STATUSES));
    this._applyFilters();
  }

  public onCommandTypeChange(value: string | null): void {
    this.filterCommandType.set(knownFilterValue(value, COMMAND_TYPES));
    this._applyFilters();
  }

  public onErrorFamilyChange(value: string | null): void {
    this.filterErrorFamily.set(knownFilterValue(value, COMMAND_ERROR_FAMILIES));
    this._applyFilters();
  }

  public onEntityTypeChange(value: string | null): void {
    this.filterEntityType.set(knownFilterValue(value, COMMAND_ENTITY_TYPES));
    this._applyFilters();
  }

  public onFamilyChange(value: string | null): void {
    const family = (value as ConnectionFamily | null) ?? null;
    this.filterFamily.set(family);

    // La connexion déjà choisie peut ne pas appartenir à la nouvelle famille : la garder
    // afficherait « Famille : assurance » sur une liste de commandes core banking.
    const selected = this.filterConnectionId();
    if (selected) {
      const stillVisible = this.connections().some(
        (connection) => connection.id === selected && (!family || connection.family === family),
      );
      if (!stillVisible) this.filterConnectionId.set(null);
    }

    this._applyFilters();
  }

  public onConnectionChange(value: string | null): void {
    this.filterConnectionId.set(value || null);
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

  /** La file de rejet est l'état de repos de cet écran : réinitialiser y revient. */
  public resetFilters(): void {
    this.filterStatus.set('Rejected');
    this.filterCommandType.set(null);
    this.filterErrorFamily.set(null);
    this.filterEntityType.set(null);
    this.filterCrmId.set('');
    this.filterFamily.set(null);
    this.filterConnectionId.set(null);
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
    this.needsReload.set(false);
    this._load();
  }

  public openDetail(item: IntegrationCommandListItem): void {
    if (!item.commandId) return;

    const ref = this._sideDrawer.open<
      CommandDetailDrawerResult | null,
      CommandDetailDrawerData,
      CommandDetailDrawer
    >(CommandDetailDrawer, {
      data: {
        commandId: item.commandId,
        connectionName: this.connectionName(item.connectionId),
      } satisfies CommandDetailDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (!result) return;
      if (result.requestCancel) {
        this.openCancel(item);
        return;
      }
      this._applyOutcome(result.commandId, result.status, result.attempts);
    });
  }

  public canReplayRow(item: IntegrationCommandListItem): boolean {
    return this.canReplay() && canReplayCommand(item.status);
  }

  public canCancelRow(item: IntegrationCommandListItem): boolean {
    return this.canReplay() && canCancelCommand(item.status);
  }

  public confirmReplay(item: IntegrationCommandListItem): void {
    if (!item.commandId) return;
    this._confirm.confirm({
      title: REPLAY_CONFIRMATION.title,
      message: REPLAY_CONFIRMATION.message,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: REPLAY_CONFIRMATION.acceptLabel, theme: 'primary' },
      rejectButtonProps: { label: 'Fermer' },
      accept: () => this._replay(item.commandId as string),
    });
  }

  public openCancel(item: IntegrationCommandListItem): void {
    if (!item.commandId) return;

    const ref = this._sideDrawer.open<
      CancelCommandDrawerResult | null,
      CancelCommandDrawerData,
      CancelCommandDrawer
    >(CancelCommandDrawer, {
      data: {
        commandId: item.commandId,
        commandType: item.commandType,
      } satisfies CancelCommandDrawerData,
      panelClass: 'side-drawer-panel',
    });

    ref.closed.subscribe((result) => {
      if (result) this._applyOutcome(result.commandId, result.status);
    });
  }

  private _replay(commandId: string): void {
    this.actionInProgress.set(commandId);
    this._facade
      .replayCommand(commandId)
      .pipe(
        catchError((error: HttpErrorResponse) => {
          const message =
            error.status === 409
              ? "Cette commande n'est plus en rejet : elle a déjà été reprise ou annulée. Rechargez la liste."
              : integrationErrorMessage(error, "Le rejeu n'a pas abouti.");
          this._snackbar.error('Rejeu impossible', message);
          this.actionInProgress.set(null);
          return EMPTY;
        }),
      )
      .subscribe((result) => {
        this.actionInProgress.set(null);
        this._snackbar.success(
          'Commande remise en file',
          'Elle repart avec un budget de tentatives complet.',
        );
        this._applyOutcome(
          result.commandId ?? commandId,
          result.status ?? 'Pending',
          result.attempts ?? 0,
        );
      });
  }

  /**
   * La ligne est corrigée sur place avec ce que l'appel a retourné. Elle ne correspond
   * alors plus forcément au filtre courant — une commande rejouée n'est plus rejetée —
   * d'où la proposition de rechargement plutôt qu'un rechargement automatique qui la
   * ferait disparaître avant qu'on ait vu ce qui s'est passé.
   */
  private _applyOutcome(
    commandId: string | undefined,
    status: string | undefined,
    attempts?: number,
  ): void {
    if (!commandId || !status) return;

    this.rows.update((rows) =>
      rows.map((row) =>
        row.commandId === commandId
          ? { ...row, status, attempts: attempts ?? row.attempts }
          : row,
      ),
    );
    this.needsReload.set(true);
  }

  private _restoreFilters(): void {
    const params = this._route.snapshot.queryParams;

    // Pas de statut dans l'URL : la file de rejet reste la vue par défaut. Un `status`
    // vide explicite (« tous les statuts ») est, lui, respecté.
    this.filterStatus.set(
      'status' in params ? knownFilterValue(params['status'], COMMAND_STATUSES) : 'Rejected',
    );
    this.filterCommandType.set(knownFilterValue(params['type'], COMMAND_TYPES));
    this.filterErrorFamily.set(knownFilterValue(params['errorFamily'], COMMAND_ERROR_FAMILIES));
    this.filterEntityType.set(knownFilterValue(params['entity'], COMMAND_ENTITY_TYPES));
    this.filterCrmId.set(params['crmId'] ?? '');
    this.filterFamily.set(
      params['family'] === 'CoreBanking' || params['family'] === 'Insurance'
        ? params['family']
        : null,
    );
    this.filterConnectionId.set(params['connectionId'] ?? null);
    this.filterFrom.set(params['from'] ?? null);
    this.filterTo.set(params['to'] ?? null);

    const page = Number(params['page']);
    const pageSize = Number(params['pageSize']);
    this.tableConfig.update((config) => ({
      ...config,
      pagination: {
        ...config.pagination,
        // L'URL porte le numéro de page tel que l'API le compte (1-based) ; le tableau
        // travaille en index 0-based.
        pageIndex: Number.isInteger(page) && page > 0 ? page - 1 : 0,
        pageSize: [10, 20, 50].includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
      },
    }));
  }

  private _persistFilters(): void {
    const pagination = this.tableConfig().pagination;
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        status: this.filterStatus() ?? '',
        type: this.filterCommandType() || null,
        errorFamily: this.filterErrorFamily() || null,
        entity: this.filterEntityType() || null,
        crmId: this.filterCrmId().trim() || null,
        family: this.filterFamily() || null,
        connectionId: this.filterConnectionId() || null,
        from: this.filterFrom() || null,
        to: this.filterTo() || null,
        page: pagination.pageIndex > 0 ? pagination.pageIndex + 1 : null,
        pageSize: pagination.pageSize === DEFAULT_PAGE_SIZE ? null : pagination.pageSize,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Point de passage unique : URL, retour en première page, rechargement. */
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
        switchMap(() => {
          const pagination = this.tableConfig().pagination;
          const crmId = this.filterCrmId().trim();

          return this._facade
            .listCommands({
              status: this.filterStatus() ?? undefined,
              errorFamily: this.filterErrorFamily() ?? undefined,
              commandType: this.filterCommandType() ?? undefined,
              entityType: this.filterEntityType() ?? undefined,
              // Un identifiant mal collé n'est pas envoyé : le serveur le refuserait en
              // 400 et le filtre paraîtrait actif sans l'être.
              crmId: isUuid(crmId) ? crmId : undefined,
              connectionId: this.filterConnectionId() ?? undefined,
              from: startOfDayIso(this.filterFrom()),
              to: endOfDayIso(this.filterTo()),
              // `page` est 1-based côté API, `PageEvent.pageIndex` est 0-based.
              page: pagination.pageIndex + 1,
              pageSize: pagination.pageSize,
            })
            .pipe(
              catchError((error: HttpErrorResponse) => {
                this.loadError.set(
                  integrationErrorMessage(error, "La liste n'a pas pu être chargée."),
                );
                this.rows.set([]);
                this.totalCount.set(0);
                this.isLoading.set(false);
                return EMPTY;
              }),
            );
        }),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((page) => {
        this.loadError.set(null);
        this.rows.set(page.rows ?? []);
        this.totalCount.set(page.totalCount ?? 0);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: page.totalCount ?? 0 },
        }));
        this.isLoading.set(false);
      });
  }

  private _loadConnections(): void {
    this._facade
      .listAllConnections()
      .pipe(
        catchError(() => {
          // Sans la liste des connexions, l'écran reste utilisable : les lignes
          // affichent alors l'identifiant de connexion à défaut de son nom.
          return EMPTY;
        }),
      )
      .subscribe((connections) => this.connections.set(connections));
  }
}

export default CommandsHomePage;
