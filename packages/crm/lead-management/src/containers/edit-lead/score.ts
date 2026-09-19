import { Component, effect, inject, input, signal } from '@angular/core';
import { catchError, EMPTY, finalize } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { Button } from '@talisoft/ui/button';
import { TimeagoPipe } from '@talisoft/ui/timeago';
import { SnackbarService } from '@talisoft/ui/snackbar';
import { LeadsApiService, LeadDto, ScoreHistoryDto } from '@sankore/crm-api';

@Component({
  selector: 'lead-score',
  imports: [TasCard, TasSpinner, TasIcon, Button, TimeagoPipe],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else {
      <div class="pb-6 flex flex-col gap-4">

        <!-- Current score -->
        <tas-card>
          <div class="p-4">
            <div class="flex items-center justify-between mb-4">
              <p class="font-semibold text-slate-800">Score actuel</p>
              <button
                tas-outlined-button
                color="primary"
                type="button"
                (click)="recalculate()"
                [disabled]="isRecalculating()"
              >
                @if (isRecalculating()) {
                  <tas-spinner size="3" class="text-primary"></tas-spinner>
                } @else {
                  <tas-icon iconName="feather:refresh-cw" style="font-size:14px"></tas-icon>
                }
                Recalculer
              </button>
            </div>
            <div class="flex items-end gap-2">
              <span class="text-4xl font-bold text-slate-900 tabular-nums leading-none">
                {{ lead()?.score ?? 0 }}
              </span>
              <span class="text-sm text-slate-400 mb-1">/ 100</span>
            </div>
            <div class="mt-3 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                [class]="scoreBarColor(lead()?.score ?? 0)"
                [style.width.%]="lead()?.score ?? 0"
              ></div>
            </div>
          </div>
        </tas-card>

        <!-- Score history -->
        <tas-card>
          <div class="p-4 border-b border-slate-100">
            <p class="font-semibold text-slate-800">Historique du score</p>
            <p class="text-sm text-slate-500 mt-0.5">Évolution dans le temps</p>
          </div>

          @if (history().length === 0) {
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <tas-icon iconName="feather:bar-chart-2" class="text-slate-300 mb-2" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400">Aucun historique de score</p>
            </div>
          } @else {
            <div class="divide-y divide-slate-100">
              @for (entry of history(); track entry.id; let i = $index) {
                <div class="p-4 flex items-center gap-4">
                  <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold tabular-nums"
                    [class]="scoreCircleColor(entry.score ?? 0)"
                  >
                    {{ entry.score }}
                  </div>
                  <div class="flex-1 min-w-0">
                    @if (entry.triggerEvent) {
                      <p class="text-sm text-slate-700">{{ entry.triggerEvent }}</p>
                    }
                    @if (entry.recalculatedAt) {
                      <p class="text-xs text-slate-400 mt-0.5">{{ entry.recalculatedAt | dateTimeAgo }}</p>
                    }
                  </div>
                  @if (i > 0 && history()[i - 1].score != null) {
                    @let delta = (entry.score ?? 0) - (history()[i - 1].score ?? 0);
                    @if (delta !== 0) {
                      <span
                        class="text-xs font-semibold tabular-nums shrink-0"
                        [class]="delta > 0 ? 'text-green-600' : 'text-red-600'"
                      >
                        {{ delta > 0 ? '+' : '' }}{{ delta }}
                      </span>
                    }
                  }
                </div>
              }
            </div>
          }
        </tas-card>

      </div>
    }
  `,
})
export class LeadScorePage {
  private readonly _leadsApiService = inject(LeadsApiService);
  private readonly _snackbar = inject(SnackbarService);

  public readonly id = input.required<string>();

  public isLoading = signal(true);
  public isRecalculating = signal(false);
  public lead = signal<LeadDto | null>(null);
  public history = signal<ScoreHistoryDto[]>([]);

  constructor() {
    effect(() => {
      this._load();
    });
  }

  public recalculate(): void {
    this.isRecalculating.set(true);
    this._leadsApiService.recalculateLeadScore(this.id()).pipe(
      catchError(() => {
        this._snackbar.error('Erreur', 'Impossible de recalculer le score.');
        return EMPTY;
      }),
      finalize(() => this.isRecalculating.set(false)),
    ).subscribe((res) => {
      this._snackbar.success('Score recalculé', `Nouveau score : ${res.newScore}`);
      this._load();
    });
  }

  public scoreBarColor(score: number): string {
    if (score >= 70) return 'bg-green-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-red-400';
  }

  public scoreCircleColor(score: number): string {
    if (score >= 70) return 'bg-green-100 text-green-700';
    if (score >= 40) return 'bg-amber-100 text-amber-700';
    return 'bg-red-100 text-red-700';
  }

  private _load(): void {
    this.isLoading.set(true);
    this._leadsApiService.getLead(this.id()).pipe(
      catchError(() => {
        this.isLoading.set(false);
        return EMPTY;
      }),
    ).subscribe((lead) => {
      this.lead.set(lead);
      this._leadsApiService.getLeadScoreHistory(this.id()).pipe(
        catchError(() => EMPTY),
      ).subscribe((history) => {
        this.history.set(history ?? []);
        this.isLoading.set(false);
      });
    });
  }
}

export default LeadScorePage;
