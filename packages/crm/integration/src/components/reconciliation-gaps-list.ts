import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ReconciliationGapPage,
  ReconciliationGapRow,
  ResolveReconciliationGapResult,
} from '@sankore/crm-api';
import {
  PermissionCode,
  PermissionsService,
  reconciliationGapTypeLabel,
  UNKNOWN_CODE_LABEL,
} from '@sankore/crm/common';
import { TasAlert } from '@talisoft/ui/alert';
import { Button } from '@talisoft/ui/button';
import { TasCard } from '@talisoft/ui/card';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasIcon } from '@talisoft/ui/icon';
import { TasInput } from '@talisoft/ui/input';
import { TasSelect } from '@talisoft/ui/select';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { TasTag } from '@talisoft/ui/tag';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { catchError, EMPTY, Observable, of, Subject, switchMap } from 'rxjs';
import {
  IntegrationFacadeService,
  integrationErrorMessage,
} from '../data-access/integration-facade.service';
import {
  ConnectionFamily,
  GAP_RESOLUTIONS,
  gapResolutionMeta,
  gapTypeLabel,
} from '../data-access/integration-referential';
import {
  ComparedValues,
  parseComparedValues,
  ResolveGapDrawer,
  ResolveGapDrawerData,
} from './resolve-gap-drawer';

interface GapTypeCounter {
  gapType: string;
  label: string;
  count: number;
}

/**
 * Taille de page utilisée par l'export. Le contrat ne propose pas d'export CSV
 * côté serveur : on parcourt donc les pages pour exporter TOUT le périmètre du
 * filtre et pas seulement la page affichée — exporter une page pour une
 * inspection serait un faux positif de complétude.
 */
const EXPORT_PAGE_SIZE = 500;

/** Garde-fou : au-delà, l'export s'arrête et le dit plutôt que de boucler. */
const EXPORT_MAX_PAGES = 40;

@Component({
  selector: 'reconciliation-gaps-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    TasAlert,
    Button,
    TasCard,
    TasFormField,
    TasLabel,
    TasIcon,
    TasInput,
    TasSelect,
    TasTable,
    TasTag,
    TimeagoPipe,
  ],
  template: `
    <!-- Dernière comparaison : le contrat n'expose qu'elle, pas un historique. -->
    @if (lastRun(); as run) {
      <tas-card class="mb-4 block">
        <div class="p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-sm font-semibold text-slate-700">Dernière comparaison</p>
              <p class="mt-0.5 text-xs text-slate-400">
                Démarrée {{ run.startedAt | dateTimeAgo }}
              </p>
              <p class="text-xs text-slate-400">
                @if (run.finishedAt) {
                  Terminée {{ run.finishedAt | dateTimeAgo }}
                } @else {
                  Toujours en cours
                }
              </p>
            </div>
            <div class="flex gap-8 text-right">
              <div>
                <p class="text-lg font-semibold tabular-nums text-slate-800">
                  {{ run.checkedCount ?? 0 }}
                </p>
                <p class="text-xs text-slate-400">clients contrôlés</p>
              </div>
              <div>
                <p class="text-lg font-semibold tabular-nums text-slate-800">
                  {{ run.gapCount ?? 0 }}
                </p>
                <p class="text-xs text-slate-400">écarts trouvés</p>
              </div>
              <div>
                <p class="text-lg font-semibold tabular-nums text-slate-800">
                  {{ run.closedCount ?? 0 }}
                </p>
                <p class="text-xs text-slate-400">écarts refermés</p>
              </div>
            </div>
          </div>

          <!-- Une comparaison qui a échoué est un constat, pas une note de bas de page. -->
          @if (run.failureDetail) {
            <tas-alert type="error" class="mt-4">
              <p class="text-sm font-medium">La dernière comparaison ne s'est pas terminée.</p>
              <p class="mt-1 text-sm">{{ run.failureDetail }}</p>
              <p class="mt-1 text-sm">
                Les écarts ci-dessous datent donc d'une comparaison antérieure.
              </p>
            </tas-alert>
          }
        </div>
      </tas-card>
    }

    <!-- Compteurs par type : portée sur TOUT le périmètre, pas sur la page. -->
    @if (openCounters().length > 0 || undetectableTypes().length > 0) {
      <div class="mb-4">
        @if (openCounters().length > 0) {
          <p class="mb-2 text-xs text-slate-400">
            Écarts ouverts sur l'ensemble du périmètre — cliquez un type pour le filtrer
          </p>
          <div class="flex flex-wrap gap-2">
            @for (counter of openCounters(); track counter.gapType) {
              <button
                type="button"
                class="rounded-lg border px-3 py-2 text-left transition-colors"
                [class]="
                  filterGapType() === counter.gapType
                    ? 'border-primary bg-primary/5'
                    : 'border-slate-200 hover:border-slate-300'
                "
                (click)="toggleGapTypeFilter(counter.gapType)"
              >
                <span class="block text-lg font-semibold tabular-nums text-slate-800">
                  {{ counter.count }}
                </span>
                <span class="block text-xs text-slate-500">{{ counter.label }}</span>
              </button>
            }
          </div>
        }

        <!--
          Jamais de « 0 » pour ces types : cette installation ne sait pas les
          détecter, donc l'absence d'écart n'est pas une mesure. Un zéro serait lu
          comme « rien à signaler », ce qui est exactement le contresens que le
          contrat cherche à éviter.
        -->
        @if (undetectableTypes().length > 0) {
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-xs text-slate-400">Non détectable sur cette installation :</span>
            @for (label of undetectableTypes(); track label) {
              <tas-tag severity="neutral">{{ label }}</tas-tag>
            }
          </div>
        }
      </div>
    }

    @if (isScopeMissing()) {
      <tas-card class="block">
        <div class="p-10 text-center text-sm text-slate-500">
          Choisissez un assureur pour voir ses écarts de réconciliation.
        </div>
      </tas-card>
    } @else {
      <!-- Filtres -->
      <tas-card class="mb-4 block">
      <div class="p-4">
        <!-- Empilé à 360 px : une grille à 4 colonnes y rendrait chaque champ illisible. -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <tas-form-field>
            <tas-label>Type d'écart</tas-label>
            <tas-select
              clearable
              [options]="gapTypeOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="Tous les types"
              [ngModel]="filterGapType() ?? ''"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onGapTypeChange($event)"
            ></tas-select>
          </tas-form-field>

          <tas-form-field>
            <tas-label>Statut</tas-label>
            <tas-select
              clearable
              [options]="resolutionOptions"
              optionLabel="label"
              optionValue="value"
              placeholder="Tous les statuts"
              [ngModel]="filterResolution()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onResolutionChange($event)"
            ></tas-select>
          </tas-form-field>

          <tas-form-field>
            <tas-label>Client (identifiant CRM)</tas-label>
            <input
              tasInput
              type="text"
              placeholder="Identifiant du client"
              [ngModel]="filterCrmId()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onCrmIdChange($event)"
            />
          </tas-form-field>

          <tas-form-field>
            <tas-label>Détecté à partir du</tas-label>
            <input
              tasInput
              type="date"
              [ngModel]="filterFrom()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onDateChange('from', $event)"
            />
          </tas-form-field>

          <tas-form-field>
            <tas-label>Détecté jusqu'au</tas-label>
            <input
              tasInput
              type="date"
              [ngModel]="filterTo()"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onDateChange('to', $event)"
            />
          </tas-form-field>
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-xs text-slate-400">{{ totalCount() }} écart(s) dans ce filtre</p>
            @if (isLocalFilterActive()) {
              <p class="text-xs text-slate-400">
                Les filtres client et date s'appliquent aux lignes chargées : le serveur
                ne les connaît pas, et le total ci-dessus reste celui du périmètre.
              </p>
            }
          </div>
          <div class="flex items-center gap-2">
            <button tas-text-button color="primary" type="button" (click)="reload()">
              <tas-icon iconName="refresh" style="font-size: 14px"></tas-icon>
              Actualiser
            </button>
            <button
              tas-outlined-button
              color="primary"
              type="button"
              (click)="exportCsv()"
              [disabled]="isExporting() || totalCount() === 0"
              [isLoading]="isExporting()"
            >
              Exporter en CSV
            </button>
          </div>
        </div>
      </div>
      </tas-card>

      <tas-table
        [data]="visibleRows()"
        identifierField="gapId"
        [config]="tableConfig()"
        [isLoading]="isLoading()"
        [hasCaption]="false"
        (pageEventChange)="onPageChange($event)"
      >
        <ng-template #header>
          <tr>
            <th>Ouvert depuis</th>
            <th>Type d'écart</th>
            <th>Valeurs comparées</th>
            <th>Statut</th>
            <th class="text-right"></th>
          </tr>
        </ng-template>

        <ng-template #body let-gap>
          <tr class="hover:bg-slate-50 transition-colors">
            <!-- L'âge de l'écart est la mesure qui compte : elle passe en premier. -->
            <td class="py-3 whitespace-nowrap">
              <p class="text-sm font-semibold text-slate-800">
                {{ gap.detectedAt | dateTimeAgo }}
              </p>
              <p class="text-xs text-slate-400">
                Revu {{ gap.lastSeenAt | dateTimeAgo }}
              </p>
            </td>

            <td class="text-sm text-slate-700">{{ gapLabel(gap.gapType) }}</td>

            <td>
              <div class="flex items-stretch gap-3">
                <div class="min-w-0">
                  <p class="text-xs text-slate-400">Identifiant CRM</p>
                  <p class="font-mono text-xs text-slate-700 truncate" [title]="gap.crmId ?? ''">
                    {{ gap.crmId || '—' }}
                  </p>
                </div>
                <div class="border-l border-slate-200"></div>
                <div class="min-w-0">
                  <p class="text-xs text-slate-400">Identifiant externe</p>
                  <p
                    class="font-mono text-xs text-slate-700 truncate"
                    [title]="gap.externalId ?? ''"
                  >
                    {{ gap.externalId || '—' }}
                  </p>
                </div>
              </div>

              <!--
                Côte à côte seulement quand le champ details étiquette les deux côtés lui-même ;
                sinon le texte brut, qui reste la seule source sûre.
              -->
              @if (compared(gap.details); as values) {
                <div class="mt-2 rounded-lg border border-slate-200 p-2">
                  @if (values.field) {
                    <p class="text-xs font-medium text-slate-600">{{ values.field }}</p>
                  }
                  <div class="mt-1 flex items-stretch gap-3">
                    <div class="min-w-0">
                      <p class="text-xs text-slate-400">Valeur CRM</p>
                      <p class="text-xs font-medium text-slate-800 break-all">{{ values.crm }}</p>
                    </div>
                    <div class="border-l border-slate-200"></div>
                    <div class="min-w-0">
                      <p class="text-xs text-slate-400">Valeur système externe</p>
                      <p class="text-xs font-medium text-slate-800 break-all">
                        {{ values.external }}
                      </p>
                    </div>
                  </div>
                </div>
              } @else if (gap.details) {
                <p class="mt-1 text-xs text-slate-500">{{ gap.details }}</p>
              }
            </td>

            <td>
              <tas-tag [severity]="resolutionMeta(gap.resolution).severity">
                {{ resolutionMeta(gap.resolution).label }}
              </tas-tag>
              @if (gap.resolvedAt) {
                <p class="mt-1 text-xs text-slate-400" [title]="gap.resolutionNote ?? ''">
                  par {{ gap.resolvedBy || '—' }}, {{ gap.resolvedAt | dateTimeAgo }}
                </p>
              }
            </td>

            <td class="text-right whitespace-nowrap">
              <div class="flex items-center justify-end gap-3">
                @if (gap.crmId) {
                  <a
                    class="text-xs text-primary hover:underline"
                    [routerLink]="['/customers', gap.crmId]"
                  >
                    Client
                  </a>
                  <!--
                    Il n'existe pas de commandId sur une ligne d'écart : la commande
                    liée se retrouve par filtre sur l'écran Commandes (connexion +
                    identifiant CRM), qui restaure ses filtres depuis l'URL. C'est une
                    jointure par filtre, pas un identifiant direct — sans ce
                    commentaire, le prochain lecteur chercherait un champ qui n'existe
                    pas.
                  -->
                  <a
                    class="text-xs text-primary hover:underline"
                    [routerLink]="['/settings/integrations/commands']"
                    [queryParams]="{ connectionId: gap.connectionId, crmId: gap.crmId }"
                  >
                    Commande liée
                  </a>
                }
                @if (canResolve() && gap.resolution === 'Open') {
                  <button
                    tas-text-button
                    color="primary"
                    size="small"
                    type="button"
                    (click)="openResolveDrawer(gap)"
                  >
                    Marquer comme résolu
                  </button>
                }
              </div>
            </td>
          </tr>
        </ng-template>
      </tas-table>

      @if (!isLoading() && visibleRows().length === 0) {
        <p class="mt-3 text-center text-sm text-slate-500">{{ emptyMessage() }}</p>
      }
    }
  `,
})
export class ReconciliationGapsList implements OnInit {
  private readonly _facade = inject(IntegrationFacadeService);
  private readonly _permissions = inject(PermissionsService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);

  /** Périmètre : une connexion, ou toutes quand rien n'est passé. */
  public connectionId = input<string | null>(null);

  /** Droit qui ouvre la résolution : INT-35 et ASS-18 n'ont pas le même. */
  public resolvePermission = input.required<PermissionCode>();

  /**
   * Famille à laquelle l'écran se restreint. Le contrat ne filtre PAS par
   * famille : sans connexion choisie, un écran assurance afficherait aussi les
   * écarts du core banking. Tant que la famille est restreinte et qu'aucune
   * connexion n'est choisie, on n'appelle donc pas.
   */
  public family = input<ConnectionFamily | null>(null);

  public isLoading = signal(false);
  public isExporting = signal(false);
  public rows = signal<ReconciliationGapRow[]>([]);
  public totalCount = signal(0);

  private _pageMeta = signal<ReconciliationGapPage | null>(null);

  /** Le statut vaut Open par défaut : la question de l'écran est ce qui reste ouvert. */
  public filterResolution = signal<string>('Open');
  public filterGapType = signal<string | null>(null);
  public filterFrom = signal<string>('');
  public filterTo = signal<string>('');
  /**
   * Filtre client. Le contrat ne propose aucun paramètre `crmId` sur `reconciliation/gaps` : il
   * s'applique donc aux lignes chargées, comme les dates, et l'interface le dit. Il est restauré
   * depuis l'URL, ce qui permet d'arriver ici depuis un dossier client avec son identifiant.
   */
  public filterCrmId = signal<string>('');

  public tableConfig = signal<TableConfig>({
    property: 'gapId',
    pagination: {
      serverSide: true,
      pageIndex: 0,
      pageSize: 20,
      pageSizeOptions: [10, 20, 50],
      totalElements: 0,
    },
  });

  public readonly resolutionOptions = GAP_RESOLUTIONS.map((resolution) => ({
    label: gapResolutionMeta(resolution).label,
    value: resolution as string,
  }));

  /**
   * La résolution vient d'un `input()` : `PermissionsService.can()` fige ses codes
   * à l'appel, on lit donc l'ensemble accordé pour rester réactif au changement
   * d'entrée.
   */
  public readonly canResolve = computed(() =>
    this._permissions.granted().has(this.resolvePermission()),
  );

  public readonly lastRun = computed(() => this._pageMeta()?.lastRun ?? null);

  public readonly undetectableTypes = computed(() =>
    (this._pageMeta()?.undetectableGapTypes ?? []).map((gapType) => gapTypeLabel(gapType)),
  );

  public readonly openCounters = computed<GapTypeCounter[]>(() => {
    const counts = this._pageMeta()?.openCountsByType;
    if (!counts) return [];
    return Object.entries(counts)
      .map(([gapType, count]) => ({ gapType, label: this.gapLabel(gapType), count }))
      .sort((a, b) => b.count - a.count);
  });

  /**
   * Les types proposés au filtre viennent des données, pas d'une énumération
   * inventée : le swagger ne déclare pas la liste. Les types non détectables en
   * sont exclus — il n'y a rien à y trouver.
   */
  public readonly gapTypeOptions = computed(() => {
    const undetectable = new Set(this._pageMeta()?.undetectableGapTypes ?? []);
    const types = new Set<string>();
    for (const gapType of Object.keys(this._pageMeta()?.openCountsByType ?? {})) {
      if (!undetectable.has(gapType)) types.add(gapType);
    }
    for (const row of this.rows()) {
      if (row.gapType && !undetectable.has(row.gapType)) types.add(row.gapType);
    }
    return [...types]
      .map((gapType) => ({ label: this.gapLabel(gapType), value: gapType }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  });

  public readonly isDateFilterActive = computed(() => !!this.filterFrom() || !!this.filterTo());

  /** Les filtres que le serveur ne connaît pas, et qui ne portent donc que sur la page chargée. */
  public readonly isLocalFilterActive = computed(
    () => this.isDateFilterActive() || !!this.filterCrmId().trim(),
  );

  public readonly isScopeMissing = computed(() => !!this.family() && !this.connectionId());

  /**
   * Le contrat ne propose ni paramètre de date ni paramètre de client sur
   * `reconciliation/gaps` : ces deux filtres sont appliqués aux lignes de la page
   * chargée. `totalCount` reste donc celui du serveur, et l'interface le dit —
   * sans quoi un écart filtré localement passerait pour un écart absent du
   * périmètre.
   */
  public readonly visibleRows = computed(() => this._applyLocalFilters(this.rows()));

  public readonly emptyMessage = computed(() => {
    if (this.isLocalFilterActive()) {
      return 'Aucun écart ne correspond au client ou à la période parmi les lignes chargées. Changez de page ou élargissez les filtres.';
    }
    if (this.filterResolution() === 'Open') {
      return 'Aucun écart ouvert sur ce périmètre.';
    }
    return 'Aucun écart ne correspond à ce filtre.';
  });

  /** Un seul point d'entrée de chargement : la réponse en vol est abandonnée. */
  private readonly _reload$ = new Subject<void>();

  constructor() {
    // Un changement de périmètre repart en page 1 : garder l'index d'une page qui
    // n'existe plus dans le nouveau périmètre renvoie une page vide.
    effect(() => {
      this.connectionId();
      this.family();
      untracked(() => {
        this._setPageIndex(0);
        this._reload$.next();
      });
    });
  }

  public ngOnInit(): void {
    const params = this._route.snapshot.queryParams;
    if (params['gapType']) this.filterGapType.set(params['gapType']);
    if (params['resolution']) this.filterResolution.set(params['resolution']);
    if (params['detectedFrom']) this.filterFrom.set(params['detectedFrom']);
    if (params['detectedTo']) this.filterTo.set(params['detectedTo']);
    if (params['crmId']) this.filterCrmId.set(params['crmId']);

    this._reload$
      .pipe(
        switchMap(() => this._fetchPage()),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe((page) => {
        this.rows.set(page.rows ?? []);
        this._pageMeta.set(page);
        this.totalCount.set(page.totalCount ?? 0);
        this.tableConfig.update((config) => ({
          ...config,
          pagination: { ...config.pagination, totalElements: page.totalCount ?? 0 },
        }));
        this.isLoading.set(false);
      });
  }

  /**
   * Le référentiel de l'intégration et celui du socle conformité ne couvrent pas exactement les
   * mêmes types (`OrphanReference` d'un côté, `DesignationMismatch` de l'autre). On garde le
   * premier, et on ne retombe sur le second que pour un code qu'il ne connaît pas : sans cela,
   * un type livré par l'un des deux s'afficherait en code brut.
   */
  public gapLabel(gapType: string | null | undefined): string {
    const label = gapTypeLabel(gapType);
    if (gapType && label === gapType) {
      const fromCommon = reconciliationGapTypeLabel(gapType);
      if (fromCommon !== UNKNOWN_CODE_LABEL) return fromCommon;
    }
    return label;
  }

  public compared(details: string | null | undefined): ComparedValues | null {
    return parseComparedValues(details);
  }

  public resolutionMeta(resolution: string | null | undefined) {
    return gapResolutionMeta(resolution);
  }

  public reload(): void {
    this._reload$.next();
  }

  public toggleGapTypeFilter(gapType: string): void {
    this.filterGapType.update((current) => (current === gapType ? null : gapType));
    this._applyFilters();
  }

  public onGapTypeChange(value: string | null): void {
    this.filterGapType.set(value || null);
    this._applyFilters();
  }

  public onResolutionChange(value: string | null): void {
    this.filterResolution.set(value ?? '');
    this._applyFilters();
  }

  public onCrmIdChange(value: string | null): void {
    this.filterCrmId.set(value ?? '');
    this._pushFiltersToUrl();
  }

  public onDateChange(bound: 'from' | 'to', value: string | null): void {
    if (bound === 'from') this.filterFrom.set(value ?? '');
    else this.filterTo.set(value ?? '');
    this._pushFiltersToUrl();
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
    this._reload$.next();
  }

  public openResolveDrawer(gap: ReconciliationGapRow): void {
    const ref = this._sideDrawer.open<
      ResolveReconciliationGapResult,
      ResolveGapDrawerData,
      ResolveGapDrawer
    >(ResolveGapDrawer, { data: { gap }, panelClass: 'side-drawer-panel' });

    ref.closed.subscribe((result) => {
      if (!result) return;
      // On repose le résultat renvoyé sur la ligne au lieu de recharger : un
      // rechargement avec le filtre « Ouvert » ferait disparaître la ligne sans
      // montrer ce qui vient d'être enregistré.
      this.rows.update((rows) =>
        rows.map((row) =>
          row.gapId === result.gapId
            ? {
                ...row,
                resolution: result.resolution ?? row.resolution,
                resolvedBy: result.resolvedBy ?? row.resolvedBy,
                resolvedAt: result.resolvedAt ?? row.resolvedAt,
              }
            : row,
        ),
      );
    });
  }

  // ——— Export CSV ———

  public exportCsv(): void {
    this.isExporting.set(true);
    this._fetchAllPages(1, []).subscribe({
      next: ({ rows, truncated }) => {
        const exported = this._applyLocalFilters(rows);
        this._download(this._toCsv(exported));
        this.isExporting.set(false);

        if (truncated) {
          this._snackbar.info(
            'Export partiel',
            `${exported.length} écart(s) exporté(s). Le fichier s'arrête à ${EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE} lignes : affinez les filtres pour le reste.`,
          );
        } else {
          this._snackbar.success(
            'Export terminé',
            `${exported.length} écart(s) exporté(s) sur l'ensemble du filtre.`,
          );
        }
      },
      error: () => this.isExporting.set(false),
    });
  }

  private _fetchAllPages(
    page: number,
    accumulated: ReconciliationGapRow[],
  ): Observable<{ rows: ReconciliationGapRow[]; truncated: boolean }> {
    return this._facade
      .listReconciliationGaps({
        connectionId: this.connectionId() ?? undefined,
        gapType: this.filterGapType() ?? undefined,
        resolution: this.filterResolution() || undefined,
        page,
        pageSize: EXPORT_PAGE_SIZE,
      })
      .pipe(
        switchMap((result) => {
          const rows = [...accumulated, ...(result.rows ?? [])];
          const totalPages = result.totalPages ?? 1;
          const hasMore = page < totalPages && (result.rows?.length ?? 0) > 0;
          if (!hasMore) return of({ rows, truncated: false });
          if (page >= EXPORT_MAX_PAGES) return of({ rows, truncated: true });
          return this._fetchAllPages(page + 1, rows);
        }),
        catchError((err: HttpErrorResponse) => {
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, "L'export des écarts n'a pas abouti."),
          );
          return EMPTY;
        }),
      );
  }

  private _toCsv(rows: ReconciliationGapRow[]): string {
    const header = [
      "Type d'écart",
      'Identifiant CRM',
      'Identifiant externe',
      'Champ comparé',
      'Valeur CRM',
      'Valeur système externe',
      'Valeurs comparées',
      'Statut',
      'Détecté le',
      'Vu pour la dernière fois',
      'Résolu par',
      'Résolu le',
      'Note de résolution',
    ];

    const lines = rows.map((row) => {
      // Les trois colonnes dérivées restent vides quand le texte n'étiquette pas les deux
      // côtés : une colonne vide se lit, une colonne devinée se recopie dans un rapport.
      const compared = parseComparedValues(row.details);
      return [
        this.gapLabel(row.gapType),
        row.crmId ?? '',
        row.externalId ?? '',
        compared?.field ?? '',
        compared?.crm ?? '',
        compared?.external ?? '',
        row.details ?? '',
        gapResolutionMeta(row.resolution).label,
        row.detectedAt ?? '',
        row.lastSeenAt ?? '',
        row.resolvedBy ?? '',
        row.resolvedAt ?? '',
        row.resolutionNote ?? '',
      ]
        .map((field) => this._escapeCsv(field))
        .join(';');
    });

    return [header.map((field) => this._escapeCsv(field)).join(';'), ...lines].join('\r\n');
  }

  private _escapeCsv(value: string): string {
    if (/[";\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private _download(csv: string): void {
    // BOM UTF-8 : sans lui, Excel casse les accents des libellés.
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ecarts-reconciliation-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  // ——— Interne ———

  private _fetchPage(): Observable<ReconciliationGapPage> {
    if (this.isScopeMissing()) {
      this.rows.set([]);
      this._pageMeta.set(null);
      this.totalCount.set(0);
      this.isLoading.set(false);
      return EMPTY;
    }

    this.isLoading.set(true);
    const pagination = this.tableConfig().pagination;

    return this._facade
      .listReconciliationGaps({
        connectionId: this.connectionId() ?? undefined,
        gapType: this.filterGapType() ?? undefined,
        resolution: this.filterResolution() || undefined,
        // L'API pagine en 1-based, `PageEvent.pageIndex` est 0-based.
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
      })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.isLoading.set(false);
          this._snackbar.error(
            'Erreur',
            integrationErrorMessage(err, 'Impossible de lire les écarts de réconciliation.'),
          );
          return EMPTY;
        }),
      );
  }

  private _applyLocalFilters(rows: ReconciliationGapRow[]): ReconciliationGapRow[] {
    const from = this.filterFrom();
    const to = this.filterTo();
    const crmId = this.filterCrmId().trim().toLowerCase();
    if (!from && !to && !crmId) return rows;

    const min = from ? Date.parse(`${from}T00:00:00`) : null;
    const max = to ? Date.parse(`${to}T23:59:59`) : null;
    return rows.filter((row) => {
      if (crmId && !(row.crmId ?? '').toLowerCase().includes(crmId)) return false;
      if (!min && !max) return true;
      return this._isWithin(row.detectedAt, min, max);
    });
  }

  private _isWithin(
    value: string | null | undefined,
    min: number | null,
    max: number | null,
  ): boolean {
    const detected = value ? Date.parse(value) : Number.NaN;
    if (!Number.isFinite(detected)) return false;
    return (min === null || detected >= min) && (max === null || detected <= max);
  }

  private _applyFilters(): void {
    this._pushFiltersToUrl();
    this._setPageIndex(0);
    this._reload$.next();
  }

  private _setPageIndex(pageIndex: number): void {
    this.tableConfig.update((config) => ({
      ...config,
      pagination: { ...config.pagination, pageIndex },
    }));
  }

  private _pushFiltersToUrl(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: {
        gapType: this.filterGapType() || null,
        resolution: this.filterResolution() || null,
        detectedFrom: this.filterFrom() || null,
        detectedTo: this.filterTo() || null,
        crmId: this.filterCrmId().trim() || null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
