import { Component, effect, inject, input, signal } from '@angular/core';
import { NgClass } from '@angular/common';
import { forkJoin } from 'rxjs';
import { TasCard } from '@talisoft/ui/card';
import { TasSpinner } from '@talisoft/ui/spinner';
import { TasIcon } from '@talisoft/ui/icon';
import { TasTag } from '@talisoft/ui/tag';
import {
  StepBottleneckDto,
  StepStatsDto,
  TemplateStatsDto,
  WorkflowAnalyticsApiService,
} from '@sankore/crm-api';

const STATUS_LABELS: Record<string, string> = {
  InProgress: 'En cours',
  Completed: 'Terminé',
  Rejected: 'Rejeté',
  Cancelled: 'Annulé',
  TimedOut: 'Expiré',
};

function statusLabel(key: string): string {
  return STATUS_LABELS[key] ?? key;
}

function scoreColor(score: number | undefined): string {
  if (!score) return 'text-slate-400';
  if (score >= 0.7) return 'text-red-600';
  if (score >= 0.4) return 'text-amber-600';
  return 'text-green-600';
}

function pct(n: number | undefined): string {
  if (!n) return '0%';
  return `${Math.round(n * 100)}%`;
}

function hours(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n < 1) return `${Math.round(n * 60)} min`;
  return `${n.toFixed(1)} h`;
}

@Component({
  selector: 'workflow-analytics',
  imports: [NgClass, TasCard, TasSpinner, TasIcon, TasTag],
  template: `
    @if (isLoading()) {
      <div class="flex justify-center py-24">
        <tas-spinner size="10" class="text-primary"></tas-spinner>
      </div>
    } @else if (stats()) {
      <div class="pb-6 flex flex-col gap-4">

        <!-- KPI cards -->
        <div class="grid grid-cols-3 gap-4">
          <tas-card>
            <div class="p-4 flex flex-col gap-1">
              <p class="text-xs text-slate-400">Instances totales</p>
              <p class="text-2xl font-semibold text-slate-800 tabular-nums">
                {{ stats()!.totalInstances ?? 0 }}
              </p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4 flex flex-col gap-1">
              <p class="text-xs text-slate-400">Durée moyenne</p>
              <p class="text-2xl font-semibold text-slate-800 tabular-nums">
                {{ avgCompletionLabel() }}
              </p>
            </div>
          </tas-card>
          <tas-card>
            <div class="p-4 flex flex-col gap-1">
              <p class="text-xs text-slate-400">Dépassements SLA</p>
              <p class="text-2xl font-semibold tabular-nums"
                [class.text-red-600]="(stats()!.slaBreachCount ?? 0) > 0"
                [class.text-slate-800]="(stats()!.slaBreachCount ?? 0) === 0"
              >
                {{ stats()!.slaBreachCount ?? 0 }}
              </p>
            </div>
          </tas-card>
        </div>

        <!-- Status breakdown -->
        @if (statusEntries().length > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Répartition par statut</p>
            </div>
            <div class="p-4 flex flex-wrap gap-3">
              @for (entry of statusEntries(); track entry.key) {
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 min-w-[110px]">
                  <div class="flex flex-col">
                    <span class="text-xs text-slate-400">{{ statusLabel(entry.key) }}</span>
                    <span class="text-lg font-semibold text-slate-800 tabular-nums">{{ entry.count }}</span>
                  </div>
                </div>
              }
            </div>
          </tas-card>
        }

        <!-- Bottlenecks -->
        @if (bottlenecks().length > 0) {
          <tas-card>
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Goulots d'étranglement</p>
              <p class="text-xs text-slate-400 mt-0.5">Étapes classées par score de blocage (durée × taux de rejet × taux d'expiration).</p>
            </div>
            <div class="divide-y divide-slate-100">
              @for (b of bottlenecks(); track b.stepDefinitionId) {
                <div class="flex items-center gap-4 px-4 py-3">
                  <div class="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-[10px] font-semibold flex items-center justify-center shrink-0">
                    {{ b.order }}
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-slate-800 truncate">{{ b.stepName || '(étape)' }}</p>
                    <div class="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                      <span>{{ b.totalExecutions ?? 0 }} exéc.</span>
                      <span>Rejet : {{ pct(b.rejectionRate) }}</span>
                      <span>Expiration : {{ pct(b.timeoutRate) }}</span>
                      <span>Durée moy. : {{ hours(b.avgDurationHours) }}</span>
                    </div>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="text-sm font-semibold tabular-nums" [ngClass]="scoreColor(b.bottleneckScore)">
                      {{ ((b.bottleneckScore ?? 0) * 100).toFixed(0) }}
                    </p>
                    <p class="text-[10px] text-slate-400">score</p>
                  </div>
                </div>
              }
            </div>
          </tas-card>
        }

        <!-- Step performance table -->
        @if (stats()!.stepStats?.length) {
          <tas-card>
            <div class="p-4 border-b border-slate-100">
              <p class="text-sm font-semibold text-slate-700">Performance par étape</p>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-xs text-slate-400 border-b border-slate-100">
                    <th class="px-4 py-2 text-left font-medium">Étape</th>
                    <th class="px-4 py-2 text-right font-medium">Durée moy.</th>
                    <th class="px-4 py-2 text-right font-medium">Terminés</th>
                    <th class="px-4 py-2 text-right font-medium">Rejetés</th>
                    <th class="px-4 py-2 text-right font-medium">Expirés</th>
                    <th class="px-4 py-2 text-right font-medium">Sautés</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                  @for (s of stats()!.stepStats!; track s.stepDefinitionId) {
                    <tr class="hover:bg-slate-50 transition-colors">
                      <td class="px-4 py-2.5 text-slate-800 font-medium">{{ s.stepName || '—' }}</td>
                      <td class="px-4 py-2.5 text-slate-500 text-right tabular-nums">{{ hours(s.avgDurationHours) }}</td>
                      <td class="px-4 py-2.5 text-slate-500 text-right tabular-nums">{{ s.completedCount ?? 0 }}</td>
                      <td class="px-4 py-2.5 text-right tabular-nums"
                        [class.text-red-500]="(s.rejectedCount ?? 0) > 0"
                        [class.text-slate-400]="(s.rejectedCount ?? 0) === 0"
                      >{{ s.rejectedCount ?? 0 }}</td>
                      <td class="px-4 py-2.5 text-right tabular-nums"
                        [class.text-amber-500]="(s.timedOutCount ?? 0) > 0"
                        [class.text-slate-400]="(s.timedOutCount ?? 0) === 0"
                      >{{ s.timedOutCount ?? 0 }}</td>
                      <td class="px-4 py-2.5 text-slate-400 text-right tabular-nums">{{ s.skippedCount ?? 0 }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </tas-card>
        }

        @if ((stats()!.totalInstances ?? 0) === 0) {
          <tas-card>
            <div class="p-8 text-center">
              <tas-icon iconName="feather:bar-chart-2" class="text-slate-300" style="font-size:32px"></tas-icon>
              <p class="text-sm text-slate-400 mt-3">Aucune donnée disponible. Lancez des instances pour voir les statistiques.</p>
            </div>
          </tas-card>
        }

      </div>
    }
  `,
})
export class WorkflowAnalyticsPage {
  private readonly _analyticsApi = inject(WorkflowAnalyticsApiService);

  public readonly id = input.required<string>();
  public readonly statusLabel = statusLabel;
  public readonly scoreColor = scoreColor;
  public readonly pct = pct;
  public readonly hours = hours;

  public isLoading = signal(true);
  public stats = signal<TemplateStatsDto | null>(null);
  public bottlenecks = signal<StepBottleneckDto[]>([]);
  public statusEntries = signal<{ key: string; count: number }[]>([]);

  public avgCompletionLabel = () => hours(this.stats()?.avgCompletionHours);

  constructor() {
    effect(() => {
      this.isLoading.set(true);
      forkJoin({
        stats: this._analyticsApi.getTemplateStats(this.id()),
        bottlenecks: this._analyticsApi.getBottlenecks(this.id()),
      }).subscribe({
        next: ({ stats, bottlenecks }) => {
          this.stats.set(stats);
          this.bottlenecks.set(
            [...(bottlenecks ?? [])].sort((a, b) => (b.bottleneckScore ?? 0) - (a.bottleneckScore ?? 0)),
          );
          const byStatus = stats.byStatus ?? {};
          this.statusEntries.set(
            Object.entries(byStatus)
              .map(([key, count]) => ({ key, count: count as number }))
              .sort((a, b) => b.count - a.count),
          );
          this.isLoading.set(false);
        },
        error: () => this.isLoading.set(false),
      });
    });
  }
}

export default WorkflowAnalyticsPage;
