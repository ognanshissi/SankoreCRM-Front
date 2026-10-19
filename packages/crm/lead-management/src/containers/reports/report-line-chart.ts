import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { formatNumber } from './report-labels';

export interface LineSeries {
  name: string;
  color: string;
}

export interface LinePoint {
  /** Libellé long, pour l'infobulle et le tableau : « lun. 5 oct. 2026 ». */
  label: string;
  /** Libellé court sous l'axe : « 5 oct. ». */
  tick: string;
  values: number[];
}

const HEIGHT = 260;
const PAD = { top: 16, right: 96, bottom: 28, left: 40 };

/**
 * Courbes sur un axe unique, en SVG dessiné à la main : le projet n'embarque aucune bibliothèque
 * de graphes, et deux séries n'en justifient pas une.
 *
 * Conventions suivies : traits de 2 px, grille et axes discrets, légende (≥ 2 séries) ET libellé
 * direct en fin de courbe, réticule + infobulle au survol sur toute la hauteur (cible plus large
 * que le trait), et un tableau des valeurs pour qui ne lit pas le graphe.
 */
@Component({
  selector: 'report-line-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-4 text-xs text-slate-600" aria-hidden="true">
        @for (s of series(); track s.name) {
          <span class="flex items-center gap-1.5">
            <span class="h-0.5 w-4 rounded-full" [style.background]="s.color"></span>{{ s.name }}
          </span>
        }
      </div>

      <div #host class="relative w-full">
        <svg
          [attr.width]="width()"
          [attr.height]="height"
          [attr.viewBox]="'0 0 ' + width() + ' ' + height"
          role="img"
          [attr.aria-label]="ariaLabel()"
          class="block overflow-visible"
          (mouseleave)="hover.set(null)"
        >
          @for (t of yTicks(); track t.value) {
            <line [attr.x1]="pad.left" [attr.x2]="width() - pad.right" [attr.y1]="t.y" [attr.y2]="t.y" stroke="#e7e5e4" stroke-width="1" />
            <text [attr.x]="pad.left - 8" [attr.y]="t.y" text-anchor="end" dominant-baseline="middle" class="fill-slate-500 text-[11px]">{{ t.text }}</text>
          }
          @for (t of xTicks(); track t.index) {
            <text [attr.x]="t.x" [attr.y]="height - 8" text-anchor="middle" class="fill-slate-500 text-[11px]">{{ t.text }}</text>
          }

          @for (path of paths(); track path.name) {
            <path [attr.d]="path.d" fill="none" [attr.stroke]="path.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            @if (path.end; as end) {
              <circle [attr.cx]="end.x" [attr.cy]="end.y" r="4" [attr.fill]="path.color" stroke="#ffffff" stroke-width="2" />
              <text [attr.x]="end.x + 8" [attr.y]="end.labelY" dominant-baseline="middle" class="fill-slate-700 text-[11px] font-semibold">
                {{ path.name }} · {{ end.text }}
              </text>
            }
          }

          @if (hover(); as h) {
            <line [attr.x1]="h.x" [attr.x2]="h.x" [attr.y1]="pad.top" [attr.y2]="height - pad.bottom" stroke="#a8a29e" stroke-width="1" stroke-dasharray="3 3" />
            @for (m of h.markers; track m.color) {
              <circle [attr.cx]="h.x" [attr.cy]="m.y" r="5" [attr.fill]="m.color" stroke="#ffffff" stroke-width="2" />
            }
          }

          <!-- Cibles de survol : une colonne par point, toute la hauteur. -->
          @for (col of columns(); track col.index) {
            <rect [attr.x]="col.x" [attr.y]="pad.top" [attr.width]="col.w" [attr.height]="height - pad.top - pad.bottom" fill="transparent" (mouseenter)="hover.set(hoverAt(col.index))" />
          }
        </svg>

        @if (hover(); as h) {
          <div
            class="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md"
            [style.left.px]="h.tooltipLeft"
          >
            <p class="mb-1 font-semibold text-slate-800">{{ h.label }}</p>
            @for (v of h.values; track v.name) {
              <p class="flex items-center justify-between gap-4 text-slate-600">
                <span class="flex items-center gap-1.5"><span class="size-2 rounded-full" [style.background]="v.color"></span>{{ v.name }}</span>
                <span class="font-semibold tabular-nums text-slate-800">{{ v.text }}</span>
              </p>
            }
          </div>
        }
      </div>

      <details class="text-xs text-slate-600">
        <summary class="cursor-pointer select-none font-medium text-primary">Voir les données</summary>
        <div class="mt-2 max-h-60 overflow-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="text-slate-500">
                <th class="py-1 pr-4 font-medium">Période</th>
                @for (s of series(); track s.name) {
                  <th class="py-1 pr-4 text-right font-medium">{{ s.name }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (p of points(); track p.label) {
                <tr class="border-t border-slate-100">
                  <td class="py-1 pr-4">{{ p.label }}</td>
                  @for (v of p.values; track $index) {
                    <td class="py-1 pr-4 text-right tabular-nums">{{ fmt(v) }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `,
})
export class ReportLineChart {
  public readonly series = input.required<LineSeries[]>();
  public readonly points = input.required<LinePoint[]>();
  public readonly ariaLabel = input('Évolution sur la période');

  public readonly height = HEIGHT;
  public readonly pad = PAD;
  public readonly fmt = formatNumber;

  private readonly _host = viewChild.required<ElementRef<HTMLElement>>('host');
  public readonly width = signal(640);
  public readonly hover = signal<ReturnType<ReportLineChart['hoverAt']> | null>(null);

  constructor() {
    // Le SVG est dessiné à la largeur réelle plutôt qu'étiré : un viewBox étiré déformerait les
    // textes et l'épaisseur des traits.
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this._host().nativeElement;
      const observer = new ResizeObserver(([entry]) => this.width.set(Math.max(320, Math.floor(entry.contentRect.width))));
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  private readonly _max = computed(() => {
    const max = Math.max(0, ...this.points().flatMap((p) => p.values));
    return niceMax(max);
  });

  private _x(i: number): number {
    const n = this.points().length;
    const inner = this.width() - PAD.left - PAD.right;
    return n <= 1 ? PAD.left + inner / 2 : PAD.left + (inner * i) / (n - 1);
  }

  private _y(v: number): number {
    const inner = HEIGHT - PAD.top - PAD.bottom;
    return PAD.top + inner - (inner * v) / (this._max() || 1);
  }

  public readonly yTicks = computed(() => {
    const max = this._max();
    return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: f, y: this._y(max * f), text: formatNumber(Math.round(max * f)) }));
  });

  /** Au plus ~8 libellés : au-delà ils se chevauchent. */
  public readonly xTicks = computed(() => {
    const pts = this.points();
    const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(this.width() / 90))));
    return pts.map((p, index) => ({ index, x: this._x(index), text: p.tick })).filter((t) => t.index % step === 0);
  });

  public readonly paths = computed(() => {
    const pts = this.points();
    const ends = this.series().map((s, si) => {
      const last = pts.length - 1;
      return last < 0 ? null : { x: this._x(last), y: this._y(pts[last].values[si] ?? 0), text: formatNumber(pts[last].values[si] ?? 0) };
    });
    // Des libellés de fin trop proches se chevaucheraient : de haut en bas, chacun est poussé à
    // au moins 14 px du précédent. Le point reste à sa vraie hauteur, seul le texte se déplace.
    const labelYs = ends.map((e) => e?.y ?? 0);
    const order = labelYs.map((y, i) => ({ y, i })).sort((p, q) => p.y - q.y);
    for (let k = 1; k < order.length; k++) {
      if (order[k].y - order[k - 1].y < 14) order[k].y = order[k - 1].y + 14;
    }
    order.forEach(({ y, i }) => (labelYs[i] = y));
    return this.series().map((s, si) => ({
      name: s.name,
      color: s.color,
      d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${this._x(i).toFixed(1)},${this._y(p.values[si] ?? 0).toFixed(1)}`).join(' '),
      end: ends[si] ? { ...ends[si]!, labelY: labelYs[si] } : null,
    }));
  });

  public readonly columns = computed(() => {
    const n = this.points().length;
    const inner = this.width() - PAD.left - PAD.right;
    const w = n <= 1 ? inner : inner / (n - 1);
    return this.points().map((_, index) => ({ index, x: this._x(index) - w / 2, w }));
  });

  public hoverAt(index: number) {
    const p = this.points()[index];
    const x = this._x(index);
    const tooltipW = 180;
    return {
      x,
      label: p.label,
      markers: this.series().map((s, si) => ({ color: s.color, y: this._y(p.values[si] ?? 0) })),
      values: this.series().map((s, si) => ({ name: s.name, color: s.color, text: formatNumber(p.values[si] ?? 0) })),
      // L'infobulle passe à gauche du réticule dans la moitié droite, pour ne pas sortir du cadre.
      tooltipLeft: x > this.width() / 2 ? Math.max(0, x - tooltipW - 12) : x + 12,
    };
  }
}

/**
 * Un maximum d'axe égal à quatre pas « ronds » (1, 2 ou 5 × 10ⁿ), pour que les cinq graduations
 * soient des entiers distincts : 47 → 80 (pas de 20), 230 → 400, 3 → 4.
 */
function niceMax(max: number): number {
  const raw = Math.max(1, max / 4);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return Math.max(4, step * 4);
}
