import { Component, DestroyRef, inject, input, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { PageEvent } from '@angular/material/paginator';
import { catchError, EMPTY, finalize } from 'rxjs';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { LeadSourcesService } from './lead-sources.service';
import { TasTag } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { TableConfig, TasTable } from '@talisoft/ui/table';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { SideDrawerService } from '@talisoft/ui/side-drawer';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  IngestionDto,
  PagedResultOfIngestionDto,
  IngestionsApiService,
} from '@sankore/crm-api';
import { openIngestionDetail } from './ingestion-detail-drawer';
import {
  INGESTION_AUTO_REFRESH_MS,
  ingestionHasLead,
  ingestionStatusLabel,
  ingestionStatusSeverity,
  isReplayableIngestion,
} from './ingestion.types';

/**
 * FE-30 — Consulter et rejouer les ingestions d'une source
 */

const STATUS_OPTIONS = [
  { label: 'Tous', value: '' },
  { label: 'Accepté', value: 'Accepted' },
  { label: 'Rejeté', value: 'Rejected' },
  { label: 'Doublon', value: 'Duplicate' },
  { label: 'Échoué', value: 'Failed' },
];

/**
 * Le tableau qualité (FE-23) et les anciens liens passent encore le statut sous
 * sa forme numérique historique (`?status=2`) : on le traduit vers le nom du contrat.
 */
const LEGACY_STATUS: Record<string, string> = { '0': 'Accepted', '1': 'Rejected', '2': 'Duplicate', '3': 'Failed' };

@Component({
  selector: 'ingestion-list',
  standalone: true,
  imports: [
    FormsModule, DatePipe,
    TasSpinner, TasIcon, TasTag, Button, TasTable,
    TasFormField, TasLabel, TasSelect,
  ],
  template: `
    <div class="max-w-5xl flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">Réceptions</h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Historique de chaque lead reçu par cette source. Cliquez sur une ligne pour en voir le détail.
          </p>
        </div>
        <div class="flex items-center gap-2">
          @if (autoRefresh()) {
            <button tas-text-button type="button" color="primary" class="text-xs"
                    [title]="autoRefreshPaused() ? 'Reprendre l’actualisation automatique' : 'Suspendre l’actualisation automatique'"
                    (click)="autoRefreshPaused.set(!autoRefreshPaused())">
              <tas-icon [iconName]="autoRefreshPaused() ? 'feather:play' : 'feather:pause'" style="font-size:12px"></tas-icon>
              {{ autoRefreshPaused() ? 'Actualisation suspendue' : 'Actualisation auto' }}
            </button>
          }
          <button tas-outlined-button type="button" color="primary" (click)="refresh()">
            <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
            Rafraîchir
          </button>
        </div>
      </div>

      <!-- Filter -->
      <div class="grid grid-cols-2 items-end gap-3">
        <tas-form-field>
          <tas-label>Statut</tas-label>
          <tas-select
            clearable
            [options]="statusOptions"
            optionLabel="label" optionValue="value"
            [ngModel]="filterStatus()" (ngModelChange)="onFilterChange($event)"
          ></tas-select>
        </tas-form-field>
        <div class="flex justify-end gap-3">
          @if (!loadError()) {
            <span class="text-xs text-slate-400 tabular-nums">{{ totalCount() }} réception(s)</span>
          }
          @if (autoRefresh() && lastRefreshedAt()) {
            <span class="text-xs text-slate-400 tabular-nums">
              Mis à jour à {{ lastRefreshedAt() | date:'HH:mm:ss' }}
              @if (autoRefreshFailed()) {
                <span class="text-functional-error">· échec de la dernière actualisation</span>
              }
            </span>
          }
          <!-- FE-23 AC2 — la liste des doublons est exportable pour contestation -->
          @if (filterStatus() === DUPLICATE_STATUS) {
            <button tas-outlined-button type="button" class="text-xs"
                    [disabled]="isExporting()"
                    [isLoading]="isExporting()"
                    (click)="exportDuplicates()">
              <tas-icon iconName="feather:download" style="font-size:10px"></tas-icon>
              Exporter CSV
            </button>
          }
        </div>
      </div>

      @if (replayRequestedCount() > 0) {
        <div class="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <tas-icon iconName="feather:clock" class="text-blue-500 mt-0.5" style="font-size:12px"></tas-icon>
          <div class="flex-1">
            <p class="text-xs text-blue-800">
              Rejeu demandé pour {{ replayRequestedCount() }} réception(s). Le serveur retraite la
              demande en arrière-plan : rafraîchissez dans quelques instants pour lire le nouveau statut.
            </p>
            <div class="flex gap-2 mt-1">
              <button tas-text-button type="button" class="text-xs" (click)="refresh()">
                Rafraîchir
              </button>
              @if (filterStatus() !== '') {
                <button tas-text-button type="button" class="text-xs" (click)="onFilterChange('')">
                  Afficher tous les statuts
                </button>
              }
            </div>
          </div>
        </div>
      }

      @if (loadError()) {
        <!-- Une panne ne doit pas se lire « Aucune réception enregistrée. » -->
        <div class="flex flex-col items-center py-12 text-center rounded-lg border border-slate-200 bg-white">
          <tas-icon iconName="feather:alert-triangle" class="text-functional-error mb-2" style="font-size:24px"></tas-icon>
          <p class="text-sm text-slate-600">Le chargement des réceptions a échoué.</p>
          <p class="text-xs text-slate-400 mt-0.5">
            La liste n'a pas pu être lue : elle n'est pas forcément vide.
          </p>
          <button tas-outlined-button type="button" class="mt-3" (click)="refresh()">
            Réessayer
          </button>
        </div>
      } @else {
        <tas-table [data]="ingestions()" identifierField="id" [config]="tableConfig()"
                   [isLoading]="isLoading()" (pageEventChange)="onPageChange($event)">
          <ng-template #header>
            <tr class="text-left text-xs font-medium text-slate-500 border-b border-slate-200">
              <th class="py-2 px-4 font-medium">Date</th>
              @if (!isScript()) {
                <th class="py-2 px-3 font-medium">ID externe</th>
              }
              <th class="py-2 px-3 font-medium">Statut</th>
              <th class="py-2 px-3 font-medium">Motif</th>
              <th class="py-2 px-3 font-medium">Lead</th>
              <th class="py-2 px-4 font-medium text-right">Actions</th>
            </tr>
          </ng-template>
          <ng-template #body let-ing>
            <tr class="cursor-pointer align-middle transition-colors hover:bg-slate-50"
                [class.bg-blue-50]="isNew(ing)"
                (click)="openDetail(ing)">
              <td class="py-3 px-4 text-xs text-slate-600 tabular-nums whitespace-nowrap">
                {{ ing.ingestedAt | date:'dd/MM/yy HH:mm:ss' }}
                @if (isNew(ing)) {
                  <span class="ml-1 text-[10px] font-medium text-blue-600">Nouveau</span>
                }
              </td>
              @if (!isScript()) {
                <td class="py-3 px-3 max-w-[10rem]">
                  @if (ing.externalId) {
                    <span class="text-xs text-slate-700 font-mono truncate block" [title]="ing.externalId">{{ ing.externalId }}</span>
                  } @else {
                    <span class="text-xs text-slate-400">—</span>
                  }
                </td>
              }
              <td class="py-3 px-3">
                <tas-tag [severity]="statusSeverity(ing.status)">{{ statusLabel(ing.status) }}</tas-tag>
                @if (isReplayRequested(ing)) {
                  <p class="text-[10px] text-blue-500 mt-0.5">Rejeu en cours</p>
                }
              </td>
              <td class="py-3 px-3 max-w-[16rem]">
                @if (ing.rejectionReason) {
                  <p class="text-xs text-slate-600 truncate" [title]="ing.rejectionReason">{{ ing.rejectionReason }}</p>
                } @else {
                  <span class="text-xs text-slate-400">—</span>
                }
              </td>
              <td class="py-3 px-3 text-xs">
                @if (hasLead(ing)) {
                  <span class="text-primary">Lead créé</span>
                } @else {
                  <span class="text-slate-400">—</span>
                }
              </td>
              <td class="py-3 px-4">
                <div class="flex justify-end gap-1">
                  <button tas-icon-button type="button" title="Voir le détail" (click)="$event.stopPropagation(); openDetail(ing)">
                    <tas-icon iconName="feather:eye" style="font-size:12px" class="text-slate-400"></tas-icon>
                  </button>
                  @if (canReplay() && isReplayable(ing)) {
                    <button tas-icon-button type="button" title="Rejouer"
                            [disabled]="replayingId() === ing.id"
                            (click)="$event.stopPropagation(); replay(ing)">
                      @if (replayingId() === ing.id) {
                        <tas-spinner size="3"></tas-spinner>
                      } @else {
                        <tas-icon iconName="feather:rotate-cw" style="font-size:12px" class="text-blue-500"></tas-icon>
                      }
                    </button>
                  }
                </div>
              </td>
            </tr>
          </ng-template>
        </tas-table>
      }
    </div>
  `,
})
export class IngestionList implements OnInit {
  private readonly _ingestionsApi = inject(IngestionsApiService);
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);
  private readonly _sideDrawer = inject(SideDrawerService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly sourceId = input.required<string>();
  /** FE-23 AC2 — statut pre-selectionne lorsqu'on arrive depuis le tableau qualite. */
  public readonly initialStatus = input<string | null>(null);
  public readonly canReplay = input(false);
  /** Source « script embarqué » : l'ID externe y est un GUID tiré au sort, la colonne n'apprend rien. */
  public readonly isScript = input(false);
  /** Recharge la page courante à intervalle régulier, pour voir arriver les soumissions. */
  public readonly autoRefresh = input(false);

  public isLoading = signal(true);
  public ingestions = signal<IngestionDto[]>([]);
  public totalCount = signal(0);
  public page = signal(1);
  public pageSize = signal(25);
  public filterStatus = signal('');
  public isExporting = signal(false);
  /** Distingue « la liste est vide » de « la liste n'a pas pu être lue ». */
  public loadError = signal(false);

  public autoRefreshPaused = signal(false);
  public autoRefreshFailed = signal(false);
  public lastRefreshedAt = signal<Date | null>(null);
  /** Réceptions apparues lors d'une actualisation automatique, mises en évidence. */
  public newIds = signal<ReadonlySet<string>>(new Set<string>());
  private _knownIds = new Set<string>();
  private _silentLoadInFlight = false;

  public readonly tableConfig = computed<TableConfig>(() => ({
    property: 'id',
    pagination: {
      serverSide: true,
      pageIndex: this.page() - 1,
      pageSize: this.pageSize(),
      totalElements: this.totalCount(),
      pageSizeOptions: [10, 25, 50],
    },
  }));

  /** Valeur du statut « Doublon » dans le filtre. */
  public readonly DUPLICATE_STATUS = 'Duplicate';

  // Replay
  public replayingId = signal<string | null>(null);
  /** Ingestions dont le rejeu a été accepté (202) mais pas encore observé. */
  public replayRequestedIds = signal<ReadonlySet<string>>(new Set<string>());
  public readonly replayRequestedCount = computed(() => this.replayRequestedIds().size);

  public readonly statusOptions = STATUS_OPTIONS;

  public readonly statusLabel = ingestionStatusLabel;
  public readonly statusSeverity = ingestionStatusSeverity;
  public readonly hasLead = ingestionHasLead;
  public readonly isReplayable = isReplayableIngestion;

  ngOnInit(): void {
    const initial = this.initialStatus();
    if (initial) this.filterStatus.set(LEGACY_STATUS[initial] ?? initial);
    this._load();

    if (this.autoRefresh()) {
      const timer = setInterval(() => this._autoRefreshTick(), INGESTION_AUTO_REFRESH_MS);
      this._destroyRef.onDestroy(() => clearInterval(timer));
    }
  }

  public exportDuplicates(): void {
    this.isExporting.set(true);
    // Le client généré négocie `Accept: text/csv`, donc `responseType: 'text'` :
    // l'observable émet une *chaîne*, pas un Blob. `URL.createObjectURL(chaîne)`
    // levait un TypeError dans le handler `next`, hors de portée du `catchError` :
    // aucun fichier, aucun message, et `isExporting` bloqué à true — bouton
    // désactivé en spinner jusqu'au rechargement de la page. D'où le Blob
    // construit ici et la remise à zéro dans `finalize`.
    this._sourcesService.exportDuplicates(this.sourceId()).pipe(
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error(
          'Erreur',
          err.error?.detail ?? 'L\'export des doublons a échoué.',
        );
        return EMPTY;
      }),
      finalize(() => this.isExporting.set(false)),
    ).subscribe((csv: string) => {
      this._downloadCsv(csv, `doublons-${this.sourceId()}.csv`);
      this._snackbar.success('Export', 'Le fichier CSV est téléchargé.');
    });
  }

  public onFilterChange(status: string | null): void {
    // `?? ''` : la croix du `tas-select` notifie `null`, le signal reste en chaîne.
    this.filterStatus.set(status ?? '');
    this.page.set(1);
    this._load();
  }

  public onPageChange(event: PageEvent): void {
    const sizeChanged = event.pageSize !== this.pageSize();
    this.pageSize.set(event.pageSize);
    this.page.set(sizeChanged ? 1 : event.pageIndex + 1);
    this._load();
  }

  public refresh(): void {
    this.page.set(1);
    this._load();
  }

  public openDetail(ing: IngestionDto): void {
    this.newIds.update((ids) => {
      if (!ing.id || !ids.has(ing.id)) return ids;
      const next = new Set(ids);
      next.delete(ing.id);
      return next;
    });
    openIngestionDetail(this._sideDrawer, {
      ingestion: ing,
      canReplay: this.canReplay(),
      isScript: this.isScript(),
    }).closed.subscribe((result) => {
      if (result === 'replay') this.replay(ing);
    });
  }

  public replay(ing: IngestionDto): void {
    this._confirm.confirm({
      title: 'Rejouer cette ingestion ?',
      message:
        `L'ingestion repart dans le pipeline avec la configuration actuelle du mapping. ` +
        `Le serveur traite la demande en arrière-plan : le nouveau statut apparaît après quelques instants.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Rejouer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.replayingId.set(ing.id!);
        this._ingestionsApi.replayIngestion(ing.id!).pipe(
          // Un 422 signale une ingestion non rejouable : le détail du serveur dit
          // pourquoi, un message générique le cacherait.
          catchError((err: HttpErrorResponse) => {
            this._snackbar.error(
              'Erreur',
              err.error?.detail ?? 'Le rejeu de l\'ingestion a échoué.',
            );
            return EMPTY;
          }),
          finalize(() => this.replayingId.set(null)),
        ).subscribe(() => {
          if (ing.id) {
            this.replayRequestedIds.update((ids) => new Set(ids).add(ing.id!));
          }
          // 202 Accepted sans corps : le rejeu est *demandé*, pas abouti. On ne
          // recharge pas la liste dans la foulée — avec un filtre sur
          // Rejeté/Échoué, une ingestion rejouée avec succès en disparaîtrait
          // sans jamais montrer son nouveau statut (FE-30 AC3).
          this._snackbar.info(
            'Rejeu demandé',
            'Le serveur a accepté la demande et retraite l\'ingestion en arrière-plan.',
          );
        });
      },
    });
  }

  // ——— Helpers ———

  public isNew(ing: IngestionDto): boolean {
    return !!ing.id && this.newIds().has(ing.id);
  }

  public isReplayRequested(ing: IngestionDto): boolean {
    return !!ing.id && this.replayRequestedIds().has(ing.id);
  }

  /**
   * Le téléchargement passe par une ancre insérée dans le document : hors
   * Chrome, un `click()` sur une ancre détachée est ignoré, et révoquer l'URL
   * dans la même tâche annule le téléchargement en cours.
   */
  private _downloadCsv(csv: string, filename: string): void {
    const blob = new Blob([csv ?? ''], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /**
   * Onglet masqué, chargement déjà en cours ou liste en erreur : on saute le
   * tour plutôt que d'empiler les requêtes. La page courante est rechargée telle
   * quelle, pour ne pas déplacer l'utilisateur qui lit la page 3.
   */
  private _autoRefreshTick(): void {
    if (this.autoRefreshPaused() || document.hidden) return;
    if (this.isLoading() || this._silentLoadInFlight || this.loadError()) return;
    this._load(true);
  }

  private _load(silent = false): void {
    if (silent) {
      this._silentLoadInFlight = true;
    } else {
      this.isLoading.set(true);
      this.loadError.set(false);
    }
    const status = (this.filterStatus() || undefined) as
      | 'Accepted'
      | 'Rejected'
      | 'Duplicate'
      | 'Failed'
      | undefined;

    this._ingestionsApi.listIngestions(this.sourceId(), status, this.page(), this.pageSize()).pipe(
      // L'appel ne passe pas par `LeadSourcesService` : sans ce message, un 403
      // ou un 500 se lisait « Aucune réception enregistrée. »
      catchError((err: HttpErrorResponse) => {
        if (silent) {
          // Une actualisation automatique ratée ne doit ni effacer la liste
          // affichée ni ouvrir un toast toutes les 15 secondes.
          this.autoRefreshFailed.set(true);
          return EMPTY;
        }
        this._snackbar.error(
          'Erreur',
          err.error?.detail ?? 'Le chargement des réceptions a échoué.',
        );
        this.loadError.set(true);
        this.ingestions.set([]);
        this.totalCount.set(0);
        return EMPTY;
      }),
      finalize(() => {
        if (silent) this._silentLoadInFlight = false;
        else this.isLoading.set(false);
      }),
    ).subscribe((result: PagedResultOfIngestionDto) => {
      const items = result.items ?? [];
      if (silent) {
        const fresh = items.filter((i) => i.id && !this._knownIds.has(i.id)).map((i) => i.id!);
        if (fresh.length) this.newIds.update((ids) => new Set([...ids, ...fresh]));
      }
      for (const item of items) if (item.id) this._knownIds.add(item.id);

      this.ingestions.set(items);
      // Un rejeu abouti sort l'ingestion des statuts rejouables : l'avis
      // « traitement en cours » n'a plus lieu d'être pour cette ligne.
      this.replayRequestedIds.update((ids) => {
        if (ids.size === 0) return ids;
        const next = new Set(ids);
        for (const item of items) {
          if (item.id && !isReplayableIngestion(item)) next.delete(item.id);
        }
        return next;
      });
      this.totalCount.set(result.totalCount ?? 0);
      this.autoRefreshFailed.set(false);
      this.lastRefreshedAt.set(new Date());
    });
  }
}

export default IngestionList;
