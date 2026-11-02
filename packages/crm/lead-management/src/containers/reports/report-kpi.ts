import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TasIcon } from '@talisoft/ui/icon';

/** Le sens dans lequel un chiffre s'améliore : plus de conversions, mais un délai plus court. */
export type Better = 'up' | 'down';

export interface KpiDelta {
  /** « +25 % », « −3,2 pts », « = ». */
  text: string;
  direction: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'neutral';
  /** La valeur de la période précédente, déjà formatée — pour l'infobulle. */
  previous: string;
}

export interface Kpi {
  label: string;
  value: string;
  hint: string;
  tone?: 'warn';
  /** Absent pour un chiffre « aujourd'hui », qui n'a pas de période précédente. */
  delta?: KpiDelta | null;
}

const pctFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const ptsFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const countFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

function build(diff: number, text: string, better: Better, previous: string): KpiDelta {
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const tone = direction === 'flat' ? 'neutral' : direction === better ? 'good' : 'bad';
  return { text: direction === 'flat' ? '=' : text, direction, tone, previous };
}

/**
 * Variation d'un nombre ou d'une durée, en pourcentage de la période précédente. Partant de zéro,
 * un pourcentage n'a pas de sens : la variation est donnée en valeur (« +5 »).
 */
export function relativeDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  better: Better,
  formatPrevious: (n: number) => string,
): KpiDelta | null {
  if (current == null || previous == null) return null;
  if (previous === 0) {
    const diff = current;
    return build(diff, `${diff > 0 ? '+' : '−'}${countFormat.format(Math.abs(diff))}`, better, formatPrevious(previous));
  }
  const change = Math.round(((current - previous) / previous) * 100);
  return build(change, `${change > 0 ? '+' : '−'}${pctFormat.format(Math.abs(change))} %`, better, formatPrevious(previous));
}

/** Variation d'un taux, en points : passer de 40 % à 50 % fait « +10 pts », pas « +25 % ». */
export function pointsDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  better: Better,
  formatPrevious: (n: number) => string,
): KpiDelta | null {
  if (current == null || previous == null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  return build(diff, `${diff > 0 ? '+' : '−'}${ptsFormat.format(Math.abs(diff))} pts`, better, formatPrevious(previous));
}

/** La rangée d'indicateurs d'un onglet des rapports, chacun avec sa variation. */
@Component({
  selector: 'report-kpi-tiles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TasIcon],
  template: `
    <section aria-label="Indicateurs clés" class="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
      @for (k of kpis(); track k.label) {
        <div class="flex flex-col gap-1 rounded-2xl border border-slate-100 bg-white p-4 shadow-xs">
          <span class="text-xs font-medium text-slate-500">{{ k.label }}</span>
          <span class="flex items-center gap-1.5 text-2xl font-bold tabular-nums"
                [class]="k.tone === 'warn' ? 'text-[#b4532a]' : 'text-slate-800'">
            @if (k.tone === 'warn') {
              <tas-icon iconName="feather:alert-triangle" style="font-size: 16px" aria-hidden="true"></tas-icon>
            }
            {{ k.value }}
          </span>
          @if (k.delta; as d) {
            <span class="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                  [class]="d.tone === 'good' ? 'bg-emerald-50 text-emerald-800'
                    : d.tone === 'bad' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-600'"
                  [title]="'Période précédente : ' + d.previous">
              <span aria-hidden="true">{{ d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '' }}</span>
              {{ d.text }}
              <span class="sr-only">par rapport à la période précédente ({{ d.previous }})</span>
            </span>
          }
          <span class="text-xs text-slate-500">{{ k.hint }}</span>
        </div>
      }
    </section>
  `,
})
export class ReportKpiTiles {
  public readonly kpis = input<Kpi[]>([]);
}
