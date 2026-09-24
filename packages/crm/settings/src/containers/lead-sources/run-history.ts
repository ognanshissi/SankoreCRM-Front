import { Component, inject, input, signal, OnInit } from '@angular/core';
import { catchError, EMPTY } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag, Severity } from '@talisoft/ui/tag';
import { Button } from '@talisoft/ui/button';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { ConfirmDialogService } from '@talisoft/ui/confirm-dialog';
import { RunDto } from '@sankore/crm-api';
import { LeadSourcesService } from './lead-sources.service';
import { DatePipe } from '@angular/common';

/**
 * FE-22 — Consulter l'historique des exécutions
 */
@Component({
  selector: 'run-history',
  standalone: true,
  imports: [TasCard, TasSpinner, TasIcon, TasTag, Button, DatePipe],
  template: `
    <div class="max-w-4xl flex flex-col gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-sm font-semibold text-slate-700">Historique des exécutions</h2>
          <p class="text-xs text-slate-400 mt-0.5">Chaque collecte planifiée, manuelle ou test est enregistrée.</p>
        </div>
        <div class="flex items-center gap-2">
          <button tas-outlined-button type="button" (click)="refresh()">
            <tas-icon iconName="feather:refresh-cw" style="font-size:12px"></tas-icon>
            Rafraîchir
          </button>
          @if (canPull()) {
            <button tas-raised-button color="primary" type="button"
                    [disabled]="isPulling()"
                    [isLoading]="isPulling()"
                    (click)="launchManualPull()">
              <tas-icon iconName="feather:download-cloud" style="font-size:14px"></tas-icon>
              Lancer maintenant
            </button>
          }
        </div>
      </div>

      @if (isLoading()) {
        <div class="flex justify-center py-12">
          <tas-spinner size="8" class="text-primary"></tas-spinner>
        </div>
      } @else {
        <!-- Table -->
        <tas-card class="block">
          <div class="flex items-center px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-100">
            <div class="w-[15%]">Type</div>
            <div class="w-[15%]">Début</div>
            <div class="w-[10%] text-right">Durée</div>
            <div class="w-[10%] text-center">Résultat</div>
            <div class="w-[10%] text-right">Récupérés</div>
            <div class="w-[10%] text-right">Créés</div>
            <div class="w-[10%] text-right">Doublons</div>
            <div class="w-[10%] text-right">Rejetés</div>
            <div class="w-[10%]"></div>
          </div>

          @if (runs().length === 0) {
            <div class="flex flex-col items-center py-12 text-center">
              <tas-icon iconName="feather:clock" class="text-slate-300 mb-2" style="font-size:24px"></tas-icon>
              <p class="text-sm text-slate-400">Aucune exécution enregistrée.</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (run of runs(); track run.id) {
                <div class="flex items-center px-4 py-3 hover:bg-slate-50 transition-colors">
                  <!-- Type -->
                  <div class="w-[15%]">
                    <tas-tag [severity]="runTypeSeverity(run.runType)">
                      {{ runTypeLabel(run.runType) }}
                    </tas-tag>
                  </div>

                  <!-- Start -->
                  <div class="w-[15%] text-xs text-slate-600">
                    {{ run.startedAt | date:'dd/MM/yy HH:mm' }}
                  </div>

                  <!-- Duration -->
                  <div class="w-[10%] text-right text-xs text-slate-500">
                    {{ duration(run) }}
                  </div>

                  <!-- Status -->
                  <div class="w-[10%] text-center">
                    @switch (run.status) {
                      @case ('Running') {
                        <tas-spinner size="3" class="text-primary"></tas-spinner>
                      }
                      @case ('Completed') {
                        <tas-icon iconName="feather:check-circle" class="text-green-500" style="font-size:14px"></tas-icon>
                      }
                      @case ('Failed') {
                        <tas-icon iconName="feather:x-circle" class="text-red-500" style="font-size:14px"></tas-icon>
                      }
                    }
                  </div>

                  <!-- Counts -->
                  <div class="w-[10%] text-right text-xs text-slate-700 font-medium">{{ run.fetchedCount ?? 0 }}</div>
                  <div class="w-[10%] text-right text-xs text-green-600 font-medium">{{ run.ingestedCount ?? 0 }}</div>
                  <div class="w-[10%] text-right text-xs text-amber-600">{{ run.duplicateCount ?? 0 }}</div>
                  <div class="w-[10%] text-right text-xs text-red-500">{{ run.rejectedCount ?? 0 }}</div>

                  <!-- Expand error -->
                  <div class="w-[10%] flex justify-end">
                    @if (run.status === 'Failed') {
                      <button tas-icon-button type="button"
                              (click)="toggleExpand(run.id!)">
                        <tas-icon [iconName]="expandedId() === run.id ? 'feather:chevron-up' : 'feather:chevron-down'"
                                  style="font-size:12px"></tas-icon>
                      </button>
                    }
                  </div>
                </div>

                <!-- Error detail (expanded) -->
                @if (expandedId() === run.id && run.errorMessage) {
                  <div class="px-4 py-3 bg-red-50 border-t border-red-100">
                    <p class="text-xs text-red-700 font-mono whitespace-pre-wrap">{{ run.errorMessage }}</p>
                  </div>
                }
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
export class RunHistory implements OnInit {
  private readonly _sourcesService = inject(LeadSourcesService);
  private readonly _snackbar = inject(SnackbarService);
  private readonly _confirm = inject(ConfirmDialogService);

  public readonly sourceId = input.required<string>();
  public readonly sourceStatus = input<string | null>(null);
  public readonly canPull = input(true);

  public isLoading = signal(true);
  public isPulling = signal(false);
  public runs = signal<RunDto[]>([]);
  public hasMore = signal(false);
  public expandedId = signal<string | null>(null);
  private _page = 1;

  ngOnInit(): void {
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

  public toggleExpand(id: string): void {
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  public launchManualPull(): void {
    this._confirm.confirm({
      title: 'Lancer une collecte manuelle ?',
      message: 'Une exécution manuelle sera démarrée immédiatement et apparaîtra en tête de liste.',
      closable: true,
      showCancelButton: true,
      acceptButtonProps: { label: 'Lancer', theme: 'primary' },
      rejectButtonProps: { label: 'Annuler' },
      accept: () => {
        this.isPulling.set(true);
        this._sourcesService.manualPull(this.sourceId()).pipe(
          catchError(() => {
            this.isPulling.set(false);
            return EMPTY;
          }),
        ).subscribe(() => {
          this._snackbar.success('Collecte lancée', 'L\'exécution est en cours.');
          this.isPulling.set(false);
          this.refresh();
        });
      },
    });
  }

  // ——— Helpers ———

  public runTypeLabel(type: string | undefined): string {
    switch (type) {
      case 'Scheduled': return 'Planifiée';
      case 'ManualPull': return 'Manuelle';
      case 'DryRun': return 'Test';
      case 'InstallCheck': return 'Vérification';
      default: return type ?? '—';
    }
  }

  public runTypeSeverity(type: string | undefined): Severity {
    switch (type) {
      case 'Scheduled': return 'neutral';
      case 'ManualPull': return 'info';
      case 'DryRun': return 'warning';
      case 'InstallCheck': return 'neutral';
      default: return 'neutral';
    }
  }

  public duration(run: RunDto): string {
    if (!run.startedAt || !run.completedAt) return run.status === 'Running' ? 'En cours…' : '—';
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  private _load(reset: boolean): void {
    if (reset) this.isLoading.set(true);
    this._sourcesService.listRuns(this.sourceId(), this._page, 20).pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((result) => {
      const items = result.items ?? [];
      if (reset) {
        this.runs.set(items);
      } else {
        this.runs.update((prev) => [...prev, ...items]);
      }
      this.hasMore.set(result.hasNextPage ?? false);
      this.isLoading.set(false);
    });
  }
}

export default RunHistory;
