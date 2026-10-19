import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatNumber } from './report-labels';

export interface BarItem {
  key: string;
  label: string;
  /** Première valeur, toujours affichée. */
  value: number;
  /** Seconde valeur facultative (barres appariées), à la même échelle que la première. */
  value2?: number;
  /** Texte d'appoint à droite, par exemple un taux : « 32 % convertis ». */
  note?: string;
}

/**
 * Barres horizontales, une ligne par catégorie — la forme qui se lit le mieux pour comparer des
 * quantités dont les libellés sont longs (étapes, sources, agences).
 *
 * Simple ou appariée : avec `value2`, chaque ligne porte deux barres fines à la même échelle,
 * séparées par un écart de 2 px. Chaque valeur est écrite en clair à côté de sa barre, si bien que
 * la couleur n'est jamais seule à porter l'information, et la ligne survolée se met en avant.
 */
@Component({
  selector: 'report-bar-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (paired()) {
      <div class="mb-3 flex flex-wrap items-center gap-4 text-xs text-slate-600" aria-hidden="true">
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm" [style.background]="color()"></span>{{ name() }}</span>
        <span class="flex items-center gap-1.5"><span class="size-2.5 rounded-sm" [style.background]="color2()"></span>{{ name2() }}</span>
      </div>
    }
    @if (rows().length === 0) {
      <p class="py-6 text-center text-sm text-slate-500">Aucune donnée sur la période.</p>
    } @else {
      <ul class="flex flex-col gap-2.5">
        @for (r of rows(); track r.key) {
          <li class="group grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-slate-50"
              [attr.aria-label]="r.aria">
            <span class="truncate text-sm text-slate-700" [title]="r.label">{{ r.label }}</span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="flex items-center gap-2">
                <span class="h-2.5 rounded-r-[4px] transition-opacity group-hover:opacity-90"
                      [style.width.%]="r.w" [style.min-width.px]="r.value > 0 ? 3 : 0" [style.background]="color()"></span>
                <span class="text-xs font-semibold tabular-nums text-slate-800">{{ r.text }}</span>
                @if (!paired() && r.note) {
                  <span class="text-xs text-slate-500">{{ r.note }}</span>
                }
              </span>
              @if (paired()) {
                <span class="flex items-center gap-2">
                  <span class="h-2.5 rounded-r-[4px]" [style.width.%]="r.w2" [style.min-width.px]="r.value2 > 0 ? 3 : 0" [style.background]="color2()"></span>
                  <span class="text-xs font-semibold tabular-nums text-slate-800">{{ r.text2 }}</span>
                  @if (r.note) {
                    <span class="text-xs text-slate-500">{{ r.note }}</span>
                  }
                </span>
              }
            </span>
          </li>
        }
      </ul>
    }
  `,
})
export class ReportBarList {
  public readonly items = input.required<BarItem[]>();
  public readonly color = input('#2a78d6');
  public readonly color2 = input('#eb6834');
  /** Noms des deux valeurs, pour la légende et la lecture d'écran des barres appariées. */
  public readonly name = input('Valeur');
  public readonly name2 = input('');

  public readonly paired = computed(() => this.items().some((i) => i.value2 !== undefined));

  public readonly rows = computed(() => {
    const items = this.items();
    const max = Math.max(1, ...items.flatMap((i) => [i.value, i.value2 ?? 0]));
    return items.map((i) => ({
      ...i,
      value2: i.value2 ?? 0,
      w: (i.value / max) * 88,
      w2: ((i.value2 ?? 0) / max) * 88,
      text: formatNumber(i.value),
      text2: formatNumber(i.value2 ?? 0),
      aria: this.paired()
        ? `${i.label} : ${this.name()} ${formatNumber(i.value)}, ${this.name2()} ${formatNumber(i.value2 ?? 0)}${i.note ? ', ' + i.note : ''}`
        : `${i.label} : ${formatNumber(i.value)}${i.note ? ', ' + i.note : ''}`,
    }));
  });
}
