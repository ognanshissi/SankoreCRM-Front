import { Component, inject, input, signal, computed, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { TasFormField, TasLabel } from '@talisoft/ui/form-field';
import { TasSelect } from '@talisoft/ui/select';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import {
  IngestionDto,
  IngestionDtoStatusEnum,
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
        <div class="flex items-end">
          <span class="text-xs text-slate-400">{{ totalCount() }} réception(s)</span>
        </div>
      </div>

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

          @if (ingestions().length === 0) {
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
                      @if (ing.leadId) {
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
          @if (hasMore()) {
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
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly sourceId = input.required<string>();
  public readonly canViewPayload = input(false);
  public readonly canReplay = input(false);

  public isLoading = signal(true);
  public ingestions = signal<IngestionDto[]>([]);
  public totalCount = signal(0);
  public hasMore = signal(false);
  public filterStatus = signal('');

  // Expand payload
  public expandedId = signal<string | null>(null);
  public expandedPayload = signal<string | null>(null);
  public loadingPayloadId = signal<string | null>(null);

  // Replay
  public replayingId = signal<string | null>(null);

  public readonly statusOptions = STATUS_OPTIONS;

  private _page = 1;

  ngOnInit(): void {
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
      message: `L'ingestion sera retraitée avec la configuration actuelle du mapping.`,
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Rejouer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.replayingId.set(ing.id!);
        this._ingestionsApi.replayIngestion(ing.id!).pipe(
          catchError(() => {
            this._snackbar.error('Erreur', 'Impossible de rejouer l\'ingestion.');
            this.replayingId.set(null);
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Rejouée', 'L\'ingestion a été retraitée.');
          this.replayingId.set(null);
          this.refresh();
        });
      },
    });
  }

  // ——— Helpers ———

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

  private _load(reset: boolean): void {
    if (reset) this.isLoading.set(true);
    const statusNum = this.filterStatus() ? Number(this.filterStatus()) as any : undefined;

    this._ingestionsApi.listIngestions(this.sourceId(), statusNum, this._page, 25).pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((result: IngestionDtoPagedResult) => {
      const items = result.items ?? [];
      if (reset) {
        this.ingestions.set(items);
      } else {
        this.ingestions.update((prev) => [...prev, ...items]);
      }
      this.totalCount.set(result.totalCount ?? 0);
      this.hasMore.set(result.hasNextPage ?? false);
      this.isLoading.set(false);
    });
  }
}

export default IngestionList;
