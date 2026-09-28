import { Component, inject, input, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { LeadSourcesService } from './lead-sources.service';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  IngestionDto,
  IngestionPayloadDto,
  IngestionDtoPagedResult,
  IngestionsApiService,
} from '@sankore/crm-api';

/**
 * FE-30 — Consulter et rejouer les ingestions d'une source
 */

const STATUS_OPTIONS = [
  { label: 'Tous', value: '' },
  { label: 'Accepté', value: '0' },
  { label: 'Rejeté', value: '1' },
  { label: 'Doublon', value: '2' },
  { label: 'Échoué', value: '3' },
];

/**
 * `IngestionDto.leadId` est un `uuid` non nullable au contrat : une ingestion
 * sans lead renvoie le GUID nul, qui est *truthy*. Sans ce garde-fou, le lien
 * « Voir le lead » menait vers un lead inexistant.
 */
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

@Component({
  selector: 'ingestion-list',
  standalone: true,
  imports: [
    FormsModule, DatePipe, RouterLink,
    TasCard, TasSpinner, TasIcon, TasTag, Button,
    TasFormField, TasLabel, TasSelect,
  ],
  template: `
    <div class="max-w-4xl flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">Réceptions</h2>
          <p class="text-xs text-slate-400 mt-0.5">
            Historique de chaque lead reçu par cette source.
          </p>
        </div>
        <button tas-outlined-button type="button" (click)="refresh()">
          <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
          Rafraîchir
        </button>
      </div>

      <!-- Filter -->
      <div class="flex gap-3">
        <tas-form-field class="w-48">
          <tas-label>Statut</tas-label>
          <tas-select
            [options]="statusOptions"
            optionLabel="label" optionValue="value"
            [ngModel]="filterStatus()" (ngModelChange)="onFilterChange($event)"
          ></tas-select>
        </tas-form-field>
        <div class="flex items-end justify-between gap-2">
          @if (!loadError()) {
            <span class="text-xs text-slate-400">{{ totalCount() }} réception(s)</span>
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

      <!--
        FE-30 AC3 — le rejeu répond 202 sans corps : le serveur retraite en
        arrière-plan. On l'annonce à l'écran plutôt que d'affirmer un résultat
        que le serveur n'a pas confirmé, et on garde la ligne repérable même
        lorsque le filtre courant la fait sortir de la liste.
      -->
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

      @if (isLoading()) {
        <div class="flex justify-center py-12">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <tas-card class="block">
          <!-- Table header -->
          <div class="flex items-center px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-100">
            <div class="w-[18%]">Date</div>
            <div class="w-[18%]">ID externe</div>
            <div class="w-[12%] text-center">Statut</div>
            <div class="w-[30%]">Motif</div>
            <div class="w-[12%]">Lead</div>
            <div class="w-[10%] text-right">Actions</div>
          </div>

          @if (loadError()) {
            <!-- Une panne ne doit pas se lire « Aucune réception enregistrée. » -->
            <div class="flex flex-col items-center py-12 text-center">
              <tas-icon iconName="feather:alert-triangle" class="text-functional-error mb-2" style="font-size:24px"></tas-icon>
              <p class="text-sm text-slate-600">Le chargement des réceptions a échoué.</p>
              <p class="text-xs text-slate-400 mt-0.5">
                La liste n'a pas pu être lue : elle n'est pas forcément vide.
              </p>
              <button tas-outlined-button type="button" class="mt-3" (click)="refresh()">
                Réessayer
              </button>
            </div>
          } @else if (ingestions().length === 0) {
            <div class="flex flex-col items-center py-12 text-center">
              <tas-icon iconName="feather:inbox" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
              <p class="text-sm text-slate-400">Aucune réception enregistrée.</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (ing of ingestions(); track ing.id) {
                <div>
                  <!-- Main row -->
                  <div class="flex items-center px-4 py-3 hover:bg-slate-50 transition-colors">
                    <!-- Date -->
                    <div class="w-[18%] text-xs text-slate-600">
                      {{ ing.ingestedAt | date:'dd/MM/yy HH:mm:ss' }}
                    </div>

                    <!-- External ID -->
                    <div class="w-[18%]">
                      @if (ing.externalId) {
                        <span class="text-xs text-slate-700 font-mono truncate block">{{ ing.externalId }}</span>
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </div>

                    <!-- Status -->
                    <div class="w-[12%] text-center">
                      <tas-tag [severity]="ingestionStatusSeverity(ing.status)">
                        {{ ingestionStatusLabel(ing.status) }}
                      </tas-tag>
                      @if (isReplayRequested(ing)) {
                        <p class="text-[10px] text-blue-500 mt-0.5">Rejeu en cours</p>
                      }
                    </div>

                    <!-- Reason -->
                    <div class="w-[30%]">
                      @if (ing.rejectionReason) {
                        <p class="text-xs text-slate-600 truncate" [title]="ing.rejectionReason">
                          {{ ing.rejectionReason }}
                        </p>
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </div>

                    <!-- Lead link -->
                    <div class="w-[12%]">
                      @if (hasLead(ing)) {
                        <a [routerLink]="['/leads', ing.leadId]"
                           class="text-xs text-primary hover:underline truncate block">
                          Voir le lead
                        </a>
                      } @else {
                        <span class="text-xs text-slate-400">—</span>
                      }
                    </div>

                    <!-- Actions -->
                    <div class="w-[10%] flex justify-end gap-1">
                      @if (canViewPayload()) {
                        <button tas-icon-button type="button"
                                [disabled]="loadingPayloadId() === ing.id"
                                (click)="togglePayload(ing.id!)">
                          @if (loadingPayloadId() === ing.id) {
                            <tas-spinner size="3"></tas-spinner>
                          } @else {
                            <tas-icon [iconName]="expandedId() === ing.id ? 'feather:chevron-up' : 'feather:eye'"
                                      style="font-size:12px" class="text-slate-400"></tas-icon>
                          }
                        </button>
                      }
                      @if (canReplay() && (ing.status === 'Rejected' || ing.status === 'Failed')) {
                        <button tas-icon-button type="button"
                                [disabled]="replayingId() === ing.id"
                                (click)="replay(ing)">
                          @if (replayingId() === ing.id) {
                            <tas-spinner size="3"></tas-spinner>
                          } @else {
                            <tas-icon iconName="feather:rotate-cw" style="font-size:12px" class="text-blue-500"></tas-icon>
                          }
                        </button>
                      }
                    </div>
                  </div>

                  <!-- Expanded payload -->
                  @if (expandedId() === ing.id && expandedPayload()) {
                    <div class="px-4 py-3 bg-slate-50 border-t border-slate-100">
                      <p class="text-[10px] text-slate-400 mb-1">Payload déchiffré</p>
                      <pre class="bg-slate-900 text-green-400 text-[10px] p-3 rounded-lg overflow-auto max-h-60 font-mono whitespace-pre-wrap">{{ expandedPayload() }}</pre>
                    </div>
                  }
                </div>
              }
            </div>
          }

          <!-- Pagination -->
          @if (hasMore() && !loadError()) {
            <div class="p-4 border-t border-slate-100 flex justify-center">
              <button tas-outlined-button type="button" (click)="loadMore()">
                Charger plus
              </button>
            </div>
          }
        </tas-card>
      }
    </div>
  `,
})
export class IngestionList implements OnInit {
  private readonly _ingestionsApi = inject(IngestionsApiService);
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly sourceId = input.required<string>();
  public readonly canViewPayload = input(false);
  /** FE-23 AC2 — statut pre-selectionne lorsqu'on arrive depuis le tableau qualite. */
  public readonly initialStatus = input<string | null>(null);
  public readonly canReplay = input(false);

  public isLoading = signal(true);
  public ingestions = signal<IngestionDto[]>([]);
  public totalCount = signal(0);
  public hasMore = signal(false);
  public filterStatus = signal('');
  public isExporting = signal(false);
  /** Distingue « la liste est vide » de « la liste n'a pas pu être lue ». */
  public loadError = signal(false);

  /** Valeur du statut « Doublon » dans le filtre (enum numerique de l'API). */
  public readonly DUPLICATE_STATUS = '2';

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

  // Expand payload
  public expandedId = signal<string | null>(null);
  public expandedPayload = signal<string | null>(null);
  public loadingPayloadId = signal<string | null>(null);

  // Replay
  public replayingId = signal<string | null>(null);
  /** Ingestions dont le rejeu a été accepté (202) mais pas encore observé. */
  public replayRequestedIds = signal<ReadonlySet<string>>(new Set<string>());
  public readonly replayRequestedCount = computed(() => this.replayRequestedIds().size);

  public readonly statusOptions = STATUS_OPTIONS;

  private _page = 1;

  ngOnInit(): void {
    const initial = this.initialStatus();
    if (initial) this.filterStatus.set(initial);
    this._load(true);
  }

  public onFilterChange(status: string): void {
    this.filterStatus.set(status);
    this._page = 1;
    this._load(true);
  }

  public refresh(): void {
    this._page = 1;
    this._load(true);
  }

  public loadMore(): void {
    this._page++;
    this._load(false);
  }

  public togglePayload(id: string): void {
    if (this.expandedId() === id) {
      this.expandedId.set(null);
      this.expandedPayload.set(null);
      return;
    }

    this.loadingPayloadId.set(id);
    this._ingestionsApi.getIngestionPayload(id).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de charger le payload.');
        this.loadingPayloadId.set(null);
        return EMPTY;
      }),
    ).subscribe((payload: IngestionPayloadDto) => {
      this.expandedId.set(id);
      try {
        this.expandedPayload.set(
          JSON.stringify(JSON.parse(payload.rawPayloadJson ?? '{}'), null, 2),
        );
      } catch {
        this.expandedPayload.set(payload.rawPayloadJson ?? '');
      }
      this.loadingPayloadId.set(null);
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

  /** Une ingestion sans lead renvoie le GUID nul, non nul au contrat. */
  public hasLead(ing: IngestionDto): boolean {
    return !!ing.leadId && ing.leadId !== EMPTY_GUID;
  }

  public isReplayRequested(ing: IngestionDto): boolean {
    return !!ing.id && this.replayRequestedIds().has(ing.id);
  }

  public ingestionStatusLabel(status: string | undefined): string {
    switch (status) {
      case 'Accepted': return 'Accepté';
      case 'Rejected': return 'Rejeté';
      case 'Duplicate': return 'Doublon';
      case 'Failed': return 'Échoué';
      default: return status ?? '—';
    }
  }

  public ingestionStatusSeverity(status: string | undefined): Severity {
    switch (status) {
      case 'Accepted': return 'success';
      case 'Rejected': return 'error';
      case 'Duplicate': return 'warning';
      case 'Failed': return 'error';
      default: return 'neutral';
    }
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

  private _load(reset: boolean): void {
    if (reset) {
      this.isLoading.set(true);
      this.loadError.set(false);
    }
    const statusNum = this.filterStatus()
      ? (Number(this.filterStatus()) as 0 | 1 | 2 | 3)
      : undefined;

    this._ingestionsApi.listIngestions(this.sourceId(), statusNum, this._page, 25).pipe(
      // L'appel ne passe pas par `LeadSourcesService` : sans ce message, un 403
      // ou un 500 se lisait « Aucune réception enregistrée. »
      catchError((err: HttpErrorResponse) => {
        this._snackbar.error(
          'Erreur',
          err.error?.detail ?? 'Le chargement des réceptions a échoué.',
        );
        if (reset) {
          this.loadError.set(true);
          this.ingestions.set([]);
          this.totalCount.set(0);
          this.hasMore.set(false);
        } else {
          // Sans ce retour en arrière, le clic suivant sur « Charger plus »
          // sauterait silencieusement la page qui vient d'échouer.
          this._page = Math.max(1, this._page - 1);
        }
        return EMPTY;
      }),
      finalize(() => this.isLoading.set(false)),
    ).subscribe((result: IngestionDtoPagedResult) => {
      const items = result.items ?? [];
      if (reset) {
        this.ingestions.set(items);
        // Un rejeu abouti sort l'ingestion des statuts rejouables : l'avis
        // « traitement en cours » n'a plus lieu d'être pour cette ligne.
        this.replayRequestedIds.update((ids) => {
          if (ids.size === 0) return ids;
          const next = new Set(ids);
          for (const item of items) {
            if (item.id && item.status !== 'Rejected' && item.status !== 'Failed') {
              next.delete(item.id);
            }
          }
          return next;
        });
      } else {
        this.ingestions.update((prev) => [...prev, ...items]);
      }
      this.totalCount.set(result.totalCount ?? 0);
      this.hasMore.set(result.hasNextPage ?? false);
    });
  }
}

export default IngestionList;
